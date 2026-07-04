/**
 * Tab "Mục tiêu" — Đội ngũ (`/doi-ngu`, tab 2). Gom mục tiêu của phòng đặt
 * trong mục tiêu công ty, cấu trúc 3 lớp:
 *   1. Chiến lược & định hướng (năm, tĩnh) — chuyển từ tab Văn hóa; nhập ở
 *      trang /muc-tieu-chien-luoc (một nguồn sự thật duy nhất).
 *   2. OKR (quý) — Công ty (chỉ đọc) và Phòng ban (đóng góp lên công ty qua
 *      parentObjectiveId), mỗi KR có người/agent phụ trách + sức khoẻ.
 *   3. KPI (tuần/tháng) — chỉ số vận hành, cập nhật tự động từ nguồn.
 * Nhịp Tuần bị bỏ khỏi mục tiêu (thuộc Công việc), theo thảo luận đã duyệt.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Pencil, Target } from "lucide-react";
import { OBJECTIVES, KPIS, findAgent, findObjective } from "../../mockData";
import { useKadStore } from "../../store";
import { KadButton, KadCard } from "../../components/primitives";
import { MarkdownLite } from "../../components/MarkdownLite";
import { Sparkline } from "../../components/Sparkline";
import { AgentAvatar, HumanAvatar } from "../../components/Avatar";
import type { GoalHealth, GoalLevel, KeyResult, Kpi, Objective } from "../../types";

const HUMAN_NAME = "Anh Khiêm";

const HEALTH: Record<GoalHealth, { label: string; color: string }> = {
  on_track: { label: "Đúng hướng", color: "var(--kad-success)" },
  at_risk: { label: "Cần chú ý", color: "var(--kad-warning)" },
  off_track: { label: "Chệch mục tiêu", color: "var(--kad-danger)" },
};

const LEVELS: { key: GoalLevel; label: string }[] = [
  { key: "department", label: "Phòng ban" },
  { key: "company", label: "Công ty" },
];

function pctToward(current: number, target: number, direction?: "up" | "down"): number {
  if (target <= 0) return 0;
  const raw = direction === "down" ? target / Math.max(current, 0.0001) : current / target;
  return Math.max(0, Math.min(100, raw * 100));
}

function ownerName(id: string): string {
  return id === "human" ? HUMAN_NAME : findAgent(id)?.displayName ?? id;
}

// ── Atoms ─────────────────────────────────────────────────────────────────

function HealthPill({ health }: { health: GoalHealth }) {
  const h = HEALTH[health];
  return (
    <span
      className="kad-label inline-flex items-center gap-1.5 rounded-full px-2 h-[22px] whitespace-nowrap"
      style={{ backgroundColor: `${h.color}14`, color: h.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: h.color }} />
      {h.label}
    </span>
  );
}

function OwnerChip({ ownerId, showName = false }: { ownerId: string; showName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={ownerName(ownerId)}>
      {ownerId === "human" ? (
        <HumanAvatar name={HUMAN_NAME} size={20} />
      ) : (
        <AgentAvatar agentId={ownerId} size={20} />
      )}
      {showName && <span className="kad-caption text-kad-text-muted truncate">{ownerName(ownerId)}</span>}
    </span>
  );
}

function HealthBar({ percent, health }: { percent: number; health: GoalHealth }) {
  return (
    <div className="h-1.5 flex-1 rounded-full bg-kad-surface-2 overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{ width: `${percent}%`, backgroundColor: HEALTH[health].color }}
      />
    </div>
  );
}

// ── KR row ────────────────────────────────────────────────────────────────

function KrRow({ kr }: { kr: KeyResult }) {
  const unit = kr.unit ?? "";
  const percent = pctToward(kr.current, kr.target, kr.direction);
  return (
    <div className="py-2.5 border-b border-kad-border last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="kad-body text-kad-text truncate">{kr.title}</span>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className="kad-caption text-kad-text-muted tabular-nums">
            {kr.current}
            {unit} / {kr.target}
            {unit}
          </span>
          <OwnerChip ownerId={kr.ownerId} />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <HealthBar percent={percent} health={kr.health} />
        <span className="kad-caption tabular-nums w-9 text-right" style={{ color: HEALTH[kr.health].color }}>
          {Math.round(percent)}%
        </span>
      </div>
    </div>
  );
}

// ── Objective card ──────────────────────────────────────────────────────────

function ObjectiveCard({ objective, readOnly }: { objective: Objective; readOnly?: boolean }) {
  const parent = objective.parentObjectiveId ? findObjective(objective.parentObjectiveId) : null;
  const cycleLabel = objective.cycle === "year" ? `Năm ${objective.period}` : objective.period;

  return (
    <KadCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="kad-overline text-kad-text-faint">{cycleLabel}</span>
            {readOnly && (
              <span className="kad-caption text-kad-text-faint border border-kad-border rounded-full px-2 h-[18px] inline-flex items-center">
                Chỉ đọc
              </span>
            )}
          </div>
          <h3 className="kad-heading text-kad-text-strong">{objective.title}</h3>
          {parent && (
            <p className="kad-caption text-kad-text-muted mt-1 inline-flex items-center gap-1">
              <ArrowUp className="w-3 h-3 flex-shrink-0" aria-hidden />
              Đóng góp cho: {parent.title}
            </p>
          )}
        </div>
        <HealthPill health={objective.confidence} />
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-kad-border">
        <span className="kad-overline text-kad-text-faint">Chủ trì</span>
        <OwnerChip ownerId={objective.ownerId} showName />
      </div>

      <div className="mt-1">
        {objective.keyResults.map((kr) => (
          <KrRow key={kr.id} kr={kr} />
        ))}
      </div>
    </KadCard>
  );
}

// ── KPI card ────────────────────────────────────────────────────────────────

function KpiTile({ kpi }: { kpi: Kpi }) {
  const unit = kpi.unit ?? "";
  const h = HEALTH[kpi.health];
  return (
    <div className="min-h-[136px] bg-kad-surface border border-kad-border rounded-xl p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="kad-caption text-kad-text-muted">{kpi.name}</p>
          <span className="kad-caption text-kad-text-faint border border-kad-border rounded-full px-2 h-[18px] inline-flex items-center flex-shrink-0">
            {kpi.cadence === "monthly" ? "Tháng" : "Tuần"}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="kad-display text-kad-text-strong tabular-nums">
            {kpi.current}
            {unit}
          </span>
          <span className="kad-caption text-kad-text-muted">
            / mục tiêu {kpi.target}
            {unit}
          </span>
          <span className="ml-auto w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: h.color }} title={h.label} />
        </div>
      </div>
      <div className="mt-2">
        <Sparkline values={kpi.trend} variant="line" color={h.color} height={30} />
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-kad-border">
        <OwnerChip ownerId={kpi.ownerId} showName />
        <span className="kad-caption text-kad-text-faint truncate flex-shrink-0">{kpi.source}</span>
      </div>
    </div>
  );
}

// ── Rollup ──────────────────────────────────────────────────────────────────

function Rollup({ objectives }: { objectives: Objective[] }) {
  const krs = objectives.flatMap((o) => o.keyResults);
  const total = krs.length || 1;
  const on = krs.filter((k) => k.health === "on_track").length;
  const at = krs.filter((k) => k.health === "at_risk").length;
  const off = krs.filter((k) => k.health === "off_track").length;
  const pct = Math.round((on / total) * 100);

  const stat = (health: GoalHealth, n: number) => (
    <div className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: HEALTH[health].color }} />
      <span className="kad-body text-kad-text tabular-nums">{n}</span>
      <span className="kad-caption text-kad-text-muted">{HEALTH[health].label}</span>
    </div>
  );

  return (
    <KadCard padding="sm">
      <div className="flex items-center gap-x-8 gap-y-3 flex-wrap">
        <div>
          <p className="kad-overline text-kad-text-faint">Sức khoẻ mục tiêu</p>
          <p className="kad-display text-kad-text-strong">
            {pct}% <span className="kad-caption text-kad-text-muted font-normal">KR đúng hướng</span>
          </p>
        </div>
        <div className="flex items-center gap-5">
          {stat("on_track", on)}
          {stat("at_risk", at)}
          {stat("off_track", off)}
        </div>
      </div>
    </KadCard>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function MucTieuTab() {
  const { strategy } = useKadStore();
  const navigate = useNavigate();
  const [level, setLevel] = useState<GoalLevel>("department");

  const objectives = OBJECTIVES.filter((o) => o.level === level);
  const kpis = KPIS.filter((k) => k.level === level);
  const isCompany = level === "company";

  return (
    <div className="pb-10 space-y-8 max-w-[980px]">
      <p className="kad-caption text-kad-text-faint">
        Mục tiêu phòng gắn với mục tiêu công ty — Chiến lược theo năm, OKR theo quý, KPI vận hành theo
        tháng. Trợ lý vận hành đọc bản này để tự điều chỉnh ưu tiên công việc.
      </p>

      {/* 1. Chiến lược & định hướng (chuyển từ tab Văn hóa) */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="kad-title text-kad-text-strong">Chiến lược &amp; định hướng</h2>
          <KadButton variant="ghost" size="row" icon={Pencil} onClick={() => navigate("/muc-tieu-chien-luoc")}>
            Chỉnh mục tiêu &amp; chiến lược
          </KadButton>
        </div>
        <KadCard>
          {strategy.bodyMarkdown ? (
            <MarkdownLite content={strategy.bodyMarkdown} />
          ) : (
            <p className="kad-body text-kad-text-faint">Chưa nhập định hướng chiến lược.</p>
          )}
          <p className="kad-caption text-kad-text-faint mt-3 border-t border-kad-border pt-2">
            Trưởng phòng nhập trực tiếp qua trang Mục tiêu &amp; chiến lược.
            {strategy.updatedAt ? ` · Cập nhật ${strategy.updatedAt}` : ""}
          </p>
        </KadCard>
      </section>

      {/* Toggle cấp + rollup */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="inline-flex rounded-lg border border-kad-border bg-kad-surface-2 p-0.5 w-fit">
          {LEVELS.map((lv) => (
            <button
              key={lv.key}
              type="button"
              onClick={() => setLevel(lv.key)}
              aria-pressed={level === lv.key}
              className={`h-8 px-4 rounded-md kad-label font-semibold transition-colors duration-150 ${
                level === lv.key
                  ? "bg-kad-surface text-kad-text-strong"
                  : "text-kad-text-muted hover:text-kad-text"
              }`}
              style={level === lv.key ? { boxShadow: "var(--kad-shadow-1)" } : undefined}
            >
              {lv.label}
            </button>
          ))}
        </div>
        {isCompany && (
          <p className="kad-caption text-kad-text-faint">
            Mục tiêu cấp công ty — chỉ đọc tại đây, chỉnh ở trang Chiến lược công ty.
          </p>
        )}
      </div>

      <Rollup objectives={objectives} />

      {/* 2. OKR theo quý */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="kad-title text-kad-text-strong">OKR theo quý</h2>
          <span className="kad-caption text-kad-text-faint">Objective + Key Results · nhịp Quý</span>
        </div>
        {objectives.length === 0 ? (
          <KadCard>
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Target className="w-5 h-5 text-kad-text-faint" aria-hidden />
              <p className="kad-body text-kad-text-muted">Chưa có OKR cho cấp này.</p>
            </div>
          </KadCard>
        ) : (
          <div className="space-y-4">
            {objectives.map((o) => (
              <ObjectiveCard key={o.id} objective={o} readOnly={isCompany} />
            ))}
          </div>
        )}
      </section>

      {/* 3. KPI vận hành */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="kad-title text-kad-text-strong">KPI vận hành</h2>
          <span className="kad-caption text-kad-text-faint">Cập nhật tự động từ nguồn · nhịp Tuần/Tháng</span>
        </div>
        {kpis.length === 0 ? (
          <KadCard>
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Target className="w-5 h-5 text-kad-text-faint" aria-hidden />
              <p className="kad-body text-kad-text-muted">Chưa có KPI cho cấp này.</p>
            </div>
          </KadCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {kpis.map((k) => (
              <KpiTile key={k.id} kpi={k} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
