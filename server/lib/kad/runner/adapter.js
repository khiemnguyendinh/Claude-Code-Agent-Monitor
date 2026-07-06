/**
 * @file server/lib/kad/runner/adapter.js — RunnerAdapter contract (engine-agnostic).
 * The orchestrator only ever talks to this shape; it never knows engine details
 * (spec 04 §1). Writing engine specifics into the orchestrator breaks Phase 8.
 *
 * @typedef {Object} RunRequest
 * @property {string} runId
 * @property {object} agentProfile        - to build system prompt + tool allowlist
 * @property {string} systemPrompt        - rendered server-side
 * @property {string} userMessage
 * @property {string} [resumeSessionId]   - continue a prior engine session (--resume)
 * @property {string[]} mcpTools          - subset of KAD tools this run may call
 * @property {string} mcpConfigPath       - path to the KAD MCP config JSON
 * @property {number} [maxTurns]
 * @property {string} [cwd]
 * @property {string} [model]             - --model override (kad-007; unset → engine default)
 * @property {string} [effort]            - --effort / thinking level (kad-007; unset → model default)
 * @property {string} [permissionMode]    - --permission-mode (kad-007; unset → 'acceptEdits')
 * @property {object} [env]               - extra env (KAD_RUN_ID/TASK_ID/AGENT_ID/API_BASE/TOKEN)
 *
 * @typedef {Object} RunResult
 * @property {string} [engineSessionId]
 * @property {string} output
 * @property {object|null} tokens
 * @property {number} exitCode
 * @property {string} [error]
 *
 * A RunnerAdapter exposes:
 *   engine: 'claude'|'codex'|'antigravity'
 *   probe(): Promise<{available:boolean, version:string}>
 *   run(req: RunRequest, onEvent): Promise<RunResult>   // spawn a single turn to completion
 *
 * NOTE: turn-based (spec 04 §3) — a "turn" runs to process exit. There is no
 * long-lived handle held across an approval wait; resume is a fresh run() with
 * resumeSessionId. onEvent receives NormalizedRunEvent objects:
 *   {type:'run.started', engineSessionId}
 *   {type:'text.delta', text}
 *   {type:'tool.called', name, input}
 *   {type:'run.completed', output, tokens}
 *   {type:'run.failed', error}
 */

/** Registry so the orchestrator can pick an adapter by engine enum. */
const adapters = new Map();
function registerAdapter(adapter) {
  adapters.set(adapter.engine, adapter);
}
function getAdapter(engine) {
  const a = adapters.get(engine);
  if (!a) throw new Error(`No RunnerAdapter registered for engine '${engine}'`);
  return a;
}

module.exports = { registerAdapter, getAdapter };
