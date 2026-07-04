/**
 * Màn Giao việc mới (`/cong-viec/moi`) — spec/ui/07-giao-viec-intake-report-
 * card.md §1 (mở rộng 03 §2, KHÔNG modal). Trang chat trắng có hero hướng dẫn
 * cơ chế; composer nằm giữa trang.
 *
 * spec/ui/09 (chốt 2026-07-04): tích hợp control "Khi nào bắt đầu?" ngay trong
 * composer — Ngay / Khi điều kiện (task_dependencies) / Theo lịch
 * (automation_rules schedule). auto-task vẫn cần người duyệt trước khi tiêu
 * token; ở mockup, điều kiện/lịch điều hướng sang trang Tự động hoá.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEMO_ATTACHMENT_NAMES, DEPENDENCY_SOURCES, WORKFLOW_QUICKSTARTS } from "../mockData";
import { useKadStore } from "../store";
import { useKadToast } from "../components/Toast";
import { TaskComposer, type TaskComposerHandle } from "../components/TaskComposer";
import type { AutomationRule, ScheduleFrequency, WorkflowDefinition } from "../types";

const HERO_STEPS = ["Mô tả việc", "Trợ lý làm rõ", "Chốt brief", "Thực thi & báo cáo"];
const DIR_OPTIONS = ["kstudy-rd/K3", "kstudy-rd/content", "Chọn thư mục khác…"];
const FREEFORM_ID = "wf-freeform";

type Activation = "now" | "dependency" | "schedule";
const ACTIVATIONS: { id: Activation; label: string }[] = [
  { id: "now", label: "Ngay" },
  { id: "dependency", label: "Khi điều kiện" },
  { id: "schedule", label: "Theo lịch" },
];
const DEP_CONDITIONS: [string, string][] = [
  ["approved", "được duyệt"],
  ["done", "hoàn thành"],
];
const FREQS: { id: ScheduleFrequency; label: string }[] = [
  { id: "once", label: "Một lần" },
  { id: "daily", label: "Hằng ngày" },
  { id: "weekly", label: "Hằng tuần" },
  { id: "monthly", label: "Hằng tháng" },
];
const WEEKDAYS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

function scheduleLabel(freq: ScheduleFrequency, time: string, weekday: string, day: string): string {
  switch (freq) {
    case "once":
      return `Một lần vào ngày ${day || "1"} lúc ${time}`;
    case "daily":
      return `Hằng ngày lúc ${time}`;
    case "weekly":
      return `Hằng tuần, ${weekday} lúc ${time}`;
    case "monthly":
      return `Hằng tháng, ngày ${day || "1"} lúc ${time}`;
  }
}

export function CongViecMoi() {
  const { addTask, addRule, automationRules } = useKadStore();
  const showToast = useKadToast();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [selectedWfId, setSelectedWfId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [workingDir, setWorkingDir] = useState(DIR_OPTIONS[0]!);
  const [attachCycle, setAttachCycle] = useState(0);
  const composerRef = useRef<TaskComposerHandle>(null);

  // [spec 07 §1] gợi ý tối đa 3 chip khi gõ ≥15 ký tự và chưa chọn workflow.
  const suggestions = useMemo(() => {
    if (selectedWfId) return [];
    const q = value.trim();
    if (q.length < 15) return [];
    const lower = q.toLowerCase();
    return WORKFLOW_QUICKSTARTS.filter((wf) => wf.triggerKeywords?.some((k) => lower.includes(k))).slice(0, 3);
  }, [value, selectedWfId]);

  // spec/ui/09 — Khi nào bắt đầu?
  const [activation, setActivation] = useState<Activation>("now");
  const [depSource, setDepSource] = useState(DEPENDENCY_SOURCES[0]!);
  const [depCondition, setDepCondition] = useState("approved");
  const [schedFreq, setSchedFreq] = useState<ScheduleFrequency>("weekly");
  const [schedTime, setSchedTime] = useState("07:00");
  const [schedWeekday, setSchedWeekday] = useState(WEEKDAYS[0]!);
  const [schedDay, setSchedDay] = useState("1");

  const activeRuleCount = automationRules.filter((r) => r.enabled).length;

  const handlePickCard = (wf: WorkflowDefinition) => {
    setSelectedWfId(wf.id);
    setValue(wf.examplePrompt ?? "");
    composerRef.current?.focus();
  };

  const handleAttach = () => {
    const name = DEMO_ATTACHMENT_NAMES[attachCycle % DEMO_ATTACHMENT_NAMES.length]!;
    setAttachCycle((n) => n + 1);
    setAttachments((prev) => (prev.includes(name) ? prev : [...prev, name]));
  };

  const handleRemoveAttachment = (name: string) => {
    setAttachments((prev) => prev.filter((n) => n !== name));
  };

  const handleSubmit = () => {
    const text = value.trim();
    if (!text) return;
    const resolvedDir = workingDir.startsWith("Chọn") ? DIR_OPTIONS[0]! : workingDir;

    // spec/ui/09 §1 — Khi điều kiện: task tạo ở 'blocked' + điều kiện, không vào chat intake.
    if (activation === "dependency") {
      const condLabel = depCondition === "approved" ? "được duyệt" : "hoàn thành";
      const startCondition = `Khi "${depSource}" ${condLabel}`;
      addTask({ title: text, workingDir: resolvedDir, attachmentNames: attachments, startCondition });
      showToast({
        message: `Đã đặt điều kiện. Việc sẽ vào Hàng đợi khi "${depSource}" ${condLabel}, rồi chờ anh xác nhận.`,
        tone: "success",
      });
      navigate("/cong-viec/tu-dong-hoa");
      return;
    }

    // spec/ui/09 §1 — Theo lịch: tạo automation_rule (schedule), không tạo task ngay.
    if (activation === "schedule") {
      const label = scheduleLabel(schedFreq, schedTime, schedWeekday, schedDay);
      const shortTitle = text.length > 42 ? `${text.slice(0, 42)}…` : text;
      const rule: AutomationRule = {
        id: `rule-new-${Date.now()}`,
        name: shortTitle,
        trigger: { type: "schedule", label },
        actionType: "create_task",
        actionLabel: `Tạo việc: ${shortTitle}`,
        approvalRequired: true,
        enabled: true,
        lastFiredAtLabel: null,
        fireCount: 0,
        dryRun30d: `Theo lịch: ${label}`,
        fires: [],
      };
      addRule(rule);
      showToast({
        message: `Đã đặt lịch — ${label}. Việc tạo ra sẽ chờ anh xác nhận trước khi chạy.`,
        tone: "success",
      });
      navigate("/cong-viec/tu-dong-hoa");
      return;
    }

    // Ngay — hành vi hiện tại (spec 07): tạo task, vào chat intake → brief.
    const id = addTask({ title: text, workingDir: resolvedDir, attachmentNames: attachments });
    navigate(`/cong-viec/${id}`, {
      state: { fresh: true, description: text, attachments, workflowId: selectedWfId },
    });
  };

  return (
    <div className="max-w-[720px] mx-auto pt-8 pb-10">
      <h1 className="kad-display text-kad-text-strong text-center">Giao việc cho đội AI</h1>
      <p className="kad-body text-kad-text-muted text-center max-w-[520px] mx-auto mt-2 mb-8">
        Mô tả việc như nói với nhân viên. Trợ lý vận hành sẽ hỏi làm rõ, chốt brief với anh rồi mới bắt tay thực thi.
      </p>

      <HowRow />

      <TaskComposer
        ref={composerRef}
        size="hero"
        value={value}
        onChange={(v) => {
          setValue(v);
          if (selectedWfId && v.trim().length === 0) setSelectedWfId(null);
        }}
        onSubmit={handleSubmit}
        placeholder="Mô tả việc như nói với nhân viên…  (⌘Enter để gửi)"
        attachments={attachments}
        onAttach={handleAttach}
        onRemoveAttachment={handleRemoveAttachment}
        autoFocus
      />

      {suggestions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mt-2.5">
          <span className="kad-caption text-kad-text-faint">Gợi ý loại việc:</span>
          {suggestions.map((wf) => (
            <SuggestChip
              key={wf.id}
              label={wf.displayName}
              active={selectedWfId === wf.id}
              onClick={() => setSelectedWfId(wf.id)}
            />
          ))}
          <SuggestChip
            label="Việc tự do"
            active={selectedWfId === FREEFORM_ID}
            onClick={() => setSelectedWfId(FREEFORM_ID)}
          />
        </div>
      )}

      <div className="flex items-center gap-4 pt-2.5 kad-caption text-kad-text-muted">
        <label className="flex items-center gap-1.5">
          <span aria-hidden>📁</span>
          <select
            value={workingDir}
            onChange={(e) => setWorkingDir(e.target.value)}
            className="kad-caption text-kad-text-muted bg-transparent border-none outline-none cursor-pointer"
          >
            {DIR_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <span className="text-kad-text-faint">Chỉ cần mô tả — mọi thứ khác Trợ lý sẽ hỏi</span>
      </div>

      {/* spec/ui/09 §1 — Khi nào bắt đầu? */}
      <div className="pt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="kad-caption text-kad-text-muted">Bắt đầu:</span>
          <div className="inline-flex rounded-lg bg-kad-surface-2 p-0.5">
            {ACTIVATIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setActivation(a.id)}
                className={`kad-label h-7 px-3 rounded-md transition-colors ${
                  activation === a.id
                    ? "bg-kad-surface text-kad-text-strong"
                    : "text-kad-text-muted hover:text-kad-text"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => navigate("/cong-viec/tu-dong-hoa")}
            className="kad-caption text-kad-accent hover:underline"
          >
            Xem luật tự động{activeRuleCount > 0 ? ` (${activeRuleCount})` : ""} →
          </button>
        </div>

        {activation === "dependency" && (
          <div className="flex items-center gap-2 flex-wrap mt-2.5 pl-1">
            <span className="kad-caption text-kad-text-muted">Bắt đầu khi</span>
            <SelectInline value={depSource} onChange={setDepSource} options={DEPENDENCY_SOURCES} />
            <SelectInline value={depCondition} onChange={setDepCondition} options={DEP_CONDITIONS} />
          </div>
        )}

        {activation === "schedule" && (
          <div className="flex items-center gap-2 flex-wrap mt-2.5 pl-1">
            <SelectInline
              value={schedFreq}
              onChange={(v) => setSchedFreq(v as ScheduleFrequency)}
              options={FREQS.map((f) => [f.id, f.label] as [string, string])}
            />
            {schedFreq === "weekly" && <SelectInline value={schedWeekday} onChange={setSchedWeekday} options={WEEKDAYS} />}
            {(schedFreq === "monthly" || schedFreq === "once") && (
              <label className="kad-caption text-kad-text-muted flex items-center gap-1.5">
                ngày
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={schedDay}
                  onChange={(e) => setSchedDay(e.target.value)}
                  className="kad-caption h-7 w-14 rounded-md bg-kad-surface-2 border border-transparent px-2 text-kad-text focus:outline-none focus:border-kad-border-strong"
                />
              </label>
            )}
            <span className="kad-caption text-kad-text-muted">lúc</span>
            <input
              type="time"
              value={schedTime}
              onChange={(e) => setSchedTime(e.target.value)}
              className="kad-caption h-7 rounded-md bg-kad-surface-2 border border-transparent px-2 text-kad-text focus:outline-none focus:border-kad-border-strong"
            />
          </div>
        )}

        {activation !== "now" && (
          <p className="kad-caption text-kad-text-faint mt-2 pl-1">
            Việc tự tạo vẫn vào Hàng đợi chờ anh xác nhận trước khi tiêu token.
          </p>
        )}
      </div>

      <p className="kad-overline text-kad-text-muted mt-7 mb-2.5">Bắt đầu nhanh theo loại việc</p>
      <div className="grid grid-cols-3 gap-3">
        {WORKFLOW_QUICKSTARTS.map((wf) => (
          <button
            key={wf.id}
            type="button"
            onClick={() => handlePickCard(wf)}
            className="text-left rounded-xl bg-kad-surface hover:bg-kad-surface-2 transition-colors p-3.5"
          >
            <p className="kad-label text-kad-text-strong mb-1.5">{wf.displayName}</p>
            <p className="kad-caption text-kad-text-faint">{wf.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectInline({
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
      className="kad-caption h-7 rounded-md bg-kad-surface-2 border border-transparent px-2 text-kad-text focus:outline-none focus:border-kad-border-strong cursor-pointer"
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

function SuggestChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`kad-label h-7 px-3 rounded-full border transition-colors ${
        active
          ? "border-kad-accent bg-[#eaf3ff] text-[#0e5bd1]"
          : "border-kad-border-strong text-kad-text hover:bg-kad-surface-2"
      }`}
    >
      {label}
    </button>
  );
}

// ── Hero 4 bước có mũi tên flow (spec 07 §1) ────────────────────────────────

function HowRow() {
  return (
    <div className="flex items-center gap-2 mb-7">
      {HERO_STEPS.map((label, i) => (
        <div key={label} className="contents">
          <div className="flex-1 min-w-0 flex items-center gap-2 rounded-[10px] bg-kad-surface px-3 py-2.5">
            <span className="w-5 h-5 rounded-full bg-[#eaf3ff] text-[#0e5bd1] kad-caption font-semibold flex items-center justify-center flex-shrink-0">
              {i + 1}
            </span>
            <span className="kad-label text-kad-text-strong truncate">{label}</span>
          </div>
          {i < HERO_STEPS.length - 1 && <span className="flex-shrink-0 text-kad-text-faint kad-body">→</span>}
        </div>
      ))}
    </div>
  );
}
