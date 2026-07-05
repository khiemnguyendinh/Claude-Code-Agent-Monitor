/**
 * @file Minimal KAD channel auth. Web UI remains local-first/no-login; external
 * adapters must prove possession of their static token before they can write as
 * a non-web channel such as Lark.
 */
const { timingSafeEqual } = require("node:crypto");

function bearer(req) {
  const h = req.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : "";
}

function staticLarkToken() {
  return process.env.KAD_LARK_ADAPTER_TOKEN || "";
}

function tokenMatches(got, expected) {
  if (!got || !expected) return false;
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function larkTokenMatches(req) {
  return tokenMatches(req.get("x-kad-adapter-token") || bearer(req), staticLarkToken());
}

function readKadActor(req) {
  const b = req.body || {};
  const requestedChannel = req.get("x-kad-channel") || b.channel || "web";

  if (requestedChannel === "lark") {
    if (!larkTokenMatches(req)) {
      return {
        error: {
          status: 401,
          code: "ELARKAUTH",
          message: "valid Lark adapter token is required for channel=lark",
        },
      };
    }
    const actorRef = req.get("x-kad-actor-ref") || b.channel_actor_ref || b.open_id;
    if (!actorRef || typeof actorRef !== "string") {
      return {
        error: {
          status: 400,
          code: "ELARKACTOR",
          message: "channel_actor_ref/open_id is required for channel=lark",
        },
      };
    }
    return { channel: "lark", actorRef };
  }

  return {
    channel: requestedChannel || "web",
    actorRef: b.channel_actor_ref || null,
  };
}

function sendActorError(actor, res) {
  if (!actor || !actor.error) return false;
  res
    .status(actor.error.status)
    .json({ error: { code: actor.error.code, message: actor.error.message } });
  return true;
}

function ownerOpenId() {
  return process.env.KAD_LARK_OWNER_OPEN_ID || process.env.KAD_OWNER_LARK_OPEN_ID || "";
}

function isOwnerOpenId(openId) {
  const owner = ownerOpenId();
  return !!owner && !!openId && String(openId) === owner;
}

module.exports = {
  readKadActor,
  sendActorError,
  larkTokenMatches,
  ownerOpenId,
  isOwnerOpenId,
};
