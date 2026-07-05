/**
 * Peek drawer body renderers — one per entity type, 01-app-shell.md §4.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, MessageSquare } from "lucide-react";
import type { PeekTarget, PeekType } from "./PeekDrawer";
import {
  AGENT_STATS,
  findAgent,
  findArtifact,
  findProject,
  PROJECTS,
  TASK_DETAIL_SYLLABUS_K3,
} from "../mockData";
import { useKadStore } from "../store";
import { useKadToast } from "./Toast";
import { AgentAvatar } from "./Avatar";
import { SensitivityBadge, TaskStatusChip } from "./StatusChip";
import { SegmentedProgress, ProgressBar } from "./Progress";
import { KadButton, KadEmptyState, KadTextarea } from "./primitives";
import { ArtifactViewer } from "./ArtifactViewer";
import {
  formatDueDate,
  formatPercent,
  formatRelativeTime,
  formatSlaCountdown,
  formatTokens,
  formatVnd,
} from "../format";
import { Sparkline } from "./Sparkline";
import {
  AgentProgressList,
  FilesPanel,
  agentProgress,
  artifactsForProject,
  artifactsForTask,
} from "./DetailPanels";

export const PEEK_TITLES: Record<PeekType, string> = {
  task: "Công việc",
  project: "Dự án",
  artifact: "Học liệu",
  approval: "Phê duyệt",
  agent: "Hồ sơ AI Agent",
  goal: "Mục tiêu",
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
      return <ArtifactPeek id={target.id} />;
    case "approval":
      return <ApprovalPeek id={target.id} onOpenPeek={onOpenPeek} onClose={onClose} />;
    case "agent":
      return <AgentPeek id={target.id} onOpenPeek={onOpenPeek} />;
    case "goal":
      return <GoalPeek id={target.id} onOpenPeek={onOpenPeek} />;
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
  const { tasks } = useKadStore();
  const task = tasks.find((t) => t.id === id);
  if (!task) return <KadEmptyState icon={MessageSquare} message="Không tìm thấy công việc." />;

  const detail = TASK_DETAIL_SYLLABUS_K3.id === id ? TASK_DETAIL_SYLLABUS_K3 : null;
  const lastMessages = detail ? detail.messages.slice(-4) : [];
  const taskFiles = artifactsForTask(id);

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
                {findAgent(task.assignedAgentId)?.displayName}
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

      {detail && (
        <Field label="Tiến độ">
          <SegmentedProgress steps={detail.steps} height={6} showLabels />
          <p className="kad-caption text-kad-text-muted mt-2">
            {formatTokens(detail.costToDateTokens)} · ~{formatVnd(detail.costToDateVnd)}
            {detail.activeDelegation ? ` · retry ${detail.activeDelegation.retryCount}` : ""}
          </p>
        </Field>
      )}

      <Field label="Trao đổi với Trợ lý vận hành">
        {lastMessages.length === 0 ? (
          <KadEmptyState icon={MessageSquare} message="Chưa có trao đổi." />
        ) : (
          <div className="space-y-2">
            {lastMessages.map((m) => (
              <div key={m.id} className="border border-kad-border rounded-lg px-3 py-2">
                <p className="kad-caption text-kad-text-muted">
                  {m.senderType === "human"
                    ? "Anh Khiêm"
                    : (findAgent(m.senderId)?.displayName ?? "Trợ lý vận hành")}{" "}
                  · {formatRelativeTime(m.createdAt)}
                </p>
                <p className="kad-body text-kad-text line-clamp-3">{m.content}</p>
              </div>
            ))}
          </div>
        )}
      </Field>

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

function ProjectPeek({ id, onOpenPeek }: { id: string; onOpenPeek: (t: PeekTarget) => void }) {
  const project = findProject(id);
  if (!project) return <KadEmptyState icon={MessageSquare} message="Không tìm thấy dự án." />;

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="kad-title text-kad-text-strong">{project.title}</h2>
        <p className="kad-caption text-kad-text-muted mt-1">
          {project.itemsDone}/{project.itemsTotal} hạng mục ·{" "}
          {formatDueDate(project.dueDate) ?? "Chưa có hạn"}
        </p>
      </div>
      <Field label="Workflow & tiến độ">
        <SegmentedProgress steps={project.steps} height={6} showLabels />
      </Field>
      <Field label="Thành viên AI & tiến độ">
        <AgentProgressList items={agentProgress(project.agentIdsInvolved, project.steps)} />
      </Field>
      <Field label="Files & học liệu">
        <FilesPanel
          artifacts={artifactsForProject(id)}
          onOpen={(aid) => onOpenPeek({ type: "artifact", id: aid })}
          emptyHint="Chưa có học liệu cho dự án này."
        />
      </Field>
    </div>
  );
}

// ── Artifact ───────────────────────────────────────────────────────────

function ArtifactPeek({ id }: { id: string }) {
  return (
    <div className="p-4">
      <ArtifactViewer artifactId={id} />
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
  if (!approval)
    return <KadEmptyState icon={MessageSquare} message="Không tìm thấy yêu cầu duyệt." />;

  const artifact = approval.artifactId ? findArtifact(approval.artifactId) : undefined;
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
              // Real approvals (Tổng quan track) carry agent_profiles ids that don't
              // match mockData's — prefer the store's real map when it has the id.
              const real = agentsById.get(approval.requestedByAgentId);
              const mock = real ? undefined : findAgent(approval.requestedByAgentId);
              return (
                <>
                  <AgentAvatar
                    agentId={approval.requestedByAgentId}
                    size={20}
                    displayNameOverride={real?.displayName}
                    agentNameOverride={real?.name}
                  />
                  <span className="kad-body text-kad-text">
                    {real?.displayName ?? mock?.displayName}
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
  const { tasks } = useKadStore();
  const agent = findAgent(id);
  if (!agent) return <KadEmptyState icon={MessageSquare} message="Không tìm thấy hồ sơ." />;
  const stats = AGENT_STATS[id];
  const activeTasks = tasks.filter((t) => t.assignedAgentId === id && t.status !== "done");

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-3">
        <AgentAvatar agentId={id} size={40} />
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
          <Sparkline values={stats.sparkline14d} variant="bar" height={28} />
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

const GOAL_RELATED_PROJECTS: Record<string, string[]> = {
  "goal-k3": ["proj-k3"],
  "goal-quy-trinh": ["proj-k3", "proj-video-k2", "proj-public-speaking"],
  "goal-template": [],
};

function GoalPeek({ id, onOpenPeek }: { id: string; onOpenPeek: (t: PeekTarget) => void }) {
  const { goals } = useKadStore();
  const goal = goals.find((g) => g.id === id);
  if (!goal) return <KadEmptyState icon={MessageSquare} message="Không tìm thấy mục tiêu." />;
  const percent = goal.target > 0 ? (goal.current / goal.target) * 100 : 0;
  const relatedIds = GOAL_RELATED_PROJECTS[id] ?? [];
  const related = relatedIds
    .map((pid) => PROJECTS.find((p) => p.id === pid))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

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
      <Field label="Công việc đang đóng góp">
        {related.length === 0 ? (
          <p className="kad-body text-kad-text-faint">Chưa có việc nào gắn trực tiếp.</p>
        ) : (
          <div className="space-y-2">
            {related.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenPeek({ type: "project", id: p.id })}
                className="w-full flex items-center justify-between gap-2 border border-kad-border rounded-lg px-3 py-2 hover:bg-kad-surface-2 text-left"
              >
                <span className="kad-body text-kad-text truncate">{p.title}</span>
                <span className="kad-caption text-kad-text-muted flex-shrink-0">
                  {p.itemsDone}/{p.itemsTotal}
                </span>
              </button>
            ))}
          </div>
        )}
      </Field>
    </div>
  );
}
