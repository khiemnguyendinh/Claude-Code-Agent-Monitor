/**
 * @file server/routes/kad/run-task.js — Run-backed KAD task intake.
 *
 * This is the thin bridge between the proven dashboard Run engine and KAD's
 * task model: create a real KAD task/message, spawn a real Claude Code run,
 * then keep task status visible as the run lifecycle changes.
 */
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const repo = require("../../lib/kad/repo");
const runs = require("../../lib/run-spawner");
const dashboardRuns = require("../../lib/dashboard-runs");
const { emitTask, emitDept } = require("../../lib/kad/events");

const router = express.Router();

const ALLOWED_PERMISSION_MODES = new Set(["acceptEdits", "default", "plan", "bypassPermissions"]);
const ALLOWED_EFFORT = new Set(["", "low", "medium", "high", "xhigh", "max"]);

const err = (res, code, message, status = 400, extra = {}) =>
  res.status(status).json({ error: { code, message }, ...extra });

function isExistingDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function sanitiseCwd(input) {
  if (input == null || input === "") return process.cwd();
  if (typeof input !== "string") {
    const e = new Error("cwd must be a string");
    e.code = "EBADCWD";
    throw e;
  }
  if (!path.isAbsolute(input)) {
    const e = new Error("cwd must be an absolute path");
    e.code = "EBADCWD";
    throw e;
  }
  const resolved = path.resolve(input);
  if (!isExistingDir(resolved)) {
    const e = new Error(`cwd does not exist: ${resolved}`);
    e.code = "EBADCWD";
    throw e;
  }
  return resolved;
}

function defaultDeptId() {
  const d = repo.catalog.getDepartmentBySlug("rd");
  return d ? d.id : null;
}

function titleFromPrompt(prompt) {
  const first = prompt
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!first) return "Công việc mới";
  return first.length > 90 ? `${first.slice(0, 87)}...` : first;
}

function addSystemMessage(taskId, content, metadata) {
  const msg = repo.tasks.addMessage({
    task_id: taskId,
    sender_type: "agent",
    sender_id: "system",
    content,
    message_type: "system",
    metadata,
  });
  emitTask(taskId, "kad.message.created", msg);
  return msg;
}

function syncRunStatusToTask({ handle, status, error, exitCode, sessionId }) {
  const taskId = handle && handle.taskId;
  if (!taskId) return;
  const task = repo.tasks.getTask(taskId);
  if (!task) return;

  if (status === "spawning" || status === "running") {
    const updated = repo.tasks.updateTask(taskId, { status: "doing" });
    emitTask(taskId, "kad.task.status", { task_id: taskId, status: updated.status });
    emitDept(updated.department_id, "kad.task.status", { task_id: taskId, status: updated.status });
    return;
  }

  if (status === "completed") {
    const updated = repo.tasks.updateTask(taskId, { status: "waiting_human" });
    addSystemMessage(
      taskId,
      "Claude Code đã hoàn tất lượt chạy. Anh xem kết quả và quyết định bước tiếp theo.",
      {
        dashboardRunId: handle.id,
        sessionId: sessionId || handle.sessionId || null,
        status,
        exitCode: exitCode ?? null,
      }
    );
    emitTask(taskId, "kad.task.status", { task_id: taskId, status: updated.status });
    emitDept(updated.department_id, "kad.task.status", { task_id: taskId, status: updated.status });
    return;
  }

  if (status === "error" || status === "killed") {
    const updated = repo.tasks.updateTask(taskId, { status: "failed" });
    addSystemMessage(
      taskId,
      status === "killed"
        ? "Claude Code run đã được dừng thủ công."
        : `Claude Code run lỗi: ${error || handle.error || `exit ${exitCode ?? "unknown"}`}`,
      {
        dashboardRunId: handle.id,
        sessionId: sessionId || handle.sessionId || null,
        status,
        exitCode: exitCode ?? null,
        error: error || handle.error || null,
      }
    );
    emitTask(taskId, "kad.task.status", { task_id: taskId, status: updated.status });
    emitDept(updated.department_id, "kad.task.status", { task_id: taskId, status: updated.status });
  }
}

router.post("/run-task", (req, res) => {
  const b = req.body || {};
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (!prompt) return err(res, "EBADPROMPT", "prompt is required");

  let cwd;
  try {
    cwd = sanitiseCwd(b.cwd);
  } catch (e) {
    return err(res, e.code || "EBADCWD", e.message);
  }

  const permissionMode =
    typeof b.permissionMode === "string" && ALLOWED_PERMISSION_MODES.has(b.permissionMode)
      ? b.permissionMode
      : "plan";
  const effort = typeof b.effort === "string" && ALLOWED_EFFORT.has(b.effort) ? b.effort : "";
  const model = typeof b.model === "string" && b.model ? b.model : null;
  const mode = b.mode === "headless" ? "headless" : "conversation";

  let task;
  try {
    task = repo.tasks.createTask({
      department_id: b.department_id || defaultDeptId(),
      title: titleFromPrompt(prompt),
      description: prompt,
      working_dir: cwd,
      workflow_id: b.workflowId || b.workflow_id || null,
    });
    const msg = repo.tasks.addMessage({
      task_id: task.id,
      sender_type: "human",
      sender_id: "human",
      content: prompt,
      message_type: "chat",
      metadata: { source: "kad_run_task" },
    });
    emitTask(task.id, "kad.message.created", msg);

    const handle = runs.spawnRun({
      prompt,
      mode,
      cwd,
      model,
      permissionMode,
      effort,
      source: "kad_task",
      taskId: task.id,
      onStatusChange: syncRunStatusToTask,
    });
    syncRunStatusToTask({ handle, status: "spawning" });
    return res.status(201).json({ task: repo.tasks.getTask(task.id), run: runs.getRun(handle.id) });
  } catch (e) {
    if (task) {
      repo.tasks.updateTask(task.id, { status: "failed" });
      addSystemMessage(task.id, `Không thể khởi chạy Claude Code: ${e.message}`, {
        source: "kad_run_task",
        error: e.message,
      });
    }
    if (e.code === "ECONCURRENCY") {
      return err(res, e.code, e.message, 429, {
        task_id: task && task.id,
        running: e.running || [],
      });
    }
    return err(res, e.code || "EINTERNAL", e.message || "failed to start run", e.code ? 400 : 500, {
      task_id: task && task.id,
    });
  }
});

router.get("/run-task/by-task/:taskId", (req, res) => {
  const task = repo.tasks.getTask(req.params.taskId);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  res.json({ items: dashboardRuns.listRunsByTask(task.id, { limit: 20 }) });
});

module.exports = router;
