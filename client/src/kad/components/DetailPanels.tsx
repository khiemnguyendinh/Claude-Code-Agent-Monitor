/**
 * Panels dùng chung cho khay chi tiết bên phải (right sidebar) — spec/ui/08
 * "Bổ sung 2026-07-04". Cố ý KHÔNG phụ thuộc KadStore: mọi dữ liệu suy tĩnh
 * từ mockData qua helper, để dùng được cả trong KAD shell (PeekContent, có
 * provider) lẫn trang Kanban /he-thong (ProjectDetailDrawer, KHÔNG mount
 * provider KAD). Khi có backend, thay 3 helper (artifactsForProject,
 * artifactsForTask, agentProgress) bằng fetch API — component render giữ nguyên.
 */
import { FileText } from "lucide-react";
import { APPROVALS, ARTIFACTS, TASK_CARDS, findAgent } from "../mockData";
import { ARTIFACT_TYPE_LABEL } from "../labels";
import type { Artifact, ProjectStepProgress, StepState } from "../types";
import { AgentAvatar } from "./Avatar";

// ── Trạng thái duyệt: suy 1 chip từ Artifact.status + Approval ───────────────
type ApprovalTone = "ok" | "rev" | "chg" | "draft" | "old";

const TONE_COLOR: Record<ApprovalTone, string> = {
  ok: "var(--kad-success)",
  rev: "var(--kad-warning)",
  chg: "var(--kad-danger)",
  draft: "var(--kad-text-muted)",
  old: "var(--kad-border-strong)",
};
const TONE_BG: Record<ApprovalTone, string> = {
  ok: "rgba(31,174,115,.12)",
  rev: "rgba(185,125,16,.12)",
  chg: "rgba(214,55,61,.10)",
  draft: "var(--kad-surface-2)",
  old: "var(--kad-surface-2)",
};

export function artifactApprovalChip(a: Artifact): { label: string; tone: ApprovalTone } {
  const appr = APPROVALS.find((x) => x.artifactId === a.id);
  if (a.status === "archived") return { label: "Đã thay thế", tone: "old" };
  if (appr?.status === "needs_changes") return { label: "Cần sửa", tone: "chg" };
  if (a.status === "approved" || a.status === "published") return { label: "Đã duyệt", tone: "ok" };
  if (a.status === "review") return { label: "Chờ duyệt", tone: "rev" };
  return { label: "Nháp", tone: "draft" };
}

// ── Helper suy dữ liệu (thay bằng fetch khi có backend) ─────────────────────
export function artifactsForProject(projectId: string): Artifact[] {
  const childIds = new Set(TASK_CARDS.filter((t) => t.parentTaskId === projectId).map((t) => t.id));
  return ARTIFACTS.filter((a) => a.taskId === projectId || childIds.has(a.taskId));
}

export function artifactsForTask(taskId: string): Artifact[] {
  return ARTIFACTS.filter((a) => a.taskId === taskId);
}

export interface AgentProg {
  agentId: string;
  pct: number;
  state: StepState;
  stepLabel?: string;
}

/** Progress từng thành viên AI = tổng hợp các bước họ phụ trách trong pipeline. */
export function agentProgress(agentIds: string[], steps: ProjectStepProgress[]): AgentProg[] {
  return agentIds.map((agentId) => {
    const own = steps.filter((s) => s.agentId === agentId);
    const total = own.length;
    const done = own.filter((s) => s.state === "done").length;
    const doing = own.filter((s) => s.state === "doing").length;
    const waiting = own.filter((s) => s.state === "waiting_human").length;
    const failed = own.some((s) => s.state === "failed");
    const pct = total > 0 ? Math.round(((done + doing * 0.6 + waiting * 0.9) / total) * 100) : 0;
    const state: StepState = failed
      ? "failed"
      : waiting > 0
        ? "waiting_human"
        : doing > 0
          ? "doing"
          : total > 0 && done === total
            ? "done"
            : "todo";
    const current =
      own.find((s) => s.state === "doing" || s.state === "waiting_human") ??
      own.find((s) => s.state !== "done") ??
      own[own.length - 1];
    return { agentId, pct, state, stepLabel: current?.label };
  });
}

