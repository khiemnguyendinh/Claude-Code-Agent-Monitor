-- KAD Phase — Đội ngũ ▸ Mục tiêu (OKR). Objectives + key results are MANUAL
-- (created via the API, no seeding here — start empty like strategic_goals).
-- KPIs (Đội ngũ ▸ Mục tiêu's other panel) are NOT persisted here — they are
-- computed live from existing real tables (task_runs/approvals/artifacts) by
-- repo/reports.js; only the OKR tree itself needs its own tables.
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  department_id TEXT REFERENCES departments(id),
  level TEXT NOT NULL CHECK(level IN ('company','department')),
  cycle TEXT NOT NULL CHECK(cycle IN ('year','quarter')),
  period TEXT NOT NULL,
  title TEXT NOT NULL,
  owner_id TEXT,
  parent_objective_id TEXT REFERENCES objectives(id),
  confidence TEXT NOT NULL DEFAULT 'on_track' CHECK(confidence IN ('on_track','at_risk','off_track')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS key_results (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id),
  title TEXT NOT NULL,
  metric TEXT,
  current_value REAL NOT NULL DEFAULT 0,
  target_value REAL NOT NULL DEFAULT 0,
  unit TEXT,
  direction TEXT NOT NULL DEFAULT 'up' CHECK(direction IN ('up','down')),
  owner_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_objectives_dept_level ON objectives(department_id, level);
CREATE INDEX IF NOT EXISTS idx_keyresults_objective ON key_results(objective_id);
