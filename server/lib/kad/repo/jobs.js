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
      // A dedup_key groups DIFFERENT sequential business events on the same
      // task (brief locked, then plan approved, then report decided), not
      // just retries of the same one — each caller's own route already
      // guards against re-firing the SAME event twice (409 on
      // already-decided). So an existing row here is never a true duplicate
      // of THIS payload; it is either not started yet (safe to just replace
      // its payload with the newest intent) or already leased and actively
      // running the OLD payload's turn right now.
      if (existing.status === "pending") {
        db.prepare(
          `UPDATE kad_job_queue SET kind=@kind, payload_json=@payload, run_after=@run_after WHERE id=@id`
        ).run({
          id: existing.id,
          kind,
          payload: JSON.stringify(payload || {}),
          run_after: runAfter || nowIso(),
        });
        if (process.env.KAD_JOBS_TRACE)
          console.log(
            `[jobs.enqueue TRACE] dedup=${dedupKey} PENDING hit job=${existing.id} — replaced with newest payload:`,
            JSON.stringify(payload)
          );
        return getJob(existing.id);
      }
      // status === 'leased': a worker picked this row up and is actively
      // running its OLD payload's turn RIGHT NOW — overwriting payload_json
      // is safe (the worker already read its own snapshot before
      // dispatching), but the row must not flip back to 'pending' out from
      // under that live worker. Flag requeue_after_done instead: once the
      // in-flight turn finishes, completeOrRequeue() reopens this job with
      // the newest payload rather than marking it done and losing it. This
      // was the confirmed root cause of KAD tasks getting permanently stuck
      // after a plan/report approval decided the instant it rendered —
      // faster than the prior turn's own process had exited and its
      // resume_task job been marked done (scripts/kad-verify.mjs --s2 run11
      // KAD_JOBS_TRACE evidence).
      db.prepare(
        `UPDATE kad_job_queue SET payload_json=@payload, requeue_after_done=1 WHERE id=@id`
      ).run({ id: existing.id, payload: JSON.stringify(payload || {}) });
      if (process.env.KAD_JOBS_TRACE)
        console.log(
          `[jobs.enqueue TRACE] dedup=${dedupKey} LEASED hit job=${existing.id} — payload superseded, flagged requeue_after_done:`,
          JSON.stringify(payload)
        );
      return getJob(existing.id);
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

/**
 * Complete a job UNLESS it was superseded by a newer dedup-key trigger while
 * it was leased (enqueue()'s LEASED-hit branch) — in that case reopen it as
 * 'pending' with the newest payload (already written in place) instead of
 * marking it done and losing that payload forever. Callers that drive the
 * durable job queue (job-queue.js sweep) should use this instead of
 * complete() directly.
 */
function completeOrRequeue(id) {
  const job = getJob(id);
  if (!job) return;
  if (job.requeue_after_done) {
    db.prepare(
      `UPDATE kad_job_queue
       SET status='pending', requeue_after_done=0, attempts=0, lease_until=NULL, run_after=@now
       WHERE id=@id`
    ).run({ id, now: nowIso() });
    if (process.env.KAD_JOBS_TRACE)
      console.log(
        `[jobs.completeOrRequeue TRACE] job=${id} was superseded mid-flight — requeued with newest payload instead of marking done`
      );
  } else {
    complete(id);
  }
}

/** Fail a job: requeue with backoff if attempts remain, else mark failed.
 * opts.permanent forces immediate 'failed' (malformed payload — retry is futile).
 * If the job was superseded mid-flight (requeue_after_done), always requeue
 * immediately with the newest payload regardless of this attempt's outcome —
 * the stale payload's own retry budget is irrelevant once new instructions
 * have already arrived for the same task. */
function fail(id, errMsg, opts = {}) {
  const job = getJob(id);
  if (!job) return;
  if (job.requeue_after_done) {
    db.prepare(
      `UPDATE kad_job_queue
       SET status='pending', requeue_after_done=0, attempts=0, lease_until=NULL, run_after=@now, last_error=@e
       WHERE id=@id`
    ).run({ id, now: nowIso(), e: String(errMsg).slice(0, 500) });
    return;
  }
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

module.exports = { enqueue, getJob, leaseDue, complete, completeOrRequeue, fail, pendingCount };
