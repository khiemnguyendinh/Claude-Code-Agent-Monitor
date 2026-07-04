/**
 * @file server/lib/kad/repo/delegations.js — task_delegations (main → sub).
 */
const { db, parseJson, newId, nowIso } = require("./db");

function hydrate(row) {
  if (!row) return null;
  return { ...row, input_artifact_ids: parseJson(row.input_artifact_ids, []) };
}

function createDelegation({ task_id, from_agent_id, to_agent_id, instruction, input_artifact_ids }) {
  const id = newId("deleg");
  const now = nowIso();
  db.prepare(
    `INSERT INTO task_delegations (id, task_id, from_agent_id, to_agent_id, instruction, input_artifact_ids, status, retry_count, created_at, updated_at)
     VALUES (@id,@task_id,@from,@to,@instruction,@inputs,'pending',0,@now,@now)`
  ).run({
    id,
    task_id,
    from: from_agent_id,
    to: to_agent_id,
    instruction,
    inputs: JSON.stringify(input_artifact_ids || []),
    now,
  });
  return getDelegation(id);
}

function getDelegation(id) {
  return hydrate(db.prepare("SELECT * FROM task_delegations WHERE id=?").get(id));
}

function updateDelegation(id, { status, run_id, output_artifact_id, retry_count }) {
  const sets = [];
  const p = { id, now: nowIso() };
  if (status !== undefined) (sets.push("status=@status"), (p.status = status));
  if (run_id !== undefined) (sets.push("run_id=@run_id"), (p.run_id = run_id));
  if (output_artifact_id !== undefined) (sets.push("output_artifact_id=@oaid"), (p.oaid = output_artifact_id));
  if (retry_count !== undefined) (sets.push("retry_count=@rc"), (p.rc = retry_count));
  sets.push("updated_at=@now");
  db.prepare(`UPDATE task_delegations SET ${sets.join(", ")} WHERE id=@id`).run(p);
  return getDelegation(id);
}

function listByTask(task_id) {
  return db.prepare("SELECT * FROM task_delegations WHERE task_id=? ORDER BY created_at ASC").all(task_id).map(hydrate);
}

function countByTask(task_id) {
  return db.prepare("SELECT COUNT(*) n FROM task_delegations WHERE task_id=?").get(task_id).n;
}

module.exports = { createDelegation, getDelegation, updateDelegation, listByTask, countByTask };
