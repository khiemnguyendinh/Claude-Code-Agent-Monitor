/**
 * @file server/lib/kad/repo/reports.js — cross-cutting read-only aggregation
 * for the "Tổng quan" screen's [GAP] endpoints (client/src/kad/types.ts
 * §Exceptions, §OpsMetricCard): GET /api/kad/exceptions and
 * GET /api/kad/reports/metrics, plus the Đội ngũ tab's per-agent roster
 * aggregate (GET /api/kad/reports/agent-stats) and budget/guardrail snapshot
 * (GET /api/kad/reports/budget). Every value here is a real column from
 * task_runs / approvals / notifications / task_delegations / tasks /
 * agent_profiles / departments — no fabricated series or placeholder rows. A
 * candidate source that has no real backing column (e.g. artifacts.quality_score,
 * which is never written — only read speculatively from JSON metadata by the
 * client) or no writer at all (connector_actions — schema exists, nothing ever
 * inserts into it) is omitted outright rather than stubbed with zeroes/randoms.
 *
 * NOTE: agent-stats/budget here are DISTINCT from two other [GAP]-annotated
 * client shapes that look similar but are separate features with separate
 * paths/shapes: `AgentStats` (client/src/kad/types.ts) backs the *per-agent*
 * GET /api/kad/agents/:id/stats (camelCase, qualityPassRate30d as 0-100,
 * includes sparkline14d) — not implemented here. `DepartmentPolicies` backs a
 * department-policies page (camelCase, includes autoApprove rules) — also not
 * implemented here. This file's agent-stats/budget are the snake_case,
 * whole-department aggregates requested for the Reports screen.
 */
const { db, nowIso } = require("./db");

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** YYYY-MM-DD (UTC, matches the ISO8601 TEXT timestamp convention used everywhere else). */
function dayKey(iso) {
  return String(iso || "").slice(0, 10);
}

