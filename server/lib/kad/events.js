/**
 * @file server/lib/kad/events.js — KAD WebSocket event emitters.
 * Thin wrappers over websocket.kadBroadcast that compute the scoped channel
 * ('kad:task:<id>' / 'kad:department:<id>') per spec 03 §2. Event names match
 * the spec table (kad.message.created, kad.run.status, ...).
 */
let kadBroadcast = () => {};
try {
  ({ kadBroadcast } = require("../../websocket"));
} catch {
  /* websocket not initialized (unit tests) — emit becomes a no-op */
}

function taskScope(taskId) {
  return `kad:task:${taskId}`;
}
function deptScope(departmentId) {
  return `kad:department:${departmentId}`;
}

/** Emit a task-scoped KAD event. */
function emitTask(taskId, type, payload) {
  kadBroadcast(taskScope(taskId), type, payload);
}
/** Emit a department-scoped KAD event (board/inbox/notifications). */
function emitDept(departmentId, type, payload) {
  if (departmentId) kadBroadcast(deptScope(departmentId), type, payload);
}

module.exports = { emitTask, emitDept, taskScope, deptScope };
