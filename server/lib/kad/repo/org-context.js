/**
 * @file server/lib/kad/repo/org-context.js — organization context, setup
 * wizard, org chart, and blueprint versioning. Phase 4 deliberately reuses
 * existing tables; wizard drafts live as draft organization_context_versions
 * tagged with data._wizard.source === "setup_wizard".
 */
const { db, parseJson, audit, newId, nowIso } = require("./db");

const SIZE_VALUES = new Set(["1-10", "11-50", "51-200", "201-500", "500+"]);
const NODE_TYPES = new Set(["company", "department", "position"]);
const TEMPLATE_TYPES = new Set(["rd", "training", "sales", "marketing", "finance_admin"]);

const DEPT_SETTINGS = {
  budget: {
    // 2M covered barely one task/day (a normal cycle is 1.3-1.7M) — raised so a
    // new department isn't blocked after a single task. Runaway-safety ceiling,
    // not a cost quota; see guardrails.js DEFAULT_BUDGET.
    daily_token_limit: 50000000,
    per_task_token_limit: 2000000,
    monthly_cost_limit_usd: 200,
    max_concurrent_runs: 3,
    max_delegations_per_task: 8,
  },
  max_turns_per_run: 30,
  notification: { channels: ["ui"] },
};

const ESCALATION = {
  stuck_retry_limit: 2,
  reject_escalate_after: 1,
  missing_context_action: "ask_human",
  approval_rejected_action: "report_and_wait",
};

