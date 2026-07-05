/**
 * @file server/lib/kad/connectors.js — Phase 6 connector workflow.
 * Enforces draft → preview → approval → publish/schedule with no raw secrets
 * persisted in SQLite or returned to agents/routes.
 */
const repo = require("./repo");

const CONNECTOR_TYPES = new Set(["wordpress", "facebook_page"]);
const COOLDOWN_MS = 5 * 60 * 1000;
const WP_DEFAULTS = {
  siteUrlEnv: "KAD_WORDPRESS_URL",
  usernameEnv: "KAD_WORDPRESS_USERNAME",
  appPasswordEnv: "KAD_WORDPRESS_APP_PASSWORD",
};

class ConnectorError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 400, details) {
  throw new ConnectorError(code, message, status, details);
}

function normalizeType(type) {
  return type === "facebook" ? "facebook_page" : type;
}

function assertConnectorType(type) {
  if (!CONNECTOR_TYPES.has(type)) {
    fail("EBADCONNECTOR", "connector_type must be wordpress|facebook_page", 400);
  }
}

function assertEnvName(value, field) {
  if (value == null || value === "") return undefined;
  const s = String(value).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(s)) {
    fail("EBADCONFIG", `${field} must be an env var name`, 400);
  }
  return s;
}

function assertNoRawSecrets(config) {
  const blocked = new Set([
    "password",
    "app_password",
    "token",
    "access_token",
    "secret",
    "api_key",
    "authorization",
    "cookie",
  ]);
  for (const key of Object.keys(config || {})) {
    if (blocked.has(key.toLowerCase())) {
      fail("ESECRET_CONFIG", `${key} must be stored in env/keychain, not connector config`, 400);
    }
  }
}

function sanitizeConfig(connectorType, input = {}) {
  const config = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  assertNoRawSecrets(config);
  if (connectorType === "wordpress") {
    const out = {
      site_url: config.site_url ? String(config.site_url).trim().replace(/\/+$/, "") : undefined,
      site_url_env: assertEnvName(config.site_url_env || WP_DEFAULTS.siteUrlEnv, "site_url_env"),
      username_env: assertEnvName(config.username_env || WP_DEFAULTS.usernameEnv, "username_env"),
      app_password_env: assertEnvName(
        config.app_password_env || WP_DEFAULTS.appPasswordEnv,
        "app_password_env"
      ),
    };
    const url = out.site_url || process.env[out.site_url_env];
    if (url) assertHttps(url);
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && v !== ""));
  }
  return {
    page_name: config.page_name ? String(config.page_name).trim() : "Facebook Page",
    page_url: config.page_url ? String(config.page_url).trim() : undefined,
    mode: "manual_handoff",
  };
}

function assertHttps(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("EBADURL", "WordPress site URL must be a valid HTTPS URL", 400);
  }
  if (url.protocol !== "https:") {
    fail("EHTTPS_REQUIRED", "WordPress connector requires HTTPS", 400);
  }
  return url;
}

