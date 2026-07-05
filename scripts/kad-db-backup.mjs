#!/usr/bin/env node
/**
 * scripts/kad-db-backup.mjs — Phase 7 hardening: safe backup of the LIVE
 * dashboard SQLite DB (WAL mode; the server may be running concurrently).
 *
 * Two steps make this safe against a live writer:
 *   1. `PRAGMA wal_checkpoint(PASSIVE)` — folds as many WAL frames back into
 *      the main DB file as possible without blocking other readers/writers
 *      (unlike TRUNCATE/RESTART, PASSIVE never fails or blocks on a busy DB).
 *   2. `VACUUM INTO` — SQLite's own atomic, transactionally-consistent
 *      single-file snapshot; safe even if a writer is mid-transaction on the
 *      source (see server/db.js's migrateLegacyDatabase for the same
 *      rationale: a raw file copy of a live WAL db can capture a torn
 *      .db/-wal/-shm trio, VACUUM INTO cannot).
 *
 * Usage:
 *   node scripts/kad-db-backup.mjs                  Backup to data/backups/
 *   node scripts/kad-db-backup.mjs --out <path>      Backup to a specific file
 *   node scripts/kad-db-backup.mjs --db-path <path>  Backup a specific source DB
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

const DB_PATH = flagValue("--db-path") || process.env.DASHBOARD_DB_PATH || path.join(getDataDir(), "dashboard.db");

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH} — nothing to back up.`);
  process.exit(1);
}

let Database;
try {
  Database = require("better-sqlite3");
} catch {
  Database = require("../server/compat-sqlite");
}

const outFlag = flagValue("--out");
const backupDir = outFlag ? path.dirname(outFlag) : path.join(path.dirname(DB_PATH), "backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = outFlag || path.join(backupDir, `kad-backup-${stamp}.db`);

const db = new Database(DB_PATH);
try {
  const checkpoint = db.pragma("wal_checkpoint(PASSIVE)");
  // Result shape: [{busy, log, checkpointed}] — busy=1 means a writer held some
  // frames back; still safe, VACUUM INTO below is consistent regardless.
  console.log(`WAL checkpoint (passive): ${JSON.stringify(checkpoint[0] || checkpoint)}`);
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const size = fs.statSync(backupPath).size;
console.log(`Backup written: ${backupPath} (${(size / 1024).toFixed(1)} KB)`);
