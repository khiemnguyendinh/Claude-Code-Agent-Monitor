/**
 * @file server/lib/kad/dependency-worker.js — task_dependencies (DAG) auto-
 * release. Phase 3 (spec 02 §6b, spec 03 §5.4, audit-260704 §5.2): "Worker
 * mỗi tick kiểm tra" — this runs as a plain check inside the job-queue tick
 * (see job-queue.js), NOT a leased `kad_job_queue` row, since it's a stateless
 * table scan with nothing to dedupe/lease. Automation rules (event/threshold/
 * schedule — the `evaluate_rules`/`run_schedule` job kinds) are Phase 6.5,
 * untouched here.
 *
 * Releasing a dependency never spawns an agent or spends budget — it only
 * flips the blocked task back to 'inbox' (still requires a human to open the
 * task and send the first message before any run starts).
 */
const repo = require("./repo");
const { emitDept } = require("./events");

/** True once `dep`'s source condition is actually satisfied — checked against real rows, never assumed. */
function isSatisfied(dep) {
  if (!dep.depends_on_task_id) {
    // Schema also allows an artifact_type-only row (no source task) per the
    // route's OR-validation, but spec 02 §6b's own comment frames
    // depends_on_artifact_type as a refinement "trong depends_on_task_id" —
    // i.e. always scoped to a source task. Without one there is no spec-
    // defined condition to check, so leave it waiting rather than guess.
    return false;
  }
  if (dep.release_condition === "dep_task_done") {
    const source = repo.tasks.getTask(dep.depends_on_task_id);
    return !!source && source.status === "done";
  }
  if (dep.release_condition === "dep_artifact_approved") {
    const approved = repo.artifacts.listArtifacts({
      task_id: dep.depends_on_task_id,
      status: "approved",
    });
    return dep.depends_on_artifact_type
      ? approved.some((a) => a.artifact_type === dep.depends_on_artifact_type)
      : approved.length > 0;
  }
  // 'all_deps_done': not creatable via the current API — spec/ui/09 §6 defers
  // AND/OR combinators past V1. No caller produces this value today, so
  // there's no real semantics to implement yet; never auto-satisfy it.
  return false;
}

/** Releases one satisfied dependency; unblocks its task if that was the last waiting one. */
function releaseOne(dep) {
  repo.tx(() => {
    repo.dependencies.release(dep.id);
    if (repo.dependencies.countWaiting(dep.task_id) > 0) return;
    const task = repo.tasks.getTask(dep.task_id);
    if (!task || task.status !== "blocked") return;
    repo.tasks.updateTask(task.id, { status: "inbox" });
    repo.audit({
      department_id: task.department_id,
      task_id: task.id,
      action: "dependency_released",
      actor_type: "system",
      actor_id: "dependency-worker",
      target_type: "task_dependency",
      target_id: dep.id,
      details: {
        depends_on_task_id: dep.depends_on_task_id,
        release_condition: dep.release_condition,
      },
    });
    // spec 03 §5.4 event payload {task_id, dep_ids[]}; kad.task.status too so
    // every list already watching task status (Tự động hoá, inbox) refreshes
    // the same way it does for the manual "Gỡ điều kiện" release path.
    emitDept(task.department_id, "kad.task.released", { task_id: task.id, dep_ids: [dep.id] });
    emitDept(task.department_id, "kad.task.status", { task_id: task.id, status: "inbox" });
  });
}

/** Scans every waiting dependency and releases the ones whose condition is now true. */
function checkReleases() {
  for (const dep of repo.dependencies.listWaiting()) {
    try {
      if (isSatisfied(dep)) releaseOne(dep);
    } catch (e) {
      console.warn(`[kad] dependency-worker: dep ${dep.id} check failed:`, e && e.message);
    }
  }
}

module.exports = { checkReleases };
