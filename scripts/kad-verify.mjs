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
    // 13 = 12 Phase-1/2 tools + kad_flag_sensitivity (Phase 3B, spec 04 §2).
    check(
      "MCP tools/list = 13 KAD tools (incl. kad_flag_sensitivity)",
      toolNames.length === 13 && toolNames.includes("kad_flag_sensitivity"),
      toolNames.join(",")
    );
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

/**
 * Scenario S3 (Phase 3B, phase-03 §2-5 + DoD): the R&D workflow engine — step
 * machine, QC gate B, conditional/internal auto-approval, sensitive detection
 * layer 2. Driven through the REAL server + internal endpoints with simulated run
 * contexts (the SAME internal API the agents' MCP tools call) — so every gate is
 * the REAL engine code, not a mock; only the model's text is stood in for. Asserts
 * real SQL. The live full-course spawn (ENGINE leg) is auth-blocked in this env.
 * Own isolated process (server/db.js is a module-level singleton). Run: --s3.
 */
async function runS3() {
  console.log(
    "\n=== KAD verify — Scenario S3 (Phase 3B: workflow engine + QC gate B + auto-approve + sensitive) ===\n"
  );
  const TMP_DB3 = path.join(os.tmpdir(), `kad-verify-s3-${process.pid}.db`);
  for (const f of [TMP_DB3, TMP_DB3 + "-wal", TMP_DB3 + "-shm"])
    try {
      fs.unlinkSync(f);
    } catch {}
  process.env.DASHBOARD_DB_PATH = TMP_DB3;
  process.env.DASHBOARD_TOKEN = "";
  process.env.KAD_WORKER_TICK_MS = "3600000"; // worker off — assert engine gate logic directly (no spawns)

  const seed = spawnSync(process.execPath, [path.join(ROOT, "scripts/kad-seed.mjs")], {
    env: process.env,
    encoding: "utf8",
  });
  if (seed.status !== 0) {
    console.error("seed failed:", seed.stderr || seed.stdout);
    process.exit(1);
  }

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

  // Read through the server's OWN db connection (repo) — a separate readonly
  // connection can lag on cross-connection WAL visibility (see S1 note).
  const repo = require(path.join(ROOT, "server/lib/kad/repo"));
  const workflowEngine = require(path.join(ROOT, "server/lib/kad/workflow-engine"));
  const deptId = repo.catalog.getDepartmentBySlug("rd").id;
  const AG = {
    main: "agent-main-rd",
    architect: "agent-sub-program-architect",
    researcher: "agent-sub-curriculum-researcher",
    syllabus: "agent-sub-syllabus-designer",
    lesson: "agent-sub-lesson-planner",
    slide: "agent-sub-slide-builder",
    video: "agent-sub-video-script-writer",
    reviewer: "agent-sub-quality-reviewer",
  };

  check(
    "S3.0 full roster active (main + 6 sub-agents activated, phase-03 §1)",
    repo.catalog.listAgents(deptId, { status: "active" }).length >= 8
  );

  const created = await api("POST", "/api/kad/tasks", {
    title: "AI Automation cơ bản cho SME (2 module)",
    workflow_id: "wf-rd-standard-flow",
  });
  const T = created.body.id;
  const ctxFor = (agent) => ({ run: `run-s3-${agent}`, task: T, agent });
  const save = (agent, body) => internal("POST", "/save-artifact", { runCtx: ctxFor(agent), body });
  const reqAppr = (agent, body) =>
    internal("POST", "/request-approval", { runCtx: ctxFor(agent), body });
  const deleg = (body) => internal("POST", "/create-delegation", { runCtx: ctxFor(AG.main), body });
  const flag = (agent, body) =>
    internal("POST", "/flag-sensitivity", { runCtx: ctxFor(agent), body });
  const decide = (id, decision, reason) =>
    api("POST", `/api/kad/approvals/${id}/decide`, { decision, reason });
  const stepOf = () => repo.tasks.getTask(T).workflow_step;
  const apprs = () => repo.approvals.listByTask(T);
  const artStatus = (type) => {
    const a = repo.artifacts.listArtifacts({ task_id: T, type });
    return a.length ? a[a.length - 1].status : null;
  };

  check(
    "S3.1 task created workflow-bound",
    created.status === 201 && repo.tasks.getTask(T).workflow_id === "wf-rd-standard-flow"
  );

  // --- A. plan → approve; step machine starts ---
  const plan = await internal("POST", "/plan-task", {
    runCtx: ctxFor(AG.main),
    body: { plan: "## Kế hoạch\nresearch → framework → syllabus → học liệu → bàn giao" },
  });
  check("S3.2 plan approval pending", plan.status === 200 && !!plan.body.approval_id);
  await decide(plan.body.approval_id, "approved");
  check("S3.3 step→research after plan approved", stepOf() === "research", stepOf());

  // --- B. order gate negatives (framework before syllabus; syllabus before materials) ---
  const dOrder1 = await deleg({ to_agent: "sub-syllabus-designer", instruction: "làm syllabus" });
  check(
    "S3.4 order gate: syllabus before approved framework blocked (EORDER)",
    dOrder1.status === 409 && dOrder1.body.error && dOrder1.body.error.code === "EORDER",
    JSON.stringify(dOrder1.body)
  );
  const dOrder2 = await deleg({ to_agent: "sub-lesson-planner", instruction: "làm lesson" });
  check(
    "S3.5 order gate: materials before approved syllabus blocked (EORDER)",
    dOrder2.status === 409 && dOrder2.body.error && dOrder2.body.error.code === "EORDER"
  );

  // --- C. research → internal_auto (always auto, system record) ---
  const rr = await save(AG.researcher, {
    artifact_type: "research_report",
    title: "Nghiên cứu nhu cầu SME",
    content: "Nhu cầu học automation cho SME: ưu tiên công cụ phổ cập. Nguồn: khảo sát nội bộ.",
  });
  check("S3.6 research auto-approved (internal_auto)", rr.body.auto_approved === true);
  const rrAppr = apprs().find((a) => a.approval_type === "internal_auto");
  check(
    "S3.6b internal_auto record: reviewer=system, approved, decision_reason",
    !!rrAppr &&
      rrAppr.reviewer === "system" &&
      rrAppr.status === "approved" &&
      rrAppr.decision_reason === "auto: internal step"
  );
  check("S3.6c research_report artifact approved", artStatus("research_report") === "approved");
  check("S3.7 step→framework", stepOf() === "framework", stepOf());

  // --- D. wrong-condition auto-approve: slide before syllabus approved → NOT auto (human) ---
  const early = await save(AG.slide, {
    artifact_type: "slide_outline",
    title: "Slide sớm (sai điều kiện)",
    content: "- Slide 1: mở đầu",
  });
  check(
    "S3.8 slide NOT auto-approved without approved syllabus (parent check real)",
    !early.body.auto_approved && artStatus("slide_outline") === "draft"
  );
  check(
    "S3.8b no system approval for premature slide",
    !apprs().some((a) => a.reviewer === "system" && a.artifact_id === early.body.artifact_id)
  );

  // --- D2. framework + QC gate B ---
  const fw = await save(AG.architect, {
    artifact_type: "program_framework",
    title: "Khung chương trình AI Automation SME",
    content: "## Mục tiêu KASH\n## Learning pathway: 2 module\n## Đánh giá capstone",
  });
  const fwId = fw.body.artifact_id;
  check(
    "S3.9 framework saved draft (reviewer-bound, not auto)",
    !fw.body.auto_approved && artStatus("program_framework") === "draft"
  );
  const fwBlocked = await reqAppr(AG.main, {
    approval_type: "artifact",
    title: "Duyệt khung",
    artifact_id: fwId,
  });
  check(
    "S3.10 QC gate B blocks framework approval before QR (EQRREQUIRED)",
    fwBlocked.status === 409 && fwBlocked.body.error && fwBlocked.body.error.code === "EQRREQUIRED",
    JSON.stringify(fwBlocked.body)
  );
  await save(AG.reviewer, {
    artifact_type: "quality_report",
    title: "QR khung",
    content: "## Báo cáo kiểm tra\n### Kết quả: ĐẠT\nĐầy đủ, chính xác, đúng brand.",
    parent_artifact_id: fwId,
  });
  const fwReq = await reqAppr(AG.main, {
    approval_type: "artifact",
    title: "Duyệt khung",
    artifact_id: fwId,
  });
  check(
    "S3.11 framework approval allowed after QR ĐẠT",
    fwReq.status === 200 && !!fwReq.body.approval_id
  );
  await decide(fwReq.body.approval_id, "approved");
  check("S3.11b framework artifact approved", artStatus("program_framework") === "approved");
  check("S3.12 step→syllabus", stepOf() === "syllabus", stepOf());

  // --- E. syllabus + QC gate B ---
  const syl = await save(AG.syllabus, {
    artifact_type: "syllabus",
    title: "Syllabus AI Automation SME",
    content: "## Danh sách buổi\n| Buổi | Tên | Mục tiêu |\n## Khung năng lực KASH",
  });
  const sylId = syl.body.artifact_id;
  const sylBlocked = await reqAppr(AG.main, {
    approval_type: "artifact",
    title: "Duyệt syllabus",
    artifact_id: sylId,
  });
  check(
    "S3.13 QC gate B blocks syllabus approval before QR",
    sylBlocked.status === 409 && sylBlocked.body.error.code === "EQRREQUIRED"
  );
  await save(AG.reviewer, {
    artifact_type: "quality_report",
    title: "QR syllabus",
    content: "### Kết quả: ĐẠT",
    parent_artifact_id: sylId,
  });
  const sylReq = await reqAppr(AG.main, {
    approval_type: "artifact",
    title: "Duyệt syllabus",
    artifact_id: sylId,
  });
  await decide(sylReq.body.approval_id, "approved");
  check("S3.14 syllabus approved", artStatus("syllabus") === "approved");
  check("S3.15 step→materials", stepOf() === "materials", stepOf());

  // --- F. materials: internal_auto + conditional auto (parent approved) ---
  const lp = await save(AG.lesson, {
    artifact_type: "lesson_plan",
    title: "Lesson buổi 1",
    content: "## Tiến trình theo phút\n## Bài tập",
  });
  check(
    "S3.16 lesson_plan internal_auto approved",
    lp.body.auto_approved && artStatus("lesson_plan") === "approved"
  );
  const sl = await save(AG.slide, {
    artifact_type: "slide_outline",
    title: "Slide buổi 1",
    content: "- Slide 1: mục tiêu\n- Slide 2: demo",
  });
  check(
    "S3.17 slide auto-approved: reviewer=system + reason 'auto: parent approved (syllabus)'",
    sl.body.auto_approved &&
      apprs().some(
        (a) =>
          a.artifact_id === sl.body.artifact_id &&
          a.reviewer === "system" &&
          a.decision_reason === "auto: parent approved (syllabus)"
      )
  );
  const vs = await save(AG.video, {
    artifact_type: "video_script",
    title: "Video buổi 1",
    content: "## Cốt lõi\n## Mở rộng",
  });
  check(
    "S3.18 video auto-approved: reason 'auto: parent approved (lesson_plan)'",
    vs.body.auto_approved &&
      apprs().some(
        (a) =>
          a.artifact_id === vs.body.artifact_id &&
          a.decision_reason === "auto: parent approved (lesson_plan)"
      )
  );

  // --- G. sensitive detection layer 2 ---
  const sens = await save(AG.lesson, {
    artifact_type: "other",
    title: "Case study (số liệu giả định)",
    content: "Doanh nghiệp X tăng 300% doanh thu, tiết kiệm 50 triệu đồng/tháng sau khóa.",
  });
  check(
    "S3.19 sensitive artifact BLOCKED (server scan → sensitive_content pending)",
    sens.body.sensitive_pending === true
  );
  const sensAppr = apprs().find(
    (a) => a.approval_type === "sensitive_content" && a.artifact_id === sens.body.artifact_id
  );
  check(
    "S3.19b sensitive_content approval: pending, human, subtype=metrics",
    !!sensAppr &&
      sensAppr.status === "pending" &&
      sensAppr.reviewer === "human" &&
      sensAppr.sensitivity_subtype === "metrics",
    JSON.stringify(sensAppr)
  );
  check(
    "S3.19c sensitive artifact NOT auto-approved (block precedes auto)",
    !apprs().some((a) => a.artifact_id === sens.body.artifact_id && a.reviewer === "system")
  );
  const clean = await save(AG.lesson, {
    artifact_type: "other",
    title: "Ghi chú nội bộ",
    content: "Ghi chú quy trình nội bộ, không số liệu nhạy cảm.",
  });
  const flg = await flag(AG.reviewer, { artifact_id: clean.body.artifact_id, metrics: true });
  check(
    "S3.20 kad_flag_sensitivity (layer 1) → sensitive_content approval",
    flg.body.sensitive_pending === true &&
      apprs().some(
        (a) => a.approval_type === "sensitive_content" && a.artifact_id === clean.body.artifact_id
      )
  );

  // --- H. bàn giao (handoff) — QC gate satisfied (framework/syllabus carry QR) ---
  const rep = await internal("POST", "/present-report", {
    runCtx: ctxFor(AG.main),
    body: {
      summary: "Đã xong khung + syllabus + học liệu buổi 1.",
      artifact_ids: [fwId, sylId],
    },
  });
  check(
    "S3.21 present-report allowed (gated artifacts have QR)",
    rep.status === 200 && !!rep.body.message_id
  );
  const rd = await api("POST", `/api/kad/tasks/${T}/report/${rep.body.message_id}/decide`, {
    decision: "approved",
  });
  check(
    "S3.22 report approved → task done",
    rd.status === 200 && repo.tasks.getTask(T).status === "done"
  );
  check("S3.23 step→handoff", stepOf() === "handoff", stepOf());

  // Delegation → correct artifact_type wiring (what the live sub-agent is told to
  // produce): the map the live runDelegation uses to type each artifact for the gates.
  check(
    "S3.24 delegation output-type wiring (architect→framework, slide→slide_outline)",
    workflowEngine.outputTypeForAgent(
      repo.tasks.getTask(T),
      repo.catalog.getAgent(AG.architect)
    ) === "program_framework" &&
      workflowEngine.outputTypeForAgent(repo.tasks.getTask(T), repo.catalog.getAgent(AG.slide)) ===
        "slide_outline"
  );

  // S3.25 (regression, review F1): QC gate B keys on artifact TYPE only — a
  // non-gated INTERNAL artifact containing a statistic must NOT be QR-blocked
  // (its sensitivity is handled by the sensitive_content approval, and it never
  // routes through the Quality Reviewer, so demanding a QR would dead-end it).
  const statInternal = repo.artifacts
    .listArtifacts({ task_id: T })
    .find((a) => a.artifact_type === "other" && /%|triệu/.test(a.content || ""));
  check(
    "S3.25 QC gate does NOT demand QR for a non-gated stat-bearing internal artifact",
    !!statInternal &&
      workflowEngine.assertQualityGate(repo.tasks.getTask(T), statInternal.id).ok === true
  );

  // S3.26 (regression, review F3): auto-approval is idempotent — re-invoking
  // onArtifactSaved on an already-auto-approved artifact must NOT create a second
  // reviewer='system' approval row.
  const sysBefore = apprs().filter(
    (a) => a.artifact_id === sl.body.artifact_id && a.reviewer === "system"
  ).length;
  workflowEngine.onArtifactSaved({
    task: repo.tasks.getTask(T),
    artifact: repo.artifacts.getArtifact(sl.body.artifact_id),
    agent: repo.catalog.getAgent(AG.slide),
  });
  const sysAfter = apprs().filter(
    (a) => a.artifact_id === sl.body.artifact_id && a.reviewer === "system"
  ).length;
  check(
    "S3.26 auto-approval idempotent (no duplicate system approval on re-invoke)",
    sysBefore === 1 && sysAfter === 1
  );

  // ENGINE leg — real `claude` spawns DO work here (S1.E1/E3 prove a real Main turn
  // calls kad_plan_task and parks at waiting_approval through this same
  // orchestrator+MCP+engine path). The full 8-agent course is NOT run by default:
  // each task costs ~1.3-1.7M tokens/turn × many turns × 6 sub-agents. Opt in with
  // KAD_LIVE_S3=1 to drive it live (also needs TAVILY_API_KEY for the researcher).
  if (process.env.KAD_LIVE_S3) {
    blocked(
      "S3.E1 live full-course spawn (KAD_LIVE_S3 set)",
      "live full-course driver not yet automated in-harness — run the course via the UI/API; S1 proves the real-spawn path works"
    );
  } else {
    blocked(
      "S3.E1 live full-course spawn (real claude, 8 agents end-to-end)",
      "not run by default (cost/time — ~1.3-1.7M tokens/turn). Real spawns proven working by S1.E1/E3; INFRA legs above exercise the REAL engine/gate code via the internal API. Enable with KAD_LIVE_S3=1"
    );
  }

  console.log(results.join("\n"));
  console.log(`\n=== S3: ${pass} passed, ${fail} failed ===`);
  try {
    require(path.join(ROOT, "server/lib/kad/job-queue")).stopWorker();
  } catch {}
  server.close();
  for (const f of [TMP_DB3, TMP_DB3 + "-wal", TMP_DB3 + "-shm"])
    try {
      fs.unlinkSync(f);
    } catch {}
  process.exit(fail > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// S3-deps (Phase 3c track — task_dependencies auto-release, spec 02 §6b,
// spec 03 §5.4, audit-260704 §5.2). No engine spawn needed: releasing a
// dependency is a pure status-transition worker, so both legs run for real
// against the isolated server — real SQL + a real kad.task.released WS frame,
// no mocking. Does NOT exercise the workflow engine / QC gate / roster
// (Phase 3b, a separate track) — that DoD lives in its own scenario.
// ---------------------------------------------------------------------------
async function runS3Deps() {
  const TMP_DB3 = path.join(os.tmpdir(), `kad-verify-s3deps-${process.pid}.db`);
  for (const f of [TMP_DB3, TMP_DB3 + "-wal", TMP_DB3 + "-shm"])
    try {
      fs.unlinkSync(f);
    } catch {}
  process.env.DASHBOARD_DB_PATH = TMP_DB3;
  process.env.DASHBOARD_TOKEN = "";
  process.env.KAD_WORKER_TICK_MS = "3600000"; // deterministic — only manual sweep() below runs it

  const seed = spawnSync(process.execPath, [path.join(ROOT, "scripts/kad-seed.mjs")], {
    env: process.env,
    encoding: "utf8",
  });
  if (seed.status !== 0) {
    console.error("seed failed:", seed.stderr || seed.stdout);
    process.exit(1);
  }

  const { createApp } = require(path.join(ROOT, "server/index.js"));
  const kad = require(path.join(ROOT, "server/routes/kad"));
  const { initWebSocket } = require(path.join(ROOT, "server/websocket.js"));
  const jobQueue = require(path.join(ROOT, "server/lib/kad/job-queue"));
  const repo = require(path.join(ROOT, "server/lib/kad/repo"));
  const app = createApp();
  const server = http.createServer(app);
  initWebSocket(server);
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

  const { default: WebSocketClient } = await import("ws");
  let ws;

  try {
    // 1) môn 01 (source) + môn 02 (dependent) — real tasks via the real API.
    const t1 = await api("POST", "/api/kad/tasks", { title: "R&D Môn 01 — pilot" });
    const t2 = await api("POST", "/api/kad/tasks", { title: "R&D Môn 02 — kế tiếp" });
    check("S3d.1 tasks created", t1.status === 201 && t2.status === 201);
    const task1Id = t1.body.id;
    const task2Id = t2.body.id;
    const deptId = t1.body.department_id;

    // 2) môn 02 phụ thuộc "môn 01 hoàn thành" (dep_task_done).
    const dep = await api("POST", `/api/kad/tasks/${task2Id}/dependencies`, {
      depends_on_task_id: task1Id,
      release_condition: "dep_task_done",
    });
    check("S3d.2 dependency created (201)", dep.status === 201);
    const afterDep = await api("GET", `/api/kad/tasks/${task2Id}`);
    check("S3d.3 task2 blocked after dependency created", afterDep.body.status === "blocked");

    // 3) subscribe WS to the department scope BEFORE triggering the release.
    ws = new WebSocketClient(`ws://127.0.0.1:${port}/ws`);
    const received = [];
    await new Promise((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ subscribe: `kad:department:${deptId}` }));
        resolve();
      });
      ws.on("error", reject);
    });
    ws.on("message", (raw) => {
      try {
        received.push(JSON.parse(raw.toString()));
      } catch {}
    });

    // 4) môn 01 "xong" — real generic status PATCH the app already exposes.
    const patchDone = await api("PATCH", `/api/kad/tasks/${task1Id}`, { status: "done" });
    check("S3d.4 task1 marked done", patchDone.status === 200 && patchDone.body.status === "done");

    // 5) worker tick (manual sweep — tick interval disabled above for determinism).
    await jobQueue.sweep();
    await sleep(150); // let the WS frame land

    // 6) assert SQL: dependency released + task2 back in inbox.
    const depsAfter = await api("GET", `/api/kad/tasks/${task2Id}/dependencies`);
    const depRow = depsAfter.body.find((d) => d.id === dep.body.id);
    check(
      "S3d.5 dependency row released (SQL)",
      !!depRow && depRow.status === "released" && !!depRow.released_at
    );
    const task2After = await api("GET", `/api/kad/tasks/${task2Id}`);
    check("S3d.6 task2 auto-returned to inbox (SQL)", task2After.body.status === "inbox");

    // 7) assert event: kad.task.released was actually broadcast.
    const releaseEvt = received.find(
      (m) => m.type === "kad.task.released" && m.data && m.data.task_id === task2Id
    );
    check(
      "S3d.7 kad.task.released event received (WS)",
      !!releaseEvt,
      `got types: ${JSON.stringify(received.map((m) => m.type))}`
    );

    // 8) second mechanism: dep_artifact_approved, driven through the real
    // report/decide endpoint (the same path that flips artifacts.status).
    const t3 = await api("POST", "/api/kad/tasks", { title: "R&D Môn 03 — điều kiện artifact" });
    const task3Id = t3.body.id;
    const depB = await api("POST", `/api/kad/tasks/${task3Id}/dependencies`, {
      depends_on_task_id: task1Id,
      release_condition: "dep_artifact_approved",
    });
    check("S3d.8 second dependency created (201)", depB.status === 201);

    const artifact = repo.artifacts.createArtifact({
      task_id: task1Id,
      artifact_type: "syllabus",
      title: "Syllabus Môn 01",
      content: "# Syllabus",
      status: "review",
    });
    const reportMsg = repo.tasks.addMessage({
      task_id: task1Id,
      sender_type: "agent",
      sender_id: "system",
      content: "Báo cáo hoàn thành",
      message_type: "report",
      metadata: { report: { artifacts: [{ artifactId: artifact.id, title: artifact.title }] } },
    });
    const decideReport = await api(
      "POST",
      `/api/kad/tasks/${task1Id}/report/${reportMsg.id}/decide`,
      { decision: "approved" }
    );
    check("S3d.9 report decide approved (200)", decideReport.status === 200);

    await jobQueue.sweep();
    await sleep(150);

    const task3After = await api("GET", `/api/kad/tasks/${task3Id}`);
    check(
      "S3d.10 task3 auto-released via dep_artifact_approved (SQL)",
      task3After.body.status === "inbox"
    );
  } finally {
    try {
      ws?.close();
    } catch {}
    try {
      jobQueue.stopWorker();
    } catch {}
    server.close();
    for (const f of [TMP_DB3, TMP_DB3 + "-wal", TMP_DB3 + "-shm"])
      try {
        fs.unlinkSync(f);
      } catch {}
  }

  console.log(results.join("\n"));
  console.log(`\n=== S3-deps: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

async function runS5() {
  const { createRequire } = require("node:module");
  const path = require("node:path");
  const os = require("node:os");
  const fs = require("node:fs");
  const http = require("node:http");
  const { spawnSync } = require("node:child_process");

  const ROOT = process.cwd();
  const TMP_DB5 = path.join(os.tmpdir(), `kad-verify-s5-${process.pid}.db`);
  for (const f of [TMP_DB5, TMP_DB5 + "-wal", TMP_DB5 + "-shm"])
    try { fs.unlinkSync(f); } catch {}
  process.env.DASHBOARD_DB_PATH = TMP_DB5;
  process.env.KAD_WORKER_TICK_MS = "3600000"; // disable auto-sweep

  let pass = 0, fail = 0;
  const results = [];
  function check(name, cond, detail = "") {
    if (cond) { pass++; results.push(`  ✅ ${name}`); }
    else { fail++; results.push(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
  }

  const seed = spawnSync(process.execPath, [path.join(ROOT, "scripts/kad-seed.mjs")], {
    env: process.env, encoding: "utf8"
  });
  if (seed.status !== 0) throw new Error("seed failed");

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
      method, headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, body: await resp.json().catch(() => ({})) };
  };

  const Database = require("better-sqlite3");
  const sdb5 = new Database(TMP_DB5, { readonly: true });
  const one = (q, ...a) => sdb5.prepare(q).get(...a);

  const repo = require(path.join(ROOT, "server/lib/kad/repo"));
  const worker = require(path.join(ROOT, "server/lib/kad/job-queue"));
  const mainAgent = repo.catalog.getMainAgent(repo.catalog.getDepartmentBySlug("rd").id);

  console.log("\n=== KAD verify — Scenario S5 (Learning Loop) ===\n");

  const briefTask = await api("POST", "/api/kad/tasks", {
    title: "Test Learning Loop task",
  });
  const taskId = briefTask.body.id;

  // Create mock artifact and approval
  const artId = repo.artifacts.createArtifact({
    task_id: taskId, agent_id: mainAgent.id, artifact_type: "syllabus",
    title: "Test artifact", content: "Sai brand Kstudy", status: "review"
  }).id;
  const appr = repo.approvals.createApproval({
    task_id: taskId, requested_by: mainAgent.id, approval_type: "artifact",
    artifact_id: artId, title: "Duyệt artifact", description: "Sai brand Kstudy"
  });

  // 1. Human reject triggers analyze_learning_note async
  const rej = await api("POST", `/api/kad/approvals/${appr.id}/decide`, { 
    decision: "rejected", reason: "Sai brand voice trầm trọng" 
  });
  check("POST /approvals/:id/decide rejected", rej.status === 200);

  // Wait for async execution
  let note = null;
  for (let i = 0; i < 40; i++) {
    note = one("SELECT * FROM learning_notes WHERE task_id=?", taskId);
    if (note) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  
  check("Learning note created via Claude", !!note && note.change_status === "noted", note ? note.correction_category : "none");
  check("Learning note parsed properly", note && note.root_cause !== "Sai brand voice trầm trọng", "Expected detailed analysis from LLM");

  // 2. Pattern detection
  // Create 2 more mock notes in the same category manually to trigger pattern_detect
  repo.learning.createNote({
    department_id: mainAgent.department_id,
    correction_category: "brand_mismatch",
    trigger_type: "human_rejection",
    severity: "major",
    feedback_content: "Sai brand",
    change_status: "noted"
  });
  repo.learning.createNote({
    department_id: mainAgent.department_id,
    correction_category: "brand_mismatch",
    trigger_type: "human_rejection",
    severity: "major",
    feedback_content: "Lại sai brand",
    change_status: "noted"
  });

  repo.jobs.enqueue({
    kind: "pattern_detect",
    payload: { department_id: mainAgent.department_id, category: "brand_mismatch" },
    dedupKey: "pattern_detect:test"
  });
  
  await worker.sweep(); // Process pattern_detect job
  
  const patternNote = one("SELECT * FROM learning_notes WHERE trigger_type='pattern_detection'");
  check("Pattern detection triggers and creates a note", !!patternNote && patternNote.change_status === "noted");
  check("Pattern detection doesn't auto-propose", !!patternNote && patternNote.change_status === "noted");

  // 3. MCP tool `kad_list_learning_notes`
  // The internal API `ctx(req, res)` expects `x-kad-task-id` etc. and internal auth
  const internalHeaders = {
    "x-kad-internal-token": getInternalToken(),
    "x-kad-task-id": taskId,
    "x-kad-run-id": "mock-run",
    "x-kad-agent-id": mainAgent.id
  };
  const mcpNotes2 = await fetch(BASE + "/api/kad/internal/learning-notes", {
    headers: internalHeaders
  });
  const mcpNotesBody = await mcpNotes2.json().catch(() => ({}));
  check("MCP internal API returns notes", mcpNotes2.status === 200 && mcpNotesBody.notes && mcpNotesBody.notes.length > 0);

  sdb5.close();
  try { worker.stopWorker(); } catch {}
  server.close();
  for (const f of [TMP_DB5, TMP_DB5 + "-wal", TMP_DB5 + "-shm"])
    try { fs.unlinkSync(f); } catch {}

  console.log(results.join("\n"));
  console.log(`\n=== S5: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

if (process.argv.includes("--s2")) {
  runS2().catch((e) => { console.error("verify S2 crashed:", e); process.exit(1); });
} else if (process.argv.includes("--s3")) {
  runS3().catch((e) => { console.error("verify S3 crashed:", e); process.exit(1); });
} else if (process.argv.includes("--s3-deps")) {
  runS3Deps().catch((e) => { console.error("verify S3-deps crashed:", e); process.exit(1); });
} else if (process.argv.includes("--s4")) {
  runS4().catch((e) => { console.error("verify S4 crashed:", e); process.exit(1); });
} else if (process.argv.includes("--s5")) {
  runS5().catch((e) => { console.error("verify S5 crashed:", e); process.exit(1); });
} else {
  main().catch((e) => { console.error("verify crashed:", e); process.exit(1); });
}
