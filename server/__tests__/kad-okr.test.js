/**
 * @file Regression coverage for "Đội ngũ ▸ Mục tiêu": the MANUAL
 * objectives/key_results tree (repo/okr.js, migration kad-006-okr.sql) and the
 * COMPUTED KPI panel (repo/reports.js kpis()). Mirrors the harness in
 * kad-reports-extra.test.js/kad-goals.test.js. Timestamps for KPI aggregation
 * are seeded directly (not Date.now()-relative at assertion time) so fixed
 * offsets from "now" at seed time land in the same real bucket every run —
 * only the *window* (current UTC month) is computed from "now" at request time.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `dashboard-kad-okr-test-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db } = require("../db");
const repo = require("../lib/kad/repo");

let server;
let BASE;
let orgId;
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
const post = (p, body) => fetchJson(p, { method: "POST", body });
const put = (p, body) => fetchJson(p, { method: "PUT", body });

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;

  const now = new Date().toISOString();
  orgId = "org-kad-okr-test";
  db.prepare(
    `INSERT INTO organization_profiles (id, name, created_at, updated_at) VALUES (?,?,?,?)`
  ).run(orgId, "Test Org", now, now);
  deptId = "dept-kad-okr-test";
  db.prepare(
    `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(deptId, "kad-okr-test", orgId, "Test Dept", "active", now, now);
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

// ---------------------------------------------------------------------------
// repo/okr.js — direct repo coverage (health/confidence derivation)
// ---------------------------------------------------------------------------

describe("repo.okr — listObjectives derives health/confidence from key results", () => {
  it("computes on_track/at_risk/off_track per KR and worst-of confidence for the objective", () => {
    const objective = repo.okr.createObjective({
      department_id: deptId,
      level: "department",
      cycle: "quarter",
      period: "Q3 2026",
      title: "Tăng năng suất học liệu",
      owner_id: "human",
    });
    assert.equal(objective.confidence, "on_track"); // no KRs yet — stored default holds
    assert.deepEqual(objective.key_results, []);

    // on_track: 10/10 = 1.0 progress
    const krOnTrack = repo.okr.createKeyResult({
      objective_id: objective.id,
      title: "Hoàn thành 10 học liệu",
      metric: "Số lượng",
      current_value: 10,
      target_value: 10,
      direction: "up",
    });
    assert.equal(krOnTrack.health, "on_track");

    // at_risk: 7/10 = 0.7 progress (>=0.6, <0.9)
    const krAtRisk = repo.okr.createKeyResult({
      objective_id: objective.id,
      title: "Đạt điểm chất lượng",
      metric: "Điểm",
      current_value: 7,
      target_value: 10,
      direction: "up",
    });
    assert.equal(krAtRisk.health, "at_risk");

    const afterTwo = repo.okr.getObjective(objective.id);
    assert.equal(afterTwo.confidence, "at_risk"); // worst of [on_track, at_risk]

    // off_track: 2/10 = 0.2 progress
    const krOffTrack = repo.okr.createKeyResult({
      objective_id: objective.id,
      title: "Giảm thời gian duyệt",
      metric: "Ngày",
      current_value: 2,
      target_value: 10,
      direction: "up",
    });
    assert.equal(krOffTrack.health, "off_track");

    const afterThree = repo.okr.getObjective(objective.id);
    assert.equal(afterThree.confidence, "off_track"); // worst of [on_track, at_risk, off_track]
    assert.equal(afterThree.key_results.length, 3);
  });

  it("handles direction='down' (progress = target/current) and divide-by-zero guards", () => {
    const objective = repo.okr.createObjective({
      department_id: deptId,
      level: "department",
      cycle: "quarter",
      period: "Q3 2026",
      title: "Giảm chi phí",
      owner_id: "human",
    });
    // down, current=50000 target=60000 -> progress = 60000/50000 = 1.2 -> on_track (spending under target)
    const krDown = repo.okr.createKeyResult({
      objective_id: objective.id,
      title: "Chi phí / học liệu",
      current_value: 50000,
      target_value: 60000,
      direction: "down",
    });
    assert.equal(krDown.health, "on_track");

    // target_value=0 guard: 'up' direction with current>0 target=0 -> treated as fully met (1.0)
    const krZeroTargetUp = repo.okr.createKeyResult({
      objective_id: objective.id,
      title: "KR chưa đặt target",
      current_value: 5,
      target_value: 0,
      direction: "up",
    });
    assert.equal(krZeroTargetUp.health, "on_track");

    // current_value=0 guard on 'up': 0/5 = 0 progress -> off_track, no throw
    const krZeroCurrentUp = repo.okr.createKeyResult({
      objective_id: objective.id,
      title: "KR chưa có tiến độ",
      current_value: 0,
      target_value: 5,
      direction: "up",
    });
    assert.equal(krZeroCurrentUp.health, "off_track");
  });
});

// ---------------------------------------------------------------------------
// CRUD routes
// ---------------------------------------------------------------------------

describe("POST/GET /api/kad/okr/objectives", () => {
  it("creates a company-level objective and lists it back nested with an empty key_results array", async () => {
    const res = await post("/api/kad/okr/objectives", {
      level: "company",
      cycle: "year",
      period: "2026",
      title: "Trở thành đơn vị học liệu AI hàng đầu",
      owner_id: "human",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.level, "company");
    assert.equal(res.body.confidence, "on_track");
    assert.deepEqual(res.body.key_results, []);

    const list = await get(`/api/kad/okr/objectives?level=company`);
    assert.equal(list.status, 200);
    assert.ok(list.body.some((o) => o.id === res.body.id));
  });

  it("rejects an invalid level", async () => {
    const res = await post("/api/kad/okr/objectives", {
      level: "invalid",
      cycle: "year",
      period: "2026",
      title: "Bad objective",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADOBJECTIVE");
  });

  it("rejects a department-level objective with no resolvable department_id", async () => {
    const res = await post("/api/kad/okr/objectives", {
      level: "department",
      cycle: "quarter",
      period: "Q3 2026",
      title: "Missing department",
      department_id: "",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADOBJECTIVE");
  });

  it("filters listObjectives by department query param", async () => {
    const created = await post("/api/kad/okr/objectives", {
      department_id: deptId,
      level: "department",
      cycle: "quarter",
      period: "Q3 2026",
      title: "Mục tiêu phòng ban filter test",
      owner_id: "human",
    });
    assert.equal(created.status, 201);
    const res = await get(`/api/kad/okr/objectives?department=${deptId}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.every((o) => o.department_id === deptId));
    assert.ok(res.body.some((o) => o.id === created.body.id));
  });
});

describe("PUT /api/kad/okr/objectives/:id", () => {
  it("updates title/period and returns 404 for an unknown id", async () => {
    const created = await post("/api/kad/okr/objectives", {
      department_id: deptId,
      level: "department",
      cycle: "quarter",
      period: "Q3 2026",
      title: "Mục tiêu cần sửa",
      owner_id: "human",
    });
    const res = await put(`/api/kad/okr/objectives/${created.body.id}`, {
      title: "Mục tiêu đã sửa",
      period: "Q4 2026",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, "Mục tiêu đã sửa");
    assert.equal(res.body.period, "Q4 2026");

    const notFound = await put("/api/kad/okr/objectives/obj_does_not_exist", { title: "x" });
    assert.equal(notFound.status, 404);
  });
});

describe("POST /api/kad/okr/objectives/:id/key-results + PUT /api/kad/okr/key-results/:id", () => {
  it("creates a KR then flips its health when current_value is updated via PUT", async () => {
    const objective = await post("/api/kad/okr/objectives", {
      department_id: deptId,
      level: "department",
      cycle: "quarter",
      period: "Q3 2026",
      title: "Mục tiêu KR flip test",
      owner_id: "human",
    });
    assert.equal(objective.status, 201);

    const kr = await post(`/api/kad/okr/objectives/${objective.body.id}/key-results`, {
      title: "Học liệu mới",
      metric: "Số lượng",
      current_value: 1,
      target_value: 10,
      direction: "up",
      owner_id: "human",
    });
    assert.equal(kr.status, 201);
    assert.equal(kr.body.health, "off_track"); // 1/10 = 0.1

    const updated = await put(`/api/kad/okr/key-results/${kr.body.id}`, { current_value: 10 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.current_value, 10);
    assert.equal(updated.body.health, "on_track"); // 10/10 = 1.0

    // Confirm the objective's confidence recomputes too via the nested list endpoint.
    const list = await get(`/api/kad/okr/objectives?department=${deptId}`);
    const found = list.body.find((o) => o.id === objective.body.id);
    assert.ok(found);
    assert.equal(found.confidence, "on_track");

    const notFound = await put("/api/kad/okr/key-results/kr_does_not_exist", { current_value: 5 });
    assert.equal(notFound.status, 404);
  });

  it("returns 404 when creating a key result under an unknown objective_id", async () => {
    const res = await post("/api/kad/okr/objectives/obj_does_not_exist/key-results", {
      title: "Orphan KR",
      current_value: 1,
      target_value: 2,
    });
    assert.equal(res.status, 404);
  });

  it("rejects a key result missing a title", async () => {
    const objective = await post("/api/kad/okr/objectives", {
      department_id: deptId,
      level: "department",
      cycle: "quarter",
      period: "Q3 2026",
      title: "Mục tiêu KR validation test",
      owner_id: "human",
    });
    const res = await post(`/api/kad/okr/objectives/${objective.body.id}/key-results`, {
      current_value: 1,
      target_value: 2,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADKEYRESULT");
  });
});

// ---------------------------------------------------------------------------
// GET /api/kad/reports/kpis — computed panel, real monthly aggregates
// ---------------------------------------------------------------------------

describe("GET /api/kad/reports/kpis — real monthly aggregates, no fabricated data", () => {
  it("returns 3 KPI rows with trend length 6 and all-zero current on a fresh department", async () => {
    const freshDept = "dept-kad-okr-kpis-fresh";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(freshDept, "kad-okr-kpis-fresh", orgId, "Fresh KPI Dept", "active", now, now);

    const res = await get(`/api/kad/reports/kpis?department=${freshDept}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
    const ids = res.body.map((k) => k.id);
    assert.deepEqual(ids, ["kpi-throughput", "kpi-quality", "kpi-cost"]);
    for (const k of res.body) {
      assert.equal(typeof k.current, "number");
      assert.ok(Array.isArray(k.trend));
      assert.equal(k.trend.length, 6);
      for (const v of k.trend) assert.equal(typeof v, "number");
      assert.equal(k.current, 0);
      assert.equal(k.owner_id, "human"); // no main agent seeded for this department
      assert.equal(k.source, "Tự động · KAD");
      assert.ok(["on_track", "at_risk", "off_track"].includes(k.health));
    }
    // documented defaults since this department has no settings.kpi_targets
    assert.equal(res.body.find((k) => k.id === "kpi-throughput").target, 48);
    assert.equal(res.body.find((k) => k.id === "kpi-quality").target, 90);
    assert.equal(res.body.find((k) => k.id === "kpi-cost").target, 60000);
  });

  it("reflects real seeded tasks/approvals/runs/artifacts for the current month, and reads department kpi_targets overrides", async () => {
    const kpiDept = "dept-kad-okr-kpis-real";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO departments (id, slug, org_id, name, status, settings, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      kpiDept,
      "kad-okr-kpis-real",
      orgId,
      "Real KPI Dept",
      "active",
      JSON.stringify({ kpi_targets: { throughput: 5, quality: 80, cost: 100000 } }),
      now,
      now
    );

    // Real main agent for owner_id resolution (agent_type='main' is seeded-only, never
    // created via personnel.createAgent — insert directly like kad-reports-extra.test.js does).
    const mainAgentId = "agent_test_okr_main";
    db.prepare(
      `INSERT INTO agent_profiles
       (id, department_id, agent_type, name, display_name, engine, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      mainAgentId,
      kpiDept,
      "main",
      "main-okr-tester",
      "Main OKR Tester",
      "claude",
      "active",
      now,
      now
    );

    // 2 tasks completed THIS month (throughput = 2).
    const task1 = repo.tasks.createTask({ department_id: kpiDept, title: "Học liệu 1" });
    db.prepare(`UPDATE tasks SET status='done', completed_at=? WHERE id=?`).run(now, task1.id);
    const task2 = repo.tasks.createTask({ department_id: kpiDept, title: "Học liệu 2" });
    db.prepare(`UPDATE tasks SET status='done', completed_at=? WHERE id=?`).run(now, task2.id);

    // 2 approvals decided this month: 1 approved, 1 rejected -> quality = 50%.
    const approved = repo.approvals.createApproval({
      task_id: task1.id,
      approval_type: "artifact",
      title: "Duyệt học liệu 1",
    });
    repo.approvals.decide(approved.id, { decision: "approved" });
    const rejected = repo.approvals.createApproval({
      task_id: task2.id,
      approval_type: "artifact",
      title: "Duyệt học liệu 2",
    });
    repo.approvals.decide(rejected.id, { decision: "rejected" });

    // 2 artifacts created this month (used as the "completed that month" proxy for cost/artifact).
    const artifact1 = repo.artifacts.createArtifact({
      task_id: task1.id,
      artifact_type: "lesson_plan",
      title: "Artifact 1",
    });
    const artifact2 = repo.artifacts.createArtifact({
      task_id: task2.id,
      artifact_type: "lesson_plan",
      title: "Artifact 2",
    });
    assert.ok(artifact1.id && artifact2.id);

    // A real run completed this month with real tokens_used -> real VND cost this month.
    const run = repo.runs.createRun({ task_id: task1.id, agent_id: mainAgentId, engine: "claude" });
    db.prepare(
      `UPDATE task_runs SET status='completed', tokens_used=?, completed_at=? WHERE id=?`
    ).run(JSON.stringify({ input_tokens: 100_000, output_tokens: 50_000 }), now, run.id);

    const res = await get(`/api/kad/reports/kpis?department=${kpiDept}`);
    assert.equal(res.status, 200);
    const throughput = res.body.find((k) => k.id === "kpi-throughput");
    const quality = res.body.find((k) => k.id === "kpi-quality");
    const cost = res.body.find((k) => k.id === "kpi-cost");

    assert.equal(throughput.current, 2); // tasks.status='done' this month
    assert.equal(throughput.trend[5], 2); // last element = current month (index 5 of 6)
    assert.equal(throughput.target, 5); // real department kpi_targets override
    assert.equal(throughput.owner_id, mainAgentId); // resolved to the real main agent

    assert.equal(quality.current, 50); // 1 approved / 2 decided this month * 100
    assert.equal(quality.target, 80);

    // Real VND cost this month / 2 real artifacts this month.
    const expectedUsd = (100_000 / 1_000_000) * 3 + (50_000 / 1_000_000) * 15;
    const expectedVnd = Math.round(expectedUsd * 26000);
    assert.equal(cost.current, Math.round(expectedVnd / 2));
    assert.equal(cost.target, 100000);
  });

  it("excludes tasks/approvals/runs/artifacts from a prior month out of the current-month bucket", async () => {
    const oldDept = "dept-kad-okr-kpis-old";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(oldDept, "kad-okr-kpis-old", orgId, "Old Month KPI Dept", "active", now, now);

    // 4 months ago — well outside the 6-month trend's *current* month bucket assertion below
    // (still inside the 6-month window itself, so it must land in an EARLIER trend index, not the last).
    const fourMonthsAgo = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 4, 15)
    ).toISOString();
    const task = repo.tasks.createTask({ department_id: oldDept, title: "Học liệu tháng trước" });
    db.prepare(`UPDATE tasks SET status='done', completed_at=? WHERE id=?`).run(
      fourMonthsAgo,
      task.id
    );

    const res = await get(`/api/kad/reports/kpis?department=${oldDept}`);
    const throughput = res.body.find((k) => k.id === "kpi-throughput");
    assert.equal(throughput.current, 0); // nothing completed THIS month
    assert.equal(throughput.trend[5], 0);
    // the 1 real completion shows up somewhere earlier in the 6-month trend, not fabricated away
    assert.equal(
      throughput.trend.reduce((a, b) => a + b, 0),
      1
    );
  });
});
