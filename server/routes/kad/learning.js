/**
 * @file server/routes/kad/learning.js — Learning Notes API (spec 04 §5).
 * Endpoints for the UI to list, propose and approve learning notes.
 */
const express = require("express");
const repo = require("../../lib/kad/repo");
const { emitDept } = require("../../lib/kad/events");

const router = express.Router();
const bad = (res, code, message, status = 400) => res.status(status).json({ error: { code, message } });

router.get("/", (req, res) => {
  const department_id = req.query.department;
  if (!department_id) return bad(res, "EBADDEPT", "department is required");
  const notes = repo.learning.listRecent({ department_id, limit: 100 });
  res.json(notes);
});

router.post("/:id/propose", (req, res) => {
  const note = repo.learning.getNote(req.params.id);
  if (!note) return bad(res, "ENOTFOUND", "note not found", 404);
  if (note.change_status !== "noted") return bad(res, "EBADSTATUS", "only noted notes can be proposed");
  
  let updated;
  repo.tx(() => {
    updated = repo.learning.updateStatus(note.id, "proposed");
    repo.audit({
      department_id: note.department_id,
      task_id: note.task_id,
      action: "learning_note_proposed",
      actor_type: "human",
      actor_id: "human",
      target_type: "learning_note",
      target_id: note.id,
      details: { category: note.correction_category }
    });
  });
  emitDept(note.department_id, "kad.learning_note.updated", updated);
  res.json(updated);
});

router.post("/:id/approve", (req, res) => {
  const note = repo.learning.getNote(req.params.id);
  if (!note) return bad(res, "ENOTFOUND", "note not found", 404);
  if (note.change_status !== "proposed") return bad(res, "EBADSTATUS", "only proposed notes can be approved");
  
  let updated;
  repo.tx(() => {
    // In MVP, we just mark it as applied/approved.
    updated = repo.learning.updateStatus(note.id, "applied");
    repo.audit({
      department_id: note.department_id,
      task_id: note.task_id,
      action: "learning_note_applied",
      actor_type: "human",
      actor_id: "human",
      target_type: "learning_note",
      target_id: note.id,
      details: { category: note.correction_category }
    });
  });
  emitDept(note.department_id, "kad.learning_note.updated", updated);
  res.json(updated);
});

module.exports = router;
