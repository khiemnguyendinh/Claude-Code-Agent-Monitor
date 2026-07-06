/**
 * @file Regression coverage for single-file .xlsx import + template download
 * (Phase 4 — Đội ngũ admin: Mục tiêu chiến lược, Văn hóa & Nguyên tắc, JD &
 * Kỹ năng). Mirrors the harness in kad-tasks-validation.test.js, plus a small
 * multipart/form-data builder since this is the first upload-route test in
 * this suite.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `dashboard-kad-xlsx-test-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db } = require("../db");
const { buildTemplateWorkbook } = require("../lib/kad/repo/xlsx-schemas");

let server;
let BASE;
let orgId;
let deptId;
let agentId;

function postMultipart(urlPath, fileBuffer, extraFields = {}) {
  return new Promise((resolve, reject) => {
    const boundary = `----kadtest${Date.now()}`;
    const url = new URL(urlPath, BASE);
    const parts = [];
    for (const [k, v] of Object.entries(extraFields)) {
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
      );
    }
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
      )
    );
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(buf);
          } catch {
            parsed = buf;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getBuffer(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    http
      .get({ hostname: url.hostname, port: url.port, path: url.pathname }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}
const get = (p) =>
  new Promise((resolve, reject) => {
    const url = new URL(p, BASE);
    http
      .get({ hostname: url.hostname, port: url.port, path: url.pathname + url.search }, (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
      })
      .on("error", reject);
  });

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;

  const now = new Date().toISOString();
  orgId = "org-kad-xlsx-test";
  db.prepare(
    `INSERT INTO organization_profiles (id, name, created_at, updated_at) VALUES (?,?,?,?)`
  ).run(orgId, "Test Org", now, now);
  deptId = "dept-kad-xlsx-test";
  db.prepare(
    `INSERT INTO departments (id, slug, org_id, name, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(deptId, "xlsx-test", orgId, "Test Dept", "active", now, now);
  agentId = "agent-kad-xlsx-test";
  db.prepare(
    `INSERT INTO agent_profiles (id, department_id, agent_type, name, display_name, engine, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(agentId, deptId, "sub", "sub-xlsx-test", "Xlsx Test Agent", "claude", "active", now, now);

  const contextData = {
    vision: "v",
    mission: "m",
    core_values: ["a"],
    brand: { voice: "voice", guideline: "", primary_color: "#000", font: "Inter", slogan: "" },
    products: ["p1"],
    personas: ["persona1"],
    strategy: { goals: "", priorities: "", constraints: "", roadmap: "" },
    swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    competitors: [],
  };
  db.prepare(
    `INSERT INTO organization_context_versions (id, org_id, version, status, data, change_summary, approved_by, approved_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    "orgctx-kad-xlsx-test",
    orgId,
    1,
    "approved",
    JSON.stringify(contextData),
    "seed",
    "human",
    now,
    now
  );
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

describe("GET /api/kad/import-templates/:kind", () => {
  it("generates a downloadable .xlsx for each known kind", async () => {
    for (const kind of ["muc-tieu", "van-hoa", "jd-ky-nang"]) {
      const res = await getBuffer(`/api/kad/import-templates/${kind}`);
      assert.equal(res.status, 200);
      assert.ok(res.buffer.length > 0);
      // .xlsx is a zip container — magic bytes "PK"
      assert.equal(res.buffer.slice(0, 2).toString(), "PK");
    }
  });

  it("400s on an unknown kind", async () => {
    const res = await getBuffer("/api/kad/import-templates/not-a-real-kind");
    assert.equal(res.status, 400);
  });
});

describe("POST /api/kad/goals/import", () => {
  it("round-trips the downloaded template unmodified", async () => {
    const wb = buildTemplateWorkbook("muc-tieu");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await postMultipart("/api/kad/goals/import", buf, { org_id: orgId });
    assert.equal(res.status, 200);
    assert.equal(res.body.goals.length, 1);
    assert.equal(res.body.goals[0].title, "Ra mắt Khóa AI Marketing K3");
    assert.equal(res.body.goals[0].current_value, 3);
    assert.equal(res.body.goals[0].target_value, 7);
    assert.match(res.body.strategy_markdown, /Trọng tâm quý này/);

    const reread = await get(`/api/kad/goals?org_id=${encodeURIComponent(orgId)}`);
    assert.equal(reread.body.goals.length, 1);
  });

  it("400s on a file missing the MucTieu sheet", async () => {
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("NotTheRightSheet");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await postMultipart("/api/kad/goals/import", buf, { org_id: orgId });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADIMPORT");
  });
});

describe("POST /api/kad/org-context/import", () => {
  it("creates a draft version from the downloaded template (approval gate preserved)", async () => {
    const wb = buildTemplateWorkbook("van-hoa");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await postMultipart("/api/kad/org-context/import", buf);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "draft");
    assert.equal(res.body.data.mission, "...");
    assert.deepEqual(res.body.data.core_values, ["Chính trực"]);
    // required fields carried over from the current approved version, not lost
    assert.deepEqual(res.body.data.products, ["p1"]);
  });
});

describe("POST /api/kad/agents/:id/import", () => {
  it("updates JD + skills from the downloaded template", async () => {
    const wb = buildTemplateWorkbook("jd-ky-nang");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await postMultipart(`/api/kad/agents/${agentId}/import`, buf);
    assert.equal(res.status, 200);
    assert.match(res.body.role_description, /# JD/);
    assert.deepEqual(res.body.skills, ["seo"]);
  });

  it("404s on an unknown agent id", async () => {
    const wb = buildTemplateWorkbook("jd-ky-nang");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await postMultipart("/api/kad/agents/ghost-agent/import", buf);
    assert.equal(res.status, 404);
  });
});
