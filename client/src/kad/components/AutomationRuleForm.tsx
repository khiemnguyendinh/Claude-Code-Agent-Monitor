/**
 * client/src/kad/components/AutomationRuleForm.tsx — "+ Tạo luật" form gọn
 * (spec/ui/09 §3: "form gọn (không wizard) — Tên · Khi nào (Lịch/Sự kiện/
 * Ngưỡng + cấu hình) · Làm gì (Tạo việc từ brief/template, Cảnh báo) ·
 * [Bắt buộc duyệt trước khi chạy] mặc định bật").
 *
 * Event/metric catalogs are deliberately tiny and curated (not an open-ended
 * builder): Phase 6.5 owns the real event/metric catalog and evaluator; this
 * form only lets a human create the *row* the mockup's own two seeded
 * examples describe ("Môn xong → tạo môn kế", "Chất lượng đạt lần đầu <80%").
 * Inventing a bigger catalog now would be presenting choices nothing behind
 * this form can act on yet.
 */
import { useEffect, useState } from "react";
import { KadButton, KadCard, KadFieldLabel, KadInput, KadTextarea } from "./primitives";
import { kadApi } from "../api-client";
import { SCHEDULE_FREQS, WEEKDAYS, scheduleLabel } from "../schedule-helpers";
import type { AutomationRule, AutomationTriggerType, ScheduleFrequency } from "../types";

const DIR_OPTIONS = ["kstudy-rd/K3", "kstudy-rd/content"];
const TRIGGER_TABS: { id: AutomationTriggerType; label: string }[] = [
  { id: "schedule", label: "Lịch" },
  { id: "event", label: "Sự kiện" },
  { id: "metric_threshold", label: "Ngưỡng" },
];
const THRESHOLD_OPS: [string, string][] = [
  ["lt", "nhỏ hơn"],
  ["gt", "lớn hơn"],
];
type ActionKind = "create_task" | "notify";

