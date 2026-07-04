/**
 * @file server/lib/kad/repo/notifications.js — notification center + WS emit.
 * BẮT BUỘC in Phase 1 (cost guardrails + trigger use it — no longer [ĐỀ XUẤT]).
 */
const { db, parseJson, newId, nowIso } = require("./db");
const { emitDept } = require("../events");

function hydrate(row) {
  return row ? { ...row, delivered_channels: parseJson(row.delivered_channels, []) } : null;
}

/** Create a notification and push it over the department-scoped WS channel. */
function createNotification({ department_id, kind, title, body, link_path, target_id, delivered_channels }) {
  const id = newId("notif");
  const channels = delivered_channels || ["ui"];
  db.prepare(
    `INSERT INTO notifications (id, department_id, kind, title, body, link_path, target_id, delivered_channels, created_at)
     VALUES (@id,@dept,@kind,@title,@body,@link,@target,@channels,@now)`
  ).run({
    id,
    dept: department_id ?? null,
    kind,
    title,
    body: body ?? null,
    link: link_path ?? null,
    target: target_id ?? null,
    channels: JSON.stringify(channels),
    now: nowIso(),
  });
  const notif = getNotification(id);
  emitDept(department_id, "kad.notification", notif);
  return notif;
}

function getNotification(id) {
  return hydrate(db.prepare("SELECT * FROM notifications WHERE id=?").get(id));
}

function listNotifications({ department_id, unread } = {}) {
  const where = [];
  const args = [];
  if (department_id) (where.push("department_id=?"), args.push(department_id));
  if (unread) where.push("read_at IS NULL");
  const sql = "SELECT * FROM notifications" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY created_at DESC LIMIT 200";
  return db.prepare(sql).all(...args).map(hydrate);
}

function markRead(id) {
  db.prepare("UPDATE notifications SET read_at=? WHERE id=?").run(nowIso(), id);
  return getNotification(id);
}

module.exports = { createNotification, getNotification, listNotifications, markRead };
