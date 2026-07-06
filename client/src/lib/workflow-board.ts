/**
 * @file workflow-board.ts
 * @description Adapter layer for the Kanban "Workflow" view. Merges the two
 * REAL workflow execution sources into one board-item shape:
 *   1. KAD workflow-bound tasks (/api/kad/tasks with workflow_id set) — the
 *      operational unit tied to a project/hạng mục, stepped by the KAD
 *      workflow engine (tasks.workflow_step).
 *   2. Claude Code Workflow-tool runs (/api/workflows/runs) — fleet runs
 *      ingested from on-disk journals. These have no project linkage unless
 *      their task_id matches a KAD task → otherwise grouped as "Unlinked".
 * No mock data: when both sources are empty the board shows an honest empty
 * state. This module is pure fetch+map so a future backend workflow_run table
 * can slot in without touching the board UI.
 */
import { api } from "./api";
import { kadApi } from "../kad/api-client";
import type { KadTask, KadWorkflow } from "../kad/api-client";
import type { WorkflowProgressEntry, WorkflowRun } from "./types";

/** progress[] "workflow_phase" markers carry a `title` not declared on the
 *  shared type (index-signature only) — narrow it here once. */
export function progressEntryTitle(entry: WorkflowProgressEntry | null | undefined): string | null {
  const t = entry?.["title"];
  return typeof t === "string" ? t : null;
}

export type WorkflowBoardStatus = "queued" | "running" | "waiting_approval" | "blocked" | "done";

export const WORKFLOW_COLUMNS: WorkflowBoardStatus[] = [
  "queued",
  "running",
  "waiting_approval",
  "blocked",
  "done",
];

/** Column header config mirroring STATUS_CONFIG's shape (labelKey/color/dot). */
export const WORKFLOW_STATUS_CONFIG: Record<
  WorkflowBoardStatus,
  { labelKey: string; color: string; dot: string }
> = {
  queued: { labelKey: "wf.queued", color: "text-kad-text-muted", dot: "bg-slate-400" },
  running: { labelKey: "wf.running", color: "text-emerald-400", dot: "bg-emerald-400" },
  waiting_approval: {
    labelKey: "wf.waitingApproval",
    color: "text-yellow-400",
    dot: "bg-yellow-400",
  },
  blocked: { labelKey: "wf.blocked", color: "text-red-400", dot: "bg-red-400" },
  done: { labelKey: "wf.done", color: "text-sky-400", dot: "bg-sky-400" },
};

export interface WorkflowBoardStep {
  key: string;
  name: string;
  state: "pending" | "running" | "waiting_approval" | "blocked" | "done";
  requiresApproval: boolean;
  /** Agent responsible for the step, when the source knows it. */
  agentRef?: string | null;
}

export interface WorkflowBoardItem {
  /** Peek/card id: "kadtask:<taskId>" or "ccrun:<runId>". */
  id: string;
  source: "kad-task" | "cc-run";
  sourceId: string;
  title: string;
  /** Project / hạng mục label; null → "Unlinked" group. */
  projectLabel: string | null;
  workflowKey: string;
  workflowName: string;
  /** Skill/plugin key when known (KAD workflows have none today). */
  skillKey: string | null;
  currentStep: string | null;
  stepsDone: number;
  stepsTotal: number;
  status: WorkflowBoardStatus;
  agentLabel: string | null;
  sessionId: string | null;
  needsApproval: boolean;
  updatedAt: string;
}

/** KAD task status → board column. */
export function mapKadTaskStatus(status: string): WorkflowBoardStatus {
  switch (status) {
    case "inbox":
    case "triaged":
      return "queued";
    case "doing":
    case "review":
      return "running";
    case "waiting_human":
    case "needs_changes":
      return "waiting_approval";
    case "blocked":
    case "failed":
      return "blocked";
    case "done":
    case "archived":
      return "done";
    default:
      return "queued";
  }
}

/** CC Workflow-tool run status → board column. */
export function mapCcRunStatus(status: string): WorkflowBoardStatus {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "done";
    case "error":
    case "failed":
      return "blocked";
    default:
      return "queued";
  }
}