function Sel({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | [string, string])[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="kad-caption h-9 rounded-lg bg-kad-surface-2 border border-transparent px-2.5 text-kad-text focus:outline-none focus:border-kad-border-strong cursor-pointer"
    >
      {options.map((o) => {
        const val = Array.isArray(o) ? o[0] : o;
        const label = Array.isArray(o) ? o[1] : o;
        return (
          <option key={val} value={val}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

export function AutomationRuleForm({
  onCreated,
  onCancel,
}: {
  onCreated: (rule: AutomationRule) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTriggerType>("schedule");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lịch
  const [freq, setFreq] = useState<ScheduleFrequency>("weekly");
  const [time, setTime] = useState("07:00");
  const [weekday, setWeekday] = useState(WEEKDAYS[0]!);
  const [day, setDay] = useState("1");

  // Sự kiện — nguồn là 1 việc thật đang có trong hệ thống.
  const [sourceTasks, setSourceTasks] = useState<{ id: string; title: string }[]>([]);
  const [sourceTaskId, setSourceTaskId] = useState("");

  // Ngưỡng
  const [thresholdOp, setThresholdOp] = useState("lt");
  const [thresholdValue, setThresholdValue] = useState("80");

  // Làm gì
  const [actionKind, setActionKind] = useState<ActionKind>("create_task");
  const [brief, setBrief] = useState("");
  const [workingDir, setWorkingDir] = useState(DIR_OPTIONS[0]!);
  const [approvalRequired, setApprovalRequired] = useState(true);

  useEffect(() => {
    kadApi.tasks
      .list({ limit: 100 })
      .then((rows) => setSourceTasks(rows.map((t) => ({ id: t.id, title: t.title }))))
      .catch(() => setSourceTasks([]));
  }, []);

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Đặt tên cho luật.");
      return;
    }
    if (actionKind === "create_task" && !brief.trim()) {
      setError("Mô tả việc sẽ tạo khi luật kích.");
      return;
    }
    // sourceTaskId only changes once the user touches the <select>; the
    // first option is shown (and implicitly selected) before that (same
    // fallback used in the <Sel> below), so validate/read that fallback too
    // or a same-as-shown submit would wrongly report "chưa chọn nguồn".
    const effectiveSourceTaskId = sourceTaskId || sourceTasks[0]?.id;
    if (trigger === "event" && !effectiveSourceTaskId) {
      setError("Chọn việc/khoá nguồn cho sự kiện.");
      return;
    }

    const triggerConfig =
      trigger === "schedule"
        ? { freq, time, weekday, day, label: scheduleLabel(freq, time, weekday, day) }
        : trigger === "event"
          ? {
              event: "task.done",
              source_task_id: effectiveSourceTaskId,
              label: `Khi "${sourceTasks.find((t) => t.id === effectiveSourceTaskId)?.title ?? "—"}" hoàn thành`,
            }
          : {
              metric: "quality_pass_rate_7d",
              op: thresholdOp,
              value: Number(thresholdValue),
              label: `Khi tỷ lệ đạt lần đầu ${thresholdOp === "lt" ? "<" : ">"} ${thresholdValue}%`,
            };

    const actionConfig =
      actionKind === "create_task"
        ? { brief: brief.trim(), working_dir: workingDir }
        : { message: trimmedName };

    setSubmitting(true);
    setError(null);
    try {
      const rule = await kadApi.automationRules.create({
        name: trimmedName,
        trigger_type: trigger,
        trigger_config: triggerConfig,
        action_type: actionKind,
        action_config: actionConfig,
        approval_required: actionKind === "create_task" ? approvalRequired : false,
      });
      onCreated(rule);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra, thử lại.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KadCard className="space-y-3.5">
      <div>
        <KadFieldLabel>Tên luật</KadFieldLabel>
        <KadInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vd: Môn xong → tạo môn kế"
        />
      </div>

      <div>
        <KadFieldLabel>Khi nào</KadFieldLabel>
        <div className="inline-flex rounded-lg bg-kad-surface-2 p-0.5 mb-2.5">
          {TRIGGER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTrigger(t.id)}
              className={`kad-label h-7 px-3 rounded-md transition-colors ${
                trigger === t.id
                  ? "bg-kad-surface text-kad-text-strong"
                  : "text-kad-text-muted hover:text-kad-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {trigger === "schedule" && (
          <div className="flex items-center gap-2 flex-wrap">
            <Sel
              value={freq}
              onChange={(v) => setFreq(v as ScheduleFrequency)}
              options={SCHEDULE_FREQS.map((f) => [f.id, f.label] as [string, string])}
            />
            {freq === "weekly" && <Sel value={weekday} onChange={setWeekday} options={WEEKDAYS} />}
            {(freq === "monthly" || freq === "once") && (
              <label className="kad-caption text-kad-text-muted flex items-center gap-1.5">
                ngày
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  className="kad-caption h-9 w-14 rounded-lg bg-kad-surface-2 border border-transparent px-2 text-kad-text focus:outline-none focus:border-kad-border-strong"
                />
              </label>
            )}
            <span className="kad-caption text-kad-text-muted">lúc</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="kad-caption h-9 rounded-lg bg-kad-surface-2 border border-transparent px-2 text-kad-text focus:outline-none focus:border-kad-border-strong"
            />
          </div>
        )}

        {trigger === "event" && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="kad-caption text-kad-text-muted">Khi</span>
            {sourceTasks.length > 0 ? (
              <Sel
                value={sourceTaskId || sourceTasks[0]!.id}
                onChange={setSourceTaskId}
                options={sourceTasks.map((t) => [t.id, t.title] as [string, string])}
              />
            ) : (
              <span className="kad-caption text-kad-text-faint">Chưa có việc nào để chọn</span>
            )}
            <span className="kad-caption text-kad-text-muted">hoàn thành</span>
          </div>
        )}

        {trigger === "metric_threshold" && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="kad-caption text-kad-text-muted">Khi tỷ lệ đạt lần đầu (7 ngày)</span>
            <Sel value={thresholdOp} onChange={setThresholdOp} options={THRESHOLD_OPS} />
            <input
              type="number"
              min={0}
              max={100}
              value={thresholdValue}
              onChange={(e) => setThresholdValue(e.target.value)}
              className="kad-caption h-9 w-16 rounded-lg bg-kad-surface-2 border border-transparent px-2 text-kad-text focus:outline-none focus:border-kad-border-strong"
            />
            <span className="kad-caption text-kad-text-muted">%</span>
          </div>
        )}
      </div>

      <div>
        <KadFieldLabel>Làm gì</KadFieldLabel>
        <div className="inline-flex rounded-lg bg-kad-surface-2 p-0.5 mb-2.5">
          {(["create_task", "notify"] as ActionKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setActionKind(k)}
              className={`kad-label h-7 px-3 rounded-md transition-colors ${
                actionKind === k
                  ? "bg-kad-surface text-kad-text-strong"
                  : "text-kad-text-muted hover:text-kad-text"
              }`}
            >
              {k === "create_task" ? "Tạo việc" : "Cảnh báo"}
            </button>
          ))}
        </div>

        {actionKind === "create_task" ? (
          <div className="space-y-2">
            <KadTextarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Mô tả việc sẽ tạo khi luật kích…"
              rows={2}
            />
            <label className="kad-caption text-kad-text-muted flex items-center gap-1.5">
              <span aria-hidden>📁</span>
              <Sel value={workingDir} onChange={setWorkingDir} options={DIR_OPTIONS} />
            </label>
            <label className="kad-caption text-kad-text-muted flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={approvalRequired}
                onChange={(e) => setApprovalRequired(e.target.checked)}
              />
              Bắt buộc duyệt trước khi chạy
            </label>
          </div>
        ) : (
          <p className="kad-caption text-kad-text-faint">
            Sẽ gửi thông báo cho trưởng phòng khi luật kích — không tạo việc, không tiêu token.
          </p>
        )}
      </div>

      {error && <p className="kad-caption text-kad-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <KadButton variant="ghost" onClick={onCancel} disabled={submitting}>
          Huỷ
        </KadButton>
        <KadButton variant="primary" onClick={handleSubmit} disabled={submitting}>
          Tạo luật
        </KadButton>
      </div>
    </KadCard>
  );
}
