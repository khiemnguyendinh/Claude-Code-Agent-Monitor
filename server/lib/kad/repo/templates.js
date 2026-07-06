/**
 * @file server/lib/kad/repo/templates.js — versioned template library writes
 * and usage reads for Phase 4. Routes stay SQL-free; agents still read approved
 * content through catalog.getApprovedTemplateByType().
 */
const { db, parseJson, audit, newId, nowIso } = require("./db");
const {
  TEMPLATE_TYPES,
  MAX_TEMPLATE_BYTES,
  BINARY_FORMATS,
  validateTemplateInput,
} = require("./template-validation");

function hydrateTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    required_inputs: parseJson(row.required_inputs, []),
    output_structure: parseJson(row.output_structure, {}),
    latest_version: row.latest_version_id
      ? {
          id: row.latest_version_id,
          template_id: row.id,
          version: row.latest_version,
          content: row.latest_content,
          file_path: row.latest_file_path,
          mime_type: row.latest_mime_type,
          original_file_name: row.latest_original_file_name,
          change_summary: row.latest_change_summary,
          status: row.latest_status,
          approved_by: row.latest_approved_by,
          approved_at: row.latest_approved_at,
          created_at: row.latest_created_at,
        }
      : null,
    approved_version: row.approved_version_id
      ? {
          id: row.approved_version_id,
          template_id: row.id,
          version: row.approved_version,
          content: row.approved_content,
          file_path: row.approved_file_path,
          mime_type: row.approved_mime_type,
          original_file_name: row.approved_original_file_name,
          change_summary: row.approved_change_summary,
          status: "approved",
          approved_by: row.approved_approved_by,
          approved_at: row.approved_approved_at,
          created_at: row.approved_created_at,
        }
      : null,
    usage_count: row.usage_count || 0,
  };
}

function listTemplates({ department_id, type, status = "active", version_status } = {}) {
  const where = ["(tl.department_id=@department_id OR tl.department_id IS NULL)"];
  const params = { department_id: department_id ?? null };
  if (type) {
    where.push("tl.template_type=@type");
    params.type = type;
  }
  if (status) {
    where.push("tl.status=@status");
    params.status = status;
  }
  const rows = db
    .prepare(
      `SELECT tl.*,
              lv.id latest_version_id, lv.version latest_version, lv.content latest_content,
              lv.file_path latest_file_path, lv.mime_type latest_mime_type,
              lv.original_file_name latest_original_file_name,
              lv.change_summary latest_change_summary, lv.status latest_status,
              lv.approved_by latest_approved_by, lv.approved_at latest_approved_at,
              lv.created_at latest_created_at,
              av.id approved_version_id, av.version approved_version, av.content approved_content,
              av.file_path approved_file_path, av.mime_type approved_mime_type,
              av.original_file_name approved_original_file_name,
              av.change_summary approved_change_summary, av.approved_by approved_approved_by,
              av.approved_at approved_approved_at, av.created_at approved_created_at,
              (SELECT COUNT(*) FROM template_usage_log u WHERE u.template_id=tl.id) usage_count
       FROM template_library tl
       LEFT JOIN template_versions lv ON lv.id = (
         SELECT id FROM template_versions WHERE template_id=tl.id ORDER BY version DESC LIMIT 1
       )
       LEFT JOIN template_versions av ON av.id = (
         SELECT id FROM template_versions WHERE template_id=tl.id AND status='approved' ORDER BY version DESC LIMIT 1
       )
       WHERE ${where.join(" AND ")}
       ORDER BY tl.updated_at DESC, tl.name ASC`
    )
    .all(params)
    .map(hydrateTemplate);
  return version_status ? rows.filter((r) => r.latest_version?.status === version_status) : rows;
}

function getTemplate(id) {
  return hydrateTemplate(
    db
      .prepare(
        `SELECT tl.*,
                lv.id latest_version_id, lv.version latest_version, lv.content latest_content,
                lv.file_path latest_file_path, lv.mime_type latest_mime_type,
                lv.original_file_name latest_original_file_name,
                lv.change_summary latest_change_summary, lv.status latest_status,
                lv.approved_by latest_approved_by, lv.approved_at latest_approved_at,
                lv.created_at latest_created_at,
                av.id approved_version_id, av.version approved_version, av.content approved_content,
                av.file_path approved_file_path, av.mime_type approved_mime_type,
                av.original_file_name approved_original_file_name,
                av.change_summary approved_change_summary, av.approved_by approved_approved_by,
                av.approved_at approved_approved_at, av.created_at approved_created_at,
                (SELECT COUNT(*) FROM template_usage_log u WHERE u.template_id=tl.id) usage_count
         FROM template_library tl
         LEFT JOIN template_versions lv ON lv.id = (
           SELECT id FROM template_versions WHERE template_id=tl.id ORDER BY version DESC LIMIT 1
         )
         LEFT JOIN template_versions av ON av.id = (
           SELECT id FROM template_versions WHERE template_id=tl.id AND status='approved' ORDER BY version DESC LIMIT 1
         )
         WHERE tl.id=@id`
      )
      .get({ id })
  );
}

