/**
 * @file server/routes/kad/artifacts-upload.js — /hoc-lieu upload (loose files
 * or an entire folder). No schema change needed: `artifacts` already has
 * `file_path` + `metadata` columns (designed for disk-backed content from day
 * one, per kad-001-init.sql) — this just adds the human-facing multipart
 * route that was always missing (previously agent-only via
 * /internal/save-artifact, JSON body, no multipart).
 *
 * memoryStorage (not diskStorage): a folder upload's per-file relative path
 * arrives as a separate `relative_paths` form field, which — depending on
 * multipart field order in the request — may not have been parsed yet by the
 * time multer's per-file diskStorage callbacks run. Buffering in memory and
 * writing to disk ourselves in the route handler (after the whole request is
 * parsed) sidesteps that ordering hazard entirely.
 *
 * Security: every path segment of a client-supplied relative path is reduced
 * to its own `path.basename` (strips any "..", drive letters, or absolute
 * prefix) before being used in a `fs` call — a folder named "../../etc" in
 * the upload cannot escape this batch's directory.
 */
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const { getDataDir } = require("../../lib/claude-home");
const repo = require("../../lib/kad/repo");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

const MAX_FILES = 200; // generous for a folder upload with subfolders
const MAX_FILE_BYTES = 25 * 1024 * 1024; // matches attachments-upload.js's cap

// eslint-disable-next-line no-control-regex -- stripping control/null bytes is the point
const CONTROL_CHARS = /[\x00-\x1f]/g;

function sanitizeRelativePath(relPath, fallbackName) {
  const raw = String(relPath || fallbackName || "file").replace(CONTROL_CHARS, "");
  const segments = raw
    .split(/[/\\]+/)
    .map((s) => path.basename(s))
    .filter((s) => s && s !== "." && s !== "..");
  return segments.length ? segments.join(path.sep) : path.basename(fallbackName || "file");
}

function getUploader() {
  let multer;
  try {
    multer = require("multer");
  } catch {
    return null;
  }
  return multer({
    storage: multer.memoryStorage(),
    limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES },
  });
}
const uploader = getUploader();

router.post("/artifacts/upload", (req, res) => {
  if (!uploader) return err(res, "ENOUPLOADER", "file upload is unavailable on this server", 503);
  uploader.array("files", MAX_FILES)(req, res, (e) => {
    if (e) return err(res, "EBADUPLOAD", e.message || "upload failed", 400);
    const files = req.files || [];
    if (!files.length)
      return err(res, "ENOFILE", 'no files uploaded (field name must be "files")', 400);

    let relativePaths = [];
    try {
      relativePaths = req.body.relative_paths ? JSON.parse(req.body.relative_paths) : [];
    } catch {
      return err(res, "EBADPATHS", "relative_paths must be a JSON array", 400);
    }

    const batchId = crypto.randomUUID();
    const batchDir = path.join(getDataDir(), "kad-hoc-lieu", batchId);

    try {
      const created = files.map((file, i) => {
        const relPath = sanitizeRelativePath(relativePaths[i], file.originalname);
        const destPath = path.join(batchDir, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, file.buffer);
        return repo.artifacts.createArtifact({
          task_id: null,
          agent_id: null,
          artifact_type: "other",
          title: path.basename(relPath),
          file_path: destPath,
          status: "published",
          metadata: {
            source: "uploaded",
            original_name: file.originalname,
            relative_path: relPath,
            mime_type: file.mimetype,
            batch_id: batchId,
            uploaded_by: "human",
          },
        });
      });
      res.json(created);
    } catch (e2) {
      err(
        res,
        "EBADARTIFACT",
        e2 instanceof Error ? e2.message : "could not save uploaded materials",
        400
      );
    }
  });
});

router.get("/artifacts/:id/download", (req, res) => {
  const a = repo.artifacts.getArtifact(req.params.id);
  if (!a || !a.file_path) return err(res, "ENOTFOUND", "no file for this artifact", 404);
  const meta = a.metadata || {};
  res.setHeader("Content-Type", meta.mime_type || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${(meta.original_name || a.title || "file").replace(/"/g, "")}"`
  );
  res.sendFile(a.file_path, (e) => {
    if (e && !res.headersSent) err(res, "ENOTFOUND", "file no longer on disk", 404);
  });
});

module.exports = router;
