/**
 * @file server/routes/kad/artifacts.js — Artifacts + Runs read (spec 03).
 * Mounted at /api/kad — exposes /artifacts and /runs.
 */
const express = require("express");
const repo = require("../../lib/kad/repo");

const router = express.Router();
const err = (res, code, message, status = 400) => res.status(status).json({ error: { code, message } });

router.get("/artifacts", (req, res) => {
  res.json(repo.artifacts.listArtifacts({ task_id: req.query.task, type: req.query.type, status: req.query.status }));
});

router.get("/artifacts/:id", (req, res) => {
  const a = repo.artifacts.getArtifact(req.params.id);
  if (!a) return err(res, "ENOTFOUND", "artifact not found", 404);
  res.json(a);
});

router.get("/runs/:id", (req, res) => {
  const r = repo.runs.getRun(req.params.id);
  if (!r) return err(res, "ENOTFOUND", "run not found", 404);
  // engine_session_id bridges to the monitor's session trace.
  res.json({ ...r, monitor_session_id: r.engine_session_id });
});

module.exports = router;
