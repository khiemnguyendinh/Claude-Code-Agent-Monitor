/**
 * @file server/routes/kad/attachments.js — DELETE /api/kad/attachments/:id.
 * Removing a chip in the composer must actually remove the attachment (row +
 * file), not just clear client-side display state — see task-attachments.js.
 */
const fs = require("node:fs");
const express = require("express");
const repo = require("../../lib/kad/repo");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

router.delete("/attachments/:id", (req, res) => {
  const attachment = repo.attachments.getAttachment(req.params.id);
  if (!attachment) return err(res, "ENOTFOUND", "attachment not found", 404);
  repo.attachments.deleteAttachment(attachment.id);
  // Best-effort: a names-only declare (createMany, [GAP] no real file picker
  // path) has a storage_path with no real file behind it yet — ENOENT there
  // is expected, not an error worth surfacing.
  try {
    fs.unlinkSync(attachment.storage_path);
  } catch {
    /* file already gone or never existed — fine */
  }
  res.json({ id: attachment.id, task_id: attachment.task_id });
});

module.exports = router;
