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
const cost = require("../../lib/kad/cost");
const workflowEngine = require("../../lib/kad/workflow-engine");
const connectorService = require("../../lib/kad/connectors");
const larkAdapter = require("../../lib/kad/lark-adapter");
const { requireInternalToken } = require("../../lib/kad/internal-auth");
const { emitTask, emitDept } = require("../../lib/kad/events");

const router = express.Router();
router.use(requireInternalToken);
router.use(express.json({ limit: "2mb" }));

const bad = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

function notifyApprovalCreated(task, approval) {
  try {
    repo.notifications.createNotification({
      department_id: task && task.department_id,
      kind: "approval_pending",
      title: "Cần phê duyệt",
      body: approval.title,
      link_path: `/phe-duyet/${approval.id}`,
      target_id: approval.id,
    });
  } catch (e) {
    console.warn("[kad-internal] approval notification failed:", e && e.message);
  }
}

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
    repo.tasks.addMessage({
      task_id: c.task.id,
      sender_type: "agent",
      sender_id: c.agent.id,
      content: plan,
      message_type: "status",
    });
    approval = repo.approvals.createApproval({
      task_id: c.task.id,
      requested_by: c.agent.id,
      approval_type: "plan",
      title: `Kế hoạch: ${c.task.title}`,
      description: plan.slice(0, 500),
      sla_reminder_hours: 24,
    });
    repo.audit({
      department_id: c.task.department_id,
      task_id: c.task.id,
      agent_id: c.agent.id,
      action: "approval_requested",
      actor_type: "agent",
      actor_id: c.agent.id,
      target_type: "approval",
      target_id: approval.id,
      details: { approval_type: "plan" },
    });
  });
  emitTask(c.task.id, "kad.approval.created", approval);
  emitDept(c.task.department_id, "kad.approval.created", approval); // Tổng quan inbox (spec/ui/02 §6) is department-scoped
  notifyApprovalCreated(c.task, approval);
  res.json({
    approval_id: approval.id,
    status: "pending",
    instruction: "Kế hoạch đã gửi trưởng phòng duyệt. Hãy KẾT THÚC lượt và chờ quyết định.",
  });
});

// kad_ask_intake — main only (spec 07 §2). One question per call, ≤4 quick-reply
// options; the human's reply is an ordinary chat message that resumes this same
// turn (tasks.js POST /:id/messages routes replies to resumeTaskTurn once a run
// already exists). Does not create an approval row — just posts the message and
// ends the turn (system prompt instructs the agent to stop after calling it).
router.post("/ask-intake", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (c.agent.agent_type !== "main")
    return bad(res, "EPERM", "only main agent may ask intake questions", 403);
  const b = req.body || {};
  const question = (b.question || "").trim();
  if (!question) return bad(res, "EBADQUESTION", "question is required");
  const options = Array.isArray(b.options) ? b.options.slice(0, 4).map(String) : undefined;
  let msg;
  repo.tx(() => {
    msg = repo.tasks.addMessage({
      task_id: c.task.id,
      sender_type: "agent",
      sender_id: c.agent.id,
      content: question,
      message_type: "intake_question",
      metadata: options ? { options } : undefined,
    });
    repo.audit({
      department_id: c.task.department_id,
      task_id: c.task.id,
      agent_id: c.agent.id,
      action: "intake_asked",
      actor_type: "agent",
      actor_id: c.agent.id,
      target_type: "message",
      target_id: msg.id,
      details: { question },
    });
  });
  emitTask(c.task.id, "kad.message.created", msg);
  larkAdapter
    .pushTaskMessage(msg)
    .catch((e) => console.warn("[kad:lark] intake card push failed:", e && e.message));
  res.json({
    message_id: msg.id,
    instruction: "Đã hỏi trưởng phòng. Hãy KẾT THÚC lượt ngay và chờ câu trả lời.",
  });
});

