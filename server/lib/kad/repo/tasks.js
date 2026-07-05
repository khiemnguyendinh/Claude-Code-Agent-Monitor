/**
 * @file server/lib/kad/repo/tasks.js — tasks, task_messages, unified timeline.
 */
const { db, parseJson, audit, newId, nowIso } = require("./db");

const TASK_COLS = [
  "blocked",
  "inbox",
  "triaged",
  "doing",
  "waiting_human",
  "review",
  "needs_changes",
  "done",
  "failed",
  "archived",
];

function resolveVersionSnapshot(department_id) {
  if (!department_id) return { org_context_version_id: null, blueprint_version_id: null };
  const dept = db.prepare("SELECT org_id FROM departments WHERE id=?").get(department_id);
  const org = dept
    ? db
        .prepare(
          "SELECT id FROM organization_context_versions WHERE org_id=? AND status='approved' ORDER BY version DESC LIMIT 1"
        )
        .get(dept.org_id)
    : null;
  const bp = db
    .prepare(
      "SELECT id FROM department_blueprints WHERE department_id=? AND status='approved' ORDER BY version DESC LIMIT 1"
    )
    .get(department_id);
  return {
    org_context_version_id: org ? org.id : null,
    blueprint_version_id: bp ? bp.id : null,
  };
}

function hydrateTask(row) {
  if (!row) return null;
  return { ...row, brief: parseJson(row.brief, null) };
}

function createTask({
  department_id,
  title,
  description,
  priority,
  channel,
  channel_actor_ref,
  working_dir,
  workflow_id,
  activation,
  origin_rule_id,
  automation_depth,
  actor_type,
  actor_id,
}) {
  const id = newId("task");
  const now = nowIso();
  const snapshot = resolveVersionSnapshot(department_id);
  db.prepare(
    `INSERT INTO tasks
     (id, department_id, workflow_id, title, description, status, working_dir, org_context_version_id, blueprint_version_id, activation, origin_rule_id, automation_depth, priority, created_at, updated_at)
     VALUES (@id,@department_id,@workflow_id,@title,@description,'inbox',@working_dir,@org_context_version_id,@blueprint_version_id,@activation,@origin_rule_id,@automation_depth,@priority,@now,@now)`
  ).run({
    id,
    department_id: department_id ?? null,
    workflow_id: workflow_id ?? null,
    title,
    description: description ?? null,
    working_dir: working_dir ?? null,
    org_context_version_id: snapshot.org_context_version_id,
    blueprint_version_id: snapshot.blueprint_version_id,
    activation: activation ?? "manual",
    // origin_rule_id / automation_depth are the anti-loop provenance for
    // automation-created tasks (spec 02 §6b) — NULL/0 for human-created tasks.
    origin_rule_id: origin_rule_id ?? null,
    automation_depth: automation_depth ?? 0,
    priority: priority ?? "normal",
    now,
  });
  audit({
    department_id,
    task_id: id,
    action: "task_created",
    // Manual creation is a human action; an automation rule passes actor_type
    // 'system' so the trail attributes the auto-task to the rule, not a person.
    actor_type: actor_type ?? "human",
    actor_id: actor_id ?? "human",
    channel: channel ?? "web",
    target_type: "task",
    target_id: id,
    details: { title, channel_actor_ref: channel_actor_ref ?? null, origin_rule_id: origin_rule_id ?? null },
  });
  return getTask(id);
}

function getTask(id) {
  return hydrateTask(db.prepare("SELECT * FROM tasks WHERE id=?").get(id));
}

function getTaskCounts(id) {
  const g = (sql, ...a) => db.prepare(sql).get(id, ...a).n;
  return {
    messages: g("SELECT COUNT(*) n FROM task_messages WHERE task_id=?"),
    runs: g("SELECT COUNT(*) n FROM task_runs WHERE task_id=?"),
    artifacts: g("SELECT COUNT(*) n FROM artifacts WHERE task_id=?"),
    approvals: g("SELECT COUNT(*) n FROM approvals WHERE task_id=?"),
    delegations: g("SELECT COUNT(*) n FROM task_delegations WHERE task_id=?"),
  };
}

function listTasks({ status, department_id, limit = 100 } = {}) {
  const where = [];
  const args = [];
  if (status) (where.push("status=?"), args.push(status));
  if (department_id) (where.push("department_id=?"), args.push(department_id));
  args.push(Math.min(Number(limit) || 100, 500));
  const sql =
    "SELECT * FROM tasks" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY created_at DESC LIMIT ?";
  return db
    .prepare(sql)
    .all(...args)
    .map(hydrateTask);
}

