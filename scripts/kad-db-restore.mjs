#!/usr/bin/env node
/**
 * scripts/kad-db-restore.mjs — Phase 7 hardening: restore a dashboard SQLite
 * DB from a `kad-db-backup.mjs` snapshot (a single-file DB with no WAL
 * sidecars, since VACUUM INTO produces a fully-checkpointed copy).
 *
 * Non-destructive by default: if a database already exists at the target
 * path, it is renamed aside to `<target>.pre-restore-<stamp>.bak` instead of
 * being deleted, so a restore never permanently destroys data even if
 * pointed at the wrong file. Stale -wal/-shm sidecars at the target are
 * removed since the restored file is a clean, checkpointed copy.
 *
 * Usage:
 *   node scripts/kad-db-restore.mjs <backup-file>                Restore to the default DB path
 *   node scripts/kad-db-restore.mjs <backup-file> --target <p>   Restore to a specific path
 *   node scripts/kad-db-restore.mjs <backup-file> --yes           Skip the confirmation dry-run
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { getDataDir } = require("../server/lib/claude-home");

function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const args = new Set(process.argv.slice(2));
const CONFIRMED = args.has("--yes") || args.has("-y");
const backupPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;

if (!backupPath) {
  console.error("Usage: node scripts/kad-db-restore.mjs <backup-file> [--target <path>] [--yes]");
  process.exit(1);
}
if (!fs.existsSync(backupPath)) {
  console.error(`Backup file not found: ${backupPath}`);
  process.exit(1);
}

// Sanity-check the backup is actually an openable SQLite DB before touching
// the target — a bad --db-path typo elsewhere shouldn't silently "restore"
// garbage over a working database.
let Database;
try {
  Database = require("better-sqlite3");
} catch {
  Database = require("../server/compat-sqlite");
}
try {
  const probe = new Database(backupPath, { readonly: true });
  probe.pragma("quick_check");
  probe.close();
} catch (e) {
  console.error(`Backup file failed integrity check: ${e.message}`);
  process.exit(1);
}

const targetPath =
  flagValue("--target") || process.env.DASHBOARD_DB_PATH || path.join(getDataDir(), "dashboard.db");

console.log(`Source backup: ${backupPath}`);
console.log(`Restore target: ${targetPath}`);

if (!CONFIRMED) {
  console.log("");
  console.log("DRY RUN — no files were changed. Re-run with --yes to actually restore:");
  console.log(`  node scripts/kad-db-restore.mjs ${backupPath} --yes`);
  if (fs.existsSync(targetPath)) {
    console.log(`(An existing database at the target will be renamed aside, not deleted.)`);
  }
  process.exit(0);
}

fs.mkdirSync(path.dirname(targetPath), { recursive: true });

if (fs.existsSync(targetPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const asideDir = path.join(path.dirname(targetPath), "backups");
  fs.mkdirSync(asideDir, { recursive: true });
  const asidePath = path.join(asideDir, `${path.basename(targetPath)}.pre-restore-${stamp}.bak`);
  fs.renameSync(targetPath, asidePath);
  console.log(`Existing database moved aside: ${asidePath}`);
}
// A restored file from VACUUM INTO has no WAL of its own, but a stale
// -wal/-shm pair could be left at the target path from a prior crash — remove
// so the restored DB starts clean instead of SQLite trying to replay them
// against unrelated content.
for (const suffix of ["-wal", "-shm"]) {
  try {
    fs.rmSync(targetPath + suffix, { force: true });
  } catch {
    /* best effort */
  }
}

fs.copyFileSync(backupPath, targetPath);
console.log(`Restored: ${targetPath}`);
