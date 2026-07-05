/**
 * @file server/lib/kad/repo/task-dependencies.js — task_dependencies (spec 02
 * §6b, spec/ui/09). Phase 3/6.5 own the worker that actually releases a
 * dependency when its condition is true (`evaluate_rules` job) — this repo
 * only covers create/read/manual-release, which is all Phase 2c wires.
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
  createDependency,
  wouldCreateCycle,
  release,
};
