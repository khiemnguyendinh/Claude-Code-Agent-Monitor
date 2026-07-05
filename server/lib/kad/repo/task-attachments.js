/**
 * @file server/lib/kad/repo/task-attachments.js — task_attachments (spec 02,
 * [GAP] spec/ui/07 §1). The Giao việc composer's paperclip button has no real
 * file picker yet (cycles a fixed demo name list, spec/ui/07 §1 comment) — so
 * `storage_path` here is a placeholder under the task's working_dir, not a
 * real copied file. The row itself (which names were declared attached, tied
 * to a real task_id) is real; only the underlying bytes are still a stand-in.
 */
const { db, newId, nowIso } = require("./db");

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
  return rows;
}

module.exports = { listByTask, countByTask, createMany };
