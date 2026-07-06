/**
 * Màn "Mục tiêu & chiến lược" (`/muc-tieu-chien-luoc`).
 *
 * Một nơi duy nhất để Trưởng phòng nhập/điều chỉnh:
 *   1. Mục tiêu lớn của phòng (hiện ở thẻ "Mục tiêu lớn" trên Tổng quan).
 *   2. Chiến lược & định hướng (hiện ở mục "Chiến lược & Ưu tiên" — tab Văn hóa).
 *
 * Thay cho khung "ưu tiên quý" cố định: Trưởng phòng nhập trực tiếp, Trợ lý vận
 * hành đọc lại bản này để tự điều chỉnh ưu tiên công việc cho phù hợp. Đây là
 * "Sửa tri thức tổ chức — Anh Khiêm qua UI" (ma trận duyệt), nên ghi thẳng,
 * không qua bước Gửi duyệt.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Target, Trash2 } from "lucide-react";
import { useKadStore } from "../store";
import { useKadToast } from "../components/Toast";
import { XlsxImportButton } from "../components/XlsxImportButton";
import { kadApi } from "../api-client";
import {
  KadButton,
  KadInput,
  KadTextarea,
  KadFieldLabel,
  KadSkeleton,
} from "../components/primitives";
import type { Goal } from "../types";

interface GoalDraft {
  id: string;
  title: string;
  metric: string;
  current: string;
  target: string;
  due: string;
}

let draftSeq = 0;
const newDraft = (): GoalDraft => ({
  id: `goal-new-${(draftSeq += 1)}`,
  title: "",
  metric: "",
  current: "",
  target: "",
  due: "",
});

const draftFromGoal = (g: Goal): GoalDraft => ({
  id: g.id,
  title: g.title,
  metric: g.metric,
  current: String(g.current),
  target: String(g.target),
  due: g.due,
});

function deriveStatus(current: number, target: number): Goal["status"] {
  if (target <= 0) return "on_track";
  const ratio = current / target;
  if (ratio >= 0.9) return "on_track";
  if (ratio >= 0.6) return "at_risk";
  return "off_track";
}

export function MucTieuChienLuoc() {
  const { saveGoalsAndStrategy } = useKadStore();
  const toast = useKadToast();
  const navigate = useNavigate();

  // Own fetch (loading state) rather than reading useKadStore()'s goals/strategy
  // directly: those are populated asynchronously on the store's own mount, and a
  // one-shot useState initializer here would race it and freeze on the empty
  // placeholder. Matches the fetch+loading pattern already used by the other
  // Đội ngũ tabs (JDKyNangTab, VanHoaTab). saveGoalsAndStrategy still goes through
  // the store so Tổng quan / tab Mục tiêu refresh without a full reload.
  const [loading, setLoading] = useState(true);
  const [strategyText, setStrategyText] = useState("");
  const [drafts, setDrafts] = useState<GoalDraft[]>([newDraft()]);

  useEffect(() => {
    kadApi.goals
      .get()
      .then((r) => {
        setStrategyText(r.strategyMarkdown);
        setDrafts(r.goals.length > 0 ? r.goals.map(draftFromGoal) : [newDraft()]);
      })
      .catch(() =>
        toast({ message: "Không tải được mục tiêu & chiến lược hiện có.", tone: "warning" })
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDraft = (id: string, patch: Partial<GoalDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const removeDraft = (id: string) => setDrafts((prev) => prev.filter((d) => d.id !== id));
  const addDraft = () => setDrafts((prev) => [...prev, newDraft()]);

  const handleSave = () => {
    const nextGoals: Goal[] = drafts
      .filter((d) => d.title.trim() !== "")
      .map((d) => {
        const current = Number(d.current) || 0;
        const target = Number(d.target) || 0;
        return {
          id: d.id,
          title: d.title.trim(),
          metric: d.metric.trim() || "Tiến độ",
          current,
          target,
          due: d.due.trim() || "—",
          status: deriveStatus(current, target),
        };
      });

    saveGoalsAndStrategy({ goals: nextGoals, strategyMarkdown: strategyText.trim() })
      .then(() => {
        toast({ message: "Đã cập nhật mục tiêu & chiến lược.", tone: "success" });
        navigate("/");
      })
      .catch((e) =>
        toast({ message: e instanceof Error ? e.message : "Không lưu được.", tone: "warning" })
      );
  };

  const importGoals = (file: File) =>
    kadApi.importXlsx.goals(file).then((r) => {
      setStrategyText(r.strategyMarkdown);
      setDrafts(r.goals.length > 0 ? r.goals.map(draftFromGoal) : [newDraft()]);
    });

  if (loading) {
    return (
      <div className="max-w-[820px] pb-16 space-y-4">
        <KadSkeleton className="h-4 w-2/3" />
        <KadSkeleton className="h-32 w-full" />
        <KadSkeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-[820px] pb-16">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="kad-label text-kad-text-muted hover:text-kad-text inline-flex items-center gap-1.5 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Quay lại
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="kad-title text-kad-text-strong">Mục tiêu &amp; chiến lược</h1>
          <p className="kad-body text-kad-text-muted mt-1.5 max-w-[640px]">
            Nhập mục tiêu lớn và định hướng chiến lược của phòng. Trợ lý vận hành đọc bản này để tự
            điều chỉnh ưu tiên công việc — không còn cố định theo quý.
          </p>
        </div>
        <XlsxImportButton kind="muc-tieu" onImport={importGoals} />
      </div>

      {/* ── Chiến lược & định hướng ─────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="kad-heading text-kad-text-strong mb-1">Chiến lược &amp; định hướng</h2>
        <p className="kad-caption text-kad-text-faint mb-3">
          Hiển thị tại mục “Chiến lược &amp; Ưu tiên” — tab Văn hóa &amp; Nguyên tắc.
        </p>
        <KadTextarea
          value={strategyText}
          onChange={(e) => setStrategyText(e.target.value)}
          placeholder="Định hướng trọng tâm giai đoạn này, nguyên tắc ưu tiên, ràng buộc nguồn lực…"
          className="min-h-[120px]"
        />
      </section>

      {/* ── Mục tiêu lớn ────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="kad-heading text-kad-text-strong">Mục tiêu lớn</h2>
            <p className="kad-caption text-kad-text-faint mt-0.5">
              Hiển thị thành các thẻ tiến độ trên trang Tổng quan.
            </p>
          </div>
          <KadButton variant="ghost" size="row" icon={Plus} onClick={addDraft}>
            Thêm mục tiêu
          </KadButton>
        </div>

        <div className="space-y-3">
          {drafts.length === 0 ? (
            <div className="border border-dashed border-kad-border rounded-xl px-4 py-8 text-center">
              <Target className="w-5 h-5 text-kad-text-faint mx-auto mb-2" aria-hidden />
              <p className="kad-body text-kad-text-muted">
                Chưa có mục tiêu nào. Thêm mục tiêu đầu tiên.
              </p>
            </div>
          ) : (
            drafts.map((d, i) => (
              <div key={d.id} className="border border-kad-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="kad-overline text-kad-text-faint">Mục tiêu {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeDraft(d.id)}
                    aria-label="Xóa mục tiêu"
                    className="text-kad-text-faint hover:text-kad-danger transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <KadFieldLabel>Tên mục tiêu</KadFieldLabel>
                    <KadInput
                      value={d.title}
                      onChange={(e) => updateDraft(d.id, { title: e.target.value })}
                      placeholder="VD: Ra mắt Khóa AI Marketing K3"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <KadFieldLabel>Chỉ số đo</KadFieldLabel>
                      <KadInput
                        value={d.metric}
                        onChange={(e) => updateDraft(d.id, { metric: e.target.value })}
                        placeholder="VD: Học liệu hoàn thành"
                      />
                    </div>
                    <div>
                      <KadFieldLabel>Mốc thời gian</KadFieldLabel>
                      <KadInput
                        value={d.due}
                        onChange={(e) => updateDraft(d.id, { due: e.target.value })}
                        placeholder="VD: 30/09 · liên tục · (để trống)"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <KadFieldLabel>Hiện tại</KadFieldLabel>
                      <KadInput
                        type="number"
                        inputMode="numeric"
                        value={d.current}
                        onChange={(e) => updateDraft(d.id, { current: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <KadFieldLabel>Mục tiêu (đích)</KadFieldLabel>
                      <KadInput
                        type="number"
                        inputMode="numeric"
                        value={d.target}
                        onChange={(e) => updateDraft(d.id, { target: e.target.value })}
                        placeholder="VD: 7"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Hành động ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mt-8 pt-5 border-t border-kad-border">
        <KadButton variant="primary" onClick={handleSave}>
          Lưu mục tiêu &amp; chiến lược
        </KadButton>
        <KadButton variant="ghost" onClick={() => navigate(-1)}>
          Hủy
        </KadButton>
      </div>
    </div>
  );
}
