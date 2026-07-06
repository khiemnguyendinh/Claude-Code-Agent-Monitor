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
import { formatDurationSeconds, formatRelativeTime, formatTokens, formatVnd } from "./format";
import type {
  Approval,
  ApprovalStatus,
  Artifact,
  ArtifactStatus,
  ArtifactType,
  AgentProfile,
  AutomationActionType,
  AutomationRule,
  AutomationRuleFire,
  AutomationTriggerType,
  DependencyCondition,
  Goal,
  Priority,
  RuleFireResult,
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

/** Multipart POST — deliberately skips request()'s JSON Content-Type so the browser sets its own boundary. */
async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const token = dashboardToken();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: token ? { "x-dashboard-token": token } : undefined,
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Row adapters (snake_case DB row -> camelCase types.ts contract) ────────

export interface TaskRow {
  id: string;
  department_id: string | null;
  workflow_id: string | null;
  workflow_step: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  working_dir: string | null;
  priority: Priority;
  due_date: string | null;
  assigned_agent_id: string | null;
  brief: BriefRow | null;
  activation?: "manual" | "dependency" | "schedule" | "rule";
  origin_rule_id?: string | null;
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
  // [Phase 7 hardening] step key the workflow engine last advanced to
  // (spec 02 tasks.workflow_step) — real progress signal for the "Tiến độ dự
  // án" strip's per-step state, no need to infer it from delegations.
  workflowStep: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  workingDir: string | null;
  priority: Priority;
  dueDate: string | null;
  assignedAgentId: string | null;
  brief: BriefRow | null;
  // Phase 6.5 — provenance for automation-created tasks. originRuleId != null +
  // status 'inbox' = an auto-task in the "chờ xác nhận" queue (Tự động hoá).
  activation: "manual" | "dependency" | "schedule" | "rule";
  originRuleId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function toTask(row: TaskRow): KadTask {
  return {
    id: row.id,
    departmentId: row.department_id,
    workflowId: row.workflow_id,
    workflowStep: row.workflow_step,
    title: row.title,
    description: row.description,
    status: row.status,
    workingDir: row.working_dir,
    priority: row.priority,
    dueDate: row.due_date,
    assignedAgentId: row.assigned_agent_id,
    brief: row.brief,
    activation: row.activation ?? "manual",
    originRuleId: row.origin_rule_id ?? null,
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
  file_path: string | null;
  parent_artifact_id: string | null;
  status: ArtifactStatus;
  version: number;
  metadata: {
    quality_score?: number;
    sensitivity?: { metrics?: boolean; people?: boolean; brand?: boolean };
    // Phase 6 — /hoc-lieu uploads (loose files or a folder), set by
    // server/routes/kad/artifacts-upload.js. Absent on agent-generated rows.
    source?: "uploaded";
    original_name?: string;
    mime_type?: string;
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
    hasFile: row.file_path != null,
    source: row.metadata?.source === "uploaded" ? "uploaded" : "generated",
    fileName: row.metadata?.original_name ?? null,
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
  skills: string[];
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
    skills: Array.isArray(row.skills) ? row.skills : [],
    status: row.status,
    parentAgentId: row.parent_agent_id,
    jdVersion: 1,
    jdApprovedAt: "",
  };
}

export interface GoalRow {
  id: string;
  title: string;
  metric: string | null;
  current_value: number;
  target_value: number;
  due_date: string | null;
  status: Goal["status"];
}

export function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    metric: row.metric ?? "",
    current: row.current_value ?? 0,
    target: row.target_value ?? 0,
    due: row.due_date ?? "—",
    status: row.status || "on_track",
  };
}

export interface GoalsAndStrategyRow {
  goals: GoalRow[];
  strategy_markdown: string;
  strategy_updated_at: string | null;
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

// ── Workflow list (spec/ui/07 §1 quickstart cards) — real workflow_definitions
// has no short Vietnamese display label column (`name` is the kebab-case
// internal id, e.g. 'rd-standard-flow'; `description` is a full sentence, not
// a caption) — shown as-is rather than inventing a label not backed by data.
export interface WorkflowSummaryRow {
  id: string;
  name: string;
  description: string | null;
  example_prompt: string | null;
  trigger_keywords: string[];
  status: string;
}
export interface KadWorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  examplePrompt: string;
  triggerKeywords: string[];
}
function toWorkflowSummary(row: WorkflowSummaryRow): KadWorkflowSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    examplePrompt: row.example_prompt ?? "",
    triggerKeywords: row.trigger_keywords ?? [],
  };
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

