/**
 * Read-only Phase 7 reports. Cost is attributed by joining KAD task_runs to the
 * monitor's token_usage table through task_runs.engine_session_id.
 */
const { db } = require("./db");

const VND_PER_USD = Number(process.env.KAD_VND_PER_USD) || 26000;

function rangeWindow(range = "7d") {
  const days = Math.max(1, Math.min(Number(String(range).replace(/d$/, "")) || 7, 90));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { range: `${days}d`, days, from: from.toISOString(), to: to.toISOString() };
}

function ruleForModel(model) {
  if (!model) return null;
  return db
    .prepare("SELECT * FROM model_pricing")
    .all()
    .filter((r) => new RegExp("^" + r.model_pattern.replace(/%/g, ".*") + "$").test(model))
    .sort((a, b) => b.model_pattern.length - a.model_pattern.length)[0];
}

function usageParts(row) {
  const cacheWrite = Number(row.cache_write_tokens || 0) + Number(row.baseline_cache_write || 0);
  const cacheWrite1h =
    Number(row.cache_write_1h_tokens || 0) + Number(row.baseline_cache_write_1h || 0);
  return {
    input: Number(row.input_tokens || 0) + Number(row.baseline_input || 0),
    output: Number(row.output_tokens || 0) + Number(row.baseline_output || 0),
    cacheRead: Number(row.cache_read_tokens || 0) + Number(row.baseline_cache_read || 0),
    cacheWrite,
    cacheWrite1h,
    cacheWrite5m: Math.max(0, cacheWrite - cacheWrite1h),
    webSearch: Number(row.web_search_requests || 0) + Number(row.baseline_web_search || 0),
    webFetch: Number(row.web_fetch_requests || 0) + Number(row.baseline_web_fetch || 0),
    codeExecution:
      Number(row.code_execution_requests || 0) + Number(row.baseline_code_execution || 0),
  };
}

function priceUsage(row) {
  const p = usageParts(row);
  const rule = ruleForModel(row.model);
  const inputRate =
    row.speed === "fast" && rule && rule.fast_input_per_mtok != null
      ? rule.fast_input_per_mtok
      : rule && rule.input_per_mtok;
  const outputRate =
    row.speed === "fast" && rule && rule.fast_output_per_mtok != null
      ? rule.fast_output_per_mtok
      : rule && rule.output_per_mtok;
  const usd = rule
    ? (p.input / 1_000_000) * Number(inputRate || 0) +
      (p.output / 1_000_000) * Number(outputRate || 0) +
      (p.cacheRead / 1_000_000) * Number(rule.cache_read_per_mtok || 0) +
      (p.cacheWrite5m / 1_000_000) * Number(rule.cache_write_per_mtok || 0) +
      (p.cacheWrite1h / 1_000_000) * Number(rule.cache_write_1h_per_mtok || 0)
    : 0;
  return {
    tokens: p.input + p.output + p.cacheRead + p.cacheWrite,
    usd,
    vnd: Math.round(usd * VND_PER_USD),
    priced: Boolean(rule),
  };
}

function pct(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function kpi({ department_id, range = "7d" } = {}) {
  const win = rangeWindow(range);
  const deptWhere = department_id ? " AND t.department_id=@department_id" : "";
  const params = { department_id, from: win.from, to: win.to };

  const approval = db
    .prepare(
      `SELECT AVG((julianday(a.decided_at) - julianday(a.created_at)) * 24) avg_hours,
              COUNT(*) decided
       FROM approvals a
       JOIN tasks t ON t.id=a.task_id
       WHERE a.decided_at IS NOT NULL
         AND a.decided_at>=@from AND a.decided_at<=@to${deptWhere}`
    )
    .get(params);

  const completion = db
    .prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done
       FROM tasks t
       WHERE t.created_at>=@from AND t.created_at<=@to
         AND t.status!='archived'${deptWhere}`
    )
    .get(params);

  const quality = db
    .prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN a.status='approved' THEN 1 ELSE 0 END) passed
       FROM approvals a
       JOIN tasks t ON t.id=a.task_id
       WHERE a.approval_type='artifact'
         AND a.status IN ('approved','needs_changes','rejected')
         AND COALESCE(a.decided_at, a.updated_at, a.created_at)>=@from
         AND COALESCE(a.decided_at, a.updated_at, a.created_at)<=@to${deptWhere}`
    )
    .get(params);

  const cost = costBreakdown({ department_id, from: win.from, to: win.to });

  return {
    range: win.range,
    from: win.from,
    to: win.to,
    approval_turnaround_avg_hours: round1(approval.avg_hours),
    approval_decided_count: Number(approval.decided || 0),
    task_completion_rate_7d: pct(Number(completion.done || 0), Number(completion.total || 0)),
    task_completion_done: Number(completion.done || 0),
    task_completion_total: Number(completion.total || 0),
    quality_pass_rate: pct(Number(quality.passed || 0), Number(quality.total || 0)),
    quality_passed: Number(quality.passed || 0),
    quality_total: Number(quality.total || 0),
    cost,
    verified: [
      {
        item: "approval_turnaround",
        source: "approvals.created_at + approvals.decided_at",
        status: Number(approval.decided || 0) > 0 ? "real" : "empty",
      },
      {
        item: "completion_rate_7d",
        source: "tasks.status + tasks.created_at",
        status: Number(completion.total || 0) > 0 ? "real" : "empty",
      },
      {
        item: "quality_pass_rate",
        source: "approvals.approval_type='artifact'",
        status: Number(quality.total || 0) > 0 ? "real" : "empty",
      },
      {
        item: "cost_by_agent_task",
        source: "task_runs.engine_session_id -> token_usage.session_id",
        status: cost.token_usage_rows > 0 ? "real" : "empty",
      },
    ],
  };
}

