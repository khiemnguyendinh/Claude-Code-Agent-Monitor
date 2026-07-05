#!/usr/bin/env node
/**
 * scripts/kad-seed.mjs — KAD Phase 1 seed (idempotent).
 *
 * Seeds REAL Kstudy R&D content (source: workspace `kstudy-rd/AGENTS.md`,
 * `_policy/approval-matrix.md`, `.claude/agents/*` JDs, and `kstudy-design-system`
 * tokens). NO fabricated identity facts (names/prices/metrics) — only faithful
 * paraphrase of stated positioning, per plan §2 anti-mock rule.
 *
 * Seeds: 1 org + org_context v1 (approved), dept `rd` (active, with budget
 * guardrails), blueprint v1 (approved, 8 agents), 8 agent_profiles — full
 * roster ACTIVE as of Phase 3 (phase-03 §1: "activate 6 agent còn lại"; main +
 * curriculum-researcher were already active since Phase 1), workflow
 * `rd-standard-flow`, R&D + connector templates (each template_versions v1 approved).
 *
 * Deterministic IDs (constants below) so kad-verify / orchestrator reference by
 * known id. Re-runnable: skips if org already present.
 *
 * Run: node scripts/kad-seed.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("node:path");
const { runKadMigrations } = require(path.join(process.cwd(), "server/lib/kad/migrate.js"));

// Load shared monitor db (same process db the server uses).
const dbMod = require(path.join(process.cwd(), "server/db.js"));
const db = dbMod.db;

const NOW = new Date().toISOString();

// ---- deterministic IDs ----
const ID = {
  org: "org-kstudy",
  orgctx: "orgctx-kstudy-v1",
  dept: "dept-rd",
  blueprint: "bp-rd-v1",
  workflow: "wf-rd-standard-flow",
  briefingRule: "rule-rd-daily-briefing",
  agents: {
    main: "agent-main-rd",
    architect: "agent-sub-program-architect",
    researcher: "agent-sub-curriculum-researcher",
    syllabus: "agent-sub-syllabus-designer",
    lesson: "agent-sub-lesson-planner",
    slide: "agent-sub-slide-builder",
    video: "agent-sub-video-script-writer",
    reviewer: "agent-sub-quality-reviewer",
  },
};

// ---- org context v1 data (faithful to kstudy-rd/AGENTS.md + design-system) ----
const ORG_CONTEXT = {
  vision:
    "Phổ cập năng lực Digital Marketing định hướng AI & Automation, thực chiến, cho người đi làm và người chuyển nghề tại Việt Nam.",
  mission:
    "Đào tạo Digital Marketing, AI & Automation (Online + Hybrid) theo hướng làm được ngay, không lý thuyết suông; xây và đưa học liệu lên hệ thống Kstudy AI Mentor.",
  core_values: [
    "AI-First",
    "Asset-light",
    "Guerrilla Marketing",
    "Business Automation",
    "Thực chiến — làm được ngay",
  ],
  brand: {
    voice:
      'Chuyên gia gần gũi, thực chiến, thẳng thắn; với học trò xưng "anh/em". Cấm ngôn từ phóng đại: "100%", "số 1", "duy nhất", cam kết vống.',
    guideline:
      "Tuân thủ skill kstudy-design-system (logo, màu, font). Không phóng đại; ưu tiên ví dụ Việt Nam, công cụ phổ cập, chi phí thấp.",
    primary_color: "#1D237D",
    font: "Google Sans Flex",
    slogan: "Đào tạo AI & Automation Marketing",
  },
  products: [
    {
      name: "Khóa Nghề Digital Marketing định hướng AI Automation",
      description: "Chương trình 6–8 tháng, Online + Hybrid, thực chiến.",
      target_audience: "Người đi làm và người chuyển nghề sang Digital Marketing.",
    },
    {
      name: "Kstudy AI Mentor",
      description: "Hệ thống quản lý đào tạo (B2B).",
      target_audience: "Tổ chức đào tạo, SME.",
    },
    {
      name: "Tư vấn AI Automation cho SME",
      description: "Dịch vụ B2B triển khai tự động hoá quy trình.",
      target_audience: "Chủ SME Việt Nam.",
    },
  ],
  personas: [
    {
      name: "Người chuyển nghề Digital Marketing",
      demographics: "Người đi làm tại Việt Nam muốn chuyển sang Digital Marketing.",
      needs: "Học thực chiến, làm được ngay, chi phí thấp.",
      pain_points: "Thiếu nền tảng, ngại lý thuyết suông, ngân sách hạn chế.",
      channels: "Online + Hybrid",
    },
  ],
  strategy: {
    goals: "Soạn học liệu đào tạo thực chiến chuẩn CDIO/KASH/Bloom và đưa lên Kstudy AI Mentor.",
    priorities: "Chất lượng sư phạm + tính thực chiến + brand voice nhất quán.",
    constraints: "Không phóng đại; ưu tiên ví dụ Việt Nam, công cụ phổ cập, chi phí thấp.",
    roadmap: "",
  },
  department_role:
    "Phòng R&D: xây khung chương trình → syllabus → học liệu (lesson/slide/video) và đưa lên Kstudy AI Mentor.",
  pedagogy_standards:
    "CDIO, khung năng lực KASH, Bloom taxonomy, hybrid learning (lớp trực tiếp = làm cùng mentor; video e-learning = Cốt lõi + Mở rộng).",
  responsible_human: 'anh Nguyễn Đình Khiêm — Trưởng phòng R&D kiêm Founder (gọi là "anh Khiêm").',
};

// ---- department budget guardrails (spec 01 §8 — MVP defaults) ----
// Department-level settings.budget OVERRIDES guardrails.js's DEFAULT_BUDGET
// (budgetFor() spreads default then override) — keep per_task_token_limit in
// sync with that file's default, or a seeded department silently reintroduces
// the old cap regardless of the code default. See guardrails.js for why 2M.
const DEPT_SETTINGS = {
  budget: {
    daily_token_limit: 2000000,
    per_task_token_limit: 2000000,
    monthly_cost_limit_usd: 200,
    max_concurrent_runs: 3,
    max_delegations_per_task: 8,
  },
  max_turns_per_run: 30,
  notification: { channels: ["ui"] },
};

// ---- roster (spec 01 §3.1). Phase 1: main + researcher active; rest inactive. ----
const ESCALATION = {
  stuck_retry_limit: 2,
  reject_escalate_after: 1,
  missing_context_action: "ask_human",
  approval_rejected_action: "report_and_wait",
};
const ROSTER = [
  {
    id: ID.agents.main,
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
      publish_connector: true,
      modify_blueprint: false,
      modify_org_context: false,
    },
    connector_access: { facebook: "allowed", wordpress: "allowed", web_search: "none" },
  },
  {
    id: ID.agents.architect,
    agent_type: "sub",
    name: "sub-program-architect",
    display_name: "Kiến trúc sư chương trình",
    status: "active",
    role_description: "Khung chương trình, learning pathway.",
    permissions: {
      read_org_context: true,
      read_templates: true,
      web_search: false,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    id: ID.agents.researcher,
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
    id: ID.agents.syllabus,
    agent_type: "sub",
    name: "sub-syllabus-designer",
    display_name: "Thiết kế syllabus",
    status: "active",
    role_description: "Module, thứ tự, learning outcomes, assessment.",
    permissions: {
      read_org_context: true,
      read_templates: true,
      web_search: false,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    id: ID.agents.lesson,
    agent_type: "sub",
    name: "sub-lesson-planner",
    display_name: "Lập kế hoạch bài giảng",
    status: "active",
    role_description: "Hoạt động, bài tập, ghi chú giảng viên.",
    permissions: {
      read_org_context: false,
      read_templates: true,
      web_search: false,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    id: ID.agents.slide,
    agent_type: "sub",
    name: "sub-slide-builder",
    display_name: "Xây dựng slide",
    status: "active",
    role_description: "Slide outline, nội dung, brief hình ảnh theo brand.",
    permissions: {
      read_org_context: true,
      read_templates: true,
      web_search: false,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    id: ID.agents.video,
    agent_type: "sub",
    name: "sub-video-script-writer",
    display_name: "Viết kịch bản video",
    status: "active",
    role_description: "Script video, kế hoạch quay.",
    permissions: {
      read_org_context: false,
      read_templates: true,
      web_search: false,
      request_approval: true,
      write_audit: true,
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
  {
    id: ID.agents.reviewer,
    agent_type: "sub",
    name: "sub-quality-reviewer",
    display_name: "Kiểm tra chất lượng",
    status: "active",
    role_description:
      "4 tiêu chí chính (đầy đủ, chính xác, sư phạm, thương hiệu) + hoàn thiện + flag 3 sensitivity dimensions.",
    permissions: {
      read_org_context: true,
      read_templates: true,
      read_artifacts: true, // spec 01 §3.1: "read mọi artifact của task" — data only, enforcement is P3B (QC gate B wiring)
      web_search: false,
      request_approval: true,
      write_audit: true,
      flag_sensitivity: true, // spec 04 §2 kad_flag_sensitivity — tool not yet registered (P3B); permission seeded ahead of wiring
    },
    connector_access: { facebook: "none", wordpress: "none", web_search: "none" },
  },
];

// ---- workflow rd-standard-flow (spec 01 §3.2) ----
const WORKFLOW_STEPS = [
  {
    id: "plan",
    name: "Lập kế hoạch",
    node_type: "agent_step",
    agent_ref: ID.agents.main,
    output_type: "plan",
    approval: true,
  },
  {
    id: "research",
    name: "Nghiên cứu",
    node_type: "agent_step",
    agent_ref: ID.agents.researcher,
    output_type: "research_report",
  },
  {
    id: "framework",
    name: "Khung chương trình",
    node_type: "agent_step",
    agent_ref: ID.agents.architect,
    output_type: "program_framework",
    gates: ["quality"],
    approval: true,
  },
  {
    id: "syllabus",
    name: "Syllabus",
    node_type: "agent_step",
    agent_ref: ID.agents.syllabus,
    output_type: "syllabus",
    gates: ["quality"],
    approval: true,
  },
  {
    id: "materials",
    name: "Học liệu (song song theo module)",
    node_type: "parallel_group",
    output_type: "lesson_plan|slide_outline|video_script",
  },
  {
    id: "handoff",
    name: "Bàn giao",
    node_type: "approval",
    agent_ref: ID.agents.main,
    approval: true,
  },
];

// ---- R&D + connector templates (real structural content, grounded in Kstudy context) ----
const TEMPLATES = [
  {
    id: "tpl-framework",
    type: "program_framework",
    name: "Khung chương trình R&D Kstudy",
    purpose: "Chuẩn hoá khung chương trình đào tạo theo CDIO/KASH.",
    content: `# Khung chương trình: {tên_khóa}
## 1. Mục tiêu đào tạo (KASH)
- Knowledge / Attitude / Skill / Habit
## 2. Đối tượng & tiên quyết
## 3. Chuẩn đầu ra (learning outcomes, Bloom)
## 4. Learning pathway (các module theo thứ tự)
| Module | Mục tiêu | Số buổi | Đầu ra |
## 5. Phương pháp (hybrid: lớp trực tiếp + video Cốt lõi/Mở rộng)
## 6. Đánh giá & capstone`,
  },
  {
    id: "tpl-syllabus",
    type: "syllabus",
    name: "Syllabus R&D Kstudy",
    purpose: "Chuẩn syllabus theo template /admin/curriculum.",
    content: `# Syllabus: {tên_khóa}
## Thông tin định danh (tên khóa, mã, tác giả — CHỜ DUYỆT)
## Mục tiêu & chuẩn đầu ra (KASH + Bloom)
## Danh sách buổi
| Buổi | Tên bài | Mô tả | Mục tiêu | Nội dung chính | Tài nguyên & công cụ | Bài tập |
## Khung năng lực KASH (radar 6 trục + skill_tag)
## Gate & fast_track`,
  },
  {
    id: "tpl-lesson",
    type: "lesson_plan",
    name: "Kế hoạch bài giảng R&D Kstudy",
    purpose: "Lesson plan theo chuẩn trình bày Kstudy.",
    content: `# Kế hoạch bài dạy — Buổi {N}: {tên_bài}
## Chuẩn đầu ra (KASH + Bloom) & gate
## Tiến trình theo phút
## Kịch bản demo
## Bài tập lớp / Bài tập về nhà
## Tài nguyên & công cụ`,
  },
  {
    id: "tpl-slide",
    type: "slide_outline",
    name: "Slide outline R&D Kstudy",
    purpose: "Outline slide 1920x1080 theo kstudy-design-system.",
    content: `# Slide outline — Buổi {N}
- Slide {i}: {tiêu_đề} — {nội_dung} — [gợi ý minh họa/câu lệnh tạo ảnh]
## Ghi chú brand: navy #1D237D, font Google Sans Flex, safe area`,
  },
  {
    id: "tpl-video",
    type: "video_script",
    name: "Kịch bản video R&D Kstudy",
    purpose: "Video micro-learning Cốt lõi + Mở rộng.",
    content: `# Kịch bản video — {tên_bài}
## Video Cốt lõi (mục tiêu, định dạng, outline)
## Video Mở rộng (mục tiêu, định dạng, outline)
## Kế hoạch quay / minh họa`,
  },
  {
    id: "tpl-rubric",
    type: "quality_rubric",
    name: "Rubric kiểm định chất lượng R&D",
    purpose: "Checklist Quality Reviewer + 3 sensitivity dimensions.",
    content: `# Rubric kiểm định chất lượng
## 4 tiêu chí chính
1. Đầy đủ theo template
2. Chính xác, không mâu thuẫn org context
3. Sư phạm (outcomes rõ, assessment phù hợp, progression logic)
4. Thương hiệu (tone/thuật ngữ/visual brief)
## Hoàn thiện: chính tả, format, references
## Sensitivity flags (BẮT BUỘC): metrics[y/n] people[y/n] brand[y/n]
## Kết luận: ĐẠT / CẦN SỬA`,
  },
  {
    id: "tpl-wordpress-post",
    type: "wordpress_post",
    name: "Bài WordPress Kstudy",
    purpose: "Chuẩn hóa bài blog/landing ngắn trước khi publish WordPress.",
    content: `# {Tiêu đề SEO}
## Hook mở bài
## Insight chính
## Nội dung triển khai
- Luận điểm 1
- Luận điểm 2
- Luận điểm 3
## CTA
## Metadata
- Excerpt:
- Category IDs:
- Tag IDs:
- Schedule: Ngay hoặc ISO datetime`,
  },
  {
    id: "tpl-facebook-post",
    type: "facebook_post",
    name: "Bài Facebook Page Kstudy",
    purpose: "Chuẩn hóa copy Facebook theo voice Kstudy và manual handoff.",
    content: `# Facebook post
## Hook
## Pain/Insight
## Nội dung ngắn
## CTA
## Checklist trước đăng
- Không claim quá mức
- Không dùng số liệu chưa có nguồn
- Giữ giọng Kstudy: chuyên gia gần gũi, thực chiến, thẳng`,
  },
];

// ---------------------------------------------------------------
function seed() {
  runKadMigrations(db);

  const exists = db.prepare("SELECT id FROM organization_profiles WHERE id=?").get(ID.org);
  if (exists) {
    console.log("[kad-seed] org already present — skipping (idempotent).");
    return;
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO organization_profiles (id,name,industry,size,created_at,updated_at)
       VALUES (@id,@name,@industry,@size,@now,@now)`
    ).run({
      id: ID.org,
      name: "Học viện Kstudy",
      industry: "Đào tạo Digital Marketing, AI & Automation",
      size: "11-50",
      now: NOW,
    });

    db.prepare(
      `INSERT INTO organization_context_versions (id,org_id,version,status,data,change_summary,approved_by,approved_at,created_at)
       VALUES (@id,@org,1,'approved',@data,NULL,'anh Khiêm',@now,@now)`
    ).run({ id: ID.orgctx, org: ID.org, data: JSON.stringify(ORG_CONTEXT), now: NOW });

    db.prepare(
      `INSERT INTO departments (id,slug,org_id,name,template_type,mission,settings,status,created_at,updated_at)
       VALUES (@id,'rd',@org,'Phòng R&D','rd',@mission,@settings,'active',@now,@now)`
    ).run({
      id: ID.dept,
      org: ID.org,
      mission: ORG_CONTEXT.department_role,
      settings: JSON.stringify(DEPT_SETTINGS),
      now: NOW,
    });

    const blueprintData = {
      agents: ROSTER.map((a) => ({
        id: a.id,
        name: a.name,
        display_name: a.display_name,
        agent_type: a.agent_type,
        status: a.status,
      })),
      workflows: [ID.workflow],
      gates: {
        quality_gate: "B",
        quality_required_for: ["program_framework", "syllabus", "handoff", "sensitive"],
      },
      approval_matrix_ref: "kstudy-rd/_policy/approval-matrix.md",
    };
    db.prepare(
      `INSERT INTO department_blueprints (id,department_id,version,status,data,proposed_by,approved_by,approved_at,created_at)
       VALUES (@id,@dept,1,'approved',@data,'anh Khiêm','anh Khiêm',@now,@now)`
    ).run({ id: ID.blueprint, dept: ID.dept, data: JSON.stringify(blueprintData), now: NOW });

    const insAgent = db.prepare(
      `INSERT INTO agent_profiles
       (id,department_id,blueprint_version_id,agent_type,name,display_name,engine,role_description,permissions,skills,connector_access,escalation_rules,quality_gates,status,parent_agent_id,created_at,updated_at)
       VALUES (@id,@dept,@bp,@agent_type,@name,@display,'claude',@role,@perms,@skills,@conn,@esc,@gates,@status,@parent,@now,@now)`
    );
    for (const a of ROSTER) {
      insAgent.run({
        id: a.id,
        dept: ID.dept,
        bp: ID.blueprint,
        agent_type: a.agent_type,
        name: a.name,
        display: a.display_name,
        role: a.role_description,
        perms: JSON.stringify(a.permissions),
        skills: JSON.stringify([]),
        conn: JSON.stringify(a.connector_access),
        esc: JSON.stringify(ESCALATION),
        gates: JSON.stringify(
          a.agent_type === "sub" && a.name === "sub-quality-reviewer"
            ? { reviews: "all_artifacts" }
            : {}
        ),
        status: a.status,
        parent: a.agent_type === "sub" ? ID.agents.main : null,
        now: NOW,
      });
    }

    db.prepare(
      `INSERT INTO workflow_definitions (id,department_id,name,description,example_prompt,trigger_keywords,steps,version,status,created_at)
       VALUES (@id,@dept,'rd-standard-flow',@desc,@ex,@kw,@steps,1,'active',@now)`
    ).run({
      id: ID.workflow,
      dept: ID.dept,
      desc: "Quy trình chuẩn R&D: mục tiêu → plan → research → framework → syllabus → học liệu song song → bàn giao.",
      ex: "Soạn khung chương trình khóa Facebook Ads cơ bản 8 buổi cho người mới.",
      kw: JSON.stringify(["khung chương trình", "syllabus", "khóa", "học liệu", "nghiên cứu"]),
      steps: JSON.stringify(WORKFLOW_STEPS),
      now: NOW,
    });

    const insTpl = db.prepare(
      `INSERT INTO template_library (id,department_id,name,template_type,purpose,required_inputs,output_structure,owner,status,created_at,updated_at)
       VALUES (@id,@dept,@name,@type,@purpose,@ri,@os,'anh Khiêm','active',@now,@now)`
    );
    const insTplV = db.prepare(
      `INSERT INTO template_versions (id,template_id,version,content,examples,change_summary,status,approved_by,approved_at,created_at)
       VALUES (@id,@tpl,1,@content,@ex,NULL,'approved','anh Khiêm',@now,@now)`
    );
    for (const t of TEMPLATES) {
      insTpl.run({
        id: t.id,
        dept: ID.dept,
        name: t.name,
        type: t.type,
        purpose: t.purpose,
        ri: JSON.stringify([]),
        os: JSON.stringify({}),
        now: NOW,
      });
      insTplV.run({
        id: `${t.id}-v1`,
        tpl: t.id,
        content: t.content,
        ex: JSON.stringify([]),
        now: NOW,
      });
    }

    // Morning briefing as a single schedule rule (phase-06_5 item 5 — replaces
    // the earlier standalone [ĐỀ XUẤT]). run_briefing is deterministic + spends
    // no tokens → approval_required=0 (auto-runs at the scheduled time). created_at
    // gates the first fire so a fresh install never back-fires today's occurrence.
    db.prepare(
      `INSERT INTO automation_rules
         (id, department_id, name, trigger_type, trigger_config, action_type, action_config,
          approval_required, enabled, fire_count, created_by, status, created_at)
       VALUES (@id,@dept,@name,'schedule',@trig,'run_briefing',@act,0,1,0,'seed','active',@now)`
    ).run({
      id: ID.briefingRule,
      dept: ID.dept,
      name: "Giao ban buổi sáng",
      trig: JSON.stringify({ freq: "daily", time: "07:00", label: "Hằng ngày 07:00" }),
      act: JSON.stringify({}),
      now: NOW,
    });

    db.prepare(
      `INSERT INTO audit_log (id,department_id,action,actor_type,actor_id,target_type,target_id,details,created_at)
       VALUES (@id,@dept,'org_context_changed','system','seed','org_context',@ctx,@details,@now)`
    ).run({
      id: `audit-seed-${Date.now()}`,
      dept: ID.dept,
      ctx: ID.orgctx,
      details: JSON.stringify({ note: "Phase 1 seed from kstudy-rd" }),
      now: NOW,
    });
  });
  tx();
  console.log(
    "[kad-seed] seeded: org, org_context v1, dept rd, blueprint v1, 8 agents (full roster active — phase-03 §1), workflow, 8 templates (6 R&D + 2 connector), 1 automation rule (daily briefing — phase-06_5)."
  );
}

seed();
