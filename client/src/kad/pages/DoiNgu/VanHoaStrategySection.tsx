/**
 * Chiến lược & Ưu tiên quý — dedicated 4-field edit (VanHoaTab.tsx).
 * Previously a single free-text section whose entire edited blob (all 4
 * sub-fields concatenated with markdown headers) got saved into just
 * `strategy.priorities` on every edit, silently dropping goals/constraints/
 * roadmap. Each sub-field now has its own textarea and its own slot in the
 * createDraft payload.
 */
import { useState } from "react";
import { kadApi } from "../../api-client";
import type { OrgContextVersionRow } from "../../api-client";
import { useKadToast } from "../../components/Toast";
import { KadButton, KadFieldLabel, KadTextarea } from "../../components/primitives";
import { MarkdownLite } from "../../components/MarkdownLite";
import { fmtDate, strategyText } from "./org-context-helpers";

export function VanHoaStrategySection({
  current,
  pendingChange,
  onDraftCreated,
}: {
  current: OrgContextVersionRow;
  pendingChange: boolean;
  onDraftCreated: () => void;
}) {
  const strategy = current.data.strategy || {
    goals: "",
    priorities: "",
    constraints: "",
    roadmap: "",
  };
  const [editing, setEditing] = useState(false);
  const [goals, setGoals] = useState(strategy.goals);
  const [priorities, setPriorities] = useState(strategy.priorities);
  const [constraints, setConstraints] = useState(strategy.constraints);
  const [roadmap, setRoadmap] = useState(strategy.roadmap);
  const [saving, setSaving] = useState(false);
  const toast = useKadToast();

  const startEdit = () => {
    setGoals(strategy.goals);
    setPriorities(strategy.priorities);
    setConstraints(strategy.constraints);
    setRoadmap(strategy.roadmap);
    setEditing(true);
  };

  const submit = () => {
    setSaving(true);
    kadApi.orgContext
      .createDraft({
        data: { ...current.data, strategy: { goals, priorities, constraints, roadmap } },
        change_summary: "Đề xuất sửa Chiến lược & Ưu tiên quý",
      })
      .then(() => {
        toast({ message: "Đã tạo draft chờ duyệt.", tone: "success" });
        setEditing(false);
        onDraftCreated();
      })
      .catch((e) =>
        toast({
          message: e instanceof Error ? e.message : "Không tạo được draft.",
          tone: "warning",
        })
      )
      .finally(() => setSaving(false));
  };

  return (
    <section id="section-chien-luoc" className="scroll-mt-20">
      <div className="flex items-center justify-between mb-2">
        <h2 className="kad-title text-kad-text-strong">Chiến lược & Ưu tiên quý</h2>
        {!editing && (
          <KadButton variant="ghost" size="row" onClick={startEdit}>
            Đề xuất sửa
          </KadButton>
        )}
      </div>

      {pendingChange && (
        <div className="kad-caption bg-[#fbf3e4] text-[#b97d10] rounded-lg px-3 py-1.5 mb-3">
          Có bản sửa đang chờ duyệt
        </div>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <KadFieldLabel>Goals</KadFieldLabel>
            <KadTextarea
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <div>
            <KadFieldLabel>Priorities</KadFieldLabel>
            <KadTextarea
              value={priorities}
              onChange={(e) => setPriorities(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <div>
            <KadFieldLabel>Constraints</KadFieldLabel>
            <KadTextarea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <div>
            <KadFieldLabel>Roadmap</KadFieldLabel>
            <KadTextarea
              value={roadmap}
              onChange={(e) => setRoadmap(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <KadButton variant="primary" size="row" loading={saving} onClick={submit}>
              Gửi duyệt thay đổi
            </KadButton>
            <KadButton variant="ghost" size="row" onClick={() => setEditing(false)}>
              Hủy
            </KadButton>
          </div>
        </div>
      ) : (
        <MarkdownLite content={strategyText(current.data)} />
      )}

      <p className="kad-caption text-kad-text-faint mt-2">
        v{current.version} · duyệt {fmtDate(current.approved_at)}
      </p>
    </section>
  );
}
