/**
 * Peek drawer body renderers — one per entity type, 01-app-shell.md §4.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, MessageSquare } from "lucide-react";
import type { PeekTarget, PeekType } from "./PeekDrawer";
import { kadApi, type KadTask, type KadAgentStats } from "../api-client";
import type { Artifact, StepState, TaskStatus } from "../types";
import { useKadStore } from "../store";
import { useKadToast } from "./Toast";
import { AgentAvatar } from "./Avatar";
import { SensitivityBadge, TaskStatusChip } from "./StatusChip";
import { SegmentedProgress, ProgressBar } from "./Progress";
import { KadButton, KadEmptyState, KadTextarea } from "./primitives";
import { ArtifactViewer } from "./ArtifactViewer";
import { formatDueDate, formatPercent, formatSlaCountdown, formatVnd } from "../format";
import { FilesPanel } from "./DetailPanels";
import { WorkflowRunPeek } from "./WorkflowRunPeek";

export const PEEK_TITLES: Record<PeekType, string> = {
  task: "Công việc",
  project: "Dự án",
  artifact: "Học liệu",
  approval: "Phê duyệt",
  agent: "Hồ sơ AI Agent",
  goal: "Mục tiêu",
  "workflow-run": "Workflow",
};

export function peekFullPagePath(target: PeekTarget): string | null {
  switch (target.type) {
    case "task":
      return `/cong-viec/${target.id}`;
    case "project":
      return "/he-thong/kanban";
    case "artifact":
      return "/hoc-lieu";
    case "agent":
      return "/doi-ngu";
    default:
      return null;
  }
}

interface PeekContentProps {
  target: PeekTarget;
  onOpenPeek: (target: PeekTarget) => void;
  onClose: () => void;
}

export function PeekContent({ target, onOpenPeek, onClose }: PeekContentProps) {
  switch (target.type) {
    case "task":
      return <TaskPeek id={target.id} onOpenPeek={onOpenPeek} />;
    case "project":
      return <ProjectPeek id={target.id} onOpenPeek={onOpenPeek} />;
    case "artifact":
      return <ArtifactPeek id={target.id} onOpenPeek={onOpenPeek} onClose={onClose} />;
    case "approval":
      return <ApprovalPeek id={target.id} onOpenPeek={onOpenPeek} onClose={onClose} />;
    case "agent":
      return <AgentPeek id={target.id} onOpenPeek={onOpenPeek} />;
    case "goal":
      return <GoalPeek id={target.id} onOpenPeek={onOpenPeek} />;
    case "workflow-run":
      return <WorkflowRunPeek id={target.id} onOpenPeek={onOpenPeek} />;
    default:
      return null;
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="kad-caption text-kad-text-muted">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ── Task ───────────────────────────────────────────────────────────────

function TaskPeek({ id, onOpenPeek }: { id: string; onOpenPeek: (t: PeekTarget) => void }) {
  const navigate = useNavigate();
  const { tasks, agentsById } = useKadStore();
  const task = tasks.find((t) => t.id === id);
  const [taskFiles, setTaskFiles] = useState<Artifact[]>([]);

  // Real học liệu for this task (GET /api/kad/artifacts?task=:id).
  useEffect(() => {
    let alive = true;
    kadApi.artifacts
      .list({ task_id: id })
      .then((rows) => alive && setTaskFiles(rows))
      .catch(() => alive && setTaskFiles([]));
    return () => {
      alive = false;
    };
  }, [id]);

  if (!task) return <KadEmptyState icon={MessageSquare} message="Không tìm thấy công việc." />;

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="kad-title text-kad-text-strong">{task.title}</h2>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <TaskStatusChip status={task.status} />
          <span className="kad-caption text-kad-text-muted">{task.projectTitle}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Phụ trách">
          {task.assignedAgentId ? (
            <div className="flex items-center gap-1.5">
              <AgentAvatar agentId={task.assignedAgentId} size={20} />
              <span className="kad-body text-kad-text">
                {agentsById.get(task.assignedAgentId)?.displayName ?? task.assignedAgentId}
              </span>
            </div>
          ) : (
            <span className="kad-body text-kad-text-faint">Chưa giao</span>
          )}
        </Field>
        <Field label="Hạn">
          <span className="kad-body text-kad-text">{formatDueDate(task.dueDate) ?? "—"}</span>
        </Field>
      </div>

      <Field label="Files & học liệu">
        <FilesPanel
          artifacts={taskFiles}
          onOpen={(aid) => onOpenPeek({ type: "artifact", id: aid })}
          emptyHint="Chưa có file nào cho công việc này."
        />
      </Field>

      <KadButton variant="primary" className="w-full" onClick={() => navigate(`/cong-viec/${id}`)}>
        Mở trao đổi <ArrowRight className="w-3.5 h-3.5" />
      </KadButton>
    </div>
  );
}

// ── Project ────────────────────────────────────────────────────────────

// Real project peek — mirrors KanbanBoard.tsx's ProjectProgressStrip: a "project"
// is the group of real tasks sharing a workflowId (the sentinel below = tasks with
// none). `id` arriving here is that workflowId (or the sentinel), so we fetch real
// tasks + workflow name instead of a mock roster lookup.
const PROJECT_UNASSIGNED_ID = "__unassigned__";
const TASK_STATUS_TO_STEP: Record<TaskStatus, StepState> = {
  blocked: "todo",
  inbox: "todo",
  triaged: "todo",
  doing: "doing",
  waiting_human: "waiting_human",
  review: "doing",
  needs_changes: "waiting_human",
  done: "done",
  failed: "failed",
  archived: "todo",
};

function ProjectPeek({ id, onOpenPeek }: { id: string; onOpenPeek: (t: PeekTarget) => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ title: string; tasks: KadTask[] } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([kadApi.tasks.list({ limit: 500 }), kadApi.workflows.list()])
      .then(([tasks, workflows]) => {
        if (!alive) return;
        const inGroup = tasks.filter((t) => (t.workflowId ?? PROJECT_UNASSIGNED_ID) === id);
        const title =
          id === PROJECT_UNASSIGNED_ID
            ? "Việc lẻ"
            : (workflows.find((w) => w.id === id)?.name ?? id);
        setData({ title, tasks: inGroup });
      })
      .catch(() => alive && setData({ title: "Dự án", tasks: [] }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) return <div className="p-4 kad-caption text-kad-text-faint">Đang tải…</div>;
  if (!data || data.tasks.length === 0)
    return <KadEmptyState icon={MessageSquare} message="Chưa có việc nào trong dự án này." />;

  const done = data.tasks.filter((t) => t.status === "done").length;
  const steps = data.tasks.map((t) => ({
    key: t.id,
    label: t.title,
    state: TASK_STATUS_TO_STEP[t.status],
  }));

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="kad-title text-kad-text-strong">{data.title}</h2>
        <p className="kad-caption text-kad-text-muted mt-1">
          {done}/{data.tasks.length} hạng mục
        </p>
      </div>
      <Field label="Tiến độ theo việc">
        <SegmentedProgress steps={steps} height={6} showLabels />
      </Field>
      <Field label="Danh sách việc">
        <div className="flex flex-col gap-1">
          {data.tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onOpenPeek({ type: "task", id: t.id })}
              className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-kad-surface-2 text-left"
            >
              <span className="kad-body text-kad-text truncate min-w-0">{t.title}</span>
              <TaskStatusChip status={t.status} />
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

// ── Artifact ───────────────────────────────────────────────────────────

// All học liệu ids are real (/api/kad/artifacts) — fetch the artifact + its
// lineage chain and render via ArtifactViewer.
function ArtifactPeek({
  id,
  onOpenPeek,
  onClose,
}: {
  id: string;
  onOpenPeek: (t: PeekTarget) => void;
  onClose: () => void;
}) {
  const [real, setReal] = useState<{ artifact: Artifact; lineage: Artifact[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReal(null);
    (async () => {
      try {
        const [artifact, lineage] = await Promise.all([
          kadApi.artifacts.get(id),
          kadApi.artifacts.lineage(id),
        ]);
        if (!cancelled) setReal({ artifact, lineage });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="p-4">
        <KadEmptyState icon={MessageSquare} message="Đang tải học liệu…" />
      </div>
    );
  }
  if (!real) {
    return (
      <div className="p-4">
        <KadEmptyState icon={MessageSquare} message="Không tìm thấy học liệu." />
      </div>
    );
  }
  return (
    <div className="p-4">
      <ArtifactViewer
        artifactId={id}
        artifact={real.artifact}
        versions={[real.artifact]}
        lineage={real.lineage}
        onSelectLineageItem={(aid) => onOpenPeek({ type: "artifact", id: aid })}
        onDeleted={onClose}
      />
    </div>
  );
}

// ── Approval ───────────────────────────────────────────────────────────

function ApprovalPeek({
  id,
  onOpenPeek,
  onClose,
}: {
  id: string;
  onOpenPeek: (t: PeekTarget) => void;
  onClose: () => void;
}) {
  const { approvals, decideApproval, agentsById } = useKadStore();
  const toast = useKadToast();
  const approval = approvals.find((a) => a.id === id);
  const [mode, setMode] = useState<"idle" | "needs_changes" | "rejected">("idle");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | undefined>(undefined);

  // Real artifact preview for this approval (GET /api/kad/artifacts/:id).
  const artifactId = approval?.artifactId;
  useEffect(() => {
    if (!artifactId) {
      setArtifact(undefined);
      return;
    }
    let alive = true;
    kadApi.artifacts
      .get(artifactId)
      .then((a) => alive && setArtifact(a))
      .catch(() => alive && setArtifact(undefined));
    return () => {
      alive = false;
    };
  }, [artifactId]);

  if (!approval)
    return <KadEmptyState icon={MessageSquare} message="Không tìm thấy yêu cầu duyệt." />;

  const sla = approval.slaReminderHours
    ? formatSlaCountdown(
        new Date(
          new Date(approval.createdAt).getTime() + approval.slaReminderHours * 3_600_000
        ).toISOString()
      )
    : null;
  const decided = approval.status !== "pending";

  const submit = async (status: "approved" | "needs_changes" | "rejected") => {
    if (status !== "approved" && reason.trim().length === 0) return;
    setSubmitting(true);
    try {
      await decideApproval(id, status, status === "approved" ? null : reason.trim());
      toast({
        message:
          status === "approved"
            ? "Đã duyệt."
            : status === "needs_changes"
              ? "Đã gửi yêu cầu sửa."
              : "Đã từ chối.",
        tone: status === "rejected" ? "warning" : "success",
      });
      onClose();
    } catch (e) {
      toast({
        message: e instanceof Error ? e.message : "Có lỗi xảy ra, thử lại.",
        tone: "warning",
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          {approval.sensitivitySubtype && (
            <SensitivityBadge subtype={approval.sensitivitySubtype} />
          )}
          <span className="kad-caption text-kad-text-muted">{approval.taskTitle}</span>
        </div>
        <h2 className="kad-title text-kad-text-strong mt-2">{approval.title}</h2>
        <p className="kad-body text-kad-text-muted mt-1">{approval.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Người xin duyệt">
          <div className="flex items-center gap-1.5">
            {(() => {
              const real = agentsById.get(approval.requestedByAgentId);
              return (
                <>
                  <AgentAvatar
                    agentId={approval.requestedByAgentId}
                    size={20}
                    displayNameOverride={real?.displayName}
                    agentNameOverride={real?.name}
                  />
                  <span className="kad-body text-kad-text">
                    {real?.displayName ?? approval.requestedByAgentId}
                  </span>
                </>
              );
            })()}
          </div>
        </Field>
        {sla && (
          <Field label="SLA">
            <span
              className={`kad-body font-medium ${sla.overdue ? "text-kad-danger" : "text-kad-text"}`}
            >
              {sla.text}
            </span>
          </Field>
        )}
      </div>

      {artifact && (
        <Field label="Xem trước học liệu">
          <button
            type="button"
            onClick={() => onOpenPeek({ type: "artifact", id: artifact.id })}
            className="w-full text-left border border-kad-border rounded-lg px-3 py-2 hover:bg-kad-surface-2"
          >
            <p className="kad-body text-kad-text truncate">{artifact.title}</p>
            <p className="kad-caption text-kad-text-muted line-clamp-2 mt-0.5">
              {artifact.content.replace(/^#+\s*/gm, "").slice(0, 160)}…
            </p>
          </button>
        </Field>
      )}

      {decided ? (
        <div className="flex items-center gap-2 pt-2 border-t border-kad-border">
          <span className="kad-body text-kad-text-muted">
            Đã quyết định:{" "}
            <span className="text-kad-text-strong font-medium">{approval.status}</span>
            {approval.decisionReason ? ` — ${approval.decisionReason}` : ""}
          </span>
        </div>
      ) : mode === "idle" ? (
        <div className="flex items-center gap-2 pt-2 border-t border-kad-border">
          <KadButton variant="primary" disabled={submitting} onClick={() => submit("approved")}>
            Duyệt
          </KadButton>
          <KadButton
            variant="secondary"
            disabled={submitting}
            onClick={() => setMode("needs_changes")}
          >
            Yêu cầu sửa
          </KadButton>
          <KadButton variant="danger" disabled={submitting} onClick={() => setMode("rejected")}>
            Từ chối
          </KadButton>
        </div>
      ) : (
        <div className="space-y-2 pt-2 border-t border-kad-border">
          <KadTextarea
            autoFocus
            placeholder={
              mode === "rejected" ? "Lý do từ chối (bắt buộc)…" : "Cần sửa gì (bắt buộc)…"
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <KadButton
              variant={mode === "rejected" ? "danger" : "primary"}
              disabled={reason.trim().length === 0 || submitting}
              onClick={() => submit(mode)}
            >
              Gửi
            </KadButton>
            <KadButton variant="ghost" disabled={submitting} onClick={() => setMode("idle")}>
              Hủy
            </KadButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agent ──────────────────────────────────────────────────────────────

function AgentPeek({ id, onOpenPeek }: { id: string; onOpenPeek: (t: PeekTarget) => void }) {
  const navigate = useNavigate();
  const { tasks, agentsById } = useKadStore();
  const agent = agentsById.get(id);
  const [stats, setStats] = useState<KadAgentStats | undefined>(undefined);

  // Real per-agent 7d stats (GET /api/kad/reports/agent-stats), matched by id.
  useEffect(() => {
    let alive = true;
    kadApi.reports
      .agentStats()
      .then((rows) => alive && setStats(rows.find((r) => r.agentId === id)))
      .catch(() => alive && setStats(undefined));
    return () => {
      alive = false;
    };
  }, [id]);

  if (!agent) return <KadEmptyState icon={MessageSquare} message="Không tìm thấy hồ sơ." />;
  const activeTasks = tasks.filter((t) => t.assignedAgentId === id && t.status !== "done");

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-3">
        <AgentAvatar
          agentId={id}
          size={40}
          displayNameOverride={agent.displayName}
          agentNameOverride={agent.name}
        />
        <div>
          <h2 className="kad-title text-kad-text-strong">{agent.displayName}</h2>
          <p className="kad-caption text-kad-text-muted">{agent.title}</p>
        </div>
      </div>

      <Field label="JD tóm tắt">
        <p className="kad-body text-kad-text">{agent.roleDescription}</p>
      </Field>

      {stats && (
        <Field label="Chỉ số 7 ngày">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="kad-display text-kad-text-strong">{stats.tasksThisWeek}</p>
              <p className="kad-caption text-kad-text-muted">việc tuần này</p>
            </div>
            <div>
              <p className="kad-display text-kad-text-strong">
                {formatPercent(stats.qualityPassRate30d)}
              </p>
              <p className="kad-caption text-kad-text-muted">đạt lần đầu (30d)</p>
            </div>
            <div>
              <p className="kad-display text-kad-text-strong">{formatVnd(stats.cost7dVnd)}</p>
              <p className="kad-caption text-kad-text-muted">chi phí 7 ngày</p>
            </div>
          </div>
        </Field>
      )}

      <Field label="Việc đang làm">
        {activeTasks.length === 0 ? (
          <p className="kad-body text-kad-text-faint">Không có việc đang chạy.</p>
        ) : (
          <div className="space-y-2">
            {activeTasks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpenPeek({ type: "task", id: t.id })}
                className="w-full flex items-center justify-between gap-2 border border-kad-border rounded-lg px-3 py-2 hover:bg-kad-surface-2 text-left"
              >
                <span className="kad-body text-kad-text truncate">{t.title}</span>
                <TaskStatusChip status={t.status} />
              </button>
            ))}
          </div>
        )}
      </Field>

      <KadButton variant="secondary" className="w-full" onClick={() => navigate("/doi-ngu")}>
        Xem JD đầy đủ
      </KadButton>
    </div>
  );
}

// ── Goal ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function GoalPeek({ id, onOpenPeek: _onOpenPeek }: { id: string; onOpenPeek: (t: PeekTarget) => void }) {
  const { goals } = useKadStore();
  const goal = goals.find((g) => g.id === id);
  if (!goal) return <KadEmptyState icon={MessageSquare} message="Không tìm thấy mục tiêu." />;
  const percent = goal.target > 0 ? (goal.current / goal.target) * 100 : 0;

  // No real goal→task foreign key in the schema, so we don't fabricate a
  // "contributing tasks" list (the old mock did). Goal metric/progress are real.
  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="kad-title text-kad-text-strong">{goal.title}</h2>
        <p className="kad-caption text-kad-text-muted mt-1">Hạn {goal.due}</p>
      </div>
      <Field label={goal.metric}>
        <div className="flex items-baseline gap-2">
          <span className="kad-display text-kad-text-strong">{goal.current}</span>
          <span className="kad-body text-kad-text-muted">/ {goal.target}</span>
        </div>
        <div className="mt-2">
          <ProgressBar percent={percent} tone="primary" />
        </div>
      </Field>
    </div>
  );
}
