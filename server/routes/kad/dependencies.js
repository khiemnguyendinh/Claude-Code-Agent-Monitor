/**
 * @file server/routes/kad/dependencies.js — DELETE /api/kad/dependencies/:depId
 * (spec 03 §"Phụ thuộc, Tự động hoá & Lịch"). The nested create/list endpoints
 * (`/tasks/:id/dependencies`) live in tasks.js since they're task-scoped; this
 * one is top-level because a dependency id alone is enough to address it.
 */
const express = require("express");
const repo = require("../../lib/kad/repo");
const { emitDept } = require("../../lib/kad/events");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

// "Gỡ điều kiện" (spec/ui/09 §3): release this dependency; if it was the last
// 'waiting' one on its task, the task goes back to 'inbox' (unblocked).
router.delete("/dependencies/:depId", (req, res) => {
  const dep = repo.dependencies.getDependency(req.params.depId);
  if (!dep) return err(res, "ENOTFOUND", "dependency not found", 404);
  repo.dependencies.release(dep.id);
  const stillWaiting = repo.dependencies.countWaiting(dep.task_id);
  const task = repo.tasks.getTask(dep.task_id);
  if (stillWaiting === 0 && task && task.status === "blocked") {
    repo.tasks.updateTask(task.id, { status: "inbox" });
    emitDept(task.department_id, "kad.task.status", { task_id: task.id, status: "inbox" });
  }
  res.json({
    dependency_id: dep.id,
    task_id: dep.task_id,
    task_status: repo.tasks.getTask(dep.task_id)?.status,
  });
});

module.exports = router;
