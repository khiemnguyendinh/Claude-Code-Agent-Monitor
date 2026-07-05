/**
 * @file server/lib/kad/repo/connectors.js — KAD connector records + action queue.
 * Stores only non-secret config. Secret material stays in env/keychain pointers.
 */
const { db, parseJson, newId, nowIso } = require("./db");

function hydrateConnector(row) {
  return row
    ? {
        ...row,
        config: parseJson(row.config, {}),
        capabilities: parseJson(row.capabilities, []),
      }
    : null;
}

function hydrateAction(row) {
  return row
    ? {
        ...row,
        content: parseJson(row.content, null),
        result: parseJson(row.result, null),
      }
    : null;
}

function createConnector({
  department_id,
  connector_type,
  name,
  config,
  auth_status,
  capabilities,
  risk_level,
  status,
}) {
  const id = newId("conn");
  const now = nowIso();
  db.prepare(
    `INSERT INTO connectors
     (id,department_id,connector_type,name,config,auth_status,capabilities,risk_level,last_health_check,status,created_at,updated_at)
     VALUES (@id,@department_id,@connector_type,@name,@config,@auth_status,@capabilities,@risk_level,NULL,@status,@now,@now)`
  ).run({
    id,
    department_id: department_id ?? null,
    connector_type,
    name,
    config: JSON.stringify(config || {}),
    auth_status: auth_status || "not_configured",
    capabilities: JSON.stringify(capabilities || []),
    risk_level: risk_level || "medium",
    status: status || "active",
    now,
  });
  return getConnector(id);
}

function getConnector(id) {
  return hydrateConnector(db.prepare("SELECT * FROM connectors WHERE id=?").get(id));
}

function findActiveByType(department_id, connector_type) {
  const row = department_id
    ? db
        .prepare(
          `SELECT * FROM connectors
           WHERE department_id=? AND connector_type=? AND status='active'
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(department_id, connector_type)
    : db
        .prepare(
          `SELECT * FROM connectors
           WHERE connector_type=? AND status='active'
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(connector_type);
  return hydrateConnector(row);
}

function listConnectors({ department_id, connector_type } = {}) {
  const where = [];
  const args = [];
  if (department_id) (where.push("department_id=?"), args.push(department_id));
  if (connector_type) (where.push("connector_type=?"), args.push(connector_type));
  const sql =
    "SELECT * FROM connectors" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY connector_type ASC, created_at DESC";
  return db.prepare(sql).all(...args).map(hydrateConnector);
}

function updateConnector(id, fields) {
  const sets = [];
  const p = { id, now: nowIso() };
  if (fields.name !== undefined) (sets.push("name=@name"), (p.name = fields.name));
  if (fields.config !== undefined)
    (sets.push("config=@config"), (p.config = JSON.stringify(fields.config || {})));
  if (fields.auth_status !== undefined)
    (sets.push("auth_status=@auth_status"), (p.auth_status = fields.auth_status));
  if (fields.capabilities !== undefined)
    (sets.push("capabilities=@capabilities"),
    (p.capabilities = JSON.stringify(fields.capabilities || [])));
  if (fields.risk_level !== undefined)
    (sets.push("risk_level=@risk_level"), (p.risk_level = fields.risk_level));
  if (fields.last_health_check !== undefined)
    (sets.push("last_health_check=@last_health_check"),
    (p.last_health_check = fields.last_health_check));
  if (fields.status !== undefined) (sets.push("status=@status"), (p.status = fields.status));
  if (!sets.length) return getConnector(id);
  sets.push("updated_at=@now");
  db.prepare(`UPDATE connectors SET ${sets.join(", ")} WHERE id=@id`).run(p);
  return getConnector(id);
}

function createAction({
  connector_id,
  task_id,
  approval_id,
  action_type,
  content,
  result,
  status,
  external_id,
  external_url,
  executed_at,
}) {
  const id = newId("connact");
  db.prepare(
    `INSERT INTO connector_actions
     (id,connector_id,task_id,approval_id,action_type,content,result,status,external_id,external_url,executed_at,created_at)
     VALUES (@id,@connector_id,@task_id,@approval_id,@action_type,@content,@result,@status,@external_id,@external_url,@executed_at,@created_at)`
  ).run({
    id,
    connector_id,
    task_id: task_id ?? null,
    approval_id: approval_id ?? null,
    action_type,
    content: content != null ? JSON.stringify(content) : null,
    result: result != null ? JSON.stringify(result) : null,
    status: status || "pending",
    external_id: external_id ?? null,
    external_url: external_url ?? null,
    executed_at: executed_at ?? null,
    created_at: nowIso(),
  });
  return getAction(id);
}

function getAction(id) {
  return hydrateAction(db.prepare("SELECT * FROM connector_actions WHERE id=?").get(id));
}

function getActionByApproval(approval_id) {
  return hydrateAction(
    db
      .prepare(
        `SELECT * FROM connector_actions
         WHERE approval_id=? AND action_type IN ('publish','schedule')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(approval_id)
  );
}

function listActions({ task_id, connector_id, status, limit = 100 } = {}) {
  const where = [];
  const args = [];
  if (task_id) (where.push("task_id=?"), args.push(task_id));
  if (connector_id) (where.push("connector_id=?"), args.push(connector_id));
  if (status) (where.push("status=?"), args.push(status));
  args.push(Math.min(Number(limit) || 100, 500));
  const sql =
    "SELECT * FROM connector_actions" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY created_at DESC LIMIT ?";
  return db.prepare(sql).all(...args).map(hydrateAction);
}

function updateAction(id, fields) {
  const sets = [];
  const p = { id };
  if (fields.approval_id !== undefined)
    (sets.push("approval_id=@approval_id"), (p.approval_id = fields.approval_id));
  if (fields.content !== undefined)
    (sets.push("content=@content"),
    (p.content = fields.content != null ? JSON.stringify(fields.content) : null));
  if (fields.result !== undefined)
    (sets.push("result=@result"),
    (p.result = fields.result != null ? JSON.stringify(fields.result) : null));
  if (fields.status !== undefined) (sets.push("status=@status"), (p.status = fields.status));
  if (fields.external_id !== undefined)
    (sets.push("external_id=@external_id"), (p.external_id = fields.external_id));
  if (fields.external_url !== undefined)
    (sets.push("external_url=@external_url"), (p.external_url = fields.external_url));
  if (fields.executed_at !== undefined)
    (sets.push("executed_at=@executed_at"), (p.executed_at = fields.executed_at));
  if (!sets.length) return getAction(id);
  db.prepare(`UPDATE connector_actions SET ${sets.join(", ")} WHERE id=@id`).run(p);
  return getAction(id);
}

module.exports = {
  createConnector,
  getConnector,
  findActiveByType,
  listConnectors,
  updateConnector,
  createAction,
  getAction,
  getActionByApproval,
  listActions,
  updateAction,
};
