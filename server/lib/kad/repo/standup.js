/**
 * @file server/lib/kad/repo/standup.js — department_standups (spec/ui/02 §5,
 * [GAP] formalized here). "Rút gọn" by design (Phase 2 Tổng quan track scope):
 * the brief is composed deterministically from real rows (doing tasks, pending
 * approvals, recent failed runs, yesterday's cost) — NOT a Main Agent LLM
 * narrative. That richer version is a later phase; this keeps every number
 * real instead of fabricating a summary.
 */
const { db, parseJson, nowIso } = require("./db");
const tasks = require("./tasks");
const approvals = require("./approvals");
// Lazy require: cost.js itself requires the repo barrel (./repo), so requiring
// it at module-load time here would cycle back into this file mid-construction
// of that barrel's exports. Deferring to call time (well after startup) breaks it.
function cost() {
  return require("../cost");
}

const EMPTY = {
  generated_at: null,
  dang_chay: [],
  cho_anh: [],
  rui_ro: [],
  cost_yesterday_tokens: 0,
  cost_yesterday_vnd: 0,
};

function hydrate(row) {
  if (!row) return null;
  const payload = parseJson(row.payload, {});
  return {
    department_id: row.department_id,
    generated_at: row.generated_at,
    dang_chay: payload.dangChay || [],
    cho_anh: payload.choAnh || [],
    rui_ro: payload.ruiRo || [],
    cost_yesterday_tokens: payload.costYesterdayTokens || 0,
    cost_yesterday_vnd: payload.costYesterdayVnd || 0,
  };
}

/** Only surface a standup generated on the current calendar day (server local) — a stale
 * row from a prior day must show the mockup's "chưa tạo giao ban hôm nay" empty state. */
function getToday(departmentId) {
  if (!departmentId) return { department_id: null, ...EMPTY };
  const row = db
    .prepare(
      "SELECT * FROM department_standups WHERE department_id=? AND date(generated_at)=date('now')"
    )
    .get(departmentId);
  return row ? hydrate(row) : { department_id: departmentId, ...EMPTY };
}

function yesterdayRangeIso() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 3_600_000);
  return { from: startOfYesterday.toISOString(), to: startOfToday.toISOString() };
}

function slaOverdue(a) {
  if (!a.sla_reminder_hours) return false;
  return Date.now() - new Date(a.created_at).getTime() > a.sla_reminder_hours * 3_600_000;
}

function buildPayload(departmentId) {
  const dangChay = tasks
    .listTasks({ status: "doing", department_id: departmentId, limit: 3 })
    .map((t) => ({ text: t.title, link_task_id: t.id }));

  const pending = approvals.listPending({ department_id: departmentId });
  const overdue = pending.filter(slaOverdue).length;
  const choAnh = pending.length
    ? [
        {
          text:
            overdue > 0
              ? `${pending.length} phê duyệt, ${overdue} quá SLA`
              : `${pending.length} phê duyệt`,
          link_task_id: null,
        },
      ]
    : [];

  const failedRuns = db
    .prepare(
      `SELECT r.id, t.id as task_id, t.title as task_title FROM task_runs r
       JOIN tasks t ON r.task_id=t.id
       WHERE t.department_id=? AND r.status='failed'
       ORDER BY r.completed_at DESC LIMIT 3`
    )
    .all(departmentId);
  const ruiRo = failedRuns.map((r) => ({
    text: `Run lỗi: ${r.task_title}`,
    link_task_id: r.task_id,
  }));

  const { from, to } = yesterdayRangeIso();
  const y = cost().estimateDeptCostForRange(departmentId, from, to);

  return { dangChay, choAnh, ruiRo, costYesterdayTokens: y.tokens, costYesterdayVnd: y.vnd };
}

function regenerate(departmentId) {
  if (!departmentId) return { department_id: null, ...EMPTY };
  const payload = buildPayload(departmentId);
  const now = nowIso();
  db.prepare(
    `INSERT INTO department_standups (department_id, generated_at, payload, updated_at)
     VALUES (@department_id, @now, @payload, @now)
     ON CONFLICT(department_id) DO UPDATE SET generated_at=@now, payload=@payload, updated_at=@now`
  ).run({ department_id: departmentId, now, payload: JSON.stringify(payload) });
  return getToday(departmentId);
}

module.exports = { getToday, regenerate };