function resolveWordPressAuth(connector) {
  const cfg = connector.config || {};
  const siteUrlEnv = cfg.site_url_env || WP_DEFAULTS.siteUrlEnv;
  const siteUrl = (cfg.site_url || process.env[siteUrlEnv] || "")
    .trim()
    .replace(/\/+$/, "");
  const usernameEnv = cfg.username_env || WP_DEFAULTS.usernameEnv;
  const passwordEnv = cfg.app_password_env || WP_DEFAULTS.appPasswordEnv;
  const username = process.env[usernameEnv];
  const appPassword = process.env[passwordEnv];
  const missing = [];
  if (!siteUrl) missing.push(siteUrlEnv);
  if (!username) missing.push(usernameEnv);
  if (!appPassword) missing.push(passwordEnv);
  if (missing.length) {
    fail("EWP_ENV_MISSING", `missing WordPress env vars: ${missing.join(", ")}`, 503, {
      missing_env: missing,
    });
  }
  assertHttps(siteUrl);
  return {
    siteUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`,
      "Content-Type": "application/json",
      "User-Agent": "kad-connectors/wordpress",
    },
  };
}

function contentText(input = {}) {
  return String(input.body || input.content || input.markdown || "").trim();
}

function normalizeContent(input = {}) {
  if (typeof input === "string") {
    return { title: "Bản nháp xuất bản", body: input };
  }
  const body = contentText(input);
  if (!body) fail("EBADCONTENT", "content/body is required", 400);
  const title = String(input.title || "Bản nháp xuất bản").trim();
  let scheduledAt = null;
  if (input.scheduled_at) {
    const d = new Date(input.scheduled_at);
    if (Number.isNaN(d.getTime())) {
      fail("EBADCONTENT", "scheduled_at must be a valid date", 400);
    }
    scheduledAt = d.toISOString();
  }
  return {
    title,
    body,
    excerpt: input.excerpt ? String(input.excerpt).trim() : undefined,
    scheduled_at: scheduledAt,
    category_ids: Array.isArray(input.category_ids)
      ? input.category_ids.map(Number).filter(Number.isFinite)
      : undefined,
    tag_ids: Array.isArray(input.tag_ids) ? input.tag_ids.map(Number).filter(Number.isFinite) : undefined,
  };
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderPreview(connectorType, content) {
  if (connectorType === "wordpress") {
    return [
      `<article class="kad-preview kad-preview-wordpress">`,
      `<h1>${escapeHtml(content.title)}</h1>`,
      content.excerpt ? `<p><strong>${escapeHtml(content.excerpt)}</strong></p>` : "",
      `<div>${escapeHtml(content.body).replace(/\n/g, "<br>")}</div>`,
      `</article>`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `<section class="kad-preview kad-preview-facebook">`,
    `<p>${escapeHtml(content.body).replace(/\n/g, "<br>")}</p>`,
    `</section>`,
  ].join("\n");
}

function markdownPreview(connectorType, content) {
  if (connectorType === "wordpress") {
    return `# ${content.title}\n\n${content.excerpt ? `> ${content.excerpt}\n\n` : ""}${content.body}`;
  }
  return content.body;
}

function addMinutes(date, ms) {
  return new Date(date.getTime() + ms).toISOString();
}

function approvalTypeFor(connectorType) {
  return connectorType === "wordpress" ? "publish_wordpress" : "publish_facebook";
}

function ensureAgentCanPublish(agent, connectorType) {
  if (!agent || agent.agent_type !== "main") {
    fail("EPERM", "only main agent may use publishing connectors", 403);
  }
  if (!agent.permissions || agent.permissions.publish_connector !== true) {
    fail("EPERM", "agent lacks publish_connector permission", 403);
  }
  const access = agent.connector_access || {};
  const key = connectorType === "wordpress" ? "wordpress" : "facebook";
  if (access[key] !== "allowed") {
    fail("EPERM", `agent has no ${key} connector access`, 403);
  }
}

function notifyApprovalPending(task, approval) {
  try {
    repo.notifications.createNotification({
      department_id: task && task.department_id,
      kind: "approval_pending",
      title: "Cần duyệt publish",
      body: approval.title,
      link_path: `/phe-duyet/${approval.id}`,
      target_id: approval.id,
    });
  } catch (e) {
    console.warn("[kad-connectors] approval notification failed:", e && e.message);
  }
}

function serializeAction(action) {
  const connector = action && repo.connectors.getConnector(action.connector_id);
  const approval = action && action.approval_id ? repo.approvals.getApproval(action.approval_id) : null;
  const task = action && action.task_id ? repo.tasks.getTask(action.task_id) : null;
  return {
    ...action,
    connector,
    approval,
    task_title: task ? task.title : null,
  };
}

function createConnector({ department_id, connector_type, name, config }) {
  const type = normalizeType(connector_type);
  assertConnectorType(type);
  const clean = sanitizeConfig(type, config);
  return repo.tx(() => {
    const connector = repo.connectors.createConnector({
      department_id,
      connector_type: type,
      name: name || (type === "wordpress" ? "WordPress" : "Facebook Page"),
      config: clean,
      auth_status: type === "facebook_page" ? "configured" : "not_configured",
      capabilities:
        type === "wordpress" ? ["posts", "preview", "schedule"] : ["manual_handoff"],
      risk_level: type === "wordpress" ? "medium" : "high",
      status: "active",
    });
    repo.audit({
      department_id,
      action: "connector_created",
      actor_type: "human",
      actor_id: "human",
      target_type: "connector",
      target_id: connector.id,
      details: { connector_type: type },
    });
    return connector;
  });
}

