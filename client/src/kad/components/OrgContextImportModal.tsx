import { useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { KadButton, KadCard } from "./primitives";
import { kadApi } from "../api-client";
import { useKadToast } from "./Toast";
import type { OrgContextData } from "../api-client";

interface OrgContextImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function OrgContextImportModal({ isOpen, onClose, onSuccess }: OrgContextImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<OrgContextData | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useKadToast();

  if (!isOpen) return null;

  const downloadTemplate = () => {
    const template: OrgContextData = {
      company_name: "Tên tổ chức",
      mission: "Sứ mệnh...",
      vision: "Tầm nhìn...",
      core_values: ["Giá trị 1", "Giá trị 2"],
      brand: {
        voice: "Nguyên tắc làm việc...",
        guideline: "Kỷ luật công việc...",
      },
      strategy: {
        goals: "Mục tiêu lớn...",
        priorities: "Ưu tiên hiện tại...",
        constraints: "Ràng buộc...",
        roadmap: "Lộ trình...",
      },
    };
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "org_context_template.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // Minimal validation
        if (typeof json === "object" && json !== null) {
          setPreviewData(json as OrgContextData);
        } else {
          toast({ message: "File JSON không hợp lệ.", tone: "warning" });
        }
      } catch (err) {
        toast({ message: "Lỗi đọc file JSON.", tone: "error" });
      }
    };
    reader.readAsText(selectedFile);
  };

  const handleImport = async () => {
    if (!previewData) return;
    setLoading(true);
    try {
      await kadApi.orgContext.createDraft({
        data: previewData,
        change_summary: "Imported from JSON file",
      });
      toast({ message: "Import thành công. Đã tạo bản nháp.", tone: "success" });
      onSuccess?.();
      onClose();
    } catch (e) {
      toast({ message: "Lỗi import.", tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <KadCard className="w-full max-w-xl bg-kad-surface border-kad-border shadow-lg relative p-6">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-kad-text-faint hover:text-kad-text"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="kad-heading text-kad-text-strong mb-4">Import Dữ liệu</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="kad-body text-kad-text">Tải file mẫu để điền thông tin:</span>
            <KadButton size="row" variant="secondary" onClick={downloadTemplate}>
              <Download className="w-4 h-4 mr-2" />
              Tải mẫu template
            </KadButton>
          </div>

          <div className="border-2 border-dashed border-kad-border rounded-lg p-6 flex flex-col items-center justify-center bg-kad-surface-2 relative">
            <input
              type="file"
              accept=".json"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleFileChange}
            />
            <Upload className="w-8 h-8 text-kad-text-faint mb-2" />
            <p className="kad-body font-medium text-kad-text-strong">
              {file ? file.name : "Kéo thả hoặc click để tải lên file JSON"}
            </p>
          </div>

          {previewData && (
            <div className="bg-kad-surface-2 rounded-lg p-4 max-h-48 overflow-y-auto">
              <pre className="text-xs text-kad-text font-mono">
                {JSON.stringify(previewData, null, 2)}
              </pre>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <KadButton size="row" variant="secondary" onClick={onClose}>
              Hủy
            </KadButton>
            <KadButton
              size="row"
              variant="primary"
              onClick={handleImport}
              disabled={!previewData || loading}
            >
              {loading ? "Đang xử lý..." : "Import"}
            </KadButton>
          </div>
        </div>
      </KadCard>
    </div>
  );
}
