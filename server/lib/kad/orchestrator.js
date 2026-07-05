/**
 * @file server/lib/kad/orchestrator.js — turn-based run lifecycle (spec 04 §3).
 *
 * A run is ONE short turn to process exit. State lives in the TASK/DB, never in a
 * held process. Resume = a fresh `claude --resume` turn enqueued via kad_job_queue.
 * Guardrails (cost circuit breaker) run before EVERY spawn. Each state change is
 * audited in the same transaction. MCP tool writes come back through the internal
 * HTTP API (single writer), so the orchestrator here only owns spawn + turn-end.
 */
const fs = require("node:fs");
const path = require("node:path");
const repo = require("./repo");
const guardrails = require("./guardrails");
const prompts = require("./prompts");
const workflowEngine = require("./workflow-engine");
const { getAdapter } = require("./runner/adapter");
require("./runner/claude-cli"); // self-registers the 'claude' adapter
const { emitTask } = require("./events");
const { getInternalToken } = require("./internal-auth");
const { getDataDir } = require("../claude-home");

// API base the spawned MCP server calls back on. Set from index.js after listen.
let API_BASE = process.env.KAD_API_BASE || "http://127.0.0.1:4820";
function setApiBase(url) {
  if (url) API_BASE = url;
}

const MCP_SERVER = path.join(__dirname, "..", "..", "..", "mcp", "kad-tools-server.mjs");

// Map an agent's permissions → the KAD MCP tools it may call (mcp__kad__<tool>).
function mcpToolsFor(agent) {
  const p = agent.permissions || {};
  const tools = ["kad_report_progress", "kad_save_artifact"];
  if (agent.agent_type === "main") {
    tools.push(
      "kad_plan_task",
      "kad_request_approval",
      "kad_create_delegation",
      "kad_get_delegation_result",
      "kad_ask_intake",
      "kad_propose_brief",
      "kad_present_report"
    );
  } else {
    tools.push("kad_request_approval");
  }
  if (p.read_org_context) tools.push("kad_read_org_context");
  if (p.read_templates) tools.push("kad_read_template");
  if (p.web_search) tools.push("kad_web_search");
  if (p.flag_sensitivity) tools.push("kad_flag_sensitivity"); // quality reviewer (spec 04 §2)
  return [...new Set(tools)].map((t) => `mcp__kad__${t}`);
}

// Write a per-run MCP config pointing at the KAD tools server, with run context
// injected via env so the tools know who is calling (enforced server-side too).
function writeMcpConfig(runContext) {
  const dir = path.join(getDataDir(), "kad-runs", runContext.runId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cfg = {
    mcpServers: {
      kad: {
        command: process.execPath, // current node
        args: [MCP_SERVER],
        env: {
          KAD_API_BASE: API_BASE,
          KAD_INTERNAL_TOKEN: getInternalToken(),
          KAD_RUN_ID: runContext.runId,
          KAD_TASK_ID: runContext.taskId,
          KAD_AGENT_ID: runContext.agentId,
        },
      },
    },
  };
  const p = path.join(dir, "mcp-config.json");
  // 0600 — the file carries the internal token; owner-only, and cleanupRunDir()
  // removes it as soon as the turn ends.
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* best-effort on platforms without chmod */
  }
  return { path: p, dir };
}

/** Remove a per-run MCP config dir (scrubs the plaintext internal token). */
function cleanupRunDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort — a leftover dir is retried-clean on next boot sweep */
  }
}

/**
 * Spawn a single agent turn. Handles guardrail, run row, mcp config, adapter run,
 * token accounting, and turn-end classification (waiting_approval vs completed).
 */
