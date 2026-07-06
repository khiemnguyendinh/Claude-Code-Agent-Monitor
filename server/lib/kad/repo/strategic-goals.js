/**
 * @file server/lib/kad/repo/strategic-goals.js — "Mục tiêu & chiến lược"
 * (client/src/kad/pages/MucTieuChienLuoc.tsx). Direct-write, no draft/approve
 * gate by design — the department head enters this straight, matching the
 * existing UI comment in store.tsx ("ghi thẳng, không qua bước Gửi duyệt").
 */
const { db, audit, newId, nowIso } = require("./db");

const STATUS_VALUES = new Set(["on_track", "at_risk", "off_track"]);

function firstOrg() {
  return db.prepare("SELECT * FROM organization_profiles ORDER BY created_at ASC LIMIT 1").get();
}

function assertLen(name, value, max, required = false) {
  const s = String(value ?? "").trim();
  if (required && !s) throw new Error(`${name} is required`);
  if (s.length > max) throw new Error(`${name} must be <=${max} chars`);
  return s;
}

function normalizeGoal(g, index) {
  const title = assertLen("goal.title", g.title, 200, true);
  const status = STATUS_VALUES.has(g.status) ? g.status : "on_track";
  return {
    id: g.id && String(g.id).trim() ? String(g.id) : newId("goal"),
    title,
    metric: assertLen("goal.metric", g.metric, 200),
    current_value: Number.isFinite(Number(g.current_value ?? g.current))
      ? Number(g.current_value ?? g.current)
      : 0,
    target_value: Number.isFinite(Number(g.target_value ?? g.target))
      ? Number(g.target_value ?? g.target)
      : 0,
    due_date: g.due_date || g.due || null,
    status,
    sort_order: Number.isFinite(Number(g.sort_order)) ? Number(g.sort_order) : index,
  };
}

function listGoals(org_id) {
  const orgId = org_id || (firstOrg() || {}).id;
  if (!orgId) return [];
  return db
    .prepare("SELECT * FROM strategic_goals WHERE org_id=? ORDER BY sort_order ASC, created_at ASC")
    .all(orgId);
}

/** Bulk replace, same pattern as org-context.js's replaceOrgChart — small list, no external FK points at individual rows. */
function replaceGoals(org_id, goals, { actor_id = "human" } = {}) {
  const org = org_id
    ? db.prepare("SELECT * FROM organization_profiles WHERE id=?").get(org_id)
    : firstOrg();
  if (!org) throw new Error("organization not found");
  const list = Array.isArray(goals) ? goals : [];
  if (list.length > 100) throw new Error("goals max 100");
  const normalized = list.map(normalizeGoal);
  const now = nowIso();
  db.transaction(() => {
    db.prepare("DELETE FROM strategic_goals WHERE org_id=?").run(org.id);
    const ins = db.prepare(
      `INSERT INTO strategic_goals
       (id, org_id, title, metric, current_value, target_value, due_date, status, sort_order, created_at, updated_at)
       VALUES (@id,@org_id,@title,@metric,@current_value,@target_value,@due_date,@status,@sort_order,@now,@now)`
    );
    for (const g of normalized) ins.run({ ...g, org_id: org.id, now });
    audit({
      action: "goals_changed",
      actor_type: "human",
      actor_id,
      target_type: "strategic_goals",
      target_id: org.id,
      details: { count: normalized.length },
    });
  })();
  return listGoals(org.id);
}

function getStrategy(org_id) {
  const org = org_id
    ? db.prepare("SELECT * FROM organization_profiles WHERE id=?").get(org_id)
    : firstOrg();
  if (!org) return { strategy_markdown: "", strategy_updated_at: null };
  return {
    strategy_markdown: org.strategy_markdown || "",
    strategy_updated_at: org.strategy_updated_at || null,
  };
}

function saveStrategy(org_id, markdown, { actor_id = "human" } = {}) {
  const org = org_id
    ? db.prepare("SELECT * FROM organization_profiles WHERE id=?").get(org_id)
    : firstOrg();
  if (!org) throw new Error("organization not found");
  const clean = assertLen("strategy_markdown", markdown, 20000);
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      "UPDATE organization_profiles SET strategy_markdown=@md, strategy_updated_at=@now, updated_at=@now WHERE id=@id"
    ).run({ id: org.id, md: clean, now });
    audit({
      action: "goals_changed",
      actor_type: "human",
      actor_id,
      target_type: "strategy",
      target_id: org.id,
      details: { chars: clean.length },
    });
  })();
  return getStrategy(org.id);
}

module.exports = { listGoals, replaceGoals, getStrategy, saveStrategy };
