/**
 * @file server/lib/kad/workspace-root.js — resolves `tasks.working_dir`
 * (a short, user-facing string like "kstudy-rd/K3") to a real absolute
 * directory on disk, for real attachment uploads (spec 07 §1).
 *
 * KAD is explicitly a single-user, local-first tool (plan.md §1: "MVP: 1
 * trưởng phòng, local-first") — not a multi-tenant service — so a hardcoded
 * default tied to this machine's actual layout is a reasonable, honest
 * default rather than premature generalization. `KAD_WORKSPACE_ROOT` exists
 * for anyone running this on a different layout.
 *
 * Resolution order:
 *   1. `KAD_WORKSPACE_ROOT` env var, if set.
 *   2. The real `kstudy-rd` content repo, sibling to this repo under
 *      "AI Agent Workspace" (scripts/kad-seed.mjs seeds from the same repo —
 *      `working_dir` values like "kstudy-rd/K3" are meant to live there).
 *   3. A safe fallback under the dashboard's own data dir (never errors, but
 *      won't line up with the real kstudy-rd repo if the layout differs).
 */
const path = require("node:path");
const fs = require("node:fs");
const { getDataDir } = require("../claude-home");

let cachedRoot = null;

function resolveWorkspaceRoot() {
  if (cachedRoot) return cachedRoot;
  if (process.env.KAD_WORKSPACE_ROOT) {
    cachedRoot = path.resolve(process.env.KAD_WORKSPACE_ROOT);
    return cachedRoot;
  }
  const sibling = path.resolve(__dirname, "..", "..", "..", "..", "kstudy-rd");
  cachedRoot = fs.existsSync(sibling) ? sibling : path.join(getDataDir(), "kad-uploads");
  return cachedRoot;
}

/** Reset the memoized root — tests only (env var changes mid-process). */
function _resetWorkspaceRootCache() {
  cachedRoot = null;
}

/**
 * Resolve a task's `working_dir` to a real absolute directory INSIDE the
 * workspace root, creating it if needed. Throws if the value would escape
 * the root (e.g. "../../etc") — `working_dir` reaches here from request
 * bodies, so it must be treated as untrusted input regardless of what the
 * current UI's dropdown happens to restrict itself to. Also throws for a
 * value that resolves to the root itself (missing/"."/"/"/only slashes) —
 * silently falling back to the root would dump every such task's uploads
 * loose into it (mixed with the real kstudy-rd repo or the data-dir
 * fallback), defeating the whole point of a per-task directory. Callers
 * that may legitimately have no working_dir (e.g. attachments-upload.js)
 * must pass their own non-empty per-task fallback instead of relying on
 * this function to invent one.
 */
function resolveTaskDir(workingDir) {
  const root = resolveWorkspaceRoot();
  const rel = String(workingDir || "").replace(/^[/\\]+/, "");
  if (rel === "" || rel === ".") {
    throw new Error(
      "working_dir must resolve to a subdirectory of the workspace root, not the root itself"
    );
  }
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("working_dir resolves outside the workspace root");
  }
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

module.exports = { resolveWorkspaceRoot, resolveTaskDir, _resetWorkspaceRootCache };