/** Update task status + optional fields; audits nothing by itself (callers audit the business action). */
function updateTask(id, patch = {}) {
  const allowed = [
    "status",
    "priority",
    "due_date",
    "assigned_agent_id",
    "workflow_id",
    "workflow_step",
    "brief",
    "org_context_version_id",
    "blueprint_version_id",
    "activation",
  ];
  const sets = [];
  const params = { id, now: nowIso() };
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k}=@${k}`);
      params[k] = k === "brief" && patch[k] != null ? JSON.stringify(patch[k]) : patch[k];
    }
  }
  if (patch.status === "done") sets.push("completed_at=@now");
  sets.push("updated_at=@now");
  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id=@id`).run(params);
  return getTask(id);
}

// ---- messages ----
function hydrateMsg(row) {
  return row ? { ...row, metadata: parseJson(row.metadata, null) } : null;
}

function addMessage({
  task_id,
  sender_type,
  sender_id,
  content,
  message_type,
  channel,
  channel_actor_ref,
  metadata,
}) {
  const id = newId("msg");
  db.prepare(
    `INSERT INTO task_messages (id, task_id, sender_type, sender_id, channel, channel_actor_ref, content, message_type, metadata, created_at)
     VALUES (@id,@task_id,@sender_type,@sender_id,@channel,@channel_actor_ref,@content,@message_type,@metadata,@now)`
  ).run({
    id,
    task_id,
    sender_type,
    sender_id: sender_id ?? null,
    channel: channel ?? "web",
    channel_actor_ref: channel_actor_ref ?? null,
    content,
    message_type: message_type ?? "chat",
    metadata: metadata != null ? JSON.stringify(metadata) : null,
    now: nowIso(),
  });
  return getMessage(id);
}

function getMessage(id) {
  return hydrateMsg(db.prepare("SELECT * FROM task_messages WHERE id=?").get(id));
}

function listMessages(task_id, { after } = {}) {
  const rows = after
    ? db
        .prepare(
          "SELECT * FROM task_messages WHERE task_id=? AND created_at>? ORDER BY created_at ASC"
        )
        .all(task_id, after)
    : db
        .prepare("SELECT * FROM task_messages WHERE task_id=? ORDER BY created_at ASC")
        .all(task_id);
  return rows.map(hydrateMsg);
}

/** Merge-patch a message's metadata JSON (e.g. brief.decidedAt, report.decision). */
function updateMessageMetadata(id, metadataPatch) {
  const existing = getMessage(id);
  if (!existing) return null;
  const merged = { ...(existing.metadata || {}), ...metadataPatch };
  db.prepare("UPDATE task_messages SET metadata=@metadata WHERE id=@id").run({
    id,
    metadata: JSON.stringify(merged),
  });
  return getMessage(id);
}

/** Latest message of a given type for a task (e.g. undecided brief/report). */
function latestMessageByType(task_id, message_type) {
  const row = db
    .prepare(
      "SELECT * FROM task_messages WHERE task_id=? AND message_type=? ORDER BY created_at DESC LIMIT 1"
    )
    .get(task_id, message_type);
  return hydrateMsg(row);
}

/** Unified, time-sorted timeline: messages + delegations + runs + approvals + artifacts. */
function getTimeline(task_id) {
  const items = [];
  for (const m of listMessages(task_id)) items.push({ kind: "message", at: m.created_at, data: m });
  for (const r of db
    .prepare("SELECT * FROM task_runs WHERE task_id=? ORDER BY started_at ASC")
    .all(task_id))
    items.push({ kind: "run", at: r.started_at || r.completed_at, data: r });
  for (const d of db
    .prepare("SELECT * FROM task_delegations WHERE task_id=? ORDER BY created_at ASC")
    .all(task_id))
    items.push({ kind: "delegation", at: d.created_at, data: d });
  for (const a of db
    .prepare("SELECT * FROM approvals WHERE task_id=? ORDER BY created_at ASC")
    .all(task_id))
    items.push({ kind: "approval", at: a.created_at, data: a });
  for (const af of db
    .prepare("SELECT * FROM artifacts WHERE task_id=? ORDER BY created_at ASC")
    .all(task_id))
    items.push({ kind: "artifact", at: af.created_at, data: af });
  items.sort((x, y) => String(x.at || "").localeCompare(String(y.at || "")));
  return items;
}

module.exports = {
  TASK_COLS,
  createTask,
  getTask,
  getTaskCounts,
  listTasks,
  updateTask,
  addMessage,
  getMessage,
  listMessages,
  updateMessageMetadata,
  latestMessageByType,
  getTimeline,
};
