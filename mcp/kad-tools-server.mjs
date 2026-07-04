#!/usr/bin/env node
/**
 * mcp/kad-tools-server.mjs — KAD MCP tools (spec 04 §2), stdio transport.
 *
 * ZERO-DEPENDENCY, hand-rolled MCP stdio server (JSON-RPC 2.0, newline-delimited)
 * — Node builtins + fetch only. Chosen over the @modelcontextprotocol/sdk so the
 * server needs no `npm run mcp:install`/build step and can't drift from the mcp/
 * TS app; it is spawned fresh as a child of each `claude` KAD run.
 *
 * Each tool is a THIN HTTP CLIENT to the monitor's internal API
 * (/api/kad/internal/*), keeping a SINGLE db writer (spec 02 §2.4); all
 * enforcement (permissions, approval-blocking) stays server-side. Run identity +
 * secret arrive via env the orchestrator injected (KAD_API_BASE, KAD_INTERNAL_TOKEN,
 * KAD_RUN_ID/TASK_ID/AGENT_ID).
 */
import readline from "node:readline";

const API_BASE = process.env.KAD_API_BASE || "http://127.0.0.1:4820";
const INTERNAL_TOKEN = process.env.KAD_INTERNAL_TOKEN || "";
const RUN_ID = process.env.KAD_RUN_ID || "";
const TASK_ID = process.env.KAD_TASK_ID || "";
const AGENT_ID = process.env.KAD_AGENT_ID || "";
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "";
const PROTOCOL_VERSION = "2025-06-18";

function headers() {
  const h = {
    "content-type": "application/json",
    "x-kad-internal-token": INTERNAL_TOKEN,
    "x-kad-run-id": RUN_ID,
    "x-kad-task-id": TASK_ID,
    "x-kad-agent-id": AGENT_ID,
  };
  if (DASHBOARD_TOKEN) h.authorization = `Bearer ${DASHBOARD_TOKEN}`;
  return h;
}

async function call(method, pathname, { query, body } = {}) {
  const url = new URL(`/api/kad/internal${pathname}`, API_BASE);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const resp = await fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const err = new Error((data && data.error && data.error.message) || `HTTP ${resp.status}`);
    err.payload = data;
    throw err;
  }
  return data;
}

// ---- tool definitions (name, description, JSON Schema, handler) ----
const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });

const TOOLS = [
  {
    name: "kad_plan_task",
    description: "Ghi kế hoạch thực hiện và gửi trưởng phòng duyệt (chỉ Main Agent). Trả về approval pending; sau khi gọi hãy KẾT THÚC lượt.",
    inputSchema: S({ plan: str("Nội dung kế hoạch (markdown)") }, ["plan"]),
    handler: (a) => call("POST", "/plan-task", { body: { plan: a.plan } }),
  },
  {
    name: "kad_request_approval",
    description: "Xin duyệt một hạng mục (kế hoạch/artifact/nhạy cảm). Trả về pending; kết thúc lượt sau khi gọi.",
    inputSchema: S({ approval_type: str(), title: str(), description: str(), artifact_id: str(), sensitivity_subtype: { type: "string", enum: ["metrics", "people", "brand"] } }),
    handler: (a) => call("POST", "/request-approval", { body: a }),
  },
  {
    name: "kad_create_delegation",
    description: "Giao việc cho một sub-agent (chỉ Main Agent, chỉ SAU khi kế hoạch được duyệt).",
    inputSchema: S({ to_agent: str("name của sub-agent, vd sub-curriculum-researcher"), instruction: str(), input_artifact_ids: { type: "array", items: { type: "string" } } }, ["to_agent", "instruction"]),
    handler: (a) => call("POST", "/create-delegation", { body: a }),
  },
  {
    name: "kad_get_delegation_result",
    description: "Xem kết quả một delegation (status + artifact).",
    inputSchema: S({ delegation_id: str() }, ["delegation_id"]),
    handler: (a) => call("GET", "/delegation-result", { query: { delegation_id: a.delegation_id } }),
  },
  {
    name: "kad_save_artifact",
    description: "Lưu artifact (sản phẩm) của bạn vào hệ thống.",
    inputSchema: S({ artifact_type: str(), title: str(), content: str(), parent_artifact_id: str(), template_version_id: str() }, ["artifact_type", "title"]),
    handler: (a) => call("POST", "/save-artifact", { body: a }),
  },
  {
    name: "kad_read_org_context",
    description: "Đọc bối cảnh tổ chức đã duyệt (có thể lọc theo section).",
    inputSchema: S({ section: str() }),
    handler: (a) => call("GET", "/org-context", { query: { section: a.section } }),
  },
  {
    name: "kad_read_template",
    description: "Đọc template đã duyệt theo type (program_framework/syllabus/...).",
    inputSchema: S({ type: str() }, ["type"]),
    handler: (a) => call("GET", "/template", { query: { type: a.type } }),
  },
  {
    name: "kad_report_progress",
    description: "Báo tiến độ (hiện realtime trên UI).",
    inputSchema: S({ content: str() }, ["content"]),
    handler: (a) => call("POST", "/report-progress", { body: { content: a.content } }),
  },
  {
    name: "kad_web_search",
    description: "Tìm kiếm web THẬT (chỉ Researcher). Trả về kết quả có URL.",
    inputSchema: S({ query: str(), max_results: { type: "integer", minimum: 1, maximum: 10 } }, ["query"]),
    handler: (a) => call("POST", "/web-search", { body: { query: a.query, max_results: a.max_results } }),
  },
];
const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ---- JSON-RPC over stdio (newline-delimited) ----
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "kad", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return; // no response
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") {
    return reply(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === "tools/call") {
    const tool = params && TOOL_MAP.get(params.name);
    if (!tool) return replyError(id, -32602, `unknown tool: ${params && params.name}`);
    try {
      const data = await tool.handler(params.arguments || {});
      return reply(id, { content: [{ type: "text", text: JSON.stringify(data) }] });
    } catch (e) {
      return reply(id, { content: [{ type: "text", text: JSON.stringify({ error: e.message, detail: e.payload || null }) }], isError: true });
    }
  }
  if (id !== undefined) replyError(id, -32601, `method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try {
    msg = JSON.parse(s);
  } catch {
    return; // ignore non-JSON
  }
  Promise.resolve(handle(msg)).catch((e) => {
    if (msg && msg.id !== undefined) replyError(msg.id, -32603, String(e && e.message));
  });
});
