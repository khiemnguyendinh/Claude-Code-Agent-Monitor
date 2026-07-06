/**
 * @file kad-orchestrator-cwd.test.js
 * Regression test for resolveWorkingDir(): a task's working_dir must resolve to a
 * REAL, existing absolute directory before `claude` is spawned — otherwise the
 * spawn fails with `spawn claude ENOENT` and the agent never runs (the intake
 * defaults like "kstudy-rd/K3" are relative folders that don't exist yet).
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kad-cwd-test-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
const WS = path.join(TMP, "workspace");
process.env.KAD_WORKSPACE_ROOT = WS;

let resolveWorkingDir;
before(() => {
  ({ resolveWorkingDir } = require("../lib/kad/orchestrator"));
});

describe("resolveWorkingDir", () => {
  it("resolves a relative intake dir under the workspace root and creates it", () => {
    const dir = resolveWorkingDir("kstudy-rd/K3");
    assert.equal(dir, path.join(WS, "kstudy-rd", "K3"));
    assert.ok(fs.existsSync(dir), "dir must exist after resolve (no ENOENT on spawn)");
  });

  it("falls back to a default dir under root for empty/undefined working_dir", () => {
    for (const input of ["", null, undefined]) {
      const dir = resolveWorkingDir(input);
      assert.ok(dir.startsWith(WS), `"${input}" must stay under the workspace root`);
      assert.ok(fs.existsSync(dir));
    }
  });

  it("honors an absolute working_dir and creates it", () => {
    const abs = path.join(TMP, "explicit-abs", "nested");
    const dir = resolveWorkingDir(abs);
    assert.equal(dir, abs);
    assert.ok(fs.existsSync(dir));
  });

  it("contains a `..` escape inside the workspace root", () => {
    const dir = resolveWorkingDir("../../../etc/passwd");
    assert.ok(
      dir === WS || dir.startsWith(WS + path.sep),
      `escape attempt must stay under root, got ${dir}`
    );
    assert.ok(!dir.includes(`${path.sep}etc${path.sep}`));
    assert.ok(fs.existsSync(dir));
  });
});
