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
  // A names-only declare (createMany, [GAP] no real file picker path) sets
  // storage_path to a bare "working_dir/name" string with no real file behind
  // it — never resolved through workspace-root.js, so it must NEVER be passed
  // to fs.unlinkSync (a relative path resolves against the server's CWD, not
  // the workspace root; unlinking it could remove an unrelated coincidental
  // file). Only createFromUpload rows have a real file — they're the only
  // ones with mime/size populated.
  if (attachment.mime !== null || attachment.size !== null) {
    try {
      fs.unlinkSync(attachment.storage_path);
    } catch {
      /* file already gone — fine */
    }
  }
  res.json({ id: attachment.id, task_id: attachment.task_id });
});

module.exports = router;
