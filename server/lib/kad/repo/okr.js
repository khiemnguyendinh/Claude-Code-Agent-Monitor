/**
 * @file server/lib/kad/repo/okr.js — "Đội ngũ ▸ Mục tiêu" OKR tree
 * (objectives + key_results, migration kad-006-okr.sql). Fully manual —
 * created/edited via the API, no seeded rows — unlike this tab's other panel
 * (KPIs), which is computed live from real activity data in reports.js and
 * has no table of its own. `health`/`confidence` are ALWAYS derived here from
 * current_value/target_value, never stored as free-form input (the stored
 * `objectives.confidence` column is only the fallback for an objective with
 * zero key results — nothing to derive from yet).
 */
const { db, audit, newId, nowIso } = require("./db");

const LEVEL_VALUES = new Set(["company", "department"]);
const CYCLE_VALUES = new Set(["year", "quarter"]);
const CONFIDENCE_VALUES = new Set(["on_track", "at_risk", "off_track"]);
const DIRECTION_VALUES = new Set(["up", "down"]);

/** Divide-by-zero guard shared by health() below and reports.js' KPI health. */
const EPSILON = 1e-9;

/**
 * Progress ratio + health bucket for one metric, direction-aware.
 * up:   progress = current / target (more is better)
 * down: progress = target / current (less is better, e.g. cost)
 * Guards target=0 and current=0 so a fresh/empty metric never divides by
 * zero — an unset "down" metric (current=0) reads as perfect progress
 * (nothing spent yet is not literally "on_track" in the on-track SENSE, but
 * there's no real overspend to flag either); an unset "up" metric with a
 * real target reads as 0 progress ("off_track" until real work lands).
 * @param {number} current
 * @param {number} target
 * @param {'up'|'down'} direction
 * @returns {{progress:number, health:'on_track'|'at_risk'|'off_track'}}
 */
function healthFor(current, target, direction) {
  const cur = Number.isFinite(current) ? current : 0;
  const tgt = Number.isFinite(target) ? target : 0;
  let progress;
  if (direction === "down") {
    progress = tgt <= 0 ? 1 : tgt / Math.max(cur, EPSILON);
  } else {
    progress = tgt <= 0 ? (cur > 0 ? 1 : 0) : cur / tgt;
  }
  const health = progress >= 0.9 ? "on_track" : progress >= 0.6 ? "at_risk" : "off_track";
  return { progress, health };
}

/** Worst-of-KRs confidence: any off_track wins, else any at_risk, else on_track. */
function confidenceFromKeyResults(keyResults) {
  if (!keyResults.length) return null; // caller falls back to the stored column
  if (keyResults.some((kr) => kr.health === "off_track")) return "off_track";
  if (keyResults.some((kr) => kr.health === "at_risk")) return "at_risk";
  return "on_track";
}

function hydrateKeyResult(row) {
  if (!row) return null;
  const { health } = healthFor(row.current_value, row.target_value, row.direction);
  return { ...row, health };
}

function assertLen(name, value, max, required = false) {
  const s = String(value ?? "").trim();
  if (required && !s) throw new Error(`${name} is required`);
  if (s.length > max) throw new Error(`${name} must be <=${max} chars`);
  return s;
}

