/**
 * Màn Tổng quan (`/`) — plans/260703-2330-kad-v2-build/spec/ui/02-man-tong-quan.md
 * "Sáng nay phòng đang ở đâu so với mục tiêu, và tôi cần chạm vào đúng những gì?"
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Inbox, RefreshCw, ShieldCheck, Target } from "lucide-react";
import { EXCEPTIONS, OPS_METRICS, RECENT_ARTIFACTS, findAgent } from "../mockData";
import { kadApi, type KadTask } from "../api-client";
import { useKadStore } from "../store";
import { useKadToast } from "../components/Toast";
import { usePeek } from "../components/PeekDrawer";
import { KadButton, KadCard, KadEmptyState, KadIconButton } from "../components/primitives";
import { StatusChip, TaskStatusChip } from "../components/StatusChip";
import { KpiCard } from "../components/KpiCard";
import { AgentAvatar } from "../components/Avatar";
import { ARTIFACT_TYPE_LABEL, approvalCategoryLabel } from "../labels";
import { formatRelativeTime, formatSlaCountdown, formatTokens, formatVnd } from "../format";
import type { Approval, ExceptionKind } from "../types";

function slaDeadlineMs(a: Approval): number {
  if (!a.slaReminderHours) return Infinity;
  return new Date(a.createdAt).getTime() + a.slaReminderHours * 3_600_000;
}

export function TongQuan() {
  return (
    <div className="grid grid-cols-12 gap-4 pb-10">
      <div className="col-span-12">
        <BlockGoals />
      </div>

      {/* 2026-07-04: "Đã xong gần đây" moved up from a full-width strip at the
          bottom of the page into this column, right under the 3 KPI cards —
          giving it the tall, prominent spot Khiêm marked on the reference
          screenshot (paired visually with "Cần tôi duyệt" + "Exception" on
          the right) instead of a footnote row. */}
      <div className="col-span-12 lg:col-span-8 space-y-4">
        <BlockProjects />
        <BlockOpsMetrics />
        <BlockRecentArtifacts />
      </div>

      <div className="col-span-12 lg:col-span-4 space-y-4">
        <BlockStandup />
        <BlockApprovals />
        <BlockExceptions />
      </div>
    </div>
  );
}

// ── A. Mục tiêu lớn ───────────────────────────────────────────────────────

