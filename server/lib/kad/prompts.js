/**
 * @file server/lib/kad/prompts.js — server-side prompt rendering (spec 04 §5).
 * Prompt pack = markdown files in ./prompts (exportable/versionable, [ĐỀ XUẤT] #7).
 * render() does {var} substitution; buildSystemPrompt/buildDelegationPrompt
 * assemble the Phase-1 prompts from seeded org context / blueprint / templates.
 */
const fs = require("node:fs");
const path = require("node:path");
const repo = require("./repo");

const DIR = path.join(__dirname, "prompts");
const cache = new Map();

function load(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(DIR, `${name}.md`), "utf8"));
  return cache.get(name);
}

/** Substitute {key} tokens. Missing keys render as empty string. */
function render(name, vars = {}) {
  return load(name).replace(/\{([a-z_]+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}

function summarizeOrgContext(orgData) {
  if (!orgData) return "(chưa có org context)";
  const b = orgData.brand || {};
  return [
    `Tầm nhìn: ${orgData.vision || ""}`,
    `Sứ mệnh: ${orgData.mission || ""}`,
    `Giá trị cốt lõi: ${(orgData.core_values || []).join(", ")}`,
    `Brand voice: ${b.voice || ""}`,
    `Guideline: ${b.guideline || ""}`,
    `Vai trò phòng: ${orgData.department_role || ""}`,
    `Chuẩn sư phạm: ${orgData.pedagogy_standards || ""}`,
    `Người chịu trách nhiệm: ${orgData.responsible_human || ""}`,
  ].join("\n");
}

function summarizeBlueprint(bp) {
  if (!bp || !bp.data) return "(chưa có blueprint)";
  const agents = (bp.data.agents || []).map((a) => `- ${a.display_name} (${a.name}) [${a.status}]`).join("\n");
  return `Đội ngũ:\n${agents}\nGate chất lượng: ${JSON.stringify(bp.data.gates || {})}`;
}

function summarizeTemplates(departmentId) {
  const tpls = repo.catalog.listTemplates(departmentId);
  if (!tpls.length) return "(chưa có template)";
  return tpls.map((t) => `- ${t.name} (type=${t.template_type})`).join("\n");
}

function summarizeLearning(departmentId) {
  const notes = repo.catalog ? repo.learning.listRecent({ department_id: departmentId, limit: 10 }) : [];
  if (!notes.length) return "(chưa có)";
  return notes.map((n) => `- [${n.correction_category || "?"}/${n.severity}] ${n.feedback_content || n.root_cause || ""}`).join("\n");
}

/** Build the Main Agent (operator) system prompt for a department. */
function buildSystemPrompt(departmentId) {
  const dept = repo.catalog.getDepartment(departmentId);
  const org = repo.catalog.getCurrentOrgContext(dept && dept.org_id);
  const bp = repo.catalog.getApprovedBlueprint(departmentId);
  return render("system-operator", {
    organization_context: summarizeOrgContext(org && org.data),
    department_blueprint: summarizeBlueprint(bp),
    available_templates: summarizeTemplates(departmentId),
    recent_learning_notes: summarizeLearning(departmentId),
  });
}

/** Build the first-turn planning user message for a new goal. */
function buildPlanningMessage({ userGoal, additionalContext, defaultWorkflow }) {
  return render("task-planning", {
    user_goal: userGoal,
    additional_context: additionalContext || "(không có)",
    default_workflow: defaultWorkflow || "rd-standard-flow",
  });
}

/** Build a delegation system+user prompt for a sub-agent run. */
function buildDelegationPrompt({ subAgent, taskDescription, taskInputs, templateContent, orgContextSummary, parentSummary, outputFormat, requiredSections, constraints, artifactType, parentId }) {
  return render("delegation", {
    sub_agent_display_name: subAgent.display_name,
    task_description: taskDescription,
    task_inputs: taskInputs || "(không có)",
    template_content: templateContent || "(không có template)",
    relevant_org_context: orgContextSummary || "(không có)",
    parent_artifact_summary: parentSummary || "(không có)",
    output_format: outputFormat || "markdown",
    required_sections: requiredSections || "theo template",
    constraints: constraints || "bịa số liệu, phóng đại",
    artifact_type: artifactType || "research_report",
    parent_id: parentId || "null",
  });
}

module.exports = { render, buildSystemPrompt, buildPlanningMessage, buildDelegationPrompt, summarizeOrgContext };
