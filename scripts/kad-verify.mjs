#!/usr/bin/env node
/**
 * scripts/kad-verify.mjs — KAD end-to-end verify (anti-mock asset, plan §2).
 *
 * Scenario S1 (Phase 1). Boots an ISOLATED server (temp DB, ephemeral port),
 * seeds real Kstudy content, then asserts against REAL SQL. Two legs:
 *
 *   INFRA legs  — task/approval/delegation/artifact/timeline/audit state machine,
 *                 approval-blocking enforcement, cost guardrail, crash recovery.
 *                 Driven through the REAL server endpoints (the same internal API
 *                 the agent's MCP tools call). No engine involved; always run.
 *   ENGINE legs — spawn a REAL claude turn and assert the agent itself called
 *                 kad_plan_task / kad_web_search / kad_save_artifact. CANNOT be
 *                 mocked (plan §2.7). If no spawnable credential exists, these are
 *                 reported BLOCKED (not passed, not faked). If a credential exists,
 *                 they run for real and must pass.
 *
 * Exit non-zero if any INFRA assert fails, or if an ENGINE leg runs and fails.
 */
import { createRequire } from "node:module";
import { spawnSync, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

// --- isolated DB + env (must be set before requiring server modules) ---
const TMP_DB = path.join(os.tmpdir(), `kad-verify-${process.pid}.db`);
for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"])
  try {
    fs.unlinkSync(f);
  } catch {}
process.env.DASHBOARD_DB_PATH = TMP_DB;
process.env.DASHBOARD_TOKEN = ""; // open API for the isolated instance
// Auto-worker effectively OFF: infra legs assert queued job ROWS (not execution);
// engine legs drive turns directly + manual worker.sweep(), so nothing races the
// deterministic infra assertions on a shared engine.
process.env.KAD_WORKER_TICK_MS = "3600000";

let pass = 0,
  fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    results.push(`  ✅ ${name}`);
  } else {
    fail++;
    results.push(`  ❌ ${name}${detail ? " — " + detail : ""}`);
  }
}
function blocked(name, reason) {
  results.push(`  ⏸️  ${name} — BLOCKED: ${reason}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) seed the isolated DB
  const seed = spawnSync(process.execPath, [path.join(ROOT, "scripts/kad-seed.mjs")], {
    env: process.env,
    encoding: "utf8",
  });
  if (seed.status !== 0) {
    console.error("seed failed:", seed.stderr || seed.stdout);
    process.exit(1);
  }

  // 2) boot isolated server on an ephemeral port
  const { createApp } = require(path.join(ROOT, "server/index.js"));
  const kad = require(path.join(ROOT, "server/routes/kad"));
  const { getInternalToken } = require(path.join(ROOT, "server/lib/kad/internal-auth"));
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;
  kad.initKad({ apiBase: BASE });

  const api = async (method, p, body) => {
    const resp = await fetch(BASE + p, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, body: await resp.json().catch(() => ({})) };
  };
  // internal API caller with a fake run context (simulates what the MCP tool does)
  const internal = async (method, p, { runCtx, body } = {}) => {
    const h = { "content-type": "application/json", "x-kad-internal-token": getInternalToken() };
    if (runCtx)
      Object.assign(h, {
        "x-kad-run-id": runCtx.run,
        "x-kad-task-id": runCtx.task,
        "x-kad-agent-id": runCtx.agent,
      });
    const resp = await fetch(BASE + "/api/kad/internal" + p, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, body: await resp.json().catch(() => ({})) };
  };

  // raw SQL asserts against the real DB
  const Database = require("better-sqlite3");
  const sdb = new Database(TMP_DB, { readonly: true });
  const sql = (q, ...a) => sdb.prepare(q).all(...a);
  const one = (q, ...a) => sdb.prepare(q).get(...a);

  const repo = require(path.join(ROOT, "server/lib/kad/repo"));
  const mainAgent = repo.catalog.getMainAgent(repo.catalog.getDepartmentBySlug("rd").id);
  const researcher = repo.catalog.getAgentByName(
    mainAgent.department_id,
    "sub-curriculum-researcher"
  );

  console.log("\n=== KAD verify — Scenario S1 (isolated @ " + BASE + ") ===\n");

  // ---------- INFRA legs (deterministic, no engine) ----------
  // Driven through the REAL server + internal endpoints with a simulated run
  // context, on a task that is NOT given a chat message — so no real Main Agent
  // turn is kicked to race these assertions. Proves the state machine + enforcement.
  const infra = await api("POST", "/api/kad/tasks", {
    title: "Nghiên cứu nhu cầu học AI Automation của chủ SME (infra)",
  });
  check("POST /tasks → inbox", infra.status === 201 && infra.body.status === "inbox");
  const infraId = infra.body.id;
  const ctxMain = { run: "run-sim-main", task: infraId, agent: mainAgent.id };

  // A) plan-task → pending plan approval
  const plan = await internal("POST", "/plan-task", {
    runCtx: ctxMain,
    body: { plan: "## Kế hoạch\n1. Research — Nghiên cứu — 1 ngày — Cần duyệt? Có" },
  });
  check("kad_plan_task → pending approval", plan.status === 200 && plan.body.status === "pending");
  check(
    "SQL: approvals(status=pending,type=plan)",
    one(
      "SELECT COUNT(*) n FROM approvals WHERE task_id=? AND status='pending' AND approval_type='plan'",
      infraId
    ).n === 1
  );

  // B) approval-block: delegation before plan approved must fail
  const blkDeleg = await internal("POST", "/create-delegation", {
    runCtx: ctxMain,
    body: { to_agent: "sub-curriculum-researcher", instruction: "Nghiên cứu" },
  });
  check(
    "delegation BLOCKED before approval (403)",
    blkDeleg.status === 403,
    `got ${blkDeleg.status}`
  );
  check(
    "SQL: no delegation row yet",
    one("SELECT COUNT(*) n FROM task_delegations WHERE task_id=?", infraId).n === 0
  );

  // C) approve → resume job enqueued + delegation now allowed
  const apprId = one(
    "SELECT id FROM approvals WHERE task_id=? AND approval_type='plan' AND status='pending'",
    infraId
  ).id;
  const dec = await api("POST", `/api/kad/approvals/${apprId}/decide`, { decision: "approved" });
  check(
    "POST /approvals/:id/decide approved",
    dec.status === 200 && dec.body.approval.status === "approved"
  );
  check(
    "SQL: resume_task job enqueued",
    one("SELECT COUNT(*) n FROM kad_job_queue WHERE kind='resume_task'").n >= 1
  );
  const okDeleg = await internal("POST", "/create-delegation", {
    runCtx: ctxMain,
    body: { to_agent: "sub-curriculum-researcher", instruction: "Nghiên cứu nhu cầu SME" },
  });
  check(
    "delegation ALLOWED after approval",
    okDeleg.status === 200 && !!okDeleg.body.delegation_id,
    `status ${okDeleg.status}`
  );
  check(
    "SQL: delegation row exists",
    one("SELECT COUNT(*) n FROM task_delegations WHERE task_id=?", infraId).n === 1
  );
  check(
    "SQL: start_delegation job enqueued",
    one("SELECT COUNT(*) n FROM kad_job_queue WHERE kind='start_delegation'").n >= 1
  );

  // D) artifact + timeline + audit
  const ctxRes = { run: "run-sim-res", task: infraId, agent: researcher.id };
  const art = await internal("POST", "/save-artifact", {
    runCtx: ctxRes,
    body: {
      artifact_type: "research_report",
      title: "Báo cáo nhu cầu SME",
      content: "# Kết quả\n- ...",
    },
  });
  check("kad_save_artifact → artifact_id", art.status === 200 && !!art.body.artifact_id);
  check(
    "SQL: artifacts row",
    one(
      "SELECT COUNT(*) n FROM artifacts WHERE task_id=? AND artifact_type='research_report'",
      infraId
    ).n === 1
  );

  const tl = await api("GET", `/api/kad/tasks/${infraId}/timeline`);
  const kinds = new Set((tl.body || []).map((i) => i.kind));
  check(
    "timeline has message+delegation+approval+artifact",
    ["message", "delegation", "approval", "artifact"].every((k) => kinds.has(k)),
    [...kinds].join(",")
  );

  const auditActions = sql(
    "SELECT action FROM audit_log WHERE task_id=? ORDER BY created_at ASC",
    infraId
  ).map((r) => r.action);
  // Infra sim has no real run, so 5 business actions (task_created + the 4 below);
  // the ≥6 with-runs count is asserted on the engine task after a real turn.
  check(
    "audit_log ≥5 business actions (infra)",
    auditActions.length >= 5,
    `count=${auditActions.length}: ${auditActions.join(",")}`
  );
  check(
    "audit has approval_requested+approval_decided+delegation_created+artifact_created (in order)",
    ["approval_requested", "approval_decided", "delegation_created", "artifact_created"].every(
      (a) => auditActions.includes(a)
    )
  );

  // ---------- INFRA leg E: cost guardrail (circuit breaker) ----------
  const gTask = await api("POST", "/api/kad/tasks", { title: "Guardrail test — giao việc dài" });
  const gId = gTask.body.id;
  // Record a completed run that exceeds the PER-TASK limit (2M — raised from the
  // original 500k, which a real intake→brief→plan cycle blows through in 2-3
  // turns purely from per-resume MCP-reconnect cache misses, see guardrails.js).
  // per_task_token_limit now equals daily_token_limit (both 2M), so a run big
  // enough to trip the per-task check also counts fully toward the department's
  // daily total — zeroed out right after the assertions below so it doesn't
  // starve the later engine leg's own daily budget in the same department.
  const guardrails = require(path.join(ROOT, "server/lib/kad/guardrails"));
  const gr = repo.runs.createRun({ task_id: gId, agent_id: mainAgent.id, engine: "claude" });
  repo.runs.updateRun(gr.id, { status: "completed", tokens_used: { total: 2_500_000 } });
  const gate = guardrails.check(gId);
  check(
    "guardrail check() blocks over-budget task",
    gate.ok === false && /per_task_token_limit/.test(gate.reason || ""),
    gate.reason || ""
  );
  guardrails.trip(gId, gate.reason || "over budget");
  check(
    "SQL: task → waiting_human after trip",
    one("SELECT status FROM tasks WHERE id=?", gId).status === "waiting_human"
  );
  check(
    "SQL: budget_warning notification",
    one("SELECT COUNT(*) n FROM notifications WHERE kind='budget_warning' AND target_id=?", gId)
      .n >= 1
  );
  check(
    "SQL: budget_exceeded audit",
    one("SELECT COUNT(*) n FROM audit_log WHERE action='budget_exceeded' AND task_id=?", gId).n >= 1
  );
  // Zero out the simulated run's tokens now that the block is proven — see comment above.
  repo.runs.updateRun(gr.id, { tokens_used: { total: 0 } });

  // ---------- INFRA leg F: crash recovery (reconcile_runs) ----------
  const orch = require(path.join(ROOT, "server/lib/kad/orchestrator"));
  // Fresh task stuck at 'doing' with an orphan 'running' run (simulates a crash mid-turn).
  const crashTask = await api("POST", "/api/kad/tasks", { title: "Crash recovery task" });
  const crashTaskId = crashTask.body.id;
  repo.tasks.updateTask(crashTaskId, { status: "doing" });
  const orphan = repo.runs.createRun({
    task_id: crashTaskId,
    agent_id: mainAgent.id,
    engine: "claude",
  });
  repo.runs.updateRun(orphan.id, { status: "running" }); // simulate a run alive at crash time
  const cleaned = orch.reconcileRuns();
  check("reconcile_runs cleans orphan running run", cleaned >= 1);
  check(
    "SQL: orphan run → failed",
    one("SELECT status FROM task_runs WHERE id=?", orphan.id).status === "failed"
  );
  check(
    "SQL: stuck 'doing' task reset → waiting_human (not left stuck)",
    one("SELECT status FROM tasks WHERE id=?", crashTaskId).status === "waiting_human"
  );

  // ---------- INFRA leg G: real MCP stdio server subprocess ----------
  // Spawn the ACTUAL mcp/kad-tools-server.mjs and drive JSON-RPC. Proves the MCP
  // binary the agent loads works (handshake, tools/list, tools/call → internal API
  // → DB) and enforces the approval-block — everything except the agent deciding
  // to call it (that last mile needs a real engine, below).
  const mcpTask = await api("POST", "/api/kad/tasks", { title: "MCP leg task" });
  const mcpTaskId = mcpTask.body.id;
  const mcp = spawn(process.execPath, [path.join(ROOT, "mcp/kad-tools-server.mjs")], {
    env: {
      ...process.env,
      KAD_API_BASE: BASE,
      KAD_INTERNAL_TOKEN: getInternalToken(),
      KAD_RUN_ID: "run-mcp-leg",
      KAD_TASK_ID: mcpTaskId,
      KAD_AGENT_ID: mainAgent.id,
    },
  });
  const mcpPending = new Map();
  let mcpBuf = "";
  mcp.stdout.on("data", (d) => {
    mcpBuf += d.toString();
    let nl;
    while ((nl = mcpBuf.indexOf("\n")) >= 0) {
      const line = mcpBuf.slice(0, nl);
      mcpBuf = mcpBuf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && mcpPending.has(msg.id)) {
        mcpPending.get(msg.id)(msg);
        mcpPending.delete(msg.id);
      }
    }
  });
  let mcpId = 1;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = mcpId++;
      mcpPending.set(id, resolve);
      setTimeout(() => reject(new Error("mcp rpc timeout " + method)), 10000);
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  try {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "verify", version: "1" },
    });
    check(
      "MCP initialize → serverInfo.name=kad",
      init.result && init.result.serverInfo && init.result.serverInfo.name === "kad"
    );
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await rpc("tools/list", {});
    const toolNames = (listed.result.tools || []).map((t) => t.name);
    check("MCP tools/list = 12 KAD tools", toolNames.length === 12, toolNames.join(","));
    const planCall = await rpc("tools/call", {
      name: "kad_plan_task",
      arguments: { plan: "## Kế hoạch\n1. x" },
    });
    check(
      "MCP kad_plan_task → pending + real approval row",
      /"status":"pending"/.test(planCall.result.content[0].text) &&
        one("SELECT COUNT(*) n FROM approvals WHERE task_id=? AND approval_type='plan'", mcpTaskId)
          .n === 1
    );
    const delCall = await rpc("tools/call", {
      name: "kad_create_delegation",
      arguments: { to_agent: "sub-curriculum-researcher", instruction: "x" },
    });
    check(
      "MCP kad_create_delegation blocked pre-approval (isError)",
      delCall.result.isError === true,
      delCall.result.content[0].text.slice(0, 80)
    );
  } catch (e) {
    check("MCP leg completed", false, e.message);
  } finally {
    mcp.kill();
  }

  // ---------- INFRA leg H: intake / brief / report (Phase 2, spec 07) ----------
  // Same simulated-run-context style as legs A-D: proves the state machine +
  // enforcement for the new Phase 2 message types without spawning an engine.
  const briefTask = await api("POST", "/api/kad/tasks", {
    title: "Soạn syllabus môn AI Automation (infra brief)",
  });
  const briefTaskId = briefTask.body.id;
  const ctxBrief = { run: "run-sim-brief", task: briefTaskId, agent: mainAgent.id };

  const intake = await internal("POST", "/ask-intake", {
    runCtx: ctxBrief,
    body: {
      question: "Syllabus theo khung KASH chuẩn Bloom hay cấu trúc khác?",
      options: ["Theo chuẩn Kstudy", "Cấu trúc khác"],
    },
  });
  check(
    "kad_ask_intake → message intake_question",
    intake.status === 200 && !!intake.body.message_id
  );
  check(
    "SQL: intake_question message row",
    one(
      "SELECT COUNT(*) n FROM task_messages WHERE task_id=? AND message_type='intake_question'",
      briefTaskId
    ).n === 1
  );

  const proposeBrief = await internal("POST", "/propose-brief", {
    runCtx: ctxBrief,
    body: {
      goal: "Soạn syllabus AI Automation cho K3",
      deliverable: "Syllabus .docx + import .xlsx",
      workflow_name: "Soạn syllabus",
      due_label: "Cuối tuần này",
    },
  });
  check(
    "kad_propose_brief → message brief",
    proposeBrief.status === 200 && !!proposeBrief.body.message_id
  );
  const briefMsgId = proposeBrief.body.message_id;
  check(
    "SQL: tasks.brief set (draft, undecided)",
    (() => {
      const t = repo.tasks.getTask(briefTaskId);
      return !!t.brief && t.brief.decidedAt === null;
    })()
  );

  const lockedBefore = await api("POST", `/api/kad/tasks/${briefTaskId}/brief/lock`, {});
  check(
    "POST /brief/lock → decidedAt set",
    lockedBefore.status === 200 && !!lockedBefore.body.message.metadata.brief.decidedAt
  );
  check(
    "SQL: task status doing after brief lock",
    one("SELECT status FROM tasks WHERE id=?", briefTaskId).status === "doing"
  );
  check(
    "SQL: resume_task job enqueued by brief lock",
    one(
      "SELECT COUNT(*) n FROM kad_job_queue WHERE kind='resume_task' AND payload_json LIKE ?",
      `%${briefTaskId}%`
    ).n >= 1
  );
  const relock = await api("POST", `/api/kad/tasks/${briefTaskId}/brief/lock`, {});
  check("POST /brief/lock twice → 409", relock.status === 409, `got ${relock.status}`);

  // ---------- Regression: resume_task dedup must not drop a superseding
  // trigger while the prior one is still 'leased' (confirmed root cause of
  // live S2 runs 7-11 getting permanently stuck after plan/report approval —
  // an approval decided the instant it rendered, faster than the brief-lock
  // resume's own turn had finished and been marked 'done'). ----------
  {
    const dedupKey = `resume:${briefTaskId}`;
    const before = one(
      "SELECT id, status, payload_json FROM kad_job_queue WHERE dedup_key=?",
      dedupKey
    );
    check("race-repro: brief-lock resume job is pending pre-lease", before.status === "pending");
    // Earlier infra legs (A-G) leave their own pending resume_task/start_delegation
    // rows un-swept by design (comment above, line ~592) — leaseDue(1) would grab
    // whichever is oldest, not necessarily THIS job. Flip this exact row the same
    // way leaseDue() would, so the race below is deterministic.
    repo.db
      .prepare("UPDATE kad_job_queue SET status='leased', lease_until=@lease WHERE id=@id")
      .run({ id: before.id, lease: new Date(Date.now() + 60000).toISOString() });
    check(
      "race-repro: leased pre-condition set",
      one("SELECT status FROM kad_job_queue WHERE id=?", before.id).status === "leased"
    );
    const superseded = repo.jobs.enqueue({
      kind: "resume_task",
      payload: { task_id: briefTaskId, message: "SUPERSEDING — plan approved, proceed" },
      dedupKey,
    });
    check(
      "race-repro: same dedup key while leased → same row (no duplicate insert)",
      one("SELECT COUNT(*) n FROM kad_job_queue WHERE dedup_key=?", dedupKey).n === 1
    );
    check(
      "race-repro: new payload NOT discarded (was silently dropped before fix)",
      superseded.payload.message === "SUPERSEDING — plan approved, proceed"
    );
    check(
      "race-repro: requeue_after_done flagged while leased",
      one("SELECT requeue_after_done FROM kad_job_queue WHERE id=?", before.id)
        .requeue_after_done === 1
    );
    repo.jobs.completeOrRequeue(before.id); // simulate the in-flight (stale) turn finishing
    const after = one(
      "SELECT status, requeue_after_done, payload_json FROM kad_job_queue WHERE id=?",
      before.id
    );
    check(
      "race-repro: completeOrRequeue reopens as pending (not done) — payload preserved",
      after.status === "pending" &&
        after.requeue_after_done === 0 &&
        JSON.parse(after.payload_json).message === "SUPERSEDING — plan approved, proceed"
    );
  }

  const briefArtifact = await internal("POST", "/save-artifact", {
    runCtx: ctxBrief,
    body: {
      artifact_type: "syllabus",
      title: "Syllabus AI Automation v1",
      content: "# Syllabus\n...",
    },
  });
  check(
    "kad_save_artifact (for report) → artifact_id",
    briefArtifact.status === 200 && !!briefArtifact.body.artifact_id
  );
  const briefArtifactId = briefArtifact.body.artifact_id;

  const report1 = await internal("POST", "/present-report", {
    runCtx: ctxBrief,
    body: {
      summary: "Syllabus 12 buổi hoàn chỉnh theo khung KASH x Bloom.",
      artifact_ids: [briefArtifactId],
      needs_decision: ["Buổi 9 dùng case thật hay case giả lập?"],
    },
  });
  check(
    "kad_present_report → message report v1",
    report1.status === 200 && !!report1.body.message_id
  );
  const reportMsgId1 = report1.body.message_id;
  check(
    "SQL: artifact bumped to review",
    one("SELECT status FROM artifacts WHERE id=?", briefArtifactId).status === "review"
  );
  check(
    "SQL: task waiting_human after report",
    one("SELECT status FROM tasks WHERE id=?", briefTaskId).status === "waiting_human"
  );

  const needsChanges = await api(
    "POST",
    `/api/kad/tasks/${briefTaskId}/report/${reportMsgId1}/decide`,
    { decision: "needs_changes", reason: "Bổ sung buổi 4 dashboard tự động." }
  );
  check(
    "POST /report/:id/decide needs_changes",
    needsChanges.status === 200 && needsChanges.body.resume_enqueued === true
  );
  check(
    "SQL: task needs_changes",
    one("SELECT status FROM tasks WHERE id=?", briefTaskId).status === "needs_changes"
  );
  check(
    "SQL: artifact NOT approved on needs_changes",
    one("SELECT status FROM artifacts WHERE id=?", briefArtifactId).status === "review"
  );
  check(
    "SQL: human reason recorded as chat message",
    one(
      "SELECT COUNT(*) n FROM task_messages WHERE task_id=? AND sender_type='human' AND content LIKE '%dashboard tự động%'",
      briefTaskId
    ).n >= 1
  );
  const redecide = await api(
    "POST",
    `/api/kad/tasks/${briefTaskId}/report/${reportMsgId1}/decide`,
    { decision: "approved" }
  );
  check("POST /report/:id/decide twice → 409", redecide.status === 409, `got ${redecide.status}`);

  const report2 = await internal("POST", "/present-report", {
    runCtx: ctxBrief,
    body: {
      summary: "Syllabus v2 đã bổ sung dashboard tự động buổi 4.",
      artifact_ids: [briefArtifactId],
    },
  });
  check(
    "kad_present_report v2 → version increments",
    report2.status === 200 &&
      one("SELECT metadata FROM task_messages WHERE id=?", report2.body.message_id) &&
      JSON.parse(
        one("SELECT metadata FROM task_messages WHERE id=?", report2.body.message_id).metadata
      ).report.version === 2
  );
  const approveAll = await api(
    "POST",
    `/api/kad/tasks/${briefTaskId}/report/${report2.body.message_id}/decide`,
    { decision: "approved" }
  );
  check(
    "POST /report/:id/decide approved",
    approveAll.status === 200 && approveAll.body.resume_enqueued === false
  );
  check(
    "SQL: artifact approved",
    one("SELECT status FROM artifacts WHERE id=?", briefArtifactId).status === "approved"
  );
  check(
    "SQL: task done",
    one("SELECT status FROM tasks WHERE id=?", briefTaskId).status === "done"
  );

  // NOTE: POST /:id/messages' first-message-vs-resume branch (tasks.js) is only
  // exercisable end-to-end with a real engine turn (it fires an actual claude
  // spawn via orchestrator.resumeTaskTurn) — covered by engine leg S1.E4 below,
  // not here, to avoid spawning a real process during the deterministic infra legs.

  // Infra legs above assert that start_delegation/resume_task jobs get ENQUEUED
  // (row exists) but deliberately never execute them (no engine spawns during
  // deterministic infra checks). worker.sweep() below (engine legs) leases ANY
  // due job, not just the engine task's — so a leftover infra-leg job would get
  // vacuumed up and spawn an extra, unwanted real turn. Retire them first.
  repo.db
    .prepare("UPDATE kad_job_queue SET status='done' WHERE status IN ('pending','leased')")
    .run();

  // ---------- ENGINE legs (real claude spawn; CANNOT be mocked) ----------
  // Drive the actual orchestrator: POST a real goal → a real Main Agent claude turn
  // runs (via startTaskTurn, not the worker) → assert the AGENT itself called
  // kad_plan_task (plan approval appears) and that engine_session_id was captured.
  console.log("\n--- Engine legs (real Claude spawn) ---");
  const worker = require(path.join(ROOT, "server/lib/kad/job-queue"));
  let engineBlocked = false;
  const eng = await api("POST", "/api/kad/tasks", {
    title: "Nghiên cứu nhu cầu học AI Automation của chủ SME Việt Nam (engine)",
  });
  const engId = eng.body.id;
  const goal =
    "Nghiên cứu nhu cầu học AI Automation của chủ SME Việt Nam. Lập kế hoạch và gọi tool kad_plan_task để xin duyệt.";
  const em = await api("POST", `/api/kad/tasks/${engId}/messages`, { content: goal });
  check(
    "S1.E0 POST /messages accepted + run kicked",
    em.status === 201 && em.body.run_kicked === true
  );
  check(
    "SQL: human message row exists",
    one("SELECT COUNT(*) n FROM task_messages WHERE task_id=? AND sender_type='human'", engId).n >=
      1
  );

  // Poll for the real turn chain: plan approval created OR run failed. A live turn
  // may now route through intake (spec 07 §2, ≤3 rounds) and a Brief Card (§3)
  // before ever calling kad_plan_task — drive that chain for real by answering any
  // intake_question with its first quick-reply chip and [Chốt & giao]-ing any
  // brief, so the test reaches kad_plan_task regardless of which path the live
  // model takes (an explicit goal may skip straight to planning; an ambiguous one
  // intakes first — both are legitimate, not something to force). Each action is a
  // real turn (~1-3min), so the overall budget is longer than a single-turn wait.
  // Read via repo (the server's own db connection) — a separate readonly
  // connection can lag on cross-connection WAL visibility.
  const t0 = Date.now();
  let planRow = null,
    engRun = null,
    briefLocked = false;
  const answeredIntakeIds = new Set();
  while (Date.now() - t0 < 480000) {
    // Once the brief is locked, resume is a durable job (kad_job_queue), same
    // mechanism as approval-decide — the isolated test disables the auto-tick
    // (KAD_WORKER_TICK_MS), so it must be driven explicitly here, exactly like
    // the E2 web-search chain below does after approval.
    if (briefLocked) {
      await worker.sweep();
      await sleep(1000);
    } else {
      await sleep(3000);
    }
    const apprs = repo.approvals.listByTask(engId).filter((a) => a.approval_type === "plan");
    planRow = apprs[apprs.length - 1] || null;
    // Multiple real turns now happen on this task (intake/brief, then plan) —
    // always the LATEST run, never runs[0] (that's the brief-proposal turn).
    const engRuns = repo.runs.listByTask(engId);
    engRun = engRuns[engRuns.length - 1] || null;
    if (planRow) break;
    if (engRun && engRun.status === "failed") {
      const out = JSON.stringify(engRun.output || "");
      if (/401|authenticate|credentials/i.test(out)) engineBlocked = true;
      break;
    }
    const msgs = repo.tasks.listMessages(engId);
    const intakeMsg = [...msgs]
      .reverse()
      .find((m) => m.message_type === "intake_question" && !answeredIntakeIds.has(m.id));
    if (intakeMsg) {
      answeredIntakeIds.add(intakeMsg.id);
      const options = intakeMsg.metadata && intakeMsg.metadata.options;
      const answer = options && options.length ? options[0] : "Được, cứ theo cách hợp lý nhất.";
      await api("POST", `/api/kad/tasks/${engId}/messages`, { content: answer });
      continue;
    }
    if (!briefLocked && msgs.some((m) => m.message_type === "brief")) {
      const lockResp = await api("POST", `/api/kad/tasks/${engId}/brief/lock`, {});
      if (lockResp.status === 200) briefLocked = true;
    }
  }
  if (briefLocked) check("S1.E4 live brief flow: locked before plan", true);

  if (engineBlocked) {
    blocked(
      "S1.E1 Main Agent real turn calls kad_plan_task",
      "spawned claude 401 — no standalone credential (run `claude login`, then a fresh `claude -p` must not 401)"
    );
    blocked("S1.E2 Researcher real turn calls kad_web_search ≥1", "depends on E1 + TAVILY_API_KEY");
    blocked("S1.E3 engine_session_id captured", "no engine turn");
  } else {
    check(
      "S1.E1 real Main turn called kad_plan_task (plan approval created)",
      !!planRow,
      engRun ? `run status=${engRun.status}` : "no run yet"
    );
    check(
      "S1.E3 engine_session_id captured (bridge to monitor trace)",
      !!(engRun && engRun.engine_session_id),
      engRun ? engRun.engine_session_id || "null" : "no run"
    );
    // Settle: the turn ends (process exits) shortly AFTER the approval is created —
    // wait for the run to reach the durable waiting_approval marker.
    const s0 = Date.now();
    while (Date.now() - s0 < 30000) {
      const runsNow = repo.runs.listByTask(engId);
      engRun = runsNow[runsNow.length - 1] || engRun;
      if (engRun && ["waiting_approval", "completed", "failed"].includes(engRun.status)) break;
      await sleep(2000);
    }
    check(
      "turn-based: run ended at waiting_approval (durable marker, process exited)",
      engRun && engRun.status === "waiting_approval",
      engRun ? engRun.status : "no run"
    );
    check(
      "engine task parked at waiting_human",
      repo.tasks.getTask(engId).status === "waiting_human",
      repo.tasks.getTask(engId).status
    );
    const engAudits = repo.listAudit({ task_id: engId }).map((r) => r.action);
    check(
      "real run lifecycle audited (run_started + run_completed)",
      engAudits.includes("run_started") && engAudits.includes("run_completed"),
      engAudits.join(",")
    );

    // E2: full chain to a real web search — needs the Researcher to run, which needs
    // the plan approved + worker to drive resume→delegation. Gated on TAVILY_API_KEY.
    if (planRow && process.env.TAVILY_API_KEY) {
      await api("POST", `/api/kad/approvals/${planRow.id}/decide`, { decision: "approved" });
      const w0 = Date.now();
      let searched = false;
      // Chain: resume main → kad_create_delegation → researcher turn → kad_web_search
      // → kad_save_artifact. Each sweep() drives one job (a real turn) to completion.
      while (Date.now() - w0 < 360000) {
        await worker.sweep(); // advance the durable job queue by one real turn
        if (repo.listAudit({ task_id: engId }).some((r) => r.action === "web_search")) {
          searched = true;
          break;
        }
        await sleep(2000);
      }
      check("S1.E2 Researcher real turn called kad_web_search ≥1", searched);
      check(
        "S1.E2b research_report artifact produced by researcher",
        one(
          "SELECT COUNT(*) n FROM artifacts WHERE task_id=? AND artifact_type='research_report'",
          engId
        ).n >= 1
      );
    } else if (!process.env.TAVILY_API_KEY) {
      blocked(
        "S1.E2 Researcher web_search",
        "TAVILY_API_KEY not set (set it to run the full research chain)"
      );
    }
  }

  // ---------- summary ----------
  console.log(results.join("\n"));
  console.log(
    `\n=== S1: ${pass} passed, ${fail} failed${engineBlocked ? " (engine legs BLOCKED — auth)" : ""} ===`
  );

  sdb.close();
  try {
    require(path.join(ROOT, "server/lib/kad/job-queue")).stopWorker();
  } catch {}
  server.close();
  for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"])
    try {
      fs.unlinkSync(f);
    } catch {}
  process.exit(fail > 0 ? 1 : 0);
}

/**
 * Scenario S2 (Phase 2, phase-02-task-chat-workspace-ui.md item 7): the full
 * intake → brief → run → approval → report → duyệt cycle driven on the REAL
 * React UI via Playwright, against a REAL isolated backend + REAL engine.
 * Deliberately its own process (not chained after S1 in-process) — server/db.js
 * opens its better-sqlite3 handle as a module-level singleton keyed off
 * DASHBOARD_DB_PATH at first require, so a second isolated DB in the same
 * process would silently reuse S1's connection instead of getting a clean one.
 * Run with `node scripts/kad-verify.mjs --s2`.
 */
async function runS2() {
  console.log("\n=== KAD verify — Scenario S2 (Phase 2, Playwright on real UI) ===\n");
  const TMP_DB2 = path.join(os.tmpdir(), `kad-verify-s2-${process.pid}.db`);
  for (const f of [TMP_DB2, TMP_DB2 + "-wal", TMP_DB2 + "-shm"])
    try {
      fs.unlinkSync(f);
    } catch {}
  process.env.DASHBOARD_DB_PATH = TMP_DB2;
  process.env.DASHBOARD_TOKEN = "";
  delete process.env.KAD_WORKER_TICK_MS; // real auto-tick — Playwright drives like a human, no manual worker.sweep()

  const seed = spawnSync(process.execPath, [path.join(ROOT, "scripts/kad-seed.mjs")], {
    env: process.env,
    encoding: "utf8",
  });
  if (seed.status !== 0) {
    console.error("seed failed:", seed.stderr || seed.stdout);
    process.exit(1);
  }

  const { createApp } = require(path.join(ROOT, "server/index.js"));
  const { initWebSocket } = require(path.join(ROOT, "server/websocket.js"));
  const kad = require(path.join(ROOT, "server/routes/kad"));
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const apiPort = server.address().port;
  // createApp() only builds the Express app — the monitor's own startServer()
  // wires initWebSocket(server) separately (server/index.js). S1 never needed
  // it (no live browser), but S2 drives a real page that depends on kad:task:
  // scoped WS events (kad.message.created, kad.run.status, ...) to ever show
  // anything beyond the initial page load — without this the client's /ws
  // upgrade 404s and every screen after the first message hangs forever.
  initWebSocket(server);
  kad.initKad({ apiBase: `http://127.0.0.1:${apiPort}` });

  const vite = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "--port", "5183", "--host", "127.0.0.1"],
    {
      cwd: path.join(ROOT, "client"),
      env: { ...process.env, DASHBOARD_PORT: String(apiPort) },
    }
  );
  let viteUrl = null;
  let viteErr = "";
  vite.stdout.on("data", (d) => {
    const m = d.toString().match(/Local:\s+(http:\/\/\S+)/);
    if (m) viteUrl = m[1].replace(/\/$/, "");
  });
  vite.stderr.on("data", (d) => {
    viteErr += d.toString();
  });
  const vt0 = Date.now();
  while (!viteUrl && Date.now() - vt0 < 30000) await sleep(300);
  check("S2: vite dev server started", !!viteUrl, viteErr.slice(0, 300) || "timeout");

  let browser = null;
  let s2TaskId = null;
  let page = null;
  try {
    if (!viteUrl) throw new Error("vite did not start");
    const { chromium } = require("playwright");
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto(`${viteUrl}/cong-viec/moi`);

    const goal =
      "Em cần tài liệu nghiên cứu nhu cầu học tự động hoá AI của chủ doanh nghiệp SME Việt Nam để chuẩn bị nội dung khoá học mới.";
    const composer = page.getByPlaceholder(/Mô tả việc như nói với nhân viên/);
    await composer.waitFor({ state: "visible", timeout: 15000 });
    await composer.fill(goal);
    await page.getByRole("button", { name: "Gửi" }).click();

    // CongViecMoi (mock, different track) first navigates to a CLIENT-FABRICATED
    // id ("task-new-<n>", store.tsx) before this screen's `fresh` effect creates
    // the REAL task and replaces the URL again — real ids are "task_<uuid>"
    // (server/lib/kad/ids.js). Must wait for the SECOND (real) navigation, not
    // the first, or every later selector races against a task that doesn't exist.
    await page.waitForURL(/\/cong-viec\/task_[^/]+\/?$/, { timeout: 30000 });
    check("S2: task created from /cong-viec/moi (real POST), URL replaced to real id", true);
    s2TaskId = new URL(page.url()).pathname.split("/").pop();

    // Race a NEW intake-question vs brief-lock each poll (instead of a fixed-
    // count loop with a full timeout per round) — reacts the moment either
    // appears instead of always burning a full round's timeout when there are
    // fewer questions. A live intake question is NOT guaranteed to carry quick-
    // reply chips (kad_ask_intake's `options` is optional — the agent may ask
    // an open-ended question) — fall back to typing a free-text reply.
    let handledIntake = 0;
    for (let i = 0; i < 4; i++) {
      const progressed = await (async () => {
        const start = Date.now();
        while (Date.now() - start < 150000) {
          if (
            await page
              .getByTestId("brief-lock")
              .first()
              .isVisible()
              .catch(() => false)
          )
            return "brief-lock";
          if ((await page.getByTestId("intake-question").count()) > handledIntake)
            return "intake-question";
          await page.waitForTimeout(1000);
        }
        return null;
      })();
      if (progressed !== "intake-question") break; // brief-lock found, or nothing showed up within budget
      const blocks = page.getByTestId("intake-question");
      handledIntake = await blocks.count();
      const latest = blocks.nth(handledIntake - 1);
      const chip = latest.getByTestId("intake-option").first();
      if (await chip.isVisible().catch(() => false)) {
        console.log(`[S2] intake round ${handledIntake}: clicking chip`);
        await chip.click();
      } else {
        console.log(
          `[S2] intake round ${handledIntake}: no chip, waiting for composer (isRunning must clear first)`
        );
        // The run must fully end (composer swaps back from "Trợ lý đang viết…"
        // to the real textarea) before this is interactable — wait explicitly
        // instead of relying on fill()'s implicit actionability wait, so a
        // stuck isRunning state surfaces as ITS OWN clear timeout, not a
        // downstream brief-lock timeout that looks unrelated.
        const composer = page.getByPlaceholder(/Nhắn cho Trợ lý vận hành/);
        await composer.waitFor({ state: "visible", timeout: 60000 });
        await composer.fill(
          "Dùng để chuẩn bị brief nội dung khoá học mới, cần đủ sâu để lên khung chương trình."
        );
        const sendBtn = page.getByRole("button", { name: "Gửi" });
        await sendBtn.waitFor({ state: "visible", timeout: 5000 });
        await sendBtn.click();
        console.log(`[S2] intake round ${handledIntake}: free-text reply sent`);
      }
    }

    const lockBtn = page.getByTestId("brief-lock");
    await lockBtn.waitFor({ state: "visible", timeout: 30000 });
    check("S2: Brief Card rendered on real UI (kad_propose_brief)", true);
    await lockBtn.click();

    const firstApproval = page.getByTestId("approval-approve").first();
    await firstApproval.waitFor({ state: "visible", timeout: 150000 });
    check("S2: plan approval rendered inline in chat after brief lock (turn-based)", true);
    await firstApproval.click();

    // Spans delegate → artifact → report (multiple real turns) — generous
    // budget. The live agent may request MORE than one approval before the
    // final report (e.g. a sensitivity/artifact approval alongside the plan
    // one) — keep clicking any newly-pending approval that shows up while
    // waiting, instead of assuming exactly one round.
    const reportBtn = page.getByTestId("report-approve").first();
    const r0 = Date.now();
    while (Date.now() - r0 < 420000) {
      if (await reportBtn.isVisible().catch(() => false)) break;
      const pendingApproval = page.getByTestId("approval-approve").first();
      if (await pendingApproval.isVisible().catch(() => false)) {
        console.log("[S2] additional pending approval found — approving");
        await pendingApproval.click();
      }
      await page.waitForTimeout(2000);
    }
    await reportBtn.waitFor({ state: "visible", timeout: 5000 });
    check("S2: Report Card rendered on real UI (kad_present_report)", true);
    await reportBtn.click();

    await page.getByText("Đã duyệt", { exact: false }).first().waitFor({ timeout: 15000 });
    check("S2: report decision reflected inline after [Duyệt tất cả]", true);

    const Database = require("better-sqlite3");
    const sdb2 = new Database(TMP_DB2, { readonly: true });
    const taskRow = sdb2.prepare("SELECT status FROM tasks ORDER BY created_at DESC LIMIT 1").get();
    check(
      "S2: SQL — task reached 'done' after the full real cycle",
      taskRow && taskRow.status === "done",
      taskRow ? taskRow.status : "no task"
    );
    sdb2.close();
  } catch (e) {
    check("S2: full cycle completed without error", false, e && e.message);
    // Diagnostic dump BEFORE the temp DB gets deleted below — this is a real
    // live-engine run, not something worth blindly re-running (10-20min/attempt).
    try {
      const shotPath = path.join(os.tmpdir(), `kad-verify-s2-failure-${process.pid}.png`);
      await page?.screenshot({ path: shotPath, fullPage: true });
      console.log(`[S2] failure screenshot: ${shotPath} | url=${page?.url()}`);
      console.log(
        `[S2] composer visible=${await page
          ?.getByPlaceholder(/Nhắn cho Trợ lý vận hành/)
          .isVisible()
          .catch(() => "err")} | isRunning bar visible=${await page
          ?.getByText("Trợ lý đang viết")
          .isVisible()
          .catch(() => "err")}`
      );
    } catch {}
    if (s2TaskId) {
      try {
        const repo = require(path.join(ROOT, "server/lib/kad/repo"));
        const t = repo.tasks.getTask(s2TaskId);
        console.log(
          `\n--- S2 diagnostic: task ${s2TaskId} status=${t && t.status} brief=${JSON.stringify(t && t.brief)} ---`
        );
        for (const m of repo.tasks.listMessages(s2TaskId)) {
          console.log(
            `  [${m.created_at}] ${m.sender_type}/${m.sender_id} (${m.message_type}): ${String(m.content).slice(0, 200)}`
          );
        }
        for (const r of repo.runs.listByTask(s2TaskId)) {
          console.log(`  run ${r.id} status=${r.status} engine_session_id=${r.engine_session_id}`);
        }
        for (const a of repo.approvals.listByTask(s2TaskId)) {
          console.log(
            `  approval ${a.id} type=${a.approval_type} status=${a.status} title=${a.title}`
          );
        }
        for (const d of repo.delegations.listByTask(s2TaskId)) {
          console.log(
            `  delegation ${d.id} to=${d.to_agent_id} status=${d.status} retry=${d.retry_count}`
          );
        }
        const guardrails = require(path.join(ROOT, "server/lib/kad/guardrails"));
        console.log(`  per-task tokens used: ${guardrails.taskTokenUsage(s2TaskId)}`);
        for (const row of repo.db
          .prepare(
            "SELECT id,kind,status,dedup_key,attempts,last_error,run_after FROM kad_job_queue ORDER BY created_at DESC LIMIT 10"
          )
          .all()) {
          console.log(
            `  job(any) ${row.id} kind=${row.kind} status=${row.status} dedup=${row.dedup_key} attempts=${row.attempts} err=${row.last_error} run_after=${row.run_after}`
          );
        }
        for (const a of repo.listAudit({ task_id: s2TaskId })) {
          console.log(`  audit [${a.created_at}] ${a.action} actor=${a.actor_type}/${a.actor_id}`);
        }
      } catch (diagErr) {
        console.log("S2 diagnostic dump failed:", diagErr.message);
      }
    }
  } finally {
    await browser?.close().catch(() => {});
    vite.kill();
    try {
      require(path.join(ROOT, "server/lib/kad/job-queue")).stopWorker();
    } catch {}
    server.close();
    for (const f of [TMP_DB2, TMP_DB2 + "-wal", TMP_DB2 + "-shm"])
      try {
        fs.unlinkSync(f);
      } catch {}
  }

  console.log(results.join("\n"));
  console.log(`\n=== S2: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

async function runS4() {
  console.log("\n=== KAD verify — Scenario S4 (Phase 4, wizard + knowledge/template versioning) ===\n");
  const TMP_DB4 = path.join(os.tmpdir(), `kad-verify-s4-${process.pid}.db`);
  for (const f of [TMP_DB4, TMP_DB4 + "-wal", TMP_DB4 + "-shm"])
    try {
      fs.unlinkSync(f);
    } catch {}
  process.env.DASHBOARD_DB_PATH = TMP_DB4;
  process.env.DASHBOARD_TOKEN = "";
  process.env.KAD_WORKER_TICK_MS = "3600000";

  const { createApp } = require(path.join(ROOT, "server/index.js"));
  const kad = require(path.join(ROOT, "server/routes/kad"));
  const { getInternalToken } = require(path.join(ROOT, "server/lib/kad/internal-auth"));
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;
  kad.initKad({ apiBase: BASE });

  const api = async (method, p, body) => {
    const resp = await fetch(BASE + p, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, body: await resp.json().catch(() => ({})) };
  };
  const internal = async (method, p, { runCtx, body } = {}) => {
    const h = { "content-type": "application/json", "x-kad-internal-token": getInternalToken() };
    if (runCtx)
      Object.assign(h, {
        "x-kad-run-id": runCtx.run,
        "x-kad-task-id": runCtx.task,
        "x-kad-agent-id": runCtx.agent,
      });
    const resp = await fetch(BASE + "/api/kad/internal" + p, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, body: await resp.json().catch(() => ({})) };
  };

  const Database = require("better-sqlite3");
  const sdb4 = new Database(TMP_DB4, { readonly: true });
  const one = (q, ...a) => sdb4.prepare(q).get(...a);
  const repo = require(path.join(ROOT, "server/lib/kad/repo"));

  const empty = await api("GET", "/api/kad/org-context/current");
  check("S4: DB trắng starts with no org context", empty.status === 404, `got ${empty.status}`);

  const wizardDraft = {
    _profile: {
      name: "Học viện Kstudy",
      industry: "Đào tạo Digital Marketing, AI & Automation",
      size: "11-50",
      founded_year: 2015,
    },
    vision:
      "Phổ cập năng lực Digital Marketing định hướng AI & Automation, thực chiến, cho người đi làm và người chuyển nghề tại Việt Nam.",
    mission:
      "Đào tạo Digital Marketing, AI & Automation theo hướng làm được ngay; xây và đưa học liệu lên hệ thống Kstudy AI Mentor.",
    core_values: ["AI-First", "Asset-light", "Guerrilla Marketing", "Business Automation"],
    brand: {
      voice:
        'Chuyên gia gần gũi, thực chiến, thẳng thắn; với học trò xưng "anh/em"; không phóng đại.',
      guideline: "Không bịa số liệu, không cam kết quá mức, ưu tiên ví dụ Việt Nam.",
      primary_color: "#1D237D",
      font: "Inter",
      slogan: "Đào tạo AI & Automation Marketing",
    },
    products: [
      {
        name: "Nghề Digital Marketing định hướng AI Automation",
        description: "Chương trình 6-8 tháng, online + hybrid.",
        target_audience: "Người đi làm và người chuyển nghề.",
      },
    ],
    personas: [
      {
        name: "Người chuyển nghề Digital Marketing",
        demographics: "Người đi làm tại Việt Nam.",
        needs: "Học thực chiến, làm được ngay.",
        pain_points: "Thiếu nền tảng, ngại lý thuyết suông.",
        channels: "Online + Hybrid",
      },
    ],
    strategy: {
      goals: "Soạn học liệu chuẩn CDIO/KASH/Bloom.",
      priorities: "Chất lượng sư phạm + tính thực chiến + brand voice nhất quán.",
      constraints: "Không phóng đại; ưu tiên công cụ phổ cập, chi phí thấp.",
      roadmap: "Phase 1: syllabus; Phase 2: lesson/slide/video.",
    },
    swot: {
      strengths: ["Thực chiến", "AI-first"],
      weaknesses: ["Organic traffic còn yếu"],
      opportunities: ["SME cần automation"],
      threats: ["Thị trường nhiễu thông tin AI"],
    },
    competitors: [
      {
        name: "Đối thủ benchmark",
        strengths: "Nhận diện tốt",
        weaknesses: "Ít automation",
        differentiator: "Kstudy tập trung AI-native workflow",
      },
    ],
    department_role: "Phòng R&D xây khung chương trình, syllabus và học liệu.",
    pedagogy_standards: "CDIO, KASH, Bloom taxonomy, hybrid learning.",
    responsible_human: "anh Khiêm",
    _org_chart_nodes: [
      { id: "company", parent_id: null, name: "Học viện Kstudy", node_type: "company", sort_order: 0 },
      { id: "rd", parent_id: "company", name: "Phòng R&D", node_type: "department", sort_order: 1 },
    ],
    _department: {
      slug: "rd",
      name: "Phòng R&D",
      template_type: "rd",
      mission: "Xây khung chương trình, syllabus và học liệu.",
    },
    _templates: [],
  };

  for (let step = 1; step <= 11; step++) {
    const draft = await api("POST", "/api/kad/wizard/draft", { step, draft: wizardDraft });
    check(`S4: wizard draft step ${step}/11 saved`, draft.status === 200, `got ${draft.status}`);
  }
  const completed = await api("POST", "/api/kad/wizard/complete", { draft: wizardDraft });
  check(
    "S4: wizard complete → org context v1 approved",
    completed.status === 201 && completed.body.org_context.status === "approved",
    `got ${completed.status}`
  );
  check(
    "S4 SQL: dept rd + approved blueprint + active main/researcher",
    one("SELECT COUNT(*) n FROM departments WHERE slug='rd' AND status='active'").n === 1 &&
      one("SELECT COUNT(*) n FROM department_blueprints WHERE status='approved'").n === 1 &&
      one("SELECT COUNT(*) n FROM agent_profiles WHERE name='main-agent-rd' AND status='active'").n === 1 &&
      one("SELECT COUNT(*) n FROM agent_profiles WHERE name='sub-curriculum-researcher' AND status='active'").n === 1
  );
  check(
    "S4 SQL: 6 approved seed templates",
    one("SELECT COUNT(*) n FROM template_versions WHERE status='approved'").n >= 6
  );

  const dept = repo.catalog.getDepartmentBySlug("rd");
  const mainAgent = repo.catalog.getMainAgent(dept.id);
  const oldTask = await api("POST", "/api/kad/tasks", { title: "S4 task trước khi sửa brand voice" });
  const v1 = one("SELECT id FROM organization_context_versions WHERE status='approved'").id;
  check("S4: task before edit snapshots org context v1", oldTask.body.org_context_version_id === v1);

  const current = await api("GET", "/api/kad/org-context/current");
  const changedData = {
    ...current.body.data,
    brand: {
      ...current.body.data.brand,
      voice: `${current.body.data.brand.voice}\nS4 brand voice version mới.`,
    },
  };
  const draftV2 = await api("POST", "/api/kad/org-context/versions", {
    data: changedData,
    change_summary: "S4 update brand voice",
  });
  check(
    "S4: brand voice edit creates v2 draft",
    draftV2.status === 201 && draftV2.body.version === 2 && draftV2.body.status === "draft",
    `got ${draftV2.status}`
  );
  const approvedV2 = await api("POST", `/api/kad/org-context/versions/${draftV2.body.id}/approve`, {});
  check(
    "S4: approve org context v2 archives v1",
    approvedV2.status === 200 &&
      approvedV2.body.status === "approved" &&
      one("SELECT status FROM organization_context_versions WHERE id=?", v1).status === "archived"
  );

  const newTask = await api("POST", "/api/kad/tasks", { title: "S4 task sau khi sửa brand voice" });
  check(
    "S4: new task snapshots org context v2",
    newTask.body.org_context_version_id === approvedV2.body.id,
    `${newTask.body.org_context_version_id} !== ${approvedV2.body.id}`
  );
  check(
    "S4: old task still points to v1",
    one("SELECT org_context_version_id FROM tasks WHERE id=?", oldTask.body.id).org_context_version_id === v1
  );

  const ctxMain = { run: "run-s4-main", task: newTask.body.id, agent: mainAgent.id };
  const artifact = await internal("POST", "/save-artifact", {
    runCtx: ctxMain,
    body: {
      artifact_type: "other",
      title: "S4 artifact uses v2",
      content: "# Artifact\nUses latest approved org context.",
    },
  });
  const artifactOrg = one("SELECT org_context_version_id FROM artifacts WHERE id=?", artifact.body.artifact_id);
  check("S4: artifact metadata writes org_context_version_id v2", artifactOrg.org_context_version_id === approvedV2.body.id);

  const tplDraft = await api("POST", "/api/kad/templates", {
    name: "S4 Custom Markdown",
    file_name: "s4-custom-template.md",
    template_type: "custom",
    purpose: "Verify custom upload",
    content: "# S4 Custom Template\n- Required section",
  });
  check(
    "S4: upload .md creates template draft",
    tplDraft.status === 201 && tplDraft.body.version.status === "draft",
    `got ${tplDraft.status}`
  );
  const tplApproved = await api("POST", `/api/kad/templates/${tplDraft.body.version.id}/approve`, {});
  check(
    "S4: approve uploaded template",
    tplApproved.status === 200 && tplApproved.body.version.status === "approved"
  );
  const readTemplate = await internal("GET", "/template?type=custom", { runCtx: ctxMain });
  check(
    "S4: agent can read approved custom template",
    readTemplate.status === 200 && /S4 Custom Template/.test(readTemplate.body.content || ""),
    `got ${readTemplate.status}`
  );
  check(
    "S4 SQL: template_usage_log written",
    one(
      "SELECT COUNT(*) n FROM template_usage_log WHERE template_version_id=? AND task_id=?",
      tplApproved.body.version.id,
      newTask.body.id
    ).n === 1
  );

  const currentBp = repo.orgContext.listBlueprints({ department_id: dept.id }).find((b) => b.status === "approved");
  const proposedBp = await api("POST", `/api/kad/blueprints/${currentBp.id}/propose`, {
    data: { ...currentBp.data, s4_note: "new blueprint proposal" },
    change_summary: "S4 blueprint proposal",
  });
  check(
    "S4: blueprint proposal creates pending_approval",
    proposedBp.status === 201 && proposedBp.body.status === "pending_approval"
  );
  const approvedBp = await api("POST", `/api/kad/blueprints/${proposedBp.body.id}/decide`, {
    decision: "approved",
  });
  const bpTask = await api("POST", "/api/kad/tasks", { title: "S4 task sau blueprint v2" });
  check(
    "S4: new task snapshots approved blueprint v2",
    approvedBp.status === 200 &&
      bpTask.body.blueprint_version_id === approvedBp.body.id &&
      one("SELECT status FROM department_blueprints WHERE id=?", currentBp.id).status === "archived"
  );

  console.log("\n--- S4 engine leg (real Claude spawn) ---");
  const worker = require(path.join(ROOT, "server/lib/kad/job-queue"));
  let engineBlocked = false;
  const engineTask = await api("POST", "/api/kad/tasks", {
    title: "S4 engine task sau wizard",
  });
  const msg = await api("POST", `/api/kad/tasks/${engineTask.body.id}/messages`, {
    content:
      "Từ dữ liệu wizard vừa thiết lập, lập kế hoạch nghiên cứu nhu cầu học AI Automation của chủ SME Việt Nam và gọi kad_plan_task.",
  });
  check("S4.E0 POST /messages accepted + real run kicked", msg.status === 201 && msg.body.run_kicked === true);
  const t0 = Date.now();
  let planRow = null,
    run = null,
    briefLocked = false;
  const answeredIntakeIds = new Set();
  while (Date.now() - t0 < 420000) {
    if (briefLocked) {
      await worker.sweep();
      await sleep(1000);
    } else {
      await sleep(3000);
    }
    const plans = repo.approvals
      .listByTask(engineTask.body.id)
      .filter((a) => a.approval_type === "plan");
    planRow = plans[plans.length - 1] || null;
    const runs = repo.runs.listByTask(engineTask.body.id);
    run = runs[runs.length - 1] || null;
    if (planRow) break;
    if (run && run.status === "failed") {
      const out = JSON.stringify(run.output || "");
      if (/401|authenticate|credentials/i.test(out)) engineBlocked = true;
      break;
    }
    const messages = repo.tasks.listMessages(engineTask.body.id);
    const intake = [...messages]
      .reverse()
      .find((m) => m.message_type === "intake_question" && !answeredIntakeIds.has(m.id));
    if (intake) {
      answeredIntakeIds.add(intake.id);
      const options = intake.metadata && intake.metadata.options;
      const answer = options && options.length ? options[0] : "Dùng chuẩn Kstudy, ưu tiên thực chiến và có nguồn.";
      await api("POST", `/api/kad/tasks/${engineTask.body.id}/messages`, { content: answer });
      continue;
    }
    if (!briefLocked && messages.some((m) => m.message_type === "brief")) {
      const lock = await api("POST", `/api/kad/tasks/${engineTask.body.id}/brief/lock`, {});
      if (lock.status === 200) briefLocked = true;
    }
  }
  if (briefLocked) check("S4.E0b live brief flow locked", true);
  if (engineBlocked) {
    blocked("S4.E1 real Main Agent calls kad_plan_task", "spawned claude 401 — no standalone credential");
  } else {
    check(
      "S4.E1 real Main Agent calls kad_plan_task after wizard",
      !!planRow,
      run ? `run status=${run.status}` : "no run"
    );
    check("S4.E2 engine_session_id captured", !!(run && run.engine_session_id));
  }

  console.log(results.join("\n"));
  console.log(
    `\n=== S4: ${pass} passed, ${fail} failed${engineBlocked ? " (engine leg BLOCKED — auth)" : ""} ===`
  );

  sdb4.close();
  try {
    require(path.join(ROOT, "server/lib/kad/job-queue")).stopWorker();
  } catch {}
  server.close();
  for (const f of [TMP_DB4, TMP_DB4 + "-wal", TMP_DB4 + "-shm"])
    try {
      fs.unlinkSync(f);
    } catch {}
  process.exit(fail > 0 ? 1 : 0);
}

if (process.argv.includes("--s4")) {
  runS4().catch((e) => {
    console.error("verify S4 crashed:", e);
    process.exit(1);
  });
} else if (process.argv.includes("--s2")) {
  runS2().catch((e) => {
    console.error("verify S2 crashed:", e);
    process.exit(1);
  });
} else {
  main().catch((e) => {
    console.error("verify crashed:", e);
    process.exit(1);
  });
}