const STATE_COLOR: Record<StepState, string> = {
  done: "var(--kad-success)",
  doing: "var(--kad-accent)",
  waiting_human: "var(--kad-warning)",
  failed: "var(--kad-danger)",
  todo: "var(--kad-border-strong)",
};
const STATE_LABEL: Record<StepState, string> = {
  done: "Xong",
  doing: "Đang chạy",
  waiting_human: "Chờ duyệt",
  failed: "Lỗi",
  todo: "Chưa tới",
};

// ── Thành viên AI + progress từng người ─────────────────────────────────────
export function AgentProgressList({ items }: { items: AgentProg[] }) {
  if (items.length === 0) {
    return <p className="kad-body text-kad-text-faint">Chưa có thành viên tham gia.</p>;
  }
  return (
    <div>
      {items.map((it, i) => {
        const agent = findAgent(it.agentId);
        return (
          <div
            key={it.agentId}
            className={`flex items-center gap-2.5 py-2 ${i > 0 ? "border-t border-kad-border" : ""}`}
          >
            <AgentAvatar agentId={it.agentId} size={28} />
            <div className="flex-1 min-w-0">
              <p className="kad-label text-kad-text-strong truncate">{agent?.displayName ?? it.agentId}</p>
              <p className="kad-caption text-kad-text-muted truncate">
                {it.stepLabel ? `${it.stepLabel} · ${STATE_LABEL[it.state]}` : STATE_LABEL[it.state]}
              </p>
              <div className="mt-1 h-[5px] rounded-full bg-kad-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${it.pct}%`, backgroundColor: STATE_COLOR[it.state] }}
                />
              </div>
            </div>
            <span className="kad-label text-kad-text-strong flex-shrink-0 w-10 text-right">{it.pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Files & học liệu (kèm trạng thái duyệt) — panel kiểu Claude Code ─────────
export function FilesPanel({
  artifacts,
  onOpen,
  emptyHint,
}: {
  artifacts: Artifact[];
  onOpen?: (id: string) => void;
  emptyHint?: string;
}) {
  if (artifacts.length === 0) {
    return <p className="kad-body text-kad-text-faint">{emptyHint ?? "Chưa có file nào."}</p>;
  }
  return (
    <div className="space-y-2">
      {artifacts.map((a) => {
        const chip = artifactApprovalChip(a);
        const clickable = Boolean(onOpen);
        return (
          <div
            key={a.id}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={onOpen ? () => onOpen(a.id) : undefined}
            onKeyDown={
              onOpen
                ? (e) => {
                    if (e.key === "Enter") onOpen(a.id);
                  }
                : undefined
            }
            className={`w-full flex items-start gap-2.5 p-2.5 rounded-lg border border-kad-border ${
              clickable ? "cursor-pointer hover:bg-kad-surface-2 transition-colors" : ""
            } ${chip.tone === "old" ? "opacity-70" : ""}`}
            style={{ borderLeftWidth: 3, borderLeftColor: TONE_COLOR[chip.tone] }}
          >
            <span className="w-6 h-6 rounded-md flex-shrink-0 grid place-items-center bg-kad-surface-2 text-kad-accent">
              <FileText className="w-3.5 h-3.5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="kad-caption text-kad-text-strong font-medium truncate">{a.title}</span>
                {a.version > 1 && <span className="kad-caption text-kad-text-faint flex-shrink-0">v{a.version}</span>}
              </span>
              <span className="kad-caption text-kad-text-muted block truncate">
                {ARTIFACT_TYPE_LABEL[a.artifactType]}
              </span>
            </span>
            <span className="flex-shrink-0 flex flex-col items-end gap-1">
              {a.qualityScore !== null && (
                <span className="kad-caption text-kad-text-muted">{a.qualityScore.toFixed(1)}/10</span>
              )}
              <span
                className="kad-caption font-medium rounded px-1.5 py-0.5 whitespace-nowrap"
                style={{ color: TONE_COLOR[chip.tone], backgroundColor: TONE_BG[chip.tone] }}
              >
                {chip.label}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
