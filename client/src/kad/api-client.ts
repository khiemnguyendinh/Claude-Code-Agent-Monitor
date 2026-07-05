/**
 * client/src/kad/api-client.ts — shared typed client for `/api/kad/*`
 * (Phase 1 real backend). This is the "nền cho 2B/2C" mentioned in the Phase 2
 * handoff: every KAD screen wires through here, not fetch() ad-hoc.
 *
 * The server returns raw SQLite rows (snake_case). `types.ts` is the UI
 * contract (camelCase) the approved mockup was built against, so every
 * top-level row gets adapted here once. Nested JSON metadata that THIS
 * backend authors itself (brief/report payloads, intake options) is already
 * written in the camelCase shape types.ts expects — see
 * server/routes/kad/internal.js kad_propose_brief / kad_present_report — so
 * those pass through unchanged.
 */
import { dashboardToken } from "../lib/api";
import { formatDurationSeconds, formatTokens, formatVnd } from "./format";
import type {
  Approval,
  ApprovalStatus,
  Artifact,
  ArtifactStatus,
  ArtifactType,
  AgentProfile,
  Priority,
  StandupBrief,
  StandupLine,
  TaskCard,
  TaskDelegation,
  TaskMessage,
  TaskMessageType,
  TaskStatus,
} from "./types";

const BASE = "/api/kad";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = dashboardToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { "x-dashboard-token": token } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Row adapters (snake_case DB row -> camelCase types.ts contract) ────────

export interface TaskRow {
  id: string;
  department_id: string | null;
  workflow_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  working_dir: string | null;
  priority: Priority;
  due_date: string | null;
  assigned_agent_id: string | null;
  brief: BriefRow | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  counts?: {
    messages: number;
    runs: number;
    artifacts: number;
    approvals: number;
    delegations: number;
  };
}

interface BriefRow {
  goal: string;
  deliverable: string;
  workflowName: string;
  workingDir: string | null;
  attachmentCount: number;
  dueLabel: string;
  frameworkLabel?: string;
  assumption?: string;
  decidedAt?: string | null;
}