async function healthCheck(connectorId) {
  const connector = repo.connectors.getConnector(connectorId);
  if (!connector) fail("ECONNECTOR_NOT_FOUND", "connector not found", 404);
  if (connector.connector_type === "facebook_page") {
    const checked = repo.tx(() => {
      const updated = repo.connectors.updateConnector(connector.id, {
        auth_status: "configured",
        capabilities: ["manual_handoff"],
        last_health_check: repo.nowIso(),
      });
      repo.audit({
        department_id: connector.department_id,
        action: "connector_health_check",
        actor_type: "human",
        actor_id: "human",
        target_type: "connector",
        target_id: connector.id,
        details: { connector_type: connector.connector_type, ok: true, mode: "manual_handoff" },
      });
      return updated;
    });
    return { ok: true, connector: checked, mode: "manual_handoff" };
  }

  const auth = resolveWordPressAuth(connector);
  const resp = await fetch(`${auth.siteUrl}/wp-json/wp/v2/users/me?context=edit`, {
    headers: auth.headers,
  });
  const ok = resp.status >= 200 && resp.status < 300;
  let error = null;
  if (!ok) error = `WordPress health check failed with HTTP ${resp.status}`;
  const checked = repo.tx(() => {
    const updated = repo.connectors.updateConnector(connector.id, {
      auth_status: ok ? "connected" : "error",
      capabilities: ok ? ["posts", "preview", "schedule"] : connector.capabilities,
      last_health_check: repo.nowIso(),
    });
    repo.audit({
      department_id: connector.department_id,
      action: "connector_health_check",
      actor_type: "human",
      actor_id: "human",
      target_type: "connector",
      target_id: connector.id,
      details: { connector_type: connector.connector_type, ok, status: resp.status },
    });
    return updated;
  });
  if (!ok) fail("EWP_HEALTH_FAILED", error, 502, { status: resp.status, connector: checked });
  return { ok: true, connector: checked };
}

function draftConnector({ task_id, agent_id, connector_type, content }) {
  const type = normalizeType(connector_type);
  assertConnectorType(type);
  const task = repo.tasks.getTask(task_id);
  if (!task) fail("ETASK_NOT_FOUND", "task not found", 404);
  const agent = repo.catalog.getAgent(agent_id);
  ensureAgentCanPublish(agent, type);
  const connector = repo.connectors.findActiveByType(task.department_id, type);
  if (!connector) fail("ECONNECTOR_NOT_FOUND", `no active ${type} connector`, 404);

  const normalized = normalizeContent(content);
  const actionType = normalized.scheduled_at ? "schedule" : "publish";
  const now = new Date();
  const cooldownUntil = addMinutes(now, COOLDOWN_MS);
  const previewHtml = renderPreview(type, normalized);
  const approvalType = approvalTypeFor(type);
  let artifact;
  let approval;
  let publishAction;
  let draftAction;
  let previewAction;

  repo.tx(() => {
    artifact = repo.artifacts.createArtifact({
      task_id: task.id,
      agent_id,
      artifact_type: "connector_draft",
      title: `${type === "wordpress" ? "WordPress" : "Facebook"}: ${normalized.title}`,
      content: markdownPreview(type, normalized),
      status: "review",
      metadata: { connector_type: type, preview_html: previewHtml },
    });
    draftAction = repo.connectors.createAction({
      connector_id: connector.id,
      task_id: task.id,
      action_type: "draft",
      content: normalized,
      result: { artifact_id: artifact.id },
      status: "completed",
      executed_at: repo.nowIso(),
    });
    previewAction = repo.connectors.createAction({
      connector_id: connector.id,
      task_id: task.id,
      action_type: "preview",
      content: normalized,
      result: { preview_html: previewHtml },
      status: "completed",
      executed_at: repo.nowIso(),
    });
    approval = repo.approvals.createApproval({
      task_id: task.id,
      requested_by: agent_id,
      approval_type: approvalType,
      title: `Duyệt publish ${type === "wordpress" ? "WordPress" : "Facebook"}: ${normalized.title}`,
      description: normalized.body.slice(0, 500),
      artifact_id: artifact.id,
      context_snapshot: {
        connector_id: connector.id,
        connector_type: type,
        content: normalized,
        preview_action_id: previewAction.id,
      },
      sla_reminder_hours: 4,
      cooldown_until: cooldownUntil,
    });
    publishAction = repo.connectors.createAction({
      connector_id: connector.id,
      task_id: task.id,
      approval_id: approval.id,
      action_type: actionType,
      content: normalized,
      status: "pending",
    });
    repo.audit({
      department_id: task.department_id,
      task_id: task.id,
      agent_id,
      action: "connector_publish_requested",
      actor_type: "agent",
      actor_id: agent_id,
      target_type: "connector_action",
      target_id: publishAction.id,
      details: {
        connector_type: type,
        approval_id: approval.id,
        cooldown_until: cooldownUntil,
      },
    });
  });
  notifyApprovalPending(task, approval);
  const { emitTask, emitDept } = require("./events");
  emitTask(task.id, "kad.approval.created", approval);
  emitDept(task.department_id, "kad.approval.created", approval);
  return {
    status: "pending",
    connector_id: connector.id,
    artifact_id: artifact.id,
    draft_action_id: draftAction.id,
    preview_action_id: previewAction.id,
    publish_action_id: publishAction.id,
    approval_id: approval.id,
    cooldown_until: cooldownUntil,
    preview_html: previewHtml,
    instruction:
      "Bản nháp và preview đã tạo, yêu cầu duyệt publish đã gửi. Hãy KẾT THÚC lượt và chờ trưởng phòng duyệt.",
  };
}

