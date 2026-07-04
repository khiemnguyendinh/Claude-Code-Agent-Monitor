/**
 * @file server/lib/kad/repo/artifacts.js — artifacts (agent outputs).
 */
const { db, parseJson, newId, nowIso } = require("./db");

function hydrate(row) {
  return row ? { ...row, metadata: parseJson(row.metadata, null) } : null;
}

function createArtifact({ task_id, agent_id, artifact_type, title, content, file_path, parent_artifact_id, template_version_id, org_context_version_id, status, metadata }) {
  const id = newId("artifact");
  const now = nowIso();
  db.prepare(
    `INSERT INTO artifacts
     (id, task_id, agent_id, artifact_type, title, content, file_path, parent_artifact_id, template_version_id, org_context_version_id, status, version, metadata, created_at, updated_at)
     VALUES (@id,@task_id,@agent_id,@type,@title,@content,@file_path,@parent,@tplver,@orgver,@status,1,@metadata,@now,@now)`
  ).run({
    id,
    task_id,
    agent_id: agent_id ?? null,
    type: artifact_type,
    title,
    content: content ?? null,
    file_path: file_path ?? null,
    parent: parent_artifact_id ?? null,
    tplver: template_version_id ?? null,
    orgver: org_context_version_id ?? null,
    status: status ?? "draft",
    metadata: metadata != null ? JSON.stringify(metadata) : null,
    now,
  });
  return getArtifact(id);
}

function getArtifact(id) {
  return hydrate(db.prepare("SELECT * FROM artifacts WHERE id=?").get(id));
}

function updateArtifact(id, { status, content, metadata, bumpVersion }) {
  const sets = [];
  const p = { id, now: nowIso() };
  if (status !== undefined) (sets.push("status=@status"), (p.status = status));
  if (content !== undefined) (sets.push("content=@content"), (p.content = content));
  if (metadata !== undefined) (sets.push("metadata=@metadata"), (p.metadata = metadata != null ? JSON.stringify(metadata) : null));
  if (bumpVersion) sets.push("version=version+1");
  sets.push("updated_at=@now");
  db.prepare(`UPDATE artifacts SET ${sets.join(", ")} WHERE id=@id`).run(p);
  return getArtifact(id);
}

function listArtifacts({ task_id, type, status } = {}) {
  const where = [];
  const args = [];
  if (task_id) (where.push("task_id=?"), args.push(task_id));
  if (type) (where.push("artifact_type=?"), args.push(type));
  if (status) (where.push("status=?"), args.push(status));
  const sql = "SELECT * FROM artifacts" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY created_at ASC";
  return db.prepare(sql).all(...args).map(hydrate);
}

module.exports = { createArtifact, getArtifact, updateArtifact, listArtifacts };
