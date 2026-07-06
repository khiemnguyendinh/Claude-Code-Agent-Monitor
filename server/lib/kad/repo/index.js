/**
 * @file server/lib/kad/repo/index.js — repository barrel. Import { repo } and
 * reach each aggregate as a namespace: repo.tasks, repo.runs, repo.approvals,...
 * All KAD DB access goes through here (spec 03 §3 — no SQL in route handlers).
 */
const base = require("./db");

module.exports = {
  db: base.db,
  tx: base.tx,
  audit: base.audit,
  listAudit: base.listAudit,
  parseJson: base.parseJson,
  newId: base.newId,
  nowIso: base.nowIso,
  tasks: require("./tasks"),
  runs: require("./runs"),
  delegations: require("./delegations"),
  approvals: require("./approvals"),
  artifacts: require("./artifacts"),
  notifications: require("./notifications"),
  learning: require("./learning"),
  jobs: require("./jobs"),
  catalog: require("./catalog"),
  standup: require("./standup"),
  dependencies: require("./task-dependencies"),
  automationRules: require("./automation-rules"),
  attachments: require("./task-attachments"),
  orgContext: require("./org-context"),
  templates: require("./templates"),
  personnel: require("./personnel"),
  strategicGoals: require("./strategic-goals"),
  reports: require("./reports"),
};