function BlockGoals() {
  const { openPeek } = usePeek();
  const { goals } = useKadStore();
  const navigate = useNavigate();

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="kad-heading text-kad-text-strong">Mục tiêu lớn</h2>
        <KadButton
          variant="secondary"
          size="row"
          icon={Target}
          onClick={() => navigate("/muc-tieu-chien-luoc")}
        >
          Tạo mục tiêu &amp; chiến lược
        </KadButton>
      </div>
      {goals.length === 0 ? (
        <KadCard>
          <KadEmptyState
            icon={Target}
            message="Chưa đặt mục tiêu cho phòng."
            action={
              <KadButton variant="secondary" onClick={() => navigate("/muc-tieu-chien-luoc")}>
                Tạo mục tiêu &amp; chiến lược
              </KadButton>
            }
          />
        </KadCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {goals.map((goal) => {
            const percent = goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0;
            return (
              <button
                key={goal.id}
                type="button"
                onClick={() => openPeek({ type: "goal", id: goal.id })}
                className="text-left bg-kad-surface border border-kad-border rounded-xl p-4 hover:border-kad-border-strong transition-colors"
              >
                <p className="kad-heading text-kad-text-strong truncate">{goal.title}</p>
                <div className="mt-2.5 h-1 w-full rounded-full bg-kad-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-kad-primary"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="flex items-baseline justify-between mt-2">
                  <span className="kad-display text-kad-text-strong">{Math.round(percent)}%</span>
                  <span className="kad-caption text-kad-text-muted">{goal.due}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── B. Dự án & hạng mục ───────────────────────────────────────────────────

function BlockProjects() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<KadTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    kadApi.tasks
      .list({ limit: 5 })
      .then((rows) => {
        if (mounted) setTasks(rows);
      })
      .catch(() => {
        if (mounted) setTasks([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <KadCard>
      <div className="flex items-center justify-between mb-3">
        <h3 className="kad-heading text-kad-text-strong">Công việc đang chạy</h3>
        <button
          type="button"
          onClick={() => navigate("/he-thong/kanban")}
          className="kad-label text-kad-accent hover:underline flex items-center gap-1"
        >
          Xem tất cả <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      {loading ? (
        <KadEmptyState icon={RefreshCw} message="Đang tải công việc thật…" />
      ) : tasks.length === 0 ? (
        <KadEmptyState
          icon={Inbox}
          message="Chưa có công việc thật."
          action={
            <KadButton variant="secondary" onClick={() => navigate("/cong-viec/moi")}>
              Giao việc mới
            </KadButton>
          }
        />
      ) : (
        <div className="divide-y divide-kad-border">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => navigate(`/cong-viec/${task.id}`)}
              className="w-full h-12 flex items-center gap-3 text-left hover:bg-kad-surface-2 rounded-md px-2 -mx-2"
            >
              <span className="flex-1 min-w-0">
                <span className="kad-body text-kad-text truncate block">{task.title}</span>
                <span className="kad-caption text-kad-text-muted truncate block">
                  {task.workingDir || "Chưa chọn thư mục"} · {formatRelativeTime(task.updatedAt)}
                </span>
              </span>
              <TaskStatusChip status={task.status} />
            </button>
          ))}
        </div>
      )}
    </KadCard>
  );
}

// ── C. 3 chỉ số vận hành ────────────────────────────────────────────────

function BlockOpsMetrics() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {OPS_METRICS.map((metric) => (
        <KpiCard key={metric.label} metric={metric} />
      ))}
    </div>
  );
}

// ── E. Standup hôm nay ────────────────────────────────────────────────────

function BlockStandup() {
  const { standup, regenerateStandup } = useKadStore();
  const navigate = useNavigate();
  // Standup lines link real task ids (repo.tasks, not mockData's PROJECTS), so
  // they open the real task workspace (/cong-viec/:id, wired since P2A) rather
  // than a "project" peek that would look the id up in the mock array.
  const goToTask = (taskId: string) => navigate(`/cong-viec/${taskId}`);

  return (
    <KadCard>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="kad-heading text-kad-text-strong">Standup hôm nay</h3>
          {standup.generatedAt && (
            <p className="kad-caption text-kad-text-faint">
              Tạo lúc {formatRelativeTime(standup.generatedAt)}
            </p>
          )}
        </div>
        <KadIconButton icon={RefreshCw} label="Tạo lại" onClick={regenerateStandup} />
      </div>
      {!standup.generatedAt ? (
        <KadEmptyState
          icon={Target}
          message="Chưa tạo giao ban hôm nay."
          action={
            <KadButton variant="primary" onClick={regenerateStandup}>
              Tạo giao ban sáng
            </KadButton>
          }
        />
      ) : (
        <div className="space-y-3">
          <StandupGroup title="Đang chạy" lines={standup.dangChay} onLineClick={goToTask} />
          <StandupGroup title="Chờ anh" lines={standup.choAnh} onLineClick={goToTask} />
          <StandupGroup title="Rủi ro" lines={standup.ruiRo} onLineClick={goToTask} />
          <p className="kad-caption text-kad-text-faint pt-2 border-t border-kad-border">
            Hôm qua: {formatTokens(standup.costYesterdayTokens)} · ~
            {formatVnd(standup.costYesterdayVnd)}
          </p>
        </div>
      )}
    </KadCard>
  );
}

function StandupGroup({
  title,
  lines,
  onLineClick,
}: {
  title: string;
  lines: { text: string; linkTaskId?: string }[];
  onLineClick: (taskId: string) => void;
}) {
  if (lines.length === 0) return null;
  return (
    <div>
      <p className="kad-overline text-kad-text-faint mb-1">{title}</p>
      <div className="space-y-1">
        {lines.map((line, i) =>
          line.linkTaskId ? (
            <button
              key={i}
              type="button"
              onClick={() => onLineClick(line.linkTaskId!)}
              className="kad-body text-kad-accent hover:underline text-left block"
            >
              {line.text}
            </button>
          ) : (
            <p key={i} className="kad-body text-kad-text">
              {line.text}
            </p>
          )
        )}
      </div>
    </div>
  );
}

// ── F. Cần tôi duyệt ──────────────────────────────────────────────────────

function BlockApprovals() {
  const { approvals, decideApproval, agentsById } = useKadStore();
  const { openPeek } = usePeek();
  const toast = useKadToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const pending = [...approvals]
    .filter((a) => a.status === "pending")
    .sort((a, b) => slaDeadlineMs(a) - slaDeadlineMs(b));
  const shown = pending.slice(0, 6);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Each decide is its own request (no batch endpoint) — allSettled so one
  // failure doesn't hide the others, then report exactly how many of the
  // selection actually went through instead of a blanket "done".
  const approveBatch = async () => {
    const ids = [...selected];
    setBatchSubmitting(true);
    const results = await Promise.allSettled(ids.map((id) => decideApproval(id, "approved", null)));
    const failed = results.filter((r) => r.status === "rejected").length;
    setSelected(new Set());
    setBatchSubmitting(false);
    if (failed > 0) {
      toast({
        message: `Duyệt được ${ids.length - failed}/${ids.length} mục — ${failed} mục lỗi, thử lại.`,
        tone: "warning",
      });
    } else {
      toast({ message: `Đã duyệt ${ids.length} mục.`, tone: "success" });
    }
  };

  return (
    <KadCard>
      <h3 className="kad-heading text-kad-text-strong mb-3">Cần tôi duyệt</h3>
      {shown.length === 0 ? (
        <KadEmptyState icon={ShieldCheck} message="Không có gì chờ anh duyệt." />
      ) : (
        <div className="divide-y divide-kad-border">
          {shown.map((approval) => {
            const sla = approval.slaReminderHours
              ? formatSlaCountdown(new Date(slaDeadlineMs(approval)).toISOString())
              : null;
            return (
              <div key={approval.id} className="group h-11 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(approval.id)}
                  onChange={() => toggle(approval.id)}
                  style={{ accentColor: "var(--kad-accent)" }}
                  className="flex-shrink-0"
                  aria-label="Chọn"
                />
                <StatusChip
                  kind={
                    approval.sensitivitySubtype === "people"
                      ? "error"
                      : approval.sensitivitySubtype === "metrics"
                        ? "pending"
                        : approval.sensitivitySubtype === "brand"
                          ? "review"
                          : "neutral"
                  }
                  label={approvalCategoryLabel(approval.approvalType)}
                />
                <button
                  type="button"
                  onClick={() => openPeek({ type: "approval", id: approval.id })}
                  className="flex-1 min-w-0 text-left kad-body text-kad-text truncate"
                >
                  {approval.title}
                </button>
                <AgentAvatar
                  agentId={approval.requestedByAgentId}
                  size={20}
                  displayNameOverride={agentsById.get(approval.requestedByAgentId)?.displayName}
                  agentNameOverride={agentsById.get(approval.requestedByAgentId)?.name}
                />
                {sla && (
                  <span
                    className={`kad-caption flex-shrink-0 ${sla.overdue ? "text-kad-danger font-medium" : "text-kad-text-muted"}`}
                  >
                    {sla.text}
                  </span>
                )}
                <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {approval.approvalType === "plan" && (
                    <KadButton
                      variant="ghost"
                      size="row"
                      onClick={() =>
                        decideApproval(approval.id, "approved", null).catch((e) =>
                          toast({
                            message: e instanceof Error ? e.message : "Có lỗi xảy ra, thử lại.",
                            tone: "warning",
                          })
                        )
                      }
                    >
                      Duyệt
                    </KadButton>
                  )}
                  <KadButton
                    variant="ghost"
                    size="row"
                    onClick={() => openPeek({ type: "approval", id: approval.id })}
                  >
                    Xem
                  </KadButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {selected.size > 0 && (
        <div className="flex justify-end pt-3 mt-2 border-t border-kad-border">
          <KadButton variant="primary" disabled={batchSubmitting} onClick={approveBatch}>
            Duyệt {selected.size} mục đã chọn
          </KadButton>
        </div>
      )}
    </KadCard>
  );
}

// ── G. Exception ──────────────────────────────────────────────────────────

const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  run_failed: "Run lỗi",
  delegation_stuck: "Kẹt tiến trình",
  approval_sla: "Quá SLA duyệt",
  budget_exceeded: "Vượt ngân sách",
  connector_error: "Lỗi kết nối",
};

function BlockExceptions() {
  const { openPeek } = usePeek();
  const toast = useToastSafe();

  return (
    <KadCard>
      <h3 className="kad-heading text-kad-text-strong mb-3">Exception</h3>
      {EXCEPTIONS.length === 0 ? (
        <KadEmptyState icon={Inbox} message="Không có sự cố nào đang mở." />
      ) : (
        <div className="divide-y divide-kad-border">
          {EXCEPTIONS.slice(0, 4).map((exc) => (
            <div key={exc.id} className="h-10 flex items-center gap-2.5">
              <AlertTriangle
                className={`w-3.5 h-3.5 flex-shrink-0 ${exc.severity === "danger" ? "text-kad-danger" : "text-kad-warning"}`}
              />
              <div className="flex-1 min-w-0">
                <p className="kad-caption text-kad-text-muted">{EXCEPTION_LABEL[exc.kind]}</p>
                <p className="kad-body text-kad-text truncate">{exc.description}</p>
              </div>
              <KadButton
                variant="ghost"
                size="row"
                className="flex-shrink-0"
                onClick={() =>
                  exc.taskId ? openPeek({ type: "project", id: exc.taskId }) : toast()
                }
              >
                Xử lý
              </KadButton>
            </div>
          ))}
        </div>
      )}
    </KadCard>
  );
}

function useToastSafe() {
  // Exceptions without a linked task (e.g. connector_error) have nowhere to
  // deep-link yet in this mockup — /ket-noi is a later phase (spec 05 §2).
  return () =>
    window.alert("Xem chi tiết kết nối — màn Kết nối chưa nằm trong phạm vi mockup này.");
}

// ── D. Đã xong gần đây ────────────────────────────────────────────────────

type RecentRange = "ngay" | "tuan" | "thang";
const RECENT_RANGE_KEY = "kad-tong-quan-recent-range";
const RECENT_RANGE_MS: Record<RecentRange, number> = {
  ngay: 24 * 3_600_000,
  tuan: 7 * 24 * 3_600_000,
  thang: 30 * 24 * 3_600_000,
};
const RECENT_RANGE_TABS: { key: RecentRange; label: string }[] = [
  { key: "ngay", label: "Ngày" },
  { key: "tuan", label: "Tuần" },
  { key: "thang", label: "Tháng" },
];

function loadRecentRange(): RecentRange {
  try {
    const stored = localStorage.getItem(RECENT_RANGE_KEY);
    if (stored === "ngay" || stored === "tuan" || stored === "thang") return stored;
  } catch {
    /* ignore */
  }
  return "ngay";
}

function BlockRecentArtifacts() {
  const { openPeek } = usePeek();
  const [range, setRange] = useState<RecentRange>(loadRecentRange);

  const changeRange = (next: RecentRange) => {
    setRange(next);
    try {
      localStorage.setItem(RECENT_RANGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const now = Date.now();
  const items = RECENT_ARTIFACTS.filter(
    (a) => now - new Date(a.updatedAt).getTime() <= RECENT_RANGE_MS[range]
  );

  return (
    <KadCard>
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="kad-heading text-kad-text-strong">Đã xong gần đây</h3>
        {/* Calendar-style Day/Week/Month segmented switch. */}
        <div className="flex-shrink-0 inline-flex rounded-lg border border-kad-border p-0.5">
          {RECENT_RANGE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => changeRange(tab.key)}
              aria-pressed={range === tab.key}
              className={`h-7 px-3 rounded-md kad-label font-semibold transition-colors duration-150 ${
                range === tab.key
                  ? "bg-kad-surface-2 text-kad-primary"
                  : "text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2/60"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <KadEmptyState icon={Inbox} message="Chưa có học liệu nào hoàn thành trong khoảng này." />
      ) : range === "ngay" ? (
        // Ngày: lưới card — vùng hiển thị giờ cao hơn (đã lên cột trái, cạnh
        // "Cần tôi duyệt"/"Exception") nên card xếp lưới thay vì cuộn ngang.
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((artifact) => (
            <div
              key={artifact.id}
              className="min-h-[88px] border border-kad-border rounded-lg p-3 flex flex-col justify-between"
            >
              <div>
                <p className="kad-heading text-kad-text-strong truncate">{artifact.title}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <StatusChip kind="neutral" label={ARTIFACT_TYPE_LABEL[artifact.artifactType]} />
                  {artifact.qualityScore !== null ? (
                    <span className="kad-caption text-kad-success font-medium">
                      {artifact.qualityScore.toFixed(1)}/10
                    </span>
                  ) : (
                    <StatusChip kind="done" label="Đạt" />
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="kad-caption text-kad-text-muted truncate">
                  {findAgent(artifact.agentId)?.displayName} ·{" "}
                  {formatRelativeTime(artifact.updatedAt)}
                </span>
                <KadButton
                  variant="ghost"
                  size="row"
                  onClick={() => openPeek({ type: "artifact", id: artifact.id })}
                >
                  Xem nhanh
                </KadButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Tuần/Tháng: danh sách gọn — nhiều mục hơn, ưu tiên quét nhanh thay
        // vì chi tiết từng card.
        <div className="divide-y divide-kad-border">
          {items.map((artifact) => (
            <div key={artifact.id} className="h-11 flex items-center gap-3">
              <StatusChip kind="neutral" label={ARTIFACT_TYPE_LABEL[artifact.artifactType]} />
              <button
                type="button"
                onClick={() => openPeek({ type: "artifact", id: artifact.id })}
                className="flex-1 min-w-0 text-left kad-body text-kad-text truncate hover:underline"
              >
                {artifact.title}
              </button>
              {artifact.qualityScore !== null ? (
                <span className="kad-caption text-kad-success font-medium flex-shrink-0">
                  {artifact.qualityScore.toFixed(1)}/10
                </span>
              ) : (
                <StatusChip kind="done" label="Đạt" />
              )}
              <span className="kad-caption text-kad-text-muted flex-shrink-0 hidden sm:inline">
                {findAgent(artifact.agentId)?.displayName}
              </span>
              <span className="kad-caption text-kad-text-muted flex-shrink-0 w-20 text-right">
                {formatRelativeTime(artifact.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </KadCard>
  );
}
