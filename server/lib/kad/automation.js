/**
 * @file server/lib/kad/automation.js — automation-rule engine (Phase 6.5,
 * spec 02 §6b, spec 03 §"Tự động hoá", spec 04 §4). Turns a trigger (a business
 * event or a due schedule) into WORK, never bypassing the approval gate or the
 * department budget.
 *
 * The safety gauntlet in fireRule() is the whole point of this file:
 *   pause-all → loop guard (self-trigger + depth cap) → cooldown → max_fires →
 *   budget → action. Every non-paused evaluation records an automation_rule_fires
 *   row (created / skipped_* / blocked_loop / notified) and emits kad.rule.fired,
 *   so "why didn't my rule run" is always answerable from the DB.
 *
 * A rule must NOT be triggered by a task it created (origin_rule_id === rule.id),
 * and the automation chain depth is capped (MAX_AUTOMATION_DEPTH) — together they
 * make an infinite create→trigger→create loop impossible.
 *
 * create_task honors approval_required (default 1): the auto-task lands in
 * 'inbox' as "chờ xác nhận" and NO agent spawns until a human confirms
 * (POST /tasks/:id/confirm). Only approval_required=0 auto-starts a turn.
 */
const repo = require("./repo");
const guardrails = require("./guardrails");
const { emitDept, emitTask } = require("./events");

const MAX_AUTOMATION_DEPTH = Number(process.env.KAD_MAX_AUTOMATION_DEPTH || 3);

// ── Event matching ─────────────────────────────────────────────────────────

/** Does a done `task` match an event rule's filter? All present keys must pass. */
function matchEventFilter(task, filter = {}) {
  if (!task) return false;
  if (filter.workflow_id && task.workflow_id !== filter.workflow_id) return false;
  if (filter.title_contains) {
    const hay = String(task.title || "").toLowerCase();
    if (!hay.includes(String(filter.title_contains).toLowerCase())) return false;
  }
  if (filter.tag) {
    const tags = (task.brief && Array.isArray(task.brief.tags) && task.brief.tags) || [];
    const inTitle = String(task.title || "").toLowerCase().includes(String(filter.tag).toLowerCase());
    if (!tags.includes(filter.tag) && !inTitle) return false;
  }
  if (filter.artifact_type) {
    const approved = repo.artifacts.listArtifacts({ task_id: task.id, status: "approved" });
    if (!approved.some((a) => a.artifact_type === filter.artifact_type)) return false;
  }
  return true;
}

/**
 * A business event happened (e.g. a task reached 'done'). Evaluate every enabled
 * event rule in the department against it.
 * @param {{department_id:string, event:string, task_id?:string}} payload
 */
function evaluateEventRules({ department_id, event, task_id } = {}) {
  if (!department_id) return [];
  const task = task_id ? repo.tasks.getTask(task_id) : null;
  const rules = repo.automationRules.listFireable("event", { department_id });
  const out = [];
  for (const rule of rules) {
    const cfg = rule.trigger_config || {};
    // trigger_config: {event:'task.done', filter:{...}} (spec 02 §6b comment).
    if (cfg.event && event && cfg.event !== event) continue;
    if (!matchEventFilter(task, cfg.filter || {})) continue;
    out.push(fireRule(rule, { triggerRef: event + (task ? `:${task.id}` : ""), triggeringTask: task }));
  }
  return out;
}

// ── Schedule handling ────────────────────────────────────────────────────────