function kadTaskToItem(task: KadTask, wf: KadWorkflow | null): WorkflowBoardItem {
  const steps = wf?.steps ?? [];
  const stepIdx = task.workflowStep ? steps.findIndex((s) => s.id === task.workflowStep) : -1;
  const status = mapKadTaskStatus(task.status);
  const currentStepDef = stepIdx >= 0 ? steps[stepIdx] : null;
  return {
    id: `kadtask:${task.id}`,
    source: "kad-task",
    sourceId: task.id,
    title: task.title,
    projectLabel: task.workingDir || task.departmentId,
    workflowKey: wf?.name ?? task.workflowId ?? "",
    workflowName: wf?.name ?? task.workflowId ?? "",
    skillKey: null,
    currentStep: currentStepDef?.name ?? task.workflowStep,
    stepsDone: status === "done" ? steps.length : Math.max(0, stepIdx),
    stepsTotal: steps.length,
    status,
    agentLabel: task.assignedAgentId,
    sessionId: null,
    needsApproval: status === "waiting_approval" || Boolean(currentStepDef?.approval),
    updatedAt: task.updatedAt,
  };
}

function ccRunToItem(run: WorkflowRun, kadTaskById: Map<string, KadTask>): WorkflowBoardItem {
  const linkedTask = run.task_id ? kadTaskById.get(run.task_id) : undefined;
  const phases = run.phases ?? [];
  // Journal is terminal-only: a completed run has all phases done; a live run
  // exposes phases seen so far in progress[] (may be 0 — shown honestly).
  const phaseMarkers = (run.progress ?? []).filter((p) => p.type === "workflow_phase");
  const stepsDone =
    run.status === "completed" ? phases.length : Math.max(0, phaseMarkers.length - 1);
  const lastPhase = phaseMarkers.length > 0 ? phaseMarkers[phaseMarkers.length - 1] : null;
  return {
    id: `ccrun:${run.run_id}`,
    source: "cc-run",
    sourceId: run.run_id,
    title: run.name || run.run_id,
    projectLabel: linkedTask ? linkedTask.title : null,
    workflowKey: run.name || run.run_id,
    workflowName: run.name || run.run_id,
    skillKey: null,
    currentStep: run.status === "completed" ? null : progressEntryTitle(lastPhase),
    stepsDone,
    stepsTotal: phases.length,
    status: mapCcRunStatus(run.status),
    agentLabel: run.agent_count > 0 ? `${run.agent_count} agents` : null,
    sessionId: run.session_id,
    needsApproval: false,
    updatedAt: run.updated_at || run.ended_at || run.started_at || run.created_at,
  };
}

/**
 * Fetch + merge both sources. Each source fails soft (empty list) so one dead
 * API never blanks the whole board.
 */
export async function fetchWorkflowBoardItems(): Promise<WorkflowBoardItem[]> {
  const [kadTasks, runsRes] = await Promise.all([
    kadApi.tasks.list({ limit: 500 }).catch(() => [] as KadTask[]),
    api.workflows.runs({ limit: 500 }).catch(() => ({ runs: [] as WorkflowRun[] })),
  ]);

  const workflowTasks = kadTasks.filter((t) => t.workflowId);
  const kadTaskById = new Map(kadTasks.map((t) => [t.id, t]));

  // One catalog fetch per distinct workflow definition (step list + approval flags).
  const wfIds = [...new Set(workflowTasks.map((t) => t.workflowId as string))];
  const wfEntries = await Promise.all(
    wfIds.map(async (id) => {
      try {
        return [id, await kadApi.workflows.get(id)] as const;
      } catch {
        return [id, null] as const;
      }
    })
  );
  const wfById = new Map<string, KadWorkflow | null>(wfEntries);

  const items = [
    ...workflowTasks.map((t) => kadTaskToItem(t, wfById.get(t.workflowId as string) ?? null)),
    ...runsRes.runs.map((r) => ccRunToItem(r, kadTaskById)),
  ];
  // Newest activity first inside each column.
  items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return items;
}
