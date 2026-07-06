/**
 * @file Regression coverage for the two remaining "Tổng quan" [GAP] endpoints
 * (client/src/kad/types.ts §Exceptions, §OpsMetricCard): GET /api/kad/exceptions
 * and GET /api/kad/reports/metrics, backed by server/lib/kad/repo/reports.js.
 * Mirrors the harness in kad-tasks-validation.test.js. Timestamps are seeded
 * directly (not Date.now()-relative at assertion time) to stay deterministic —
 * only the *window* (last 7/14 days) is computed from "now" at run time, so
 * fixed offsets from "now" at seed time land in the same bucket every run.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-kad-reports-extra-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db } = require("../db");
const repo = require("../lib/kad/repo");

let server;
let BASE;
let deptId;

function fetchJson(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...options.headers },
    };
    const req = http.request(opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}
const get = (p) => fetchJson(p);

const isoHoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const isoDaysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;

  const now = new Date().toISOString();
  const orgId = "org-kad-reports-extra-test";
  db.prepare(
    `INSERT INTO organization_profiles (id, name, created_at, updated_at) VALUES (?,?,?,?)`
  ).run(orgId, "Test Org", now, now);
  deptId = "dept-kad-reports-extra-test";
  db.prepare(
    `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(deptId, "kad-reports-extra-test", orgId, "Test Dept", "active", now, now);
});

after(() => {
  if (server) server.close();
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

describe("GET /api/kad/exceptions — real aggregation only", () => {
  it("returns [] on a fresh department with no failed runs/overdue approvals", async () => {
    const freshDept = "dept-kad-reports-extra-fresh";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      freshDept,
      "kad-reports-extra-fresh",
      "org-kad-reports-extra-test",
      "Fresh Dept",
      "active",
      now,
      now
    );
    const res = await get(`/api/kad/exceptions?department=${freshDept}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it("surfaces a failed run (task_runs.status='failed') as kind=run_failed, severity=danger", async () => {
    const task = repo.tasks.createTask({ department_id: deptId, title: "Video script K2" });
    const runId = "run_test_failed_1";
    const completedAt = isoHoursAgo(3); // freeze once — reused for both the insert and the assertion
    db.prepare(
      `INSERT INTO task_runs (id, task_id, agent_id, engine, status, started_at, completed_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(runId, task.id, null, "claude", "failed", isoHoursAgo(4), completedAt);

    const res = await get(`/api/kad/exceptions?department=${deptId}`);
    assert.equal(res.status, 200);
    const found = res.body.find((e) => e.id === `exc_run_${runId}`);
    assert.ok(found, "expected the failed run to appear in /exceptions");
    assert.equal(found.kind, "run_failed");
    assert.equal(found.severity, "danger");
    assert.equal(found.task_id, task.id);
    assert.match(found.description, /Video script K2/);
    assert.equal(found.occurred_at, completedAt);
  });

  it("does not surface a failed run older than 7 days", async () => {
    const task = repo.tasks.createTask({ department_id: deptId, title: "Ancient failure" });
    const runId = "run_test_failed_old";
    db.prepare(
      `INSERT INTO task_runs (id, task_id, agent_id, engine, status, started_at, completed_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(runId, task.id, null, "claude", "failed", isoDaysAgo(10), isoDaysAgo(10));

    const res = await get(`/api/kad/exceptions?department=${deptId}`);
    assert.equal(
      res.body.find((e) => e.id === `exc_run_${runId}`),
      undefined
    );
  });

  it("surfaces an overdue pending approval as kind=approval_sla", async () => {
    const task = repo.tasks.createTask({ department_id: deptId, title: "Duyệt kế hoạch tổng thể" });
    // sla_reminder_hours=4, created 6h ago -> 2h overdue (not yet >2x the 4h window -> warning)
    const approval = repo.approvals.createApproval({
      task_id: task.id,
      approval_type: "plan",
      title: "Duyệt kế hoạch tổng thể — Onboarding",
      sla_reminder_hours: 4,
    });
    db.prepare(`UPDATE approvals SET created_at=? WHERE id=?`).run(isoHoursAgo(6), approval.id);

    const res = await get(`/api/kad/exceptions?department=${deptId}`);
    const found = res.body.find((e) => e.id === `exc_appr_${approval.id}`);
    assert.ok(found, "expected the overdue approval to appear in /exceptions");
    assert.equal(found.kind, "approval_sla");
    assert.equal(found.severity, "warning");
    assert.equal(found.task_id, task.id);
    assert.equal(found.description, "Duyệt kế hoạch tổng thể — Onboarding");
  });

  it("escalates an approval overdue by more than 2x its SLA window to severity=danger", async () => {
    const task = repo.tasks.createTask({ department_id: deptId, title: "Duyệt gấp" });
    // sla_reminder_hours=2, created 20h ago -> 18h overdue, which is > 2x the 2h window.
    const approval = repo.approvals.createApproval({
      task_id: task.id,
      approval_type: "artifact",
      title: "Duyệt gấp — quá hạn nặng",
      sla_reminder_hours: 2,
    });
    db.prepare(`UPDATE approvals SET created_at=? WHERE id=?`).run(isoHoursAgo(20), approval.id);

    const res = await get(`/api/kad/exceptions?department=${deptId}`);
    const found = res.body.find((e) => e.id === `exc_appr_${approval.id}`);
    assert.ok(found);
    assert.equal(found.severity, "danger");
  });

  it("does not surface a pending approval still within its SLA window", async () => {
    const task = repo.tasks.createTask({ department_id: deptId, title: "Duyệt trong hạn" });
    const approval = repo.approvals.createApproval({
      task_id: task.id,
      approval_type: "artifact",
      title: "Duyệt trong hạn",
      sla_reminder_hours: 48,
    });
    // created just now — nowhere near the 48h SLA yet.
    const res = await get(`/api/kad/exceptions?department=${deptId}`);
    assert.equal(
      res.body.find((e) => e.id === `exc_appr_${approval.id}`),
      undefined
    );
  });

  it("surfaces an unread budget_warning notification as kind=budget_exceeded", async () => {
    const task = repo.tasks.createTask({ department_id: deptId, title: "Task vượt ngân sách" });
    const notif = repo.notifications.createNotification({
      department_id: deptId,
      kind: "budget_warning",
      title: "Vượt ngân sách",
      body: "per_task_token_limit reached (2000000/2000000)",
      target_id: task.id,
    });

    const res = await get(`/api/kad/exceptions?department=${deptId}`);
    const found = res.body.find((e) => e.id === `exc_budget_${notif.id}`);
    assert.ok(found, "expected the unread budget_warning notification to appear");
    assert.equal(found.kind, "budget_exceeded");
    assert.equal(found.severity, "warning");
    assert.equal(found.task_id, task.id);
  });

  it("does not surface a budget_warning notification once marked read", async () => {
    const task = repo.tasks.createTask({ department_id: deptId, title: "Task đã đọc thông báo" });
    const notif = repo.notifications.createNotification({
      department_id: deptId,
      kind: "budget_warning",
      title: "Vượt ngân sách (đã đọc)",
      target_id: task.id,
    });
    repo.notifications.markRead(notif.id);

    const res = await get(`/api/kad/exceptions?department=${deptId}`);
    assert.equal(
      res.body.find((e) => e.id === `exc_budget_${notif.id}`),
      undefined
    );
  });

  it("surfaces a delegation stuck at retry_count>=2 as kind=delegation_stuck", async () => {
    const task = repo.tasks.createTask({ department_id: deptId, title: "Video script kẹt retry" });
    // task_delegations.from_agent_id/to_agent_id are live FKs into agent_profiles — seed
    // two minimal real agents rather than fake ids (would otherwise throw SQLITE_CONSTRAINT_FOREIGNKEY).
    const nowIso = new Date().toISOString();
    const fromAgentId = "agent_test_from_1";
    const toAgentId = "agent_test_to_1";
    for (const [id, name] of [
      [fromAgentId, "Main Agent"],
      [toAgentId, "Sub Agent"],
    ]) {
      db.prepare(
        `INSERT INTO agent_profiles
         (id, department_id, agent_type, name, display_name, engine, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        id,
        deptId,
        id === fromAgentId ? "main" : "sub",
        name,
        name,
        "claude",
        "active",
        nowIso,
        nowIso
      );
    }
    const delegId = "deleg_test_stuck_1";
    db.prepare(
      `INSERT INTO task_delegations
       (id, task_id, from_agent_id, to_agent_id, instruction, input_artifact_ids, status, retry_count, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      delegId,
      task.id,
      fromAgentId,
      toAgentId,
      "Viết kịch bản",
      "[]",
      "running",
      2,
      isoHoursAgo(2),
      isoHoursAgo(1)
    );

    const res = await get(`/api/kad/exceptions?department=${deptId}`);
    const found = res.body.find((e) => e.id === `exc_deleg_${delegId}`);
    assert.ok(found, "expected the stuck delegation to appear in /exceptions");
    assert.equal(found.kind, "delegation_stuck");
    assert.equal(found.severity, "warning");
    assert.equal(found.task_id, task.id);
  });

  it("caps the result at 20 items, newest first", async () => {
    const capDept = "dept-kad-reports-extra-cap";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      capDept,
      "kad-reports-extra-cap",
      "org-kad-reports-extra-test",
      "Cap Dept",
      "active",
      now,
      now
    );
    const task = repo.tasks.createTask({ department_id: capDept, title: "Cap test" });
    for (let i = 0; i < 25; i++) {
      db.prepare(
        `INSERT INTO task_runs (id, task_id, agent_id, engine, status, started_at, completed_at)
         VALUES (?,?,?,?,?,?,?)`
      ).run(`run_cap_${i}`, task.id, null, "claude", "failed", isoHoursAgo(i + 1), isoHoursAgo(i));
    }
    const res = await get(`/api/kad/exceptions?department=${capDept}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 20);
    // newest first: run_cap_0 completed isoHoursAgo(0) is the most recent.
    assert.equal(res.body[0].id, "exc_run_run_cap_0");
  });
});

describe("GET /api/kad/reports/metrics — real 14-day daily buckets only", () => {
  it("returns an empty metrics array shape (never an error) on a fresh department", async () => {
    const freshDept = "dept-kad-reports-metrics-fresh";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      freshDept,
      "kad-reports-metrics-fresh",
      "org-kad-reports-extra-test",
      "Fresh Metrics Dept",
      "active",
      now,
      now
    );
    const res = await get(`/api/kad/reports/metrics?department=${freshDept}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.metrics));
    // completed-tasks + cost metrics always computed (real columns, 0 is a real value);
    // QC-approval-rate is omitted entirely since there are no decided approvals yet.
    assert.equal(res.body.metrics.length, 2);
    for (const m of res.body.metrics) {
      assert.equal(typeof m.label, "string");
      assert.equal(typeof m.value, "string");
      assert.equal(typeof m.delta_label, "string");
      assert.ok(["up", "down", "flat"].includes(m.delta_direction));
      assert.equal(typeof m.delta_good, "boolean");
      assert.ok(Array.isArray(m.series_14d));
      assert.equal(m.series_14d.length, 14);
      for (const v of m.series_14d) assert.equal(typeof v, "number");
    }
  });

  it("counts a task completed today in 'Việc hoàn thành' and its series_14d[13]", async () => {
    const metricsDept = "dept-kad-reports-metrics-count";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      metricsDept,
      "kad-reports-metrics-count",
      "org-kad-reports-extra-test",
      "Metrics Count Dept",
      "active",
      now,
      now
    );
    const task = repo.tasks.createTask({
      department_id: metricsDept,
      title: "Học liệu hoàn thành hôm nay",
    });
    db.prepare(`UPDATE tasks SET status='done', completed_at=? WHERE id=?`).run(now, task.id);

    const res = await get(`/api/kad/reports/metrics?department=${metricsDept}`);
    const completed = res.body.metrics.find((m) => m.label === "Việc hoàn thành");
    assert.ok(completed);
    assert.equal(completed.value, "1");
    assert.equal(completed.series_14d[13], 1); // today = index 13, the last entry
    assert.equal(
      completed.series_14d.slice(0, 13).reduce((a, b) => a + b, 0),
      0
    );
  });

  it("includes 'Đạt QC' once at least one approval has been decided, computed from approvals.status/decided_at", async () => {
    const qcDept = "dept-kad-reports-metrics-qc";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      qcDept,
      "kad-reports-metrics-qc",
      "org-kad-reports-extra-test",
      "QC Dept",
      "active",
      now,
      now
    );
    const task = repo.tasks.createTask({ department_id: qcDept, title: "QC task" });
    const approved = repo.approvals.createApproval({
      task_id: task.id,
      approval_type: "artifact",
      title: "A1",
    });
    repo.approvals.decide(approved.id, { decision: "approved" });
    const rejected = repo.approvals.createApproval({
      task_id: task.id,
      approval_type: "artifact",
      title: "A2",
    });
    repo.approvals.decide(rejected.id, { decision: "rejected" });

    const res = await get(`/api/kad/reports/metrics?department=${qcDept}`);
    const qc = res.body.metrics.find((m) => m.label === "Đạt QC");
    assert.ok(qc, "expected Đạt QC metric once approvals have been decided");
    assert.equal(qc.value, "50%"); // 1 approved / 2 decided today
    assert.equal(qc.series_14d.length, 14);
    assert.equal(qc.series_14d[13], 50);
  });
});
