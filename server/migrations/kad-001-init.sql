-- KAD v2 — Migration 001: initial schema (27 tables + indexes).
-- Source of truth: plans/260703-2330-kad-v2-build/spec/02-data-model.md (incl §6b, 2026-07-04).
-- Rules: NEVER touch monitor tables (sessions/agents/events/token_usage/workflows).
--        Run in one transaction (handled by migrate.js). IDs = UUID TEXT, timestamps = ISO8601 TEXT.
--        JSON columns are accepted MVP tech debt (query via json_extract); repo layer wraps access.
-- Phase 1 WIRES: job_queue + guardrails. task_dependencies/automation_* are CREATED here but
--        wired in Phase 3 / 6.5 (tables-only now, per phase-01 task 3).

-- ====================================================================
-- 1. Organization & knowledge
-- ====================================================================
CREATE TABLE IF NOT EXISTS organization_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_path TEXT,
  industry TEXT,
  size TEXT CHECK(size IN ('1-10','11-50','51-200','201-500','500+')),
  founded_year INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_context_versions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization_profiles(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','approved','archived')),
  data JSON NOT NULL,
  change_summary TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, version)
);

CREATE TABLE IF NOT EXISTS org_chart_nodes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization_profiles(id),
  parent_id TEXT REFERENCES org_chart_nodes(id),
  name TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN ('company','department','position')),
  lead_name TEXT,
  mission TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ====================================================================
-- 2. Departments, blueprints, agents
-- ====================================================================
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  org_id TEXT NOT NULL REFERENCES organization_profiles(id),
  name TEXT NOT NULL,
  template_type TEXT CHECK(template_type IN ('rd','training','sales','marketing','finance_admin')),
  mission TEXT,
  settings JSON,                     -- budget BẮT BUỘC: {daily_token_limit, per_task_token_limit, monthly_cost_limit_usd, max_concurrent_runs, max_delegations_per_task}, notification config
  federation_id TEXT,
  federation_config JSON,
  status TEXT NOT NULL CHECK(status IN ('setup','active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS department_blueprints (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','pending_approval','approved','archived')),
  data JSON NOT NULL,
  proposed_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(department_id, version)
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  blueprint_version_id TEXT REFERENCES department_blueprints(id),
  agent_type TEXT NOT NULL CHECK(agent_type IN ('main','sub','helper')),
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  engine TEXT NOT NULL CHECK(engine IN ('claude','codex','antigravity')),
  role_description TEXT,
  permissions JSON,
  skills JSON,
  connector_access JSON,
  escalation_rules JSON,
  quality_gates JSON,
  status TEXT NOT NULL CHECK(status IN ('active','inactive','archived')),
  parent_agent_id TEXT REFERENCES agent_profiles(id),
  scope TEXT,
  expires_at TEXT,
  created_by_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ====================================================================
-- 3. Workflow, task, chat, run, delegation
-- ====================================================================
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  department_id TEXT REFERENCES departments(id),
  name TEXT NOT NULL,
  description TEXT,
  example_prompt TEXT,
  trigger_keywords JSON,
  steps JSON NOT NULL,
  version INTEGER,
  status TEXT CHECK(status IN ('draft','active','disabled','archived')),
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  department_id TEXT REFERENCES departments(id),
  workflow_id TEXT REFERENCES workflow_definitions(id),
  workflow_step TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT CHECK(status IN ('blocked','inbox','triaged','doing','waiting_human','review','needs_changes','done','failed','archived')),
  assigned_agent_id TEXT REFERENCES agent_profiles(id),
  parent_task_id TEXT,
  org_context_version_id TEXT REFERENCES organization_context_versions(id),
  blueprint_version_id TEXT REFERENCES department_blueprints(id),
  working_dir TEXT,
  brief JSON,
  activation TEXT DEFAULT 'manual' CHECK(activation IN ('manual','dependency','schedule','rule')),
  origin_rule_id TEXT REFERENCES automation_rules(id),
  automation_depth INTEGER NOT NULL DEFAULT 0,
  priority TEXT CHECK(priority IN ('urgent','high','normal','low')),
  due_date TEXT,
  created_at TEXT,
  updated_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  sender_type TEXT CHECK(sender_type IN ('human','agent')),
  sender_id TEXT,
  channel TEXT DEFAULT 'web' CHECK(channel IN ('web','lark','telegram')),
  channel_actor_ref TEXT,
  content TEXT NOT NULL,
  message_type TEXT CHECK(message_type IN ('chat','status','approval_request','approval_response','escalation','artifact_delivery','system','intake_question','brief','report')),
  metadata JSON,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  message_id TEXT REFERENCES task_messages(id),
  file_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  storage_path TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  agent_id TEXT REFERENCES agent_profiles(id),
  engine TEXT,
  engine_session_id TEXT,            -- link monitor sessions.id
  status TEXT CHECK(status IN ('pending','running','waiting_approval','completed','failed','cancelled')),
  input JSON,
  output JSON,
  tokens_used JSON,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_delegations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  from_agent_id TEXT NOT NULL REFERENCES agent_profiles(id),
  to_agent_id TEXT NOT NULL REFERENCES agent_profiles(id),
  instruction TEXT NOT NULL,
  input_artifact_ids JSON,
  run_id TEXT REFERENCES task_runs(id),
  output_artifact_id TEXT,
  status TEXT CHECK(status IN ('pending','running','review','done','failed','cancelled')),
  retry_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

