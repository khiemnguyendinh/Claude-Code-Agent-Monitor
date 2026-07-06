/**
 * @file server/routes/kad/templates-upload.js — Thư viện mẫu binary uploads
 * (Phase 5: .docx/.pdf/.xlsx alongside the existing .md path in knowledge.js).
 * Disk storage under the dashboard's own data dir (not per-task — templates
 * are a department-wide library, not tied to a task's working_dir).
 *
 * Security notes (mirrors server/routes/kad/attachments-upload.js):
 *   - Destination is fixed and always inside the app's own data directory —
 *     no user-supplied path segment ever reaches `fs`.
 *   - `filename` keeps only `path.basename(originalname)` (blocks directory
 *     traversal via a crafted name) and strips control/null bytes, then
 *     prefixes a random token so two uploads with the same name never
 *     silently overwrite each other.
 *   - Size capped generously per format (see repo/templates.js BINARY_FORMATS)
 *     — multer's own limit here is the max across formats; the tighter
 *     per-format cap is enforced in templates.js's validateTemplateInput.
 */
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const { getDataDir } = require("../../lib/claude-home");
const repo = require("../../lib/kad/repo");
const { BINARY_FORMATS } = require("../../lib/kad/repo/templates");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

const TEMPLATES_DIR = path.join(getDataDir(), "kad-templates");
const MAX_UPLOAD_BYTES = Math.max(...Object.values(BINARY_FORMATS).map((f) => f.maxBytes));

// eslint-disable-next-line no-control-regex -- stripping control/null bytes is the point
const CONTROL_CHARS = /[\x00-\x1f]/g;

function getUploader() {
  let multer;
  try {
    multer = require("multer");
  } catch {
    return null;
  }
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEMPLATES_DIR),
    filename: (_req, file, cb) => {
      const safeBase = path.basename(file.originalname || "file").replace(CONTROL_CHARS, "");
      const rand = crypto.randomBytes(4).toString("hex");
      cb(null, `${rand}__${safeBase}`);
    },
  });
  return multer({ storage, limits: { files: 1, fileSize: MAX_UPLOAD_BYTES } });
}
const uploader = getUploader();

router.post("/templates/upload", (req, res) => {
  if (!uploader) return err(res, "ENOUPLOADER", "file upload is unavailable on this server", 503);
  uploader.single("file")(req, res, (e) => {
    if (e) return err(res, "EBADUPLOAD", e.message || "upload failed", 400);
    if (!req.file) return err(res, "ENOFILE", 'no file uploaded (field name must be "file")', 400);
    try {
      const result = repo.templates.createDraft({
        template_id: req.body.template_id || undefined,
        name: req.body.name,
        template_type: req.body.template_type,
        purpose: req.body.purpose,
        change_summary: req.body.change_summary,
        department_id: req.body.department_id || undefined,
        file_path: req.file.path,
        file_size: req.file.size,
        original_file_name: req.file.originalname,
      });
      res.json(result);
    } catch (err2) {
      // Best-effort cleanup — validation failed after multer already wrote the file to disk.
      fs.unlink(req.file.path, () => {});
      err(
        res,
        "EBADTEMPLATE",
        err2 instanceof Error ? err2.message : "could not create template",
        400
      );
    }
  });
});

router.get("/templates/versions/:versionId/download", (req, res) => {
  const version = repo.templates.getVersion(req.params.versionId);
  if (!version || !version.file_path)
    return err(res, "ENOTFOUND", "no file for this template version", 404);
  // ?inline=1 -> quick-view preview tab (browser renders in place when it can,
  // e.g. PDF); omitted/anything else keeps the existing forced-download behavior.
  const disposition = req.query.inline === "1" ? "inline" : "attachment";
  res.setHeader("Content-Type", version.mime_type || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${(version.original_file_name || "template").replace(/"/g, "")}"`
  );
  res.sendFile(version.file_path, (e) => {
    if (e && !res.headersSent) err(res, "ENOTFOUND", "file no longer on disk", 404);
  });
});

module.exports = router;
