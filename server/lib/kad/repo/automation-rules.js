/**
 * @file server/lib/kad/repo/automation-rules.js — automation_rules +
 * automation_rule_fires (spec 02 §6b, spec/ui/09 §3). Phase 6.5 owns the
 * worker that actually evaluates/fires a rule (`evaluate_rules`/`run_schedule`
 * jobs) — this repo only covers create/read/toggle, which is all Phase 2c
 * wires. `trigger_config`/`action_config` are opaque JSON here; the schedule
 * shape used by the Giao việc composer is `{freq,time,weekday,day,label}` —
 * Phase 6.5's cron translator reads the same column.
 */
const { db, parseJson, newId, nowIso } = require("./db");

function listFires(rule_id) {
  return db
    .prepare("SELECT * FROM automation_rule_fires WHERE rule_id=? ORDER BY fired_at DESC")
    .all(rule_id);
}

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    trigger_config: parseJson(row.trigger_config, {}),
    action_config: parseJson(row.action_config, {}),
    fires: listFires(row.id),
  };
}

function createRule({
  department_id,
  name,
  trigger_type,
  trigger_config,
  action_type,
  action_config,
  approval_required,
  cooldown_seconds,
  max_fires,
  created_by,
}) {
  const id = newId("rule");
  db.prepare(
    `INSERT INTO automation_rules
       (id, department_id, name, trigger_type, trigger_config, action_type, action_config,
        approval_required, cooldown_seconds, max_fires, fire_count, enabled, status, created_by, created_at)
     VALUES
       (@id,@department_id,@name,@trigger_type,@trigger_config,@action_type,@action_config,
        @approval_required,@cooldown_seconds,@max_fires,0,1,'active',@created_by,@now)`
  ).run({
    id,
    department_id,
    name,
    trigger_type,
    trigger_config: JSON.stringify(trigger_config || {}),
    action_type,
    action_config: JSON.stringify(action_config || {}),
    approval_required: approval_required === false ? 0 : 1,
    cooldown_seconds: cooldown_seconds ?? null,
    max_fires: max_fires ?? null,
    created_by: created_by || "human",
    now: nowIso(),
  });
  return getRule(id);
}

function getRule(id) {
  return hydrate(db.prepare("SELECT * FROM automation_rules WHERE id=?").get(id));
}

function listRules({ department_id, enabled } = {}) {
  const where = [];
  const args = [];
  if (department_id) (where.push("department_id=?"), args.push(department_id));
  if (enabled !== undefined) (where.push("enabled=?"), args.push(enabled ? 1 : 0));
  const sql =
    "SELECT * FROM automation_rules" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY created_at DESC";
  return db
    .prepare(sql)
    .all(...args)
    .map(hydrate);
}

// Keeps `status` in lockstep with `enabled` — the evaluator (Phase 6.5) and
// the UI both need a single source of truth for "is this rule live?".
// Never touches 'archived' (not reachable via this route today).
function setEnabled(id, enabled) {
  db.prepare(
    "UPDATE automation_rules SET enabled=?, status=CASE WHEN status='archived' THEN status ELSE ? END WHERE id=?"
  ).run(enabled ? 1 : 0, enabled ? "active" : "paused", id);
  return getRule(id);
}

/**
 * Record one rule evaluation outcome (spec/ui/09 §3). Inserts an
 * automation_rule_fires row and stamps last_fired_at on the rule so the worker
 * won't re-evaluate the same schedule slot. fire_count is bumped only when the
 * rule actually produced work (result='created'|'notified') — skipped_* rows are
 * audit trail, not a consumed fire.
 * @param {{rule_id:string, result:string, trigger_ref?:string, action_task_id?:string, note?:string}} p
 */
function recordFire({ rule_id, result, trigger_ref, action_task_id, note }) {
  const now = nowIso();
  const id = newId("fire");
  db.prepare(
    `INSERT INTO automation_rule_fires (id, rule_id, fired_at, trigger_ref, action_task_id, result, note)
     VALUES (@id,@rule_id,@now,@trigger_ref,@action_task_id,@result,@note)`
  ).run({
    id,
    rule_id,
    now,
    trigger_ref: trigger_ref ?? null,
    action_task_id: action_task_id ?? null,
    result,
    note: note ?? null,
  });
  const consumed = result === "created" || result === "notified";
  db.prepare(
    `UPDATE automation_rules
       SET last_fired_at=@now, fire_count=fire_count + @inc
     WHERE id=@rule_id`
  ).run({ now, rule_id, inc: consumed ? 1 : 0 });
  return getRule(rule_id);
}

module.exports = { createRule, getRule, listRules, setEnabled, listFires, recordFire };