// kad_propose_brief — main only (spec 07 §3). Summarizes intake into a Brief
// Card the human must [Chốt & giao] before execution starts. Also persists to
// tasks.brief (draft) so the brief survives even if the message list is trimmed.
router.post("/propose-brief", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (c.agent.agent_type !== "main")
    return bad(res, "EPERM", "only main agent may propose a brief", 403);
  const b = req.body || {};
  const required = ["goal", "deliverable", "workflow_name", "due_label"];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) return bad(res, "EBADBRIEF", `missing fields: ${missing.join(", ")}`);
  const brief = {
    goal: b.goal,
    deliverable: b.deliverable,
    workflowName: b.workflow_name,
    workingDir: c.task.working_dir || null,
    attachmentCount: repo.attachments.countByTask(c.task.id),
    dueLabel: b.due_label,
    frameworkLabel: b.framework_label || undefined,
    assumption: b.assumption || undefined,
    decidedAt: null,
  };
  let msg;
  repo.tx(() => {
    msg = repo.tasks.addMessage({
      task_id: c.task.id,
      sender_type: "agent",
      sender_id: c.agent.id,
      content: "Brief — chờ anh chốt",
      message_type: "brief",
      metadata: { brief },
    });
    repo.tasks.updateTask(c.task.id, { brief });
    repo.audit({
      department_id: c.task.department_id,
      task_id: c.task.id,
      agent_id: c.agent.id,
      action: "brief_proposed",
      actor_type: "agent",
      actor_id: c.agent.id,
      target_type: "message",
      target_id: msg.id,
      details: { workflow_name: b.workflow_name },
    });
  });
  emitTask(c.task.id, "kad.message.created", msg);
  larkAdapter
    .pushTaskMessage(msg)
    .catch((e) => console.warn("[kad:lark] brief card push failed:", e && e.message));
  res.json({
    message_id: msg.id,
    instruction: "Đã gửi brief chờ trưởng phòng chốt. Hãy KẾT THÚC lượt ngay.",
  });
});

// kad_request_approval — main + sub(sensitive). Generic approval, turn ends.
router.post("/request-approval", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  const b = req.body || {};
  const type = b.approval_type || "artifact";
  // QC gate B (spec 01 §3.2): a reviewer-bound artifact (framework/syllabus) or a
  // sensitive one may not be presented to the human until a passing Quality
  // Reviewer report exists for it. Enforced server-side, not left to the agent.
  if (b.artifact_id) {
    const gate = workflowEngine.assertQualityGate(c.task, b.artifact_id);
    if (!gate.ok) return bad(res, gate.code, gate.message, 409);
  }
  let approval;
  repo.tx(() => {
    approval = repo.approvals.createApproval({
      task_id: c.task.id,
      requested_by: c.agent.id,
      approval_type: type,
      sensitivity_subtype: b.sensitivity_subtype,
      title: b.title || `Duyệt: ${c.task.title}`,
      description: b.description,
      artifact_id: b.artifact_id,
      sla_reminder_hours: 24,
    });
    repo.audit({
      department_id: c.task.department_id,
      task_id: c.task.id,
      agent_id: c.agent.id,
      action: "approval_requested",
      actor_type: "agent",
      actor_id: c.agent.id,
      target_type: "approval",
      target_id: approval.id,
      details: { approval_type: type },
    });
  });
  emitTask(c.task.id, "kad.approval.created", approval);
  emitDept(c.task.department_id, "kad.approval.created", approval);
  notifyApprovalCreated(c.task, approval);
  res.json({
    approval_id: approval.id,
    status: "pending",
    instruction: "Đã gửi duyệt. Hãy KẾT THÚC lượt và chờ quyết định.",
  });
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
  const to =
    b.to_agent &&
    (repo.catalog.getAgentByName(c.task.department_id, b.to_agent) ||
      repo.catalog.getAgent(b.to_agent));
  if (!to) return bad(res, "EBADAGENT", "to_agent not found");
  if (to.status !== "active")
    return bad(res, "EAGENTINACTIVE", `agent ${to.name} chưa active`, 409);
  // Workflow ordering (spec 01 §3.2): framework before syllabus; syllabus approved
  // before any materials step (lesson/slide/video run parallel-per-module after).
  const order = workflowEngine.assertStepOrder(c.task, to);
  if (!order.ok) return bad(res, order.code, order.message, 409);
  let deleg;
  repo.tx(() => {
    deleg = repo.delegations.createDelegation({
      task_id: c.task.id,
      from_agent_id: c.agent.id,
      to_agent_id: to.id,
      instruction: b.instruction || c.task.title,
      input_artifact_ids: b.input_artifact_ids || [],
    });
    repo.audit({
      department_id: c.task.department_id,
      task_id: c.task.id,
      agent_id: c.agent.id,
      action: "delegation_created",
      actor_type: "agent",
      actor_id: c.agent.id,
      target_type: "delegation",
      target_id: deleg.id,
      details: { to: to.name },
    });
  });
  repo.jobs.enqueue({
    kind: "start_delegation",
    payload: { delegation_id: deleg.id },
    dedupKey: `deleg:${deleg.id}`,
  });
  emitTask(c.task.id, "kad.delegation.status", deleg);
  res.json({
    delegation_id: deleg.id,
    status: "pending",
    instruction: "Đã giao việc. Kết thúc lượt; kết quả sẽ báo lại ở lượt sau.",
  });
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
  if (!b.artifact_type || !b.title)
    return bad(res, "EBADARTIFACT", "artifact_type and title required");
  let art;
  repo.tx(() => {
    art = repo.artifacts.createArtifact({
      task_id: c.task.id,
      agent_id: c.agent.id,
      artifact_type: b.artifact_type,
      title: b.title,
      content: b.content,
      parent_artifact_id: b.parent_artifact_id,
      template_version_id: b.template_version_id,
      status: "draft",
    });
    repo.audit({
      department_id: c.task.department_id,
      task_id: c.task.id,
      agent_id: c.agent.id,
      action: "artifact_created",
      actor_type: "agent",
      actor_id: c.agent.id,
      target_type: "artifact",
      target_id: art.id,
      details: { type: b.artifact_type },
    });
  });
  emitTask(c.task.id, "kad.artifact.created", {
    artifact_id: art.id,
    task_id: c.task.id,
    type: art.artifact_type,
    version: art.version,
  });

  // Workflow engine (phase-03 §2-5): sensitive detection L2 → blocking approval;
  // conditional/internal auto-approval (reviewer='system'); step advancement.
  // No-op for freeform (non-workflow) tasks.
  const decision = workflowEngine.onArtifactSaved({ task: c.task, artifact: art, agent: c.agent });
  const resp = { artifact_id: art.id };
  if (decision.sensitiveBlocked) {
    resp.sensitive_pending = true;
    resp.instruction = `Artifact chứa nội dung nhạy cảm (${decision.subtype}) — đã tạo yêu cầu duyệt cho trưởng phòng. KẾT THÚC lượt và chờ quyết định.`;
  } else if (decision.autoApproved) {
    resp.auto_approved = true;
    resp.instruction = `Artifact đã được tự động duyệt (${decision.decisionReason}). Tiếp tục bước kế tiếp.`;
  }
  res.json(resp);
});