// ── task_dependencies (spec 02 §6b, spec/ui/09 §1) ──────────────────────────

export interface DependencyRow {
  id: string;
  task_id: string;
  depends_on_task_id: string | null;
  depends_on_artifact_type: string | null;
  release_condition: DependencyCondition | "all_deps_done";
  status: "waiting" | "released" | "cancelled";
  released_at: string | null;
  created_at: string;
}

// ── automation_rules (spec 02 §6b, spec/ui/09 §3) ───────────────────────────
// trigger_config/action_config are opaque JSON server-side; the shape below
// (`{freq,time,weekday,day,label}`) is what the Giao việc composer writes for
// trigger_type='schedule' — the only kind this track's UI creates. Rows of
// other trigger/action types (created elsewhere, e.g. Phase 6.5) still parse,
// just fall back to plainer labels below.
interface ScheduleTriggerConfig {
  freq?: string;
  time?: string;
  weekday?: string;
  day?: string;
  label?: string;
}
interface CreateTaskActionConfig {
  brief?: string;
  working_dir?: string | null;
  workflow_id?: string | null;
}
export interface AutomationRuleRow {
  id: string;
  department_id: string;
  name: string;
  trigger_type: AutomationTriggerType;
  trigger_config: ScheduleTriggerConfig & Record<string, unknown>;
  action_type: AutomationActionType;
  action_config: CreateTaskActionConfig & Record<string, unknown>;
  approval_required: 0 | 1;
  enabled: 0 | 1;
  fire_count: number;
  last_fired_at: string | null;
  created_at: string;
  fires: {
    id: string;
    rule_id: string;
    fired_at: string;
    trigger_ref: string | null;
    action_task_id: string | null;
    result: RuleFireResult;
    note: string | null;
  }[];
}

function truncateLabel(text: string, max = 42): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function ruleActionLabel(row: AutomationRuleRow): string {
  switch (row.action_type) {
    case "create_task":
      return `Tạo việc: ${truncateLabel(row.action_config.brief ?? row.name)}`;
    case "run_briefing":
      return "Tạo Báo cáo đầu ngày";
    case "notify":
      return "Cảnh báo trưởng phòng";
    case "pause_department":
      return "Tạm dừng phòng ban";
  }
}

function ruleDryRun30d(row: AutomationRuleRow): string {
  if (row.trigger_type === "schedule") return `Theo lịch: ${row.trigger_config.label ?? "—"}`;
  return "Sẽ kích khi điều kiện đạt — xem lịch sử kích bên dưới.";
}

export function toAutomationRule(row: AutomationRuleRow): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    trigger: { type: row.trigger_type, label: row.trigger_config.label ?? row.trigger_type },
    actionType: row.action_type,
    actionLabel: ruleActionLabel(row),
    approvalRequired: Boolean(row.approval_required),
    enabled: Boolean(row.enabled),
    lastFiredAtLabel: row.last_fired_at ? formatRelativeTime(row.last_fired_at) : null,
    fireCount: row.fire_count,
    dryRun30d: ruleDryRun30d(row),
    fires: row.fires.map(
      (f): AutomationRuleFire => ({
        id: f.id,
        firedAt: f.fired_at,
        triggerRef: f.trigger_ref ?? "",
        result: f.result,
        note: f.note ?? undefined,
      })
    ),
  };
}