function isoDaysAgo(days, fromMs = Date.now()) {
  return new Date(fromMs - days * DAY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Exceptions — GET /api/kad/exceptions (spec/ui/02 §4/§7, ExceptionItem)
// ---------------------------------------------------------------------------

/** Failed runs in the last 7 days → severity "danger" (task actually broke). */
function runFailedExceptions(department_id, sinceIso) {
  const rows = department_id
    ? db
        .prepare(
          `SELECT r.id, r.completed_at, r.started_at, t.id as task_id, t.title as task_title,
                  r.engine, a.display_name as agent_name
           FROM task_runs r
           JOIN tasks t ON r.task_id=t.id
           LEFT JOIN agent_profiles a ON r.agent_id=a.id
           WHERE t.department_id=? AND r.status='failed'
             AND COALESCE(r.completed_at, r.started_at) >= ?
           ORDER BY COALESCE(r.completed_at, r.started_at) DESC`
        )
        .all(department_id, sinceIso)
    : db
        .prepare(
          `SELECT r.id, r.completed_at, r.started_at, t.id as task_id, t.title as task_title,
                  r.engine, a.display_name as agent_name
           FROM task_runs r
           JOIN tasks t ON r.task_id=t.id
           LEFT JOIN agent_profiles a ON r.agent_id=a.id
           WHERE r.status='failed' AND COALESCE(r.completed_at, r.started_at) >= ?
           ORDER BY COALESCE(r.completed_at, r.started_at) DESC`
        )
        .all(sinceIso);
  return rows.map((r) => ({
    id: `exc_run_${r.id}`,
    kind: "run_failed",
    description: `${r.task_title || "Việc"} — ${r.agent_name || r.engine || "agent"} lỗi`,
    task_id: r.task_id || null,
    severity: "danger",
    occurred_at: r.completed_at || r.started_at || nowIso(),
  }));
}

/** Pending approvals past their sla_reminder_hours deadline (approvals.sla_reminder_hours,
 * approvals.created_at — same overdue math as repo/standup.js slaOverdue()). Overdue by
 * more than 2x the SLA window escalates to "danger". */
function approvalSlaExceptions(department_id, nowMs) {
  const rows = department_id
    ? db
        .prepare(
          `SELECT a.id, a.title, a.task_id, a.created_at, a.sla_reminder_hours
           FROM approvals a JOIN tasks t ON a.task_id=t.id
           WHERE a.status='pending' AND t.department_id=? AND a.sla_reminder_hours IS NOT NULL`
        )
        .all(department_id)
    : db
        .prepare(
          `SELECT id, title, task_id, created_at, sla_reminder_hours FROM approvals
           WHERE status='pending' AND sla_reminder_hours IS NOT NULL`
        )
        .all();
  const out = [];
  for (const a of rows) {
    const slaMs = a.sla_reminder_hours * 3_600_000;
    const overdueMs = nowMs - new Date(a.created_at).getTime() - slaMs;
    if (overdueMs <= 0) continue; // not yet overdue — not an exception
    out.push({
      id: `exc_appr_${a.id}`,
      kind: "approval_sla",
      description: a.title,
      task_id: a.task_id || null,
      severity: overdueMs > slaMs ? "danger" : "warning", // overdue by >2x the SLA window
      occurred_at: new Date(new Date(a.created_at).getTime() + slaMs).toISOString(),
    });
  }
  return out;
}

/** Unread budget_warning notifications (notifications.kind, .read_at, .target_id — real
 * columns written by guardrails.trip()). target_id points at the task when the trip is
 * per-task; dept-wide trips have no task target and surface with task_id=null. */
function budgetExceededExceptions(department_id, sinceIso) {
  const rows = department_id
    ? db
        .prepare(
          `SELECT id, target_id, body, created_at FROM notifications
           WHERE department_id=? AND kind='budget_warning' AND read_at IS NULL AND created_at>=?
           ORDER BY created_at DESC`
        )
        .all(department_id, sinceIso)
    : db
        .prepare(
          `SELECT id, target_id, body, created_at FROM notifications
           WHERE kind='budget_warning' AND read_at IS NULL AND created_at>=?
           ORDER BY created_at DESC`
        )
        .all(sinceIso);
  // target_id is only a task id when it resolves to an actual task row (guardrails.trip()
  // always targets a task, but the column has no FK — verify before trusting it as task_id).
  const taskIds = rows.map((r) => r.target_id).filter(Boolean);
  const validTaskIds = taskIds.length
    ? new Set(
        db
          .prepare(`SELECT id FROM tasks WHERE id IN (${taskIds.map(() => "?").join(",")})`)
          .all(...taskIds)
          .map((t) => t.id)
      )
    : new Set();
  return rows.map((r) => ({
    id: `exc_budget_${r.id}`,
    kind: "budget_exceeded",
    description: r.body || "Vượt ngân sách",
    task_id: validTaskIds.has(r.target_id) ? r.target_id : null,
    severity: "warning",
    occurred_at: r.created_at,
  }));
}

/** Delegations that are failed, or stuck after >=2 retries (task_delegations.status,
 * .retry_count — real columns updated by the orchestrator's delegation retry loop). */
function delegationStuckExceptions(department_id, sinceIso) {
  const rows = department_id
    ? db
        .prepare(
          `SELECT d.id, d.task_id, d.status, d.retry_count, d.updated_at, t.title as task_title
           FROM task_delegations d JOIN tasks t ON d.task_id=t.id
           WHERE t.department_id=? AND (d.status='failed' OR d.retry_count>=2) AND d.updated_at>=?
           ORDER BY d.updated_at DESC`
        )
        .all(department_id, sinceIso)
    : db
        .prepare(
          `SELECT d.id, d.task_id, d.status, d.retry_count, d.updated_at, t.title as task_title
           FROM task_delegations d JOIN tasks t ON d.task_id=t.id
           WHERE (d.status='failed' OR d.retry_count>=2) AND d.updated_at>=?
           ORDER BY d.updated_at DESC`
        )
        .all(sinceIso);
  return rows.map((d) => ({
    id: `exc_deleg_${d.id}`,
    kind: "delegation_stuck",
    description:
      d.status === "failed"
        ? `${d.task_title || "Việc"} — giao việc phụ thất bại`
        : `${d.task_title || "Việc"} — giao việc phụ kẹt ${d.retry_count} lần retry`,
    task_id: d.task_id || null,
    severity: "warning",
    occurred_at: d.updated_at,
  }));
}

/**
 * Aggregate real exceptions (spec ExceptionKind), newest first, capped at 20.
 * connector_error is intentionally NOT included: the `connectors`/`connector_actions`
 * tables exist in the schema but no repo/route anywhere writes a row into either — there
 * is no real "connector errored" event to key off, so stubbing it would fabricate data.
 * @param {{department_id?: string}} opts
 */
function listExceptions({ department_id } = {}) {
  const nowMs = Date.now();
  const since7d = isoDaysAgo(7, nowMs);
  const all = [
    ...runFailedExceptions(department_id, since7d),
    ...approvalSlaExceptions(department_id, nowMs),
    ...budgetExceededExceptions(department_id, since7d),
    ...delegationStuckExceptions(department_id, since7d),
  ];
  all.sort((a, b) => String(b.occurred_at || "").localeCompare(String(a.occurred_at || "")));
  return all.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Metrics — GET /api/kad/reports/metrics (spec OpsMetricCard, "Tổng quan" Block C)
// ---------------------------------------------------------------------------

/** Build the 14 UTC day-keys ending today, oldest→newest (series_14d[13] = today). */
function last14Days(nowMs) {
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(dayKey(new Date(nowMs - i * DAY_MS).toISOString()));
  return days;
}

function deltaFromHalves(days, dailyCounts) {
  // days is oldest->newest length 14: [0..6] prior week, [7..13] last week.
  const prior = days.slice(0, 7).reduce((s, d) => s + (dailyCounts[d] || 0), 0);
  const last = days.slice(7, 14).reduce((s, d) => s + (dailyCounts[d] || 0), 0);
  const direction = last > prior ? "up" : last < prior ? "down" : "flat";
  return { last, prior, direction };
}

/** "Việc hoàn thành" — tasks.completed_at, tasks.status='done' (real columns). */
function completedTasksMetric(department_id, days, nowMs) {
  const since = days[0]; // oldest day key, inclusive
  const rows = department_id
    ? db
        .prepare(
          `SELECT substr(completed_at,1,10) as d, COUNT(*) n FROM tasks
           WHERE department_id=? AND status='done' AND completed_at IS NOT NULL AND substr(completed_at,1,10)>=?
           GROUP BY d`
        )
        .all(department_id, since)
    : db
        .prepare(
          `SELECT substr(completed_at,1,10) as d, COUNT(*) n FROM tasks
           WHERE status='done' AND completed_at IS NOT NULL AND substr(completed_at,1,10)>=?
           GROUP BY d`
        )
        .all(since);
  const byDay = {};
  for (const r of rows) byDay[r.d] = r.n;
  const series = days.map((d) => byDay[d] || 0);
  const { last, prior, direction } = deltaFromHalves(days, byDay);
  const deltaLabel =
    direction === "flat"
      ? "Không đổi so với 7 ngày trước"
      : `${last - prior >= 0 ? "+" : ""}${last - prior} so với 7 ngày trước`;
  return {
    label: "Việc hoàn thành",
    value: String(last),
    delta_label: deltaLabel,
    delta_direction: direction,
    delta_good: direction === "up",
    series_14d: series,
  };
}

/** "Chi phí 7 ngày" — task_runs.tokens_used (JSON, real column) priced via cost.js'
 * same rate table the Report Card uses. Lower cost is "good" (delta_good on 'down'). */
function costMetric(department_id, days, nowMs) {
  // Lazy require: cost.js requires the repo barrel, which requires this file — deferring
  // avoids a require() cycle mid-construction (same reason repo/standup.js defers it).
  const cost = require("../cost");
  const since = days[0];
  const rows = department_id
    ? db
        .prepare(
          `SELECT r.tokens_used, substr(r.completed_at,1,10) as d FROM task_runs r
           JOIN tasks t ON r.task_id=t.id
           WHERE t.department_id=? AND r.completed_at IS NOT NULL AND substr(r.completed_at,1,10)>=?`
        )
        .all(department_id, since)
    : db
        .prepare(
          `SELECT tokens_used, substr(completed_at,1,10) as d FROM task_runs
           WHERE completed_at IS NOT NULL AND substr(completed_at,1,10)>=?`
        )
        .all(since);
  const { runUsd } = cost;
  const byDay = {};
  for (const r of rows) {
    const tokens = require("./db").parseJson(r.tokens_used, null);
    if (!tokens) continue;
    const usd = runUsd({ tokens_used: tokens, agent_id: null });
    byDay[r.d] = (byDay[r.d] || 0) + usd * cost.VND_PER_USD;
  }
  const series = days.map((d) => Math.round(byDay[d] || 0));
  const { last, prior, direction } = deltaFromHalves(days, byDay);
  const roundedLast = Math.round(last);
  const roundedDelta = Math.round(last - prior);
  const deltaLabel =
    direction === "flat"
      ? "Không đổi so với 7 ngày trước"
      : `${roundedDelta >= 0 ? "+" : ""}${roundedDelta.toLocaleString("vi-VN")} đ so với 7 ngày trước`;
  return {
    label: "Chi phí 7 ngày",
    value: roundedLast.toLocaleString("vi-VN"),
    delta_label: deltaLabel,
    delta_direction: direction,
    delta_good: direction === "down",
    series_14d: series,
  };
}

/** "Đạt QC" — approvals decided 'approved' per day (approvals.status, .decided_at — real
 * columns). artifacts.quality_score is NOT a real column (never written by any writer in
 * this codebase, only speculatively read from JSON metadata client-side), so it cannot be
 * used as a real daily bucket; this ratio is the documented fallback source. */
function qcApprovalRateMetric(department_id, days, nowMs) {
  const since = days[0];
  const decidedRows = department_id
    ? db
        .prepare(
          `SELECT a.status, substr(a.decided_at,1,10) as d FROM approvals a
           JOIN tasks t ON a.task_id=t.id
           WHERE t.department_id=? AND a.decided_at IS NOT NULL AND substr(a.decided_at,1,10)>=?
             AND a.status IN ('approved','needs_changes','rejected')`
        )
        .all(department_id, since)
    : db
        .prepare(
          `SELECT status, substr(decided_at,1,10) as d FROM approvals
           WHERE decided_at IS NOT NULL AND substr(decided_at,1,10)>=?
             AND status IN ('approved','needs_changes','rejected')`
        )
        .all(since);
  if (!decidedRows.length) return null; // genuinely no real source in range — caller omits
  const approvedByDay = {};
  const totalByDay = {};
  for (const r of decidedRows) {
    totalByDay[r.d] = (totalByDay[r.d] || 0) + 1;
    if (r.status === "approved") approvedByDay[r.d] = (approvedByDay[r.d] || 0) + 1;
  }
  const ratioForDay = (d) =>
    totalByDay[d] ? Math.round((100 * (approvedByDay[d] || 0)) / totalByDay[d]) : 0;
  const series = days.map(ratioForDay);
  const lastWeek = days.slice(7, 14);
  const priorWeek = days.slice(0, 7);
  const sumRatio = (weekDays) => {
    const totalDecided = weekDays.reduce((s, d) => s + (totalByDay[d] || 0), 0);
    const totalApproved = weekDays.reduce((s, d) => s + (approvedByDay[d] || 0), 0);
    return totalDecided ? Math.round((100 * totalApproved) / totalDecided) : null;
  };
  const last = sumRatio(lastWeek);
  const prior = sumRatio(priorWeek);
  if (last == null) return null; // no decided approvals in the last 7 days — nothing to show
  const direction = prior == null ? "flat" : last > prior ? "up" : last < prior ? "down" : "flat";
  const deltaLabel =
    prior == null || direction === "flat"
      ? "Không đổi so với 7 ngày trước"
      : `${last - prior >= 0 ? "+" : ""}${last - prior}% so với 7 ngày trước`;
  return {
    label: "Đạt QC",
    value: `${last}%`,
    delta_label: deltaLabel,
    delta_direction: direction,
    delta_good: direction === "up",
    series_14d: series,
  };
}

/**
 * Up to 3 MetricRow entries computed from real daily buckets over the trailing 14 days.
 * Any metric whose real source has zero rows in range is omitted (never a fabricated
 * zero-series row) — see qcApprovalRateMetric's null return.
 * @param {{department_id?: string}} opts
 */
function listMetrics({ department_id } = {}) {
  const nowMs = Date.now();
  const days = last14Days(nowMs);
  const metrics = [
    completedTasksMetric(department_id, days, nowMs),
    costMetric(department_id, days, nowMs),
  ];
  const qc = qcApprovalRateMetric(department_id, days, nowMs);
  if (qc) metrics.push(qc);
  return metrics;
}

// ---------------------------------------------------------------------------
// Agent stats — GET /api/kad/reports/agent-stats (Đội ngũ roster aggregate)
// ---------------------------------------------------------------------------

/** Tasks assigned to `agent_id` completed in the last 7 days (tasks.assigned_agent_id,
 * .status='done', .completed_at — real columns; same "done" convention as
 * completedTasksMetric). */
function tasksThisWeekForAgent(agent_id, since7dIso) {
  return db
    .prepare(
      `SELECT COUNT(*) n FROM tasks
       WHERE assigned_agent_id=? AND status='done' AND completed_at IS NOT NULL AND completed_at>=?`
    )
    .get(agent_id, since7dIso).n;
}

/** Approved / (approved+needs_changes+rejected) ratio for approvals this agent
 * requested (approvals.requested_by, .status, .decided_at — real columns), decided
 * in the last 30 days. Fraction 0..1; 0 when nothing was decided in range — that is
 * a real "no decisions" state, not a fabricated zero. */
function qualityPassRate30dForAgent(agent_id, since30dIso) {
  const rows = db
    .prepare(
      `SELECT status FROM approvals
       WHERE requested_by=? AND decided_at IS NOT NULL AND decided_at>=?
         AND status IN ('approved','needs_changes','rejected')`
    )
    .all(agent_id, since30dIso);
  if (!rows.length) return 0;
  const approved = rows.filter((r) => r.status === "approved").length;
  return Math.round((approved / rows.length) * 1000) / 1000; // fraction 0..1, 3dp
}

// cost.js keeps its per-run USD pricer (`runUsd`) private (not in its
// module.exports — only estimateRoundCost/estimateDeptCostForRange/VND_PER_USD
// are), and this file cannot modify cost.js to export it (out of scope for
// these endpoints). priceTokensVnd() below replicates that same real pricing
// path — the model_pricing table (server/db.js DEFAULT_PRICING, real Anthropic
// list prices) matched against the run's agent.model, falling back to the
// documented Claude Sonnet 5 rate cost.js itself falls back to when no
// model_pricing row matches (Phase 1 seed does not set agent_profiles.model) —
// never an invented rate, and priced with the same VND_PER_USD cost.js exports.
const FALLBACK_INPUT_PER_MTOK = 3;
const FALLBACK_OUTPUT_PER_MTOK = 15;

function ratesForModel(model) {
  if (model) {
    const rows = db.prepare("SELECT * FROM model_pricing").all();
    const rule = rows
      .filter((r) => new RegExp("^" + r.model_pattern.replace(/%/g, ".*") + "$").test(model))
      .sort((a, b) => b.model_pattern.length - a.model_pattern.length)[0];
    if (rule) return { input: rule.input_per_mtok, output: rule.output_per_mtok };
  }
  return { input: FALLBACK_INPUT_PER_MTOK, output: FALLBACK_OUTPUT_PER_MTOK };
}

/** VND price for one run's real tokens_used JSON, given its real agent_id (or null). */
function priceTokensVnd(tokens, agent_id, VND_PER_USD) {
  if (!tokens) return 0;
  const catalog = require("./catalog");
  const agent = agent_id && catalog.getAgent(agent_id);
  const rates = ratesForModel(agent && agent.model);
  const input = Number(tokens.input_tokens || tokens.input || 0);
  const output = Number(tokens.output_tokens || tokens.output || 0);
  const usd =
    !input && !output
      ? ((input + output) / 1_000_000) * rates.input // unknown split — price as input (mirrors cost.js)
      : (input / 1_000_000) * rates.input + (output / 1_000_000) * rates.output;
  return usd * VND_PER_USD;
}

/** Real round-cost (VND) of this agent's runs completed in the last 7 days
 * (task_runs.agent_id, .tokens_used, .completed_at — real columns), priced via
 * the same rate table/VND rate the Report Card and the "Chi phí 7 ngày" metric
 * use (cost.js VND_PER_USD; per-run pricing replicated in priceTokensVnd() —
 * see its header comment for why). Integer VND. */
function cost7dVndForAgent(agent_id, since7dIso) {
  // Lazy require: cost.js requires the repo barrel, which requires this file —
  // deferring avoids a require() cycle mid-construction (same reason costMetric()
  // above and repo/standup.js defer it).
  const { VND_PER_USD } = require("../cost");
  const rows = db
    .prepare(
      `SELECT tokens_used FROM task_runs
       WHERE agent_id=? AND completed_at IS NOT NULL AND completed_at>=?`
    )
    .all(agent_id, since7dIso);
  let vnd = 0;
  for (const r of rows) {
    const tokens = require("./db").parseJson(r.tokens_used, null);
    if (!tokens) continue;
    vnd += priceTokensVnd(tokens, agent_id, VND_PER_USD);
  }
  return Math.round(vnd);
}

/**
 * One row per active agent in the department (catalog.listAgents-equivalent
 * query, status='active' — real agent_profiles rows; zeros are a real "idle
 * agent this week" state, not fabricated). Each field sourced from real
 * columns — see per-field helpers above.
 * @param {string} department_id
 * @returns {{agent_id:string, tasks_this_week:number, quality_pass_rate_30d:number, cost_7d_vnd:number}[]}
 */
function agentStats(department_id) {
  if (!department_id) return [];
  const nowMs = Date.now();
  const since7d = isoDaysAgo(7, nowMs);
  const since30d = isoDaysAgo(30, nowMs);
  const agents = db
    .prepare(
      "SELECT id FROM agent_profiles WHERE department_id=? AND status='active' ORDER BY agent_type, name"
    )
    .all(department_id);
  return agents.map((a) => ({
    agent_id: a.id,
    tasks_this_week: tasksThisWeekForAgent(a.id, since7d),
    quality_pass_rate_30d: qualityPassRate30dForAgent(a.id, since30d),
    cost_7d_vnd: cost7dVndForAgent(a.id, since7d),
  }));
}

// ---------------------------------------------------------------------------
// Budget status — GET /api/kad/reports/budget (guardrail snapshot)
// ---------------------------------------------------------------------------

/**
 * Real token/VND spend for runs COMPLETED today (server-local UTC day, same
 * substr(completed_at,1,10) bucket convention costMetric() above uses for
 * "Chi phí 7 ngày") — reuses cost.js' own exported estimateDeptCostForRange()
 * (department-joined tasks->task_runs, real pricing) rather than duplicating
 * its range math; only the [today 00:00, tomorrow 00:00) window is computed
 * here.
 */
function tokensAndCostUsedToday(department_id) {
  // Lazy require: cost.js requires the repo barrel, which requires this file —
  // deferring avoids a require() cycle mid-construction (same reason
  // costMetric() above defers cost.js).
  const { estimateDeptCostForRange } = require("../cost");
  if (!department_id) return { tokens: 0, vnd: 0 };
  const today = dayKey(nowIso());
  const fromIso = `${today}T00:00:00.000Z`;
  const toIso = isoDaysAgo(-1, new Date(fromIso).getTime()); // start of tomorrow (exclusive end)
  const { tokens, vnd } = estimateDeptCostForRange(department_id, fromIso, toIso);
  return { tokens, vnd };
}

/**
 * Budget limits + today's real usage for a department. Limits come from the
 * department's REAL stored settings JSON (departments.settings.budget —
 * populated at wizard-completion/seed time; see org-context.js completeWizard()
 * and scripts/kad-seed.mjs) merged over guardrails.js' DEFAULT_BUDGET via the
 * same budgetFor() the guardrail breaker itself uses — so this report always
 * reflects the limits actually enforced, never a value read fresh from
 * DEPT_SETTINGS in isolation.
 * @param {string} department_id
 * @returns {{daily_token_limit:number, per_task_token_limit:number, monthly_cost_limit_usd:number, tokens_used_today:number, cost_today_vnd:number}}
 */
function budgetStatus(department_id) {
  // Lazy require: guardrails.js requires the repo barrel, which requires this
  // file — deferring avoids a require() cycle mid-construction (same reason
  // cost.js is deferred above).
  const { budgetFor } = require("../guardrails");
  const catalog = require("./catalog");
  const dept = department_id ? catalog.getDepartment(department_id) : null;
  const budget = budgetFor(dept);
  const { tokens, vnd } = tokensAndCostUsedToday(department_id);
  return {
    daily_token_limit: budget.daily_token_limit,
    per_task_token_limit: budget.per_task_token_limit,
    monthly_cost_limit_usd: budget.monthly_cost_limit_usd,
    tokens_used_today: tokens,
    cost_today_vnd: vnd,
  };
}

module.exports = { listExceptions, listMetrics, agentStats, budgetStatus };
