/**
 * @file server/lib/kad/repo/approvals.js — approvals (human + system auto).
 */
const { db, parseJson, newId, nowIso } = require("./db");

function hydrate(row) {
  return row ? { ...row, context_snapshot: parseJson(row.context_snapshot, null) } : null;
}

function createApproval({ task_id, requested_by, approval_type, sensitivity_subtype, title, description, artifact_id, context_snapshot, reviewer, status, decision_reason, sla_reminder_hours, cooldown_until }) {
  const id = newId("appr");
  const now = nowIso();
  const isSystem = reviewer === "system";
  db.prepare(
    `INSERT INTO approvals
     (id, task_id, requested_by, approval_type, sensitivity_subtype, title, description, artifact_id, context_snapshot, status, reviewer, decision_reason, decided_at, cooldown_until, sla_reminder_hours, created_at, updated_at)
     VALUES (@id,@task_id,@requested_by,@approval_type,@subtype,@title,@description,@artifact_id,@ctx,@status,@reviewer,@reason,@decided_at,@cooldown,@sla,@now,@now)`
  ).run({
    id,
    task_id,
    requested_by: requested_by ?? null,
    approval_type,
    subtype: sensitivity_subtype ?? null,
    title,
    description: description ?? null,
    artifact_id: artifact_id ?? null,
    ctx: context_snapshot != null ? JSON.stringify(context_snapshot) : null,
    status: status ?? (isSystem ? "approved" : "pending"),
    reviewer: reviewer ?? "human",
    reason: decision_reason ?? null,
    decided_at: isSystem ? now : null,
    cooldown: cooldown_until ?? null,
    sla: sla_reminder_hours ?? null,
    now,
  });
  return getApproval(id);
}

function getApproval(id) {
  return hydrate(db.prepare("SELECT * FROM approvals WHERE id=?").get(id));
}

function decide(id, { decision, reason, channel, channel_actor_ref }) {
  db.prepare(
    `UPDATE approvals SET status=@status, decision_reason=@reason, decided_at=@now, decided_channel=@channel, decided_actor_ref=@actor, updated_at=@now WHERE id=@id`
  ).run({
    id,
    status: decision,
    reason: reason ?? null,
    channel: channel ?? "web",
    actor: channel_actor_ref ?? null,
    now: nowIso(),
  });
  return getApproval(id);
}

function listPending({ department_id } = {}) {
  // Join task to filter by department; only human-pending surface in the inbox.
  const rows = department_id
    ? db.prepare("SELECT a.* FROM approvals a JOIN tasks t ON a.task_id=t.id WHERE a.status='pending' AND t.department_id=? ORDER BY a.created_at ASC").all(department_id)
    : db.prepare("SELECT * FROM approvals WHERE status='pending' ORDER BY created_at ASC").all();
  return rows.map(hydrate);
}

function listByTask(task_id) {
  return db.prepare("SELECT * FROM approvals WHERE task_id=? ORDER BY created_at ASC").all(task_id).map(hydrate);
}

/** Latest pending plan/artifact approval for a task (orchestrator resume lookup). */
function latestPending(task_id) {
  return hydrate(db.prepare("SELECT * FROM approvals WHERE task_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(task_id));
}

/** Has an approved approval of a given type for the task (auto-approve conditions). */
function hasApproved(task_id, approval_type) {
  return !!db.prepare("SELECT 1 FROM approvals WHERE task_id=? AND approval_type=? AND status='approved' LIMIT 1").get(task_id, approval_type);
}

module.exports = { createApproval, getApproval, decide, listPending, listByTask, latestPending, hasApproved };
