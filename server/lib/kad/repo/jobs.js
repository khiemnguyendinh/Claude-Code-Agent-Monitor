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
      .prepare(
        "SELECT * FROM kad_job_queue WHERE dedup_key=? AND status IN ('pending','leased') LIMIT 1"
      )
      .get(dedupKey);
    if (existing) {
      if (process.env.KAD_JOBS_TRACE)
        console.log(
          `[jobs.enqueue TRACE] dedup=${dedupKey} PRE-CHECK HIT existing=${existing.id} status=${existing.status} — returning as-is, NEW payload DISCARDED:`,
          JSON.stringify(payload)
        );
      return hydrate(existing);
    }
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
    // idx_jobq_dedup (migration) is `UNIQUE(dedup_key) WHERE dedup_key IS NOT
    // NULL` — NOT scoped to pending/leased, so a dedup_key can only ever be
    // used ONCE in the table's lifetime at the SQLite level, even after that
    // job reaches a terminal status. A task's dedup_key ("resume:<taskId>")
    // is legitimately re-enqueued many times over its life (brief lock, plan
    // approval, report decide, ...) — each one, once the prior job is
    // done/failed, would otherwise hit this UNIQUE violation and throw out of
    // the caller (e.g. POST /approvals/:id/decide), silently dropping the
    // resume and leaving the task stuck forever with no further agent turn.
    // Reuse (reset) the existing row instead of inserting a new one, so the
    // one-row-per-dedup_key DB invariant holds while repeat triggers still work.
    if (dedupKey && /UNIQUE|constraint/i.test(String(e && e.message))) {
      const existing = db
        .prepare(
          "SELECT * FROM kad_job_queue WHERE dedup_key=? AND status IN ('pending','leased') LIMIT 1"
        )
        .get(dedupKey);
      if (existing) {
        if (process.env.KAD_JOBS_TRACE)
          console.log(
            `[jobs.enqueue TRACE] dedup=${dedupKey} INSERT raced, existing=${existing.id} status=${existing.status} — returning as-is, NEW payload DISCARDED`
          );
        return hydrate(existing);
      }
      const terminal = db
        .prepare("SELECT * FROM kad_job_queue WHERE dedup_key=? LIMIT 1")
        .get(dedupKey);
      if (terminal) {
        if (process.env.KAD_JOBS_TRACE)
          console.log(
            `[jobs.enqueue TRACE] dedup=${dedupKey} REUSING terminal job=${terminal.id} (was ${terminal.status}) — resetting to pending with new payload:`,
            JSON.stringify(payload)
          );
        db.prepare(
          `UPDATE kad_job_queue
           SET kind=@kind, payload_json=@payload, run_after=@run_after, status='pending',
               attempts=0, max_attempts=@max, lease_until=NULL, last_error=NULL
           WHERE id=@id`
        ).run({
          id: terminal.id,
          kind,
          payload: JSON.stringify(payload || {}),
          run_after: runAfter || nowIso(),
          max: maxAttempts ?? 5,
        });
        return getJob(terminal.id);
      }
    }
    throw e;
  }
  if (process.env.KAD_JOBS_TRACE)
    console.log(`[jobs.enqueue TRACE] dedup=${dedupKey || "(none)"} FRESH INSERT job=${id}`);
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
    const upd = db.prepare(
      "UPDATE kad_job_queue SET status='leased', lease_until=@lease, attempts=attempts+1 WHERE id=@id AND status IN ('pending','leased')"
    );
    for (const r of rows) {
      const res = upd.run({ lease: leaseUntil, id: r.id });
      if (res.changes === 1)
        leased.push(hydrate({ ...r, status: "leased", attempts: r.attempts + 1 }));
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
    db.prepare(
      "UPDATE kad_job_queue SET status='failed', last_error=@e, lease_until=NULL WHERE id=@id"
    ).run({ e: String(errMsg).slice(0, 500), id });
  } else {
    const backoffMs = Math.min(30000, 1000 * 2 ** job.attempts);
    const runAfter = new Date(Date.now() + backoffMs).toISOString();
    db.prepare(
      "UPDATE kad_job_queue SET status='pending', run_after=@ra, last_error=@e, lease_until=NULL WHERE id=@id"
    ).run({ ra: runAfter, e: String(errMsg).slice(0, 500), id });
  }
}

function pendingCount() {
  return db
    .prepare("SELECT COUNT(*) n FROM kad_job_queue WHERE status IN ('pending','leased')")
    .get().n;
}

module.exports = { enqueue, getJob, leaseDue, complete, fail, pendingCount };
