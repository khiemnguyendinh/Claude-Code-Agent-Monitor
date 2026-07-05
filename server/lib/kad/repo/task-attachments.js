/**
 * @file server/lib/kad/repo/task-attachments.js — task_attachments (spec 02,
 * spec/ui/07 §1). Two ways a row gets created:
 *   - `createMany` — names-only declare (no real bytes), used when a task is
 *     created via plain JSON (`POST /tasks` body `attachment_names[]`) with
 *     no follow-up upload — e.g. API/headless callers, or a schedule-created
 *     task that doesn't exist yet to upload against.
 *   - `createFromUpload` — a real file was received (`POST /tasks/:id/
 *     attachments`, multipart via server/routes/kad/attachments-upload.js);
 *     `storage_path` is the real path multer already wrote the file to
 *     (inside the task's resolved working_dir, see workspace-root.js).
 */
const { db, newId, nowIso, tx } = require("./db");

function listByTask(task_id) {
  return db
    .prepare("SELECT * FROM task_attachments WHERE task_id=? ORDER BY created_at ASC")
    .all(task_id);
}

function countByTask(task_id) {
  return db.prepare("SELECT COUNT(*) n FROM task_attachments WHERE task_id=?").get(task_id).n;
}

/** Registers one row per declared file name against a task (message_id optional). */
function createMany({ task_id, message_id, working_dir, names }) {
  if (!Array.isArray(names) || names.length === 0) return [];
  const insert = db.prepare(
    `INSERT INTO task_attachments (id, task_id, message_id, file_name, mime, size, storage_path, created_at)
     VALUES (@id,@task_id,@message_id,@file_name,NULL,NULL,@storage_path,@now)`
  );
  const now = nowIso();
  const rows = [];
  tx(() => {
    for (const name of names) {
      const id = newId("attach");
      insert.run({
        id,
        task_id,
        message_id: message_id ?? null,
        file_name: name,
        storage_path: `${working_dir || ""}/${name}`,
        now,
      });
      rows.push({ id, task_id, message_id: message_id ?? null, file_name: name });
    }
  });
  return rows;
}

/** Registers rows for files multer already wrote to disk (real bytes). */
function createFromUpload({ task_id, message_id, files }) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const insert = db.prepare(
    `INSERT INTO task_attachments (id, task_id, message_id, file_name, mime, size, storage_path, created_at)
     VALUES (@id,@task_id,@message_id,@file_name,@mime,@size,@storage_path,@now)`
  );
  const now = nowIso();
  const rows = [];
  tx(() => {
    for (const f of files) {
      const id = newId("attach");
      insert.run({
        id,
        task_id,
        message_id: message_id ?? null,
        file_name: f.file_name,
        mime: f.mime ?? null,
        size: f.size ?? null,
        storage_path: f.storage_path,
        now,
      });
      rows.push({ id, task_id, message_id: message_id ?? null, file_name: f.file_name });
    }
  });
  return rows;
}

function getAttachment(id) {
  return db.prepare("SELECT * FROM task_attachments WHERE id=?").get(id) || null;
}

function deleteAttachment(id) {
  db.prepare("DELETE FROM task_attachments WHERE id=?").run(id);
}

module.exports = {
  listByTask,
  countByTask,
  createMany,
  createFromUpload,
  getAttachment,
  deleteAttachment,
};
