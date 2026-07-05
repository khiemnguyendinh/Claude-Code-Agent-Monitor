/**
 * @file server/lib/kad/guardrails.js — cost/turn circuit breaker (spec 01 §8,
 * spec 04 §3 step 2a). BẮT BUỘC: checked before EVERY run spawn (start / resume
 * / delegation). Over any cap → task waiting_human + budget_warning notification,
 * NO spawn. Never hard-kills a running turn — only blocks the next spawn boundary.
 */
const repo = require("./repo");

const DEFAULT_BUDGET = {
  daily_token_limit: 2000000,
  // 500k was calibrated before Phase 2's turn-based (no-held-process) architecture
  // shipped: every resume reconnects the MCP server fresh, and that reconnection
  // consistently cache-misses the tool-schema portion of the prompt (~36-45k
  // tokens/turn, confirmed live — identical system prompt + identical MCP config
  // still misses on resume, whereas the same resume WITHOUT an MCP connection
  // hits cache for free). A normal intake→brief→plan→delegate→report cycle is
  // 6-10 turns, so real per-task usage lands around 1.3-1.7M tokens even for a
  // well-behaved task — 500k tripped the breaker before ANY task could finish.
  // This is inherent overhead of the spec-mandated per-turn fresh process, not a
  // fixable bug; 2M keeps the breaker as a genuine runaway/loop guard instead of
  // blocking normal completion.
  per_task_token_limit: 2000000,
  monthly_cost_limit_usd: 200,
  max_concurrent_runs: 3,
  max_delegations_per_task: 8,
};
const DEFAULT_MAX_TURNS = 30;

function budgetFor(department) {
  const b = (department && department.settings && department.settings.budget) || {};
  return { ...DEFAULT_BUDGET, ...b };
}

function maxTurnsFor(department) {
  return (
    (department && department.settings && department.settings.max_turns_per_run) ||
    DEFAULT_MAX_TURNS
  );
}

/** Extract a token total from a task_runs.tokens_used JSON blob. */
function tokenTotal(tokens) {
  if (!tokens) return 0;
  if (typeof tokens.total === "number") return tokens.total;
  const inp = Number(tokens.input_tokens || tokens.input || 0);
  const out = Number(tokens.output_tokens || tokens.output || 0);
  return inp + out;
}

function taskTokenUsage(taskId) {
  return repo.runs.listByTask(taskId).reduce((s, r) => s + tokenTotal(r.tokens_used), 0);
}

function deptTokenUsageToday(departmentId) {
  const today = repo.nowIso().slice(0, 10); // YYYY-MM-DD
  const rows = repo.db
    .prepare(
      `SELECT r.tokens_used FROM task_runs r JOIN tasks t ON r.task_id=t.id
       WHERE t.department_id=? AND substr(r.started_at,1,10)=?`
    )
    .all(departmentId, today);
  return rows.reduce((s, r) => s + tokenTotal(repo.parseJson(r.tokens_used, null)), 0);
}

/**
 * Department-level budget gate for the automation `create_task` action
 * (spec 02 §6b / 01 §8). BEFORE an auto-task is created we check the department
 * is not already over its daily token budget — over → skipped_budget +
 * notification, task NOT created (see automation.js). Dept-scoped only: there is
 * no task yet at rule-fire time, so this reuses the SAME daily cap the per-run
 * breaker enforces.
 * @returns {{over:boolean, reason?:string}}
 */
function deptOverBudget(departmentId) {
  if (!departmentId) return { over: false };
  const dept = repo.catalog.getDepartment(departmentId);
  if (!dept) return { over: false };
  const budget = budgetFor(dept);
  const daily = deptTokenUsageToday(departmentId);
  if (daily >= budget.daily_token_limit) {
    return { over: true, reason: `daily_token_limit reached (${daily}/${budget.daily_token_limit})` };
  }
  return { over: false };
}

/**
 * Decide whether a new run/delegation may spawn for `taskId`.
 * @returns {{ok:boolean, reason?:string, maxTurns:number}}
 */
function check(taskId, { isDelegation = false } = {}) {
  const task = repo.tasks.getTask(taskId);
  const dept = task && task.department_id ? repo.catalog.getDepartment(task.department_id) : null;
  const budget = budgetFor(dept);
  const maxTurns = maxTurnsFor(dept);

  const perTask = taskTokenUsage(taskId);
  if (perTask >= budget.per_task_token_limit) {
    return {
      ok: false,
      reason: `per_task_token_limit reached (${perTask}/${budget.per_task_token_limit})`,
      maxTurns,
    };
  }
  if (dept) {
    const daily = deptTokenUsageToday(dept.id);
    if (daily >= budget.daily_token_limit) {
      return {
        ok: false,
        reason: `daily_token_limit reached (${daily}/${budget.daily_token_limit})`,
        maxTurns,
      };
    }
  }
  const active = repo.runs.countActive();
  if (active >= budget.max_concurrent_runs) {
    return {
      ok: false,
      reason: `max_concurrent_runs reached (${active}/${budget.max_concurrent_runs})`,
      maxTurns,
    };
  }
  if (isDelegation) {
    const delegs = repo.delegations.countByTask(taskId);
    if (delegs >= budget.max_delegations_per_task) {
      return {
        ok: false,
        reason: `max_delegations_per_task reached (${delegs}/${budget.max_delegations_per_task})`,
        maxTurns,
      };
    }
  }
  return { ok: true, maxTurns };
}

/**
 * Trip the breaker: park the task at waiting_human, emit budget_warning, audit.
 * Called when check() fails. Idempotent-ish (re-running just re-notifies).
 */
function trip(taskId, reason) {
  const task = repo.tasks.getTask(taskId);
  repo.tx(() => {
    repo.tasks.updateTask(taskId, { status: "waiting_human" });
    repo.audit({
      department_id: task && task.department_id,
      task_id: taskId,
      action: "budget_exceeded",
      actor_type: "system",
      actor_id: "guardrails",
      target_type: "task",
      target_id: taskId,
      details: { reason },
    });
  });
  // Notification/emit are best-effort AFTER the durable park+audit above — a failure
  // here must not throw out of trip() and mask the fact the task was parked.
  try {
    repo.notifications.createNotification({
      department_id: task && task.department_id,
      kind: "budget_warning",
      title: "Vượt ngân sách — tạm dừng chờ trưởng phòng",
      body: reason,
      link_path: `/cong-viec/${taskId}`,
      target_id: taskId,
    });
    const { emitTask } = require("./events");
    emitTask(taskId, "kad.task.status", { task_id: taskId, status: "waiting_human", reason });
  } catch (e) {
    console.warn(`[kad-guardrails] trip notify failed for ${taskId}:`, e && e.message);
  }
}

module.exports = {
  check,
  trip,
  budgetFor,
  maxTurnsFor,
  tokenTotal,
  taskTokenUsage,
  deptTokenUsageToday,
  deptOverBudget,
  DEFAULT_BUDGET,
};
