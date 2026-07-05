/**
 * @file server/lib/kad/repo/task-dependencies.js — task_dependencies (spec 02
 * §6b, spec/ui/09). Phase 2c wired create/read/manual-release. Phase 3 adds
 * `listWaiting()`, consumed by `../dependency-worker.js` (the real
 * auto-release check — dep_task_done/dep_artifact_approved — run every job
 * queue tick per audit-260704 §5.2), and `wouldCreateCycle()`, called by the
 * route before creating a dependency to reject self/transitive cycles.
 */
const { db, newId, nowIso } = require("./db");

function getDependency(id) {
  return db.prepare("SELECT * FROM task_dependencies WHERE id=?").get(id) || null;
}

function listByTask(task_id) {
  return db
    .prepare("SELECT * FROM task_dependencies WHERE task_id=? ORDER BY created_at ASC")
    .all(task_id);
}

function countWaiting(task_id) {
  return db
    .prepare("SELECT COUNT(*) n FROM task_dependencies WHERE task_id=? AND status='waiting'")
    .get(task_id).n;
}

/** All rows still waiting on their release condition, across every task (worker sweep). */
function listWaiting() {
  return db
    .prepare("SELECT * FROM task_dependencies WHERE status='waiting' ORDER BY created_at ASC")
    .all();
}

/** Creates the dependency row. Caller (route) also flips task.status='blocked'. */
function createDependency({
  task_id,
  depends_on_task_id,
  depends_on_artifact_type,
  release_condition,
}) {
  const id = newId("dep");
  db.prepare(
    `INSERT INTO task_dependencies (id, task_id, depends_on_task_id, depends_on_artifact_type, release_condition, status, created_at)
     VALUES (@id,@task_id,@depends_on_task_id,@depends_on_artifact_type,@release_condition,'waiting',@now)`
  ).run({
    id,
    task_id,
    depends_on_task_id: depends_on_task_id ?? null,
    depends_on_artifact_type: depends_on_artifact_type ?? null,
    release_condition,
    now: nowIso(),
  });
  return getDependency(id);
}

/**
 * Self-dependency or a transitive cycle across 'waiting' edges would block a
 * task forever (Phase 3/6.5's evaluate_rules worker only ever releases a
 * 'waiting' edge whose condition becomes true — a cycle's condition never
 * does). BFS over what `dependsOnTaskId` itself (transitively) depends on;
 * if that walk reaches `taskId`, adding taskId -> dependsOnTaskId closes a loop.
 */
function wouldCreateCycle(taskId, dependsOnTaskId) {
  if (taskId === dependsOnTaskId) return true;
  const seen = new Set([dependsOnTaskId]);
  const queue = [dependsOnTaskId];
  const nextEdges = db.prepare(
    `SELECT depends_on_task_id FROM task_dependencies
     WHERE task_id=? AND status='waiting' AND depends_on_task_id IS NOT NULL`
  );
  while (queue.length) {
    const current = queue.shift();
    for (const { depends_on_task_id } of nextEdges.all(current)) {
      if (depends_on_task_id === taskId) return true;
      if (!seen.has(depends_on_task_id)) {
        seen.add(depends_on_task_id);
        queue.push(depends_on_task_id);
      }
    }
  }
  return false;
}

/** Manual "Gỡ điều kiện" (spec/ui/09 §3) — marks this dependency released. */
function release(id) {
  const dep = getDependency(id);
  if (!dep) return null;
  db.prepare("UPDATE task_dependencies SET status='released', released_at=@now WHERE id=@id").run({
    id,
    now: nowIso(),
  });
  return getDependency(id);
}

module.exports = {
  getDependency,
  listByTask,
  countWaiting,
  listWaiting,
  createDependency,
  wouldCreateCycle,
  release,
};