export interface KadTask {
  id: string;
  departmentId: string | null;
  workflowId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  workingDir: string | null;
  priority: Priority;
  dueDate: string | null;
  assignedAgentId: string | null;
  brief: BriefRow | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function toTask(row: TaskRow): KadTask {
  return {
    id: row.id,
    departmentId: row.department_id,
    workflowId: row.workflow_id,
    title: row.title,
    description: row.description,
    status: row.status,
    workingDir: row.working_dir,
    priority: row.priority,
    dueDate: row.due_date,
    assignedAgentId: row.assigned_agent_id,
    brief: row.brief,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

// Wire shape of a `report` message's cost — server computes real numbers
// (server/lib/kad/cost.js); the UI contract (types.ts ReportPayload.cost)
// wants them pre-formatted (vi-VN, spec/ui/06 §13). Reshaped in toMessage()
// below so formatting logic lives in one place (format.ts). `costRaw` is kept
// alongside for cost-to-date aggregation math (not part of the mock contract,
// additive field).
interface WireReportCost {
  durationSeconds: number;
  tokens: number;
  vnd: number;
  agentName: string;
}
interface WireReport {
  version: number;
  summary: string;
  artifacts: { artifactId: string; title: string }[];
  needsDecision?: string[];
  blocker?: string;
  cost: WireReportCost;
  decision: { status: "approved" | "needs_changes"; at: string; reason?: string } | null;
}

export interface MessageRow {
  id: string;
  task_id: string;
  sender_type: "human" | "agent";
  sender_id: string | null;
  content: string;
  message_type: TaskMessageType;
  metadata: (Omit<NonNullable<TaskMessage["metadata"]>, "report"> & { report?: WireReport }) | null;
  created_at: string;
}

export function toMessage(row: MessageRow): TaskMessage {
  const wireReport = row.metadata?.report;
  const metadata: TaskMessage["metadata"] | undefined = row.metadata
    ? {
        ...row.metadata,
        report: wireReport
          ? {
              ...wireReport,
              cost: {
                duration: formatDurationSeconds(wireReport.cost.durationSeconds),
                tokens: formatTokens(wireReport.cost.tokens),
                vnd: formatVnd(wireReport.cost.vnd),
                agentName: wireReport.cost.agentName,
              },
              costRaw: wireReport.cost,
            }
          : undefined,
      }
    : undefined;
  return {
    id: row.id,
    taskId: row.task_id,
    senderType: row.sender_type,
    senderId: row.sender_id ?? "system",
    content: row.content,
    messageType: row.message_type,
    metadata,
    createdAt: row.created_at,
  };
}

export interface ApprovalRow {
  id: string;
  task_id: string;
  requested_by: string;
  approval_type: Approval["approvalType"];
  sensitivity_subtype: Approval["sensitivitySubtype"];
  title: string;
  description: string | null;
  artifact_id: string | null;
  status: ApprovalStatus;
  reviewer: "human" | "system";
  decision_reason: string | null;
  sla_reminder_hours: number | null;
  created_at: string;
  /** Only present on GET /approvals (department-level list) — decorated server-side. */
  task_title?: string | null;
}

export function toApproval(row: ApprovalRow, taskTitle = ""): Approval {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title ?? taskTitle,
    requestedByAgentId: row.requested_by,
    approvalType: row.approval_type,
    sensitivitySubtype: row.sensitivity_subtype,
    title: row.title,
    description: row.description ?? "",
    artifactId: row.artifact_id,
    status: row.status,
    reviewer: row.reviewer,
    decisionReason: row.decision_reason,
    slaReminderHours: row.sla_reminder_hours,
    createdAt: row.created_at,
  };
}

interface ArtifactRow {
  id: string;
  task_id: string;
  agent_id: string | null;
  artifact_type: ArtifactType;
  title: string;
  content: string | null;
  parent_artifact_id: string | null;
  status: ArtifactStatus;
  version: number;
  metadata: {
    quality_score?: number;
    sensitivity?: { metrics?: boolean; people?: boolean; brand?: boolean };
  } | null;
  created_at: string;
  updated_at: string;
}

export function toArtifact(row: ArtifactRow): Artifact {
  const sens = row.metadata?.sensitivity;
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id ?? "",
    artifactType: row.artifact_type,
    title: row.title,
    content: row.content ?? "",
    parentArtifactId: row.parent_artifact_id,
    status: row.status,
    version: row.version,
    qualityScore: row.metadata?.quality_score ?? null,
    sensitivityFlags: { metrics: !!sens?.metrics, people: !!sens?.people, brand: !!sens?.brand },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface DelegationRow {
  id: string;
  task_id: string;
  from_agent_id: string;
  to_agent_id: string;
  instruction: string;
  status: TaskDelegation["status"];
  retry_count: number;
  run_id: string | null;
  output_artifact_id: string | null;
  created_at: string;
  updated_at: string;
}

export function toDelegation(row: DelegationRow): TaskDelegation {
  return {
    id: row.id,
    taskId: row.task_id,
    fromAgentId: row.from_agent_id,
    toAgentId: row.to_agent_id,
    instruction: row.instruction,
    status: row.status,
    retryCount: row.retry_count,
    runId: row.run_id,
    outputArtifactId: row.output_artifact_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface AgentRow {
  id: string;
  agent_type: AgentProfile["agentType"];
  name: string;
  display_name: string;
  title: string | null;
  engine: AgentProfile["engine"];
  model: string | null;
  role_description: string | null;
  permissions: Record<string, boolean>;
  status: AgentProfile["status"];
  parent_agent_id: string | null;
}

export function toAgent(row: AgentRow): AgentProfile {
  return {
    id: row.id,
    agentType: row.agent_type,
    name: row.name,
    displayName: row.display_name,
    title: row.title ?? "",
    engine: row.engine,
    model: row.model ?? "",
    roleDescription: row.role_description ?? "",
    permissions: {
      createTask: !!row.permissions?.create_task,
      assignTask: !!row.permissions?.assign_task,
      createHelper: !!row.permissions?.create_helper,
      readOrgContext: !!row.permissions?.read_org_context,
      readTemplates: !!row.permissions?.read_templates,
      webSearch: !!row.permissions?.web_search,
      requestApproval: !!row.permissions?.request_approval,
      writeAudit: !!row.permissions?.write_audit,
      publishConnector: !!row.permissions?.publish_connector,
      modifyBlueprint: !!row.permissions?.modify_blueprint,
      modifyOrgContext: !!row.permissions?.modify_org_context,
    },
    skills: [],
    status: row.status,
    parentAgentId: row.parent_agent_id,
    jdVersion: 1,
    jdApprovedAt: "",
  };
}

export interface KadRun {
  id: string;
  taskId: string;
  agentId: string;
  engine: string;
  engineSessionId: string | null;
  status: "pending" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
}

// ── Real workflow_definitions row — deliberately NOT forced into the mock's
// WorkflowDefinition/WorkflowStepDef shape (types.ts), which was modeled after
// the giao-viec quickstart cards and doesn't match this table's real columns.
export interface KadWorkflowStep {
  id: string;
  name: string;
  node_type: string;
  agent_ref?: string;
  output_type?: string;
  approval?: boolean;
}
export interface KadWorkflow {
  id: string;
  name: string;
  description: string | null;
  steps: KadWorkflowStep[];
}

export type KadTimelineItem =
  | { kind: "message"; at: string; data: TaskMessage }
  | { kind: "run"; at: string; data: KadRun }
  | { kind: "delegation"; at: string; data: TaskDelegation }
  | { kind: "approval"; at: string; data: Approval }
  | { kind: "artifact"; at: string; data: Artifact };

interface TimelineRow {
  kind: KadTimelineItem["kind"];
  at: string;
  data: unknown;
}

function toTimelineItem(row: TimelineRow, taskTitle: string): KadTimelineItem | null {
  switch (row.kind) {
    case "message":
      return { kind: "message", at: row.at, data: toMessage(row.data as MessageRow) };
    case "approval":
      return { kind: "approval", at: row.at, data: toApproval(row.data as ApprovalRow, taskTitle) };
    case "delegation":
      return { kind: "delegation", at: row.at, data: toDelegation(row.data as DelegationRow) };
    case "artifact":
      return { kind: "artifact", at: row.at, data: toArtifact(row.data as ArtifactRow) };
    case "run": {
      const r = row.data as {
        id: string;
        task_id: string;
        agent_id: string;
        engine: string;
        engine_session_id: string | null;
        status: KadRun["status"];
        started_at: string;
        completed_at: string | null;
      };
      return {
        kind: "run",
        at: row.at,
        data: {
          id: r.id,
          taskId: r.task_id,
          agentId: r.agent_id,
          engine: r.engine,
          engineSessionId: r.engine_session_id,
          status: r.status,
          startedAt: r.started_at,
          completedAt: r.completed_at,
        },
      };
    }
    default:
      return null;
  }
}

// Trimmed GET /reports/overview (phase-02 §5 minimal bar) — used mainly to
// bootstrap the current department id for department-scoped fetches/WS.
export interface OverviewRow {
  department_id: string | null;
  tasks_by_status: Record<string, number>;
  pending_approvals: number;
  active_runs: number;
  pending_jobs: number;
}
export interface KadOverview {
  departmentId: string | null;
  tasksByStatus: Record<string, number>;
  pendingApprovals: number;
  activeRuns: number;
  pendingJobs: number;
}
function toOverview(row: OverviewRow): KadOverview {
  return {
    departmentId: row.department_id,
    tasksByStatus: row.tasks_by_status,
    pendingApprovals: row.pending_approvals,
    activeRuns: row.active_runs,
    pendingJobs: row.pending_jobs,
  };
}

// GET/POST /standup/today — [GAP] formalized in server/lib/kad/repo/standup.js.
// Rút gọn: deterministic aggregation, not a Main Agent narrative.
export interface StandupRow {
  department_id: string | null;
  generated_at: string | null;
  dang_chay: { text: string; link_task_id: string | null }[];
  cho_anh: { text: string; link_task_id: string | null }[];
  rui_ro: { text: string; link_task_id: string | null }[];
  cost_yesterday_tokens: number;
  cost_yesterday_vnd: number;
}
function toStandupLine(l: { text: string; link_task_id: string | null }): StandupLine {
  return l.link_task_id ? { text: l.text, linkTaskId: l.link_task_id } : { text: l.text };
}
function toStandup(row: StandupRow): StandupBrief {
  return {
    generatedAt: row.generated_at,
    dangChay: row.dang_chay.map(toStandupLine),
    choAnh: row.cho_anh.map(toStandupLine),
    ruiRo: row.rui_ro.map(toStandupLine),
    costYesterdayTokens: row.cost_yesterday_tokens,
    costYesterdayVnd: row.cost_yesterday_vnd,
  };
}

// ── Public API ──────────────────────────────────────────────────────────

export const kadApi = {
  tasks: {
    create: (input: {
      title: string;
      description?: string;
      priority?: Priority;
      working_dir?: string | null;
      workflow_id?: string | null;
    }) => request<TaskRow>("/tasks", { method: "POST", body: JSON.stringify(input) }).then(toTask),
    get: (id: string) => request<TaskRow>(`/tasks/${encodeURIComponent(id)}`).then(toTask),
    list: (params?: { status?: string; department?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.department) qs.set("department", params.department);
      if (params?.limit) qs.set("limit", String(params.limit));
      const q = qs.toString();
      return request<TaskRow[]>(`/tasks${q ? `?${q}` : ""}`).then((rows) => rows.map(toTask));
    },
    sendMessage: (id: string, content: string) =>
      request<{ message: MessageRow; run_kicked: boolean }>(
        `/tasks/${encodeURIComponent(id)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ content }),
        }
      ).then((r) => ({ message: toMessage(r.message), runKicked: r.run_kicked })),
    timeline: (id: string, taskTitle = "") =>
      request<TimelineRow[]>(`/tasks/${encodeURIComponent(id)}/timeline`).then((rows) =>
        rows
          .map((r) => toTimelineItem(r, taskTitle))
          .filter((x): x is KadTimelineItem => x !== null)
      ),
    lockBrief: (id: string) =>
      request<{ message: MessageRow; resume_enqueued: boolean }>(
        `/tasks/${encodeURIComponent(id)}/brief/lock`,
        { method: "POST" }
      ).then((r) => ({
        message: toMessage(r.message),
        resumeEnqueued: r.resume_enqueued,
      })),
    decideReport: (
      taskId: string,
      messageId: string,
      decision: "approved" | "needs_changes",
      reason?: string
    ) =>
      request<{ message: MessageRow; resume_enqueued: boolean }>(
        `/tasks/${encodeURIComponent(taskId)}/report/${encodeURIComponent(messageId)}/decide`,
        { method: "POST", body: JSON.stringify({ decision, reason }) }
      ).then((r) => ({ message: toMessage(r.message), resumeEnqueued: r.resume_enqueued })),
    cancelRun: (id: string) =>
      request<{ cancelled: string[] }>(`/tasks/${encodeURIComponent(id)}/cancel-run`, {
        method: "POST",
      }),
  },

  approvals: {
    // Only 'pending' is a first-class list server-side (Phase 1) — matches the
    // Tổng quan inbox (spec/ui/02 §6), which only ever wants pending anyway.
    list: (params?: { department?: string }) => {
      const qs = new URLSearchParams();
      if (params?.department) qs.set("department", params.department);
      const q = qs.toString();
      return request<ApprovalRow[]>(`/approvals${q ? `?${q}` : ""}`).then((rows) =>
        rows.map((r) => toApproval(r))
      );
    },
    decide: (id: string, decision: ApprovalStatus, reason?: string | null) =>
      request<{ approval: ApprovalRow; resume_enqueued: boolean }>(
        `/approvals/${encodeURIComponent(id)}/decide`,
        {
          method: "POST",
          body: JSON.stringify({ decision, reason: reason ?? undefined }),
        }
      ).then((r) => ({ approval: toApproval(r.approval), resumeEnqueued: r.resume_enqueued })),
  },

  reports: {
    overview: (department?: string) => {
      const qs = department ? `?department=${encodeURIComponent(department)}` : "";
      return request<OverviewRow>(`/reports/overview${qs}`).then(toOverview);
    },
  },

  standup: {
    today: (department?: string) => {
      const qs = department ? `?department=${encodeURIComponent(department)}` : "";
      return request<StandupRow>(`/standup/today${qs}`).then(toStandup);
    },
    regenerate: (department?: string) => {
      const qs = department ? `?department=${encodeURIComponent(department)}` : "";
      return request<StandupRow>(`/standup/today/regenerate${qs}`, { method: "POST" }).then(
        toStandup
      );
    },
  },

  artifacts: {
    get: (id: string) =>
      request<ArtifactRow>(`/artifacts/${encodeURIComponent(id)}`).then(toArtifact),
    list: (params: { task_id?: string; type?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params.task_id) qs.set("task", params.task_id);
      if (params.type) qs.set("type", params.type);
      if (params.status) qs.set("status", params.status);
      return request<ArtifactRow[]>(`/artifacts?${qs.toString()}`).then((rows) =>
        rows.map(toArtifact)
      );
    },
  },

  agents: {
    list: () => request<AgentRow[]>("/agents").then((rows) => rows.map(toAgent)),
  },

  workflows: {
    get: (id: string) => request<KadWorkflow>(`/workflows/${encodeURIComponent(id)}`),
  },

  runs: {
    // `monitor_session_id` bridges to /he-thong/sessions/:id (spec 03) — used by
    // the Delegation Card's trace link.
    get: (id: string) =>
      request<{ monitor_session_id: string | null }>(`/runs/${encodeURIComponent(id)}`),
  },
};

/** Adapt a real task row into the mock's lightweight TaskCard (used by store.tsx's task list assumptions). */
export function taskRowToCard(t: KadTask): TaskCard {
  return {
    id: t.id,
    parentTaskId: null,
    title: t.title,
    status: t.status,
    projectTitle: "Chưa gắn dự án",
    dueDate: t.dueDate,
    assignedAgentId: t.assignedAgentId,
    hasFailedRun: false,
    retryCount: 0,
    priority: t.priority,
    updatedAt: t.updatedAt,
    workingDir: t.workingDir,
  };
}
