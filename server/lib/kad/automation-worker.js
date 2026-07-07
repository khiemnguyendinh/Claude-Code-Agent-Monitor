/**
 * @file server/lib/kad/automation-worker.js — the automation-rule executor
 * (spec/ui/09 §3, the "Phase 6.5" evaluator the CRUD routes deferred). Runs as
 * a stateless scan inside the job-queue sweep tick (see job-queue.js), same
 * shape as dependency-worker: nothing to lease/dedupe, just "each tick, evaluate
 * every enabled rule and fire the due ones".
 *
 * A fire is recorded in automation_rule_fires with an explicit result so the
 * Tự động hoá screen shows real history (created/notified/skipped_*). Firing a
 * `create_task` rule creates a real task; with approval_required it stops there
 * (waits for the human to open + start it — no token spent), otherwise it kicks
 * the first turn immediately (genuine end-to-end automation).
 *
 * Guardrails honored per rule: department automation kill-switch, cooldown_seconds,
 * max_fires. Schedule slots fire at most once (last_fired_at stamps the slot).
 */
const repo = require("./repo");
const { emitDept } = require("./events");

// "Thứ 2".."Chủ nhật" (schedule-helpers.ts) → JS getDay() (0=Sun..6=Sat).
const WEEKDAY_TO_DOW = {
  "Thứ 2": 1,
  "Thứ 3": 2,
  "Thứ 4": 3,
  "Thứ 5": 4,
  "Thứ 6": 5,
  "Thứ 7": 6,
  "Chủ nhật": 0,
};

/** Parse "HH:MM" → {h,m}; defaults to 00:00 on garbage so a rule never throws. */
function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
  if (!m) return { h: 0, m: 0 };
  return { h: Math.min(23, +m[1]), m: Math.min(59, +m[2]) };
}

/**
 * Most-recent scheduled instant <= now for a schedule config, or null if the
 * rule has never come due yet (e.g. a 'once' whose date is still in the future).
 * The worker fires when this instant exists AND is newer than last_fired_at.
 */
function lastDueInstant(cfg, now) {
  const { h, m } = parseTime(cfg.time);
  const freq = cfg.freq || "daily";

  if (freq === "daily") {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1); // today's slot not reached → yesterday's
    return d;
  }

  if (freq === "weekly") {
    const targetDow = WEEKDAY_TO_DOW[cfg.weekday] ?? 1;
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    // Walk back day-by-day (<=7 steps) to the most recent matching weekday slot.
    for (let i = 0; i < 8; i++) {
      if (d.getDay() === targetDow && d.getTime() <= now.getTime()) return d;
      d.setDate(d.getDate() - 1);
      d.setHours(h, m, 0, 0);
    }
    return null;
  }

  if (freq === "monthly") {
    const day = Math.max(1, Math.min(31, parseInt(cfg.day, 10) || 1));
    const d = new Date(now.getFullYear(), now.getMonth(), day, h, m, 0, 0);
    if (d.getTime() > now.getTime()) {
      // This month's slot not reached → previous month (clamps to real days).
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, day, h, m, 0, 0);
      return prev;
    }
    return d;
  }

  if (freq === "once") {
    // 'once' stores day-of-current-month + time (composer has no full date picker).
    const day = Math.max(1, Math.min(31, parseInt(cfg.day, 10) || 1));
    const d = new Date(now.getFullYear(), now.getMonth(), day, h, m, 0, 0);
    return d.getTime() <= now.getTime() ? d : null;
  }

  return null;
}

/** True when a schedule rule has an un-fired due slot. */
function scheduleDue(rule, now) {
  const inst = lastDueInstant(rule.trigger_config || {}, now);
  if (!inst) return false;
  if (!rule.last_fired_at) return true;
  return new Date(rule.last_fired_at).getTime() < inst.getTime();
}

/** True when an event rule's source task has reached the configured state. */
function eventDue(rule) {
  const cfg = rule.trigger_config || {};
  const sourceId = cfg.sourceTaskId || cfg.source_task_id;
  if (!sourceId) return false;
  const source = repo.tasks.getTask(sourceId);
  if (!source) return false;
  const want = cfg.event === "task.done" || cfg.event === "done" ? "done" : cfg.event;
  const reached = source.status === want;
  if (!reached) return false;
  // Fire once per source-reaching: only if we haven't already fired for it.
  if (!rule.last_fired_at) return true;
  return new Date(rule.last_fired_at).getTime() < new Date(source.updated_at).getTime();
}

/** True when a metric_threshold rule's metric crosses its bound. The form
 * (AutomationRuleForm.tsx) stores {metric, op, value}; metrics carry a stable
 * `key` (repo/reports.js). Values may be display strings ("85%", "1.234") —
 * strip non-numeric chars before comparing. */
// A metric condition can stay true across many ticks (unlike a schedule slot or a
// one-shot event), so without a re-arm window it would fire every 2s. Re-fire at
// most once per this window unless the rule sets its own (shorter/longer) cooldown.
const METRIC_REARM_MS = 6 * 60 * 60 * 1000;

