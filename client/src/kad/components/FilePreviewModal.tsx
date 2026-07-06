/**
 * FilePreviewModal — shared "quick view" overlay for stored templates & học
 * liệu files (docx/pdf/xlsx/images). Renders inline for formats the browser
 * can natively display (PDF, images); everything else falls back to a
 * download prompt since there's no in-house docx/xlsx renderer.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";

interface FilePreviewModalProps {
  fileName: string;
  mimeType?: string | null;
  previewUrl: string;
  downloadUrl: string;
  onClose: () => void;
}

const isPdf = (mimeType?: string | null) => mimeType === "application/pdf";
const isImage = (mimeType?: string | null) => Boolean(mimeType?.startsWith("image/"));

export function FilePreviewModal({
  fileName,
  mimeType,
  previewUrl,
  downloadUrl,
  onClose,
}: FilePreviewModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="kad-root fixed inset-0 z-[220] flex items-center justify-center p-6 bg-[#0e12304d]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[900px] h-[85vh] bg-kad-surface border border-kad-border rounded-xl overflow-hidden flex flex-col"
        style={{ boxShadow: "var(--kad-shadow-1)" }}
        role="dialog"
        aria-modal="true"
        aria-label={fileName}
      >
        <header className="h-12 flex-shrink-0 flex items-center justify-between gap-3 px-4 border-b border-kad-border">
          <p className="kad-label text-kad-text-strong truncate">{fileName}</p>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a
              href={downloadUrl}
              className="kad-label inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2"
            >
              <Download className="w-3.5 h-3.5" aria-hidden />
              Tải xuống
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="w-7 h-7 flex items-center justify-center rounded-md text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 min-h-0 bg-kad-surface-2">
          {isImage(mimeType) ? (
            <img src={previewUrl} alt={fileName} className="w-full h-full object-contain" />
          ) : isPdf(mimeType) ? (
            <iframe src={previewUrl} title={fileName} className="w-full h-full border-0" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-6">
              <p className="kad-body text-kad-text-muted">
                Không có bản xem nhanh cho định dạng này.
              </p>
              <a href={downloadUrl} className="kad-label text-kad-accent hover:underline">
                Tải xuống để xem
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