async function spawnAgentRun({
  task,
  agent,
  systemPrompt,
  userMessage,
  resumeSessionId,
  isDelegation = false,
}) {
  // Single-flight per task, BEFORE the guardrail (spec 04 §3 step 2a). A human
  // (or fast UI automation) can reply to an intake_question/chip the instant it
  // renders — but `kad.message.created` for that question and the spawning
  // process actually EXITING are two separate async events, so the reply's
  // resume can be triggered while the PREVIOUS turn's `claude --resume
  // <sameSessionId>` is still alive. Two processes resuming the SAME engine
  // session concurrently is undefined/corrupting (observed live: token usage
  // ballooning past the per-task cap, and the earlier turn's own resume_task
  // job staying 'leased' long after its work should have finished). Wait for
  // any in-flight run on THIS task to settle before spawning another —
  // max_concurrent_runs (below) caps the GLOBAL count, not per-task, so it
  // does not catch this case.
  for (let i = 0; i < 20; i++) {
    const active = repo.runs
      .listByTask(task.id)
      .some((r) => r.status === "running" || r.status === "pending");
    if (!active) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // GUARDRAIL FIRST (spec 04 §3 step 2a). Node is single-threaded and better-sqlite3
  // is synchronous: this check() and the createRun below run with NO await between
  // them, so they are atomic w.r.t. other turns — no TOCTOU window on the caps.
  const gate = guardrails.check(task.id, { isDelegation });
  if (!gate.ok) {
    guardrails.trip(task.id, gate.reason);
    return { blocked: true, reason: gate.reason };
  }

  // Create run + move it to 'running' + task→doing + audit in ONE transaction, so a
  // crash can't leave a 'pending' run against an already-'doing' task (state invariant).
  const run = repo.runs.createRun({
    task_id: task.id,
    agent_id: agent.id,
    engine: agent.engine || "claude",
    input: { userMessage, resume: !!resumeSessionId },
  });
  repo.tx(() => {
    repo.runs.updateRun(run.id, { status: "running" });
    repo.tasks.updateTask(task.id, { status: "doing" });
    repo.audit({
      department_id: task.department_id,
      task_id: task.id,
      agent_id: agent.id,
      action: "run_started",
      actor_type: "agent",
      actor_id: agent.id,
      target_type: "run",
      target_id: run.id,
      details: { resume: !!resumeSessionId },
    });
  });
  emitTask(task.id, "kad.run.status", { run_id: run.id, task_id: task.id, status: "running" });

  const { path: mcpConfigPath, dir: runDir } = writeMcpConfig({
    runId: run.id,
    taskId: task.id,
    agentId: agent.id,
  });
  const adapter = getAdapter(agent.engine || "claude");
  const approvalsBeforeCount = repo.approvals.listByTask(task.id).length;

  let result;
  try {
    result = await adapter.run(
      {
        runId: run.id,
        agentProfile: agent,
        systemPrompt,
        userMessage,
        resumeSessionId,
        mcpTools: mcpToolsFor(agent),
        mcpConfigPath,
        maxTurns: gate.maxTurns,
        cwd: task.working_dir || undefined,
      },
      (ev) => onRunEvent(run.id, task.id, ev)
    );
  } finally {
    // Scrub the per-run MCP config dir (holds the internal token) the moment the
    // turn ends — no plaintext credential left on disk after the process exits.
    cleanupRunDir(runDir);
  }

  // Persist engine session id (bridge to monitor trace) + tokens.
  if (result.engineSessionId) repo.runs.setEngineSession(run.id, result.engineSessionId);

  // Turn-end classification: the turn ended at an approval boundary iff this turn
  // created a NEW approval that a HUMAN must decide. Two subtleties:
  //  - Use the count delta + slice (not pending-presence) so a fast human deciding
  //    the approval between these reads can't misclassify the turn as 'completed'
  //    and skip the resume — a human approval that was just decided still has
  //    reviewer='human', so it is still counted here (durable-marker correctness).
  //  - IGNORE reviewer='system' auto-approvals (workflow-engine, spec 01 §4.2):
  //    an auto-approved slide/video/internal artifact created mid-turn must NOT
  //    park the task — the turn continues/completes normally.
  // Only this run writes approvals for this task (single-flight above), so the new
  // rows are exactly the tail past approvalsBeforeCount.
  const approvalsAfter = repo.approvals.listByTask(task.id);
  const humanApproval = approvalsAfter
    .slice(approvalsBeforeCount)
    .find((a) => a.reviewer !== "system");
  const createdApproval = !!humanApproval;
  const boundaryApproval = humanApproval || repo.approvals.latestPending(task.id);

  if (result.error) {
    repo.tx(() => {
      repo.runs.updateRun(run.id, {
        status: "failed",
        output: { error: result.error },
        tokens_used: result.tokens,
        engine_session_id: result.engineSessionId,
      });
      repo.audit({
        department_id: task.department_id,
        task_id: task.id,
        agent_id: agent.id,
        action: "run_completed",
        actor_type: "agent",
        actor_id: agent.id,
        target_type: "run",
        target_id: run.id,
        details: {
          status: "failed",
          authFail: !!result.authFail,
          error: String(result.error).slice(0, 300),
        },
      });
    });
    emitTask(task.id, "kad.run.status", { run_id: run.id, task_id: task.id, status: "failed" });
    return { run, result, failed: true };
  }

  if (createdApproval) {
    // Turn ended at an approval boundary — durable marker; process already exited.
    repo.tx(() => {
      repo.runs.updateRun(run.id, {
        status: "waiting_approval",
        output: { text: result.output },
        tokens_used: result.tokens,
      });
      repo.tasks.updateTask(task.id, { status: "waiting_human" });
      repo.audit({
        department_id: task.department_id,
        task_id: task.id,
        agent_id: agent.id,
        action: "run_completed",
        actor_type: "agent",
        actor_id: agent.id,
        target_type: "run",
        target_id: run.id,
        details: {
          status: "waiting_approval",
          approval_id: boundaryApproval && boundaryApproval.id,
        },
      });
    });
    emitTask(task.id, "kad.run.status", {
      run_id: run.id,
      task_id: task.id,
      status: "waiting_approval",
    });
    return { run, result, waitingApproval: boundaryApproval };
  }

  repo.tx(() => {
    repo.runs.updateRun(run.id, {
      status: "completed",
      output: { text: result.output },
      tokens_used: result.tokens,
    });
    repo.audit({
      department_id: task.department_id,
      task_id: task.id,
      agent_id: agent.id,
      action: "run_completed",
      actor_type: "agent",
      actor_id: agent.id,
      target_type: "run",
      target_id: run.id,
      details: { status: "completed" },
    });
  });
  emitTask(task.id, "kad.run.status", { run_id: run.id, task_id: task.id, status: "completed" });
  return { run, result, completed: true };
}

function onRunEvent(runId, taskId, ev) {
  if (ev.type === "run.started") {
    repo.runs.setEngineSession(runId, ev.engineSessionId);
  } else if (ev.type === "text.delta") {
    emitTask(taskId, "kad.run.output", { run_id: runId, chunk: ev.text });
  } else if (ev.type === "tool.called") {
    emitTask(taskId, "kad.run.output", { run_id: runId, tool: ev.name });
  }
}

// ---- public entrypoints ----

/** Human sent the first/next message on a task → kick a Main Agent turn. */
async function startTaskTurn(taskId) {
  const task = repo.tasks.getTask(taskId);
  if (!task) throw new Error("task not found");
  const main = repo.catalog.getMainAgent(task.department_id);
  if (!main) throw new Error("no active main agent for department");
  const systemPrompt = prompts.buildSystemPrompt(task.department_id);
  const lastHuman = repo.tasks
    .listMessages(taskId)
    .filter((m) => m.sender_type === "human")
    .pop();
  const userMessage = prompts.buildPlanningMessage({
    userGoal: (lastHuman && lastHuman.content) || task.title,
    additionalContext: task.description || "",
    defaultWorkflow: "rd-standard-flow",
  });
  return spawnAgentRun({ task, agent: main, systemPrompt, userMessage });
}

/** Resume a task after an approval decision (turn-based; called by worker). */
async function resumeTaskTurn(taskId, { message, engineSessionId } = {}) {
  const task = repo.tasks.getTask(taskId);
  if (!task) throw new Error("task not found");
  const main = repo.catalog.getMainAgent(task.department_id);
  const systemPrompt = prompts.buildSystemPrompt(task.department_id);
  // Belt-and-braces state summary (Phase 1 spike decision: assume LOW resume
  // fidelity until measured — always render current state alongside the decision).
  // The summary is declared the SOURCE OF TRUTH so that if two resume triggers
  // (approval decided + delegation done) coalesce under one dedup key, the single
  // resume turn still re-derives everything from current DB state — no lost wakeup.
  const summary = renderStateSummary(task);
  const resumeSid = engineSessionId || lastEngineSession(taskId, main.id);
  const userMessage = `${message || "Trạng thái công việc vừa thay đổi."}\n\n--- Trạng thái hiện tại (NGUỒN SỰ THẬT — dựa vào đây, có thể đã có nhiều thay đổi) ---\n${summary}`;
  return spawnAgentRun({
    task,
    agent: main,
    systemPrompt,
    userMessage,
    resumeSessionId: resumeSid,
  });
}

/** Run a delegation (sub-agent turn); called by worker (start_delegation). */
async function runDelegation(delegationId) {
  const deleg = repo.delegations.getDelegation(delegationId);
  if (!deleg) throw new Error("delegation not found");
  const task = repo.tasks.getTask(deleg.task_id);
  const sub = repo.catalog.getAgent(deleg.to_agent_id);
  if (!sub) throw new Error("sub agent not found");

  const org = repo.catalog.getCurrentOrgContext(
    task && task.department_id ? repo.catalog.getDepartment(task.department_id).org_id : null
  );
  // On a workflow task, tell the sub-agent EXACTLY which artifact_type to save
  // (spec 01 §3.1 roster output) + hand it the matching approved template, so the
  // artifact it produces is correctly typed for the QC/auto-approve gates. Falls
  // back to the old research/other heuristic for freeform tasks.
  const artifactType =
    workflowEngine.outputTypeForAgent(task, sub) ||
    (sub.name.includes("researcher") ? "research_report" : "other");
  const tpl =
    sub.permissions.read_templates && artifactType !== "other"
      ? repo.catalog.getApprovedTemplateByType(task.department_id, artifactType)
      : null;
  const systemPrompt = `Bạn là ${sub.display_name} thuộc phòng R&D Kstudy. ${sub.role_description || ""} Luôn dùng tiếng Việt. Chỉ hành động qua tool KAD được cấp.`;
  const userMessage = prompts.buildDelegationPrompt({
    subAgent: sub,
    taskDescription: deleg.instruction,
    taskInputs: task.title,
    templateContent: tpl ? tpl.version.content : "",
    orgContextSummary: org ? prompts.summarizeOrgContext(org.data) : "",
    artifactType,
    outputFormat: "markdown",
  });

  repo.delegations.updateDelegation(delegationId, { status: "running" });
  emitTask(task.id, "kad.delegation.status", { ...repo.delegations.getDelegation(delegationId) });

  const outcome = await spawnAgentRun({
    task,
    agent: sub,
    systemPrompt,
    userMessage,
    isDelegation: true,
  });
  if (outcome.blocked) {
    repo.delegations.updateDelegation(delegationId, { status: "failed" });
    return outcome;
  }

  // Link the run + newest artifact this delegation produced.
  const arts = repo.artifacts
    .listArtifacts({ task_id: task.id })
    .filter((a) => a.agent_id === sub.id);
  const newestArt = arts[arts.length - 1];
  const status = outcome.failed ? "failed" : "done";
  repo.tx(() => {
    repo.delegations.updateDelegation(delegationId, {
      status,
      run_id: outcome.run && outcome.run.id,
      output_artifact_id: newestArt && newestArt.id,
    });
    repo.audit({
      department_id: task.department_id,
      task_id: task.id,
      agent_id: sub.id,
      action: "delegation_created",
      actor_type: "system",
      actor_id: "orchestrator",
      target_type: "delegation",
      target_id: delegationId,
      details: { status, artifact_id: newestArt && newestArt.id },
    });
  });
  emitTask(task.id, "kad.delegation.status", { ...repo.delegations.getDelegation(delegationId) });

  // Turn-based: hand result back to main via a fresh resume turn.
  if (!outcome.failed) {
    repo.jobs.enqueue({
      kind: "resume_task",
      payload: {
        task_id: task.id,
        message: `Nghiên cứu của ${sub.display_name} đã xong (artifact ${newestArt ? newestArt.id : "?"}). Hãy tổng hợp và xin duyệt nếu cần.`,
      },
      dedupKey: `resume:${task.id}`,
    });
  } else {
    // retry ≤2 then escalate to main
    const rc = (deleg.retry_count || 0) + 1;
    if (rc <= 2) {
      repo.delegations.updateDelegation(delegationId, { status: "pending", retry_count: rc });
      repo.jobs.enqueue({
        kind: "start_delegation",
        payload: { delegation_id: delegationId },
        runAfter: new Date(Date.now() + 3000).toISOString(),
      });
    } else {
      repo.jobs.enqueue({
        kind: "resume_task",
        payload: {
          task_id: task.id,
          message: `Delegation cho ${sub.display_name} thất bại sau ${rc} lần. Hãy quyết định escalate hay hỏi trưởng phòng.`,
        },
        dedupKey: `resume:${task.id}`,
      });
    }
  }
  return outcome;
}

/** Startup crash recovery: orphan running/pending runs → failed (spec 04 §4).
 * Also un-sticks the owning task: a task left 'doing' by a dead run is parked at
 * 'waiting_human' so a human notices (never silently stuck 'doing'). Leftover
 * per-run MCP config dirs (plaintext token) from before the crash are swept. */
function reconcileRuns() {
  const orphans = repo.runs.listUnfinished();
  for (const r of orphans) {
    repo.tx(() => {
      repo.runs.updateRun(r.id, {
        status: "failed",
        output: { error: "reconciled: process not alive after restart" },
      });
      const task = r.task_id && repo.tasks.getTask(r.task_id);
      if (task && task.status === "doing")
        repo.tasks.updateTask(task.id, { status: "waiting_human" });
      repo.audit({
        task_id: r.task_id,
        agent_id: r.agent_id,
        action: "run_completed",
        actor_type: "system",
        actor_id: "reconcile",
        target_type: "run",
        target_id: r.id,
        details: {
          status: "failed",
          reason: "orphan_reconciled",
          task_reset: !!(task && task.status === "doing"),
        },
      });
    });
    cleanupRunDir(path.join(getDataDir(), "kad-runs", r.id));
  }
  return orphans.length;
}

// ---- helpers ----
function lastEngineSession(taskId, agentId) {
  const runs = repo.runs
    .listByTask(taskId)
    .filter((r) => r.agent_id === agentId && r.engine_session_id);
  return runs.length ? runs[runs.length - 1].engine_session_id : undefined;
}

function renderStateSummary(task) {
  const arts = repo.artifacts.listArtifacts({ task_id: task.id });
  const apprs = repo.approvals.listByTask(task.id);
  return [
    `Công việc: ${task.title}`,
    `Trạng thái: ${task.status}`,
    `Duyệt: ${apprs.map((a) => `${a.approval_type}=${a.status}`).join(", ") || "(chưa có)"}`,
    `Artifact: ${arts.map((a) => `${a.artifact_type}(${a.status})`).join(", ") || "(chưa có)"}`,
  ].join("\n");
}

module.exports = {
  setApiBase,
  startTaskTurn,
  resumeTaskTurn,
  runDelegation,
  reconcileRuns,
  spawnAgentRun,
  mcpToolsFor,
};