function assertNumber(name, value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`);
  return n;
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

function getObjectiveRow(id) {
  return db.prepare("SELECT * FROM objectives WHERE id=?").get(id);
}

/** One ObjectiveRow with its key_results nested + derived confidence. */
function hydrateObjective(row) {
  if (!row) return null;
  const keyResults = db
    .prepare("SELECT * FROM key_results WHERE objective_id=? ORDER BY created_at ASC")
    .all(row.id)
    .map(hydrateKeyResult);
  const derived = confidenceFromKeyResults(keyResults);
  return {
    ...row,
    confidence: derived ?? row.confidence,
    key_results: keyResults,
  };
}

/**
 * @param {{department_id?:string, level?:'company'|'department'}} [opts]
 * @returns {object[]} ObjectiveRow[]
 */
function listObjectives({ department_id, level } = {}) {
  const where = [];
  const args = [];
  if (department_id) (where.push("department_id=?"), args.push(department_id));
  if (level) (where.push("level=?"), args.push(level));
  const sql =
    "SELECT * FROM objectives" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY created_at ASC";
  return db
    .prepare(sql)
    .all(...args)
    .map(hydrateObjective);
}

function getObjective(id) {
  return hydrateObjective(getObjectiveRow(id));
}

/**
 * @param {{department_id?:string, level:'company'|'department', cycle:'year'|'quarter',
 *   period:string, title:string, owner_id?:string, parent_objective_id?:string}} input
 * @returns {object} ObjectiveRow (key_results: [])
 */
function createObjective({
  department_id,
  level,
  cycle,
  period,
  title,
  owner_id,
  parent_objective_id,
}) {
  if (!LEVEL_VALUES.has(level)) throw new Error("level must be 'company' or 'department'");
  if (!CYCLE_VALUES.has(cycle)) throw new Error("cycle must be 'year' or 'quarter'");
  const cleanTitle = assertLen("title", title, 300, true);
  const cleanPeriod = assertLen("period", period, 50, true);
  if (level === "department" && !department_id) {
    throw new Error("department_id is required for a department-level objective");
  }
  if (parent_objective_id && !getObjectiveRow(parent_objective_id)) {
    throw new Error("parent_objective_id does not reference an existing objective");
  }
  const id = newId("obj");
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO objectives
       (id, department_id, level, cycle, period, title, owner_id, parent_objective_id, confidence, created_at, updated_at)
       VALUES (@id,@department_id,@level,@cycle,@period,@title,@owner_id,@parent_objective_id,'on_track',@now,@now)`
    ).run({
      id,
      department_id: department_id ?? null,
      level,
      cycle,
      period: cleanPeriod,
      title: cleanTitle,
      owner_id: owner_id ?? null,
      parent_objective_id: parent_objective_id ?? null,
      now,
    });
    audit({
      department_id: department_id ?? null,
      action: "objective_created",
      actor_type: "human",
      actor_id: owner_id ?? "human",
      target_type: "objective",
      target_id: id,
      details: { title: cleanTitle, level, cycle, period: cleanPeriod },
    });
  })();
  return getObjective(id);
}

/**
 * @param {string} id
 * @param {{title?:string, period?:string, owner_id?:string, confidence?:string, parent_objective_id?:string|null}} patch
 * @returns {object|null} ObjectiveRow, or null if not found
 */
function updateObjective(id, patch = {}) {
  const existing = getObjectiveRow(id);
  if (!existing) return null;
  const sets = [];
  const params = { id, now: nowIso() };
  if (patch.title !== undefined) {
    sets.push("title=@title");
    params.title = assertLen("title", patch.title, 300, true);
  }
  if (patch.period !== undefined) {
    sets.push("period=@period");
    params.period = assertLen("period", patch.period, 50, true);
  }
  if (patch.owner_id !== undefined) {
    sets.push("owner_id=@owner_id");
    params.owner_id = patch.owner_id || null;
  }
  if (patch.confidence !== undefined) {
    if (!CONFIDENCE_VALUES.has(patch.confidence)) {
      throw new Error("confidence must be one of on_track|at_risk|off_track");
    }
    sets.push("confidence=@confidence");
    params.confidence = patch.confidence;
  }
  if (patch.parent_objective_id !== undefined) {
    if (patch.parent_objective_id && !getObjectiveRow(patch.parent_objective_id)) {
      throw new Error("parent_objective_id does not reference an existing objective");
    }
    if (patch.parent_objective_id === id) {
      throw new Error("an objective cannot be its own parent");
    }
    sets.push("parent_objective_id=@parent_objective_id");
    params.parent_objective_id = patch.parent_objective_id || null;
  }
  if (!sets.length) return getObjective(id); // no-op patch — return current state
  sets.push("updated_at=@now");
  db.transaction(() => {
    db.prepare(`UPDATE objectives SET ${sets.join(", ")} WHERE id=@id`).run(params);
    audit({
      department_id: existing.department_id,
      action: "objective_updated",
      actor_type: "human",
      actor_id: patch.owner_id ?? existing.owner_id ?? "human",
      target_type: "objective",
      target_id: id,
      details: { patch: Object.keys(patch) },
    });
  })();
  return getObjective(id);
}

// ---------------------------------------------------------------------------
// Key results
// ---------------------------------------------------------------------------

