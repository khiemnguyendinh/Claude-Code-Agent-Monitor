/**
 * @file server/routes/kad/internal.js — internal API the KAD MCP tools call back
 * on (spec 04 §2). Token-guarded. Keeps a SINGLE db writer: the MCP server (a
 * child process of each claude run) never opens SQLite — it POSTs here, and all
 * enforcement (permissions, approval-blocking) happens server-side, not trusting
 * the client. Run context comes from headers set by the orchestrator's MCP config.
 */
const express = require("express");
const repo = require("../../lib/kad/repo");
const webSearch = require("../../lib/kad/web-search");
const { requireInternalToken } = require("../../lib/kad/internal-auth");
const { emitTask } = require("../../lib/kad/events");

const router = express.Router();
router.use(requireInternalToken);
router.use(express.json({ limit: "2mb" }));

const bad = (res, code, message, status = 400) => res.status(status).json({ error: { code, message } });

// Resolve run context (task + agent) from headers; verify against DB.
function ctx(req, res) {
  const runId = req.get("x-kad-run-id");
  const taskId = req.get("x-kad-task-id");
  const agentId = req.get("x-kad-agent-id");
  const task = taskId && repo.tasks.getTask(taskId);
  const agent = agentId && repo.catalog.getAgent(agentId);
  if (!task || !agent) {
    bad(res, "EBADCTX", "invalid run context", 403);
    return null;
  }
  // Defense-in-depth: a run may only act as an agent that is still active AND that
  // belongs to the task's department (blocks a stale/archived agent or cross-dept id).
  if (agent.status !== "active") {
    bad(res, "EAGENTINACTIVE", "calling agent is not active", 403);
    return null;
  }
  if (task.department_id && agent.department_id && task.department_id !== agent.department_id) {
    bad(res, "EBADCTX", "agent does not belong to task department", 403);
    return null;
  }
  return { runId, task, agent };
}

// kad_plan_task — main only. Writes plan message + pending plan approval. Turn ends.
router.post("/plan-task", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (c.agent.agent_type !== "main") return bad(res, "EPERM", "only main agent may plan", 403);
  const plan = (req.body && req.body.plan) || "";
  if (!plan) return bad(res, "EBADPLAN", "plan is required");
  let approval;
  repo.tx(() => {
    repo.tasks.addMessage({ task_id: c.task.id, sender_type: "agent", sender_id: c.agent.id, content: plan, message_type: "status" });
    approval = repo.approvals.createApproval({ task_id: c.task.id, requested_by: c.agent.id, approval_type: "plan", title: `Kế hoạch: ${c.task.title}`, description: plan.slice(0, 500), sla_reminder_hours: 24 });
    repo.audit({ department_id: c.task.department_id, task_id: c.task.id, agent_id: c.agent.id, action: "approval_requested", actor_type: "agent", actor_id: c.agent.id, target_type: "approval", target_id: approval.id, details: { approval_type: "plan" } });
  });
  emitTask(c.task.id, "kad.approval.created", approval);
  res.json({ approval_id: approval.id, status: "pending", instruction: "Kế hoạch đã gửi trưởng phòng duyệt. Hãy KẾT THÚC lượt và chờ quyết định." });
});

// kad_request_approval — main + sub(sensitive). Generic approval, turn ends.
router.post("/request-approval", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  const b = req.body || {};
  const type = b.approval_type || "artifact";
  let approval;
  repo.tx(() => {
    approval = repo.approvals.createApproval({ task_id: c.task.id, requested_by: c.agent.id, approval_type: type, sensitivity_subtype: b.sensitivity_subtype, title: b.title || `Duyệt: ${c.task.title}`, description: b.description, artifact_id: b.artifact_id, sla_reminder_hours: 24 });
    repo.audit({ department_id: c.task.department_id, task_id: c.task.id, agent_id: c.agent.id, action: "approval_requested", actor_type: "agent", actor_id: c.agent.id, target_type: "approval", target_id: approval.id, details: { approval_type: type } });
  });
  emitTask(c.task.id, "kad.approval.created", approval);
  res.json({ approval_id: approval.id, status: "pending", instruction: "Đã gửi duyệt. Hãy KẾT THÚC lượt và chờ quyết định." });
});

