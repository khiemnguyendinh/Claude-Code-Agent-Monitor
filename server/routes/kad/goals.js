/**
 * @file server/routes/kad/goals.js — "Mục tiêu & chiến lược"
 * (client/src/kad/pages/MucTieuChienLuoc.tsx). Direct write, no approval gate
 * by design (see repo/strategic-goals.js header). Mounted at /api/kad.
 */
const express = require("express");
const repo = require("../../lib/kad/repo");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

router.get("/goals", (req, res) => {
  const goals = repo.strategicGoals.listGoals(req.query.org_id);
  const strategy = repo.strategicGoals.getStrategy(req.query.org_id);
  res.json({ goals, ...strategy });
});

router.put("/goals", (req, res) => {
  try {
    const { goals, strategy_markdown, org_id, actor_id } = req.body || {};
    const savedGoals = repo.strategicGoals.replaceGoals(org_id, goals, { actor_id });
    const strategy =
      strategy_markdown !== undefined
        ? repo.strategicGoals.saveStrategy(org_id, strategy_markdown, { actor_id })
        : repo.strategicGoals.getStrategy(org_id);
    res.json({ goals: savedGoals, ...strategy });
  } catch (e) {
    err(res, "EBADGOALS", e instanceof Error ? e.message : "could not save goals", 400);
  }
});

module.exports = router;
