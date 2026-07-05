/**
 * @file server/lib/kad/cost.js — round-cost estimate for Report Card (spec 07
 * §4, format per spec/ui/06-components.md §13). NOT a billing ledger — a
 * display estimate for the human: duration + tokens (real, from task_runs) +
 * an approximate VND cost. Rate lookup reuses the monitor's own
 * `model_pricing` table (server/db.js DEFAULT_PRICING, real Anthropic list
 * prices) when the agent's `model` matches a seeded pattern; otherwise falls
 * back to the Claude Sonnet 5 listed rate (the flagship default) — never a
 * made-up number. USD→VND uses a single documented, env-overridable rate.
 */
const repo = require("./repo");
const { tokenTotal } = require("./guardrails");

// Fallback when the run's agent has no `model` matching a model_pricing row
// (Phase 1 seed does not set agent_profiles.model). Mirrors the
// "claude-sonnet-5%" row in server/db.js DEFAULT_PRICING ($/Mtok).
const FALLBACK_INPUT_PER_MTOK = 3;
const FALLBACK_OUTPUT_PER_MTOK = 15;

// Display-only estimate; not an accounting rate. Override with KAD_VND_PER_USD
// if the organization wants a specific rate reflected in the UI.
const VND_PER_USD = Number(process.env.KAD_VND_PER_USD) || 26000;

function ratesForModel(model) {
  if (model) {
    const rows = repo.db.prepare("SELECT * FROM model_pricing").all();
    const rule = rows
      .filter((r) => new RegExp("^" + r.model_pattern.replace(/%/g, ".*") + "$").test(model))
      .sort((a, b) => b.model_pattern.length - a.model_pattern.length)[0];
    if (rule) return { input: rule.input_per_mtok, output: rule.output_per_mtok };
  }
  return { input: FALLBACK_INPUT_PER_MTOK, output: FALLBACK_OUTPUT_PER_MTOK };
}

function runUsd(run) {
  const tokens = run.tokens_used;
  if (!tokens) return 0;
  const agent = run.agent_id && repo.catalog.getAgent(run.agent_id);
  const rates = ratesForModel(agent && agent.model);
  const input = Number(tokens.input_tokens || tokens.input || 0);
  const output = Number(tokens.output_tokens || tokens.output || 0);
  if (!input && !output) return (tokenTotal(tokens) / 1_000_000) * rates.input; // unknown split — price as input
  return (input / 1_000_000) * rates.input + (output / 1_000_000) * rates.output;
}

function runDurationSeconds(run) {
  if (!run.started_at || !run.completed_at) return 0;
  const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime();
  return ms > 0 ? Math.round(ms / 1000) : 0;
}

/**
 * Round-cost estimate for runs on `taskId` started at/after `sinceIso`
 * (exclusive of runs before it) — mirrors the mock's per-round costV1/costV2
 * split by scoping to "since the last brief lock / report".
 * @returns {{durationSeconds:number, tokens:number, usd:number, vnd:number}}
 */
function estimateRoundCost(taskId, sinceIso) {
  const runs = repo.runs.listByTask(taskId).filter((r) => !sinceIso || r.started_at >= sinceIso);
  let tokens = 0;
  let usd = 0;
  let durationSeconds = 0;
  for (const r of runs) {
    tokens += tokenTotal(r.tokens_used);
    usd += runUsd(r);
    durationSeconds += runDurationSeconds(r);
  }
  return { durationSeconds, tokens, usd, vnd: Math.round(usd * VND_PER_USD) };
}

/**
 * Round-cost estimate for a department's runs completed in [fromIso, toIso)
 * (exclusive end) — used by the standup "Hôm qua" line (spec/ui/02 §5). Joins
 * through tasks since task_runs has no department_id column of its own.
 * @returns {{tokens:number, usd:number, vnd:number}}
 */
function estimateDeptCostForRange(departmentId, fromIso, toIso) {
  const rows = repo.db
    .prepare(
      `SELECT r.* FROM task_runs r JOIN tasks t ON r.task_id=t.id
       WHERE t.department_id=? AND r.completed_at IS NOT NULL AND r.completed_at>=? AND r.completed_at<?`
    )
    .all(departmentId, fromIso, toIso);
  let tokens = 0;
  let usd = 0;
  for (const raw of rows) {
    const run = { ...raw, tokens_used: repo.parseJson(raw.tokens_used, null) };
    tokens += tokenTotal(run.tokens_used);
    usd += runUsd(run);
  }
  return { tokens, usd, vnd: Math.round(usd * VND_PER_USD) };
}

module.exports = { estimateRoundCost, estimateDeptCostForRange, VND_PER_USD };
