#!/usr/bin/env node
/**
 * scripts/kad-seed-marketing.mjs — KAD Demo onboarding phòng ban mới.
 * Khởi tạo Phòng Marketing (Marketing Department) để demo.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("node:path");
const { runKadMigrations } = require(path.join(process.cwd(), "server/lib/kad/migrate.js"));

const dbMod = require(path.join(process.cwd(), "server/db.js"));
const db = dbMod.db;
const NOW = new Date().toISOString();

const ID = {
  org: "org-kstudy", // reuse existing org
  dept: "dept-marketing-demo",
  blueprint: "bp-marketing-v1",
  workflow: "wf-marketing-campaign",
  agents: {
    main: "agent-main-marketing",
    content: "agent-sub-content-creator",
    ads: "agent-sub-ads-optimizer"
  }
};

function seedMarketing() {
  runKadMigrations(db);

  // Ensure org exists
  const orgExists = db.prepare("SELECT id FROM organization_profiles WHERE id=?").get(ID.org);
  if (!orgExists) {
    console.error("Vui lòng chạy 'node scripts/kad-seed.mjs' trước để tạo Organization.");
    return;
  }

  const deptExists = db.prepare("SELECT id FROM departments WHERE id=?").get(ID.dept);
  if (deptExists) {
    console.log("[kad-seed-marketing] Phòng Marketing đã tồn tại — skipping.");
    return;
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO departments (id,slug,org_id,name,template_type,mission,settings,status,created_at,updated_at)
       VALUES (@id,'marketing',@org,'Phòng Marketing','marketing',@mission,@settings,'active',@now,@now)`
    ).run({
      id: ID.dept,
      org: ID.org,
      mission: "Phòng Marketing: Chịu trách nhiệm lên chiến dịch quảng cáo, viết content và tối ưu tỷ lệ chuyển đổi.",
      settings: JSON.stringify({
        budget: {
          daily_token_limit: 1000000,
          per_task_token_limit: 1000000,
          monthly_cost_limit_usd: 100,
          max_concurrent_runs: 2,
          max_delegations_per_task: 5,
        },
        max_turns_per_run: 20,
        notification: { channels: ["ui"] },
      }),
      now: NOW,
    });

    const blueprintData = {
      agents: [
        { id: ID.agents.main, name: "main-marketing", display_name: "Trợ lý Marketing", agent_type: "main", status: "active" },
        { id: ID.agents.content, name: "sub-content-creator", display_name: "Content Creator", agent_type: "sub", status: "active" },
        { id: ID.agents.ads, name: "sub-ads-optimizer", display_name: "Ads Optimizer", agent_type: "sub", status: "active" }
      ],
      workflows: [ID.workflow],
      gates: { quality_gate: "A", quality_required_for: ["campaign_plan"] }
    };

    db.prepare(
      `INSERT INTO department_blueprints (id,department_id,version,status,data,proposed_by,approved_by,approved_at,created_at)
       VALUES (@id,@dept,1,'approved',@data,'System','System',@now,@now)`
    ).run({ id: ID.blueprint, dept: ID.dept, data: JSON.stringify(blueprintData), now: NOW });

    const agents = [
      { id: ID.agents.main, type: "main", name: "main-marketing", display: "Trợ lý Marketing", role: "Đầu mối tiếp nhận yêu cầu chạy chiến dịch, phân việc cho content và ads.", parent: null },
      { id: ID.agents.content, type: "sub", name: "sub-content-creator", display: "Content Creator", role: "Viết bài quảng cáo, kịch bản video.", parent: ID.agents.main },
      { id: ID.agents.ads, type: "sub", name: "sub-ads-optimizer", display: "Ads Optimizer", role: "Tối ưu ngân sách, setup camp.", parent: ID.agents.main }
    ];

    const insAgent = db.prepare(
      `INSERT INTO agent_profiles
       (id,department_id,blueprint_version_id,agent_type,name,display_name,engine,role_description,permissions,skills,connector_access,escalation_rules,quality_gates,status,parent_agent_id,created_at,updated_at)
       VALUES (@id,@dept,@bp,@type,@name,@display,'claude',@role,@perms,'[]',@conn,'{}','{}','active',@parent,@now,@now)`
    );

    for (const a of agents) {
      insAgent.run({
        id: a.id, dept: ID.dept, bp: ID.blueprint, type: a.type, name: a.name, display: a.display, role: a.role, parent: a.parent,
        perms: JSON.stringify({ create_task: a.type==="main", assign_task: a.type==="main", request_approval: true }),
        conn: JSON.stringify({ facebook: a.type==="sub" ? "allowed" : "none" }),
        now: NOW
      });
    }

    db.prepare(
      `INSERT INTO workflow_definitions (id,department_id,name,description,example_prompt,trigger_keywords,steps,version,status,created_at)
       VALUES (@id,@dept,'wf-marketing-campaign','Quy trình lên camp','Lên camp FB Ads','["camp", "quảng cáo"]','[]',1,'active',@now)`
    ).run({ id: ID.workflow, dept: ID.dept, now: NOW });

  });
  tx();
  console.log("[kad-seed-marketing] Seeded demo Marketing department successfully.");
}

seedMarketing();