// kad_create_delegation — main only, AND requires an approved plan (block enforced here).
router.post("/create-delegation", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (c.agent.agent_type !== "main") return bad(res, "EPERM", "only main agent may delegate", 403);
  if (!repo.approvals.hasApproved(c.task.id, "plan")) {
    return bad(res, "EPLANUNAPPROVED", "kế hoạch chưa được duyệt — không thể giao việc", 403);
  }
  const b = req.body || {};
  const to = b.to_agent && (repo.catalog.getAgentByName(c.task.department_id, b.to_agent) || repo.catalog.getAgent(b.to_agent));
  if (!to) return bad(res, "EBADAGENT", "to_agent not found");
  if (to.status !== "active") return bad(res, "EAGENTINACTIVE", `agent ${to.name} chưa active`, 409);
  let deleg;
  repo.tx(() => {
    deleg = repo.delegations.createDelegation({ task_id: c.task.id, from_agent_id: c.agent.id, to_agent_id: to.id, instruction: b.instruction || c.task.title, input_artifact_ids: b.input_artifact_ids || [] });
    repo.audit({ department_id: c.task.department_id, task_id: c.task.id, agent_id: c.agent.id, action: "delegation_created", actor_type: "agent", actor_id: c.agent.id, target_type: "delegation", target_id: deleg.id, details: { to: to.name } });
  });
  repo.jobs.enqueue({ kind: "start_delegation", payload: { delegation_id: deleg.id }, dedupKey: `deleg:${deleg.id}` });
  emitTask(c.task.id, "kad.delegation.status", deleg);
  res.json({ delegation_id: deleg.id, status: "pending", instruction: "Đã giao việc. Kết thúc lượt; kết quả sẽ báo lại ở lượt sau." });
});

router.get("/delegation-result", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  const d = repo.delegations.getDelegation(req.query.delegation_id);
  if (!d) return bad(res, "ENOTFOUND", "delegation not found", 404);
  // A run may only read a delegation belonging to its own task (no cross-task peek).
  if (d.task_id !== c.task.id) return bad(res, "EPERM", "delegation not in this task", 403);
  res.json({ status: d.status, output_artifact_id: d.output_artifact_id, run_id: d.run_id });
});

// kad_save_artifact — any agent.
router.post("/save-artifact", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  const b = req.body || {};
  if (!b.artifact_type || !b.title) return bad(res, "EBADARTIFACT", "artifact_type and title required");
  let art;
  repo.tx(() => {
    art = repo.artifacts.createArtifact({ task_id: c.task.id, agent_id: c.agent.id, artifact_type: b.artifact_type, title: b.title, content: b.content, parent_artifact_id: b.parent_artifact_id, template_version_id: b.template_version_id, status: "draft" });
    repo.audit({ department_id: c.task.department_id, task_id: c.task.id, agent_id: c.agent.id, action: "artifact_created", actor_type: "agent", actor_id: c.agent.id, target_type: "artifact", target_id: art.id, details: { type: b.artifact_type } });
  });
  emitTask(c.task.id, "kad.artifact.created", { artifact_id: art.id, task_id: c.task.id, type: art.artifact_type, version: art.version });
  res.json({ artifact_id: art.id });
});

// kad_read_org_context — permission gated.
router.get("/org-context", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (!c.agent.permissions.read_org_context) return bad(res, "EPERM", "no read_org_context permission", 403);
  const dept = repo.catalog.getDepartment(c.task.department_id);
  const org = repo.catalog.getCurrentOrgContext(dept && dept.org_id);
  if (!org) return bad(res, "ENOCONTEXT", "no approved org context", 404);
  const section = req.query.section;
  res.json({ version: org.version, data: section && org.data[section] !== undefined ? { [section]: org.data[section] } : org.data });
});

// kad_read_template — permission gated + usage logged.
router.get("/template", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (!c.agent.permissions.read_templates) return bad(res, "EPERM", "no read_templates permission", 403);
  const found = repo.catalog.getApprovedTemplateByType(c.task.department_id, req.query.type);
  if (!found) return bad(res, "ENOTEMPLATE", "no approved template of that type", 404);
  repo.catalog.logTemplateUsage({ template_id: found.template.id, template_version_id: found.version.id, task_id: c.task.id, agent_id: c.agent.id });
  res.json({ template_type: found.template.template_type, name: found.template.name, content: found.version.content, version: found.version.version });
});

// kad_report_progress — any agent → status message.
router.post("/report-progress", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  const content = (req.body && req.body.content) || "";
  if (!content) return bad(res, "EBADCONTENT", "content required");
  const msg = repo.tasks.addMessage({ task_id: c.task.id, sender_type: "agent", sender_id: c.agent.id, content, message_type: "status" });
  emitTask(c.task.id, "kad.message.created", msg);
  res.json({ ok: true, message_id: msg.id });
});

// kad_web_search — researcher only. Real provider; logs audit.
router.post("/web-search", async (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (!c.agent.permissions.web_search) return bad(res, "EPERM", "no web_search permission", 403);
  const q = (req.body && req.body.query) || "";
  try {
    const result = await webSearch.search(q, { maxResults: (req.body && req.body.max_results) || 5 });
    repo.audit({ department_id: c.task.department_id, task_id: c.task.id, agent_id: c.agent.id, action: "web_search", actor_type: "agent", actor_id: c.agent.id, target_type: "task", target_id: c.task.id, details: { query: q, provider: result.provider, hits: result.results.length } });
    res.json(result);
  } catch (e) {
    res.status(e.code === "ENOWEBSEARCH" ? 503 : 400).json({ error: { code: e.code || "EWEBSEARCH", message: e.message } });
  }
});

module.exports = router;
