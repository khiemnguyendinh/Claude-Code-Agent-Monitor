-- kad-004: widen notifications.kind to allow 'automation' (Phase 6.5).
-- The automation_rules `notify` action + rule fire alerts need a notification
-- kind of their own; the others in the enum are all approval/run/budget events.
-- SQLite can't ALTER a CHECK constraint, so rebuild the table in place. FKs are
-- documentation-only in this schema (migrate.js never enables PRAGMA
-- foreign_keys) and notifications has no dependent index, so the rebuild is a
-- straight copy. Runs in one transaction (see migrate.js).

CREATE TABLE notifications_kad004 (
  id TEXT PRIMARY KEY,
  department_id TEXT REFERENCES departments(id),
  kind TEXT CHECK(kind IN ('approval_pending','approval_sla','approval_stale','task_blocked','budget_warning','run_failed','daily_briefing','automation')),
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  target_id TEXT,
  delivered_channels JSON,
  read_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO notifications_kad004
  (id, department_id, kind, title, body, link_path, target_id, delivered_channels, read_at, created_at)
SELECT
  id, department_id, kind, title, body, link_path, target_id, delivered_channels, read_at, created_at
FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_kad004 RENAME TO notifications;
