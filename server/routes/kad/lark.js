/**
 * @file Lark ingress for KAD Phase 6.6. Long-connection workers post normalized
 * events/actions here with x-kad-adapter-token. The same routes accept Lark
 * URL-verification bodies for local callback testing.
 */
const express = require("express");
const { larkTokenMatches } = require("../../lib/kad/auth");
const adapter = require("../../lib/kad/lark-adapter");

const router = express.Router();

function tokenOk(req) {
  if (larkTokenMatches(req)) return true;
  const expected = process.env.KAD_LARK_VERIFICATION_TOKEN || "";
  return !!expected && req.body && req.body.token === expected;
}

function requireIngress(req, res, next) {
  if (tokenOk(req)) return next();
  return res
    .status(401)
    .json({ error: { code: "ELARKAUTH", message: "invalid Lark ingress token" } });
}

router.post("/messages", requireIngress, (req, res) => {
  const result = adapter.handleIncomingMessage(req.body || {});
  res.status(result.status).json(result.body);
});

router.post(
  "/events",
  (req, res, next) => {
    const b = req.body || {};
    if (b.type === "url_verification" && tokenOk(req)) return res.json({ challenge: b.challenge });
    return requireIngress(req, res, next);
  },
  (req, res) => {
    const normalized = adapter.normalizeEvent(req.body || {});
    if (!normalized) {
      return res.status(202).json({ ok: true, ignored: true, reason: "unsupported_event" });
    }
    const result = adapter.handleIncomingMessage(normalized);
    res.status(result.status).json(result.body);
  }
);

router.post("/card-action", requireIngress, (req, res) => {
  const normalized = adapter.normalizeAction(req.body || {});
  const result = adapter.handleCardAction(normalized);
  res.status(result.status).json(result.body);
});

module.exports = router;
