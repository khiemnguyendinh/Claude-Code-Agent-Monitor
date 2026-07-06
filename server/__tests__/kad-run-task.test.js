/**
 * Regression coverage for the Run-backed KAD intake. Uses a fake Claude child
 * so POST /api/kad/run-task is exercised without invoking the real binary.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const http = require("node:http");
const { PassThrough } = require("node:stream");
const { EventEmitter } = require("node:events");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kad-run-task-test-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.KAD_WORKER_INTERVAL_MS = "3600000";

const { createApp } = require("../index");
const { db } = require("../db");
const repo = require("../lib/kad/repo");
const runs = require("../lib/run-spawner");
const dashboardRuns = require("../lib/dashboard-runs");

let server;
let BASE;
let originalSpawnRun;
let lastChild;
let lastSpawnArgs;

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = function (sig) {
    this.killed = true;
    setImmediate(() => this.emit("exit", sig === "SIGTERM" ? 143 : 0, sig || null));
  };
  return child;
}

function fetchJson(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const body = options.body ? Buffer.from(JSON.stringify(options.body)) : null;
    if (body) headers["Content-Length"] = body.length;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organization_profiles (id, name, created_at, updated_at) VALUES (?,?,?,?)`
  ).run("org-kad-run-task-test", "KAD Run Task Test", now, now);
  db.prepare(
    `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("dept-kad-run-task-test", "rd", "org-kad-run-task-test", "R&D", "active", now, now);

  originalSpawnRun = runs.spawnRun;
  runs.spawnRun = (args) => {
    lastSpawnArgs = args;
    lastChild = makeFakeChild();
    const handle = runs.__injectChildForTest({
      child: lastChild,
      mode: args.mode,
      prompt: args.prompt,
      source: args.source,
      taskId: args.taskId,
      onStatusChange: args.onStatusChange,
    });
    handle.cwd = args.cwd;
    handle.model = args.model || null;
    handle.permissionMode = args.permissionMode;
    handle.effort = args.effort || null;
    dashboardRuns.recordRun(handle);
    return handle;
  };

  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  runs.spawnRun = originalSpawnRun;
  if (server) server.close();
  runs.__reset();
  try {
    db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("POST /api/kad/run-task", () => {
  it("creates a KAD task/message and dashboard run bound by task_id", async () => {
    const res = await fetchJson("/api/kad/run-task", {
      method: "POST",
      body: {
        prompt: "Lập plan chương trình Digital Marketing AI Automation",
        cwd: TMP,
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.task.status, "doing");
    assert.equal(res.body.run.source, "kad_task");
    assert.equal(res.body.run.taskId, res.body.task.id);
    assert.equal(lastSpawnArgs.permissionMode, "plan");
    assert.equal(lastSpawnArgs.mode, "conversation");

    const messages = repo.tasks.listMessages(res.body.task.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].sender_type, "human");
    assert.equal(messages[0].content, "Lập plan chương trình Digital Marketing AI Automation");

    const persisted = dashboardRuns.listRunsByTask(res.body.task.id);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].source, "kad_task");
    assert.equal(persisted[0].task_id, res.body.task.id);
    assert.equal(persisted[0].permission_mode, "plan");
  });

  it("syncs completed run status back to waiting_human with a system message", async () => {
    const res = await fetchJson("/api/kad/run-task", {
      method: "POST",
      body: { prompt: "Chạy thử status sync", cwd: TMP },
    });
    assert.equal(res.status, 201);

    lastChild.emit("exit", 0, null);
    await new Promise((resolve) => setImmediate(resolve));

    const task = repo.tasks.getTask(res.body.task.id);
    assert.equal(task.status, "waiting_human");
    const messages = repo.tasks.listMessages(res.body.task.id);
    assert.equal(messages.at(-1).sender_id, "system");
    assert.match(messages.at(-1).content, /hoàn tất lượt chạy/);
  });
});
