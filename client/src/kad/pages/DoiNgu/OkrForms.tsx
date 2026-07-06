/**
 * Compact create-forms for the Mục tiêu tab's real OKR CRUD (kadApi.okr).
 * Split out of MucTieuTab.tsx to keep that file focused on display + wiring.
 * Owner options = "human" (Trưởng phòng) + the real agent roster (agentsById).
 */
import { useState } from "react";
import type { AgentProfile, MetricDirection, OkrCycle } from "../../types";
import { KadButton } from "../../components/primitives";

const HUMAN_NAME = "Trưởng phòng";

function OwnerSelect({
  value,
  onChange,
  agents,
}: {
  value: string;
  onChange: (v: string) => void;
  agents: AgentProfile[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 px-2 rounded-lg border border-kad-border bg-kad-surface kad-body text-kad-text"
    >
      <option value="human">{HUMAN_NAME}</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.displayName}
        </option>
      ))}
    </select>
  );
}

const inputCls =
  "h-9 px-2.5 rounded-lg border border-kad-border bg-kad-surface kad-body text-kad-text w-full";

export interface ObjectiveDraft {
  title: string;
  cycle: OkrCycle;
  period: string;
  owner_id: string;
}

/** Inline "Thêm mục tiêu" form — objective shell; key results added after. */
export function ObjectiveForm({
  agents,
  onSubmit,
  onCancel,
}: {
  agents: AgentProfile[];
  onSubmit: (draft: ObjectiveDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [cycle, setCycle] = useState<OkrCycle>("quarter");
  const [period, setPeriod] = useState("");
  const [ownerId, setOwnerId] = useState("human");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || !period.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({ title: title.trim(), cycle, period: period.trim(), owner_id: ownerId });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-kad-surface border border-kad-border rounded-xl p-4 space-y-3">
      <input
        autoFocus
        className={inputCls}
        placeholder="Tên mục tiêu (Objective)…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={cycle}
          onChange={(e) => setCycle(e.target.value as OkrCycle)}
          className="h-9 px-2 rounded-lg border border-kad-border bg-kad-surface kad-body text-kad-text"
        >
          <option value="quarter">Theo quý</option>
          <option value="year">Theo năm</option>
        </select>
        <input
          className={`${inputCls} max-w-[160px]`}
          placeholder={cycle === "year" ? "2026" : "Q3/2026"}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
        <OwnerSelect value={ownerId} onChange={setOwnerId} agents={agents} />
      </div>
      <div className="flex items-center gap-2 justify-end">
        <KadButton variant="ghost" size="row" onClick={onCancel}>
          Huỷ
        </KadButton>
        <KadButton variant="primary" size="row" disabled={saving} onClick={submit}>
          Thêm mục tiêu
        </KadButton>
      </div>
    </div>
  );
}

export interface KrDraft {
  title: string;
  metric: string;
  current_value: number;
  target_value: number;
  unit?: string;
  direction: MetricDirection;
  owner_id: string;
}

/** Inline "Thêm KR" form under an objective. */
export function KrForm({
  agents,
  onSubmit,
  onCancel,
}: {
  agents: AgentProfile[];
  onSubmit: (draft: KrDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [metric, setMetric] = useState("");
  const [current, setCurrent] = useState("0");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [direction, setDirection] = useState<MetricDirection>("up");
  const [ownerId, setOwnerId] = useState("human");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const targetNum = Number(target);
    if (!title.trim() || !Number.isFinite(targetNum) || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        metric: metric.trim() || title.trim(),
        current_value: Number(current) || 0,
        target_value: targetNum,
        unit: unit.trim() || undefined,
        direction,
        owner_id: ownerId,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 border-t border-kad-border pt-3 space-y-2">
      <input
        autoFocus
        className={inputCls}
        placeholder="Tên Key Result…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} max-w-[150px]`}
          placeholder="Chỉ số (metric)"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
        />
        <input
          type="number"
          className={`${inputCls} max-w-[90px]`}
          placeholder="Hiện tại"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          type="number"
          className={`${inputCls} max-w-[90px]`}
          placeholder="Mục tiêu"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <input
          className={`${inputCls} max-w-[70px]`}
          placeholder="đv"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as MetricDirection)}
          className="h-9 px-2 rounded-lg border border-kad-border bg-kad-surface kad-body text-kad-text"
          title="Hướng tốt: cao hơn / thấp hơn"
        >
          <option value="up">Cao hơn tốt</option>
          <option value="down">Thấp hơn tốt</option>
        </select>
        <OwnerSelect value={ownerId} onChange={setOwnerId} agents={agents} />
      </div>
      <div className="flex items-center gap-2 justify-end">
        <KadButton variant="ghost" size="row" onClick={onCancel}>
          Huỷ
        </KadButton>
        <KadButton variant="primary" size="row" disabled={saving} onClick={submit}>
          Thêm KR
        </KadButton>
      </div>
    </div>
  );
}