function assertPublishGate(action) {
  if (!action.approval_id) fail("EAPPROVAL_REQUIRED", "connector action has no approval", 409);
  const approval = repo.approvals.getApproval(action.approval_id);
  if (!approval) fail("EAPPROVAL_REQUIRED", "approval not found", 409);
  if (approval.status !== "approved") {
    repo.audit({
      department_id: action.task_id ? repo.tasks.getTask(action.task_id)?.department_id : null,
      task_id: action.task_id,
      action: "connector_publish_blocked",
      actor_type: "system",
      actor_id: "connector-gate",
      target_type: "connector_action",
      target_id: action.id,
      details: { code: "EAPPROVAL_NOT_APPROVED", approval_id: approval.id, status: approval.status },
    });
    fail("EAPPROVAL_NOT_APPROVED", "publish blocked: approval is not approved", 409, {
      approval_id: approval.id,
      approval_status: approval.status,
    });
  }
  if (approval.cooldown_until && Date.now() < new Date(approval.cooldown_until).getTime()) {
    repo.audit({
      department_id: action.task_id ? repo.tasks.getTask(action.task_id)?.department_id : null,
      task_id: action.task_id,
      action: "connector_publish_blocked",
      actor_type: "system",
      actor_id: "connector-gate",
      target_type: "connector_action",
      target_id: action.id,
      details: { code: "ECOOLDOWN_ACTIVE", cooldown_until: approval.cooldown_until },
    });
    fail("ECOOLDOWN_ACTIVE", "publish blocked: cooldown is still active", 409, {
      cooldown_until: approval.cooldown_until,
    });
  }
  return approval;
}

