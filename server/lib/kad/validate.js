/**
 * @file server/lib/kad/validate.js — shared request-body validators for
 * /api/kad/* routes (Phase 7 hardening). Non-throwing: each check returns
 * `null` (ok) or a `{code, message}` error object, matching this codebase's
 * existing `if (bad) return err(res, code, message)` idiom instead of
 * introducing an exception-based validation framework/dependency.
 */

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Matches this codebase's existing manual-check convention exactly (EBADTITLE,
// EBADSTATUS, EBADPRIORITY, EBADCONTENT, EBADPLAN, EBADQUESTION, ...) — no
// underscores, so a validated field lines up with any pre-existing check for
// the same field instead of introducing a parallel EBAD_FOO naming scheme.
function codeFor(field) {
  return `EBAD${String(field).toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

/** Required-ness + type + max length for a string field. */
function checkString(value, field, { required = false, maxLen = 5000 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) return { code: codeFor(field), message: `${field} is required` };
    return null;
  }
  if (typeof value !== "string") return { code: codeFor(field), message: `${field} must be a string` };
  if (value.length > maxLen)
    return { code: codeFor(field), message: `${field} exceeds max length ${maxLen}` };
  return null;
}

/** Value must be one of `allowed` (or absent unless required). */
function checkEnum(value, field, allowed, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) return { code: codeFor(field), message: `${field} is required` };
    return null;
  }
  if (!allowed.includes(value))
    return { code: codeFor(field), message: `${field} must be one of: ${allowed.join(", ")}` };
  return null;
}

/** Array (optionally capped in length); string items are coerced by callers via .map(String). */
function checkArray(value, field, { required = false, maxItems = 50 } = {}) {
  if (value === undefined || value === null) {
    if (required) return { code: codeFor(field), message: `${field} is required` };
    return null;
  }
  if (!Array.isArray(value)) return { code: codeFor(field), message: `${field} must be an array` };
  if (value.length > maxItems)
    return { code: codeFor(field), message: `${field} exceeds max items ${maxItems}` };
  return null;
}

/** Plain JSON object (not array, not null) — for *_config/data/metadata columns. */
function checkObject(value, field, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) return { code: codeFor(field), message: `${field} is required` };
    return null;
  }
  if (!isPlainObject(value)) return { code: codeFor(field), message: `${field} must be an object` };
  return null;
}

/** Finite number within optional [min, max]. */
function checkNumber(value, field, { required = false, min, max } = {}) {
  if (value === undefined || value === null) {
    if (required) return { code: codeFor(field), message: `${field} is required` };
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return { code: codeFor(field), message: `${field} must be a number` };
  if (min !== undefined && n < min)
    return { code: codeFor(field), message: `${field} must be >= ${min}` };
  if (max !== undefined && n > max)
    return { code: codeFor(field), message: `${field} must be <= ${max}` };
  return null;
}

/** Returns the first non-null check result, or null if every check passed. */
function firstError(...results) {
  for (const r of results) if (r) return r;
  return null;
}

module.exports = {
  isPlainObject,
  checkString,
  checkEnum,
  checkArray,
  checkObject,
  checkNumber,
  firstError,
};
