/**
 * Màn Giao việc mới (`/cong-viec/moi`) — spec/ui/07-giao-viec-intake-report-
 * card.md §1 (mở rộng 03 §2, KHÔNG modal). Trang chat trắng có hero hướng dẫn
 * cơ chế; composer nằm giữa trang.
 *
 * spec/ui/09 (chốt 2026-07-04): tích hợp control "Khi nào bắt đầu?" ngay trong
 * composer — Ngay / Khi điều kiện (task_dependencies) / Theo lịch
 * (automation_rules schedule). auto-task vẫn cần người duyệt trước khi tiêu
 * token.
 *
 * Wired to the real Phase 1/2c backend via the shared api-client.ts (no mock
 * store). "Ngay" hands off task creation to TraoDoiCongViec's fresh-flow
 * effect (unchanged there except it now also receives workingDir/attachments/
 * workflowId — see that file); "Khi điều kiện" and "Theo lịch" create the
 * task_dependencies row / automation_rules row directly from here since they
 * never enter the chat screen.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { kadApi } from "../api-client";
import type { KadWorkflowSummary } from "../api-client";
import { stashPendingFiles } from "../pending-uploads";
import { SCHEDULE_FREQS, WEEKDAYS, scheduleLabel } from "../schedule-helpers";
import { useKadToast } from "../components/Toast";
import {
  TaskComposer,
  type ComposerAttachment,
  type TaskComposerHandle,
} from "../components/TaskComposer";
import type { ScheduleFrequency } from "../types";

const HERO_STEPS = ["Mô tả việc", "Trợ lý làm rõ", "Chốt brief", "Thực thi & báo cáo"];
const DIR_OPTIONS = ["kstudy-rd/K3", "kstudy-rd/content", "Chọn thư mục khác…"];
const FREEFORM_ID = "wf-freeform";

// "Việc tự do" không phải một workflow_definitions thật — là lựa chọn
// "không chọn quy trình nào" (spec 07 §1). Không lấy từ API để tránh bịa row.
const FREEFORM_CARD: KadWorkflowSummary = {
  id: FREEFORM_ID,
  name: "Việc tự do",
  description: "Trợ lý tự lập kế hoạch sau khi làm rõ",
  examplePrompt: "",
  triggerKeywords: [],
};

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

function newLocalId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `fresh-${Math.trunc(performance.now() * 1000)}`;
}

export function CongViecMoi() {
  const showToast = useKadToast();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [selectedWfId, setSelectedWfId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<{ id: string; file: File }[]>([]);
  const [workingDir, setWorkingDir] = useState(DIR_OPTIONS[0]!);
  const [submitting, setSubmitting] = useState(false);
  const composerRef = useRef<TaskComposerHandle>(null);

  const [workflows, setWorkflows] = useState<KadWorkflowSummary[]>([]);
  const [depSources, setDepSources] = useState<{ id: string; title: string }[]>([]);
  const [activeRuleCount, setActiveRuleCount] = useState(0);

  useEffect(() => {
    kadApi.workflows
      .list()
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
    kadApi.tasks
      .list({ limit: 100 })
      .then((rows) => setDepSources(rows.map((t) => ({ id: t.id, title: t.title }))))
      .catch(() => setDepSources([]));
    kadApi.automationRules
      .list()
      .then((rules) => setActiveRuleCount(rules.filter((r) => r.enabled).length))
      .catch(() => setActiveRuleCount(0));
  }, []);

  const quickstarts = useMemo(() => [...workflows, FREEFORM_CARD], [workflows]);

  // [spec 07 §1] gợi ý tối đa 3 chip khi gõ ≥15 ký tự và chưa chọn workflow.
  const suggestions = useMemo(() => {
    if (selectedWfId) return [];
    const q = value.trim();
    if (q.length < 15) return [];
    const lower = q.toLowerCase();
    return workflows.filter((wf) => wf.triggerKeywords.some((k) => lower.includes(k))).slice(0, 3);
  }, [value, selectedWfId, workflows]);

  // spec/ui/09 — Khi nào bắt đầu?
  const [activation, setActivation] = useState<Activation>("now");
  const [depSourceId, setDepSourceId] = useState("");
  const [depCondition, setDepCondition] = useState("approved");
  const [schedFreq, setSchedFreq] = useState<ScheduleFrequency>("weekly");
  const [schedTime, setSchedTime] = useState("07:00");
  const [schedWeekday, setSchedWeekday] = useState(WEEKDAYS[0]!);
  const [schedDay, setSchedDay] = useState("1");

  const handlePickCard = (wf: KadWorkflowSummary) => {
    setSelectedWfId(wf.id);
    setValue(wf.examplePrompt);
    composerRef.current?.focus();
  };

  // ComposerAttachment[] for TaskComposer's display — keyed by a client-local
  // id (server ids don't exist yet, nothing has been uploaded). Two different
  // local files can share a display name; the id keeps them independently
  // removable instead of one silently shadowing the other.
  const composerAttachments: ComposerAttachment[] = useMemo(
    () => pendingFiles.map((p) => ({ id: p.id, name: p.file.name })),
    [pendingFiles]
  );

  const handleFilesSelected = (files: File[]) => {
    setPendingFiles((prev) => [...prev, ...files.map((file) => ({ id: newLocalId(), file }))]);
  };

  const handleRemoveAttachment = (id: string) => {
    setPendingFiles((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSubmit = async () => {
    const text = value.trim();
    if (!text || submitting) return;
    const resolvedDir = workingDir.startsWith("Chọn") ? DIR_OPTIONS[0]! : workingDir;
    const workflowIdForApi =
      selectedWfId && selectedWfId !== FREEFORM_ID ? selectedWfId : undefined;

    // spec/ui/09 §1 — Khi điều kiện: task tạo ở 'blocked' + điều kiện, không vào chat intake.
    if (activation === "dependency") {
      // depSourceId only changes once the user touches the <select>; the
      // first option is shown (and implicitly selected) before that (line
      // ~314), so fall back to it here too or a same-title-as-shown submit
      // would silently no-op.
      const source = depSources.find((s) => s.id === (depSourceId || depSources[0]?.id));
      if (!source) {
        showToast({ message: "Chọn việc/khoá làm điều kiện.", tone: "warning" });
        return;
      }
      setSubmitting(true);
      try {
        const task = await kadApi.tasks.create({
          title: text,
          working_dir: resolvedDir,
          workflow_id: workflowIdForApi,
        });
        if (pendingFiles.length) {
          try {
            await kadApi.attachments.upload(
              task.id,
              pendingFiles.map((p) => p.file)
            );
          } catch (uploadErr) {
            // Đừng để lỗi upload chặn bước tạo điều kiện — việc vẫn phải vào
            // blocked đúng như đã chọn, thay vì mồ côi không điều kiện.
            showToast({
              message:
                uploadErr instanceof Error ? uploadErr.message : "Không thể tải file đính kèm lên.",
              tone: "warning",
            });
          }
        }
        await kadApi.dependencies.create(task.id, {
          depends_on_task_id: source.id,
          release_condition:
            depCondition === "approved" ? "dep_artifact_approved" : "dep_task_done",
        });
        const condLabel = depCondition === "approved" ? "được duyệt" : "hoàn thành";
        showToast({
          message: `Đã đặt điều kiện. Việc sẽ vào Hàng đợi khi "${source.title}" ${condLabel}, rồi chờ anh xác nhận.`,
          tone: "success",
        });
        navigate("/cong-viec/tu-dong-hoa");
      } catch (e) {
        showToast({
          message: e instanceof Error ? e.message : "Có lỗi xảy ra, thử lại.",
          tone: "warning",
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // spec/ui/09 §1 — Theo lịch: tạo automation_rule (schedule), không tạo task
    // ngay — nên chưa có task_id để đính kèm file thật vào; đính kèm (nếu có)
    // bị bỏ qua ở nhánh này (Phase 6.5 mới là nơi thật sự tạo task khi luật
    // kích, lúc đó mới có chỗ để lưu attachment).
    if (activation === "schedule") {
      const label = scheduleLabel(schedFreq, schedTime, schedWeekday, schedDay);
      const shortTitle = text.length > 42 ? `${text.slice(0, 42)}…` : text;
      setSubmitting(true);
      try {
        await kadApi.automationRules.create({
          name: shortTitle,
          trigger_type: "schedule",
          trigger_config: {
            freq: schedFreq,
            time: schedTime,
            weekday: schedWeekday,
            day: schedDay,
            label,
          },
          action_type: "create_task",
          action_config: {
            brief: text,
            working_dir: resolvedDir,
            workflow_id: workflowIdForApi ?? null,
          },
          approval_required: true,
        });
        showToast({
          message: `Đã đặt lịch — ${label}. Việc tạo ra sẽ chờ anh xác nhận trước khi chạy.`,
          tone: "success",
        });
        navigate("/cong-viec/tu-dong-hoa");
      } catch (e) {
        showToast({
          message: e instanceof Error ? e.message : "Có lỗi xảy ra, thử lại.",
          tone: "warning",
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Ngay — tạo task thật ở TraoDoiCongViec's fresh-flow effect (routeId ở
    // đây chỉ là placeholder cho URL, bị thay bằng id thật ngay sau khi tạo).
    // Task chưa tồn tại nên chưa có task_id để upload thật ngay bây giờ —
    // gửi kèm File[] thật qua pending-uploads.ts, TraoDoiCongViec.tsx upload
    // thật ngay sau khi có task_id (xem file đó).
    const tempId = newLocalId();
    stashPendingFiles(
      tempId,
      pendingFiles.map((p) => p.file)
    );
    navigate(`/cong-viec/${tempId}`, {
      state: {
        fresh: true,
        description: text,
        workflowId: workflowIdForApi,
        workingDir: resolvedDir,
      },
    });
  };

  return (
    <div className="max-w-[720px] mx-auto pt-8 pb-10">
      <h1 className="kad-display text-kad-text-strong text-center">Giao việc cho đội AI</h1>
      <p className="kad-body text-kad-text-muted text-center max-w-[520px] mx-auto mt-2 mb-8">
        Mô tả việc như nói với nhân viên. Trợ lý vận hành sẽ hỏi làm rõ, chốt brief với anh rồi mới
        bắt tay thực thi.
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
        attachments={composerAttachments}
        onFilesSelected={handleFilesSelected}
        onRemoveAttachment={handleRemoveAttachment}
        disabled={submitting}
        autoFocus
      />

      {suggestions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mt-2.5">
          <span className="kad-caption text-kad-text-faint">Gợi ý loại việc:</span>
          {suggestions.map((wf) => (
            <SuggestChip
              key={wf.id}
              label={wf.name}
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
            {depSources.length > 0 ? (
              <SelectInline
                value={depSourceId || depSources[0]!.id}
                onChange={setDepSourceId}
                options={depSources.map((s) => [s.id, s.title] as [string, string])}
              />
            ) : (
              <span className="kad-caption text-kad-text-faint">
                Chưa có việc nào để chọn làm điều kiện
              </span>
            )}
            <SelectInline
              value={depCondition}
              onChange={setDepCondition}
              options={DEP_CONDITIONS}
            />
          </div>
        )}

        {activation === "schedule" && (
          <div className="flex items-center gap-2 flex-wrap mt-2.5 pl-1">
            <SelectInline
              value={schedFreq}
              onChange={(v) => setSchedFreq(v as ScheduleFrequency)}
              options={SCHEDULE_FREQS.map((f) => [f.id, f.label] as [string, string])}
            />
            {schedFreq === "weekly" && (
              <SelectInline value={schedWeekday} onChange={setSchedWeekday} options={WEEKDAYS} />
            )}
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
        {quickstarts.map((wf) => (
          <button
            key={wf.id}
            type="button"
            onClick={() => handlePickCard(wf)}
            className="text-left rounded-xl bg-kad-surface hover:bg-kad-surface-2 transition-colors p-3.5"
          >
            <p className="kad-label text-kad-text-strong mb-1.5">{wf.name}</p>
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

function SuggestChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
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
          {i < HERO_STEPS.length - 1 && (
            <span className="flex-shrink-0 text-kad-text-faint kad-body">→</span>
          )}
        </div>
      ))}
    </div>
  );
}
