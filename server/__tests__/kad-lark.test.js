/**
 * @file Phase 6.6 regression tests for the KAD <-> Lark adapter.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `dashboard-kad-lark-test-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_TOKEN = "";
process.env.KAD_LARK_ADAPTER_TOKEN = "test-lark-token";
process.env.KAD_LARK_OWNER_OPEN_ID = "ou_owner";
process.env.KAD_WORKER_TICK_MS = "3600000";

const { createApp, startServer } = require("../index");
const { db } = require("../db");
const repo = require("../lib/kad/repo");
const { registerAdapter } = require("../lib/kad/runner/adapter");
const larkAdapter = require("../lib/kad/lark-adapter");
const webhooks = require("../lib/webhooks");
const providers = require("../lib/webhook-providers");

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

const post = (p, body, headers) => fetchJson(p, { method: "POST", body, headers });
const larkHeaders = {
  "x-kad-adapter-token": "test-lark-token",
  "x-kad-channel": "lark",
};

function insertOrgDeptAndMainAgent() {
  const now = new Date().toISOString();
  const orgId = "org-kad-lark-test";
  db.prepare(
    `INSERT INTO organization_profiles (id, name, created_at, updated_at) VALUES (?,?,?,?)`
  ).run(orgId, "KAD Lark Test Org", now, now);
  deptId = "dept-kad-lark-test";
  db.prepare(
    `INSERT INTO departments (id, slug, org_id, name, status, settings, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(deptId, "rd", orgId, "R&D", "active", "{}", now, now);
  db.prepare(
    `INSERT INTO agent_profiles
     (id, department_id, agent_type, name, display_name, engine, permissions, skills, connector_access, escalation_rules, quality_gates, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    "agent-kad-lark-main",
    deptId,
    "main",
    "main",
    "Main Agent",
    "claude",
    "{}",
    "[]",
    "{}",
    "{}",
    "{}",
    "active",
    now,
    now
  );
}

before(async () => {
  registerAdapter({
    engine: "claude",
    probe: async () => ({ available: true, version: "fake" }),
    run: async () => ({
      engineSessionId: "fake-lark-session",
      output: "ok",
      tokens: null,
      exitCode: 0,
    }),
  });
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
  insertOrgDeptAndMainAgent();
});

after(() => {
  if (server) server.close();
  try {
    require("../lib/kad/job-queue").stopWorker();
  } catch {
    /* ignore */
  }
  try {
    db.close();
  } catch {
    /* ignore */
  }
  for (const f of [TEST_DB, TEST_DB + "-wal", TEST_DB + "-shm"]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

describe("kadAuth for Lark channel", () => {
  it("rejects spoofed channel=lark without the adapter token", async () => {
    const res = await post("/api/kad/tasks", {
      title: "Spoof",
      channel: "lark",
      channel_actor_ref: "ou_owner",
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "ELARKAUTH");
  });

  it("accepts the adapter token and records actor refs in audit details", async () => {
    const res = await post(
      "/api/kad/tasks",
      {
        title: "Token task",
        channel: "lark",
        channel_actor_ref: "ou_owner",
        channel_context_ref: "chat-dm",
        channel_chat_type: "p2p",
      },
      larkHeaders
    );
    assert.equal(res.status, 201);
    const audit = repo.listAudit({ task_id: res.body.id, action: "task_created" })[0];
    assert.equal(audit.channel, "lark");
    assert.equal(audit.details.channel_actor_ref, "ou_owner");
    assert.equal(audit.details.channel_context_ref, "chat-dm");
  });
});

describe("Lark adapter ingress and actions", () => {
  it("owner DM creates a real task and first Lark chat message", async () => {
    const res = await post(
      "/api/kad/lark/messages",
      {
        open_id: "ou_owner",
        chat_id: "chat-dm-2",
        chat_type: "p2p",
        text: "Soạn outline webinar AI Automation",
        message_id: "om_1",
      },
      larkHeaders
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.task.status, "inbox");
    const messages = repo.tasks.listMessages(res.body.task.id);
    assert.equal(messages[0].channel, "lark");
    assert.equal(messages[0].channel_actor_ref, "ou_owner");
  });

  it("non-owner report action is read-only and audited", async () => {
    const task = repo.tasks.createTask({
      department_id: deptId,
      title: "Report task",
      channel: "lark",
      channel_actor_ref: "ou_owner",
      channel_context_ref: "chat-group",
      channel_chat_type: "group",
    });
    const report = repo.tasks.addMessage({
      task_id: task.id,
      sender_type: "agent",
      sender_id: "agent-kad-lark-main",
      content: "Báo cáo kết quả",
      message_type: "report",
      metadata: {
        report: { version: 1, summary: "Done", artifacts: [], cost: { vnd: 0 }, decision: null },
      },
    });
    const denied = await post(
      "/api/kad/lark/card-action",
      {
        open_id: "ou_other",
        chat_id: "chat-group",
        action: {
          value: {
            kad_action: "report_approve",
            task_id: task.id,
            message_id: report.id,
          },
        },
      },
      larkHeaders
    );
    assert.equal(denied.status, 403);
    assert.notEqual(repo.tasks.getTask(task.id).status, "done");
    const audit = repo
      .listAudit({ task_id: task.id, action: "lark_action_denied" })
      .find((r) => r.details.actor_ref === "ou_other");
    assert.ok(audit);
    assert.equal(audit.channel, "lark");
  });

  it("owner can approve a report from Lark and move task to done", async () => {
    const task = repo.tasks.createTask({
      department_id: deptId,
      title: "Approve report task",
      channel: "lark",
      channel_actor_ref: "ou_owner",
      channel_context_ref: "chat-group",
      channel_chat_type: "group",
    });
    const report = repo.tasks.addMessage({
      task_id: task.id,
      sender_type: "agent",
      sender_id: "agent-kad-lark-main",
      content: "Báo cáo kết quả",
      message_type: "report",
      metadata: {
        report: { version: 1, summary: "Done", artifacts: [], cost: { vnd: 0 }, decision: null },
      },
    });
    const approved = await post(
      "/api/kad/lark/card-action",
      {
        open_id: "ou_owner",
        chat_id: "chat-group",
        action: {
          value: {
            kad_action: "report_approve",
            task_id: task.id,
            message_id: report.id,
          },
        },
      },
      larkHeaders
    );
    assert.equal(approved.status, 200);
    assert.equal(repo.tasks.getTask(task.id).status, "done");
    const audit = repo.listAudit({ task_id: task.id, action: "report_decided" }).pop();
    assert.equal(audit.channel, "lark");
    assert.equal(audit.details.actor_ref, "ou_owner");
  });
});

describe("Lark rendering and webhook provider", () => {
  it("renders intake quick replies as Lark card buttons", () => {
    const task = repo.tasks.createTask({ department_id: deptId, title: "Card task" });
    const msg = repo.tasks.addMessage({
      task_id: task.id,
      sender_type: "agent",
      sender_id: "agent-kad-lark-main",
      content: "Mục tiêu chính là gì?",
      message_type: "intake_question",
      metadata: { options: ["Tăng lead", "Tăng webinar"] },
    });
    const card = larkAdapter.renderTaskMessageCard(msg, task);
    assert.equal(card.elements[1].tag, "action");
    assert.equal(card.elements[1].actions[0].value.kad_action, "reply");
  });

  it("keeps Lark as a one-way webhook provider", () => {
    assert.ok(providers.WEBHOOK_TYPES.includes("lark"));
    const payload = webhooks.formatPayload("lark", {
      rule_name: "Approval pending",
      rule_type: "kad.approval",
      message: "Cần duyệt task",
      triggered_at: new Date().toISOString(),
    });
    assert.equal(payload.msg_type, "text");
    assert.ok(JSON.parse(payload.content).text.includes("Approval pending"));
  });
});
