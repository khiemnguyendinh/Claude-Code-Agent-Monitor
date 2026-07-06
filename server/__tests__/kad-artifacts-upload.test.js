/**
 * @file Regression coverage for /hoc-lieu upload (Phase 6 — loose files and
 * folder uploads via /api/kad/artifacts/upload). Mirrors the multipart
 * harness in kad-templates-upload.test.js.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-kad-artifacts-upload-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;
const TEST_DATA_DIR = path.join(
  os.tmpdir(),
  `dashboard-kad-artifacts-upload-data-${Date.now()}-${process.pid}`
);
process.env.DASHBOARD_DATA_DIR = TEST_DATA_DIR;

const { createApp, startServer } = require("../index");
const { db } = require("../db");

let server;
let BASE;

function postMultipart(urlPath, files, relativePaths) {
  return new Promise((resolve, reject) => {
    const boundary = `----kadtest${Date.now()}`;
    const url = new URL(urlPath, BASE);
    const parts = [];
    if (relativePaths !== undefined) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="relative_paths"\r\n\r\n${JSON.stringify(relativePaths)}\r\n`
        )
      );
    }
    for (const f of files) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`
        )
      );
      parts.push(f.buffer);
      parts.push(Buffer.from("\r\n"));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
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
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("POST /api/kad/artifacts/upload — loose files", () => {
  it("uploads 2 loose files, each becomes its own artifact", async () => {
    const res = await postMultipart("/api/kad/artifacts/upload", [
      { name: "a.txt", type: "text/plain", buffer: Buffer.from("content A") },
      { name: "b.txt", type: "text/plain", buffer: Buffer.from("content B") },
    ]);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    assert.equal(res.body[0].artifact_type, "other");
    assert.equal(res.body[0].agent_id, null);
    assert.equal(res.body[0].status, "published");
    assert.equal(res.body[0].metadata.source, "uploaded");
    assert.equal(res.body[0].metadata.original_name, "a.txt");
  });

  it("400s when no files are attached", async () => {
    const res = await postMultipart("/api/kad/artifacts/upload", []);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "ENOFILE");
  });
});

describe("POST /api/kad/artifacts/upload — folder (relative_paths preserved)", () => {
  it("preserves nested folder structure per file and on disk", async () => {
    const res = await postMultipart(
      "/api/kad/artifacts/upload",
      [
        { name: "file1.txt", type: "text/plain", buffer: Buffer.from("f1") },
        { name: "file2.txt", type: "text/plain", buffer: Buffer.from("f2") },
      ],
      ["MyFolder/sub/file1.txt", "MyFolder/file2.txt"]
    );
    assert.equal(res.status, 200);
    assert.equal(res.body[0].metadata.relative_path, path.join("MyFolder", "sub", "file1.txt"));
    assert.equal(res.body[1].metadata.relative_path, path.join("MyFolder", "file2.txt"));
    assert.ok(fs.existsSync(res.body[0].file_path));
    assert.equal(fs.readFileSync(res.body[0].file_path, "utf8"), "f1");
  });

  it("sanitizes a path-traversal relative_path — file lands inside the batch dir, not outside", async () => {
    const res = await postMultipart(
      "/api/kad/artifacts/upload",
      [{ name: "evil.txt", type: "text/plain", buffer: Buffer.from("evil") }],
      ["../../../etc/evil.txt"]
    );
    assert.equal(res.status, 200);
    const created = res.body[0];
    assert.ok(created.file_path.startsWith(TEST_DATA_DIR), "must stay inside the data dir");
    assert.ok(!created.file_path.includes(".."), "traversal segments must be stripped");
  });
});

describe("GET /api/kad/artifacts/:id/download", () => {
  it("round-trips byte-identical and sets the original filename", async () => {
    const original = Buffer.from("round trip me");
    const upload = await postMultipart("/api/kad/artifacts/upload", [
      { name: "roundtrip.bin", type: "application/octet-stream", buffer: original },
    ]);
    const dl = await getBuffer(`/api/kad/artifacts/${upload.body[0].id}/download`);
    assert.equal(dl.status, 200);
    assert.ok(dl.buffer.equals(original));
    assert.match(dl.headers["content-disposition"], /roundtrip\.bin/);
  });

  it("404s for an artifact with no file (e.g. agent-generated markdown)", async () => {
    const now = new Date().toISOString();
    const id = "artifact-no-file-test";
    db.prepare(
      `INSERT INTO artifacts (id, artifact_type, title, content, status, version, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, "other", "No file here", "just markdown", "draft", 1, now, now);
    const res = await getBuffer(`/api/kad/artifacts/${id}/download`);
    assert.equal(res.status, 404);
  });

  it("404s for an unknown artifact id", async () => {
    const res = await getBuffer("/api/kad/artifacts/ghost/download");
    assert.equal(res.status, 404);
  });
});
