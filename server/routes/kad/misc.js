/**
 * @file server/routes/kad/misc.js — Agents, Reports overview, Notifications,
 * Audit (spec 03). Mounted at /api/kad.
 */
const express = require("express");
const repo = require("../../lib/kad/repo");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

function deptId(req) {
  if (req.query.department) return req.query.department;
  const d = repo.catalog.getDepartmentBySlug("rd");
  return d ? d.id : null;
}

router.get("/agents", (req, res) => {
  const id = deptId(req);
  res.json(id ? repo.catalog.listAgents(id, { status: req.query.status }) : []);
});

router.get("/agents/:id", (req, res) => {
  const a = repo.catalog.getAgent(req.params.id);
  if (!a) return err(res, "ENOTFOUND", "agent not found", 404);
  res.json(a);
});

// Nhân sự số (tab Tổ chức) — human-facing create/update/archive. catalog.js
// stays read-only per its own header; repo.personnel owns these writes.
router.post("/agents", (req, res) => {
  const department_id = req.body?.department_id || deptId(req);
  if (!department_id) return err(res, "ENODEPT", "no department resolved", 400);
  try {
    const agent = repo.personnel.createAgent({ ...req.body, department_id });
    res.status(201).json(agent);
  } catch (e) {
    err(res, "EBADAGENT", e instanceof Error ? e.message : "could not create agent", 400);
  }
});

router.put("/agents/:id", (req, res) => {
  try {
    const agent = repo.personnel.updateAgent(req.params.id, req.body || {});
    if (!agent) return err(res, "ENOTFOUND", "agent not found", 404);
    res.json(agent);
  } catch (e) {
    err(res, "EBADAGENT", e instanceof Error ? e.message : "could not update agent", 400);
  }
});

router.post("/agents/:id/archive", (req, res) => {
  try {
    const agent = repo.personnel.archiveAgent(req.params.id, { actor_id: req.body?.actor_id });
    if (!agent) return err(res, "ENOTFOUND", "agent not found", 404);
    res.json(agent);
  } catch (e) {
    err(res, "EBADAGENT", e instanceof Error ? e.message : "could not archive agent", 400);
  }
});

// [spec/ui/07 §1] Quickstart cards on Giao việc mới — active workflows only.
router.get("/workflows", (req, res) => {
  const id = deptId(req);
  res.json(id ? repo.catalog.listWorkflows(id, { status: req.query.status || "active" }) : []);
});

// Read-only — Pane A's stepper (spec/ui/05 §1) needs the step list a task's
// workflow was created with.
router.get("/workflows/:id", (req, res) => {
  const wf = repo.catalog.getWorkflow(req.params.id);
  if (!wf) return err(res, "ENOTFOUND", "workflow not found", 404);
  res.json(wf);
});

// Overview keeps the Phase 2 fields and adds Phase 7 KPI/cost read models.
router.get("/reports/overview", (req, res) => {
  const id = deptId(req);
  const tasks = repo.tasks.listTasks({ department_id: id, limit: 500 });
  const byStatus = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  const kpi = repo.reports.kpi({ department_id: id, range: req.query.range || "7d" });
  res.json({
    department_id: id,
    tasks_by_status: byStatus,
    pending_approvals: repo.approvals.listPending({ department_id: id }).length,
    active_runs: repo.runs.countActive(),
    pending_jobs: repo.jobs.pendingCount(),
    kpi,
    cost: kpi.cost,
  });
});

router.get("/reports/kpi", (req, res) => {
  res.json(repo.reports.kpi({ department_id: deptId(req), range: req.query.range || "7d" }));
});

// [GAP spec/ui/02 §5] Standup rút gọn — deterministic (see repo/standup.js),
// not a Main Agent narrative. GET reads today's snapshot (null if not yet
// generated); POST regenerates it now.
router.get("/standup/today", (req, res) => {
  res.json(repo.standup.getToday(deptId(req)));
});

router.post("/standup/today/regenerate", (req, res) => {
  res.json(repo.standup.regenerate(deptId(req)));
});

router.get("/notifications", (req, res) => {
  res.json(
    repo.notifications.listNotifications({
      department_id: deptId(req),
      unread: req.query.unread === "1",
    })
  );
});

router.post("/notifications/:id/read", (req, res) => {
  const n = repo.notifications.markRead(req.params.id);
  if (!n) return err(res, "ENOTFOUND", "notification not found", 404);
  res.json(n);
});

// spec/ui/08 — bulk engine_session_id -> {task_id, task_title} map so
// SessionCard/AgentCard on the Kanban board can show "tên phiên = tên công
// việc" without an N+1 request per card.
router.get("/session-task-map", (req, res) => {
  const rows = repo.runs.listSessionTaskMap();
  const map = {};
  for (const r of rows) map[r.session_id] = { task_id: r.task_id, task_title: r.task_title };
  res.json(map);
});

router.get("/audit", (req, res) => {
  res.json(
    repo.listAudit({
      task_id: req.query.task,
      agent_id: req.query.agent,
      action: req.query.action,
      from: req.query.from,
      to: req.query.to,
    })
  );
});

module.exports = router;