// kad_flag_sensitivity — quality reviewer only (spec 04 §2, layer 1). Writes the
// 3-dimension sensitivity flags onto a target artifact; any flagged dimension
// triggers the engine's blocking sensitive_content approval (same path as the
// server-side scan) so a QR-flagged artifact can't reach human duyệt un-gated.
router.post("/flag-sensitivity", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (!c.agent.permissions.flag_sensitivity)
    return bad(res, "EPERM", "no flag_sensitivity permission", 403);
  const b = req.body || {};
  const art = b.artifact_id && repo.artifacts.getArtifact(b.artifact_id);
  if (!art || art.task_id !== c.task.id)
    return bad(res, "EBADARTIFACT", "artifact not in this task", 404);
  const flags = { metrics: !!b.metrics, people: !!b.people, brand: !!b.brand };
  repo.tx(() => {
    repo.artifacts.updateArtifact(art.id, {
      metadata: { ...(art.metadata || {}), sensitivity_flags: flags },
    });
    repo.audit({
      department_id: c.task.department_id,
      task_id: c.task.id,
      agent_id: c.agent.id,
      action: "artifact_updated",
      actor_type: "agent",
      actor_id: c.agent.id,
      target_type: "artifact",
      target_id: art.id,
      details: { sensitivity_flags: flags },
    });
  });
  let sensitivePending = false;
  if (flags.metrics || flags.people || flags.brand) {
    const updated = repo.artifacts.getArtifact(art.id);
    const decision = workflowEngine.onArtifactSaved({
      task: c.task,
      artifact: updated,
      agent: c.agent,
    });
    sensitivePending = !!decision.sensitiveBlocked;
  }
  res.json({ ok: true, sensitivity_flags: flags, sensitive_pending: sensitivePending });
});