function getVersion(id) {
  const row = db.prepare("SELECT * FROM template_versions WHERE id=?").get(id);
  return row
    ? {
        ...row,
        examples: parseJson(row.examples, []),
      }
    : null;
}

function createDraft(input) {
  const clean = validateTemplateInput(input);
  const now = nowIso();
  let templateId = input.template_id || null;
  let version;

  db.transaction(() => {
    if (!templateId) {
      templateId = newId("tpl");
      db.prepare(
        `INSERT INTO template_library
         (id, department_id, name, template_type, purpose, required_inputs, output_structure, owner, status, created_at, updated_at)
         VALUES (@id,@department_id,@name,@type,@purpose,'[]','{}',@owner,'active',@now,@now)`
      ).run({
        id: templateId,
        department_id: input.department_id ?? null,
        name: clean.name,
        type: clean.type,
        purpose: clean.purpose,
        owner: input.owner || "human",
        now,
      });
    } else {
      const existing = getTemplate(templateId);
      if (!existing) throw new Error("template not found");
      db.prepare(
        "UPDATE template_library SET name=@name, purpose=@purpose, updated_at=@now WHERE id=@id"
      ).run({
        id: templateId,
        name: clean.name || existing.name,
        purpose: clean.purpose ?? existing.purpose,
        now,
      });
    }
    const max = db
      .prepare("SELECT COALESCE(MAX(version),0) n FROM template_versions WHERE template_id=?")
      .get(templateId).n;
    version = {
      id: newId("tplver"),
      template_id: templateId,
      version: max + 1,
      content: clean.content,
      file_path: clean.file_path,
      mime_type: clean.mime_type,
      original_file_name: clean.original_file_name,
      change_summary: clean.change_summary,
      status: "draft",
      created_at: now,
    };
    db.prepare(
      `INSERT INTO template_versions
       (id, template_id, version, content, examples, change_summary, status, approved_by, approved_at, created_at,
        file_path, mime_type, original_file_name)
       VALUES (@id,@template_id,@version,@content,'[]',@change_summary,'draft',NULL,NULL,@created_at,
        @file_path,@mime_type,@original_file_name)`
    ).run(version);
    audit({
      department_id: input.department_id,
      action: "template_changed",
      actor_type: input.actor_type || "human",
      actor_id: input.actor_id || "human",
      target_type: "template",
      target_id: templateId,
      details: { version_id: version.id, status: "draft" },
    });
  })();

  return { template: getTemplate(templateId), version: getVersion(version.id) };
}

function approve(id, { actor_id = "human", actor_type = "human" } = {}) {
  const version =
    getVersion(id) ||
    db
      .prepare(
        "SELECT * FROM template_versions WHERE template_id=? AND status='draft' ORDER BY version DESC LIMIT 1"
      )
      .get(id);
  if (!version) return null;
  const template = getTemplate(version.template_id);
  if (!template) return null;
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      "UPDATE template_versions SET status='archived' WHERE template_id=? AND status='approved'"
    ).run(version.template_id);
    db.prepare(
      "UPDATE template_versions SET status='approved', approved_by=@actor, approved_at=@now WHERE id=@id"
    ).run({ id: version.id, actor: actor_id, now });
    db.prepare("UPDATE template_library SET status='active', updated_at=@now WHERE id=@id").run({
      id: version.template_id,
      now,
    });
    audit({
      department_id: template.department_id,
      action: "template_changed",
      actor_type,
      actor_id,
      target_type: "template",
      target_id: version.template_id,
      details: { version_id: version.id, status: "approved" },
    });
  })();
  return { template: getTemplate(version.template_id), version: getVersion(version.id) };
}

function archiveTemplate(id, { actor_id = "human", actor_type = "human" } = {}) {
  const template = getTemplate(id);
  if (!template) return null;
  const now = nowIso();
  db.prepare("UPDATE template_library SET status='archived', updated_at=@now WHERE id=@id").run({
    id,
    now,
  });
  audit({
    department_id: template.department_id,
    action: "template_changed",
    actor_type,
    actor_id,
    target_type: "template",
    target_id: id,
    details: { status: "archived" },
  });
  return getTemplate(id);
}

function usage(template_id) {
  return db
    .prepare(
      `SELECT u.*, t.title task_title, a.title artifact_title, ap.display_name agent_display_name
       FROM template_usage_log u
       LEFT JOIN tasks t ON t.id=u.task_id
       LEFT JOIN artifacts a ON a.id=u.artifact_id
       LEFT JOIN agent_profiles ap ON ap.id=u.agent_id
       WHERE u.template_id=?
       ORDER BY u.used_at DESC`
    )
    .all(template_id);
}

module.exports = {
  TEMPLATE_TYPES,
  MAX_TEMPLATE_BYTES,
  BINARY_FORMATS,
  listTemplates,
  getTemplate,
  getVersion,
  createDraft,
  approve,
  archiveTemplate,
  usage,
};
