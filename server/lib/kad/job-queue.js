/**
 * @file server/lib/kad/job-queue.js — durable job worker (spec 02 §6b, 04 §4).
 * ONE coalesced worker loop (a running flag prevents overlapping sweeps, same
 * pattern the monitor uses in server/index.js). Leases due jobs, dispatches by
 * kind to an idempotent handler, marks done/fail-with-backoff. Survives restart:
 * jobs live in kad_job_queue, and reconcile_runs cleans orphaned runs on boot.
 *
 * Phase 1 kinds wired: reconcile_runs, resume_task, start_delegation.
 * Phase 3 adds task_dependencies auto-release — not a `kind` (nothing to
 * lease/dedup, it's a stateless scan), so it runs directly every sweep tick
 * (see dependencyWorker.checkReleases() below). Phase 6.5 wires the automation
 * kinds: `evaluate_rules` (event-driven, enqueued when a task reaches done) and
 * `run_schedule` (a forceable trigger of the due-schedule sweep, which also runs
 * every tick alongside dependency release). unknown `kind` rows still fail loudly.
 */
const repo = require("./repo");
const orchestrator = require("./orchestrator");
const dependencyWorker = require("./dependency-worker");
const automation = require("./automation");

const TICK_MS = Number(process.env.KAD_WORKER_TICK_MS || 2000);
let timer = null;
let sweeping = false;

// A malformed payload is a permanent failure (retrying won't fix it) — signal that
// with a non-retryable marker so the sweep marks the job failed immediately.
class PermanentJobError extends Error {}

const handlers = {
  async reconcile_runs() {
    const n = orchestrator.reconcileRuns();
    if (n) console.log(`[kad-worker] reconcile_runs: cleaned ${n} orphan run(s)`);
  },
  async resume_task(payload) {
    if (!payload || !payload.task_id)
      throw new PermanentJobError("resume_task payload missing task_id");
    await orchestrator.resumeTaskTurn(payload.task_id, {
      message: payload.message,
      engineSessionId: payload.engine_session_id,
    });
  },
  async start_delegation(payload) {
    if (!payload || !payload.delegation_id)
      throw new PermanentJobError("start_delegation payload missing delegation_id");
    await orchestrator.runDelegation(payload.delegation_id);
  },
  async pattern_detect(payload) {
    const { department_id, category } = payload;
    if (!department_id || !category) throw new PermanentJobError("pattern_detect missing fields");
    const notes = repo.db.prepare(`
      SELECT * FROM learning_notes
      WHERE department_id=? AND correction_category=? AND created_at > datetime('now', '-30 days')
    `).all(department_id, category);

    // Spec 01 §5: Pattern detection >= 3 notes in same category/30 days
    const hasPattern = notes.some(n => n.trigger_type === 'pattern_detection');
    if (!hasPattern && notes.length >= 3) {
      repo.learning.createNote({
        department_id,
        trigger_type: "pattern_detection",
        correction_category: category,
        severity: "critical",
        root_cause: `Phát hiện lỗi lặp lại (${notes.length} lần trong 30 ngày) cho danh mục: ${category}`,
        prevention: "Cần cập nhật system_prompt hoặc workflow để giải quyết triệt để",
        affected_areas: ["system"],
        proposed_change_target: "blueprint",
        change_status: "noted" // MVP stops here, does not auto-propose
      });
    }
  },
  // Phase 6.5 — a business event fired (e.g. a task reached done). Evaluate
  // every enabled event rule in the department against it. Idempotent per event:
  // each rule's own cooldown/max_fires/loop guards decide whether it acts.
  async evaluate_rules(payload) {
    if (!payload || !payload.department_id)
      throw new PermanentJobError("evaluate_rules payload missing department_id");
    automation.evaluateEventRules({
      department_id: payload.department_id,
      event: payload.event,
      task_id: payload.task_id,
    });
  },
  // Phase 6.5 — forceable trigger of the due-schedule sweep (the same sweep runs
  // every tick; this kind lets a caller/verify demand it explicitly).
  async run_schedule() {
    automation.sweepSchedules();
  },
};

async function runOne(job) {
  const handler = handlers[job.kind];
  if (!handler) throw new Error(`no handler for job kind '${job.kind}'`);
  if (process.env.KAD_JOBS_TRACE)
    console.log(
      `[job-queue TRACE] running job=${job.id} kind=${job.kind} dedup=${job.dedup_key}`,
      JSON.stringify(job.payload)
    );
  await handler(job.payload || {});
}

async function sweep() {
  if (sweeping) return; // coalesce — never overlap sweeps
  sweeping = true;
  try {
    dependencyWorker.checkReleases(); // spec 02 §6b / audit-260704 §5.2 — every tick
    // Phase 6.5 — fire any automation schedule now due + evaluate metric_threshold
    // rules against live values (cheap enabled-rule scans, same "stateless per-tick"
    // shape as dependency release). Each logs its own bad-rule errors internally.
    automation.sweepSchedules();
    automation.evaluateMetricRules();
    const jobs = repo.jobs.leaseDue(3);
    if (process.env.KAD_JOBS_TRACE && jobs.length)
      console.log(
        `[job-queue TRACE] sweep leased ${jobs.length} job(s):`,
        jobs.map((j) => `${j.id}(${j.kind})`)
      );
    for (const job of jobs) {
      try {
        await runOne(job);
        repo.jobs.completeOrRequeue(job.id);
      } catch (err) {
        console.warn(`[kad-worker] job ${job.id} (${job.kind}) failed:`, err && err.message);
        // Permanent (malformed) errors won't fix on retry — fail immediately.
        repo.jobs.fail(job.id, err && err.message, { permanent: err instanceof PermanentJobError });
      }
    }
  } finally {
    sweeping = false;
  }
}

/** Start the worker. Enqueues a reconcile_runs job first (crash recovery). */
function startWorker() {
  if (timer) return;
  repo.jobs.enqueue({ kind: "reconcile_runs", payload: {}, dedupKey: "reconcile_runs:boot" });
  timer = setInterval(() => {
    sweep().catch((e) => console.warn("[kad-worker] sweep error:", e && e.message));
  }, TICK_MS);
  if (timer.unref) timer.unref();
  console.log("[kad-worker] started (tick", TICK_MS + "ms)");
}

function stopWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startWorker, stopWorker, sweep };
