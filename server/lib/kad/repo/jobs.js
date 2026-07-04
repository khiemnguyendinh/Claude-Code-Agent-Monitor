/**
 * @file server/lib/kad/repo/jobs.js — kad_job_queue persistence (spec 02 §6b).
 * Durable work that must survive process restart: resume_task, start_delegation,
 * reconcile_runs. Leased with a short window so a single worker never double-runs
 * a job; dedup_key guarantees at most one pending job per logical key.
 */
const { db, parseJson, newId, nowIso } = require("./db");

const LEASE_MS = 60 * 1000; // a leased job is retried if not completed within 60s

function hydrate(row) {
  return row ? { ...row, payload: parseJson(row.payload_json, {}) } : null;
}

/**
 * Enqueue a job. If dedupKey is given and a non-terminal job with that key
 * already exists, this is a no-op (returns the existing job) — idempotency.
 */
function enqueue({ kind, payload, runAfter, dedupKey, maxAttempts }) {
  if (dedupKey) {
    const existing = db
      .prepare("SELECT * FROM kad_job_queue WHERE dedup_key=? AND status IN ('pending','leased') LIMIT 1")
      .get(dedupKey);
    if (existing) return hydrate(existing);
  }
  const id = newId("job");
  try {
    db.prepare(
      `INSERT INTO kad_job_queue (id, kind, payload_json, run_after, status, attempts, max_attempts, dedup_key, created_at)
       VALUES (@id,@kind,@payload,@run_after,'pending',0,@max,@dedup,@now)`
    ).run({
      id,
      kind,
      payload: JSON.stringify(payload || {}),
      run_after: runAfter || nowIso(),
      max: maxAttempts ?? 5,
      dedup: dedupKey ?? null,
      now: nowIso(),
    });
  } catch (e) {
    // Defensive: if a dedup_key insert lost a race with the idx_jobq_dedup partial
    // unique index, treat it as the intended no-op and return the winner. (In the
    // single-threaded Node model the pre-check above already prevents this; this is
    // belt-and-braces so a UNIQUE violation can never crash the caller.)
    if (dedupKey && /UNIQUE|constraint/i.test(String(e && e.message))) {
      const existing = db.prepare("SELECT * FROM kad_job_queue WHERE dedup_key=? AND status IN ('pending','leased') LIMIT 1").get(dedupKey);
      if (existing) return hydrate(existing);
    }
    throw e;
  }
  return getJob(id);
}

function getJob(id) {
  return hydrate(db.prepare("SELECT * FROM kad_job_queue WHERE id=?").get(id));
}

/**
 * Atomically lease up to `limit` due jobs (run_after<=now, pending, or leased
 * with an expired lease). Sets status='leased' + lease_until so a concurrent
 * sweep won't grab them. Returns hydrated jobs.
 */
function leaseDue(limit = 5) {
  const now = nowIso();
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  const claim = db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM kad_job_queue
         WHERE status='pending' AND run_after<=@now
            OR (status='leased' AND lease_until<@now)
         ORDER BY run_after ASC LIMIT @limit`
      )
      .all({ now, limit });
    const leased = [];
    const upd = db.prepare("UPDATE kad_job_queue SET status='leased', lease_until=@lease, attempts=attempts+1 WHERE id=@id AND status IN ('pending','leased')");
    for (const r of rows) {
      const res = upd.run({ lease: leaseUntil, id: r.id });
      if (res.changes === 1) leased.push(hydrate({ ...r, status: "leased", attempts: r.attempts + 1 }));
    }
    return leased;
  });
  return claim();
}

function complete(id) {
  db.prepare("UPDATE kad_job_queue SET status='done', lease_until=NULL WHERE id=?").run(id);
}

/** Fail a job: requeue with backoff if attempts remain, else mark failed.
 * opts.permanent forces immediate 'failed' (malformed payload — retry is futile). */
function fail(id, errMsg, opts = {}) {
  const job = getJob(id);
  if (!job) return;
  if (opts.permanent || job.attempts >= job.max_attempts) {
    db.prepare("UPDATE kad_job_queue SET status='failed', last_error=@e, lease_until=NULL WHERE id=@id").run({ e: String(errMsg).slice(0, 500), id });
  } else {
    const backoffMs = Math.min(30000, 1000 * 2 ** job.attempts);
    const runAfter = new Date(Date.now() + backoffMs).toISOString();
    db.prepare("UPDATE kad_job_queue SET status='pending', run_after=@ra, last_error=@e, lease_until=NULL WHERE id=@id").run({ ra: runAfter, e: String(errMsg).slice(0, 500), id });
  }
}

function pendingCount() {
  return db.prepare("SELECT COUNT(*) n FROM kad_job_queue WHERE status IN ('pending','leased')").get().n;
}

module.exports = { enqueue, getJob, leaseDue, complete, fail, pendingCount };