function metricDue(rule, now) {
  if (rule.last_fired_at) {
    const elapsed = now.getTime() - new Date(rule.last_fired_at).getTime();
    const floor = rule.cooldown_seconds ? rule.cooldown_seconds * 1000 : METRIC_REARM_MS;
    if (elapsed < floor) return false;
  }
  const cfg = rule.trigger_config || {};
  const metrics = repo.reports.listMetrics({ department_id: rule.department_id });
  const key = cfg.metric || cfg.metric_key;
  const metric = metrics.find((mm) => mm.key === key || mm.id === key || mm.label === key);
  if (!metric) return false;
  const value = parseFloat(String(metric.value ?? metric.current ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(value)) return false;
  const threshold = Number(cfg.value ?? cfg.thresholdValue ?? cfg.threshold);
  if (!Number.isFinite(threshold)) return false;
  const op = cfg.op || cfg.thresholdOp || "gt";
  return op === "lt" ? value < threshold : value > threshold;
}

function isDue(rule, now) {
  switch (rule.trigger_type) {
    case "schedule":
      return scheduleDue(rule, now);
    case "event":
      return eventDue(rule);
    case "metric_threshold":
      return metricDue(rule, now);
    default:
      return false;
  }
}

/** Execute a due rule's action and record the fire. */
function fireRule(rule, now) {
  const firedAt = now.toISOString();
  // Cooldown floor (applies to all trigger types).
  if (rule.cooldown_seconds && rule.last_fired_at) {
    const elapsed = (now.getTime() - new Date(rule.last_fired_at).getTime()) / 1000;
    if (elapsed < rule.cooldown_seconds) {
      repo.automationRules.recordFire({ rule_id: rule.id, result: "skipped_cooldown", firedAt });
      return;
    }
  }
  // Exhausted fire budget.
  if (rule.max_fires != null && rule.fire_count >= rule.max_fires) {
    repo.automationRules.recordFire({ rule_id: rule.id, result: "skipped_maxfires", firedAt });
    return;
  }

  const cfg = rule.action_config || {};

  if (rule.action_type === "notify") {
    const notif = repo.notifications.createNotification({
      department_id: rule.department_id,
      kind: null, // table CHECK has no generic kind; keep null (title/body carry meaning)
      title: rule.name,
      body: cfg.message || cfg.brief || "Luật tự động đã kích hoạt.",
      link_path: "/cong-viec/tu-dong-hoa",
    });
    repo.automationRules.recordFire({
      rule_id: rule.id,
      result: "notified",
      note: rule.name,
      firedAt,
    });
    void notif; // createNotification already broadcasts kad.notification
    return;
  }

  if (rule.action_type === "pause_department") {
    repo.catalog.setAutomationPaused(rule.department_id, true);
    repo.automationRules.recordFire({
      rule_id: rule.id,
      result: "notified",
      note: "paused",
      firedAt,
    });
    emitDept(rule.department_id, "kad.department.updated", {
      department_id: rule.department_id,
      automation_paused: true,
    });
    return;
  }

  // create_task | run_briefing — both materialize a real task from action_config.
  const brief = cfg.brief || cfg.message || rule.name;
  const task = repo.tasks.createTask({
    department_id: rule.department_id,
    title: brief.length > 120 ? `${brief.slice(0, 120)}…` : brief,
    description: brief,
    working_dir: cfg.working_dir ?? null,
    workflow_id: cfg.workflow_id ?? null,
    model: cfg.model ?? null,
    thinking_level: cfg.thinking_level ?? null,
    permission_mode: cfg.permission_mode ?? null,
    activation: "rule",
  });
  repo.automationRules.recordFire({
    rule_id: rule.id,
    result: "created",
    action_task_id: task.id,
    note: rule.name,
    firedAt,
  });
  const notif = repo.notifications.createNotification({
    department_id: rule.department_id,
    kind: null, // table CHECK has no generic kind; keep null (title/body carry meaning)
    title: `Luật "${rule.name}" đã tạo việc`,
    body: rule.approval_required
      ? "Việc đang chờ anh xác nhận trước khi chạy."
      : "Việc đã được khởi chạy tự động.",
    link_path: `/cong-viec/${task.id}`,
    target_id: task.id,
  });
  emitDept(rule.department_id, "kad.task.status", { task_id: task.id, status: task.status });
  void notif; // createNotification already broadcasts kad.notification

  // approval_required (default) → stop here; the human opens + starts it, no token
  // spent. Otherwise kick the first turn now for true end-to-end automation.
  if (!rule.approval_required) {
    repo.tasks.addMessage({
      task_id: task.id,
      sender_type: "human",
      sender_id: "automation",
      content: brief,
      message_type: "chat",
    });
    // Lazy require breaks the job-queue → orchestrator → repo cycle.
    const orchestrator = require("./orchestrator");
    orchestrator.startTaskTurn(task.id).catch((e) => {
      console.warn(`[automation] auto-run task(${task.id}) failed:`, e && e.message);
    });
  }
}

/**
 * Evaluate every enabled rule once. Called each job-queue sweep tick. Never
 * throws (a single bad rule can't wedge the sweep) — logs and moves on.
 */
function checkRules(now = new Date()) {
  let rules;
  try {
    rules = repo.automationRules.listRules({ enabled: true });
  } catch {
    return; // DB not ready (tests/boot) — nothing to do
  }
  for (const rule of rules) {
    try {
      if (repo.catalog.isAutomationPaused(rule.department_id)) continue; // dept kill-switch
      if (!isDue(rule, now)) continue;
      fireRule(rule, now);
    } catch (e) {
      console.warn(`[automation] rule(${rule.id}) evaluate failed:`, e && e.message);
    }
  }
}

module.exports = { checkRules, lastDueInstant, scheduleDue, isDue };
