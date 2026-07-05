#!/usr/bin/env node
/**
 * Optional Lark long-connection worker for KAD Phase 6.6.
 *
 * @larksuiteoapi/node-sdk is owner-approved and installed. Only this standalone
 * worker imports it — the main server never requires it. It subscribes to
 * im.message.receive_v1 through WSClient and forwards normalized messages to
 * the stable KAD adapter endpoint.
 */

const API_BASE = process.env.KAD_API_BASE || "http://127.0.0.1:4820";
const ADAPTER_TOKEN = process.env.KAD_LARK_ADAPTER_TOKEN || "";
const APP_ID = process.env.KAD_LARK_APP_ID || process.env.LARK_APP_ID || "";
const APP_SECRET = process.env.KAD_LARK_APP_SECRET || process.env.LARK_APP_SECRET || "";

if (!ADAPTER_TOKEN || !APP_ID || !APP_SECRET) {
  console.error("Missing KAD_LARK_ADAPTER_TOKEN and/or KAD_LARK_APP_ID/KAD_LARK_APP_SECRET.");
  process.exit(2);
}

let Lark;
try {
  Lark = await import("@larksuiteoapi/node-sdk");
} catch {
  console.error("Missing dependency @larksuiteoapi/node-sdk. Run npm install to restore it.");
  process.exit(2);
}

function textFromContent(content) {
  if (!content) return "";
  try {
    return JSON.parse(content).text || "";
  } catch {
    return String(content);
  }
}

async function forwardMessage(data) {
  const sender = data.sender || {};
  const message = data.message || {};
  const body = {
    open_id:
      sender.sender_id?.open_id ||
      sender.sender_id?.user_id ||
      sender.open_id ||
      sender.user_id ||
      null,
    chat_id: message.chat_id || null,
    chat_type: message.chat_type || "p2p",
    text: textFromContent(message.content),
    message_id: message.message_id || null,
  };
  const res = await fetch(`${API_BASE}/api/kad/lark/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kad-adapter-token": ADAPTER_TOKEN,
      "x-kad-channel": "lark",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.warn(`[kad:lark-worker] forward failed HTTP ${res.status}: ${err}`);
  }
}

const baseConfig = { appId: APP_ID, appSecret: APP_SECRET };
const wsClient = new Lark.WSClient({
  ...baseConfig,
  loggerLevel: Lark.LoggerLevel?.info,
});

wsClient.start({
  eventDispatcher: new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
      await forwardMessage(data);
      return {};
    },
  }),
});

console.log("[kad:lark-worker] long connection started");
