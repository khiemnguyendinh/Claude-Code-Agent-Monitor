/**
 * Màn Học liệu (`/hoc-lieu`) — nhóm phụ sidebar, "Spec sau" (README §routes).
 * Mockup: kho toàn bộ artifact toàn phòng ban, lọc theo loại, mở peek để
 * xem nhanh — tái dùng đúng card pattern & peek đã có ở Tổng quan, không
 * bịa thêm luồng nghiệp vụ chưa có spec chi tiết (folder, tìm kiếm ngữ
 * nghĩa, xuất bản hàng loạt... để dành cho spec riêng của màn này).
 */
import { useMemo, useState } from "react";
import { FileQuestion } from "lucide-react";
import { ARTIFACTS, findAgent } from "../mockData";
import { ARTIFACT_TYPE_LABEL } from "../labels";
import { usePeek } from "../components/PeekDrawer";
import { KadEmptyState } from "../components/primitives";
import { StatusChip, ArtifactStatusChip } from "../components/StatusChip";
import { AgentAvatar } from "../components/Avatar";
import { formatRelativeTime } from "../format";
import type { ArtifactType } from "../types";

export function HocLieu() {
  const { openPeek } = usePeek();
  const [typeFilter, setTypeFilter] = useState<ArtifactType | "all">("all");

  const types = useMemo(() => {
    const present = new Set(ARTIFACTS.map((a) => a.artifactType));
    return Array.from(present);
  }, []);

  const filtered = useMemo(() => {
    const list = typeFilter === "all" ? ARTIFACTS : ARTIFACTS.filter((a) => a.artifactType === typeFilter);
    return [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [typeFilter]);

  return (
    <div className="pb-10">
      <h1 className="kad-title text-kad-text-strong mb-1">Học liệu</h1>
      <p className="kad-caption text-kad-text-faint mb-4">
        Toàn bộ học liệu đã tạo trong phòng ban. Bộ lọc nâng cao & thư viện theo khoá học sẽ có ở spec riêng.
      </p>

      <div className="flex items-center gap-1.5 flex-wrap mb-5">
        <TypeChip active={typeFilter === "all"} label="Tất cả" onClick={() => setTypeFilter("all")} />
        {types.map((t) => (
          <TypeChip key={t} active={typeFilter === t} label={ARTIFACT_TYPE_LABEL[t]} onClick={() => setTypeFilter(t)} />
        ))}
      </div>

      {filtered.length === 0 ? (
        <KadEmptyState icon={FileQuestion} message="Không có học liệu phù hợp bộ lọc." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => openPeek({ type: "artifact", id: artifact.id })}
              className="text-left border border-kad-border rounded-lg p-3.5 hover:border-kad-border-strong transition-colors bg-kad-surface"
            >
              <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                <StatusChip kind="neutral" label={ARTIFACT_TYPE_LABEL[artifact.artifactType]} />
                <ArtifactStatusChip status={artifact.status} />
              </div>
              <p className="kad-heading text-kad-text-strong truncate">{artifact.title}</p>
              <div className="flex items-center justify-between mt-2.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AgentAvatar agentId={artifact.agentId} size={20} />
                  <span className="kad-caption text-kad-text-muted truncate">
                    {findAgent(artifact.agentId)?.displayName}
                  </span>
                </div>
                <span className="kad-caption text-kad-text-faint flex-shrink-0">
                  {artifact.qualityScore !== null ? `${artifact.qualityScore.toFixed(1)}/10 · ` : ""}
                  {formatRelativeTime(artifact.updatedAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`kad-label h-7 px-2.5 rounded-full border transition-colors ${
        active
          ? "bg-kad-primary text-white border-kad-primary"
          : "bg-transparent text-kad-text-muted border-kad-border hover:border-kad-border-strong"
      }`}
    >
      {label}
    </button>
  );
}
