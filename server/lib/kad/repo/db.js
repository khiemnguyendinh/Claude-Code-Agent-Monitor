/**
 * @file server/lib/kad/repo/db.js — repo base: shared monitor db handle, JSON
 * helpers, transaction wrapper, and the audit_log writer.
 *
 * Every KAD business write goes through the repo layer (spec 03 §3). The shared
 * db is the SAME better-sqlite3 instance the monitor uses (spec 02 §2.4 — one
 * process, one write connection). Migrations are applied on first load.
 */
const path = require("node:path");
const { newId, nowIso } = require("../ids");

const dbMod = require(path.join(__dirname, "..", "..", "..", "db.js"));
const { runKadMigrations } = require("../migrate");

const db = dbMod.db;
// Ensure KAD schema exists before any repo call (idempotent, cheap after first).
runKadMigrations(db);

/** Parse a JSON text column, tolerant of null/invalid. */
function parseJson(text, fallback = null) {
  if (text == null) return fallback;
  if (typeof text === "object") return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** Run fn() inside a transaction (better-sqlite3 synchronous transaction). */
function tx(fn) {
  return db.transaction(fn)();
}

/**
 * Write an audit_log row. Call INSIDE the same transaction as the state change
 * it records (spec 03 §3). Returns the audit id.
 * @param {{department_id?:string, task_id?:string, agent_id?:string, action:string,
 *   actor_type:'human'|'agent'|'system', actor_id?:string, channel?:string,
 *   target_type?:string, target_id?:string, details?:object}} entry
 */
function audit(entry) {
  const id = newId("audit");
  db.prepare(
    `INSERT INTO audit_log
     (id, department_id, task_id, agent_id, action, actor_type, actor_id, channel, target_type, target_id, details, created_at)
     VALUES (@id,@department_id,@task_id,@agent_id,@action,@actor_type,@actor_id,@channel,@target_type,@target_id,@details,@created_at)`
  ).run({
    id,
    department_id: entry.department_id ?? null,
    task_id: entry.task_id ?? null,
    agent_id: entry.agent_id ?? null,
    action: entry.action,
    actor_type: entry.actor_type,
    actor_id: entry.actor_id ?? null,
    channel: entry.channel ?? null,
    target_type: entry.target_type ?? null,
    target_id: entry.target_id ?? null,
    details: entry.details != null ? JSON.stringify(entry.details) : null,
    created_at: nowIso(),
  });
  return id;
}

function listAudit({ task_id, agent_id, action, from, to, limit = 200 } = {}) {
  const where = [];
  const params = {};
  if (task_id) (where.push("task_id=@task_id"), (params.task_id = task_id));
  if (agent_id) (where.push("agent_id=@agent_id"), (params.agent_id = agent_id));
  if (action) (where.push("action=@action"), (params.action = action));
  if (from) (where.push("created_at>=@from"), (params.from = from));
  if (to) (where.push("created_at<=@to"), (params.to = to));
  params.limit = Math.min(Number(limit) || 200, 1000);
  const sql =
    "SELECT * FROM audit_log" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY created_at ASC LIMIT @limit";
  return db.prepare(sql).all(params).map((r) => ({ ...r, details: parseJson(r.details) }));
}

module.exports = { db, parseJson, tx, audit, listAudit, newId, nowIso };
