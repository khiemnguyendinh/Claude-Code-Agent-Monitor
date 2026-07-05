/**
 * @file server/routes/kad/index.js — KAD router barrel + init.
 * Mounts all /api/kad/* sub-routers. initKad() runs the migration (via repo load),
 * points the orchestrator at the API base for MCP callbacks, and starts the
 * durable job worker (which enqueues reconcile_runs for crash recovery).
 */
const express = require("express");
const tasksRouter = require("./tasks");
const approvalsRouter = require("./approvals");
const artifactsRouter = require("./artifacts");
const miscRouter = require("./misc");
const internalRouter = require("./internal");
const dependenciesRouter = require("./dependencies");
const automationRulesRouter = require("./automation-rules");
const attachmentsRouter = require("./attachments");
const knowledgeRouter = require("./knowledge");
const learningRouter = require("./learning");

const router = express.Router();
router.use("/tasks", tasksRouter);
router.use("/approvals", approvalsRouter);
router.use("/internal", internalRouter);
router.use("/", artifactsRouter); // /artifacts, /runs
router.use("/", knowledgeRouter); // /org-context, /templates, /wizard, /blueprints, /org-chart
router.use("/", miscRouter); // /agents, /reports, /notifications, /audit
router.use("/", dependenciesRouter); // /dependencies/:depId
router.use("/", automationRulesRouter); // /automation-rules, /automation/*
router.use("/", attachmentsRouter); // /attachments/:id
router.use("/learning-notes", learningRouter);

let started = false;

/**
 * Initialize KAD runtime. Call once after the HTTP server is listening.
 * @param {{apiBase?:string}} [opts]
 */
function initKad(opts = {}) {
  if (started) return;
  started = true;
  // repo load already applied migrations (idempotent).
  require("../../lib/kad/repo");
  const orchestrator = require("../../lib/kad/orchestrator");
  if (opts.apiBase) orchestrator.setApiBase(opts.apiBase);
  const worker = require("../../lib/kad/job-queue");
  worker.startWorker();
}

module.exports = { router, initKad };
