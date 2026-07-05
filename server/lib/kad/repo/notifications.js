/**
 * @file server/lib/kad/repo/notifications.js — notification center + WS emit.
 * BẮT BUỘC in Phase 1 (cost guardrails + trigger use it — no longer [ĐỀ XUẤT]).
 */
const { db, parseJson, newId, nowIso } = require("./db");
const { emitDept } = require("../events");

function hydrate(row) {
  return row ? { ...row, delivered_channels: parseJson(row.delivered_channels, []) } : null;
}

function publicUrl(linkPath) {
  const base =
    process.env.KAD_PUBLIC_BASE_URL ||
    process.env.DASHBOARD_PUBLIC_URL ||
    process.env.APP_BASE_URL ||
    "";
  if (!base) return linkPath || "";
  try {
    return new URL(linkPath || "/", base).toString();
  } catch {
    return linkPath || "";
  }
}

function webhookTypes() {
  try {
    const { loadEnabledTargets } = require("../../webhooks");
    return loadEnabledTargets()
      .filter((t) => !Array.isArray(t.rule_ids) || t.rule_ids.length === 0)
      .map((t) => t.type);
  } catch {
    return [];
  }
}

function dispatchWebhookNotification(notif) {
  try {
    const { dispatchAlert } = require("../../webhooks");
    const url = publicUrl(notif.link_path);
    const message = [notif.body, url].filter(Boolean).join("\n");
    Promise.resolve(
      dispatchAlert({
        id: null,
        rule_id: null,
        rule_name: notif.title,
        rule_type: `kad.${notif.kind}`,
        session_id: null,
        agent_id: null,
        message,
        details: {
          source: "kad",
          notification_id: notif.id,
          kind: notif.kind,
          target_id: notif.target_id,
          link_path: notif.link_path,
        },
        triggered_at: notif.created_at,
      })
    ).catch(() => {});
  } catch (e) {
    console.warn("[kad-notifications] webhook dispatch failed:", e && e.message);
  }
}

/** Create a notification and push it over WS + enabled outbound webhooks. */
function createNotification({ department_id, kind, title, body, link_path, target_id, delivered_channels }) {
  const id = newId("notif");
  const external = webhookTypes();
  const channels = delivered_channels || Array.from(new Set(["ui", ...external]));
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
  if (external.length) dispatchWebhookNotification(notif);
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
