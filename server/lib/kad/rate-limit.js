/**
 * @file server/lib/kad/rate-limit.js — minimal in-memory rate limiter for
 * /api/kad/* (Phase 7 hardening). This is a local-first single-user app, not
 * a multi-tenant surface — the goal is bounding a runaway loop or misbehaving
 * script, not defending against distributed abuse. Fixed-window counter per
 * client key, no external dependency (no express-rate-limit in package.json).
 *
 * `KAD_RATE_LIMIT_PER_MIN` overrides the default limit; `KAD_RATE_LIMIT_DISABLED=1`
 * bypasses entirely (kept for local debugging — never set in a real deployment).
 */

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 300; // generous for local dashboard polling + agent tool-call bursts

const buckets = new Map(); // key -> {count, resetAt}

function clientKey(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
}

/** Drop expired buckets so the Map doesn't grow unbounded over a long-lived process. */
function sweepExpired() {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

let sweepTimer = null;
function startSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepExpired, WINDOW_MS);
  sweepTimer.unref();
}

/**
 * Build an Express middleware enforcing `limit` requests per `windowMs` per
 * client IP. Responds 429 with a `Retry-After` header once exceeded.
 */
function makeLimiter({ limit, windowMs = WINDOW_MS, keyPrefix = "" } = {}) {
  startSweep();
  const effectiveLimit = Number(process.env.KAD_RATE_LIMIT_PER_MIN) || limit || DEFAULT_LIMIT;
  return function rateLimit(req, res, next) {
    if (process.env.KAD_RATE_LIMIT_DISABLED === "1") return next();
    const key = keyPrefix + clientKey(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > effectiveLimit) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: {
          code: "ERATELIMIT",
          message: `too many requests, retry after ${retryAfterSec}s`,
        },
      });
    }
    next();
  };
}

/** Test/debug helper — clears all counters. */
function _resetForTests() {
  buckets.clear();
}

module.exports = { makeLimiter, _resetForTests };