// kad_read_org_context — permission gated.
router.get("/org-context", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (!c.agent.permissions.read_org_context)
    return bad(res, "EPERM", "no read_org_context permission", 403);
  const dept = repo.catalog.getDepartment(c.task.department_id);
  const org = repo.catalog.getCurrentOrgContext(dept && dept.org_id);
  if (!org) return bad(res, "ENOCONTEXT", "no approved org context", 404);
  const section = req.query.section;
  res.json({
    version: org.version,
    data: section && org.data[section] !== undefined ? { [section]: org.data[section] } : org.data,
  });
});

// kad_read_template — permission gated + usage logged.
router.get("/template", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (!c.agent.permissions.read_templates)
    return bad(res, "EPERM", "no read_templates permission", 403);
  const found = repo.catalog.getApprovedTemplateByType(c.task.department_id, req.query.type);
  if (!found) return bad(res, "ENOTEMPLATE", "no approved template of that type", 404);
  repo.catalog.logTemplateUsage({
    template_id: found.template.id,
    template_version_id: found.version.id,
    task_id: c.task.id,
    agent_id: c.agent.id,
  });
  res.json({
    template_type: found.template.template_type,
    name: found.template.name,
    content: found.version.content,
    version: found.version.version,
  });
});

// kad_list_learning_notes
router.get("/learning-notes", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  const notes = repo.learning.listRecent({ department_id: c.task.department_id, limit: 10 });
  res.json({
    notes: notes.map((n) => ({
      category: n.correction_category,
      severity: n.severity,
      root_cause: n.root_cause,
      prevention: n.prevention,
      target: n.proposed_change_target,
    })),
  });
});

// kad_report_progress — any agent → status message.
router.post("/report-progress", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  const content = (req.body && req.body.content) || "";
  if (!content) return bad(res, "EBADCONTENT", "content required");
  const msg = repo.tasks.addMessage({
    task_id: c.task.id,
    sender_type: "agent",
    sender_id: c.agent.id,
    content,
    message_type: "status",
  });
  emitTask(c.task.id, "kad.message.created", msg);
  res.json({ ok: true, message_id: msg.id });
});

// kad_present_report — main only (spec 07 §4). Structured Report Card instead of
// wall-of-text: bumps the referenced artifacts to 'review', computes a real
// round-cost from task_runs since the last checkpoint (brief lock, or the prior
// report), and parks the task at waiting_human for the human's decision
// (POST /tasks/:id/report/:messageId/decide).
router.post("/present-report", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (c.agent.agent_type !== "main")
    return bad(res, "EPERM", "only main agent may present a report", 403);
  const b = req.body || {};
  const summary = (b.summary || "").trim();
  const artifactIds = Array.isArray(b.artifact_ids) ? b.artifact_ids : [];
  if (!summary) return bad(res, "EBADREPORT", "summary is required");
  if (!artifactIds.length)
    return bad(res, "EBADREPORT", "artifact_ids is required (from kad_save_artifact)");
  const artifacts = artifactIds.map((id) => repo.artifacts.getArtifact(id)).filter(Boolean);
  if (!artifacts.length) return bad(res, "EBADARTIFACT", "no valid artifact_ids");

  // QC gate B (spec 01 §3.2): the bàn giao report can't include a reviewer-bound
  // or sensitive artifact that never passed a Quality Reviewer. Block the whole
  // report until it does (framework/syllabus already carry their QR by this step).
  for (const a of artifacts) {
    const gate = workflowEngine.assertQualityGate(c.task, a.id);
    if (!gate.ok) return bad(res, gate.code, gate.message, 409);
  }

  const priorReports = repo.tasks
    .listMessages(c.task.id)
    .filter((m) => m.message_type === "report");
  const version = priorReports.length + 1;
  const since = priorReports.length
    ? priorReports[priorReports.length - 1].created_at
    : (c.task.brief && c.task.brief.decidedAt) || c.task.created_at;
  const round = cost.estimateRoundCost(c.task.id, since);

  const report = {
    version,
    summary,
    artifacts: artifacts.map((a) => ({ artifactId: a.id, title: a.title })),
    needsDecision:
      Array.isArray(b.needs_decision) && b.needs_decision.length ? b.needs_decision : undefined,
    blocker: b.blocker || undefined,
    cost: {
      durationSeconds: round.durationSeconds,
      tokens: round.tokens,
      vnd: round.vnd,
      agentName: c.agent.display_name,
    },
    decision: null,
  };
  let msg;
  repo.tx(() => {
    for (const a of artifacts)
      if (a.status === "draft") repo.artifacts.updateArtifact(a.id, { status: "review" });
    msg = repo.tasks.addMessage({
      task_id: c.task.id,
      sender_type: "agent",
      sender_id: c.agent.id,
      content: `Báo cáo kết quả${version > 1 ? ` v${version}` : ""}`,
      message_type: "report",
      metadata: { report },
    });
    repo.tasks.updateTask(c.task.id, { status: "waiting_human" });
    repo.audit({
      department_id: c.task.department_id,
      task_id: c.task.id,
      agent_id: c.agent.id,
      action: "report_presented",
      actor_type: "agent",
      actor_id: c.agent.id,
      target_type: "message",
      target_id: msg.id,
      details: { version, artifact_ids: artifactIds },
    });
  });
  emitTask(c.task.id, "kad.message.created", msg);
  emitTask(c.task.id, "kad.task.status", { task_id: c.task.id, status: "waiting_human" });
  larkAdapter
    .pushTaskMessage(msg)
    .catch((e) => console.warn("[kad:lark] report card push failed:", e && e.message));
  res.json({
    message_id: msg.id,
    instruction: "Đã gửi báo cáo chờ trưởng phòng duyệt. Hãy KẾT THÚC lượt ngay.",
  });
});