function costBreakdown({ department_id, from, to }) {
  const deptWhere = department_id ? " AND t.department_id=@department_id" : "";
  const rows = db
    .prepare(
      `SELECT t.id task_id, t.title task_title,
              ap.id agent_id, ap.display_name agent_name,
              r.id run_id, r.engine_session_id,
              tu.*
       FROM task_runs r
       JOIN tasks t ON t.id=r.task_id
       LEFT JOIN agent_profiles ap ON ap.id=r.agent_id
       JOIN token_usage tu ON tu.session_id=r.engine_session_id
       WHERE COALESCE(r.completed_at, r.started_at)>=@from
         AND COALESCE(r.completed_at, r.started_at)<=@to${deptWhere}`
    )
    .all({ department_id, from, to });

  const byAgent = new Map();
  const byTask = new Map();
  let tokens = 0;
  let usd = 0;
  let unpricedRows = 0;

  for (const row of rows) {
    const priced = priceUsage(row);
    tokens += priced.tokens;
    usd += priced.usd;
    if (!priced.priced) unpricedRows++;

    const agentKey = row.agent_id || "unknown-agent";
    const agent = byAgent.get(agentKey) || {
      agent_id: row.agent_id,
      agent_name: row.agent_name || "Không rõ agent",
      tokens: 0,
      usd: 0,
      vnd: 0,
      runs: new Set(),
    };
    agent.tokens += priced.tokens;
    agent.usd += priced.usd;
    agent.vnd = Math.round(agent.usd * VND_PER_USD);
    agent.runs.add(row.run_id);
    byAgent.set(agentKey, agent);

    const task = byTask.get(row.task_id) || {
      task_id: row.task_id,
      task_title: row.task_title,
      tokens: 0,
      usd: 0,
      vnd: 0,
      runs: new Set(),
    };
    task.tokens += priced.tokens;
    task.usd += priced.usd;
    task.vnd = Math.round(task.usd * VND_PER_USD);
    task.runs.add(row.run_id);
    byTask.set(row.task_id, task);
  }

  const missingEngineSessions = db
    .prepare(
      `SELECT COUNT(*) n
       FROM task_runs r
       JOIN tasks t ON t.id=r.task_id
       LEFT JOIN token_usage tu ON tu.session_id=r.engine_session_id
       WHERE COALESCE(r.completed_at, r.started_at)>=@from
         AND COALESCE(r.completed_at, r.started_at)<=@to
         AND (r.engine_session_id IS NULL OR tu.session_id IS NULL)${deptWhere}`
    )
    .get({ department_id, from, to }).n;

  const finalize = (item) => ({ ...item, runs: item.runs.size });
  return {
    source: "token_usage",
    token_usage_rows: rows.length,
    missing_engine_sessions: Number(missingEngineSessions || 0),
    unpriced_rows: unpricedRows,
    total_tokens: tokens,
    total_usd: Math.round(usd * 10000) / 10000,
    total_vnd: Math.round(usd * VND_PER_USD),
    by_agent: Array.from(byAgent.values())
      .map(finalize)
      .sort((a, b) => b.tokens - a.tokens),
    by_task: Array.from(byTask.values())
      .map(finalize)
      .sort((a, b) => b.tokens - a.tokens),
  };
}

module.exports = { kpi, costBreakdown, rangeWindow };
