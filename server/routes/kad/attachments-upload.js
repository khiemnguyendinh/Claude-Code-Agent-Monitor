/**
 * @file server/routes/kad/attachments-upload.js — multer uploader for
 * `POST /api/kad/tasks/:id/attachments` (spec 03: "multipart file[] ->
 * task_attachments + copy vao tasks.working_dir"). Split out of tasks.js
 * to keep the multer/filesystem concern isolated from the thin CRUD routes.
 *
 * Security notes (this endpoint writes to disk from request input):
 *   - `destination` resolves the task's `working_dir` through
 *     workspace-root.js, which throws on any attempt to escape the
 *     workspace root (e.g. `working_dir` containing "../..").
 *   - `filename` keeps only `path.basename(originalname)` (a client-
 *     supplied name like "../../evil.sh" cannot smuggle in a directory
 *     traversal component) and strips control/null bytes, then prefixes a
 *     random token so two uploads with the same name never silently
 *     overwrite each other.
 *   - Size/count capped (`limits` below); generous enough for reference
 *     docs (xlsx/pdf/docx) without allowing unbounded disk usage.
 */
const path = require("node:path");
const crypto = require("node:crypto");
const repo = require("../../lib/kad/repo");
const { resolveTaskDir } = require("../../lib/kad/workspace-root");

const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB - plenty for reference docs, not a media host

// eslint-disable-next-line no-control-regex -- stripping control/null bytes is the point
const CONTROL_CHARS = /[\x00-\x1f]/g;

/**
 * Lazily build the multer instance - mirrors server/routes/import.js's
 * pattern so the route still degrades (503) instead of crashing the process
 * if `multer` is ever unavailable.
 */
function getUploader() {
  let multer;
  try {
    multer = require("multer");
  } catch {
    return null;
  }
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const task = repo.tasks.getTask(req.params.id);
      if (!task) return cb(new Error("task not found"));
      // Every current UI flow always sets a real working_dir before creating
      // a task, but the plain-JSON POST /tasks doesn't require one — fall
      // back to a per-task subfolder so such a task's uploads still land
      // isolated instead of resolveTaskDir rejecting an empty value outright.
      const workingDir = task.working_dir || `_unassigned/${task.id}`;
      try {
        cb(null, resolveTaskDir(workingDir));
      } catch (e) {
        cb(e);
      }
    },
    filename: (_req, file, cb) => {
      const safeBase = path.basename(file.originalname || "file").replace(CONTROL_CHARS, "");
      const rand = crypto.randomBytes(4).toString("hex");
      cb(null, `${rand}__${safeBase}`);
    },
  });
  return multer({
    storage,
    limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: 8 },
  });
}

module.exports = { getUploader, MAX_FILES, MAX_FILE_BYTES };
