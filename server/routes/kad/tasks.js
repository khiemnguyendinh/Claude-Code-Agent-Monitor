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
const { getUploader } = require("./attachments-upload");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });
const uploader = getUploader();

// Mirrors the CHECK constraints in kad-001-init.sql — validate here so a bad
// value 400s with a structured error instead of an uncaught SqliteError 500.
const TASK_STATUSES = [
  "blocked",
  "inbox",
  "triaged",
  "doing",
  "waiting_human",
  "review",
  "needs_changes",
  "done",
  "failed",
  "archived",
];
const TASK_PRIORITIES = ["urgent", "high", "normal", "low"];

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
  // [spec/ui/07 §1] Names declared attached at Giao việc time (composer has no
  // real file picker yet — see repo/task-attachments.js). No message exists
  // yet at task-creation time, so message_id is null on these rows.
  if (Array.isArray(b.attachment_names) && b.attachment_names.length) {
    repo.attachments.createMany({
      task_id: task.id,
      working_dir: b.working_dir,
      names: b.attachment_names.slice(0, 20).map(String),
    });
  }
  emitDept(department_id, "kad.task.status", { task_id: task.id, status: task.status });
  res.status(201).json(task);
});

router.get("/", (req, res) => {
  res.json(
    repo.tasks.listTasks({
      status: req.query.status,
      department_id: req.query.department,
      limit: req.query.limit,
    })
  );
});

router.get("/:id", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  res.json({ ...task, counts: repo.tasks.getTaskCounts(task.id) });
});

router.patch("/:id", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  const b = req.body || {};
  if (b.status !== undefined && !TASK_STATUSES.includes(b.status))
    return err(res, "EBADSTATUS", "invalid status");
  if (b.priority !== undefined && !TASK_PRIORITIES.includes(b.priority))
    return err(res, "EBADPRIORITY", "invalid priority");
  const patch = {};
  for (const k of ["status", "priority", "due_date"])
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  const updated = repo.tasks.updateTask(req.params.id, patch);
  emitTask(req.params.id, "kad.task.status", { task_id: req.params.id, status: updated.status });
  res.json(updated);
});

