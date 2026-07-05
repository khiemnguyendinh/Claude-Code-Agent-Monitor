/**
 * @file Small Lark Open Platform client used by the KAD Lark adapter. It uses
 * fetch only, so Phase 6.6 does not add a dependency. Credentials stay in env.
 */
const API_BASE = process.env.KAD_LARK_API_BASE || "https://open.larksuite.com/open-apis";

let cachedToken = null;
let cachedUntil = 0;

function appConfig() {
  return {
    appId: process.env.KAD_LARK_APP_ID || process.env.LARK_APP_ID || "",
    appSecret: process.env.KAD_LARK_APP_SECRET || process.env.LARK_APP_SECRET || "",
  };
}

function isConfigured() {
  const c = appConfig();
  return !!(c.appId && c.appSecret);
}

async function tenantAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedUntil > now + 30_000) return cachedToken;
  const c = appConfig();
  if (!c.appId || !c.appSecret) throw new Error("Lark app credentials are not configured");

  const res = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: c.appId, app_secret: c.appSecret }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.code !== 0 || !body.tenant_access_token) {
    throw new Error(body.msg || `tenant_access_token failed with HTTP ${res.status}`);
  }
  cachedToken = body.tenant_access_token;
  cachedUntil = now + Math.max(60, Number(body.expire || 7200) - 60) * 1000;
  return cachedToken;
}

async function sendMessage({ receiveId, receiveIdType = "open_id", msgType, content }) {
  if (!isConfigured()) return { ok: false, skipped: true, reason: "not_configured" };
  if (!receiveId) return { ok: false, skipped: true, reason: "missing_receive_id" };

  const token = await tenantAccessToken();
  const res = await fetch(
    `${API_BASE}/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: msgType,
        content: typeof content === "string" ? content : JSON.stringify(content),
      }),
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.code !== 0) {
    return { ok: false, status: res.status, error: body.msg || "Lark send failed", body };
  }
  return { ok: true, status: res.status, body };
}

function sendInteractiveCard({ receiveId, receiveIdType, card }) {
  return sendMessage({
    receiveId,
    receiveIdType,
    msgType: "interactive",
    content: JSON.stringify(card),
  });
}

function sendText({ receiveId, receiveIdType, text }) {
  return sendMessage({
    receiveId,
    receiveIdType,
    msgType: "text",
    content: JSON.stringify({ text }),
  });
}

module.exports = { isConfigured, sendMessage, sendInteractiveCard, sendText };
