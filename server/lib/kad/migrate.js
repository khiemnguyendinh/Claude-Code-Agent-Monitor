/**
 * @file server/lib/kad/migrate.js
 * @description Applies KAD SQL migrations against the shared monitor db
 * (better-sqlite3, WAL). Same process, single write connection (spec 02 §2.4).
 * Tracked in kad_migrations for idempotency; each file runs once, in a
 * transaction. Never enables PRAGMA foreign_keys globally (would change monitor
 * behavior) — FK clauses in the schema are documentation for MVP.
 */
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");
// Only KAD migrations, applied in filename order.
const KAD_MIGRATION_PREFIX = "kad-";

function ensureLedger(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS kad_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
}

/**
 * Apply all not-yet-applied KAD migrations. Returns list of names applied now.
 * @param {import('better-sqlite3').Database} db shared monitor db instance
 */
function runKadMigrations(db) {
  ensureLedger(db);
  const applied = new Set(
    db.prepare("SELECT name FROM kad_migrations").all().map((r) => r.name)
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.startsWith(KAD_MIGRATION_PREFIX) && f.endsWith(".sql"))
    .sort();
  const nowIso = () => new Date().toISOString();
  const justApplied = [];
  const recordStmt = db.prepare(
    "INSERT INTO kad_migrations (name, applied_at) VALUES (?, ?)"
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // One transaction per migration file: schema + ledger row commit together.
    const tx = db.transaction(() => {
      db.exec(sql);
      recordStmt.run(file, nowIso());
    });
    tx();
    justApplied.push(file);
  }
  return justApplied;
}

module.exports = { runKadMigrations };
