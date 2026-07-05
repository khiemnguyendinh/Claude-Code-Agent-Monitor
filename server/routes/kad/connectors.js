/**
 * @file server/routes/kad/connectors.js — Connector hub API (Phase 6).
 */
const express = require("express");
const repo = require("../../lib/kad/repo");
const connectorService = require("../../lib/kad/connectors");
const v = require("../../lib/kad/validate");

const router = express.Router();

function err(res, code, message, status = 400, details) {
  return res.status(status).json({ error: { code, message, details } });
}

function sendConnectorError(res, e) {
  return err(
    res,
    e.code || "ECONNECTOR",
    e.message || "connector error",
    e.status || 400,
    e.details
  );
}

function deptId(req) {
  if (req.query.department || req.body?.department_id) return req.query.department || req.body.department_id;
  const d = repo.catalog.getDepartmentBySlug("rd");
  return d ? d.id : null;
}

router.get("/connectors", (req, res) => {
  res.json(
    repo.connectors.listConnectors({
      department_id: deptId(req),
      connector_type: req.query.type,
    })
  );
});

router.post("/connectors", (req, res) => {
  const verr = v.firstError(
    v.checkEnum(req.body && req.body.connector_type, "connector_type", ["facebook_page", "wordpress"], {
      required: true,
    }),
    v.checkString(req.body && req.body.name, "name", { required: true, maxLen: 200 }),
    v.checkObject(req.body && req.body.config, "config")
  );
  if (verr) return err(res, verr.code, verr.message);
  try {
    const connector = connectorService.createConnector({
      department_id: deptId(req),
      connector_type: req.body && req.body.connector_type,
      name: req.body && req.body.name,
      config: req.body && req.body.config,
    });
    res.status(201).json(connector);
  } catch (e) {
    sendConnectorError(res, e);
  }
});

router.post("/connectors/:id/health-check", async (req, res) => {
  try {
    res.json(await connectorService.healthCheck(req.params.id));
  } catch (e) {
    sendConnectorError(res, e);
  }
});

router.get("/connector-actions", (req, res) => {
  res.json(
    connectorService.listActions({
      task_id: req.query.task,
      connector_id: req.query.connector,
      status: req.query.status,
      limit: req.query.limit,
    })
  );
});

router.post("/connector-actions/:id/execute", async (req, res) => {
  try {
    const action = await connectorService.executeAction(req.params.id, {
      actor_type: "human",
      actor_id: "human",
      manual_external_url: req.body && req.body.manual_external_url,
    });
    res.json({ action });
  } catch (e) {
    sendConnectorError(res, e);
  }
});

module.exports = router;
