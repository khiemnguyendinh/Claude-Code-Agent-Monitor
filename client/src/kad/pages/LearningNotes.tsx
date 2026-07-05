import { useEffect, useState } from "react";
import { CheckCircle, ArrowRight, Activity, XCircle, AlertTriangle } from "lucide-react";
import { KadCard, KadCardHeader, KadEmptyState } from "../components/primitives";
import { formatRelativeTime } from "../format";
import { useKadToast } from "../components/Toast";
import { api } from "../api-client";

interface Note {
  id: string;
  correction_category: string;
  severity: "minor" | "major" | "critical";
  root_cause: string;
  prevention: string;
  affected_areas: string[];
  proposed_change_target: string;
  change_status: "noted" | "proposed" | "approved" | "applied";
  created_at: string;
}

export function LearningNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const { addToast } = useKadToast();

  const loadNotes = () => {
    api
      .get("/api/kad/learning-notes?department=rd")
      .then((res) => {
        setNotes(res);
        setLoading(false);
      })
      .catch((err) => {
        addToast({ message: "Lỗi tải learning notes", type: "error" });
        setLoading(false);
      });
  };

  useEffect(() => {
    loadNotes();
  }, []);

  const handlePropose = (id: string) => {
    api
      .post(`/api/kad/learning-notes/${id}/propose`, {})
      .then(() => {
        addToast({ message: "Đã đề xuất áp dụng cải tiến", type: "success" });
        loadNotes();
      })
      .catch((err) => addToast({ message: err.message, type: "error" }));
  };

  const handleApprove = (id: string) => {
    api
      .post(`/api/kad/learning-notes/${id}/approve`, {})
      .then(() => {
        addToast({ message: "Đã duyệt và áp dụng cải tiến", type: "success" });
        loadNotes();
      })
      .catch((err) => addToast({ message: err.message, type: "error" }));
  };

  if (loading) return <div className="p-6">Đang tải...</div>;

  return (
    <div className="pb-10 max-w-[1000px]">
      <h1 className="kad-title text-kad-text-strong mb-1">Learning Notes (Bài học kinh nghiệm)</h1>
      <p className="kad-caption text-kad-text-faint mb-5">
        Hệ thống tự động ghi nhận các lỗi sai, phân tích nguyên nhân và đề xuất cải tiến workflow/prompt để tránh lặp lại lỗi.
      </p>

      {notes.length === 0 ? (
        <KadEmptyState icon={Activity} message="Chưa có ghi nhận lỗi nào." />
      ) : (
        <div className="space-y-4">
          {notes.map((n) => (
            <KadCard key={n.id} className="p-4 border-l-4" style={{
              borderLeftColor: n.severity === "critical" ? "var(--kad-danger)" : n.severity === "major" ? "var(--kad-warning)" : "var(--kad-border-strong)"
            }}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="kad-heading text-kad-text-strong">
                    [{n.correction_category}] {n.root_cause}
                  </h3>
                  <p className="kad-caption text-kad-text-faint mt-1">
                    Ghi nhận {formatRelativeTime(n.created_at)} · Mức độ: <span className="uppercase">{n.severity}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="kad-label text-kad-text-muted bg-kad-surface-2 px-2 py-1 rounded">
                    Trạng thái: {n.change_status}
                  </span>
                  {n.change_status === "noted" && (
                    <button
                      onClick={() => handlePropose(n.id)}
                      className="kad-label bg-kad-accent text-white px-3 py-1.5 rounded hover:opacity-90"
                    >
                      Đề xuất sửa
                    </button>
                  )}
                  {n.change_status === "proposed" && (
                    <button
                      onClick={() => handleApprove(n.id)}
                      className="kad-label bg-kad-success text-white px-3 py-1.5 rounded hover:opacity-90"
                    >
                      Duyệt áp dụng
                    </button>
                  )}
                </div>
              </div>
              <div className="bg-kad-surface-2 p-3 rounded-lg mt-3 kad-body text-kad-text">
                <div className="flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-kad-warning shrink-0 mt-0.5" />
                  <span><strong>Khắc phục:</strong> {n.prevention}</span>
                </div>
                <div className="flex gap-2 mt-2">
                  <ArrowRight className="w-4 h-4 text-kad-text-muted shrink-0 mt-0.5" />
                  <span><strong>Khu vực ảnh hưởng:</strong> {n.affected_areas.join(", ")} | <strong>Mục tiêu sửa đổi:</strong> {n.proposed_change_target}</span>
                </div>
              </div>
            </KadCard>
          ))}
        </div>
      )}
    </div>
  );
}
