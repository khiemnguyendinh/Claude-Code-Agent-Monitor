/**
 * @file Regression coverage for repo/personnel.js + POST/PUT /api/kad/agents
 * routes (Phase 1 — Đội ngũ admin, Nhân sự số CRUD). Mirrors the harness in
 * kad-tasks-validation.test.js.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-kad-personnel-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db } = require("../db");

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
const post = (p, body) => fetchJson(p, { method: "POST", body });
const put = (p, body) => fetchJson(p, { method: "PUT", body });

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;

  const now = new Date().toISOString();
  const orgId = "org-kad-personnel-test";
  db.prepare(
    `INSERT INTO organization_profiles (id, name, created_at, updated_at) VALUES (?,?,?,?)`
  ).run(orgId, "Test Org", now, now);
  deptId = "dept-kad-personnel-test";
  db.prepare(
    `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(deptId, "rd", orgId, "Test Dept", "active", now, now);
  db.prepare(
    `INSERT INTO agent_profiles
     (id, department_id, agent_type, name, display_name, engine, status, created_at, updated_at)
     VALUES ('agent-main-test',?, 'main', 'main-agent-rd', 'Main', 'claude', 'active', ?, ?)`
  ).run(deptId, now, now);
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

describe("POST /api/kad/agents — create", () => {
  it("creates a sub agent with permissions and skills", async () => {
    const res = await post("/api/kad/agents", {
      display_name: "Trợ lý mới",
      agent_type: "sub",
      engine: "claude",
      role_description: "Test JD",
      permissions: { read_org_context: true, web_search: false },
      skills: ["viết content", "seo"],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.display_name, "Trợ lý mới");
    assert.equal(res.body.status, "active");
    assert.equal(res.body.permissions.read_org_context, true);
    assert.deepEqual(res.body.skills, ["viết content", "seo"]);
  });

  it("rejects agent_type=main (only the setup wizard seeds main)", async () => {
    const res = await post("/api/kad/agents", { display_name: "X", agent_type: "main" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADAGENT");
  });

  it("rejects an unknown permission key", async () => {
    const res = await post("/api/kad/agents", {
      display_name: "X",
      permissions: { not_a_real_permission: true },
    });
    assert.equal(res.status, 400);
  });

  it("rejects a missing display_name", async () => {
    const res = await post("/api/kad/agents", { agent_type: "sub" });
    assert.equal(res.status, 400);
  });
});

describe("PUT /api/kad/agents/:id — update", () => {
  it("updates role_description, permissions, and skills", async () => {
    const created = await post("/api/kad/agents", { display_name: "Update Target" });
    const res = await put(`/api/kad/agents/${created.body.id}`, {
      role_description: "New JD",
      permissions: { web_search: true },
      skills: ["a", "b"],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.role_description, "New JD");
    assert.equal(res.body.permissions.web_search, true);
    assert.deepEqual(res.body.skills, ["a", "b"]);
  });

  it("rejects status='archived' via the update route (must use /archive)", async () => {
    const created = await post("/api/kad/agents", { display_name: "Status Target" });
    const res = await put(`/api/kad/agents/${created.body.id}`, { status: "archived" });
    assert.equal(res.status, 400);
  });

  it("404s on an unknown agent id", async () => {
    const res = await put("/api/kad/agents/ghost-agent", { display_name: "X" });
    assert.equal(res.status, 404);
  });
});

describe("POST /api/kad/agents/:id/archive — soft delete", () => {
  it("archives a sub agent", async () => {
    const created = await post("/api/kad/agents", { display_name: "Archive Target" });
    const res = await post(`/api/kad/agents/${created.body.id}/archive`, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "archived");
  });

  it("blocks archiving the main agent", async () => {
    const res = await post("/api/kad/agents/agent-main-test/archive", {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADAGENT");
  });

  it("archived agents are excluded from the default (no-filter) roster read but visible with status=archived", async () => {
    const created = await post("/api/kad/agents", { display_name: "Filter Target" });
    await post(`/api/kad/agents/${created.body.id}/archive`, {});
    const all = await get("/api/kad/agents?department=dept-kad-personnel-test");
    assert.ok(!all.body.some((a) => a.id === created.body.id && a.status !== "archived"));
    const archivedOnly = await get(
      "/api/kad/agents?department=dept-kad-personnel-test&status=archived"
    );
    assert.ok(archivedOnly.body.some((a) => a.id === created.body.id));
  });
});
