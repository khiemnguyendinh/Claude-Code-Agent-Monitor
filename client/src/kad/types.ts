/**
 * KAD domain types — mirrors plans/260703-2330-kad-v2-build/spec/02-data-model.md
 * (22-table SQLite schema) for entities that already exist, plus the schemas
 * proposed for fields marked [GAP] in spec/ui/*.md (goals, exceptions,
 * standup, agent stats, department policies, search). No `/api/kad/*`
 * backend exists yet — this mockup renders sample data shaped exactly to
 * these contracts so real fetch() wiring later is a drop-in swap, not a
 * redesign. GAP items are annotated at their declaration.
 */

// ── Shared enums (spec 02) ──────────────────────────────────────────────

export type TaskStatus =
  | "blocked" // [spec/ui/09] chờ điều kiện task_dependencies chưa thoả — chưa vào orchestration
  | "inbox"
  | "triaged"
  | "doing"
  | "waiting_human"
  | "review"
  | "needs_changes"
  | "done"
  | "failed"
  | "archived";

export type Priority = "urgent" | "high" | "normal" | "low";

export type ArtifactType =
  | "program_framework"
  | "research_report"
  | "syllabus"
  | "lesson_plan"
  | "slide_outline"
  | "video_script"
  | "quality_report"
  | "connector_draft"
  | "other";

export type ArtifactStatus = "draft" | "review" | "approved" | "published" | "archived";

export type ApprovalType =
  | "plan"
  | "strategy"
  | "artifact"
  | "publish_facebook"
  | "publish_wordpress"
  | "blueprint_change"
  | "template_change"
  | "org_context_change"
  | "sensitive_content"
  | "helper_create"
  | "internal_auto";

export type ApprovalStatus = "pending" | "approved" | "needs_changes" | "rejected";
export type SensitivitySubtype = "metrics" | "people" | "brand";
export type AgentType = "main" | "sub" | "helper";
export type Engine = "claude" | "codex" | "antigravity";
export type DelegationStatus = "pending" | "running" | "review" | "done" | "failed" | "cancelled";
export type RunStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskMessageType =
  | "chat"
  | "status"
  | "approval_request"
  | "approval_response"
  | "escalation"
  | "artifact_delivery"
  | "system"
  // spec/ui/07-giao-viec-intake-report-card.md §2-4 (chốt 2026-07-04)
  | "intake_question"
  | "brief"
  | "report";

// ── Workflow / task (tasks, workflow_definitions, task_delegations, task_runs) ──

export interface WorkflowStepDef {
  key: string; // 'framework' | 'research' | 'syllabus' | 'lesson' | 'slide' | 'video' | 'review'
  label: string; // "Khung chương trình"
  agentName: string; // agent_profiles.name this step runs on
  approval?: ApprovalType;
  parallelGroup?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string; // kebab-case nội bộ, vd 'rd-standard-flow'
  displayName: string; // nhãn tiếng Việt, vd "Soạn syllabus" — dùng trên wfCard spec 07 §1
  description?: string; // dùng làm caption mini-pipeline trên wfCard, spec 07 §1
  examplePrompt?: string; // [spec 07 §1] điền vào composer khi click wfCard — KHÔNG tự gửi
  triggerKeywords?: string[]; // [spec 07 §1, chốt 2026-07-04] match client-side để gợi ý chip khi gõ ≥15 ký tự
  steps: WorkflowStepDef[];
  version: number;
  status: "draft" | "active" | "archived";
}

export type StepState = "done" | "doing" | "waiting_human" | "todo" | "failed";

/** Per-project computed step progress — derived from tasks/delegations/artifacts
 * in the real system; the mockup precomputes it directly on the Project. */
export interface ProjectStepProgress {
  key: string;
  label: string;
  state: StepState;
  agentId?: string;
}

