/**
 * @file server/routes/kad/approvals.js — Approvals (spec 03 §Approvals).
 * Deciding an approval enqueues a durable resume_task job (turn-based; the
 * resume runs a fresh --resume turn, never resumes a held process). Reject /
 * needs_changes also records a rough learning_note (Phase 5 does full analysis).
 */
const express = require("express");
const repo = require("../../lib/kad/repo");
const workflowEngine = require("../../lib/kad/workflow-engine");
const { emitTask, emitDept } = require("../../lib/kad/events");
const { analyzeLearningNote } = require("../../lib/kad/learning-loop");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });
const DECISIONS = new Set(["approved", "needs_changes", "rejected"]);

router.get("/", (req, res) => {
  if (req.query.status && req.query.status !== "pending") {
    // Only pending is a first-class list in Phase 1; others filter by task.
  }
  const rows = repo.approvals.listPending({ department_id: req.query.department });
  // Department-level views (Tổng quan inbox, spec/ui/02 §6) render across many
  // tasks at once and need the task title inline — decorate here rather than
  // widening repo.approvals.listPending's own return shape.
  res.json(
    rows.map((a) => ({ ...a, task_title: (repo.tasks.getTask(a.task_id) || {}).title || null }))
  );
});

router.get("/:id", (req, res) => {
  const a = repo.approvals.getApproval(req.params.id);
  if (!a) return err(res, "ENOTFOUND", "approval not found", 404);
  const artifact = a.artifact_id ? repo.artifacts.getArtifact(a.artifact_id) : null;
  res.json({ ...a, artifact });
});

router.post("/:id/decide", (req, res) => {
  const a = repo.approvals.getApproval(req.params.id);
  if (!a) return err(res, "ENOTFOUND", "approval not found", 404);
  if (a.status !== "pending")
    return err(res, "EALREADYDECIDED", `approval already ${a.status}`, 409);
  const b = req.body || {};
  if (!DECISIONS.has(b.decision))
    return err(res, "EBADDECISION", "decision must be approved|needs_changes|rejected");

  const task = repo.tasks.getTask(a.task_id);
  let decided;
  repo.tx(() => {
    decided = repo.approvals.decide(a.id, {
      decision: b.decision,
      reason: b.reason,
      channel: b.channel,
      channel_actor_ref: b.channel_actor_ref,
    });
    // Approving an artifact-bound approval (framework/syllabus/sensitive) flips the
    // artifact to 'approved' — the durable fact the workflow engine reads to advance
    // the step machine and to satisfy the next step's auto-approval parent check.
    if (a.artifact_id && b.decision === "approved") {
      const art = repo.artifacts.getArtifact(a.artifact_id);
      if (art && art.status !== "approved" && art.status !== "published")
        repo.artifacts.updateArtifact(art.id, { status: "approved" });
    }
    repo.audit({
      department_id: task && task.department_id,
      task_id: a.task_id,
      action: "approval_decided",
      actor_type: "human",
      actor_id: "human",
      channel: b.channel || "web",
      target_type: "approval",
      target_id: a.id,
      details: { decision: b.decision, approval_type: a.approval_type },
    });
    if (b.decision === "rejected" || b.decision === "needs_changes") {
      analyzeLearningNote({
        department_id: task && task.department_id,
        task_id: a.task_id,
        artifact_id: a.artifact_id,
        trigger_type: b.decision === "rejected" ? "human_rejection" : "human_revision",
        feedback_content: b.reason || `${a.approval_type} bị ${b.decision}`,
        artifact_title: a.title,
        artifact_content: a.description,
      }).catch(console.error);
    }
  });

  emitTask(a.task_id, "kad.approval.decided", decided);
  // Also department-scoped: the Tổng quan inbox (spec/ui/02 §6) subscribes at
  // department level, not per-task, so it can see decisions across all tasks.
  emitDept(task && task.department_id, "kad.approval.decided", decided);

  // Advance tasks.workflow_step off the new state (plan approved → research, etc.).
  try {
    workflowEngine.syncStep(a.task_id);
  } catch (e) {
    console.warn(`[kad] approvals/decide: syncStep failed for task ${a.task_id}:`, e && e.message);
  }

  // Enqueue a resume turn (durable — survives restart). Explicit next-tool
  // instruction (not just "tiến hành bước tiếp theo") — a vague resume prompt
  // measurably let the agent drift (ramble / re-plan / stop without acting)
  // across live runs; naming the exact tool keeps the turn on-script.
  const message =
    b.decision === "approved"
      ? a.approval_type === "plan"
        ? `Kế hoạch "${a.title}" đã được DUYỆT — không cần hỏi lại. HÀNH ĐỘNG DUY NHẤT của lượt này: gọi kad_create_delegation để giao việc cho sub-agent phù hợp (nếu việc cần tự làm, tự thực hiện rồi gọi kad_save_artifact). Không nhắc lại kế hoạch bằng text. Sau khi hành động xong, DỪNG lượt.`
        : `"${a.title}" đã được DUYỆT — không cần hỏi lại. Tiếp tục thực thi phần việc liên quan ngay (không nhắc lại bằng text), rồi DỪNG lượt.`
      : `Trưởng phòng ${b.decision === "rejected" ? "TỪ CHỐI" : "YÊU CẦU SỬA"} "${a.title}". Lý do: ${b.reason || "(không nêu)"}. Hãy xử lý phù hợp rồi DỪNG lượt.`;
  let enqueued;
  try {
    enqueued = repo.jobs.enqueue({
      kind: "resume_task",
      payload: { task_id: a.task_id, message },
      dedupKey: `resume:${a.task_id}`,
    });
  } catch (e) {
    // A silent throw here would leave the approval marked decided (already
    // committed above) with NO further agent turn ever firing — the task
    // looks "stuck" with no visible error anywhere. Log loudly instead.
    console.error(
      `[kad] approvals/decide: resume enqueue FAILED for task ${a.task_id}:`,
      e && e.stack
    );
    return res.json({ approval: decided, resume_enqueued: false, resume_error: e && e.message });
  }

  res.json({
    approval: decided,
    resume_enqueued: true,
    resume_job_id: enqueued && enqueued.id,
    resume_job_status: enqueued && enqueued.status,
  });
});

module.exports = router;