router.post("/:id/messages", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  const b = req.body || {};
  if (!b.content || typeof b.content !== "string")
    return err(res, "EBADCONTENT", "content is required");
  const attachmentNames = Array.isArray(b.attachment_names)
    ? b.attachment_names.slice(0, 20).map(String)
    : undefined;
  const msg = repo.tasks.addMessage({
    task_id: task.id,
    sender_type: "human",
    sender_id: "human",
    content: b.content,
    message_type: "chat",
    channel: b.channel,
    channel_actor_ref: b.channel_actor_ref,
    // [spec 07 §5] Lets the chat bubble render a real FileText chip
    // (TraoDoiCongViec.tsx's TimelineItemRenderer already reads this) instead
    // of relying only on the "📎 Đính kèm: …" text `orchestrator.js`'s
    // startTaskTurn/resumeTaskTurn read straight off `content` for the Main
    // Agent's prompt — keep BOTH: metadata for the human-facing chip,
    // content text for the agent (orchestrator.js doesn't read metadata).
    metadata: attachmentNames ? { attachmentNames } : undefined,
  });
  emitTask(task.id, "kad.message.created", msg);
  // Turn-based: the FIRST human message on a task starts a fresh planning turn;
  // any later message (answering an intake question, free chat, steering after
  // a brief lock) must RESUME the same engine session with the raw text instead
  // of re-running the "start fresh" planning prompt — otherwise every reply
  // during intake would look like a brand-new goal to the agent.
  const hasPriorRun = repo.runs.listByTask(task.id).length > 0;
  setImmediate(() => {
    const turn = hasPriorRun
      ? orchestrator.resumeTaskTurn(task.id, { message: b.content })
      : orchestrator.startTaskTurn(task.id);
    turn.catch((e) => {
      console.warn(`[kad] task turn(${task.id}) error:`, e && e.message);
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

router.get("/:id/attachments", (req, res) => {
  res.json(repo.attachments.listByTask(req.params.id));
});

// spec 03: "multipart file[] -> task_attachments + copy vao tasks.working_dir,
// tra [{id, file_name}]" — real bytes (see attachments-upload.js for the
// traversal/size/filename safety notes). Fields other than the file array are
// ignored; `message_id` is optional (composer attaches mid-conversation
// against an existing message the same request adds separately).
router.post("/:id/attachments", (req, res) => {
  if (!uploader)
    return err(res, "ENOUPLOAD", "file upload unavailable (multer not installed)", 503);
  uploader.array("file", 10)(req, res, (uploadErr) => {
    if (uploadErr) {
      // uploadErr can be a raw fs error from resolveTaskDir's mkdirSync
      // (ENOTDIR/EACCES etc.), which always embeds the absolute filesystem
      // path in .message — log it server-side, never forward it verbatim.
      console.warn(`[kad] attachment upload error (task ${req.params.id}):`, uploadErr.message);
      return err(res, "EUPLOAD", "Không thể tải file lên.");
    }
    const task = repo.tasks.getTask(req.params.id);
    if (!task) return err(res, "ENOTFOUND", "task not found", 404);
    const files = req.files || [];
    if (!files.length) return err(res, "ENOFILE", "no file provided");
    const rows = repo.attachments.createFromUpload({
      task_id: task.id,
      message_id: req.body?.message_id,
      files: files.map((f) => ({
        file_name: f.originalname,
        mime: f.mimetype,
        size: f.size,
        storage_path: f.path,
      })),
    });
    repo.audit({
      department_id: task.department_id,
      task_id: task.id,
      action: "attachments_uploaded",
      actor_type: "human",
      actor_id: "human",
      target_type: "task",
      target_id: task.id,
      details: { count: rows.length, names: rows.map((r) => r.file_name) },
    });
    res.status(201).json(rows);
  });
});

// spec/ui/09 §1 "Khi điều kiện" — task tạo ở 'blocked' + task_dependencies,
// KHÔNG vào chat intake. Chỉ create/read ở đây; đánh giá điều kiện thật (khi
// nguồn hoàn thành/được duyệt) là Phase 3's evaluate_rules worker.
router.post("/:id/dependencies", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  const b = req.body || {};
  if (!["dep_task_done", "dep_artifact_approved", "all_deps_done"].includes(b.release_condition)) {
    return err(res, "EBADCONDITION", "invalid release_condition");
  }
  if (!b.depends_on_task_id && !b.depends_on_artifact_type) {
    return err(res, "EBADSOURCE", "depends_on_task_id or depends_on_artifact_type is required");
  }
  if (b.depends_on_task_id) {
    if (!repo.tasks.getTask(b.depends_on_task_id))
      return err(res, "ENODEPTASK", "depends_on_task_id not found", 404);
    if (repo.dependencies.wouldCreateCycle(task.id, b.depends_on_task_id))
      return err(res, "ECYCLE", "would create a dependency cycle (task would block forever)");
  }
  let dep;
  repo.tx(() => {
    dep = repo.dependencies.createDependency({
      task_id: task.id,
      depends_on_task_id: b.depends_on_task_id,
      depends_on_artifact_type: b.depends_on_artifact_type,
      release_condition: b.release_condition,
    });
    repo.tasks.updateTask(task.id, { status: "blocked", activation: "dependency" });
    repo.audit({
      department_id: task.department_id,
      task_id: task.id,
      action: "dependency_created",
      actor_type: "human",
      actor_id: "human",
      target_type: "task_dependency",
      target_id: dep.id,
      details: { depends_on_task_id: b.depends_on_task_id, release_condition: b.release_condition },
    });
  });
  emitDept(task.department_id, "kad.task.status", { task_id: task.id, status: "blocked" });
  res.status(201).json(dep);
});

router.get("/:id/dependencies", (req, res) => {
  res.json(repo.dependencies.listByTask(req.params.id));
});

router.get("/:id/delegations", (req, res) => {
  res.json(repo.delegations.listByTask(req.params.id));
});

// [Chốt & giao] — human locks the latest undecided Brief Card (spec 07 §3).
// Mirrors approvals.js decide(): flips the card's state, then enqueues a
// durable resume_task job (never resumes a held process).
router.post("/:id/brief/lock", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  const briefMsg = repo.tasks.latestMessageByType(task.id, "brief");
  if (!briefMsg || !briefMsg.metadata || !briefMsg.metadata.brief)
    return err(res, "ENOBRIEF", "no brief to lock", 404);
  if (briefMsg.metadata.brief.decidedAt)
    return err(res, "EALREADYDECIDED", "brief already locked", 409);

  const b = req.body || {};
  const decidedAt = new Date().toISOString();
  const brief = { ...briefMsg.metadata.brief, decidedAt };
  let updatedMsg;
  repo.tx(() => {
    updatedMsg = repo.tasks.updateMessageMetadata(briefMsg.id, { brief });
    repo.tasks.updateTask(task.id, {
      brief,
      status: ["inbox", "triaged"].includes(task.status) ? "doing" : task.status,
    });
    repo.audit({
      department_id: task.department_id,
      task_id: task.id,
      action: "brief_locked",
      actor_type: "human",
      actor_id: "human",
      channel: b.channel || "web",
      target_type: "message",
      target_id: briefMsg.id,
      details: {},
    });
  });
  emitTask(task.id, "kad.message.updated", updatedMsg);
  emitTask(task.id, "kad.task.status", {
    task_id: task.id,
    status: repo.tasks.getTask(task.id).status,
  });
  try {
    repo.jobs.enqueue({
      kind: "resume_task",
      payload: {
        task_id: task.id,
        message:
          "Brief đã được trưởng phòng CHỐT — không cần hỏi thêm gì nữa. HÀNH ĐỘNG DUY NHẤT của lượt này: gọi tool kad_plan_task với kế hoạch thực hiện (không nhắn text thường trước, không tool nào khác). Sau khi gọi kad_plan_task, DỪNG lượt ngay.",
      },
      dedupKey: `resume:${task.id}`,
    });
  } catch (e) {
    console.error(`[kad] brief/lock: resume enqueue FAILED for task ${task.id}:`, e && e.stack);
    return res.json({ message: updatedMsg, resume_enqueued: false, resume_error: e && e.message });
  }
  res.json({ message: updatedMsg, resume_enqueued: true });
});

// [Duyệt tất cả] / [Yêu cầu sửa] on a Report Card (spec 07 §4) — a super-set of
// approvals.js decide() covering possibly-multiple artifacts + a cost summary.
router.post("/:id/report/:messageId/decide", (req, res) => {
  const task = repo.tasks.getTask(req.params.id);
  if (!task) return err(res, "ENOTFOUND", "task not found", 404);
  const msg = repo.tasks.getMessage(req.params.messageId);
  if (!msg || msg.task_id !== task.id || msg.message_type !== "report")
    return err(res, "ENOTFOUND", "report message not found", 404);
  const report = msg.metadata && msg.metadata.report;
  if (!report) return err(res, "EBADSTATE", "message has no report payload");
  if (report.decision)
    return err(res, "EALREADYDECIDED", `report already ${report.decision.status}`, 409);
  const b = req.body || {};
  if (!["approved", "needs_changes"].includes(b.decision))
    return err(res, "EBADDECISION", "decision must be approved|needs_changes");
  if (b.decision === "needs_changes" && !b.reason)
    return err(res, "EBADREASON", "reason is required for needs_changes");

  const at = new Date().toISOString();
  let updatedMsg;
  repo.tx(() => {
    if (b.decision === "approved") {
      for (const a of report.artifacts || []) {
        const art = repo.artifacts.getArtifact(a.artifactId);
        if (art && art.status !== "approved")
          repo.artifacts.updateArtifact(art.id, { status: "approved" });
      }
    }
    const decision =
      b.decision === "needs_changes"
        ? { status: b.decision, at, reason: b.reason }
        : { status: b.decision, at };
    updatedMsg = repo.tasks.updateMessageMetadata(msg.id, { report: { ...report, decision } });
    repo.tasks.updateTask(task.id, {
      status: b.decision === "approved" ? "done" : "needs_changes",
    });
    if (b.decision === "needs_changes") {
      repo.tasks.addMessage({
        task_id: task.id,
        sender_type: "human",
        sender_id: "human",
        content: b.reason,
        message_type: "chat",
      });
      repo.learning.createNote({
        department_id: task.department_id,
        task_id: task.id,
        trigger_type: "human_revision",
        feedback_content: b.reason,
        severity: "major",
        affected_areas: ["report"],
      });
    }
    repo.audit({
      department_id: task.department_id,
      task_id: task.id,
      action: "report_decided",
      actor_type: "human",
      actor_id: "human",
      channel: b.channel || "web",
      target_type: "message",
      target_id: msg.id,
      details: { decision: b.decision },
    });
  });
  emitTask(task.id, "kad.message.updated", updatedMsg);
  emitTask(task.id, "kad.task.status", {
    task_id: task.id,
    status: repo.tasks.getTask(task.id).status,
  });
  if (b.decision === "needs_changes") {
    try {
      repo.jobs.enqueue({
        kind: "resume_task",
        payload: {
          task_id: task.id,
          message: `Trưởng phòng YÊU CẦU SỬA báo cáo. Lý do: ${b.reason}. Hãy xử lý rồi gửi báo cáo mới (kad_present_report) khi xong.`,
        },
        dedupKey: `resume:${task.id}`,
      });
    } catch (e) {
      console.error(
        `[kad] report/decide: resume enqueue FAILED for task ${task.id}:`,
        e && e.stack
      );
      return res.json({
        message: updatedMsg,
        resume_enqueued: false,
        resume_error: e && e.message,
      });
    }
  }
  res.json({ message: updatedMsg, resume_enqueued: b.decision === "needs_changes" });
});

router.post("/:id/cancel-run", (req, res) => {
  // Phase 1: mark any running run cancelled (best-effort; process already turn-based).
  const runs = repo.runs.listByTask(req.params.id).filter((r) => r.status === "running");
  for (const r of runs) repo.runs.updateRun(r.id, { status: "cancelled" });
  res.json({ cancelled: runs.map((r) => r.id) });
});

module.exports = router;
