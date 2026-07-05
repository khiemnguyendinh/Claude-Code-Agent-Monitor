/**
 * @file server/lib/kad/repo/runs.js — task_runs (one agent turn each).
 * Turn-based (spec 04 §3): 'waiting_approval' is a durable marker that the turn
 * ended at an approval boundary — the claude process has already exited.
 */
const { db, parseJson, newId, nowIso } = require("./db");

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    input: parseJson(row.input, null),
    output: parseJson(row.output, null),
    tokens_used: parseJson(row.tokens_used, null),
  };
}

function createRun({ task_id, agent_id, engine, input }) {
  const id = newId("run");
  db.prepare(
    `INSERT INTO task_runs (id, task_id, agent_id, engine, status, input, started_at)
     VALUES (@id,@task_id,@agent_id,@engine,'pending',@input,@now)`
  ).run({
    id,
    task_id,
    agent_id: agent_id ?? null,
    engine: engine ?? "claude",
    input: input != null ? JSON.stringify(input) : null,
    now: nowIso(),
  });
  return getRun(id);
}

function getRun(id) {
  return hydrate(db.prepare("SELECT * FROM task_runs WHERE id=?").get(id));
}

function setEngineSession(id, engineSessionId) {
  db.prepare("UPDATE task_runs SET engine_session_id=? WHERE id=?").run(engineSessionId, id);
}

function updateRun(id, { status, output, tokens_used, engine_session_id }) {
  const sets = [];
  const p = { id };
  if (status !== undefined) (sets.push("status=@status"), (p.status = status));
  if (engine_session_id !== undefined) (sets.push("engine_session_id=@esid"), (p.esid = engine_session_id));
  if (output !== undefined) (sets.push("output=@output"), (p.output = output != null ? JSON.stringify(output) : null));
  if (tokens_used !== undefined) (sets.push("tokens_used=@tokens"), (p.tokens = tokens_used != null ? JSON.stringify(tokens_used) : null));
  // waiting_approval is terminal for the TURN (the claude process has exited), so it
  // stamps completed_at too — the run's wall-clock ends at the approval boundary.
  if (status && ["completed", "failed", "cancelled", "waiting_approval"].includes(status)) sets.push("completed_at=@now"), (p.now = nowIso());
  if (!sets.length) return getRun(id);
  db.prepare(`UPDATE task_runs SET ${sets.join(", ")} WHERE id=@id`).run(p);
  return getRun(id);
}

function listByTask(task_id) {
  return db.prepare("SELECT * FROM task_runs WHERE task_id=? ORDER BY started_at ASC").all(task_id).map(hydrate);
}

/** Runs still marked running/pending — used by reconcile_runs after a crash. */
function listUnfinished() {
  return db
    .prepare("SELECT * FROM task_runs WHERE status IN ('pending','running') ORDER BY started_at ASC")
    .all()
    .map(hydrate);
}

/** Count runs currently occupying a spawn slot (concurrency guardrail). */
function countActive() {
  return db.prepare("SELECT COUNT(*) n FROM task_runs WHERE status IN ('pending','running')").get().n;
}

/** Bulk map of engine_session_id -> {task_id, task_title} for every run that
 * has one, joined to its task. Powers "tên phiên = tên công việc" (spec/ui/08)
 * without an N+1 request per session/agent card on the Kanban board. */
function listSessionTaskMap() {
  return db
    .prepare(
      `SELECT r.engine_session_id AS session_id, r.task_id AS task_id, t.title AS task_title
       FROM task_runs r JOIN tasks t ON t.id = r.task_id
       WHERE r.engine_session_id IS NOT NULL`
    )
    .all();
}

module.exports = {
  createRun,
  getRun,
  setEngineSession,
  updateRun,
  listByTask,
  listUnfinished,
  countActive,
  listSessionTaskMap,
};
