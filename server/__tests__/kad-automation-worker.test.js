/**
 * @file Coverage for the automation-rule executor (server/lib/kad/automation-
 * worker.js) — the "Đặt lịch / Trigger tạo việc" engine. Verifies schedule
 * due-computation, that a due create_task rule materializes a real task + fire
 * row (approval-gated → no run spawned), max_fires exhaustion, and the dept
 * kill-switch. Harness mirrors kad-okr.test.js (own temp DB, real repo).
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const TEST_DB = path.join(os.tmpdir(), `dashboard-kad-autow-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { db } = require("../db");
const repo = require("../lib/kad/repo");
const worker = require("../lib/kad/automation-worker");

let deptId;

before(() => {
  const now = new Date().toISOString();
  const orgId = "org-autow-test";
  db.prepare(
    `INSERT INTO organization_profiles (id, name, created_at, updated_at) VALUES (?,?,?,?)`
  ).run(orgId, "Test Org", now, now);
  deptId = "dept-autow-test";
  db.prepare(
    `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(deptId, "autow-test", orgId, "Test Dept", "active", now, now);
});

after(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(TEST_DB);
  } catch {
    /* ignore */
  }
});

describe("automation-worker schedule due-computation", () => {
  it("a daily rule is due after its time today", () => {
    // now = today 09:00; rule fires daily at 07:00 → last slot (07:00 today) is due.
    const now = new Date(2026, 6, 6, 9, 0, 0);
    const inst = worker.lastDueInstant({ freq: "daily", time: "07:00" }, now);
    assert.ok(inst && inst.getHours() === 7 && inst.getDate() === 6);
  });

  it("a daily rule not yet reached today falls back to yesterday's slot", () => {
    const now = new Date(2026, 6, 6, 6, 0, 0); // 06:00, before 07:00
    const inst = worker.lastDueInstant({ freq: "daily", time: "07:00" }, now);
    assert.equal(inst.getDate(), 5); // yesterday
  });

  it("a 'once' rule in the future is not due", () => {
    const now = new Date(2026, 6, 6, 9, 0, 0);
    const inst = worker.lastDueInstant({ freq: "once", day: "20", time: "07:00" }, now);
    assert.equal(inst, null);
  });
});

describe("automation-worker firing", () => {
  it("a due create_task rule creates a real task + a 'created' fire (approval-gated, no run)", () => {
    const rule = repo.automationRules.createRule({
      department_id: deptId,
      name: "Báo cáo hằng ngày",
      trigger_type: "schedule",
      trigger_config: { freq: "daily", time: "07:00" },
      action_type: "create_task",
      action_config: { brief: "Tổng hợp báo cáo ngày", working_dir: "kstudy-rd/K3" },
      approval_required: true,
    });

    const tasksBefore = repo.tasks.listTasks({ department_id: deptId }).length;
    worker.checkRules(new Date(2026, 6, 6, 9, 0, 0));
    const tasksAfter = repo.tasks.listTasks({ department_id: deptId });

    assert.equal(tasksAfter.length, tasksBefore + 1);
    const created = tasksAfter.find((t) => t.description === "Tổng hợp báo cáo ngày");
    assert.ok(created, "task materialized from the rule");
    assert.equal(created.activation, "rule");
    assert.equal(created.working_dir, "kstudy-rd/K3");

    const after = repo.automationRules.getRule(rule.id);
    assert.equal(after.fire_count, 1);
    assert.ok(after.last_fired_at);
    assert.equal(after.fires[0].result, "created");
    assert.equal(after.fires[0].action_task_id, created.id);
  });

  it("does not re-fire the same schedule slot on a second tick", () => {
    const rule = repo.automationRules.createRule({
      department_id: deptId,
      name: "Không lặp",
      trigger_type: "schedule",
      trigger_config: { freq: "daily", time: "07:00" },
      action_type: "notify",
      action_config: { message: "ping" },
      approval_required: true,
    });
    const now = new Date(2026, 6, 6, 9, 0, 0);
    worker.checkRules(now);
    worker.checkRules(now);
    const after = repo.automationRules.getRule(rule.id);
    assert.equal(after.fire_count, 1, "fired exactly once for the slot");
  });

  it("stops firing once max_fires is reached", () => {
    const rule = repo.automationRules.createRule({
      department_id: deptId,
      name: "Giới hạn 1 lần",
      trigger_type: "schedule",
      trigger_config: { freq: "daily", time: "07:00" },
      action_type: "notify",
      action_config: { message: "once" },
      approval_required: true,
      max_fires: 1,
    });
    worker.checkRules(new Date(2026, 6, 6, 9, 0, 0)); // day 1 → fires
    worker.checkRules(new Date(2026, 6, 7, 9, 0, 0)); // day 2 → exhausted
    const after = repo.automationRules.getRule(rule.id);
    assert.equal(after.fire_count, 1);
    assert.ok(after.fires.some((f) => f.result === "skipped_maxfires"));
  });

  it("respects the department automation kill-switch", () => {
    repo.catalog.setAutomationPaused(deptId, true);
    const rule = repo.automationRules.createRule({
      department_id: deptId,
      name: "Bị tạm dừng",
      trigger_type: "schedule",
      trigger_config: { freq: "daily", time: "07:00" },
      action_type: "notify",
      action_config: { message: "x" },
      approval_required: true,
    });
    worker.checkRules(new Date(2026, 6, 6, 9, 0, 0));
    const after = repo.automationRules.getRule(rule.id);
    assert.equal(after.fire_count, 0, "paused department fires nothing");
    repo.catalog.setAutomationPaused(deptId, false);
  });
});
