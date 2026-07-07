/**
 * FilePreviewModal — shared "quick view" overlay for stored templates & học
 * liệu files. PDF/images render via the browser's native viewer; docx/xlsx
 * are rendered client-side (docx-preview / SheetJS `xlsx`, lazy-loaded so the
 * main bundle doesn't pay for them until a preview is actually opened) since
 * this is a local-first app with no server-side conversion step. Anything
 * else falls back to a download prompt.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, X } from "lucide-react";

interface FilePreviewModalProps {
  fileName: string;
  mimeType?: string | null;
  previewUrl: string;
  downloadUrl: string;
  onClose: () => void;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const isPdf = (mimeType?: string | null) => mimeType === "application/pdf";
const isImage = (mimeType?: string | null) => Boolean(mimeType?.startsWith("image/"));
const isDocx = (mimeType?: string | null) => mimeType === DOCX_MIME;
const isXlsx = (mimeType?: string | null) => mimeType === XLSX_MIME;

function PreviewFallback({ downloadUrl }: { downloadUrl: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-6">
      <p className="kad-body text-kad-text-muted">Không có bản xem nhanh cho định dạng này.</p>
      <a href={downloadUrl} className="kad-label text-kad-accent hover:underline">
        Tải xuống để xem
      </a>
    </div>
  );
}

function PreviewLoading() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-kad-text-faint" aria-hidden />
    </div>
  );
}

type BodyStatus = "loading" | "ready" | "error";

function DocxPreviewBody({ previewUrl, downloadUrl }: { previewUrl: string; downloadUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<BodyStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const [{ renderAsync }, res] = await Promise.all([
          import("docx-preview"),
          fetch(previewUrl),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        await renderAsync(blob, containerRef.current, undefined, { className: "kad-docx-page" });
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  if (status === "error") return <PreviewFallback downloadUrl={downloadUrl} />;
  return (
    <div className="w-full h-full overflow-auto bg-[#e9e9ec]">
      {status === "loading" && <PreviewLoading />}
      <div ref={containerRef} className={status === "loading" ? "hidden" : "p-4"} />
    </div>
  );
}

function XlsxPreviewBody({ previewUrl, downloadUrl }: { previewUrl: string; downloadUrl: string }) {
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [status, setStatus] = useState<BodyStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setRows(null);
    (async () => {
      try {
        const [XLSX, res] = await Promise.all([import("xlsx"), fetch(previewUrl)]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const workbook = XLSX.read(buf, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("no sheets in workbook");
        const firstSheet = workbook.Sheets[firstSheetName];
        if (!firstSheet) throw new Error("empty sheet");
        // header:1 -> array-of-arrays, rendered through JSX text nodes below
        // (not dangerouslySetInnerHTML) so cell content is always escaped by React.
        const data = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
          header: 1,
          blankrows: false,
        });
        if (cancelled) return;
        setRows(data);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  if (status === "loading") return <PreviewLoading />;
  if (status === "error" || !rows || rows.length === 0) {
    return <PreviewFallback downloadUrl={downloadUrl} />;
  }
  return (
    <div className="w-full h-full overflow-auto bg-white p-4">
      <table className="kad-caption border-collapse">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="border border-kad-border px-2 py-1 whitespace-nowrap">
                  {cell == null ? "" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
          ) : isDocx(mimeType) ? (
            <DocxPreviewBody previewUrl={previewUrl} downloadUrl={downloadUrl} />
          ) : isXlsx(mimeType) ? (
            <XlsxPreviewBody previewUrl={previewUrl} downloadUrl={downloadUrl} />
          ) : (
            <PreviewFallback downloadUrl={downloadUrl} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
