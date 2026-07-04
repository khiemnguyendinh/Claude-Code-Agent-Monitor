/**
 * @file server/routes/kad/tasks.js — Tasks & Chat (spec 03 §Tasks). Thin routes:
 * validate → repo/orchestrator → broadcast. POST /messages kicks a Main Agent
 * turn asynchronously (turn-based; the HTTP call returns immediately, progress
 * streams over the task-scoped WS channel).
 */
const express = require("express");
const repo = require("../../lib/kad/repo");
const orchestrator = require("../../lib/kad/orchestrator");
const { emitTask, emitDept } = require("../../lib/kad/events");

const router = express.Router();
const err = (res, code, message, status = 400) => res.status(status).json({ error: { code, message } });

// Single-department MVP helper: default to the 'rd' department if none given.
function defaultDeptId() {
  const d = repo.catalog.getDepartmentBySlug("rd");
  return d ? d.id : null;
}

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.title || typeof b.title !== "string") return err(res, "EBADTITLE", "title is required");
  const department_id = b.department_id || defaultDeptId();
  const task = repo.tasks.createTask({
    department_id,
    title: b.title,
    description: b.description,
    priority: b.priority,
    channel: b.channel,
    channel_actor_ref: b.channel_actor_ref,
    working_dir: b.working_dir,
    workflow_id: b.workflow_id,
  });
  emitDept(department_id, "kad.task.status", { task_id: task.id, status: task.status });
  res.status(201).json(task);
});

router.get("/", (req, res) => {
  res.json(repo.tasks.listTasks({ status: req.query.status, department_id: req.query.department, limit: req.query.limit }));
});

router.get("/:id", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  res.json({ ...task, counts: repo.tasks.getTaskCounts(task.id) });
});

router.patch("/:id", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  const patch = {};
  for (const k of ["status", "priority", "due_date"]) if (req.body[k] !== undefined) patch[k] = req.body[k];
  const updated = repo.tasks.updateTask(req.params.id, patch);
  emitTask(req.params.id, "kad.task.status", { task_id: req.params.id, status: updated.status });
  res.json(updated);
});

router.post("/:id/messages", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  const b = req.body || {};
  if (!b.content || typeof b.content !== "string") return err(res, "EBADCONTENT", "content is required");
  const msg = repo.tasks.addMessage({
    task_id: task.id,
    sender_type: "human",
    sender_id: "human",
    content: b.content,
    message_type: "chat",
    channel: b.channel,
    channel_actor_ref: b.channel_actor_ref,
  });
  emitTask(task.id, "kad.message.created", msg);
  // Kick a Main Agent turn in the background (turn-based; may block on guardrail).
  setImmediate(() => {
    orchestrator.startTaskTurn(task.id).catch((e) => {
      console.warn(`[kad] startTaskTurn(${task.id}) error:`, e && e.message);
    });
  });
  res.status(201).json({ message: msg, run_kicked: true });
});

router.get("/:id/messages", (req, res) => {
  res.json(repo.tasks.listMessages(req.params.id, { after: req.query.after }));
});

router.get("/:id/timeline", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  res.json(repo.tasks.getTimeline(req.params.id));
});

router.get("/:id/delegations", (req, res) => {
  res.json(repo.delegations.listByTask(req.params.id));
});

router.post("/:id/cancel-run", (req, res) => {
  // Phase 1: mark any running run cancelled (best-effort; process already turn-based).
  const runs = repo.runs.listByTask(req.params.id).filter((r) => r.status === "running");
  for (const r of runs) repo.runs.updateRun(r.id, { status: "cancelled" });
  res.json({ cancelled: runs.map((r) => r.id) });
});

module.exports = router;
