/**
 * @file server/lib/kad/internal-auth.js — shared secret for the internal API
 * that KAD MCP tools call. The MCP server (spawned inside each claude run) is a
 * separate process; routing its writes back through the monitor's HTTP API keeps
 * a SINGLE db writer (spec 02 §2.4). This token authenticates that callback and
 * is minted fresh per server process (never persisted).
 */
const { randomUUID, timingSafeEqual } = require("node:crypto");

const TOKEN = process.env.KAD_INTERNAL_TOKEN || randomUUID().replace(/-/g, "");
const TOKEN_BUF = Buffer.from(TOKEN);

function getInternalToken() {
  return TOKEN;
}

/** Constant-time token compare (avoids leaking length/prefix via timing). */
function tokenMatches(got) {
  if (typeof got !== "string") return false;
  const gotBuf = Buffer.from(got);
  if (gotBuf.length !== TOKEN_BUF.length) return false;
  return timingSafeEqual(gotBuf, TOKEN_BUF);
}

/** Express guard for /api/kad/internal/* — rejects callers without the token. */
function requireInternalToken(req, res, next) {
  if (tokenMatches(req.get("x-kad-internal-token"))) return next();
  return res.status(401).json({ error: { code: "EKADINTERNAL", message: "invalid internal token" } });
}

module.exports = { getInternalToken, requireInternalToken };
