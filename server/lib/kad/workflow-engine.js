/**
 * @file server/lib/kad/workflow-engine.js — R&D workflow engine (phase-03 §2-5).
 *
 * The Main Agent stays the conductor (it still delegates via kad_create_delegation);
 * this engine CONSTRAINS and SEQUENCES it at the internal-API tool boundaries and
 * makes the deterministic gate decisions the agent must not be trusted to make:
 *   - drives tasks.workflow_step from state (syncStep)
 *   - QC gate B: which artifacts MUST pass a full Quality Reviewer (requiresFullQR)
 *   - auto-approval with a real parent-approval check (autoApprovalFor, spec 01 §4.2)
 *   - sensitive-content detection layer 2 (via ./sensitive) → blocking approval
 *   - step ordering (framework → syllabus → materials)
 *
 * ALL of this is scoped to workflow-bound tasks (tasks.workflow_id set). A task
 * with no workflow has no defined pipeline → freeform, agent-driven as before,
 * so pre-Phase-3 tasks (and kad-verify S1/S2) keep their exact behavior.
 *
 * FK enforcement is ON (server/db.js) — every approval row created here carries a
 * real artifact_id/task_id that already exists in the same call.
 */
const repo = require("./repo");
const sensitive = require("./sensitive");
const { emitTask, emitDept } = require("./events");

const APPROVED = new Set(["approved", "published"]);
const MATERIALS_AGENTS = new Set([
  "sub-lesson-planner",
  "sub-slide-builder",
  "sub-video-script-writer",
]);
// Ordered canonical steps of rd-standard-flow, derived from live task state.
const STEP_ORDER = ["plan", "research", "framework", "syllabus", "materials", "handoff"];
// Authoritative agent → produced artifact_type map (spec 01 §3.1 roster "Output").
// The 'materials' step is a parallel_group with no per-agent_ref in the workflow
// steps, so this map — not the step's agent_ref — is the source of truth for
// which artifact_type (and which template) a delegation to each sub-agent yields.
const AGENT_OUTPUT_TYPE = {
  "sub-curriculum-researcher": "research_report",
  "sub-program-architect": "program_framework",
  "sub-syllabus-designer": "syllabus",
  "sub-lesson-planner": "lesson_plan",
  "sub-slide-builder": "slide_outline",
  "sub-video-script-writer": "video_script",
  "sub-quality-reviewer": "quality_report",
};

function workflowFor(task) {
  if (!task || !task.workflow_id) return null;
  return repo.catalog.getWorkflow(task.workflow_id);
}

function blueprintGates(task) {
  const bp = task && task.department_id && repo.catalog.getApprovedBlueprint(task.department_id);
  return (bp && bp.data && bp.data.gates) || {};
}

function approvedArtifactExists(taskId, type) {
  return repo.artifacts
    .listArtifacts({ task_id: taskId, type })
    .some((a) => APPROVED.has(a.status));
}
function hasArtifact(taskId, type) {
  return repo.artifacts.listArtifacts({ task_id: taskId, type }).length > 0;
}

// ---- step machine -------------------------------------------------------

/** Derive the canonical current step id from live task state (idempotent). */
function deriveStepId(task) {
  if (!repo.approvals.hasApproved(task.id, "plan")) return "plan";
  if (!hasArtifact(task.id, "research_report")) return "research";
  if (!approvedArtifactExists(task.id, "program_framework")) return "framework";
  if (!approvedArtifactExists(task.id, "syllabus")) return "syllabus";
  if (task.status !== "done") return "materials";
  return "handoff";
}

/**
 * Recompute tasks.workflow_step from state and persist if it moved. Called after
 * every artifact save and every approval/report decision. Re-deriving from DB
 * (rather than incrementing on each event) is robust to the turn-based resume
 * coalescing — no lost or double-counted step transition.
 */
function syncStep(taskId) {
  const task = repo.tasks.getTask(taskId);
  const wf = workflowFor(task);
  if (!wf) return null;
  const step = deriveStepId(task);
  if (task.workflow_step !== step) {
    repo.tasks.updateTask(task.id, { workflow_step: step });
    emitTask(task.id, "kad.workflow.step", { task_id: task.id, workflow_step: step });
  }
  return step;
}

// ---- QC gate B ----------------------------------------------------------

/**
 * QC gate B (spec 01 §3.2): a full Quality Reviewer pass is required for the
 * reviewer-bound artifact TYPES (program_framework, syllabus — from
 * blueprint.gates.quality_required_for). Sensitivity is intentionally NOT a QR
 * trigger here: a sensitive artifact is already gated by its blocking
 * sensitive_content human approval (onArtifactSaved), and re-demanding a QR for a
 * stat-bearing INTERNAL artifact (research_report/lesson_plan — types that never
 * route through the Quality Reviewer) would dead-end it forever. Gated types that
 * are also sensitive still get both controls (QR via type + sensitive approval).
 */