export interface Project {
  id: string;
  title: string;
  status: TaskStatus;
  workflowId: string;
  steps: ProjectStepProgress[]; // full pipeline w/ per-step state
  itemsDone: number;
  itemsTotal: number;
  agentIdsInvolved: string[];
  dueDate: string | null;
  priority: Priority;
  hasBlocker: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCard {
  id: string;
  parentTaskId: string | null;
  title: string;
  status: TaskStatus;
  projectTitle: string; // chip dự án cha
  dueDate: string | null;
  assignedAgentId: string | null;
  hasFailedRun: boolean; // viền trái danger + dot đỏ
  retryCount: number;
  priority: Priority;
  updatedAt: string;
  workingDir?: string | null; // [spec 07 §1] thư mục làm việc chọn lúc giao việc
  attachmentNames?: string[]; // [spec 07 §1] tên file đính kèm gửi kèm message đầu
  startCondition?: string | null; // [spec/ui/09] nhãn điều kiện tự nhiên khi status='blocked'
}

// ── Trigger / phụ thuộc / tự động hoá (spec 02 §6b, spec/ui/09) ──────────

export type TaskActivation = "now" | "dependency" | "schedule";
export type DependencyCondition = "dep_task_done" | "dep_artifact_approved";
export type ScheduleFrequency = "once" | "daily" | "weekly" | "monthly";
export type AutomationTriggerType = "schedule" | "event" | "metric_threshold";
export type AutomationActionType = "create_task" | "notify" | "run_briefing" | "pause_department";
export type RuleFireResult =
  | "created"
  | "skipped_budget"
  | "skipped_cooldown"
  | "skipped_maxfires"
  | "blocked_loop"
  | "notified";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  label: string; // ngôn ngữ tự nhiên, vd "Hằng tuần, Thứ 2 lúc 07:00"
}

/** automation_rule_fires — lịch sử kích + phục vụ dry-run (spec 02 §6b). */
export interface AutomationRuleFire {
  id: string;
  firedAt: string;
  triggerRef: string; // sự kiện/lịch nào kích
  result: RuleFireResult;
  note?: string;
}

/** automation_rules — luật event/threshold/schedule (spec 02 §6b, spec/ui/09). */
export interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actionType: AutomationActionType;
  actionLabel: string; // "Tạo việc R&D môn kế" | "Tạo Báo cáo đầu ngày"
  approvalRequired: boolean; // auto-task vẫn cần người duyệt trước khi tiêu token
  enabled: boolean;
  lastFiredAtLabel: string | null; // "hôm nay" | "2 ngày" | null
  fireCount: number;
  dryRun30d: string; // "Sẽ kích 3 lần: 08/07, 15/07, 22/07"
  fires: AutomationRuleFire[];
}

