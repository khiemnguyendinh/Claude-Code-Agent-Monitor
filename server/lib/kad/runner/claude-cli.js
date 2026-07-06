/**
 * @file server/lib/kad/runner/claude-cli.js — ClaudeCliAdapter (V1, MVP).
 * Spawns `claude -p` headless, one turn to process exit (turn-based, spec 04 §3).
 * Parses stream-json for engine session id, streamed text, final result + tokens.
 * Reuses monitor conventions (stream-json --verbose) so hooks still fire and the
 * run shows up as a monitor session automatically (engine_session_id bridges).
 */
const { spawn } = require("node:child_process");
const { registerAdapter } = require("./adapter");

const CLAUDE_BIN = process.env.KAD_CLAUDE_BIN || "claude";
const RUN_TIMEOUT_MS = Number(process.env.KAD_RUN_TIMEOUT_MS || 15 * 60 * 1000);

// Permission modes the composer may pick (mirrors run-spawner's ALLOWED set).
// Anything else falls back to the historical default 'acceptEdits'.
const ALLOWED_PERMISSION_MODES = new Set(["default", "acceptEdits", "bypassPermissions", "plan"]);

/**
 * Strip host-managed auth vars so the child authenticates from filesystem/keychain
 * OAuth (`claude login`) or ANTHROPIC_API_KEY — same intent as run-spawner's
 * cleanSpawnEnv. Without a standalone-usable credential the child 401s (documented
 * Phase 1 auth blocker).
 *
 * When launched INSIDE a host-brokered launcher (Cowork/desktop app — detected via
 * its marker vars), that launcher's OAuth is refreshed by the host and only valid
 * against its proxy (ANTHROPIC_BASE_URL); a standalone subprocess can't refresh it
 * and 401s. So in that case we also drop the proxy + brokered-OAuth vars, letting
 * the child fall back to the user's own `claude login` credentials against the real
 * API. Standalone servers (markers absent) keep any legitimately-set base URL.
 * Override the heuristic with KAD_CLAUDE_KEEP_ENV=1.
 */
function spawnEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST;
  const hostBrokered =
    process.env.CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH ||
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST ||
    process.env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop";
  if (hostBrokered && process.env.KAD_CLAUDE_KEEP_ENV !== "1" && !process.env.ANTHROPIC_API_KEY) {
    for (const k of Object.keys(env)) {
      if (
        k.startsWith("CLAUDE_CODE") ||
        k === "ANTHROPIC_BASE_URL" ||
        k === "CLAUDE_AGENT_SDK_VERSION"
      ) {
        delete env[k];
      }
    }
  }
  return env;
}

function buildArgv(req) {
  const argv = ["-p", req.userMessage, "--output-format", "stream-json", "--verbose"];
  if (req.systemPrompt) argv.push("--append-system-prompt", req.systemPrompt);
  if (req.mcpConfigPath) argv.push("--mcp-config", req.mcpConfigPath, "--strict-mcp-config");
  if (Array.isArray(req.mcpTools) && req.mcpTools.length)
    argv.push("--allowedTools", req.mcpTools.join(","));
  argv.push("--max-turns", String(req.maxTurns || 30));
  // Per-task run config (kad-007). model/effort omitted when unset → engine picks
  // its default. permission_mode keeps the historical 'acceptEdits' default.
  if (req.model) argv.push("--model", req.model);
  if (req.effort) argv.push("--effort", req.effort);
  argv.push(
    "--permission-mode",
    ALLOWED_PERMISSION_MODES.has(req.permissionMode) ? req.permissionMode : "acceptEdits"
  );
  if (req.resumeSessionId) argv.push("--resume", req.resumeSessionId);
  return argv;
}

const adapter = {
  engine: "claude",

  async probe() {
    return new Promise((resolve) => {
      const child = spawn(CLAUDE_BIN, ["--version"], { env: spawnEnv() });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("error", () => resolve({ available: false, version: "" }));
      child.on("close", (code) => resolve({ available: code === 0, version: out.trim() }));
    });
  },

  /**
   * Run a single turn to completion. Resolves with RunResult; never rejects on a
   * non-zero exit (that becomes {exitCode, error}) so the orchestrator can decide.
   * @param {import('./adapter').RunRequest} req
   * @param {(e:object)=>void} [onEvent]
   */
  run(req, onEvent = () => {}) {
    return new Promise((resolve) => {
      const argv = buildArgv(req);
      const child = spawn(CLAUDE_BIN, argv, {
        cwd: req.cwd || process.cwd(),
        env: spawnEnv(req.env),
      });
      let engineSessionId = null;
      let output = "";
      let tokens = null;
      let stderr = "";
      let buf = "";
      let settled = false;

      // Hung-process WATCHDOG — NOT the cost circuit breaker. The spec's "never
      // hard-kill a running turn" applies to BUDGET guardrails (which only ever
      // block the next spawn boundary, spec 04 §3). This is a last-resort reaper
      // for a claude process that has genuinely wedged (default 15 min ≫ any real
      // turn). Safe under turn-based: every durable action was already committed to
      // the DB via an MCP tool call before this fires, so a killed turn loses only
      // re-derivable in-flight reasoning, never persisted state. Tune via
      // KAD_RUN_TIMEOUT_MS. SIGTERM first, then SIGKILL if it ignores it.
      let killTimer = null;
      const timer = setTimeout(() => {
        if (!settled) {
          try {
            child.kill("SIGTERM");
          } catch {
            /* already gone */
          }
          killTimer = setTimeout(() => {
            try {
              if (!settled) child.kill("SIGKILL");
            } catch {
              /* already gone */
            }
          }, 5000);
          if (killTimer.unref) killTimer.unref();
        }
      }, RUN_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          handleEnvelope(ev);
        }
      });
      child.stderr.on("data", (d) => (stderr += d.toString()));

      function handleEnvelope(ev) {
        if (ev.type === "system" && ev.subtype === "init" && ev.session_id) {
          engineSessionId = ev.session_id;
          onEvent({ type: "run.started", engineSessionId });
        } else if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) {
            if (c.type === "text" && c.text) onEvent({ type: "text.delta", text: c.text });
            else if (c.type === "tool_use")
              onEvent({ type: "tool.called", name: c.name, input: c.input });
          }
        } else if (ev.type === "result") {
          if (typeof ev.result === "string") output = ev.result;
          if (ev.usage) tokens = normalizeUsage(ev.usage);
          if (ev.session_id && !engineSessionId) engineSessionId = ev.session_id;
        }
      }

      child.on("error", (err) => finish(1, err.message));
      child.on("close", (code) => finish(code == null ? 1 : code));

      function finish(exitCode, spawnErr) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        const authFail =
          /401|authenticate|credentials/i.test(output) ||
          /401|authenticate|credentials/i.test(stderr);
        const error =
          spawnErr ||
          (exitCode !== 0
            ? stderr.trim().slice(-500) || output.slice(-500) || `exit ${exitCode}`
            : undefined);
        if (error) onEvent({ type: "run.failed", error });
        else onEvent({ type: "run.completed", output, tokens });
        resolve({ engineSessionId, output, tokens, exitCode, error, authFail });
      }
    });
  },
};

function normalizeUsage(usage) {
  const input =
    Number(usage.input_tokens || 0) +
    Number(usage.cache_read_input_tokens || 0) +
    Number(usage.cache_creation_input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  return { input, output, total: input + output, raw: usage };
}

registerAdapter(adapter);
module.exports = adapter;
