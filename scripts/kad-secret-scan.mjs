#!/usr/bin/env node
/**
 * scripts/kad-secret-scan.mjs — Phase 7 hardening: assert no secret-shaped
 * value has leaked into the KAD-owned SQLite tables or the transcript
 * snapshots this dashboard persists. Spec 02 explicitly requires
 * `connectors.config` to hold only non-secret fields (page_id, site_url —
 * "SECRETS Ở KEYCHAIN/ENV") — this script is the check that invariant holds,
 * plus a general sweep of free-text columns an agent or human could have
 * pasted a real credential into.
 *
 * Usage:
 *   node scripts/kad-secret-scan.mjs                 Scan the live DB + transcripts
 *   node scripts/kad-secret-scan.mjs --db-path <p>    Scan a specific DB file
 *   node scripts/kad-secret-scan.mjs --skip-transcripts
 *   node scripts/kad-secret-scan.mjs --json           Machine-readable output
 *
 * Exit code 0 = clean, 1 = findings (or DB unreadable), matching the rest of
 * scripts/*.js's convention.
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const SKIP_TRANSCRIPTS = args.has("--skip-transcripts");
const dbPathFlagIndex = process.argv.indexOf("--db-path");
const DB_PATH_OVERRIDE = dbPathFlagIndex >= 0 ? process.argv[dbPathFlagIndex + 1] : undefined;

const { getDataDir, getTranscriptSnapshotDir } = require("../server/lib/claude-home");

// Same secret-shaped patterns a static source-code scanner would use, applied
// here to *runtime data* instead of source files. Named so findings are
// actionable ("aws_access_key" beats a bare regex index).
const PATTERNS = [
  { name: "aws_access_key", re: /AKIA[0-9A-Z]{16}/g },
  { name: "private_key_block", re: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: "github_token", re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "slack_token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "stripe_key", re: /sk_(live|test)_[A-Za-z0-9]{16,}/g },
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    name: "generic_secret_assignment",
    re: /(api[_-]?key|apikey|secret|access[_-]?token|client[_-]?secret|password|passwd)["']?\s*[:=]\s*["']([A-Za-z0-9_\-/+]{16,})["']/gi,
  },
];

function redact(value) {
  const s = String(value);
  if (s.length <= 10) return "***";
  return `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;
}

function findSecrets(text) {
  if (typeof text !== "string" || text.length < 10) return [];
  const hits = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      hits.push({ pattern: name, snippet: redact(m[0]) });
      if (hits.length > 20) break; // one very noisy blob shouldn't blow up the report
    }
  }
  return hits;
}

/** Walk a JSON value collecting every string leaf, so secrets hidden inside a
 * JSON column (trigger_config, artifact.metadata, ...) are still caught. */
function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

function scanCell(rawValue) {
  if (rawValue === null || rawValue === undefined) return [];
  let strings = [String(rawValue)];
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === "object") strings = collectStrings(parsed);
  } catch {
    /* not JSON — scan as plain text */
  }
  return strings.flatMap(findSecrets);
}

// Tables/columns most likely to carry a pasted credential. connectors.config
// is the one spec 02 explicitly calls out as non-secret-only.
const TARGETS = [
  { table: "connectors", idCol: "id", columns: ["config"] },
  { table: "task_messages", idCol: "id", columns: ["content", "metadata"] },
  { table: "artifacts", idCol: "id", columns: ["content", "metadata"] },
  { table: "audit_log", idCol: "id", columns: ["details"] },
  { table: "automation_rules", idCol: "id", columns: ["trigger_config", "action_config"] },
  { table: "organization_context_versions", idCol: "id", columns: ["data"] },
  { table: "department_blueprints", idCol: "id", columns: ["data"] },
  { table: "notifications", idCol: "id", columns: ["body"] },
];

function scanDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return { skipped: true, reason: `no database at ${dbPath}`, findings: [] };
  }
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    Database = require("../server/compat-sqlite");
  }
  const db = new Database(dbPath, { readonly: true });
  const findings = [];
  try {
    const existingTables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    );
    for (const target of TARGETS) {
      if (!existingTables.has(target.table)) continue; // migration not applied yet — nothing to scan
      const rows = db.prepare(`SELECT * FROM ${target.table}`).all();
      for (const row of rows) {
        for (const col of target.columns) {
          for (const hit of scanCell(row[col])) {
            findings.push({ table: target.table, column: col, row_id: row[target.idCol], ...hit });
          }
        }
      }
    }
  } finally {
    db.close();
  }
  return { skipped: false, findings };
}

/** Transcript JSONL snapshots (see claude-home.js) can carry a pasted secret
 * inside a tool_use/tool_result blob (e.g. `cat .env` output). Scanned as
 * plain text per line — these files are JSONL, not one JSON document. */
function scanTranscripts() {
  const dir = getTranscriptSnapshotDir();
  if (!fs.existsSync(dir)) return { skipped: true, reason: `no transcript dir at ${dir}`, findings: [] };
  const findings = [];
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".jsonl"));
  for (const rel of files) {
    const full = path.join(dir, rel);
    let content;
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const hit of findSecrets(lines[i])) {
        findings.push({ file: rel, line: i + 1, ...hit });
      }
    }
  }
  return { skipped: false, findings };
}

function main() {
  const DB_PATH = DB_PATH_OVERRIDE || process.env.DASHBOARD_DB_PATH || path.join(getDataDir(), "dashboard.db");
  const dbResult = scanDatabase(DB_PATH);
  const transcriptResult = SKIP_TRANSCRIPTS
    ? { skipped: true, reason: "--skip-transcripts", findings: [] }
    : scanTranscripts();

  const allFindings = [...dbResult.findings, ...transcriptResult.findings];

  if (JSON_OUT) {
    console.log(JSON.stringify({ db: dbResult, transcripts: transcriptResult }, null, 2));
  } else {
    console.log(`DB scanned: ${DB_PATH}${dbResult.skipped ? ` (skipped: ${dbResult.reason})` : ""}`);
    console.log(
      `Transcripts scanned: ${getTranscriptSnapshotDir()}${
        transcriptResult.skipped ? ` (skipped: ${transcriptResult.reason})` : ""
      }`
    );
    if (allFindings.length === 0) {
      console.log("\n✅ No secret-shaped values found.");
    } else {
      console.log(`\n❌ ${allFindings.length} potential secret(s) found:\n`);
      for (const f of allFindings) {
        const loc = f.table ? `${f.table}.${f.column}#${f.row_id}` : `${f.file}:${f.line}`;
        console.log(`  ${loc} — ${f.pattern}: ${f.snippet}`);
      }
    }
  }

  process.exit(allFindings.length > 0 ? 1 : 0);
}

main();
