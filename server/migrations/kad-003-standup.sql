-- KAD v2 — Phase 2 "Tổng quan" track. Deterministic standup snapshot (rút gọn:
-- computed from real rows, no LLM narrative — see server/lib/kad/repo/standup.js).
-- One row per department; regenerate overwrites (spec/ui/02 §5, types.ts StandupBrief).
-- Numbered 003 — 002 was already taken by kad-002-job-queue-requeue.sql.
CREATE TABLE IF NOT EXISTS department_standups (
  department_id TEXT PRIMARY KEY REFERENCES departments(id),
  generated_at  TEXT NOT NULL,
  payload       JSON NOT NULL,
  updated_at    TEXT NOT NULL
);
