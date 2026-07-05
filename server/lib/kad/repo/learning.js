/**
 * @file server/lib/kad/repo/learning.js — learning_notes.
 * Phase 1: rough note on human reject/needs_changes (spec 03 Approvals). Full
 * categorization + pattern detection is Phase 5; here we persist institutional
 * memory with change_status='noted' (never auto-proposed — spec 01 §5).
 */
const { db, parseJson, newId, nowIso } = require("./db");

function createNote({ department_id, task_id, artifact_id, trigger_type, feedback_content, correction_category, severity, root_cause, prevention, affected_areas, affected_agent_id, proposed_change, proposed_change_target }) {
  const id = newId("learn");
  const now = nowIso();
  db.prepare(
    `INSERT INTO learning_notes
     (id, department_id, task_id, artifact_id, trigger_type, feedback_content, correction_category, severity, root_cause, prevention, affected_areas, affected_agent_id, proposed_change, proposed_change_target, change_status, created_at, updated_at)
     VALUES (@id,@dept,@task,@artifact,@trigger,@feedback,@cat,@sev,@root,@prev,@areas,@agent,@change,@target,'noted',@now,@now)`
  ).run({
    id,
    dept: department_id,
    task: task_id ?? null,
    artifact: artifact_id ?? null,
    trigger: trigger_type,
    feedback: feedback_content ?? null,
    cat: correction_category ?? null,
    sev: severity ?? "major",
    root: root_cause ?? null,
    prev: prevention ?? null,
    areas: JSON.stringify(affected_areas || []),
    agent: affected_agent_id ?? null,
    change: proposed_change ?? null,
    target: proposed_change_target ?? null,
    now,
  });
  return getNote(id);
}

function getNote(id) {
  const row = db.prepare("SELECT * FROM learning_notes WHERE id=?").get(id);
  return row ? { ...row, affected_areas: parseJson(row.affected_areas, []) } : null;
}

function listRecent({ department_id, category, severity, limit = 50 } = {}) {
  const where = ["department_id=@dept"];
  const p = { dept: department_id, limit: Math.min(Number(limit) || 50, 200) };
  if (category) (where.push("correction_category=@cat"), (p.cat = category));
  if (severity) (where.push("severity=@sev"), (p.sev = severity));
  return db
    .prepare(`SELECT * FROM learning_notes WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT @limit`)
    .all(p)
    .map((r) => ({ ...r, affected_areas: parseJson(r.affected_areas, []) }));
}

function updateStatus(id, newStatus) {
  const now = nowIso();
  db.prepare("UPDATE learning_notes SET change_status=@status, updated_at=@now WHERE id=@id").run({
    id,
    status: newStatus,
    now
  });
  return getNote(id);
}

module.exports = { createNote, getNote, listRecent, updateStatus };
