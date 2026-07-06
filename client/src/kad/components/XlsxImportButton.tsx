/**
 * Shared "Tải mẫu" + "Nhập từ file" control for the 3 single-file .xlsx
 * import surfaces (Mục tiêu chiến lược, Văn hóa & Nguyên tắc, JD & Kỹ năng).
 * Parametrized by `kind` (template lookup) and `onImport` (caller owns what
 * happens with the parsed result — different repo call per surface).
 */
import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { kadApi } from "../api-client";
import { useKadToast } from "./Toast";

export function XlsxImportButton({
  kind,
  onImport,
}: {
  kind: "muc-tieu" | "van-hoa" | "jd-ky-nang";
  onImport: (file: File) => Promise<unknown>;
}) {
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useKadToast();

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    onImport(file)
      .then(() => toast({ message: "Đã nhập từ file.", tone: "success" }))
      .catch((e) =>
        toast({
          message: e instanceof Error ? e.message : "Không nhập được file.",
          tone: "warning",
        })
      )
      .finally(() => {
        setImporting(false);
        if (inputRef.current) inputRef.current.value = "";
      });
  };

  return (
    <div className="flex items-center gap-3">
      <a
        href={kadApi.importXlsx.templateUrl(kind)}
        className="kad-caption text-kad-accent hover:underline"
      >
        Tải mẫu
      </a>
      <label className="inline-flex">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          disabled={importing}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <span
          className={`kad-label inline-flex h-8 items-center gap-1.5 rounded-lg border border-kad-border-strong px-3 text-kad-text ${
            importing ? "opacity-50 pointer-events-none" : "cursor-pointer"
          }`}
        >
          {importing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          ) : (
            <Upload className="w-3.5 h-3.5" aria-hidden />
          )}
          Nhập từ file
        </span>
      </label>
    </div>
  );
}
