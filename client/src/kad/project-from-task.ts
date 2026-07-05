/**
 * [Phase 7 hardening, spec/ui/08] Derive a `Project` (the mock-era shape
 * `SegmentedProgress`/`ProjectPeek` already render) from a REAL task +
 * its workflow definition. There is no `/api/kad/projects` endpoint in spec
 * 03 — every task that runs a workflow already IS a "project" in the current
 * data model, so this reads real `tasks` + `workflow_definitions` rows
 * instead of inventing a new aggregation endpoint.
 *
 * Per-step state comes from `tasks.workflow_step` (the workflow engine's own
 * durable "current step" marker, spec 02) + `tasks.status` — not from
 * matching delegations back to steps by agent name, which would be a guess.
 */
import type { KadTask, KadWorkflowStep } from "./api-client";
import type { AgentProfile, Project, ProjectStepProgress, StepState } from "./types";

export function deriveProjectSteps(
  workflowSteps: KadWorkflowStep[],
  task: KadTask,
  agentsByName: Map<string, AgentProfile>
): ProjectStepProgress[] {
  const currentIndex = task.workflowStep
    ? workflowSteps.findIndex((s) => s.id === task.workflowStep)
    : -1;
  return workflowSteps.map((step, i) => {
    let state: StepState;
    if (task.status === "done") state = "done";
    else if (currentIndex === -1) state = "todo";
    else if (i < currentIndex) state = "done";
    else if (i > currentIndex) state = "todo";
    else if (task.status === "failed") state = "failed";
    else if (task.status === "waiting_human") state = "waiting_human";
    else state = "doing";
    return {
      key: step.id,
      label: step.name,
      state,
      agentId: step.agent_ref ? agentsByName.get(step.agent_ref)?.id : undefined,
    };
  });
}

export function taskToProject(
  task: KadTask,
  workflowSteps: KadWorkflowStep[],
  agentsByName: Map<string, AgentProfile>
): Project {
  const steps = deriveProjectSteps(workflowSteps, task, agentsByName);
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    workflowId: task.workflowId || "",
    steps,
    itemsDone: steps.filter((s) => s.state === "done").length,
    itemsTotal: steps.length,
    agentIdsInvolved: Array.from(new Set(steps.map((s) => s.agentId).filter(Boolean))) as string[],
    dueDate: task.dueDate,
    priority: task.priority,
    hasBlocker: task.status === "blocked" || task.status === "needs_changes" || task.status === "failed",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
