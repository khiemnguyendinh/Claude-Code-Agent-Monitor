/**
 * @file server/routes/kad/okr.js — "Đội ngũ ▸ Mục tiêu" MANUAL objectives +
 * key_results tree (repo/okr.js). Mounted at /api/kad/okr. The tab's other
 * panel — KPIs — is COMPUTED and lives at GET /api/kad/reports/kpis
 * (misc.js), not here.
 */
const express = require("express");
const repo = require("../../lib/kad/repo");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

function deptId(req) {
  if (req.query.department) return req.query.department;
  const d = repo.catalog.getDepartmentBySlug("rd");
  return d ? d.id : null;
}

// GET /api/kad/okr/objectives?department=&level= — ObjectiveRow[] (nested key_results).
router.get("/objectives", (req, res) => {
  res.json(
    repo.okr.listObjectives({
      department_id: req.query.department || undefined,
      level: req.query.level || undefined,
    })
  );
});

// POST /api/kad/okr/objectives — create an objective (manual, no approval gate,
// same "human enters this straight" pattern as strategic-goals.js).
router.post("/objectives", (req, res) => {
  try {
    const body = req.body || {};
    const department_id = body.department_id || deptId(req);
    const objective = repo.okr.createObjective({
      department_id,
      level: body.level,
      cycle: body.cycle,
      period: body.period,
      title: body.title,
      owner_id: body.owner_id,
      parent_objective_id: body.parent_objective_id,
    });
    res.status(201).json(objective);
  } catch (e) {
    err(res, "EBADOBJECTIVE", e instanceof Error ? e.message : "could not create objective", 400);
  }
});

// PUT /api/kad/okr/objectives/:id — patch title/period/owner_id/confidence/parent.
router.put("/objectives/:id", (req, res) => {
  try {
    const objective = repo.okr.updateObjective(req.params.id, req.body || {});
    if (!objective) return err(res, "ENOTFOUND", "objective not found", 404);
    res.json(objective);
  } catch (e) {
    err(res, "EBADOBJECTIVE", e instanceof Error ? e.message : "could not update objective", 400);
  }
});

// POST /api/kad/okr/objectives/:id/key-results — add a KR under an objective.
router.post("/objectives/:id/key-results", (req, res) => {
  try {
    const body = req.body || {};
    const keyResult = repo.okr.createKeyResult({
      objective_id: req.params.id,
      title: body.title,
      metric: body.metric,
      current_value: body.current_value,
      target_value: body.target_value,
      unit: body.unit,
      direction: body.direction,
      owner_id: body.owner_id,
    });
    if (!keyResult) return err(res, "ENOTFOUND", "objective not found", 404);
    res.status(201).json(keyResult);
  } catch (e) {
    err(res, "EBADKEYRESULT", e instanceof Error ? e.message : "could not create key result", 400);
  }
});

// PUT /api/kad/key-results/:id — update current_value/target_value/etc (health recomputed).
router.put("/key-results/:id", (req, res) => {
  try {
    const keyResult = repo.okr.updateKeyResult(req.params.id, req.body || {});
    if (!keyResult) return err(res, "ENOTFOUND", "key result not found", 404);
    res.json(keyResult);
  } catch (e) {
    err(res, "EBADKEYRESULT", e instanceof Error ? e.message : "could not update key result", 400);
  }
});

module.exports = router;
