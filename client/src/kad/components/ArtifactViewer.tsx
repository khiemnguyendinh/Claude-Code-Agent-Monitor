/**
 * Shared artifact viewer — markdown render + version selector + diff toggle
 * + status-driven footer actions. Used by both the peek drawer (PeekContent)
 * and the full Trao đổi công việc artifact panel (05-man-trao-doi-cong-viec
 * §3), so the two surfaces never drift apart.
 */
import { useState } from "react";
import { Download, FileQuestion } from "lucide-react";
import { ARTIFACTS, findArtifact } from "../mockData";
import type { Artifact } from "../types";
import { useKadToast } from "./Toast";
import { ArtifactStatusChip, SensitivityBadge } from "./StatusChip";
import { KadButton, KadEmptyState } from "./primitives";
import { MarkdownDiffView, MarkdownLite } from "./MarkdownLite";
import { diffLines } from "../diff";

interface ArtifactViewerProps {
  artifactId: string;
  // Real-data override — screens wired to /api/kad/* pass the artifact (and its
  // sibling versions) they already fetched instead of the mockData registry.
  artifact?: Artifact;
  versions?: Artifact[];
}

export function ArtifactViewer({
  artifactId,
  artifact: artifactOverride,
  versions: versionsOverride,
}: ArtifactViewerProps) {
  const toast = useKadToast();
  const artifact = artifactOverride ?? findArtifact(artifactId);
  const [showDiff, setShowDiff] = useState(false);
  if (!artifact) return <KadEmptyState icon={FileQuestion} message="Không tìm thấy học liệu." />;

  const versions = (
    versionsOverride ??
    ARTIFACTS.filter(
      (a) => a.taskId === artifact.taskId && a.artifactType === artifact.artifactType
    )
  ).sort((a, b) => a.version - b.version);
  const previous = versions.find((v) => v.version === artifact.version - 1);
  const hasSensitivity =
    artifact.sensitivityFlags.metrics ||
    artifact.sensitivityFlags.people ||
    artifact.sensitivityFlags.brand;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <ArtifactStatusChip status={artifact.status} />
          <span className="kad-caption text-kad-text-muted">v{artifact.version}</span>
          {artifact.qualityScore !== null && (
            <span className="kad-caption text-kad-success font-medium">
              {artifact.qualityScore.toFixed(1)}/10
            </span>
          )}
        </div>
        <h2 className="kad-title text-kad-text-strong mt-2">{artifact.title}</h2>
      </div>

      {hasSensitivity && (
        <div className="flex gap-1.5 flex-wrap">
          {artifact.sensitivityFlags.metrics && <SensitivityBadge subtype="metrics" />}
          {artifact.sensitivityFlags.people && <SensitivityBadge subtype="people" />}
          {artifact.sensitivityFlags.brand && <SensitivityBadge subtype="brand" />}
        </div>
      )}

      {versions.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 border border-kad-border rounded-lg p-0.5">
            {versions.map((v) => (
              <span
                key={v.id}
                className={`kad-caption px-2 py-1 rounded-md ${
                  v.id === artifact.id
                    ? "bg-kad-surface-2 text-kad-text-strong font-medium"
                    : "text-kad-text-muted"
                }`}
              >
                v{v.version}
              </span>
            ))}
          </div>
          {previous && (
            <KadButton variant="secondary" size="row" onClick={() => setShowDiff((s) => !s)}>
              {showDiff ? "Ẩn so sánh" : "So sánh với bản trước"}
            </KadButton>
          )}
        </div>
      )}

      {showDiff && previous ? (
        <MarkdownDiffView lines={diffLines(previous.content, artifact.content)} />
      ) : (
        <MarkdownLite content={artifact.content} />
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-kad-border">
        {artifact.status === "review" && (
          <>
            <KadButton
              variant="primary"
              onClick={() => toast({ message: "Đã duyệt học liệu.", tone: "success" })}
            >
              Duyệt
            </KadButton>
            <KadButton
              variant="secondary"
              onClick={() => toast({ message: "Đã gửi yêu cầu sửa.", tone: "warning" })}
            >
              Yêu cầu sửa
            </KadButton>
          </>
        )}
        {artifact.status === "approved" && (
          <KadButton
            variant="secondary"
            onClick={() => toast({ message: "Kết nối xuất bản chưa nằm trong phạm vi mockup." })}
          >
            Xuất bản…
          </KadButton>
        )}
        <KadButton
          variant="ghost"
          icon={Download}
          onClick={() => toast({ message: "Bản mockup — chưa xuất file thật." })}
          className="ml-auto"
        >
          Tải .md
        </KadButton>
      </div>
    </div>
  );
}