// kad_web_search — researcher only. Real provider; logs audit.
router.post("/web-search", async (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  if (!c.agent.permissions.web_search) return bad(res, "EPERM", "no web_search permission", 403);
  const q = (req.body && req.body.query) || "";
  try {
    const result = await webSearch.search(q, {
      maxResults: (req.body && req.body.max_results) || 5,
    });
    repo.audit({
      department_id: c.task.department_id,
      task_id: c.task.id,
      agent_id: c.agent.id,
      action: "web_search",
      actor_type: "agent",
      actor_id: c.agent.id,
      target_type: "task",
      target_id: c.task.id,
      details: { query: q, provider: result.provider, hits: result.results.length },
    });
    res.json(result);
  } catch (e) {
    res
      .status(e.code === "ENOWEBSEARCH" ? 503 : 400)
      .json({ error: { code: e.code || "EWEBSEARCH", message: e.message } });
  }
});

// kad_connector_draft — Phase 6. Creates connector_draft artifact, preview
// action, pending publish/schedule action, and publish approval with 5m cooldown.
router.post("/connector-draft", (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  const b = req.body || {};
  try {
    const result = connectorService.draftConnector({
      task_id: c.task.id,
      agent_id: c.agent.id,
      connector_type: b.connector_type,
      content: {
        title: b.title,
        body: b.body || b.content || b.content_to_publish,
        excerpt: b.excerpt,
        scheduled_at: b.scheduled_at,
        category_ids: b.category_ids,
        tag_ids: b.tag_ids,
      },
    });
    res.json(result);
  } catch (e) {
    res
      .status(e.status || 400)
      .json({ error: { code: e.code || "ECONNECTOR", message: e.message, details: e.details } });
  }
});

// kad_connector_publish — Phase 6. Publish is hard-blocked unless the linked
// approval is approved AND its cooldown_until has passed.
router.post("/connector-publish", async (req, res) => {
  const c = ctx(req, res);
  if (!c) return;
  const approvalId = req.body && req.body.approval_id;
  if (!approvalId) return bad(res, "EBADAPPROVAL", "approval_id is required");
  try {
    const action = await connectorService.executeByApproval(approvalId, {
      actor_type: "agent",
      actor_id: c.agent.id,
    });
    res.json({
      status: action.status,
      action_id: action.id,
      external_url: action.external_url,
      external_id: action.external_id,
      result: action.result,
    });
  } catch (e) {
    res
      .status(e.status || 400)
      .json({ error: { code: e.code || "ECONNECTOR", message: e.message, details: e.details } });
  }
});

module.exports = router;
