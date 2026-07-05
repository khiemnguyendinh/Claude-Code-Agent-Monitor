/**
 * @file server/lib/kad/repo/catalog.js — read-only lookups for the seeded
 * knowledge: departments, agent profiles, org context, blueprint, templates.
 * Used by the orchestrator (system-prompt render), MCP tools, and routes.
 */
const { db, parseJson, nowIso, newId } = require("./db");

// ---- departments ----
function getDepartment(id) {
  const row = db.prepare("SELECT * FROM departments WHERE id=?").get(id);
  return row ? { ...row, settings: parseJson(row.settings, {}) } : null;
}
function getDepartmentBySlug(slug) {
  const row = db.prepare("SELECT * FROM departments WHERE slug=?").get(slug);
  return row ? { ...row, settings: parseJson(row.settings, {}) } : null;
}

// ---- agents ----
function hydrateAgent(row) {
  if (!row) return null;
  return {
    ...row,
    permissions: parseJson(row.permissions, {}),
    skills: parseJson(row.skills, []),
    connector_access: parseJson(row.connector_access, {}),
    escalation_rules: parseJson(row.escalation_rules, {}),
    quality_gates: parseJson(row.quality_gates, {}),
  };
}
function getAgent(id) {
  return hydrateAgent(db.prepare("SELECT * FROM agent_profiles WHERE id=?").get(id));
}
function getAgentByName(departmentId, name) {
  return hydrateAgent(
    db
      .prepare("SELECT * FROM agent_profiles WHERE department_id=? AND name=?")
      .get(departmentId, name)
  );
}
function getMainAgent(departmentId) {
  return hydrateAgent(
    db
      .prepare(
        "SELECT * FROM agent_profiles WHERE department_id=? AND agent_type='main' AND status='active' LIMIT 1"
      )
      .get(departmentId)
  );
}
function listAgents(departmentId, { status } = {}) {
  const rows = status
    ? db
        .prepare(
          "SELECT * FROM agent_profiles WHERE department_id=? AND status=? ORDER BY agent_type, name"
        )
        .all(departmentId, status)
    : db
        .prepare("SELECT * FROM agent_profiles WHERE department_id=? ORDER BY agent_type, name")
        .all(departmentId);
  return rows.map(hydrateAgent);
}

// ---- org context ----
function getCurrentOrgContext(orgId) {
  // Latest approved version. If orgId omitted, pick the only org (MVP single-org).
  const row = orgId
    ? db
        .prepare(
          "SELECT * FROM organization_context_versions WHERE org_id=? AND status='approved' ORDER BY version DESC LIMIT 1"
        )
        .get(orgId)
    : db
        .prepare(
          "SELECT * FROM organization_context_versions WHERE status='approved' ORDER BY version DESC LIMIT 1"
        )
        .get();
  return row ? { ...row, data: parseJson(row.data, {}) } : null;
}

// ---- blueprint ----
function getApprovedBlueprint(departmentId) {
  const row = db
    .prepare(
      "SELECT * FROM department_blueprints WHERE department_id=? AND status='approved' ORDER BY version DESC LIMIT 1"
    )
    .get(departmentId);
  return row ? { ...row, data: parseJson(row.data, {}) } : null;
}

// ---- workflow definitions ----
function getWorkflow(id) {
  const row = db.prepare("SELECT * FROM workflow_definitions WHERE id=?").get(id);
  return row
    ? {
        ...row,
        trigger_keywords: parseJson(row.trigger_keywords, []),
        steps: parseJson(row.steps, []),
      }
    : null;
}

// ---- templates ----
function listTemplates(departmentId, { type, status = "active" } = {}) {
  const where = ["(department_id=? OR department_id IS NULL)"];
  const args = [departmentId];
  if (type) (where.push("template_type=?"), args.push(type));
  if (status) (where.push("status=?"), args.push(status));
  return db
    .prepare(`SELECT * FROM template_library WHERE ${where.join(" AND ")} ORDER BY name`)
    .all(...args);
}
/** Latest approved version content of a template by type. */
function getApprovedTemplateByType(departmentId, type) {
  const tpl = db
    .prepare(
      "SELECT * FROM template_library WHERE (department_id=? OR department_id IS NULL) AND template_type=? AND status='active' LIMIT 1"
    )
    .get(departmentId, type);
  if (!tpl) return null;
  const ver = db
    .prepare(
      "SELECT * FROM template_versions WHERE template_id=? AND status='approved' ORDER BY version DESC LIMIT 1"
    )
    .get(tpl.id);
  if (!ver) return null;
  return { template: tpl, version: ver };
}
/** Record a template usage (spec 04 kad_read_template). */
function logTemplateUsage({ template_id, template_version_id, task_id, artifact_id, agent_id }) {
  db.prepare(
    `INSERT INTO template_usage_log (id, template_id, template_version_id, task_id, artifact_id, agent_id, used_at)
     VALUES (@id,@template_id,@template_version_id,@task_id,@artifact_id,@agent_id,@used_at)`
  ).run({
    id: newId("tplusage"),
    template_id: template_id ?? null,
    template_version_id: template_version_id ?? null,
    task_id: task_id ?? null,
    artifact_id: artifact_id ?? null,
    agent_id: agent_id ?? null,
    used_at: nowIso(),
  });
}

module.exports = {
  getDepartment,
  getDepartmentBySlug,
  getAgent,
  getAgentByName,
  getMainAgent,
  listAgents,
  getCurrentOrgContext,
  getWorkflow,
  getApprovedBlueprint,
  listTemplates,
  getApprovedTemplateByType,
  logTemplateUsage,
};