export interface AttachmentRow {
  id: string;
  task_id: string;
  message_id: string | null;
  file_name: string;
  mime: string | null;
  size: number | null;
  storage_path: string;
  created_at: string;
}

// Phase 4 knowledge APIs. These are additive wire types for the real backend;
// types.ts remains the approved UI contract.
export interface OrgProfileRow {
  id?: string;
  name: string;
  logo_path?: string | null;
  industry?: string | null;
  size?: "1-10" | "11-50" | "51-200" | "201-500" | "500+" | null;
  founded_year?: number | null;
}

export interface OrgContextData {
  vision: string;
  mission: string;
  core_values: string[];
  brand: {
    voice: string;
    guideline: string;
    primary_color?: string;
    font?: string;
    slogan?: string;
  };
  products: { name: string; description: string; target_audience: string }[];
  personas: {
    name: string;
    demographics: string;
    needs: string;
    pain_points: string;
    channels: string;
  }[];
  strategy: { goals: string; priorities: string; constraints: string; roadmap: string };
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  competitors: { name: string; strengths: string; weaknesses: string; differentiator: string }[];
  department_role: string;
  pedagogy_standards?: string;
  responsible_human?: string;
}

export interface OrgContextVersionRow {
  id: string;
  org_id: string;
  version: number;
  status: "draft" | "approved" | "archived";
  data: OrgContextData & Record<string, unknown>;
  change_summary: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface WizardDraftRow extends OrgContextVersionRow {
  profile?: OrgProfileRow | null;
}

export interface OrgChartNodeRow {
  id: string;
  org_id?: string;
  parent_id: string | null;
  name: string;
  node_type: "company" | "department" | "position";
  lead_name: string | null;
  mission: string | null;
  sort_order: number;
}

export interface TemplateVersionRow {
  id: string;
  template_id: string;
  version: number;
  content: string;
  // Phase 5 — set only for .docx/.pdf/.xlsx uploads; null for the original .md
  // path, which keeps the real content inline as before.
  file_path: string | null;
  mime_type: string | null;
  original_file_name: string | null;
  change_summary: string | null;
  status: "draft" | "approved" | "archived";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface TemplateLibraryRow {
  id: string;
  department_id: string | null;
  name: string;
  template_type: string;
  purpose: string | null;
  owner: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  latest_version: TemplateVersionRow | null;
  approved_version: TemplateVersionRow | null;
  usage_count: number;
}

export interface TemplateUsageRow {
  id: string;
  template_id: string;
  template_version_id: string;
  task_id: string | null;
  artifact_id: string | null;
  agent_id: string | null;
  used_at: string;
  task_title?: string | null;
  artifact_title?: string | null;
  agent_display_name?: string | null;
}

export interface BlueprintRow {
  id: string;
  department_id: string;
  version: number;
  status: "draft" | "pending_approval" | "approved" | "archived";
  data: Record<string, unknown>;
  proposed_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

// [Phase 7 hardening] server/routes/kad/learning.js response shape — same
// field names as the DB row (spec 02 learning_notes), no camelCase adapter
// needed since the UI (LearningNotes.tsx) already renders these raw.
export interface LearningNoteRow {
  id: string;
  department_id: string;
  task_id: string | null;
  correction_category: string;
  severity: "minor" | "major" | "critical";
  root_cause: string;
  prevention: string;
  affected_areas: string[];
  proposed_change_target: string;
  change_status: "noted" | "proposed" | "approved" | "applied" | "archived";
  created_at: string;
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
      attachment_names?: string[];
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
    sendMessage: (id: string, content: string, attachmentNames?: string[]) =>
      request<{ message: MessageRow; run_kicked: boolean }>(
        `/tasks/${encodeURIComponent(id)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ content, attachment_names: attachmentNames }),
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
    // Phase 6.5 — confirm an auto-task in the "chờ xác nhận" queue → kicks the
    // first Main Agent turn (server/routes/kad/tasks.js POST /:id/confirm).
    confirm: (id: string) =>
      request<{ task_id: string; confirmed: boolean; run_kicked: boolean }>(
        `/tasks/${encodeURIComponent(id)}/confirm`,
        { method: "POST" }
      ),
    // [Phase 7 hardening] real per-task delegation history — powers the
    // "Tiến độ dự án" strip's per-agent progress (spec/ui/08's "Thành viên AI
    // & tiến độ") from actual task_delegations rows instead of mock data.
    delegations: (id: string) =>
      request<DelegationRow[]>(`/tasks/${encodeURIComponent(id)}/delegations`).then((rows) =>
        rows.map(toDelegation)
      ),
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
    // Học liệu "artifact vault + lineage" (phase-03 §7) — ancestor chain via
    // parentArtifactId, immediate parent first. No dedicated server endpoint
    // (parent_artifact_id has no index need beyond this short walk), so it
    // resolves client-side; capped so a bad/cyclic chain can't hang the peek.
    lineage: async (id: string): Promise<Artifact[]> => {
      const chain: Artifact[] = [];
      let current: Artifact | null = await kadApi.artifacts.get(id).catch(() => null);
      let guard = 0;
      while (current?.parentArtifactId && guard < 10) {
        const parent: Artifact | null = await kadApi.artifacts
          .get(current.parentArtifactId)
          .catch(() => null);
        if (!parent) break;
        chain.push(parent);
        current = parent;
        guard++;
      }
      return chain;
    },
    // /hoc-lieu upload (Phase 6) — loose files or an entire folder. `files`
    // keeps FormData's repeated-field-name convention (multer .array("files")
    // server-side); `relativePaths`, when given, is index-aligned with `files`
    // and preserves a folder upload's structure (webkitRelativePath).
    upload: (files: File[], relativePaths?: string[]) => {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      if (relativePaths) form.append("relative_paths", JSON.stringify(relativePaths));
      return uploadForm<ArtifactRow[]>("/artifacts/upload", form).then((rows) =>
        rows.map(toArtifact)
      );
    },
    downloadUrl: (id: string) => `${BASE}/artifacts/${encodeURIComponent(id)}/download`,
  },

  agents: {
    list: () => request<AgentRow[]>("/agents").then((rows) => rows.map(toAgent)),
    create: (input: {
      display_name: string;
      agent_type?: "sub" | "helper";
      engine?: "claude" | "codex" | "antigravity";
      role_description?: string;
      permissions?: Record<string, boolean>;
      skills?: string[];
      parent_agent_id?: string | null;
    }) =>
      request<AgentRow>("/agents", { method: "POST", body: JSON.stringify(input) }).then(toAgent),
    update: (
      id: string,
      patch: {
        display_name?: string;
        role_description?: string;
        permissions?: Record<string, boolean>;
        skills?: string[];
        status?: "active" | "inactive";
        parent_agent_id?: string | null;
      }
    ) =>
      request<AgentRow>(`/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      }).then(toAgent),
    archive: (id: string) =>
      request<AgentRow>(`/agents/${encodeURIComponent(id)}/archive`, { method: "POST" }).then(
        toAgent
      ),
  },