const DEFAULT_ROSTER = [
  {
    agent_type: "main",
    name: "main-agent-rd",
    display_name: "Trợ lý vận hành R&D",
    status: "active",
    role_description:
      "Đầu mối duy nhất giữa trưởng phòng và đội AI agents: nhận mục tiêu, làm rõ, lập kế hoạch, xin duyệt, chia việc, tổng hợp, báo cáo.",
    permissions: {
      create_task: true,
      assign_task: true,
      create_helper: false,
      read_org_context: true,
      read_templates: true,
      web_search: false,
      request_approval: true,
      write_audit: true,
      publish_connector: false,
      modify_blueprint: false,
      modify_org_context: false,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    agent_type: "sub",
    name: "sub-program-architect",
    display_name: "Kiến trúc sư chương trình",
    status: "inactive",
    role_description: "Khung chương trình, learning pathway.",
    permissions: {
      read_org_context: true,
      read_templates: true,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    agent_type: "sub",
    name: "sub-curriculum-researcher",
    display_name: "Nghiên cứu chương trình",
    status: "active",
    role_description:
      "Research, benchmark, nhu cầu học viên, đối thủ; xác minh công cụ/nền tảng; tổng hợp research_report có nguồn.",
    permissions: {
      read_org_context: true,
      read_templates: true,
      web_search: true,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "allowed" },
  },
  {
    agent_type: "sub",
    name: "sub-syllabus-designer",
    display_name: "Thiết kế syllabus",
    status: "inactive",
    role_description: "Module, thứ tự, learning outcomes, assessment.",
    permissions: {
      read_org_context: true,
      read_templates: true,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    agent_type: "sub",
    name: "sub-lesson-planner",
    display_name: "Lập kế hoạch bài giảng",
    status: "inactive",
    role_description: "Hoạt động, bài tập, ghi chú giảng viên.",
    permissions: {
      read_org_context: false,
      read_templates: true,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    agent_type: "sub",
    name: "sub-slide-builder",
    display_name: "Xây dựng slide",
    status: "inactive",
    role_description: "Slide outline, nội dung, brief hình ảnh theo brand.",
    permissions: {
      read_org_context: true,
      read_templates: true,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    agent_type: "sub",
    name: "sub-video-script-writer",
    display_name: "Viết kịch bản video",
    status: "inactive",
    role_description: "Script video, kế hoạch quay.",
    permissions: {
      read_org_context: false,
      read_templates: true,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    agent_type: "sub",
    name: "sub-quality-reviewer",
    display_name: "Kiểm tra chất lượng",
    status: "inactive",
    role_description:
      "4 tiêu chí chính (đầy đủ, chính xác, sư phạm, thương hiệu) + hoàn thiện + flag 3 sensitivity dimensions.",
    permissions: {
      read_org_context: true,
      read_templates: true,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
];

const DEFAULT_TEMPLATE_CONTENT = [
  {
    type: "program_framework",
    name: "Khung chương trình R&D Kstudy",
    purpose: "Chuẩn hoá khung chương trình đào tạo theo CDIO/KASH.",
    content:
      "# Khung chương trình\n## Mục tiêu đào tạo (KASH)\n## Đối tượng & tiên quyết\n## Chuẩn đầu ra (Bloom)\n## Learning pathway\n## Đánh giá & capstone",
  },
  {
    type: "syllabus",
    name: "Syllabus R&D Kstudy",
    purpose: "Chuẩn syllabus theo KASH + Bloom.",
    content:
      "# Syllabus\n## Thông tin định danh\n## Mục tiêu & chuẩn đầu ra\n## Danh sách buổi\n## Khung năng lực KASH\n## Gate & fast_track",
  },
  {
    type: "lesson_plan",
    name: "Kế hoạch bài giảng R&D Kstudy",
    purpose: "Lesson plan theo chuẩn trình bày Kstudy.",
    content:
      "# Kế hoạch bài dạy\n## Chuẩn đầu ra\n## Tiến trình theo phút\n## Kịch bản demo\n## Bài tập\n## Tài nguyên",
  },
  {
    type: "slide_outline",
    name: "Slide outline R&D Kstudy",
    purpose: "Outline slide 1920x1080 theo brand.",
    content: "# Slide outline\n- Slide 1: Tiêu đề — nội dung — gợi ý minh họa\n## Ghi chú brand",
  },
  {
    type: "video_script",
    name: "Kịch bản video R&D Kstudy",
    purpose: "Video micro-learning Cốt lõi + Mở rộng.",
    content: "# Kịch bản video\n## Video Cốt lõi\n## Video Mở rộng\n## Kế hoạch quay",
  },
  {
    type: "quality_rubric",
    name: "Rubric kiểm định chất lượng R&D",
    purpose: "Checklist Quality Reviewer + sensitivity flags.",
    content:
      "# Rubric kiểm định chất lượng\n## 4 tiêu chí chính\n1. Đầy đủ theo template\n2. Chính xác\n3. Sư phạm\n4. Thương hiệu\n## Sensitivity flags\n## Kết luận",
  },
];

const WORKFLOW_STEPS = [
  {
    id: "plan",
    name: "Lập kế hoạch",
    node_type: "agent_step",
    output_type: "plan",
    approval: true,
  },
  { id: "research", name: "Nghiên cứu", node_type: "agent_step", output_type: "research_report" },
  {
    id: "framework",
    name: "Khung chương trình",
    node_type: "agent_step",
    output_type: "program_framework",
    gates: ["quality"],
    approval: true,
  },
  {
    id: "syllabus",
    name: "Syllabus",
    node_type: "agent_step",
    output_type: "syllabus",
    gates: ["quality"],
    approval: true,
  },
  {
    id: "materials",
    name: "Học liệu",
    node_type: "parallel_group",
    output_type: "lesson_plan|slide_outline|video_script",
  },
  { id: "handoff", name: "Bàn giao", node_type: "approval", approval: true },
];

function hydrateContext(row) {
  return row ? { ...row, data: parseJson(row.data, {}) } : null;
}

function mergeDeep(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch ?? base;
  const out = { ...(base && typeof base === "object" && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? mergeDeep(out[k] || {}, v) : v;
  }
  return out;
}

function firstOrg() {
  return db.prepare("SELECT * FROM organization_profiles ORDER BY created_at ASC LIMIT 1").get();
}

function listVersions({ org_id } = {}) {
  const rows = org_id
    ? db
        .prepare("SELECT * FROM organization_context_versions WHERE org_id=? ORDER BY version DESC")
        .all(org_id)
    : db.prepare("SELECT * FROM organization_context_versions ORDER BY created_at DESC").all();
  return rows.map(hydrateContext);
}

function getVersion(id) {
  return hydrateContext(
    db.prepare("SELECT * FROM organization_context_versions WHERE id=?").get(id)
  );
}

function getCurrent() {
  return hydrateContext(
    db
      .prepare(
        "SELECT * FROM organization_context_versions WHERE status='approved' ORDER BY version DESC LIMIT 1"
      )
      .get()
  );
}

function assertLen(name, value, max, required = false) {
  const s = String(value || "").trim();
  if (required && !s) throw new Error(`${name} is required`);
  if (s.length > max) throw new Error(`${name} must be <=${max} chars`);
  return s;
}

function validateProfile(profile) {
  const p = profile || {};
  const name = assertLen("name", p.name, 200, true);
  if (p.size && !SIZE_VALUES.has(p.size)) throw new Error("invalid size");
  if (p.founded_year != null) {
    const y = Number(p.founded_year);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) throw new Error("invalid founded_year");
  }
  return {
    name,
    logo_path: p.logo_path || null,
    industry: p.industry ? String(p.industry).slice(0, 100) : null,
    size: p.size || null,
    founded_year: p.founded_year == null || p.founded_year === "" ? null : Number(p.founded_year),
  };
}

function validateContextData(data) {
  const d = data || {};
  const brand = d.brand || {};
  assertLen("vision", d.vision, 1000, true);
  assertLen("mission", d.mission, 1000, true);
  assertLen("brand.voice", brand.voice, 2000, true);
  if (brand.guideline) assertLen("brand.guideline", brand.guideline, 10000);
  const core = Array.isArray(d.core_values) ? d.core_values : [];
  if (core.length > 10) throw new Error("core_values max 10");
  for (const v of core) assertLen("core_value", v, 200);
  const products = Array.isArray(d.products) ? d.products : [];
  if (products.length < 1 || products.length > 50) throw new Error("products must be 1-50");
  const personas = Array.isArray(d.personas) ? d.personas : [];
  if (personas.length < 1 || personas.length > 20) throw new Error("personas must be 1-20");
  const swot = d.swot || {};
  for (const k of ["strengths", "weaknesses", "opportunities", "threats"]) {
    const arr = Array.isArray(swot[k]) ? swot[k] : [];
    if (arr.length > 5) throw new Error(`swot.${k} max 5`);
    for (const v of arr) assertLen(`swot.${k}`, v, 500);
  }
  const competitors = Array.isArray(d.competitors) ? d.competitors : [];
  if (competitors.length > 20) throw new Error("competitors max 20");
  return {
    vision: d.vision,
    mission: d.mission,
    core_values: core,
    brand: {
      voice: brand.voice,
      guideline: brand.guideline || "",
      primary_color: brand.primary_color || "#1D237D",
      font: brand.font || "Inter",
      slogan: brand.slogan || "",
    },
    products,
    personas,
    strategy: d.strategy || { goals: "", priorities: "", constraints: "", roadmap: "" },
    swot: {
      strengths: Array.isArray(swot.strengths) ? swot.strengths : [],
      weaknesses: Array.isArray(swot.weaknesses) ? swot.weaknesses : [],
      opportunities: Array.isArray(swot.opportunities) ? swot.opportunities : [],
      threats: Array.isArray(swot.threats) ? swot.threats : [],
    },
    competitors,
    department_role: d.department_role || "",
    pedagogy_standards: d.pedagogy_standards || "",
    responsible_human: d.responsible_human || "",
  };
}

function normalizeNode(n, index, idMap) {
  const sourceId = n.id || `node-${index}`;
  const id = idMap.get(sourceId) || newId("orgnode");
  idMap.set(sourceId, id);
  const parentSource = n.parent_id ?? n.parentId ?? null;
  return {
    id,
    parent_id: parentSource ? idMap.get(parentSource) || parentSource : null,
    name: assertLen("org_chart.name", n.name, 200, true),
    node_type: n.node_type || n.nodeType || "position",
    lead_name: n.lead_name || n.leadName || null,
    mission: n.mission || null,
    sort_order: Number.isFinite(Number(n.sort_order ?? n.sortOrder))
      ? Number(n.sort_order ?? n.sortOrder)
      : index,
  };
}

function validateOrgChart(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (!list.length) throw new Error("org chart is required");
  const idMap = new Map();
  const normalized = list.map((n, i) => normalizeNode(n, i, idMap));
  for (const n of normalized)
    if (!NODE_TYPES.has(n.node_type)) throw new Error("invalid node_type");
  return normalized;
}

function deleteOrgChart(org_id) {
  for (let i = 0; i < 20; i++) {
    const changed = db
      .prepare(
        `DELETE FROM org_chart_nodes
         WHERE org_id=@org_id
           AND id NOT IN (
             SELECT parent_id FROM org_chart_nodes WHERE org_id=@org_id AND parent_id IS NOT NULL
           )`
      )
      .run({ org_id }).changes;
    if (!changed) break;
  }
}

function replaceOrgChart(org_id, nodes) {
  const normalized = validateOrgChart(nodes);
  deleteOrgChart(org_id);
  const ins = db.prepare(
    `INSERT INTO org_chart_nodes
     (id, org_id, parent_id, name, node_type, lead_name, mission, sort_order, created_at, updated_at)
     VALUES (@id,@org_id,@parent_id,@name,@node_type,@lead_name,@mission,@sort_order,@now,@now)`
  );
  const now = nowIso();
  for (const n of normalized) ins.run({ ...n, org_id, now });
  return listOrgChart(org_id);
}

function listOrgChart(org_id) {
  return db
    .prepare("SELECT * FROM org_chart_nodes WHERE org_id=? ORDER BY sort_order ASC, created_at ASC")
    .all(org_id);
}

function contextOnly(data) {
  const copy = { ...(data || {}) };
  delete copy._wizard;
  delete copy._profile;
  delete copy._org_chart_nodes;
  delete copy._department;
  delete copy._templates;
  return copy;
}

function getWizardDraft() {
  const rows = db
    .prepare(
      "SELECT * FROM organization_context_versions WHERE status='draft' ORDER BY created_at DESC"
    )
    .all();
  for (const row of rows) {
    const hydrated = hydrateContext(row);
    if (hydrated.data && hydrated.data._wizard && hydrated.data._wizard.source === "setup_wizard") {
      const profile = db.prepare("SELECT * FROM organization_profiles WHERE id=?").get(row.org_id);
      return { ...hydrated, profile };
    }
  }
  return null;
}

function saveWizardDraft({ step, data, draft } = {}) {
  const patch = draft || data || {};
  const now = nowIso();
  let current = getWizardDraft();
  let orgId = current && current.org_id;
  const merged = mergeDeep(current ? current.data : {}, patch);
  merged._wizard = {
    ...(merged._wizard || {}),
    source: "setup_wizard",
    current_step: step || (merged._wizard && merged._wizard.current_step) || 1,
    updated_at: now,
  };
  const profilePatch = merged._profile || patch.profile || {};

  db.transaction(() => {
    if (!orgId) {
      orgId = newId("org");
      db.prepare(
        `INSERT INTO organization_profiles (id,name,logo_path,industry,size,founded_year,created_at,updated_at)
         VALUES (@id,@name,@logo_path,@industry,@size,@founded_year,@now,@now)`
      ).run({
        id: orgId,
        name: profilePatch.name || "Đang thiết lập tổ chức",
        logo_path: profilePatch.logo_path || null,
        industry: profilePatch.industry || null,
        size: SIZE_VALUES.has(profilePatch.size) ? profilePatch.size : null,
        founded_year: profilePatch.founded_year || null,
        now,
      });
      const id = newId("orgctx");
      db.prepare(
        `INSERT INTO organization_context_versions
         (id,org_id,version,status,data,change_summary,approved_by,approved_at,created_at)
         VALUES (@id,@org_id,1,'draft',@data,'wizard draft',NULL,NULL,@now)`
      ).run({ id, org_id: orgId, data: JSON.stringify(merged), now });
    } else {
      if (profilePatch.name) {
        db.prepare(
          `UPDATE organization_profiles
           SET name=@name, logo_path=@logo_path, industry=@industry, size=@size,
               founded_year=@founded_year, updated_at=@now
           WHERE id=@id`
        ).run({
          id: orgId,
          name: profilePatch.name,
          logo_path: profilePatch.logo_path || null,
          industry: profilePatch.industry || null,
          size: SIZE_VALUES.has(profilePatch.size) ? profilePatch.size : null,
          founded_year: profilePatch.founded_year || null,
          now,
        });
      }
      db.prepare("UPDATE organization_context_versions SET data=@data WHERE id=@id").run({
        id: current.id,
        data: JSON.stringify(merged),
      });
    }
  })();
  return getWizardDraft();
}

function defaultOrgChart(profile, dept) {
  return [
    {
      id: "company",
      parent_id: null,
      name: profile.name,
      node_type: "company",
      lead_name: "anh Khiêm",
      mission: profile.industry || "",
      sort_order: 0,
    },
    {
      id: "department-rd",
      parent_id: "company",
      name: dept.name || "Phòng R&D",
      node_type: "department",
      lead_name: "anh Khiêm",
      mission: dept.mission || "",
      sort_order: 1,
    },
  ];
}

function completeWizard(input = {}) {
  const draft = getWizardDraft();
  const source = mergeDeep(draft ? draft.data : {}, input.draft || input.data || input);
  const profile = validateProfile(
    source._profile || source.profile || input.profile || (draft && draft.profile)
  );
  const context = validateContextData(contextOnly(source));
  const department = source._department || source.department || input.department || {};
  const deptSlug = department.slug || "rd";
  const deptTemplate = department.template_type || department.templateType || "rd";
  if (!TEMPLATE_TYPES.has(deptTemplate)) throw new Error("invalid department template_type");
  const deptInput = {
    slug: deptSlug,
    name: department.name || "Phòng R&D",
    template_type: deptTemplate,
    mission: department.mission || context.department_role || "Phòng R&D",
    settings: mergeDeep(DEPT_SETTINGS, department.settings || {}),
  };
  const nodes = validateOrgChart(
    source._org_chart_nodes ||
      source.org_chart_nodes ||
      source.orgChartNodes ||
      defaultOrgChart(profile, deptInput)
  );
  const templates =
    source._templates || source.templates || input.templates || DEFAULT_TEMPLATE_CONTENT;
  const now = nowIso();
  let ids = {};

  db.transaction(() => {
    const orgId = draft ? draft.org_id : newId("org");
    ids.org_id = orgId;
    if (db.prepare("SELECT id FROM organization_profiles WHERE id=?").get(orgId)) {
      db.prepare(
        `UPDATE organization_profiles
         SET name=@name, logo_path=@logo_path, industry=@industry, size=@size,
             founded_year=@founded_year, updated_at=@now
         WHERE id=@id`
      ).run({ id: orgId, ...profile, now });
    } else {
      db.prepare(
        `INSERT INTO organization_profiles
         (id,name,logo_path,industry,size,founded_year,created_at,updated_at)
         VALUES (@id,@name,@logo_path,@industry,@size,@founded_year,@now,@now)`
      ).run({ id: orgId, ...profile, now });
    }

    db.prepare(
      "UPDATE organization_context_versions SET status='archived' WHERE org_id=? AND status='approved'"
    ).run(orgId);
    const orgCtxId = draft ? draft.id : newId("orgctx");
    ids.org_context_version_id = orgCtxId;
    if (draft) {
      db.prepare(
        `UPDATE organization_context_versions
         SET status='approved', data=@data, change_summary=@summary, approved_by='human',
             approved_at=@now
         WHERE id=@id`
      ).run({ id: orgCtxId, data: JSON.stringify(context), summary: "setup wizard complete", now });
    } else {
      db.prepare(
        `INSERT INTO organization_context_versions
         (id,org_id,version,status,data,change_summary,approved_by,approved_at,created_at)
         VALUES (@id,@org_id,1,'approved',@data,'setup wizard complete','human',@now,@now)`
      ).run({ id: orgCtxId, org_id: orgId, data: JSON.stringify(context), now });
    }

    const oldDept = db.prepare("SELECT * FROM departments WHERE slug=?").get(deptSlug);
    const deptId = oldDept ? oldDept.id : newId("dept");
    ids.department_id = deptId;
    if (oldDept) {
      db.prepare(
        `UPDATE departments
         SET org_id=@org_id, name=@name, template_type=@template_type, mission=@mission,
             settings=@settings, status='active', updated_at=@now
         WHERE id=@id`
      ).run({
        id: deptId,
        org_id: orgId,
        name: deptInput.name,
        template_type: deptInput.template_type,
        mission: deptInput.mission,
        settings: JSON.stringify(deptInput.settings),
        now,
      });
    } else {
      db.prepare(
        `INSERT INTO departments
         (id,slug,org_id,name,template_type,mission,settings,status,created_at,updated_at)
         VALUES (@id,@slug,@org_id,@name,@template_type,@mission,@settings,'active',@now,@now)`
      ).run({
        id: deptId,
        slug: deptInput.slug,
        org_id: orgId,
        name: deptInput.name,
        template_type: deptInput.template_type,
        mission: deptInput.mission,
        settings: JSON.stringify(deptInput.settings),
        now,
      });
    }

    replaceOrgChart(orgId, nodes);
    ids.blueprint_version_id = seedBlueprintWorkflowAgents(deptId, now);
    seedTemplates(deptId, templates, now);

    audit({
      department_id: deptId,
      action: "org_context_changed",
      actor_type: "human",
      actor_id: "human",
      target_type: "org_context",
      target_id: orgCtxId,
      details: { source: "setup_wizard", version: 1 },
    });
  })();

  return {
    org: db.prepare("SELECT * FROM organization_profiles WHERE id=?").get(ids.org_id),
    org_context: getVersion(ids.org_context_version_id),
    department: db.prepare("SELECT * FROM departments WHERE id=?").get(ids.department_id),
    blueprint: getBlueprint(ids.blueprint_version_id),
    org_chart: listOrgChart(ids.org_id),
  };
}

function seedBlueprintWorkflowAgents(deptId, now) {
  db.prepare(
    "UPDATE department_blueprints SET status='archived' WHERE department_id=? AND status='approved'"
  ).run(deptId);
  const blueprintId = newId("bp");
  const agentRows = DEFAULT_ROSTER.map((a) => ({ ...a, id: newId("agent") }));
  const main = agentRows.find((a) => a.agent_type === "main");
  const workflowId = newId("wf");
  const steps = WORKFLOW_STEPS.map((s) => ({
    ...s,
    agent_ref:
      s.id === "plan" || s.id === "handoff"
        ? main.id
        : agentRows.find((a) => a.name.includes("researcher"))?.id || main.id,
  }));
  const blueprintData = {
    agents: agentRows.map((a) => ({
      id: a.id,
      name: a.name,
      display_name: a.display_name,
      agent_type: a.agent_type,
      status: a.status,
    })),
    workflows: [workflowId],
    gates: {
      quality_gate: "B",
      quality_required_for: ["program_framework", "syllabus", "handoff", "sensitive"],
    },
  };
  db.prepare(
    `INSERT INTO department_blueprints
     (id,department_id,version,status,data,proposed_by,approved_by,approved_at,created_at)
     VALUES (@id,@dept,1,'approved',@data,'setup_wizard','human',@now,@now)`
  ).run({ id: blueprintId, dept: deptId, data: JSON.stringify(blueprintData), now });

  db.prepare("DELETE FROM agent_profiles WHERE department_id=?").run(deptId);
  const insAgent = db.prepare(
    `INSERT INTO agent_profiles
     (id,department_id,blueprint_version_id,agent_type,name,display_name,engine,role_description,permissions,skills,connector_access,escalation_rules,quality_gates,status,parent_agent_id,created_at,updated_at)
     VALUES (@id,@dept,@bp,@agent_type,@name,@display_name,'claude',@role_description,@permissions,'[]',@connector_access,@escalation,@quality_gates,@status,@parent,@now,@now)`
  );
  for (const a of agentRows) {
    insAgent.run({
      id: a.id,
      dept: deptId,
      bp: blueprintId,
      agent_type: a.agent_type,
      name: a.name,
      display_name: a.display_name,
      role_description: a.role_description,
      permissions: JSON.stringify(a.permissions),
      connector_access: JSON.stringify(a.connector_access),
      escalation: JSON.stringify(ESCALATION),
      quality_gates: JSON.stringify(
        a.name === "sub-quality-reviewer" ? { reviews: "all_artifacts" } : {}
      ),
      status: a.status,
      parent: a.agent_type === "sub" ? main.id : null,
      now,
    });
  }

  db.prepare(
    "DELETE FROM workflow_definitions WHERE department_id=? AND name='rd-standard-flow'"
  ).run(deptId);
  db.prepare(
    `INSERT INTO workflow_definitions
     (id,department_id,name,description,example_prompt,trigger_keywords,steps,version,status,created_at)
     VALUES (@id,@dept,'rd-standard-flow',@desc,@ex,@kw,@steps,1,'active',@now)`
  ).run({
    id: workflowId,
    dept: deptId,
    desc: "Quy trình chuẩn R&D: mục tiêu -> plan -> research -> framework -> syllabus -> học liệu -> bàn giao.",
    ex: "Soạn khung chương trình khóa AI Automation 8 buổi cho người mới.",
    kw: JSON.stringify(["khung chương trình", "syllabus", "khóa", "học liệu", "nghiên cứu"]),
    steps: JSON.stringify(steps),
    now,
  });
  return blueprintId;
}

function seedTemplates(deptId, inputTemplates, now) {
  const rows =
    Array.isArray(inputTemplates) && inputTemplates.length
      ? inputTemplates
      : DEFAULT_TEMPLATE_CONTENT;
  for (const t of rows) {
    const type = t.template_type || t.type || "custom";
    const templateId = newId("tpl");
    db.prepare(
      `INSERT INTO template_library
       (id,department_id,name,template_type,purpose,required_inputs,output_structure,owner,status,created_at,updated_at)
       VALUES (@id,@dept,@name,@type,@purpose,'[]','{}','human','active',@now,@now)`
    ).run({
      id: templateId,
      dept: deptId,
      name: t.name || t.file_name || type,
      type,
      purpose: t.purpose || "",
      now,
    });
    db.prepare(
      `INSERT INTO template_versions
       (id,template_id,version,content,examples,change_summary,status,approved_by,approved_at,created_at)
       VALUES (@id,@template_id,1,@content,'[]',NULL,'approved','human',@now,@now)`
    ).run({
      id: newId("tplver"),
      template_id: templateId,
      content: t.content || "",
      now,
    });
  }
}

function createDraftVersion({ org_id, data, change_summary, actor_id = "human" }) {
  const org = org_id
    ? db.prepare("SELECT * FROM organization_profiles WHERE id=?").get(org_id)
    : firstOrg();
  if (!org) throw new Error("organization not found");
  const max = db
    .prepare("SELECT COALESCE(MAX(version),0) n FROM organization_context_versions WHERE org_id=?")
    .get(org.id).n;
  const current = getCurrent();
  const clean = { ...(current ? current.data : {}), ...(data || {}) };
  validateContextData(clean);
  const id = newId("orgctx");
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO organization_context_versions
       (id,org_id,version,status,data,change_summary,approved_by,approved_at,created_at)
       VALUES (@id,@org_id,@version,'draft',@data,@summary,NULL,NULL,@now)`
    ).run({
      id,
      org_id: org.id,
      version: max + 1,
      data: JSON.stringify(clean),
      summary: change_summary || "org context draft",
      now,
    });
    audit({
      action: "org_context_changed",
      actor_type: "human",
      actor_id,
      target_type: "org_context",
      target_id: id,
      details: { status: "draft", version: max + 1 },
    });
  })();
  return getVersion(id);
}

function approveVersion(id, { actor_id = "human" } = {}) {
  const version = getVersion(id);
  if (!version) return null;
  validateContextData(version.data);
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      "UPDATE organization_context_versions SET status='archived' WHERE org_id=? AND status='approved'"
    ).run(version.org_id);
    db.prepare(
      "UPDATE organization_context_versions SET status='approved', approved_by=@actor, approved_at=@now WHERE id=@id"
    ).run({ id, actor: actor_id, now });
    const dept = db
      .prepare("SELECT id FROM departments WHERE org_id=? LIMIT 1")
      .get(version.org_id);
    audit({
      department_id: dept && dept.id,
      action: "org_context_changed",
      actor_type: "human",
      actor_id,
      target_type: "org_context",
      target_id: id,
      details: { status: "approved", version: version.version },
    });
  })();
  return getVersion(id);
}

function listBlueprints({ department_id } = {}) {
  const rows = department_id
    ? db
        .prepare("SELECT * FROM department_blueprints WHERE department_id=? ORDER BY version DESC")
        .all(department_id)
    : db.prepare("SELECT * FROM department_blueprints ORDER BY created_at DESC").all();
  return rows.map((r) => ({ ...r, data: parseJson(r.data, {}) }));
}

function getBlueprint(id) {
  const row = db.prepare("SELECT * FROM department_blueprints WHERE id=?").get(id);
  return row ? { ...row, data: parseJson(row.data, {}) } : null;
}

function proposeBlueprint(sourceId, { data, change_summary, actor_id = "main-agent-rd" } = {}) {
  const source = getBlueprint(sourceId);
  if (!source) return null;
  const max = db
    .prepare("SELECT COALESCE(MAX(version),0) n FROM department_blueprints WHERE department_id=?")
    .get(source.department_id).n;
  const id = newId("bp");
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO department_blueprints
       (id,department_id,version,status,data,proposed_by,approved_by,approved_at,created_at)
       VALUES (@id,@dept,@version,'pending_approval',@data,@proposed_by,NULL,NULL,@now)`
    ).run({
      id,
      dept: source.department_id,
      version: max + 1,
      data: JSON.stringify(data || source.data),
      proposed_by: actor_id,
      now,
    });
    audit({
      department_id: source.department_id,
      action: "blueprint_changed",
      actor_type: actor_id === "human" ? "human" : "agent",
      actor_id,
      target_type: "blueprint",
      target_id: id,
      details: { status: "pending_approval", change_summary: change_summary || "" },
    });
  })();
  return getBlueprint(id);
}

function decideBlueprint(id, { decision, reason, actor_id = "human" } = {}) {
  const bp = getBlueprint(id);
  if (!bp) return null;
  if (!["approved", "rejected"].includes(decision))
    throw new Error("decision must be approved|rejected");
  const now = nowIso();
  db.transaction(() => {
    if (decision === "approved") {
      db.prepare(
        "UPDATE department_blueprints SET status='archived' WHERE department_id=? AND status='approved'"
      ).run(bp.department_id);
      db.prepare(
        "UPDATE department_blueprints SET status='approved', approved_by=@actor, approved_at=@now WHERE id=@id"
      ).run({ id, actor: actor_id, now });
      db.prepare(
        "UPDATE agent_profiles SET blueprint_version_id=@bp, updated_at=@now WHERE department_id=@dept"
      ).run({ bp: id, dept: bp.department_id, now });
    } else {
      db.prepare("UPDATE department_blueprints SET status='archived' WHERE id=?").run(id);
    }
    audit({
      department_id: bp.department_id,
      action: "blueprint_changed",
      actor_type: "human",
      actor_id,
      target_type: "blueprint",
      target_id: id,
      details: { decision, reason: reason || "" },
    });
  })();
  return getBlueprint(id);
}

module.exports = {
  listVersions,
  getVersion,
  getCurrent,
  createDraftVersion,
  approveVersion,
  getWizardDraft,
  saveWizardDraft,
  completeWizard,
  listOrgChart,
  replaceOrgChart,
  listBlueprints,
  getBlueprint,
  proposeBlueprint,
  decideBlueprint,
};