-- ====================================================================
-- 4. Artifact, approval
-- ====================================================================
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  agent_id TEXT REFERENCES agent_profiles(id),
  artifact_type TEXT CHECK(artifact_type IN ('program_framework','research_report','syllabus','lesson_plan','slide_outline','video_script','quality_report','connector_draft','other')),
  title TEXT NOT NULL,
  content TEXT,
  file_path TEXT,
  parent_artifact_id TEXT,
  template_version_id TEXT REFERENCES template_versions(id),
  org_context_version_id TEXT,
  status TEXT CHECK(status IN ('draft','review','approved','published','archived')),
  version INTEGER DEFAULT 1,
  metadata JSON,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  requested_by TEXT REFERENCES agent_profiles(id),
  approval_type TEXT NOT NULL CHECK(approval_type IN ('plan','strategy','artifact','publish_facebook','publish_wordpress','blueprint_change','template_change','org_context_change','workflow_change','sensitive_content','helper_create','internal_auto')),
  sensitivity_subtype TEXT CHECK(sensitivity_subtype IN ('metrics','people','brand')),
  title TEXT NOT NULL,
  description TEXT,
  artifact_id TEXT REFERENCES artifacts(id),
  context_snapshot JSON,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','needs_changes','rejected')),
  reviewer TEXT DEFAULT 'human',
  decision_reason TEXT,
  decided_at TEXT,
  decided_channel TEXT CHECK(decided_channel IN ('web','lark','telegram')),
  decided_actor_ref TEXT,
  cooldown_until TEXT,
  sla_reminder_hours INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ====================================================================
-- 5. Learning, template, connector, audit, notification, federation
-- ====================================================================
CREATE TABLE IF NOT EXISTS learning_notes (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  task_id TEXT REFERENCES tasks(id),
  artifact_id TEXT REFERENCES artifacts(id),
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('human_revision','human_rejection','quality_flag','pattern_detection')),
  feedback_content TEXT,
  correction_category TEXT CHECK(correction_category IN ('missing_context','weak_instruction','wrong_flow','bad_role_split','brand_mismatch','pedagogical_error','factual_error','format_error')),
  severity TEXT NOT NULL DEFAULT 'major' CHECK(severity IN ('critical','major','minor')),
  root_cause TEXT,
  prevention TEXT,
  affected_areas JSON NOT NULL DEFAULT '[]',
  affected_agent_id TEXT REFERENCES agent_profiles(id),
  proposed_change TEXT,
  proposed_change_target TEXT CHECK(proposed_change_target IN ('blueprint','template','skill')),
  change_status TEXT DEFAULT 'noted' CHECK(change_status IN ('noted','proposed','approved','applied','archived')),
  approved_by TEXT,
  applied_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_library (
  id TEXT PRIMARY KEY,
  department_id TEXT,
  name TEXT NOT NULL,
  template_type TEXT CHECK(template_type IN ('program_framework','syllabus','lesson_plan','slide_outline','video_script','quality_rubric','facebook_post','wordpress_post','business_analysis','custom')),
  purpose TEXT,
  required_inputs JSON,
  output_structure JSON,
  owner TEXT,
  status TEXT CHECK(status IN ('active','archived')),
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES template_library(id),
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  examples JSON,
  change_summary TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','approved','archived')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(template_id, version)
);