function getKeyResultRow(id) {
  return db.prepare("SELECT * FROM key_results WHERE id=?").get(id);
}

/**
 * @param {{objective_id:string, title:string, metric?:string, current_value?:number,
 *   target_value?:number, unit?:string, direction?:'up'|'down', owner_id?:string}} input
 * @returns {object|null} KeyResultRow, or null if objective_id does not exist
 */
function createKeyResult({
  objective_id,
  title,
  metric,
  current_value,
  target_value,
  unit,
  direction,
  owner_id,
}) {
  const objective = getObjectiveRow(objective_id);
  if (!objective) return null;
  const cleanTitle = assertLen("title", title, 300, true);
  const cleanMetric = assertLen("metric", metric, 200);
  const cleanDirection = DIRECTION_VALUES.has(direction) ? direction : "up";
  const cur = assertNumber("current_value", current_value, 0);
  const tgt = assertNumber("target_value", target_value, 0);
  const id = newId("kr");
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO key_results
       (id, objective_id, title, metric, current_value, target_value, unit, direction, owner_id, created_at, updated_at)
       VALUES (@id,@objective_id,@title,@metric,@current_value,@target_value,@unit,@direction,@owner_id,@now,@now)`
    ).run({
      id,
      objective_id,
      title: cleanTitle,
      metric: cleanMetric || null,
      current_value: cur,
      target_value: tgt,
      unit: unit || null,
      direction: cleanDirection,
      owner_id: owner_id ?? null,
      now,
    });
    audit({
      department_id: objective.department_id,
      action: "key_result_created",
      actor_type: "human",
      actor_id: owner_id ?? "human",
      target_type: "key_result",
      target_id: id,
      details: { objective_id, title: cleanTitle },
    });
  })();
  return hydrateKeyResult(getKeyResultRow(id));
}

/**
 * @param {string} id
 * @param {{title?:string, metric?:string, current_value?:number, target_value?:number,
 *   unit?:string, direction?:'up'|'down', owner_id?:string}} patch
 * @returns {object|null} KeyResultRow, or null if not found
 */
function updateKeyResult(id, patch = {}) {
  const existing = getKeyResultRow(id);
  if (!existing) return null;
  const sets = [];
  const params = { id, now: nowIso() };
  if (patch.title !== undefined) {
    sets.push("title=@title");
    params.title = assertLen("title", patch.title, 300, true);
  }
  if (patch.metric !== undefined) {
    sets.push("metric=@metric");
    params.metric = assertLen("metric", patch.metric, 200) || null;
  }
  if (patch.current_value !== undefined) {
    sets.push("current_value=@current_value");
    params.current_value = assertNumber("current_value", patch.current_value, 0);
  }
  if (patch.target_value !== undefined) {
    sets.push("target_value=@target_value");
    params.target_value = assertNumber("target_value", patch.target_value, 0);
  }
  if (patch.unit !== undefined) {
    sets.push("unit=@unit");
    params.unit = patch.unit || null;
  }
  if (patch.direction !== undefined) {
    if (!DIRECTION_VALUES.has(patch.direction)) throw new Error("direction must be 'up' or 'down'");
    sets.push("direction=@direction");
    params.direction = patch.direction;
  }
  if (patch.owner_id !== undefined) {
    sets.push("owner_id=@owner_id");
    params.owner_id = patch.owner_id || null;
  }
  if (!sets.length) return hydrateKeyResult(existing); // no-op patch
  sets.push("updated_at=@now");
  const objective = getObjectiveRow(existing.objective_id);
  db.transaction(() => {
    db.prepare(`UPDATE key_results SET ${sets.join(", ")} WHERE id=@id`).run(params);
    audit({
      department_id: objective ? objective.department_id : null,
      action: "key_result_updated",
      actor_type: "human",
      actor_id: patch.owner_id ?? existing.owner_id ?? "human",
      target_type: "key_result",
      target_id: id,
      details: { patch: Object.keys(patch) },
    });
  })();
  return hydrateKeyResult(getKeyResultRow(id));
}

module.exports = {
  healthFor,
  listObjectives,
  getObjective,
  createObjective,
  updateObjective,
  createKeyResult,
  updateKeyResult,
};
