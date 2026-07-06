/**
 * @file Regression coverage for repo/strategic-goals.js + GET/PUT /api/kad/goals
 * (Phase 1 — Đội ngũ admin. "Mục tiêu & chiến lược" persistence, previously
 * pure client-side React state). Mirrors the harness in kad-tasks-validation.test.js.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `dashboard-kad-goals-test-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db } = require("../db");

let server;
let BASE;
let orgId;

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
const put = (p, body) => fetchJson(p, { method: "PUT", body });

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;

  const now = new Date().toISOString();
  orgId = "org-kad-goals-test";
  db.prepare(
    `INSERT INTO organization_profiles (id, name, created_at, updated_at) VALUES (?,?,?,?)`
  ).run(orgId, "Test Org", now, now);
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

describe("GET /api/kad/goals — fresh DB", () => {
  it("returns an empty, non-erroring state before anything is saved", async () => {
    const res = await get("/api/kad/goals");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.goals, []);
    assert.equal(res.body.strategy_markdown, "");
  });
});

describe("PUT /api/kad/goals — direct write, no approval gate", () => {
  it("saves goals + strategy together and survives a re-read (proves DB persistence, not in-memory)", async () => {
    const res = await put("/api/kad/goals", {
      org_id: orgId,
      strategy_markdown: "## Trọng tâm quý này\nTăng trưởng khoá AI Marketing.",
      goals: [
        {
          title: "Ra mắt khoá K3",
          metric: "Học liệu hoàn thành",
          current: 3,
          target: 7,
          due: "30/09",
        },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.goals.length, 1);
    assert.equal(res.body.goals[0].title, "Ra mắt khoá K3");
    assert.equal(res.body.goals[0].current_value, 3);
    assert.equal(res.body.goals[0].target_value, 7);
    assert.ok(res.body.strategy_updated_at);

    const reread = await get(`/api/kad/goals?org_id=${encodeURIComponent(orgId)}`);
    assert.equal(reread.body.goals.length, 1);
    assert.match(reread.body.strategy_markdown, /Tăng trưởng/);
  });

  it("replace is a full bulk replace — a second PUT with fewer goals drops the rest", async () => {
    await put("/api/kad/goals", {
      org_id: orgId,
      goals: [
        { title: "Goal A", current: 1, target: 2 },
        { title: "Goal B", current: 1, target: 2 },
      ],
    });
    const res = await put("/api/kad/goals", { org_id: orgId, goals: [{ title: "Goal A only" }] });
    assert.equal(res.status, 200);
    assert.equal(res.body.goals.length, 1);
    assert.equal(res.body.goals[0].title, "Goal A only");
  });

  it("rejects a goal missing a title", async () => {
    const res = await put("/api/kad/goals", { org_id: orgId, goals: [{ metric: "x" }] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADGOALS");
  });
});