/** Parse "HH:MM" → {h,m}; defaults to 07:00 (giao ban buổi sáng). */
function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
  if (!m) return { h: 7, m: 0 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

/**
 * Latest scheduled occurrence at or before `now` for a `{freq,time,weekday,day,at}`
 * config, or null if none. Server-local time (matches the standup's day boundary).
 */
function latestOccurrenceOnOrBefore(cfg, now) {
  const freq = cfg.freq || cfg.frequency || "daily";
  if (freq === "once") {
    if (!cfg.at) return null;
    const at = new Date(cfg.at);
    return isNaN(at.getTime()) || at > now ? null : at;
  }
  const { h, m } = parseTime(cfg.time);
  const at = (d) => {
    const x = new Date(d);
    x.setHours(h, m, 0, 0);
    return x;
  };
  if (freq === "weekly") {
    const target = Number(cfg.weekday);
    if (!Number.isInteger(target)) return null;
    // Walk back up to 7 days to the most recent target weekday whose time ≤ now.
    for (let i = 0; i < 8; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      if (d.getDay() === target) {
        const occ = at(d);
        if (occ <= now) return occ;
      }
    }
    return null;
  }
  if (freq === "monthly") {
    const target = Number(cfg.day);
    if (!Number.isInteger(target)) return null;
    for (let i = 0; i < 2; i++) {
      const base = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
      const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      const day = Math.min(target, daysInMonth);
      const occ = new Date(base.getFullYear(), base.getMonth(), day, h, m, 0, 0);
      if (occ <= now) return occ;
    }
    return null;
  }
  // daily (default): today's time if already passed, else yesterday's.
  const todays = at(now);
  if (todays <= now) return todays;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return at(y);
}

/**
 * Sweep every enabled schedule rule and fire the ones now due. "Due" = the
 * latest occurrence ≤ now is strictly after the last time we fired (or after
 * the rule was created, so a fresh rule never back-fires past occurrences).
 * Cheap table scan run each worker tick (like dependency-worker).
 * @param {Date} [nowDate]
 */
function sweepSchedules(nowDate) {
  const now = nowDate || new Date();
  const rules = repo.automationRules.listFireable("schedule");
  const out = [];
  for (const rule of rules) {
    try {
      const occ = latestOccurrenceOnOrBefore(rule.trigger_config || {}, now);
      if (!occ) continue;
      const since = new Date(rule.last_fired_at || rule.created_at);
      if (!(occ > since)) continue; // already fired this occurrence
      out.push(fireRule(rule, { triggerRef: `schedule:${occ.toISOString()}` }));
    } catch (e) {
      console.warn(`[kad] automation schedule sweep: rule ${rule.id} failed:`, e && e.message);
    }
  }
  return out;
}

// ── Fire (safety gauntlet + action) ──────────────────────────────────────────

function record(rule, result, { triggerRef, actionTaskId, note } = {}) {
  const fire = repo.automationRules.recordFire({
    rule_id: rule.id,
    trigger_ref: triggerRef,
    action_task_id: actionTaskId,
    result,
    note,
  });
  emitDept(rule.department_id, "kad.rule.fired", {
    rule_id: rule.id,
    result,
    action_task_id: actionTaskId || null,
  });
  return { ruleId: rule.id, result, actionTaskId: actionTaskId || null, fire };
}

/**
 * Evaluate one rule against a trigger and, if it survives the safety gauntlet,
 * run its action. Always returns a summary {result, ...}; records a fire row for
 * every non-paused outcome.
 */
function fireRule(rule, { triggerRef, triggeringTask } = {}) {
  // 0) Kill switch — a paused department is fully inert; nothing records.
  if (repo.catalog.isAutomationPaused(rule.department_id)) {
    return { ruleId: rule.id, result: "paused" };
  }

  // 1) Loop guard. A rule must not be triggered by a task it itself created,
  //    and the automation chain depth is capped.
  const parentDepth = (triggeringTask && triggeringTask.automation_depth) || 0;
  const nextDepth = parentDepth + 1;
  if (triggeringTask && triggeringTask.origin_rule_id === rule.id) {
    return record(rule, "blocked_loop", {
      triggerRef,
      note: "luật bị kích bởi chính task nó tạo",
    });
  }
  if (nextDepth > MAX_AUTOMATION_DEPTH) {
    return record(rule, "blocked_loop", {
      triggerRef,
      note: `vượt trần automation_depth (${nextDepth}>${MAX_AUTOMATION_DEPTH})`,
    });
  }

  // 2) Cooldown — real fires only (skips below don't set last_fired_at).
  if (rule.cooldown_seconds && rule.last_fired_at) {
    const elapsed = (Date.now() - new Date(rule.last_fired_at).getTime()) / 1000;
    if (elapsed < rule.cooldown_seconds) {
      return record(rule, "skipped_cooldown", {
        triggerRef,
        note: `còn ${Math.ceil(rule.cooldown_seconds - elapsed)}s cooldown`,
      });
    }
  }

  // 3) Max fires.
  if (rule.max_fires != null && rule.fire_count >= rule.max_fires) {
    return record(rule, "skipped_maxfires", {
      triggerRef,
      note: `đã kích ${rule.fire_count}/${rule.max_fires}`,
    });
  }

  // 4) Budget — only create_task spends tokens; check before creating.
  if (rule.action_type === "create_task") {
    const budget = guardrails.deptOverBudget(rule.department_id);
    if (budget.over) {
      const fired = record(rule, "skipped_budget", { triggerRef, note: budget.reason });
      repo.notifications.createNotification({
        department_id: rule.department_id,
        kind: "budget_warning",
        title: `Tự động hoá bỏ qua — vượt ngân sách phòng`,
        body: `Luật "${rule.name}" không tạo việc: ${budget.reason}`,
        link_path: "/cong-viec/tu-dong-hoa",
        target_id: rule.id,
      });
      return fired;
    }
  }

  // 5) Action.
  return runAction(rule, { triggerRef, triggeringTask, nextDepth });
}

function runAction(rule, { triggerRef, triggeringTask, nextDepth }) {
  switch (rule.action_type) {
    case "create_task":
      return actionCreateTask(rule, { triggerRef, triggeringTask, nextDepth });
    case "run_briefing":
      return actionRunBriefing(rule, { triggerRef });
    case "notify":
      return actionNotify(rule, { triggerRef });
    case "pause_department":
      return actionPauseDepartment(rule, { triggerRef });
    default:
      return record(rule, "skipped_cooldown", {
        triggerRef,
        note: `action_type không hỗ trợ: ${rule.action_type}`,
      });
  }
}

// ── Actions ───────────────────────────────────────────────────────────────

function actionCreateTask(rule, { triggerRef, triggeringTask, nextDepth }) {
  const cfg = rule.action_config || {};
  const brief = cfg.brief || null;
  const title =
    cfg.title || (brief && brief.goal) || `[Tự động] ${rule.name}`;
  const description =
    cfg.description ||
    (brief ? (typeof brief === "string" ? brief : JSON.stringify(brief)) : null);
  const workingDir =
    cfg.working_dir || (cfg.inherit_from_task && triggeringTask ? triggeringTask.working_dir : null);

  const task = repo.tasks.createTask({
    department_id: rule.department_id,
    title,
    description,
    priority: cfg.priority,
    working_dir: workingDir,
    workflow_id: cfg.workflow_id || null,
    activation: rule.trigger_type === "schedule" ? "schedule" : "rule",
    origin_rule_id: rule.id,
    automation_depth: nextDepth,
    actor_type: "system",
    actor_id: `rule:${rule.id}`,
  });

  repo.automationRules.markFired(rule.id);
  const fired = record(rule, "created", {
    triggerRef,
    actionTaskId: task.id,
    note: rule.approval_required ? "chờ xác nhận" : "tự chạy",
  });
  emitDept(rule.department_id, "kad.task.status", { task_id: task.id, status: task.status });

  // approval_required (default): the task waits in "chờ xác nhận"; a human must
  // confirm before any agent spawns. Only an explicitly approval-free rule
  // auto-starts the turn (still subject to the per-run budget breaker).
  if (!rule.approval_required) {
    setImmediate(() => {
      try {
        require("./orchestrator")
          .startTaskTurn(task.id)
          .catch((e) => console.warn(`[kad] auto-task ${task.id} start failed:`, e && e.message));
      } catch (e) {
        console.warn(`[kad] auto-task ${task.id} start threw:`, e && e.message);
      }
    });
  }
  return fired;
}

/**
 * Deterministic morning briefing (phase-06_5 item 5, DoD "task giao ban tự chạy,
 * ra artifact briefing"). Regenerates the department standup from real rows and
 * captures it as a done briefing task + published artifact — no live agent, so
 * a scheduled briefing is fully verifiable offline.
 */
function actionRunBriefing(rule, { triggerRef }) {
  const deptId = rule.department_id;
  const standup = repo.standup.regenerate(deptId);
  const dateLabel = new Date().toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const content = renderBriefingMarkdown(standup, dateLabel);

  let task;
  let artifact;
  repo.tx(() => {
    task = repo.tasks.createTask({
      department_id: deptId,
      title: `Giao ban buổi sáng — ${dateLabel}`,
      description: "Báo cáo đầu ngày tự động (deterministic).",
      activation: "schedule",
      origin_rule_id: rule.id,
      automation_depth: 1,
      actor_type: "system",
      actor_id: `rule:${rule.id}`,
    });
    repo.tasks.updateTask(task.id, { status: "done" });
    artifact = repo.artifacts.createArtifact({
      task_id: task.id,
      artifact_type: "other",
      title: `Giao ban buổi sáng — ${dateLabel}`,
      content,
      status: "published",
      metadata: { generated_by: "automation", rule_id: rule.id },
    });
    repo.audit({
      department_id: deptId,
      task_id: task.id,
      action: "briefing_generated",
      actor_type: "system",
      actor_id: `rule:${rule.id}`,
      target_type: "artifact",
      target_id: artifact.id,
      details: { trigger_ref: triggerRef },
    });
  });

  repo.notifications.createNotification({
    department_id: deptId,
    kind: "daily_briefing",
    title: "Giao ban buổi sáng đã sẵn sàng",
    body: `Báo cáo đầu ngày ${dateLabel}.`,
    link_path: `/cong-viec/${task.id}`,
    target_id: task.id,
  });

  repo.automationRules.markFired(rule.id);
  const fired = record(rule, "created", { triggerRef, actionTaskId: task.id, note: "giao ban" });
  emitDept(deptId, "kad.task.status", { task_id: task.id, status: "done" });
  emitTask(task.id, "kad.artifact.created", {
    artifact_id: artifact.id,
    task_id: task.id,
    type: artifact.artifact_type,
    version: artifact.version,
  });
  return fired;
}

function renderBriefingMarkdown(standup, dateLabel) {
  const line = (l) => `- ${l.text}`;
  const section = (title, arr) =>
    `## ${title}\n${arr && arr.length ? arr.map(line).join("\n") : "- (không có)"}`;
  return [
    `# Giao ban buổi sáng — ${dateLabel}`,
    section("Đang chạy", standup.dang_chay),
    section("Chờ anh", standup.cho_anh),
    section("Rủi ro", standup.rui_ro),
    `## Chi phí hôm qua\n- ${standup.cost_yesterday_tokens} tokens (~${standup.cost_yesterday_vnd}đ)`,
  ].join("\n\n");
}

function actionNotify(rule, { triggerRef }) {
  const cfg = rule.action_config || {};
  repo.notifications.createNotification({
    department_id: rule.department_id,
    kind: "automation",
    title: cfg.title || `Luật "${rule.name}" đã kích`,
    body: cfg.body || cfg.message || null,
    link_path: cfg.link_path || "/cong-viec/tu-dong-hoa",
    target_id: rule.id,
  });
  repo.automationRules.markFired(rule.id);
  return record(rule, "notified", { triggerRef, note: "gửi cảnh báo" });
}

function actionPauseDepartment(rule, { triggerRef }) {
  repo.catalog.setAutomationPaused(rule.department_id, true);
  repo.notifications.createNotification({
    department_id: rule.department_id,
    kind: "automation",
    title: "Đã tạm dừng mọi tự động hoá của phòng",
    body: `Luật "${rule.name}" kích hành động tạm dừng phòng.`,
    link_path: "/cong-viec/tu-dong-hoa",
    target_id: rule.id,
  });
  repo.automationRules.markFired(rule.id);
  const fired = record(rule, "notified", { triggerRef, note: "pause_department" });
  emitDept(rule.department_id, "kad.automation.paused", {
    department_id: rule.department_id,
    paused: true,
  });
  return fired;
}

// ── Dry-run (no side effects) ────────────────────────────────────────────────

/**
 * "30 ngày qua luật này sẽ kích ở đâu" (spec 03). Renders from history/cadence
 * WITHOUT creating anything. Schedule rules → past occurrences of the cadence;
 * event rules → past done-tasks in the department that match the filter.
 * @returns {{count:number, occurrences:string[], summary:string}}
 */
function dryRun(rule, { days = 30 } = {}) {
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 3600 * 1000);
  let occurrences = [];

  if (rule.trigger_type === "schedule") {
    // Walk day-by-day (cheap for 30d) collecting each cadence occurrence in range.
    const seen = new Set();
    for (let d = new Date(now); d >= from; d.setDate(d.getDate() - 1)) {
      const occ = latestOccurrenceOnOrBefore(rule.trigger_config || {}, d);
      if (occ && occ >= from && occ <= now) seen.add(occ.toISOString());
    }
    occurrences = [...seen].sort();
  } else if (rule.trigger_type === "event") {
    const cfg = rule.trigger_config || {};
    const fromIso = from.toISOString();
    const doneTasks = repo.db
      .prepare(
        `SELECT * FROM tasks WHERE department_id=? AND status='done' AND completed_at>=? ORDER BY completed_at ASC`
      )
      .all(rule.department_id, fromIso)
      .map((r) => ({ ...r, brief: repo.parseJson(r.brief, null) }));
    occurrences = doneTasks
      .filter((t) => matchEventFilter(t, cfg.filter || {}))
      .map((t) => t.completed_at)
      .filter(Boolean);
  } else {
    // metric_threshold: no historical metric stream in the MVP to replay.
    return {
      count: 0,
      occurrences: [],
      summary: "Ngưỡng chỉ số — chưa có dữ liệu lịch sử để mô phỏng.",
    };
  }

  const fmt = (iso) =>
    new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  const sample = occurrences.slice(0, 6).map(fmt);
  const summary = occurrences.length
    ? `Sẽ kích ${occurrences.length} lần: ${sample.join(", ")}${occurrences.length > sample.length ? "…" : ""}`
    : `Sẽ không kích lần nào trong ${days} ngày qua.`;
  return { count: occurrences.length, occurrences, summary };
}

module.exports = {
  evaluateEventRules,
  sweepSchedules,
  fireRule,
  dryRun,
  matchEventFilter,
  latestOccurrenceOnOrBefore,
  MAX_AUTOMATION_DEPTH,
};
