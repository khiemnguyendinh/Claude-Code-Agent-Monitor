/**
 * client/src/kad/ws-client.ts — shared KAD-scoped WebSocket client.
 *
 * Deliberately a SEPARATE connection from the monitor's `useWebSocket` (client/
 * src/hooks/useWebSocket.ts): that hook has no notion of scoped subscriptions,
 * and threading scope-subscribe messages through it would mean lifting the raw
 * `WebSocket` instance out to a shared context touched by every monitor page.
 * KAD screens instead open their own small multiplexed connection to the same
 * `/ws` endpoint and speak the scope protocol the server already implements
 * (server/websocket.js `kadBroadcast` / `{subscribe: 'kad:task:<id>'}`).
 *
 * One connection is shared across every KAD screen mounted at once; screens
 * subscribe/unsubscribe scopes independently via `subscribeKadScope`.
 */
import { dashboardToken } from "../lib/api";

export interface KadWsEvent {
  type: string;
  data: { scope: string; [key: string]: unknown };
  timestamp: string;
}

type Handler = (event: KadWsEvent) => void;
type ConnectionHandler = (connected: boolean) => void;

const scopeHandlers = new Map<string, Set<Handler>>();
const connectionHandlers = new Set<ConnectionHandler>();
let ws: WebSocket | null = null;
let connected = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  connectionHandlers.forEach((h) => h(value));
}

function resubscribeAll() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (const scope of scopeHandlers.keys()) {
    ws.send(JSON.stringify({ subscribe: scope }));
  }
}

function ensureConnection() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = dashboardToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws${query}`);

  socket.onopen = () => {
    reconnectAttempts = 0;
    setConnected(true);
    resubscribeAll();
  };
  socket.onmessage = (event) => {
    let msg: KadWsEvent;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string" || !msg.data || typeof msg.data.scope !== "string")
      return;
    const handlers = scopeHandlers.get(msg.data.scope);
    if (!handlers) return;
    handlers.forEach((h) => h(msg));
  };
  socket.onclose = () => {
    setConnected(false);
    if (scopeHandlers.size === 0) return; // no active subscribers — don't reconnect until one shows up
    const delay = Math.min(500 * Math.pow(2, reconnectAttempts), 5000);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      ws = null;
      ensureConnection();
    }, delay);
  };
  socket.onerror = () => socket.close();
  ws = socket;
}

/**
 * Subscribe to a KAD-scoped channel (e.g. `kad:task:<id>`, `kad:department:<id>`).
 * Returns an unsubscribe function. Opens the shared connection lazily and tears
 * scope registration down (sending `{unsubscribe}`) once the last handler for a
 * scope is removed.
 */
export function subscribeKadScope(scope: string, handler: Handler): () => void {
  let set = scopeHandlers.get(scope);
  if (!set) {
    set = new Set();
    scopeHandlers.set(scope, set);
    ensureConnection();
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ subscribe: scope }));
  }
  set.add(handler);

  return () => {
    const current = scopeHandlers.get(scope);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      scopeHandlers.delete(scope);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ unsubscribe: scope }));
    }
  };
}

export function isKadWsConnected(): boolean {
  return connected;
}

export function onKadWsConnectionChange(handler: ConnectionHandler): () => void {
  connectionHandlers.add(handler);
  return () => connectionHandlers.delete(handler);
}

export function taskScope(taskId: string): string {
  return `kad:task:${taskId}`;
}
export function departmentScope(departmentId: string): string {
  return `kad:department:${departmentId}`;
}

/** Cleanup helper for tests / HMR — closes the shared socket and clears state. */
export function _resetKadWsForTests(): void {
  clearTimeout(reconnectTimer);
  scopeHandlers.clear();
  connectionHandlers.clear();
  ws?.close();
  ws = null;
  connected = false;
  reconnectAttempts = 0;
}
