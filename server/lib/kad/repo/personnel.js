/**
 * @file server/lib/kad/repo/personnel.js — human-facing write path for
 * "Nhân sự số" (agent_profiles), tab Tổ chức. catalog.js stays read-only per
 * its own header comment; this module owns create/update/archive.
 *
 * Delete is always soft (status='archived') — matches how template_library
 * and department_blueprints never hard-delete, and avoids FK breakage against
 * tasks/artifacts that already reference agent_id.
 */
const { randomUUID } = require("node:crypto");
const { db, audit, newId, nowIso } = require("./db");
const catalog = require("./catalog");

const AGENT_TYPES = new Set(["sub", "helper"]); // 'main' is seeded once by the setup wizard, never created here
const ENGINES = new Set(["claude", "codex", "antigravity"]);
const PERMISSION_KEYS = new Set([
  "create_task",
  "assign_task",
  "create_helper",
  "read_org_context",
  "read_templates",
  "web_search",
  "request_approval",
  "write_audit",
  "publish_connector",
  "modify_blueprint",
  "modify_org_context",
]);

function assertLen(name, value, max, required = false) {
  const s = String(value ?? "").trim();
  if (required && !s) throw new Error(`${name} is required`);
  if (s.length > max) throw new Error(`${name} must be <=${max} chars`);
  return s;
}

function cleanPermissions(input) {
  if (input == null) return undefined;
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error("permissions must be an object");
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!PERMISSION_KEYS.has(k)) throw new Error(`unknown permission key: ${k}`);
    out[k] = Boolean(v);
  }
  return out;
}

function cleanSkills(input) {
  if (input == null) return undefined;
  if (!Array.isArray(input)) throw new Error("skills must be an array");
  if (input.length > 50) throw new Error("skills max 50");
  return input.map((s) => assertLen("skill", s, 100, true));
}

function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function createAgent(input = {}) {
  const department_id = input.department_id;
  if (!department_id) throw new Error("department_id is required");
  const dept = db.prepare("SELECT id FROM departments WHERE id=?").get(department_id);
  if (!dept) throw new Error("department not found");

  const agent_type = input.agent_type || "sub";
  if (!AGENT_TYPES.has(agent_type)) throw new Error("agent_type must be sub|helper");
  const engine = input.engine || "claude";
  if (!ENGINES.has(engine)) throw new Error("invalid engine");
  const display_name = assertLen("display_name", input.display_name, 200, true);
  const role_description = input.role_description
    ? assertLen("role_description", input.role_description, 5000)
    : null;
  const permissions = cleanPermissions(input.permissions) || {};
  const skills = cleanSkills(input.skills) || [];
  const connector_access =
    input.connector_access && typeof input.connector_access === "object"
      ? input.connector_access
      : {};
  const parent_agent_id = input.parent_agent_id || null;
  if (parent_agent_id && !catalog.getAgent(parent_agent_id))
    throw new Error("parent_agent_id not found");

  const base = slugify(display_name) || "agent";
  const name = `${base}-${randomUUID().slice(0, 8)}`; // short unique suffix, avoids getAgentByName collisions
  const id = newId("agent");
  const now = nowIso();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO agent_profiles
       (id, department_id, blueprint_version_id, agent_type, name, display_name, engine, role_description,
        permissions, skills, connector_access, escalation_rules, quality_gates, status, parent_agent_id, created_at, updated_at)
       VALUES (@id,@department_id,NULL,@agent_type,@name,@display_name,@engine,@role_description,
        @permissions,@skills,@connector_access,'{}','{}','active',@parent_agent_id,@now,@now)`
    ).run({
      id,
      department_id,
      agent_type,
      name,
      display_name,
      engine,
      role_description,
      permissions: JSON.stringify(permissions),
      skills: JSON.stringify(skills),
      connector_access: JSON.stringify(connector_access),
      parent_agent_id,
      now,
    });
    audit({
      department_id,
      action: "agent_changed",
      actor_type: "human",
      actor_id: input.actor_id || "human",
      target_type: "agent",
      target_id: id,
      details: { change: "created", agent_type, display_name },
    });
  })();

  return catalog.getAgent(id);
}

function updateAgent(id, patch = {}) {
  const existing = catalog.getAgent(id);
  if (!existing) return null;

  const fields = {};
  const params = { id, now: nowIso() };

  if (patch.display_name !== undefined) {
    fields.display_name = "@display_name";
    params.display_name = assertLen("display_name", patch.display_name, 200, true);
  }
  if (patch.role_description !== undefined) {
    fields.role_description = "@role_description";
    params.role_description = patch.role_description
      ? assertLen("role_description", patch.role_description, 5000)
      : null;
  }
  if (patch.permissions !== undefined) {
    fields.permissions = "@permissions";
    params.permissions = JSON.stringify(cleanPermissions(patch.permissions) || {});
  }
  if (patch.skills !== undefined) {
    fields.skills = "@skills";
    params.skills = JSON.stringify(cleanSkills(patch.skills) || []);
  }
  if (patch.connector_access !== undefined) {
    if (typeof patch.connector_access !== "object" || Array.isArray(patch.connector_access)) {
      throw new Error("connector_access must be an object");
    }
    fields.connector_access = "@connector_access";
    params.connector_access = JSON.stringify(patch.connector_access);
  }
  if (patch.status !== undefined) {
    if (!["active", "inactive"].includes(patch.status)) {
      throw new Error("status must be active|inactive (use the archive route to archive)");
    }
    fields.status = "@status";
    params.status = patch.status;
  }
  if (patch.parent_agent_id !== undefined) {
    if (patch.parent_agent_id) {
      if (patch.parent_agent_id === id) throw new Error("agent cannot be its own parent");
      if (!catalog.getAgent(patch.parent_agent_id)) throw new Error("parent_agent_id not found");
    }
    fields.parent_agent_id = "@parent_agent_id";
    params.parent_agent_id = patch.parent_agent_id || null;
  }

  const setClauses = Object.entries(fields).map(([col, ph]) => `${col}=${ph}`);
  if (!setClauses.length) return existing;
  setClauses.push("updated_at=@now");

  db.transaction(() => {
    db.prepare(`UPDATE agent_profiles SET ${setClauses.join(", ")} WHERE id=@id`).run(params);
    audit({
      department_id: existing.department_id,
      action: "agent_changed",
      actor_type: "human",
      actor_id: patch.actor_id || "human",
      target_type: "agent",
      target_id: id,
      details: { change: "updated", fields: Object.keys(fields) },
    });
  })();

  return catalog.getAgent(id);
}

function archiveAgent(id, { actor_id = "human" } = {}) {
  const existing = catalog.getAgent(id);
  if (!existing) return null;
  if (existing.agent_type === "main") throw new Error("cannot archive the main agent");
  const now = nowIso();
  db.transaction(() => {
    db.prepare("UPDATE agent_profiles SET status='archived', updated_at=@now WHERE id=@id").run({
      id,
      now,
    });
    audit({
      department_id: existing.department_id,
      action: "agent_changed",
      actor_type: "human",
      actor_id,
      target_type: "agent",
      target_id: id,
      details: { change: "archived" },
    });
  })();
  return catalog.getAgent(id);
}

module.exports = { createAgent, updateAgent, archiveAgent, PERMISSION_KEYS };
