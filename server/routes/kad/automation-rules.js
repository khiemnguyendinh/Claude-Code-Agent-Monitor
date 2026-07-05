/**
 * @file server/routes/kad/automation-rules.js — automation_rules CRUD-ish
 * (spec 03 §"Phụ thuộc, Tự động hoá & Lịch"). Create/read/toggle/pause only —
 * evaluating and firing rules is the Phase 6.5 worker, out of scope here.
 *
 * `GET/POST /automation/paused` is additive beyond spec 03's literal endpoint
 * list: the department-wide "Tạm dừng tất cả" kill switch (spec/ui/09 §3) is
 * a flag separate from each rule's own `enabled` bit (see repo/catalog.js),
 * so the client needs a way to read/write it independent of the rules list.
 */
const express = require("express");
const repo = require("../../lib/kad/repo");
const automation = require("../../lib/kad/automation");
const { emitDept } = require("../../lib/kad/events");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

function defaultDeptId() {
  const d = repo.catalog.getDepartmentBySlug("rd");
  return d ? d.id : null;
}

router.get("/automation-rules", (req, res) => {
  const department_id = req.query.department || defaultDeptId();
  const enabled = req.query.enabled === undefined ? undefined : req.query.enabled === "1";
  res.json(repo.automationRules.listRules({ department_id, enabled }));
});

router.post("/automation-rules", (req, res) => {
  const b = req.body || {};
  if (!b.name || typeof b.name !== "string") return err(res, "EBADNAME", "name is required");
  if (!["schedule", "event", "metric_threshold"].includes(b.trigger_type))
    return err(res, "EBADTRIGGER", "invalid trigger_type");
  if (!["create_task", "notify", "run_briefing", "pause_department"].includes(b.action_type))
    return err(res, "EBADACTION", "invalid action_type");
  const department_id = b.department_id || defaultDeptId();
  const rule = repo.automationRules.createRule({
    department_id,
    name: b.name,
    trigger_type: b.trigger_type,
    trigger_config: b.trigger_config,
    action_type: b.action_type,
    action_config: b.action_config,
    approval_required: b.approval_required,
    cooldown_seconds: b.cooldown_seconds,
    max_fires: b.max_fires,
    created_by: b.created_by,
  });
  res.status(201).json(rule);
});

router.post("/automation-rules/:id/toggle", (req, res) => {
  const rule = repo.automationRules.getRule(req.params.id);
  if (!rule) return err(res, "ENOTFOUND", "rule not found", 404);
  const enabled = Boolean((req.body || {}).enabled);
  const updated = repo.automationRules.setEnabled(rule.id, enabled);
  res.json(updated);
});

router.patch("/automation-rules/:id", (req, res) => {
  const rule = repo.automationRules.getRule(req.params.id);
  if (!rule) return err(res, "ENOTFOUND", "rule not found", 404);
  const b = req.body || {};
  if (b.status !== undefined && !["active", "paused", "archived"].includes(b.status))
    return err(res, "EBADSTATUS", "invalid status");
  const updated = repo.automationRules.updateRule(rule.id, {
    name: b.name,
    trigger_config: b.trigger_config,
    action_config: b.action_config,
    approval_required: b.approval_required,
    cooldown_seconds: b.cooldown_seconds,
    max_fires: b.max_fires,
    status: b.status,
  });
  res.json(updated);
});

// Chạy thử: "30 ngày qua luật này sẽ kích ở đâu" — KHÔNG tạo task (spec 03).
router.post("/automation-rules/:id/dry-run", (req, res) => {
  const rule = repo.automationRules.getRule(req.params.id);
  if (!rule) return err(res, "ENOTFOUND", "rule not found", 404);
  const days = Math.min(Math.max(Number((req.body || {}).days) || 30, 1), 365);
  res.json(automation.dryRun(rule, { days }));
});

// Lịch sử kích (automation_rule_fires).
router.get("/automation-rules/:id/fires", (req, res) => {
  const rule = repo.automationRules.getRule(req.params.id);
  if (!rule) return err(res, "ENOTFOUND", "rule not found", 404);
  res.json(repo.automationRules.listFires(rule.id));
});

router.get("/automation/paused", (req, res) => {
  const department_id = req.query.department || defaultDeptId();
  res.json({ paused: department_id ? repo.catalog.isAutomationPaused(department_id) : false });
});

router.post("/automation/pause-all", (req, res) => {
  const b = req.body || {};
  const department_id = b.department_id || defaultDeptId();
  if (!department_id) return err(res, "ENODEPT", "department not found", 404);
  const paused = Boolean(b.paused);
  repo.catalog.setAutomationPaused(department_id, paused);
  emitDept(department_id, "kad.automation.paused", { department_id, paused });
  res.json({ department_id, paused });
});

module.exports = router;
