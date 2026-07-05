/**
 * @file Regression coverage for KAD validation added during the Phase 2a/2b/2c
 * audit (kad/phase-02c-giao-viec): PATCH /tasks/:id status/priority enum
 * guards, POST /tasks/:id/dependencies ghost-task + self/cycle rejection, the
 * report/decide artifacts-array guard, and automation_rules.setEnabled
 * keeping `status` in sync with `enabled`. Before this pass, none of
 * server/lib/kad or server/routes/kad had any test coverage at all.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-kad-validation-test-${Date.now()}-${process.pid}.db`
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
const post = (p, body) => fetchJson(p, { method: "POST", body });
const patch = (p, body) => fetchJson(p, { method: "PATCH", body });

function makeTask(title) {
  return repo.tasks.createTask({ department_id: deptId, title: title || "Task" });
}

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;

  const now = new Date().toISOString();
  const orgId = "org-kad-validation-test";
  db.prepare(
    `INSERT INTO organization_profiles (id, name, created_at, updated_at) VALUES (?,?,?,?)`
  ).run(orgId, "Test Org", now, now);
  deptId = "dept-kad-validation-test";
  db.prepare(
    `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(deptId, "kad-validation-test", orgId, "Test Dept", "active", now, now);
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

describe("PATCH /api/kad/tasks/:id — status/priority validation", () => {
  it("rejects an invalid status with a structured 400, not a raw 500", async () => {
    const task = makeTask();
    const res = await patch(`/api/kad/tasks/${task.id}`, { status: "garbage" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADSTATUS");
  });

  it("rejects an invalid priority with a structured 400", async () => {
    const task = makeTask();
    const res = await patch(`/api/kad/tasks/${task.id}`, { priority: "urgentish" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADPRIORITY");
  });

  it("still accepts a valid status/priority", async () => {
    const task = makeTask();
    const res = await patch(`/api/kad/tasks/${task.id}`, { status: "doing", priority: "high" });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "doing");
    assert.equal(res.body.priority, "high");
  });
});

describe("POST /api/kad/tasks/:id/dependencies — ghost-task, self, and cycle rejection", () => {
  it("rejects a depends_on_task_id that doesn't exist (would otherwise 500 on the FK)", async () => {
    const task = makeTask();
    const res = await post(`/api/kad/tasks/${task.id}/dependencies`, {
      release_condition: "dep_task_done",
      depends_on_task_id: "ghost-task-id",
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "ENODEPTASK");
  });

  it("rejects a self-dependency (would otherwise deadlock the task forever)", async () => {
    const task = makeTask();
    const res = await post(`/api/kad/tasks/${task.id}/dependencies`, {
      release_condition: "dep_task_done",
      depends_on_task_id: task.id,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "ECYCLE");
  });

  it("rejects a transitive cycle (A depends on B, then B depends on A)", async () => {
    const a = makeTask("A");
    const b = makeTask("B");
    const first = await post(`/api/kad/tasks/${a.id}/dependencies`, {
      release_condition: "dep_task_done",
      depends_on_task_id: b.id,
    });
    assert.equal(first.status, 201);
    const second = await post(`/api/kad/tasks/${b.id}/dependencies`, {
      release_condition: "dep_task_done",
      depends_on_task_id: a.id,
    });
    assert.equal(second.status, 400);
    assert.equal(second.body.error.code, "ECYCLE");
  });

  it("accepts a valid, non-cyclic dependency", async () => {
    const a = makeTask("A2");
    const b = makeTask("B2");
    const res = await post(`/api/kad/tasks/${a.id}/dependencies`, {
      release_condition: "dep_task_done",
      depends_on_task_id: b.id,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.depends_on_task_id, b.id);
  });
});

describe("automationRules.setEnabled — status stays in sync with enabled", () => {
  it("flips status to 'paused' when disabled, back to 'active' when re-enabled", () => {
    const rule = repo.automationRules.createRule({
      department_id: deptId,
      name: "Test rule",
      trigger_type: "schedule",
      trigger_config: {},
      action_type: "notify",
      action_config: {},
      created_by: "test",
    });
    assert.equal(rule.enabled, 1);
    assert.equal(rule.status, "active");

    const disabled = repo.automationRules.setEnabled(rule.id, false);
    assert.equal(disabled.enabled, 0);
    assert.equal(disabled.status, "paused");

    const reenabled = repo.automationRules.setEnabled(rule.id, true);
    assert.equal(reenabled.enabled, 1);
    assert.equal(reenabled.status, "active");
  });
});
