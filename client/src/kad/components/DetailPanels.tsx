/**
 * Panels dùng chung cho khay chi tiết bên phải (right sidebar) — spec/ui/08.
 * Nay chỉ còn `artifactApprovalChip` + `FilesPanel`; dữ liệu artifact thật do
 * caller fetch (PeekContent) rồi truyền vào — không còn helper suy từ mockData.
 */
import { FileText } from "lucide-react";
import { ARTIFACT_TYPE_LABEL } from "../labels";
import type { Artifact } from "../types";

// ── Trạng thái duyệt: suy 1 chip từ Artifact.status ─────────────────────────
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
  if (a.status === "archived") return { label: "Đã thay thế", tone: "old" };
  if (a.status === "approved" || a.status === "published") return { label: "Đã duyệt", tone: "ok" };
  if (a.status === "review") return { label: "Chờ duyệt", tone: "rev" };
  return { label: "Nháp", tone: "draft" };
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
