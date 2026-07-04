/**
 * Status chip — 06-components.md §2. Mapping is fixed system-wide; callers
 * resolve their entity's raw status to one of the 7 semantic buckets via the
 * helper functions below (kept explicit per entity type since the same raw
 * string, e.g. "review", renders differently for a task vs. an artifact).
 */
import { BarChart3, Tag, User } from "lucide-react";
import type {
  ApprovalStatus,
  ArtifactStatus,
  DelegationStatus,
  RunStatus,
  SensitivitySubtype,
  TaskStatus,
} from "../types";

export type ChipKind = "doing" | "pending" | "needs_changes" | "done" | "error" | "neutral" | "review";

const CHIP_STYLE: Record<ChipKind, { bg: string; text: string; border?: string }> = {
  doing: { bg: "#EAF3FF", text: "#0E5BD1" },
  pending: { bg: "#FBF3E4", text: "#B97D10" },
  needs_changes: { bg: "#FBF3E4", text: "#B97D10", border: "#B97D1055" },
  done: { bg: "#E6F6EF", text: "#177E56" },
  error: { bg: "#FCEAEA", text: "#C22F35" },
  neutral: { bg: "var(--kad-surface-2)", text: "var(--kad-text-muted)" },
  review: { bg: "#E8F4F7", text: "#0E7490" },
};

export function StatusChip({ kind, label }: { kind: ChipKind; label: string }) {
  const style = CHIP_STYLE[kind];
  return (
    <span
      className="kad-label inline-flex items-center gap-1.5 rounded-full px-2 h-[22px] whitespace-nowrap"
      style={{
        backgroundColor: style.bg,
        color: style.text,
        border: style.border ? `1px solid ${style.border}` : undefined,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: style.text }} />
      {label}
    </span>
  );
}

// ── Per-entity label + chip-kind resolution ───────────────────────────────

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  blocked: "Chờ điều kiện",
  inbox: "Hàng đợi",
  triaged: "Đã phân loại",
  doing: "Đang làm",
  waiting_human: "Chờ duyệt",
  review: "Đang kiểm",
  needs_changes: "Cần sửa",
  done: "Xong",
  failed: "Lỗi",
  archived: "Lưu trữ",
};

const TASK_STATUS_KIND: Record<TaskStatus, ChipKind> = {
  blocked: "neutral",
  inbox: "neutral",
  triaged: "neutral",
  doing: "doing",
  waiting_human: "pending",
  review: "doing",
  needs_changes: "needs_changes",
  done: "done",
  failed: "error",
  archived: "neutral",
};

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return <StatusChip kind={TASK_STATUS_KIND[status]} label={TASK_STATUS_LABEL[status]} />;
}

const ARTIFACT_STATUS_LABEL: Record<ArtifactStatus, string> = {
  draft: "Nháp",
  review: "Đang kiểm",
  approved: "Đã duyệt",
  published: "Đã xuất bản",
  archived: "Lưu trữ",
};

const ARTIFACT_STATUS_KIND: Record<ArtifactStatus, ChipKind> = {
  draft: "neutral",
  review: "review",
  approved: "done",
  published: "done",
  archived: "neutral",
};

export function ArtifactStatusChip({ status }: { status: ArtifactStatus }) {
  return <StatusChip kind={ARTIFACT_STATUS_KIND[status]} label={ARTIFACT_STATUS_LABEL[status]} />;
}

const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  needs_changes: "Cần sửa",
  rejected: "Từ chối",
};

const APPROVAL_STATUS_KIND: Record<ApprovalStatus, ChipKind> = {
  pending: "pending",
  approved: "done",
  needs_changes: "needs_changes",
  rejected: "error",
};

export function ApprovalStatusChip({ status }: { status: ApprovalStatus }) {
  return <StatusChip kind={APPROVAL_STATUS_KIND[status]} label={APPROVAL_STATUS_LABEL[status]} />;
}

const DELEGATION_STATUS_LABEL: Record<DelegationStatus, string> = {
  pending: "Chờ chạy",
  running: "Đang chạy",
  review: "Đang kiểm",
  done: "Xong",
  failed: "Lỗi",
  cancelled: "Đã huỷ",
};

const DELEGATION_STATUS_KIND: Record<DelegationStatus, ChipKind> = {
  pending: "neutral",
  running: "doing",
  review: "review",
  done: "done",
  failed: "error",
  cancelled: "neutral",
};

export function DelegationStatusChip({ status }: { status: DelegationStatus }) {
  return <StatusChip kind={DELEGATION_STATUS_KIND[status]} label={DELEGATION_STATUS_LABEL[status]} />;
}

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  pending: "Chờ chạy",
  running: "Đang chạy",
  waiting_approval: "Chờ phê duyệt",
  completed: "Hoàn thành",
  failed: "Lỗi",
  cancelled: "Đã huỷ",
};

const RUN_STATUS_KIND: Record<RunStatus, ChipKind> = {
  pending: "neutral",
  running: "doing",
  waiting_approval: "pending",
  completed: "done",
  failed: "error",
  cancelled: "neutral",
};

export function RunStatusChip({ status }: { status: RunStatus }) {
  return <StatusChip kind={RUN_STATUS_KIND[status]} label={RUN_STATUS_LABEL[status]} />;
}

// ── Sensitivity badge — metrics=warning, people=danger, brand=info ───────

const SENSITIVITY_CONFIG: Record<
  SensitivitySubtype,
  { bg: string; text: string; icon: typeof BarChart3; label: string }
> = {
  metrics: { bg: "#FBF3E4", text: "#B97D10", icon: BarChart3, label: "Số liệu" },
  people: { bg: "#FCEAEA", text: "#C22F35", icon: User, label: "Con người" },
  brand: { bg: "#E8F4F7", text: "#0E7490", icon: Tag, label: "Thương hiệu" },
};

export function SensitivityBadge({ subtype }: { subtype: SensitivitySubtype }) {
  const cfg = SENSITIVITY_CONFIG[subtype];
  const Icon = cfg.icon;
  return (
    <span
      className="kad-label inline-flex items-center gap-1 rounded-full px-2 h-[22px] whitespace-nowrap"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      <Icon className="w-3 h-3" aria-hidden />
      {cfg.label}
    </span>
  );
}