  goals: {
    get: (org_id?: string) => {
      const qs = org_id ? `?org_id=${encodeURIComponent(org_id)}` : "";
      return request<GoalsAndStrategyRow>(`/goals${qs}`).then((r) => ({
        goals: r.goals.map(toGoal),
        strategyMarkdown: r.strategy_markdown,
        strategyUpdatedAt: r.strategy_updated_at,
      }));
    },
    save: (input: { goals: Goal[]; strategyMarkdown: string; org_id?: string }) =>
      request<GoalsAndStrategyRow>("/goals", {
        method: "PUT",
        body: JSON.stringify({
          org_id: input.org_id,
          strategy_markdown: input.strategyMarkdown,
          goals: input.goals.map((g) => ({
            id: g.id,
            title: g.title,
            metric: g.metric,
            current: g.current,
            target: g.target,
            due: g.due,
            status: g.status,
          })),
        }),
      }).then((r) => ({
        goals: r.goals.map(toGoal),
        strategyMarkdown: r.strategy_markdown,
        strategyUpdatedAt: r.strategy_updated_at,
      })),
  },

  // Single-file .xlsx import + downloadable template (source-request items 3
  // and 7). Uploads bypass request()'s JSON Content-Type for the same reason
  // attachments.upload does — the browser must set its own multipart boundary.
  importXlsx: {
    templateUrl: (kind: "muc-tieu" | "van-hoa" | "jd-ky-nang") =>
      `${BASE}/import-templates/${kind}`,
    async goals(file: File, org_id?: string) {
      const form = new FormData();
      form.append("file", file);
      if (org_id) form.append("org_id", org_id);
      const r = await uploadForm<GoalsAndStrategyRow>("/goals/import", form);
      return {
        goals: r.goals.map(toGoal),
        strategyMarkdown: r.strategy_markdown,
        strategyUpdatedAt: r.strategy_updated_at,
      };
    },
    async orgContext(file: File) {
      const form = new FormData();
      form.append("file", file);
      return uploadForm<OrgContextVersionRow>("/org-context/import", form);
    },
    async agentJd(agentId: string, file: File) {
      const form = new FormData();
      form.append("file", file);
      const row = await uploadForm<AgentRow>(`/agents/${encodeURIComponent(agentId)}/import`, form);
      return toAgent(row);
    },
  },

