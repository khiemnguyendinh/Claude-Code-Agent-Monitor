-- KAD Phase — Đội ngũ admin. Persists "Mục tiêu & chiến lược" (previously
-- pure React state in client/src/kad/store.tsx, lost on every page refresh).
-- Single-org MVP (see repo/catalog.js getCurrentOrgContext comment), so the
-- strategy blob lives directly on organization_profiles (one row today).
ALTER TABLE organization_profiles ADD COLUMN strategy_markdown TEXT;
ALTER TABLE organization_profiles ADD COLUMN strategy_updated_at TEXT;

CREATE TABLE IF NOT EXISTS strategic_goals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization_profiles(id),
  title TEXT NOT NULL,
  metric TEXT,
  current_value REAL,
  target_value REAL,
  due_date TEXT,
  status TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
