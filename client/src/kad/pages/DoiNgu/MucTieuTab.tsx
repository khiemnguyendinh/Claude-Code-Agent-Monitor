/**
 * Tab "Mục tiêu" — Đội ngũ (`/doi-ngu`, tab 2). Ba lớp:
 *   1. Chiến lược & định hướng (năm) — nhập ở /muc-tieu-chien-luoc (nguồn thật `goals`).
 *   2. OKR (quý) — objectives + key results THẬT (GET/POST/PUT /api/kad/okr/*),
 *      cấp Phòng ban sửa được, cấp Công ty chỉ đọc; mỗi KR có người phụ trách +
 *      sức khoẻ tính từ current/target.
 *   3. KPI (tuần/tháng) — GET /api/kad/reports/kpis, cập nhật TỰ ĐỘNG từ dữ liệu
 *      thật (năng suất / chất lượng / chi phí), trend 6 kỳ gần nhất.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Pencil, Plus, Target } from "lucide-react";
import { kadApi } from "../../api-client";
import { useKadStore } from "../../store";
import { useKadToast } from "../../components/Toast";
import { KadButton, KadCard } from "../../components/primitives";
import { MarkdownLite } from "../../components/MarkdownLite";
import { Sparkline } from "../../components/Sparkline";
import { AgentAvatar, HumanAvatar } from "../../components/Avatar";
import { ObjectiveForm, KrForm } from "./OkrForms";
import type { ObjectiveDraft, KrDraft } from "./OkrForms";
import type { AgentProfile, GoalHealth, GoalLevel, KeyResult, Kpi, Objective } from "../../types";

const HUMAN_NAME = "Trưởng phòng";

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

function ownerName(id: string, agents: Map<string, AgentProfile>): string {
  return id === "human" ? HUMAN_NAME : (agents.get(id)?.displayName ?? id);
}

// ── Atoms ─────────────────────────────────────────────────────────────────

function HealthPill({ health }: { health: GoalHealth }) {
  const h = HEALTH[health];
  return (
    <span
      className="kad-label inline-flex items-center gap-1.5 rounded-full px-2 h-[22px] whitespace-nowrap"
      style={{ backgroundColor: `${h.color}14`, color: h.color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: h.color }}
      />
      {h.label}
    </span>
  );
}

function OwnerChip({ ownerId, showName = false }: { ownerId: string; showName?: boolean }) {
  const { agentsById } = useKadStore();
  const name = ownerName(ownerId, agentsById);
  const agent = agentsById.get(ownerId);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={name}>
      {ownerId === "human" ? (
        <HumanAvatar name={HUMAN_NAME} size={20} />
      ) : (
        <AgentAvatar
          agentId={ownerId}
          size={20}
          displayNameOverride={agent?.displayName}
          agentNameOverride={agent?.name}
        />
      )}
      {showName && <span className="kad-caption text-kad-text-muted truncate">{name}</span>}
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

function KrRow({ kr, onSaveCurrent }: { kr: KeyResult; onSaveCurrent?: (v: number) => void }) {
  const unit = kr.unit ?? "";
  const percent = pctToward(kr.current, kr.target, kr.direction);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(kr.current));

  const commit = () => {
    setEditing(false);
    const n = Number(val);
    if (Number.isFinite(n) && n !== kr.current) onSaveCurrent?.(n);
    else setVal(String(kr.current));
  };

  return (
    <div className="py-2.5 border-b border-kad-border last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="kad-body text-kad-text truncate">{kr.title}</span>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {editing ? (
            <input
              autoFocus
              type="number"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setVal(String(kr.current));
                  setEditing(false);
                }
              }}
              className="h-7 w-20 px-1.5 rounded border border-kad-border bg-kad-surface kad-caption text-kad-text tabular-nums"
            />
          ) : (
            <button
              type="button"
              disabled={!onSaveCurrent}
              onClick={() => onSaveCurrent && setEditing(true)}
              className={`kad-caption text-kad-text-muted tabular-nums ${onSaveCurrent ? "hover:text-kad-accent hover:underline" : "cursor-default"}`}
              title={onSaveCurrent ? "Bấm để cập nhật số hiện tại" : undefined}
            >
              {kr.current}
              {unit} / {kr.target}
              {unit}
            </button>
          )}
          <OwnerChip ownerId={kr.ownerId} />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <HealthBar percent={percent} health={kr.health} />
        <span
          className="kad-caption tabular-nums w-9 text-right"
          style={{ color: HEALTH[kr.health].color }}
        >
          {Math.round(percent)}%
        </span>
      </div>
    </div>
  );
}

// ── Objective card ──────────────────────────────────────────────────────────

function ObjectiveCard({
  objective,
  parentTitle,
  editable,
  agents,
  onAddKr,
  onSaveKrCurrent,
}: {
  objective: Objective;
  parentTitle: string | null;
  editable: boolean;
  agents: AgentProfile[];
  onAddKr: (draft: KrDraft) => Promise<void>;
  onSaveKrCurrent: (krId: string, current: number) => void;
}) {
  const cycleLabel = objective.cycle === "year" ? `Năm ${objective.period}` : objective.period;
  const [adding, setAdding] = useState(false);

  return (
    <KadCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="kad-overline text-kad-text-faint">{cycleLabel}</span>
            {!editable && (
              <span className="kad-caption text-kad-text-faint border border-kad-border rounded-full px-2 h-[18px] inline-flex items-center">
                Chỉ đọc
              </span>
            )}
          </div>
          <h3 className="kad-heading text-kad-text-strong">{objective.title}</h3>
          {parentTitle && (
            <p className="kad-caption text-kad-text-muted mt-1 inline-flex items-center gap-1">
              <ArrowUp className="w-3 h-3 flex-shrink-0" aria-hidden />
              Đóng góp cho: {parentTitle}
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
          <KrRow
            key={kr.id}
            kr={kr}
            onSaveCurrent={editable ? (v) => onSaveKrCurrent(kr.id, v) : undefined}
          />
        ))}
        {objective.keyResults.length === 0 && !adding && (
          <p className="kad-caption text-kad-text-faint py-2">Chưa có Key Result.</p>
        )}
      </div>

      {editable &&
        (adding ? (
          <KrForm
            agents={agents}
            onSubmit={async (draft) => {
              await onAddKr(draft);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <KadButton
            variant="ghost"
            size="row"
            icon={Plus}
            className="mt-2"
            onClick={() => setAdding(true)}
          >
            Thêm Key Result
          </KadButton>
        ))}
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
          <span
            className="ml-auto w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: h.color }}
            title={h.label}
          />
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
            {pct}%{" "}
            <span className="kad-caption text-kad-text-muted font-normal">KR đúng hướng</span>
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
  const { strategy, agentsById } = useKadStore();
  const navigate = useNavigate();
  const toast = useKadToast();
  const [level, setLevel] = useState<GoalLevel>("department");
  const [objectives, setObjectives] = useState<Objective[] | null>(null);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [error, setError] = useState(false);
  const [showObjForm, setShowObjForm] = useState(false);

  const agents = useMemo(
    () => [...agentsById.values()].filter((a) => a.status === "active"),
    [agentsById]
  );

  const load = useCallback(() => {
    kadApi.okr
      .objectives()
      .then((rows) => {
        setObjectives(rows);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
    kadApi.reports
      .kpis()
      .then(setKpis)
      .catch(() => {});
  }, [load]);

  const loading = objectives === null && !error;
  const isCompany = level === "company";
  const editable = !isCompany;
  const levelObjectives = (objectives ?? []).filter((o) => o.level === level);
  const levelKpis = kpis.filter((k) => k.level === level);
  const parentTitleOf = (id: string | null) =>
    id ? ((objectives ?? []).find((o) => o.id === id)?.title ?? null) : null;

  const createObjective = async (draft: ObjectiveDraft) => {
    try {
      await kadApi.okr.createObjective({
        level,
        cycle: draft.cycle,
        period: draft.period,
        title: draft.title,
        owner_id: draft.owner_id,
      });
      setShowObjForm(false);
      load();
      toast({ message: "Đã tạo mục tiêu.", tone: "success" });
    } catch (e) {
      toast({
        message: e instanceof Error ? e.message : "Không tạo được mục tiêu.",
        tone: "warning",
      });
    }
  };

  const addKr = async (objectiveId: string, draft: KrDraft) => {
    try {
      await kadApi.okr.createKeyResult(objectiveId, draft);
      load();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Không thêm được KR.", tone: "warning" });
    }
  };

  const saveKrCurrent = (krId: string, current: number) => {
    kadApi.okr
      .updateKeyResult(krId, { current_value: current })
      .then(load)
      .catch((e) =>
        toast({
          message: e instanceof Error ? e.message : "Không cập nhật được KR.",
          tone: "warning",
        })
      );
  };

  return (
    <div className="pb-10 space-y-8 max-w-[980px]">
      <p className="kad-caption text-kad-text-faint">
        Mục tiêu phòng gắn với mục tiêu công ty — Chiến lược theo năm, OKR theo quý, KPI vận hành
        theo tháng. Trợ lý vận hành đọc bản này để tự điều chỉnh ưu tiên công việc.
      </p>

      {/* 1. Chiến lược & định hướng */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="kad-title text-kad-text-strong">Chiến lược &amp; định hướng</h2>
          <KadButton
            variant="ghost"
            size="row"
            icon={Pencil}
            onClick={() => navigate("/muc-tieu-chien-luoc")}
          >
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

      {/* Toggle cấp */}
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
          <p className="kad-caption text-kad-text-faint">Mục tiêu cấp công ty — chỉ đọc tại đây.</p>
        )}
      </div>

      <Rollup objectives={levelObjectives} />

      {/* 2. OKR theo quý */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="kad-title text-kad-text-strong">OKR theo quý</h2>
          {editable && !showObjForm && (
            <KadButton
              variant="secondary"
              size="row"
              icon={Plus}
              onClick={() => setShowObjForm(true)}
            >
              Thêm mục tiêu
            </KadButton>
          )}
        </div>

        {showObjForm && editable && (
          <div className="mb-4">
            <ObjectiveForm
              agents={agents}
              onSubmit={createObjective}
              onCancel={() => setShowObjForm(false)}
            />
          </div>
        )}

        {loading ? (
          <KadCard>
            <p className="kad-body text-kad-text-faint text-center py-8">Đang tải…</p>
          </KadCard>
        ) : error ? (
          <KadCard>
            <p className="kad-body text-kad-text-faint text-center py-8">Không tải được OKR.</p>
          </KadCard>
        ) : levelObjectives.length === 0 ? (
          <KadCard>
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Target className="w-5 h-5 text-kad-text-faint" aria-hidden />
              <p className="kad-body text-kad-text-muted">Chưa có OKR cho cấp này.</p>
            </div>
          </KadCard>
        ) : (
          <div className="space-y-4">
            {levelObjectives.map((o) => (
              <ObjectiveCard
                key={o.id}
                objective={o}
                parentTitle={parentTitleOf(o.parentObjectiveId)}
                editable={editable}
                agents={agents}
                onAddKr={(draft) => addKr(o.id, draft)}
                onSaveKrCurrent={saveKrCurrent}
              />
            ))}
          </div>
        )}
      </section>

      {/* 3. KPI vận hành */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="kad-title text-kad-text-strong">KPI vận hành</h2>
          <span className="kad-caption text-kad-text-faint">
            Cập nhật tự động từ nguồn · nhịp Tháng
          </span>
        </div>
        {levelKpis.length === 0 ? (
          <KadCard>
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Target className="w-5 h-5 text-kad-text-faint" aria-hidden />
              <p className="kad-body text-kad-text-muted">Chưa có KPI cho cấp này.</p>
            </div>
          </KadCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {levelKpis.map((k) => (
              <KpiTile key={k.id} kpi={k} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
