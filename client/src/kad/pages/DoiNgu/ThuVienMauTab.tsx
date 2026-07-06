import { useEffect, useState } from "react";
import { Eye, File as FileIcon, Upload } from "lucide-react";
import { kadApi } from "../../api-client";
import type { TemplateLibraryRow } from "../../api-client";
import { useKadToast } from "../../components/Toast";
import {
  KadButton,
  KadCard,
  KadErrorBlock,
  KadInput,
  KadSkeleton,
} from "../../components/primitives";
import { MarkdownLite } from "../../components/MarkdownLite";
import { FilePreviewModal } from "../../components/FilePreviewModal";

const BINARY_EXTENSIONS = [".docx", ".pdf", ".xlsx"];

export function ThuVienMauTab() {
  const [templates, setTemplates] = useState<TemplateLibraryRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadPurpose, setUploadPurpose] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{
    id: string;
    fileName: string;
    mimeType?: string | null;
  } | null>(null);
  const toast = useKadToast();

  const refresh = () => {
    setLoading(true);
    setError(false);
    kadApi.templates
      .list()
      .then((rows) => {
        setTemplates(rows);
        setSelectedId((prev) => prev || rows[0]?.id || null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const selected = templates.find((t) => t.id === selectedId) || templates[0] || null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const isBinary = BINARY_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    setUploadName(file.name.replace(/\.(md|docx|pdf|xlsx)$/i, ""));
    if (isBinary) {
      setUploadFile(file);
      setUploadContent("");
    } else {
      setUploadFile(null);
      setUploadContent(await file.text());
    }
  };

  const createDraft = () => {
    if (!uploadContent.trim() && !uploadFile) return;
    setSaving(true);
    const req = uploadFile
      ? kadApi.templates.uploadFile(uploadFile, {
          name: uploadName || "Template mới",
          template_type: "custom",
          purpose: uploadPurpose || "Custom template",
        })
      : kadApi.templates.createDraft({
          name: uploadName || "Template mới",
          file_name: uploadName.endsWith(".md") ? uploadName : `${uploadName || "template"}.md`,
          template_type: "custom",
          purpose: uploadPurpose || "Custom template",
          content: uploadContent,
        });
    req
      .then((result) => {
        toast({ message: "Đã tạo template draft.", tone: "success" });
        setUploadContent("");
        setUploadFile(null);
        setUploadName("");
        setUploadPurpose("");
        setSelectedId(result.template.id);
        refresh();
      })
      .catch((e) =>
        toast({
          message: e instanceof Error ? e.message : "Không tạo được template.",
          tone: "warning",
        })
      )
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <KadSkeleton className="h-72 w-full" />
        <KadSkeleton className="h-72 w-full" />
      </div>
    );
  }
  if (error) return <KadErrorBlock onRetry={refresh} />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <div className="space-y-4">
        <KadCard>
          <div className="flex items-center justify-between mb-3">
            <h2 className="kad-heading text-kad-text-strong">Template</h2>
            <span className="kad-caption text-kad-text-faint">{templates.length} mẫu</span>
          </div>
          <div className="space-y-1 max-h-[480px] overflow-auto">
            {templates.map((tpl) => {
              const active = tpl.id === selected?.id;
              const version = tpl.latest_version;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedId(tpl.id)}
                  className={`w-full text-left rounded-lg px-3 py-2 border ${
                    active
                      ? "border-kad-primary bg-kad-surface-2"
                      : "border-transparent hover:bg-kad-surface-2"
                  }`}
                >
                  <p className="kad-body text-kad-text truncate">{tpl.name}</p>
                  <p className="kad-caption text-kad-text-muted truncate">
                    {tpl.template_type} · v{version?.version ?? "-"} ·{" "}
                    {version?.status ?? "no version"} · {tpl.usage_count} lượt dùng
                  </p>
                </button>
              );
            })}
          </div>
        </KadCard>

        <KadCard>
          <h3 className="kad-heading text-kad-text-strong mb-3">
            Upload .md / .docx / .pdf / .xlsx
          </h3>
          <div className="space-y-3">
            <label className="inline-flex">
              <input
                type="file"
                accept=".md,.docx,.pdf,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <span className="kad-label inline-flex h-9 items-center gap-1.5 rounded-lg border border-kad-border-strong px-3 text-kad-text cursor-pointer">
                <Upload className="w-4 h-4" aria-hidden />
                Chọn file
              </span>
            </label>
            <KadInput
              value={uploadName}
              placeholder="Tên template"
              onChange={(e) => setUploadName(e.target.value)}
            />
            <KadInput
              value={uploadPurpose}
              placeholder="Mục đích"
              onChange={(e) => setUploadPurpose(e.target.value)}
            />
            {uploadContent && (
              <p className="kad-caption text-kad-text-faint">
                {uploadContent.length.toLocaleString("vi-VN")} ký tự
              </p>
            )}
            {uploadFile && (
              <p className="kad-caption text-kad-text-faint">
                {uploadFile.name} · {(uploadFile.size / 1024).toFixed(0)} KB
              </p>
            )}
            <KadButton
              variant="primary"
              loading={saving}
              disabled={!uploadContent.trim() && !uploadFile}
              onClick={createDraft}
            >
              Tạo draft
            </KadButton>
          </div>
        </KadCard>
      </div>

      <div>
        {selected ? (
          <KadCard>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h2 className="kad-title text-kad-text-strong truncate">{selected.name}</h2>
                <p className="kad-caption text-kad-text-muted">
                  {selected.template_type} · {selected.purpose || "Không có mô tả"}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {selected.latest_version?.status === "draft" && (
                  <KadButton
                    variant="primary"
                    size="row"
                    onClick={() => {
                      kadApi.templates
                        .approve(selected.latest_version?.id || selected.id)
                        .then(() => {
                          toast({ message: "Đã duyệt template.", tone: "success" });
                          refresh();
                        })
                        .catch((e) =>
                          toast({
                            message: e instanceof Error ? e.message : "Không duyệt được.",
                            tone: "warning",
                          })
                        );
                    }}
                  >
                    Duyệt v{selected.latest_version.version}
                  </KadButton>
                )}
                <KadButton
                  variant="danger"
                  size="row"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Xóa template "${selected.name}"? Có thể khôi phục lại nếu cần.`
                      )
                    )
                      return;
                    kadApi.templates
                      .archive(selected.id)
                      .then(() => {
                        toast({ message: "Đã xóa template.", tone: "success" });
                        refresh();
                      })
                      .catch((e) =>
                        toast({
                          message: e instanceof Error ? e.message : "Không xóa được.",
                          tone: "warning",
                        })
                      );
                  }}
                >
                  Xóa
                </KadButton>
              </div>
            </div>
            {(() => {
              const displayVersion = selected.latest_version || selected.approved_version;
              if (displayVersion?.file_path) {
                return (
                  <div className="flex items-center gap-3 rounded-lg border border-kad-border px-4 py-3">
                    <FileIcon className="w-5 h-5 text-kad-text-faint flex-shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="kad-body text-kad-text truncate">
                        {displayVersion.original_file_name || "template"}
                      </p>
                      <p className="kad-caption text-kad-text-faint">{displayVersion.mime_type}</p>
                    </div>
                    <KadButton
                      variant="ghost"
                      size="row"
                      icon={Eye}
                      onClick={() =>
                        setPreview({
                          id: displayVersion.id,
                          fileName: displayVersion.original_file_name || "template",
                          mimeType: displayVersion.mime_type,
                        })
                      }
                      className="flex-shrink-0"
                    >
                      Xem trước
                    </KadButton>
                    <a
                      href={kadApi.templates.downloadUrl(displayVersion.id)}
                      className="kad-label text-kad-accent hover:underline flex-shrink-0"
                    >
                      Tải xuống
                    </a>
                  </div>
                );
              }
              return <MarkdownLite content={displayVersion?.content || ""} />;
            })()}
          </KadCard>
        ) : (
          <KadCard>
            <p className="kad-body text-kad-text-muted">Chưa có template.</p>
          </KadCard>
        )}
      </div>

      {preview && (
        <FilePreviewModal
          fileName={preview.fileName}
          mimeType={preview.mimeType}
          previewUrl={kadApi.templates.previewUrl(preview.id)}
          downloadUrl={kadApi.templates.downloadUrl(preview.id)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