function requiresFullQR(task, artifactType) {
  return (blueprintGates(task).quality_required_for || []).includes(artifactType);
}

function qrVerdictPass(qr) {
  if (qr.metadata && qr.metadata.verdict) return qr.metadata.verdict === "pass";
  const c = qr.content || "";
  return /ĐẠT/u.test(c) && !/CẦN\s*SỬA/u.test(c);
}

/** A passing quality_report exists for this artifact (parent link, verdict ĐẠT). */
function hasPassingQR(taskId, artifactId) {
  return repo.artifacts
    .listArtifacts({ task_id: taskId, type: "quality_report" })
    .some((q) => q.parent_artifact_id === artifactId && qrVerdictPass(q));
}

/**
 * Enforce QC gate B before an artifact is presented to a human. Returns
 * {ok:false, code, message} to block, {ok:true} otherwise. No-op for freeform
 * tasks or non-gated artifact types.
 */
function assertQualityGate(task, artifactId) {
  if (!workflowFor(task) || !artifactId) return { ok: true };
  const art = repo.artifacts.getArtifact(artifactId);
  if (!art || art.task_id !== task.id) return { ok: true };
  if (requiresFullQR(task, art.artifact_type) && !hasPassingQR(task.id, artifactId)) {
    return {
      ok: false,
      code: "EQRREQUIRED",
      message: `"${art.title}" phải qua Quality Reviewer (kết quả ĐẠT) trước khi trình duyệt — hãy giao sub-quality-reviewer review artifact này trước.`,
    };
  }
  return { ok: true };
}

// ---- step ordering ------------------------------------------------------

/** Enforce framework → syllabus → materials ordering at the delegation boundary. */
function assertStepOrder(task, toAgent) {
  if (!workflowFor(task) || !toAgent) return { ok: true };
  const name = toAgent.name;
  if (name === "sub-syllabus-designer" && !approvedArtifactExists(task.id, "program_framework")) {
    return {
      ok: false,
      code: "EORDER",
      message: "Khung chương trình chưa được duyệt — chưa thể thiết kế syllabus.",
    };
  }
  if (MATERIALS_AGENTS.has(name) && !approvedArtifactExists(task.id, "syllabus")) {
    return {
      ok: false,
      code: "EORDER",
      message: "Syllabus chưa được duyệt — chưa thể làm học liệu (song song theo module).",
    };
  }
  return { ok: true };
}

// ---- auto-approval (spec 01 §4.2) --------------------------------------

/**
 * Auto-approval decision. Returns the approval record fields to write with
 * reviewer='system', or null when the artifact needs a human (or is N/A). The
 * conditional cases check a REAL approved parent artifact in the DB — a wrong
 * condition (e.g. slide before syllabus approved) returns null → human path.
 */
function autoApprovalFor(task, artifact) {
  const t = artifact.artifact_type;
  if (t === "slide_outline") {
    return approvedArtifactExists(task.id, "syllabus")
      ? { approval_type: "artifact", decision_reason: "auto: parent approved (syllabus)" }
      : null;
  }
  if (t === "video_script") {
    return approvedArtifactExists(task.id, "lesson_plan")
      ? { approval_type: "artifact", decision_reason: "auto: parent approved (lesson_plan)" }
      : null;
  }
  // Internal steps — always auto (spec 01 §4.2 "internal_auto").
  if (t === "research_report" || t === "lesson_plan" || t === "other") {
    return { approval_type: "internal_auto", decision_reason: "auto: internal step" };
  }
  // program_framework / syllabus / quality_report / connector_draft → human (or N/A).
  return null;
}

/**
 * The artifact_type a delegation to `agent` should produce on a workflow task —
 * so the sub-agent's run is told exactly what output_type + template to use, and
 * the resulting artifact is correctly typed for the gates (QC/auto-approve). Null
 * for freeform tasks or an unmapped agent (falls back to the caller's default).
 */
function outputTypeForAgent(task, agent) {
  if (!workflowFor(task) || !agent) return null;
  return AGENT_OUTPUT_TYPE[agent.name] || null;
}

function firstTrueDim(flags) {
  if (!flags) return null;
  return flags.metrics ? "metrics" : flags.people ? "people" : flags.brand ? "brand" : null;
}

