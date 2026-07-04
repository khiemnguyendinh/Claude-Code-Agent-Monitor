/**
 * @file server/lib/kad/ids.js — id + timestamp helpers for KAD.
 */
const { randomUUID } = require("node:crypto");

/** Prefixed UUID so ids are self-describing in logs/DB (e.g. task_1a2b...). */
function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

/** ISO8601 UTC timestamp — matches monitor's TEXT timestamp convention. */
function nowIso() {
  return new Date().toISOString();
}

module.exports = { newId, nowIso };