  learningNotes: {
    list: (department: string) =>
      request<LearningNoteRow[]>(`/learning-notes?department=${encodeURIComponent(department)}`),
    propose: (id: string) =>
      request<LearningNoteRow>(`/learning-notes/${encodeURIComponent(id)}/propose`, {
        method: "POST",
      }),
    approve: (id: string) =>
      request<LearningNoteRow>(`/learning-notes/${encodeURIComponent(id)}/approve`, {
        method: "POST",
      }),
  },

  orgContext: {
    current: () => request<OrgContextVersionRow>("/org-context/current"),
    versions: () => request<OrgContextVersionRow[]>("/org-context/versions"),
    createDraft: (input: { data: OrgContextData; change_summary?: string }) =>
      request<OrgContextVersionRow>("/org-context/versions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    approve: (id: string) =>
      request<OrgContextVersionRow>(`/org-context/versions/${encodeURIComponent(id)}/approve`, {
        method: "POST",
      }),
    wizardDraft: () => request<WizardDraftRow | null>("/wizard/draft"),
    saveWizardDraft: (input: {
      step: number;
      data?: Record<string, unknown>;
      draft?: Record<string, unknown>;
    }) =>
      request<WizardDraftRow>("/wizard/draft", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    completeWizard: (input?: Record<string, unknown>) =>
      request<{
        org: OrgProfileRow;
        org_context: OrgContextVersionRow;
        department: { id: string; slug: string; name: string };
        blueprint: BlueprintRow;
        org_chart: OrgChartNodeRow[];
      }>("/wizard/complete", { method: "POST", body: JSON.stringify(input || {}) }),
    orgChart: () => request<OrgChartNodeRow[]>("/org-chart"),
    updateOrgChart: (nodes: OrgChartNodeRow[]) =>
      request<OrgChartNodeRow[]>("/org-chart", {
        method: "PUT",
        body: JSON.stringify({ nodes }),
      }),
    blueprints: (department?: string) => {
      const qs = department ? `?department=${encodeURIComponent(department)}` : "";
      return request<BlueprintRow[]>(`/blueprints${qs}`);
    },
    proposeBlueprint: (
      id: string,
      input: { data?: Record<string, unknown>; change_summary?: string }
    ) =>
      request<BlueprintRow>(`/blueprints/${encodeURIComponent(id)}/propose`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    decideBlueprint: (id: string, decision: "approved" | "rejected", reason?: string) =>
      request<BlueprintRow>(`/blueprints/${encodeURIComponent(id)}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, reason }),
      }),
  },

  templates: {
    list: (params?: { type?: string; status?: string; version_status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.type) qs.set("type", params.type);
      if (params?.status) qs.set("status", params.status);
      if (params?.version_status) qs.set("version_status", params.version_status);
      const q = qs.toString();
      return request<TemplateLibraryRow[]>(`/templates${q ? `?${q}` : ""}`);
    },
    createDraft: (input: {
      template_id?: string;
      name?: string;
      file_name?: string;
      template_type?: string;
      purpose?: string;
      content: string;
      change_summary?: string;
    }) =>
      request<{ template: TemplateLibraryRow; version: TemplateVersionRow }>("/templates", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    approve: (id: string) =>
      request<{ template: TemplateLibraryRow; version: TemplateVersionRow }>(
        `/templates/${encodeURIComponent(id)}/approve`,
        { method: "POST" }
      ),
    usage: (id: string) =>
      request<TemplateUsageRow[]>(`/templates/${encodeURIComponent(id)}/usage`),
    // Phase 5 — .docx/.pdf/.xlsx uploads (disk-backed, see templates-upload.js).
    // The .md path above stays on the JSON body + request() helper unchanged.
    uploadFile: (
      file: File,
      fields: {
        template_id?: string;
        name?: string;
        template_type?: string;
        purpose?: string;
        change_summary?: string;
      }
    ) => {
      const form = new FormData();
      form.append("file", file);
      for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
      return uploadForm<{ template: TemplateLibraryRow; version: TemplateVersionRow }>(
        "/templates/upload",
        form
      );
    },
    downloadUrl: (versionId: string) =>
      `${BASE}/templates/versions/${encodeURIComponent(versionId)}/download`,
  },

  workflows: {
    get: (id: string) => request<KadWorkflow>(`/workflows/${encodeURIComponent(id)}`),
    list: (params?: { department?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.department) qs.set("department", params.department);
      if (params?.status) qs.set("status", params.status);
      const q = qs.toString();
      return request<WorkflowSummaryRow[]>(`/workflows${q ? `?${q}` : ""}`).then((rows) =>
        rows.map(toWorkflowSummary)
      );
    },
  },

  runs: {
    // `monitor_session_id` bridges to /he-thong/sessions/:id (spec 03) — used by
    // the Delegation Card's trace link.
    get: (id: string) =>
      request<{ monitor_session_id: string | null }>(`/runs/${encodeURIComponent(id)}`),
  },

  // [Phase 7 hardening, spec/ui/08] engine_session_id -> {task_id, task_title}
  // for every run that has one. Lets SessionCard/AgentCard show "tên phiên =
  // tên công việc" instead of the projectFromCwd heuristic, in one request.
  sessionTaskMap: () =>
    request<Record<string, { task_id: string; task_title: string }>>("/session-task-map"),

  // [Phase 7 hardening] server/routes/kad/learning.js — was previously called
  // through a nonexistent `api.get/post` import (client/src/kad/pages/
  // LearningNotes.tsx), which broke the ENTIRE app's module graph in dev
  // (Vite throws on an unresolvable named export at import time, before React
  // ever mounts — not something an error boundary can catch).
  learningNotes: {
    list: (department: string) =>
      request<LearningNoteRow[]>(`/learning-notes?department=${encodeURIComponent(department)}`),
    propose: (id: string) =>
      request<LearningNoteRow>(`/learning-notes/${encodeURIComponent(id)}/propose`, {
        method: "POST",
      }),
    approve: (id: string) =>
      request<LearningNoteRow>(`/learning-notes/${encodeURIComponent(id)}/approve`, {
        method: "POST",
      }),
  },

  dependencies: {
    // spec/ui/09 §1 "Khi điều kiện" — creates the row AND flips the task to
    // 'blocked' server-side in one call (server/routes/kad/tasks.js).
    create: (
      taskId: string,
      input: {
        depends_on_task_id?: string;
        depends_on_artifact_type?: string;
        release_condition: DependencyCondition;
      }
    ) =>
      request<DependencyRow>(`/tasks/${encodeURIComponent(taskId)}/dependencies`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    listByTask: (taskId: string) =>
      request<DependencyRow[]>(`/tasks/${encodeURIComponent(taskId)}/dependencies`),
    // "Gỡ điều kiện" (spec/ui/09 §3).
    release: (depId: string) =>
      request<{ dependency_id: string; task_id: string; task_status: TaskStatus }>(
        `/dependencies/${encodeURIComponent(depId)}`,
        { method: "DELETE" }
      ),
  },

  automationRules: {
    list: (params?: { department?: string; enabled?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.department) qs.set("department", params.department);
      if (params?.enabled !== undefined) qs.set("enabled", params.enabled ? "1" : "0");
      const q = qs.toString();
      return request<AutomationRuleRow[]>(`/automation-rules${q ? `?${q}` : ""}`).then((rows) =>
        rows.map(toAutomationRule)
      );
    },
    // spec/ui/09 §1 "Theo lịch" — creates an automation_rules row
    // (trigger_type='schedule', action_type='create_task'); no task is
    // created now, only when the rule fires (Phase 6.5).
    create: (input: {
      department_id?: string;
      name: string;
      trigger_type: AutomationTriggerType;
      trigger_config: ScheduleTriggerConfig;
      action_type: AutomationActionType;
      action_config: CreateTaskActionConfig;
      approval_required?: boolean;
    }) =>
      request<AutomationRuleRow>("/automation-rules", {
        method: "POST",
        body: JSON.stringify(input),
      }).then(toAutomationRule),
    toggle: (id: string, enabled: boolean) =>
      request<AutomationRuleRow>(`/automation-rules/${encodeURIComponent(id)}/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }).then(toAutomationRule),
    // Chạy thử (Phase 6.5): "30 ngày qua luật này sẽ kích ở đâu" — no task created.
    dryRun: (id: string, days = 30) =>
      request<{ count: number; occurrences: string[]; summary: string }>(
        `/automation-rules/${encodeURIComponent(id)}/dry-run`,
        { method: "POST", body: JSON.stringify({ days }) }
      ),
  },

  // Department-wide "Tạm dừng tất cả" kill switch (spec/ui/09 §3) — separate
  // from each rule's own `enabled` bit, see server/lib/kad/repo/catalog.js.
  automation: {
    getPaused: (department?: string) => {
      const qs = department ? `?department=${encodeURIComponent(department)}` : "";
      return request<{ paused: boolean }>(`/automation/paused${qs}`);
    },
    setPaused: (paused: boolean, department?: string) =>
      request<{ department_id: string; paused: boolean }>("/automation/pause-all", {
        method: "POST",
        body: JSON.stringify({ department_id: department, paused }),
      }),
  },

  attachments: {
    listByTask: (taskId: string) =>
      request<AttachmentRow[]>(`/tasks/${encodeURIComponent(taskId)}/attachments`),
    // Real multipart upload (spec 03) — deliberately bypasses request()'s
    // JSON Content-Type: the browser must set its own multipart boundary.
    upload: async (taskId: string, files: File[]): Promise<{ id: string; file_name: string }[]> => {
      const form = new FormData();
      for (const f of files) form.append("file", f);
      const token = dashboardToken();
      const res = await fetch(`${BASE}/tasks/${encodeURIComponent(taskId)}/attachments`, {
        method: "POST",
        headers: token ? { "x-dashboard-token": token } : undefined,
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    // Real removal (DB row + best-effort file unlink) — "remove chip" must
    // actually delete the attachment, not just hide it client-side.
    remove: (attachmentId: string) =>
      request<{ id: string; task_id: string }>(`/attachments/${encodeURIComponent(attachmentId)}`, {
        method: "DELETE",
      }),
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