// Idempotency guard for the auto-approval branch (mirrors existingSensitiveApproval):
// onArtifactSaved may be re-invoked on the same artifact (flag-sensitivity re-scan,
// a future re-save/resubmit path) — without this, each call would create ANOTHER
// reviewer='system' approval + audit rows + realtime events for one artifact.
function existingAutoApproval(taskId, artifactId) {
  return repo.approvals
    .listByTask(taskId)
    .some((a) => a.reviewer === "system" && a.artifact_id === artifactId);
}

function existingSensitiveApproval(taskId, artifactId) {
  return repo.approvals
    .listByTask(taskId)
    .some((a) => a.approval_type === "sensitive_content" && a.artifact_id === artifactId);
}

// ---- main artifact hook -------------------------------------------------

/**
 * Called after an artifact is saved (or re-flagged). Runs, in order:
 *   1. quality_report → parse verdict, sync step, done (never auto-reviewed).
 *   2. sensitive detection (server scan + QR flags on metadata) → blocking
 *      sensitive_content approval (human).
 *   3. auto-approval (system record) when conditions hold.
 * Returns a decision object for the tool response. No-op for freeform tasks.
 */
function onArtifactSaved({ task, artifact, agent }) {
  if (!workflowFor(task)) return { engine: false };
  const out = { engine: true, autoApproved: false, sensitiveBlocked: false, qrVerdict: null };

  if (artifact.artifact_type === "quality_report") {
    out.qrVerdict = qrVerdictPass(artifact) ? "pass" : "changes";
    syncStep(task.id);
    return out;
  }

  const scan = sensitive.scan(artifact.content || "");
  const flaggedDim = firstTrueDim(artifact.metadata && artifact.metadata.sensitivity_flags);
  const subtype = scan.subtype || flaggedDim;
  const isSensitive = scan.sensitive || !!flaggedDim;

  if (isSensitive && !existingSensitiveApproval(task.id, artifact.id)) {
    let approval;
    repo.tx(() => {
      approval = repo.approvals.createApproval({
        task_id: task.id,
        requested_by: agent.id,
        approval_type: "sensitive_content",
        sensitivity_subtype: subtype,
        title: `Nội dung nhạy cảm (${subtype}): ${artifact.title}`,
        description: `Cần trưởng phòng duyệt trước khi dùng. Dấu hiệu: ${scan.hits.slice(0, 5).join("; ") || flaggedDim}`,
        artifact_id: artifact.id,
        sla_reminder_hours: 24,
      });
      if (artifact.status === "draft")
        repo.artifacts.updateArtifact(artifact.id, { status: "review" });
      repo.audit({
        department_id: task.department_id,
        task_id: task.id,
        agent_id: agent.id,
        action: "approval_requested",
        actor_type: "agent",
        actor_id: agent.id,
        target_type: "approval",
        target_id: approval.id,
        details: { approval_type: "sensitive_content", subtype },
      });
    });
    emitTask(task.id, "kad.approval.created", approval);
    emitDept(task.department_id, "kad.approval.created", approval);
    out.sensitiveBlocked = true;
    out.subtype = subtype;
    syncStep(task.id);
    return out;
  }

  const auto = autoApprovalFor(task, artifact);
  if (auto && !existingAutoApproval(task.id, artifact.id)) {
    let approval;
    repo.tx(() => {
      approval = repo.approvals.createApproval({
        task_id: task.id,
        requested_by: agent.id,
        approval_type: auto.approval_type,
        reviewer: "system",
        status: "approved",
        decision_reason: auto.decision_reason,
        title: `Tự động duyệt: ${artifact.title}`,
        artifact_id: artifact.id,
      });
      repo.artifacts.updateArtifact(artifact.id, { status: "approved" });
      repo.audit({
        department_id: task.department_id,
        task_id: task.id,
        agent_id: agent.id,
        action: "approval_requested",
        actor_type: "system",
        actor_id: "workflow-engine",
        target_type: "approval",
        target_id: approval.id,
        details: { approval_type: auto.approval_type, auto: true },
      });
      repo.audit({
        department_id: task.department_id,
        task_id: task.id,
        agent_id: agent.id,
        action: "approval_decided",
        actor_type: "system",
        actor_id: "workflow-engine",
        target_type: "approval",
        target_id: approval.id,
        details: { decision: "approved", reason: auto.decision_reason },
      });
    });
    emitTask(task.id, "kad.approval.created", approval);
    emitTask(task.id, "kad.approval.decided", approval);
    out.autoApproved = true;
    out.decisionReason = auto.decision_reason;
  }
  syncStep(task.id);
  return out;
}

module.exports = {
  workflowFor,
  syncStep,
  deriveStepId,
  requiresFullQR,
  hasPassingQR,
  assertQualityGate,
  assertStepOrder,
  autoApprovalFor,
  outputTypeForAgent,
  onArtifactSaved,
  STEP_ORDER,
};