CREATE TABLE IF NOT EXISTS template_usage_log (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES template_library(id),
  template_version_id TEXT REFERENCES template_versions(id),
  task_id TEXT REFERENCES tasks(id),
  artifact_id TEXT REFERENCES artifacts(id),
  agent_id TEXT REFERENCES agent_profiles(id),
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  department_id TEXT REFERENCES departments(id),
  connector_type TEXT CHECK(connector_type IN ('facebook_page','wordpress')),
  name TEXT NOT NULL,
  config JSON,
  auth_status TEXT CHECK(auth_status IN ('not_configured','configured','connected','error')),
  capabilities JSON,
  risk_level TEXT CHECK(risk_level IN ('low','medium','high')),
  last_health_check TEXT,
  status TEXT CHECK(status IN ('active','disabled')),
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS connector_actions (
  id TEXT PRIMARY KEY,
  connector_id TEXT REFERENCES connectors(id),
  task_id TEXT REFERENCES tasks(id),
  approval_id TEXT REFERENCES approvals(id),
  action_type TEXT CHECK(action_type IN ('draft','preview','publish','schedule','update','delete')),
  content JSON,
  result JSON,
  status TEXT CHECK(status IN ('pending','approved','executing','completed','failed')),
  external_id TEXT,
  external_url TEXT,
  executed_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  department_id TEXT REFERENCES departments(id),
  task_id TEXT,
  agent_id TEXT,
  action TEXT NOT NULL,
  actor_type TEXT CHECK(actor_type IN ('human','agent','system')),
  actor_id TEXT,
  channel TEXT CHECK(channel IN ('web','lark','telegram')),
  target_type TEXT,
  target_id TEXT,
  details JSON,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  department_id TEXT REFERENCES departments(id),
  kind TEXT CHECK(kind IN ('approval_pending','approval_sla','approval_stale','task_blocked','budget_warning','run_failed','daily_briefing')),
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  target_id TEXT,
  delivered_channels JSON,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS federation_assignments (
  id TEXT PRIMARY KEY,
  from_federation_id TEXT,
  to_federation_id TEXT,
  title TEXT,
  description TEXT,
  priority TEXT CHECK(priority IN ('urgent','high','normal','low')),
  due_date TEXT,
  status TEXT CHECK(status IN ('pending','accepted','rejected','completed')),
  rejection_reason TEXT,
  created_at TEXT,
  responded_at TEXT
);

-- ====================================================================
-- 6b. Job queue, dependencies & automation (2026-07-04, approved)
-- ====================================================================
CREATE TABLE IF NOT EXISTS kad_job_queue (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK(kind IN ('resume_task','start_delegation','evaluate_rules','run_schedule','sla_check','pattern_detect','helper_sweep','reconcile_runs','daily_briefing')),
  payload_json TEXT NOT NULL,
  run_after    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','done','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  lease_until  TEXT,
  dedup_key    TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id                       TEXT PRIMARY KEY,
  task_id                  TEXT NOT NULL REFERENCES tasks(id),
  depends_on_task_id       TEXT REFERENCES tasks(id),
  depends_on_artifact_type TEXT,
  release_condition        TEXT NOT NULL CHECK(release_condition IN ('dep_task_done','dep_artifact_approved','all_deps_done')),
  status                   TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','released','cancelled')),
  released_at              TEXT,
  created_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id             TEXT PRIMARY KEY,
  department_id  TEXT NOT NULL REFERENCES departments(id),
  name           TEXT NOT NULL,
  trigger_type   TEXT NOT NULL CHECK(trigger_type IN ('schedule','event','metric_threshold')),
  trigger_config JSON NOT NULL,
  action_type    TEXT NOT NULL CHECK(action_type IN ('create_task','notify','run_briefing','pause_department')),
  action_config  JSON NOT NULL,
  approval_required INTEGER NOT NULL DEFAULT 1,
  autonomous_budget_cap INTEGER,
  enabled        INTEGER NOT NULL DEFAULT 1,
  cooldown_seconds INTEGER,
  max_fires      INTEGER,
  fire_count     INTEGER NOT NULL DEFAULT 0,
  last_fired_at  TEXT,
  created_by     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_rule_fires (
  id             TEXT PRIMARY KEY,
  rule_id        TEXT NOT NULL REFERENCES automation_rules(id),
  fired_at       TEXT NOT NULL,
  trigger_ref    TEXT,
  action_task_id TEXT REFERENCES tasks(id),
  result         TEXT NOT NULL CHECK(result IN ('created','skipped_budget','skipped_cooldown','skipped_maxfires','blocked_loop','notified')),
  note           TEXT
);

-- ====================================================================
-- 7. Indexes
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_tasks_dept_status ON tasks(department_id, status);
CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_delegations_task ON task_delegations(task_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_learning_dept_cat ON learning_notes(department_id, correction_category, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_dept_time ON audit_log(department_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_dept ON agent_profiles(department_id, agent_type, status);
CREATE INDEX IF NOT EXISTS idx_jobq_due ON kad_job_queue(status, run_after);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobq_dedup ON kad_job_queue(dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taskdeps_task ON task_dependencies(task_id, status);
CREATE INDEX IF NOT EXISTS idx_taskdeps_on ON task_dependencies(depends_on_task_id, status);
CREATE INDEX IF NOT EXISTS idx_autorules_dept ON automation_rules(department_id, enabled, trigger_type);
CREATE INDEX IF NOT EXISTS idx_rulefires_rule ON automation_rule_fires(rule_id, fired_at);