export interface TaskDelegation {
  id: string;
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  instruction: string;
  status: DelegationStatus;
  retryCount: number;
  runId: string | null;
  outputArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRun {
  id: string;
  taskId: string;
  agentId: string;
  engine: Engine;
  engineSessionId: string | null; // links to monitor sessions.id (/he-thong/sessions/:id)
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
}

/** message_type `brief` — spec 07 §3, "hội thoại đông cứng thành object".
 * Immutable once decidedAt is set; [Sửa brief] tạo message brief MỚI (v2), không edit inline. */
export interface BriefPayload {
  goal: string;
  deliverable: string;
  workflowName: string;
  workingDir: string | null;
  attachmentCount: number;
  dueLabel: string; // "10/07" hoặc "Trợ lý đề xuất: …"
  frameworkLabel?: string; // vd "Khung: KASH chuẩn Bloom (như K2)" — ẩn nếu không áp dụng (Việc tự do)
  assumption?: string; // chỉ hiện nếu có (⚠ tint warning)
  decidedAt?: string | null;
}

/** message_type `report` — spec 07 §4, thay wall-of-text bằng card cấu trúc. */
export interface ReportPayload {
  version: number;
  summary: string; // 3-5 dòng, markdown
  artifacts: { artifactId: string; title: string }[];
  needsDecision?: string[];
  blocker?: string;
  cost: { duration: string; tokens: string; vnd: string; agentName: string };
  // Real wiring only (api-client.ts) — raw numbers behind the formatted `cost`
  // strings above, for cost-to-date aggregation without re-parsing display text.
  costRaw?: { durationSeconds: number; tokens: number; vnd: number };
  decision?: { status: "approved" | "needs_changes"; at: string; reason?: string } | null;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  senderType: "human" | "agent";
  senderId: string; // agent_profiles.id | 'human'
  content: string;
  messageType: TaskMessageType;
  metadata?: {
    approval?: Approval;
    artifact?: Artifact;
    delegation?: TaskDelegation;
    suggestedActions?: string[];
    options?: string[]; // intake_question — chip trả lời nhanh, tối đa 4, spec 07 §2
    brief?: BriefPayload;
    report?: ReportPayload;
    attachmentNames?: string[]; // [spec 07 §5] chip file đính kèm hiện trong bubble human
  };
  createdAt: string;
}

export interface TaskDetail {
  id: string;
  title: string;
  status: TaskStatus;
  projectTitle: string;
  priority: Priority;
  dueDate: string | null;
  createdAt: string;
  costToDateTokens: number;
  costToDateVnd: number;
  steps: ProjectStepProgress[];
  currentStepKey: string;
  activeDelegation: TaskDelegation | null;
  messages: TaskMessage[];
  isRunning: boolean;
  workingDir?: string | null; // [spec 07 §1] tasks.working_dir
}

// ── Artifact / approval (artifacts, approvals) ──────────────────────────

export interface Artifact {
  id: string;
  taskId: string;
  agentId: string;
  artifactType: ArtifactType;
  title: string;
  content: string; // markdown — empty for uploaded (source: "uploaded") non-markdown files
  /** Phase 6 — true when a real file backs this row (uploaded or agent-saved); use with fileName/source for the viewer's non-markdown fallback. Optional: absent on mockData.ts's still-mock ARTIFACTS (CommandPalette/DetailPanels/TongQuan), always present on real API rows (toArtifact() in api-client.ts). */
  hasFile?: boolean;
  source?: "generated" | "uploaded";
  fileName?: string | null;
  mimeType?: string | null;
  parentArtifactId: string | null;
  status: ArtifactStatus;
  version: number;
  qualityScore: number | null; // [GAP] chuẩn hoá field `score` trong quality_report metadata (02-man-tong-quan §8)
  sensitivityFlags: { metrics: boolean; people: boolean; brand: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  taskId: string;
  taskTitle: string;
  requestedByAgentId: string;
  approvalType: ApprovalType;
  sensitivitySubtype: SensitivitySubtype | null;
  title: string;
  description: string;
  artifactId: string | null;
  status: ApprovalStatus;
  reviewer: "human" | "system";
  decisionReason: string | null;
  slaReminderHours: number | null;
  createdAt: string;
}

// ── Agent / org (agent_profiles, org_chart_nodes) ───────────────────────

export interface AgentPermissions {
  createTask?: boolean;
  assignTask?: boolean;
  createHelper?: boolean;
  readOrgContext?: boolean;
  readTemplates?: boolean;
  webSearch?: boolean;
  requestApproval?: boolean;
  writeAudit?: boolean;
  publishConnector?: boolean;
  modifyBlueprint?: boolean;
  modifyOrgContext?: boolean;
}

export interface AgentProfile {
  id: string;
  agentType: AgentType;
  name: string; // kebab-case, e.g. 'sub-curriculum-researcher'
  displayName: string; // 'Nghiên cứu chương trình'
  title: string; // "Thiết kế syllabus" — hiển thị dưới tên trên card
  engine: Engine;
  model: string; // "Claude Sonnet 5"
  roleDescription: string; // markdown JD
  permissions: AgentPermissions;
  skills: string[]; // free-text tags, agent_profiles.skills JSON column
  status: "active" | "inactive" | "archived";
  parentAgentId: string | null;
  scope?: string; // helper only
  expiresAt?: string; // helper only
  jdVersion: number;
  jdApprovedAt: string;
}

/** [GAP] GET /api/kad/agents/:id/stats — 04-man-doi-ngu §1b */
export interface AgentStats {
  agentId: string;
  tasksThisWeek: number;
  qualityPassRate30d: number; // 0-100
  cost7dVnd: number;
  sparkline14d: number[]; // artifacts done/day
  tasksCoordinating?: number; // Trợ lý vận hành only
  approvalsWaiting?: number; // Trợ lý vận hành only
}

export interface OrgChartNode {
  id: string;
  parentId: string | null;
  name: string;
  nodeType: "company" | "department" | "position";
  agentId: string | null; // null for the human "Trưởng phòng" node
  isHuman: boolean;
  isHelperGhost?: boolean;
  helperExpiresInMinutes?: number;
}

// ── Org context / template library ──────────────────────────────────────

export interface OrgContextSection {
  key: "su-menh" | "tam-nhin" | "gia-tri" | "nguyen-tac" | "ky-luat" | "chien-luoc";
  title: string;
  bodyMarkdown: string;
  version: number;
  approvedAt: string;
  pendingChange: boolean;
}

export interface TemplateSkill {
  id: string;
  name: string;
  templateType: string;
  purpose: string;
  version: number;
  usageCount: number;
  status: "active" | "archived";
}

// ── Approval matrix (spec 01 §4 — real governance content, not fabricated) ──

export interface ApprovalMatrixRow {
  action: string;
  requestedBy: string;
  cooldown: string;
  slaHours: string;
  automatic: boolean;
  /** Auto-approve rows only — the condition under which they qualify. */
  condition?: string;
}

export interface DepartmentPolicies {
  // [GAP] department_policies table hoặc config JSON trong blueprint — 04 §4
  autoApprove: { artifactType: ArtifactType; enabled: boolean; minQualityScore: number }[];
  dailyTokenLimit: number;
  tokensUsedToday: number;
  perTaskTokenLimit: number;
}

// ── Goals [GAP] — department_goals (02-man-tong-quan §2) ────────────────

export interface Goal {
  id: string;
  title: string;
  metric: string;
  target: number;
  current: number;
  due: string;
  status: "on_track" | "at_risk" | "off_track";
}

// ── Strategy plan — nội dung "Chiến lược & Ưu tiên" do Trưởng phòng nhập trực
// tiếp qua trang Mục tiêu & chiến lược (thay khung "ưu tiên quý" cố định). Trợ
// lý vận hành đọc bản này để tự điều chỉnh ưu tiên công việc.
export interface StrategyPlan {
  bodyMarkdown: string;
  updatedAt: string | null;
}

// ── OKR & KPI [GAP] — tab "Mục tiêu" (Đội ngũ). Hai tầng công ty↔phòng ban
// nối bằng parentObjectiveId (cascade/alignment). Shape sẵn cho GET
// /api/kad/okrs + /api/kad/kpis; mockup seed ở mockData.ts. Objective = tầng
// định lượng theo quý của Chiến lược (nhập ở /muc-tieu-chien-luoc); KPI = chỉ
// số sức khoẻ vận hành nhịp tuần/tháng, cập nhật tự động từ nguồn.
export type GoalLevel = "company" | "department";
export type OkrCycle = "year" | "quarter";
export type GoalHealth = "on_track" | "at_risk" | "off_track";
export type KpiCadence = "weekly" | "monthly";
/** "down" = thấp hơn mục tiêu là tốt (vd chi phí/học liệu). Mặc định "up". */
export type MetricDirection = "up" | "down";

export interface KeyResult {
  id: string;
  title: string;
  metric: string;
  current: number;
  target: number;
  unit?: string;
  direction?: MetricDirection;
  ownerId: string; // agent_profiles.id | 'human' — KR luôn có người/agent chịu trách nhiệm
  health: GoalHealth;
}

export interface Objective {
  id: string;
  level: GoalLevel;
  cycle: OkrCycle;
  period: string; // "2026" | "Q3/2026"
  title: string;
  ownerId: string; // 'human' cho Trưởng phòng/CEO
  parentObjectiveId: string | null; // null = đỉnh; nếu có = đóng góp cho objective cấp trên
  keyResults: KeyResult[];
  confidence: GoalHealth;
}

export interface Kpi {
  id: string;
  level: GoalLevel;
  name: string;
  metric: string;
  current: number;
  target: number;
  unit?: string;
  direction?: MetricDirection;
  cadence: KpiCadence;
  ownerId: string;
  source: string; // "Tự động · KAD" — KPI kéo số từ nguồn, không nhập tay
  trend: number[]; // các kỳ gần nhất, cũ→mới
  health: GoalHealth;
}

// ── Exceptions [GAP] — GET /api/kad/exceptions (02-man-tong-quan §4/§7) ──

export type ExceptionKind =
  | "run_failed"
  | "delegation_stuck"
  | "approval_sla"
  | "budget_exceeded"
  | "connector_error";

export interface ExceptionItem {
  id: string;
  kind: ExceptionKind;
  description: string;
  taskId: string | null;
  severity: "warning" | "danger";
  occurredAt: string;
}

// ── Standup [GAP] — GET/POST /api/kad/standup/today (02-man-tong-quan §5) ──

export interface StandupLine {
  text: string;
  linkTaskId?: string;
}

export interface StandupBrief {
  generatedAt: string | null; // null = chưa generate hôm nay
  dangChay: StandupLine[];
  choAnh: StandupLine[];
  ruiRo: StandupLine[];
  costYesterdayTokens: number;
  costYesterdayVnd: number;
}

// ── Notifications ────────────────────────────────────────────────────────

export interface KadNotification {
  id: string;
  kind:
    | "approval_pending"
    | "approval_sla"
    | "approval_stale"
    | "task_blocked"
    | "budget_warning"
    | "run_failed"
    | "daily_briefing";
  title: string;
  body: string;
  linkPath: string;
  readAt: string | null;
  createdAt: string;
}

// ── Productivity/quality trend cards (Tổng quan block C) ────────────────

export interface OpsMetricCard {
  label: string;
  value: string;
  deltaLabel: string;
  deltaDirection: "up" | "down" | "flat";
  deltaGood: boolean;
  series14d: number[];
}