async function publishWordPress(connector, content) {
  const auth = resolveWordPressAuth(connector);
  const payload = {
    title: content.title,
    content: content.body,
    excerpt: content.excerpt || undefined,
    status: content.scheduled_at ? "future" : "publish",
    date: content.scheduled_at || undefined,
    categories: content.category_ids && content.category_ids.length ? content.category_ids : undefined,
    tags: content.tag_ids && content.tag_ids.length ? content.tag_ids : undefined,
  };
  const resp = await fetch(`${auth.siteUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status < 200 || resp.status >= 300) {
    const message = data && data.message ? String(data.message) : `HTTP ${resp.status}`;
    fail("EWP_PUBLISH_FAILED", `WordPress publish failed: ${message}`, 502, {
      status: resp.status,
      code: data && data.code,
    });
  }
  return {
    external_id: data.id != null ? String(data.id) : null,
    external_url: data.link || data.guid?.rendered || null,
    provider_response: {
      id: data.id ?? null,
      status: data.status ?? null,
      link: data.link ?? null,
    },
  };
}

function completeFacebookHandoff(content, opts = {}) {
  const checklist = [
    "Copy nội dung đã được duyệt.",
    "Đăng lên Facebook Page đúng tài khoản thương hiệu.",
    "Gắn link/ảnh nếu có trong brief.",
    "Dán URL bài đã đăng vào KAD để audit.",
  ];
  return {
    external_id: opts.manual_external_url || null,
    external_url: opts.manual_external_url || null,
    provider_response: {
      mode: "manual_handoff",
      copy_text: content.body,
      checklist,
      note: "Facebook Page API/app review chưa là dependency của Phase 6.",
    },
  };
}

async function executeAction(actionId, opts = {}) {
  let action = repo.connectors.getAction(actionId);
  if (!action) fail("EACTION_NOT_FOUND", "connector action not found", 404);
  if (!["publish", "schedule"].includes(action.action_type)) {
    fail("EACTION_NOT_EXECUTABLE", "only publish/schedule connector actions can execute", 409);
  }
  if (action.status === "completed") return serializeAction(action);
  if (action.status === "executing") fail("EACTION_EXECUTING", "connector action is executing", 409);
  assertPublishGate(action);
  const connector = repo.connectors.getConnector(action.connector_id);
  if (!connector || connector.status !== "active") {
    fail("ECONNECTOR_NOT_FOUND", "active connector not found", 404);
  }

  repo.connectors.updateAction(action.id, { status: "executing" });
  action = repo.connectors.getAction(action.id);
  let result;
  try {
    result =
      connector.connector_type === "wordpress"
        ? await publishWordPress(connector, action.content || {})
        : completeFacebookHandoff(action.content || {}, opts);
  } catch (e) {
    repo.tx(() => {
      repo.connectors.updateAction(action.id, {
        status: "failed",
        result: {
          code: e.code || "ECONNECTOR_FAILED",
          message: e.message || "connector failed",
        },
        executed_at: repo.nowIso(),
      });
      repo.audit({
        department_id: action.task_id ? repo.tasks.getTask(action.task_id)?.department_id : null,
        task_id: action.task_id,
        action: "connector_publish_failed",
        actor_type: "system",
        actor_id: "connector-service",
        target_type: "connector_action",
        target_id: action.id,
        details: { code: e.code || "ECONNECTOR_FAILED" },
      });
    });
    throw e;
  }

  const completed = repo.tx(() => {
    const row = repo.connectors.updateAction(action.id, {
      status: "completed",
      result: result.provider_response,
      external_id: result.external_id,
      external_url: result.external_url,
      executed_at: repo.nowIso(),
    });
    repo.audit({
      department_id: action.task_id ? repo.tasks.getTask(action.task_id)?.department_id : null,
      task_id: action.task_id,
      action:
        connector.connector_type === "facebook_page"
          ? "connector_manual_handoff_completed"
          : "connector_publish_completed",
      actor_type: opts.actor_type || "agent",
      actor_id: opts.actor_id || "connector-service",
      target_type: "connector_action",
      target_id: action.id,
      details: {
        connector_type: connector.connector_type,
        external_id: result.external_id,
        external_url: result.external_url,
      },
    });
    return row;
  });
  return serializeAction(completed);
}

async function executeByApproval(approvalId, opts = {}) {
  const action = repo.connectors.getActionByApproval(approvalId);
  if (!action) fail("EACTION_NOT_FOUND", "no publish action for approval", 404);
  return executeAction(action.id, opts);
}

function listActions(args) {
  return repo.connectors.listActions(args).map(serializeAction);
}

module.exports = {
  COOLDOWN_MS,
  ConnectorError,
  sanitizeConfig,
  createConnector,
  healthCheck,
  draftConnector,
  executeAction,
  executeByApproval,
  listActions,
};
