/**
 * @file Regression coverage for Thư viện mẫu binary uploads (Phase 5 —
 * .docx/.pdf/.xlsx alongside the pre-existing .md path). Mirrors the
 * multipart harness in kad-xlsx-import.test.js.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-kad-templates-upload-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_DATA_DIR = path.join(
  os.tmpdir(),
  `dashboard-kad-templates-upload-data-${Date.now()}-${process.pid}`
);

const { createApp, startServer } = require("../index");
const { db } = require("../db");

let server;
let BASE;

function postMultipart(urlPath, fileBuffer, filename, contentType, extraFields = {}) {
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
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
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

function postJson(urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
      }
    );
    req.on("error", reject);
    req.write(payload);
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
        res.on("end", () =>
          resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), headers: res.headers })
        );
      })
      .on("error", reject);
  });
}

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
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
  try {
    fs.rmSync(process.env.DASHBOARD_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("POST /api/kad/templates/upload — binary formats", () => {
  it("uploads a .docx and the download round-trips byte-identical", async () => {
    const original = Buffer.from("PK\x03\x04 fake docx bytes for test purposes only");
    const res = await postMultipart(
      "/api/kad/templates/upload",
      original,
      "brief.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      { name: "Test DOCX", template_type: "custom" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.version.file_path != null, true);
    assert.match(res.body.version.mime_type, /wordprocessingml/);
    assert.equal(res.body.version.original_file_name, "brief.docx");

    const dl = await getBuffer(`/api/kad/templates/versions/${res.body.version.id}/download`);
    assert.equal(dl.status, 200);
    assert.ok(dl.buffer.equals(original), "downloaded bytes must match uploaded bytes exactly");
    assert.match(dl.headers["content-disposition"], /brief\.docx/);
  });

  it("uploads a .pdf and a .xlsx too", async () => {
    for (const [ext, mime] of [
      ["pdf", "application/pdf"],
      ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ]) {
      const res = await postMultipart(
        "/api/kad/templates/upload",
        Buffer.from(`fake ${ext} content`),
        `f.${ext}`,
        mime,
        { template_type: "custom" }
      );
      assert.equal(res.status, 200, `expected 200 for .${ext}`);
      assert.equal(res.body.version.original_file_name, `f.${ext}`);
    }
  });

  it("rejects an unsupported extension", async () => {
    const res = await postMultipart(
      "/api/kad/templates/upload",
      Buffer.from("x"),
      "virus.exe",
      "application/octet-stream"
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADTEMPLATE");
  });

  it("404s a download for an unknown version id", async () => {
    const res = await getBuffer("/api/kad/templates/versions/ghost-version/download");
    assert.equal(res.status, 404);
  });
});

describe("POST /api/kad/templates — .md JSON path unchanged (regression)", () => {
  it("still accepts a plain .md upload exactly as before", async () => {
    const res = await postJson("/api/kad/templates", {
      name: "Test MD",
      file_name: "test.md",
      template_type: "custom",
      content: "# Hello\nMarkdown content.",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.version.content, "# Hello\nMarkdown content.");
    assert.equal(res.body.version.file_path, null);
  });
});
