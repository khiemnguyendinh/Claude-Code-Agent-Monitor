/**
 * @file server/routes/kad/approvals.js — Approvals (spec 03 §Approvals).
 * Deciding an approval enqueues a durable resume_task job (turn-based; the
 * resume runs a fresh --resume turn, never resumes a held process). Reject /
 * needs_changes also records a rough learning_note (Phase 5 does full analysis).
 */
const express = require("express");
const repo = require("../../lib/kad/repo");
const { emitTask } = require("../../lib/kad/events");

const router = express.Router();
const err = (res, code, message, status = 400) => res.status(status).json({ error: { code, message } });
const DECISIONS = new Set(["approved", "needs_changes", "rejected"]);

router.get("/", (req, res) => {
  if (req.query.status && req.query.status !== "pending") {
    // Only pending is a first-class list in Phase 1; others filter by task.
  }
  res.json(repo.approvals.listPending({ department_id: req.query.department }));
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
  if (a.status !== "pending") return err(res, "EALREADYDECIDED", `approval already ${a.status}`, 409);
  const b = req.body || {};
  if (!DECISIONS.has(b.decision)) return err(res, "EBADDECISION", "decision must be approved|needs_changes|rejected");

  const task = repo.tasks.getTask(a.task_id);
  let decided;
  repo.tx(() => {
    decided = repo.approvals.decide(a.id, { decision: b.decision, reason: b.reason, channel: b.channel, channel_actor_ref: b.channel_actor_ref });
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
      repo.learning.createNote({
        department_id: task && task.department_id,
        task_id: a.task_id,
        artifact_id: a.artifact_id,
        trigger_type: b.decision === "rejected" ? "human_rejection" : "human_revision",
        feedback_content: b.reason || `${a.approval_type} bị ${b.decision}`,
        severity: "major",
        affected_areas: ["flow"],
      });
    }
  });

  emitTask(a.task_id, "kad.approval.decided", decided);

  // Enqueue a resume turn (durable — survives restart).
  const message =
    b.decision === "approved"
      ? `Kế hoạch/nội dung "${a.title}" đã được DUYỆT. Hãy tiến hành bước tiếp theo (giao việc cho sub-agent nếu cần).`
      : `Trưởng phòng ${b.decision === "rejected" ? "TỪ CHỐI" : "YÊU CẦU SỬA"} "${a.title}". Lý do: ${b.reason || "(không nêu)"}. Hãy xử lý phù hợp.`;
  repo.jobs.enqueue({ kind: "resume_task", payload: { task_id: a.task_id, message }, dedupKey: `resume:${a.task_id}` });

  res.json({ approval: decided, resume_enqueued: true });
});

module.exports = router;
