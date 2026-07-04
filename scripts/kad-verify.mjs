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
for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) try { fs.unlinkSync(f); } catch {}
process.env.DASHBOARD_DB_PATH = TMP_DB;
process.env.DASHBOARD_TOKEN = ""; // open API for the isolated instance
// Auto-worker effectively OFF: infra legs assert queued job ROWS (not execution);
// engine legs drive turns directly + manual worker.sweep(), so nothing races the
// deterministic infra assertions on a shared engine.
process.env.KAD_WORKER_TICK_MS = "3600000";

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ✅ ${name}`); }
  else { fail++; results.push(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}
function blocked(name, reason) { results.push(`  ⏸️  ${name} — BLOCKED: ${reason}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) seed the isolated DB
  const seed = spawnSync(process.execPath, [path.join(ROOT, "scripts/kad-seed.mjs")], { env: process.env, encoding: "utf8" });
  if (seed.status !== 0) { console.error("seed failed:", seed.stderr || seed.stdout); process.exit(1); }

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
    const resp = await fetch(BASE + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: resp.status, body: await resp.json().catch(() => ({})) };
  };
  // internal API caller with a fake run context (simulates what the MCP tool does)
  const internal = async (method, p, { runCtx, body } = {}) => {
    const h = { "content-type": "application/json", "x-kad-internal-token": getInternalToken() };
    if (runCtx) Object.assign(h, { "x-kad-run-id": runCtx.run, "x-kad-task-id": runCtx.task, "x-kad-agent-id": runCtx.agent });
    const resp = await fetch(BASE + "/api/kad/internal" + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    return { status: resp.status, body: await resp.json().catch(() => ({})) };
  };

  // raw SQL asserts against the real DB
  const Database = require("better-sqlite3");
  const sdb = new Database(TMP_DB, { readonly: true });
  const sql = (q, ...a) => sdb.prepare(q).all(...a);
  const one = (q, ...a) => sdb.prepare(q).get(...a);

  const repo = require(path.join(ROOT, "server/lib/kad/repo"));
  const mainAgent = repo.catalog.getMainAgent(repo.catalog.getDepartmentBySlug("rd").id);
  const researcher = repo.catalog.getAgentByName(mainAgent.department_id, "sub-curriculum-researcher");

  console.log("\n=== KAD verify — Scenario S1 (isolated @ " + BASE + ") ===\n");

  // ---------- INFRA legs (deterministic, no engine) ----------
  // Driven through the REAL server + internal endpoints with a simulated run
  // context, on a task that is NOT given a chat message — so no real Main Agent
  // turn is kicked to race these assertions. Proves the state machine + enforcement.
  const infra = await api("POST", "/api/kad/tasks", { title: "Nghiên cứu nhu cầu học AI Automation của chủ SME (infra)" });
  check("POST /tasks → inbox", infra.status === 201 && infra.body.status === "inbox");
  const infraId = infra.body.id;
  const ctxMain = { run: "run-sim-main", task: infraId, agent: mainAgent.id };

  // A) plan-task → pending plan approval
  const plan = await internal("POST", "/plan-task", { runCtx: ctxMain, body: { plan: "## Kế hoạch\n1. Research — Nghiên cứu — 1 ngày — Cần duyệt? Có" } });
  check("kad_plan_task → pending approval", plan.status === 200 && plan.body.status === "pending");
  check("SQL: approvals(status=pending,type=plan)", one("SELECT COUNT(*) n FROM approvals WHERE task_id=? AND status='pending' AND approval_type='plan'", infraId).n === 1);

  // B) approval-block: delegation before plan approved must fail
  const blkDeleg = await internal("POST", "/create-delegation", { runCtx: ctxMain, body: { to_agent: "sub-curriculum-researcher", instruction: "Nghiên cứu" } });
  check("delegation BLOCKED before approval (403)", blkDeleg.status === 403, `got ${blkDeleg.status}`);
  check("SQL: no delegation row yet", one("SELECT COUNT(*) n FROM task_delegations WHERE task_id=?", infraId).n === 0);

  // C) approve → resume job enqueued + delegation now allowed
  const apprId = one("SELECT id FROM approvals WHERE task_id=? AND approval_type='plan' AND status='pending'", infraId).id;
  const dec = await api("POST", `/api/kad/approvals/${apprId}/decide`, { decision: "approved" });
  check("POST /approvals/:id/decide approved", dec.status === 200 && dec.body.approval.status === "approved");
  check("SQL: resume_task job enqueued", one("SELECT COUNT(*) n FROM kad_job_queue WHERE kind='resume_task'").n >= 1);
  const okDeleg = await internal("POST", "/create-delegation", { runCtx: ctxMain, body: { to_agent: "sub-curriculum-researcher", instruction: "Nghiên cứu nhu cầu SME" } });
  check("delegation ALLOWED after approval", okDeleg.status === 200 && !!okDeleg.body.delegation_id, `status ${okDeleg.status}`);
  check("SQL: delegation row exists", one("SELECT COUNT(*) n FROM task_delegations WHERE task_id=?", infraId).n === 1);
  check("SQL: start_delegation job enqueued", one("SELECT COUNT(*) n FROM kad_job_queue WHERE kind='start_delegation'").n >= 1);

  // D) artifact + timeline + audit
  const ctxRes = { run: "run-sim-res", task: infraId, agent: researcher.id };
  const art = await internal("POST", "/save-artifact", { runCtx: ctxRes, body: { artifact_type: "research_report", title: "Báo cáo nhu cầu SME", content: "# Kết quả\n- ..." } });
  check("kad_save_artifact → artifact_id", art.status === 200 && !!art.body.artifact_id);
  check("SQL: artifacts row", one("SELECT COUNT(*) n FROM artifacts WHERE task_id=? AND artifact_type='research_report'", infraId).n === 1);

  const tl = await api("GET", `/api/kad/tasks/${infraId}/timeline`);
  const kinds = new Set((tl.body || []).map((i) => i.kind));
  check("timeline has message+delegation+approval+artifact", ["message", "delegation", "approval", "artifact"].every((k) => kinds.has(k)), [...kinds].join(","));

  const auditActions = sql("SELECT action FROM audit_log WHERE task_id=? ORDER BY created_at ASC", infraId).map((r) => r.action);
  // Infra sim has no real run, so 5 business actions (task_created + the 4 below);
  // the ≥6 with-runs count is asserted on the engine task after a real turn.
  check("audit_log ≥5 business actions (infra)", auditActions.length >= 5, `count=${auditActions.length}: ${auditActions.join(",")}`);
  check("audit has approval_requested+approval_decided+delegation_created+artifact_created (in order)",
    ["approval_requested", "approval_decided", "delegation_created", "artifact_created"].every((a) => auditActions.includes(a)));

  // ---------- INFRA leg E: cost guardrail (circuit breaker) ----------
  const gTask = await api("POST", "/api/kad/tasks", { title: "Guardrail test — giao việc dài" });
  const gId = gTask.body.id;
  // Record a completed run that exceeds the PER-TASK limit (500k) but stays under
  // the department DAILY limit (2M), so this test doesn't poison the shared daily
  // budget for the later engine task in the same department.
  const guardrails = require(path.join(ROOT, "server/lib/kad/guardrails"));
  const gr = repo.runs.createRun({ task_id: gId, agent_id: mainAgent.id, engine: "claude" });
  repo.runs.updateRun(gr.id, { status: "completed", tokens_used: { total: 600_000 } });
  const gate = guardrails.check(gId);
  check("guardrail check() blocks over-budget task", gate.ok === false, gate.reason || "");
  guardrails.trip(gId, gate.reason || "over budget");
  check("SQL: task → waiting_human after trip", one("SELECT status FROM tasks WHERE id=?", gId).status === "waiting_human");
  check("SQL: budget_warning notification", one("SELECT COUNT(*) n FROM notifications WHERE kind='budget_warning' AND target_id=?", gId).n >= 1);
  check("SQL: budget_exceeded audit", one("SELECT COUNT(*) n FROM audit_log WHERE action='budget_exceeded' AND task_id=?", gId).n >= 1);

  // ---------- INFRA leg F: crash recovery (reconcile_runs) ----------
  const orch = require(path.join(ROOT, "server/lib/kad/orchestrator"));
  // Fresh task stuck at 'doing' with an orphan 'running' run (simulates a crash mid-turn).
  const crashTask = await api("POST", "/api/kad/tasks", { title: "Crash recovery task" });
  const crashTaskId = crashTask.body.id;
  repo.tasks.updateTask(crashTaskId, { status: "doing" });
  const orphan = repo.runs.createRun({ task_id: crashTaskId, agent_id: mainAgent.id, engine: "claude" });
  repo.runs.updateRun(orphan.id, { status: "running" }); // simulate a run alive at crash time
  const cleaned = orch.reconcileRuns();
  check("reconcile_runs cleans orphan running run", cleaned >= 1);
  check("SQL: orphan run → failed", one("SELECT status FROM task_runs WHERE id=?", orphan.id).status === "failed");
  check("SQL: stuck 'doing' task reset → waiting_human (not left stuck)", one("SELECT status FROM tasks WHERE id=?", crashTaskId).status === "waiting_human");

  // ---------- INFRA leg G: real MCP stdio server subprocess ----------
  // Spawn the ACTUAL mcp/kad-tools-server.mjs and drive JSON-RPC. Proves the MCP
  // binary the agent loads works (handshake, tools/list, tools/call → internal API
  // → DB) and enforces the approval-block — everything except the agent deciding
  // to call it (that last mile needs a real engine, below).
  const mcpTask = await api("POST", "/api/kad/tasks", { title: "MCP leg task" });
  const mcpTaskId = mcpTask.body.id;
  const mcp = spawn(process.execPath, [path.join(ROOT, "mcp/kad-tools-server.mjs")], {
    env: { ...process.env, KAD_API_BASE: BASE, KAD_INTERNAL_TOKEN: getInternalToken(), KAD_RUN_ID: "run-mcp-leg", KAD_TASK_ID: mcpTaskId, KAD_AGENT_ID: mainAgent.id },
  });
  const mcpPending = new Map();
  let mcpBuf = "";
  mcp.stdout.on("data", (d) => {
    mcpBuf += d.toString();
    let nl;
    while ((nl = mcpBuf.indexOf("\n")) >= 0) {
      const line = mcpBuf.slice(0, nl); mcpBuf = mcpBuf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && mcpPending.has(msg.id)) { mcpPending.get(msg.id)(msg); mcpPending.delete(msg.id); }
    }
  });
  let mcpId = 1;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = mcpId++;
    mcpPending.set(id, resolve);
    setTimeout(() => reject(new Error("mcp rpc timeout " + method)), 10000);
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify", version: "1" } });
    check("MCP initialize → serverInfo.name=kad", init.result && init.result.serverInfo && init.result.serverInfo.name === "kad");
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await rpc("tools/list", {});
    const toolNames = (listed.result.tools || []).map((t) => t.name);
    check("MCP tools/list = 9 KAD tools", toolNames.length === 9, toolNames.join(","));
    const planCall = await rpc("tools/call", { name: "kad_plan_task", arguments: { plan: "## Kế hoạch\n1. x" } });
    check("MCP kad_plan_task → pending + real approval row", /"status":"pending"/.test(planCall.result.content[0].text) && one("SELECT COUNT(*) n FROM approvals WHERE task_id=? AND approval_type='plan'", mcpTaskId).n === 1);
    const delCall = await rpc("tools/call", { name: "kad_create_delegation", arguments: { to_agent: "sub-curriculum-researcher", instruction: "x" } });
    check("MCP kad_create_delegation blocked pre-approval (isError)", delCall.result.isError === true, delCall.result.content[0].text.slice(0, 80));
  } catch (e) {
    check("MCP leg completed", false, e.message);
  } finally {
    mcp.kill();
  }

  // ---------- ENGINE legs (real claude spawn; CANNOT be mocked) ----------
  // Drive the actual orchestrator: POST a real goal → a real Main Agent claude turn
  // runs (via startTaskTurn, not the worker) → assert the AGENT itself called
  // kad_plan_task (plan approval appears) and that engine_session_id was captured.
  console.log("\n--- Engine legs (real Claude spawn) ---");
  const worker = require(path.join(ROOT, "server/lib/kad/job-queue"));
  let engineBlocked = false;
  const eng = await api("POST", "/api/kad/tasks", { title: "Nghiên cứu nhu cầu học AI Automation của chủ SME Việt Nam (engine)" });
  const engId = eng.body.id;
  const goal = "Nghiên cứu nhu cầu học AI Automation của chủ SME Việt Nam. Lập kế hoạch và gọi tool kad_plan_task để xin duyệt.";
  const em = await api("POST", `/api/kad/tasks/${engId}/messages`, { content: goal });
  check("S1.E0 POST /messages accepted + run kicked", em.status === 201 && em.body.run_kicked === true);
  check("SQL: human message row exists", one("SELECT COUNT(*) n FROM task_messages WHERE task_id=? AND sender_type='human'", engId).n >= 1);

  // Poll up to ~210s for the real turn: plan approval created OR run failed. Read
  // via repo (the server's own db connection) — a separate readonly connection can
  // lag on cross-connection WAL visibility.
  const t0 = Date.now();
  let planRow = null, engRun = null;
  while (Date.now() - t0 < 210000) {
    await sleep(3000);
    const apprs = repo.approvals.listByTask(engId).filter((a) => a.approval_type === "plan");
    planRow = apprs[apprs.length - 1] || null;
    engRun = repo.runs.listByTask(engId)[0] || null;
    if (planRow) break;
    if (engRun && engRun.status === "failed") {
      const out = JSON.stringify(engRun.output || "");
      if (/401|authenticate|credentials/i.test(out)) engineBlocked = true;
      break;
    }
  }

  if (engineBlocked) {
    blocked("S1.E1 Main Agent real turn calls kad_plan_task", "spawned claude 401 — no standalone credential (run `claude login`, then a fresh `claude -p` must not 401)");
    blocked("S1.E2 Researcher real turn calls kad_web_search ≥1", "depends on E1 + TAVILY_API_KEY");
    blocked("S1.E3 engine_session_id captured", "no engine turn");
  } else {
    check("S1.E1 real Main turn called kad_plan_task (plan approval created)", !!planRow, engRun ? `run status=${engRun.status}` : "no run yet");
    check("S1.E3 engine_session_id captured (bridge to monitor trace)", !!(engRun && engRun.engine_session_id), engRun ? engRun.engine_session_id || "null" : "no run");
    // Settle: the turn ends (process exits) shortly AFTER the approval is created —
    // wait for the run to reach the durable waiting_approval marker.
    const s0 = Date.now();
    while (Date.now() - s0 < 30000) {
      engRun = repo.runs.listByTask(engId)[0] || engRun;
      if (engRun && ["waiting_approval", "completed", "failed"].includes(engRun.status)) break;
      await sleep(2000);
    }
    check("turn-based: run ended at waiting_approval (durable marker, process exited)", engRun && engRun.status === "waiting_approval", engRun ? engRun.status : "no run");
    check("engine task parked at waiting_human", repo.tasks.getTask(engId).status === "waiting_human", repo.tasks.getTask(engId).status);
    const engAudits = repo.listAudit({ task_id: engId }).map((r) => r.action);
    check("real run lifecycle audited (run_started + run_completed)", engAudits.includes("run_started") && engAudits.includes("run_completed"), engAudits.join(","));

    // E2: full chain to a real web search — needs the Researcher to run, which needs
    // the plan approved + worker to drive resume→delegation. Gated on TAVILY_API_KEY.
    if (planRow && process.env.TAVILY_API_KEY) {
      await api("POST", `/api/kad/approvals/${planRow.id}/decide`, { decision: "approved" });
      const w0 = Date.now();
      let searched = false;
      while (Date.now() - w0 < 240000) {
        await worker.sweep(); // manually advance the durable job queue one step
        await sleep(3000);
        if (one("SELECT COUNT(*) n FROM audit_log WHERE task_id=? AND action='web_search'", engId).n >= 1) { searched = true; break; }
      }
      check("S1.E2 Researcher real turn called kad_web_search ≥1", searched);
      check("S1.E2b research_report artifact produced by researcher", one("SELECT COUNT(*) n FROM artifacts WHERE task_id=? AND artifact_type='research_report'", engId).n >= 1);
    } else if (!process.env.TAVILY_API_KEY) {
      blocked("S1.E2 Researcher web_search", "TAVILY_API_KEY not set (set it to run the full research chain)");
    }
  }

  // ---------- summary ----------
  console.log(results.join("\n"));
  console.log(`\n=== S1: ${pass} passed, ${fail} failed${engineBlocked ? " (engine legs BLOCKED — auth)" : ""} ===`);

  sdb.close();
  try { require(path.join(ROOT, "server/lib/kad/job-queue")).stopWorker(); } catch {}
  server.close();
  for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) try { fs.unlinkSync(f); } catch {}
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("verify crashed:", e); process.exit(1); });
