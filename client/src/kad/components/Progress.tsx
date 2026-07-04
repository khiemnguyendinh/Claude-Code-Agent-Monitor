/**
 * Progress primitives — 06-components.md §3: single bar, segmented workflow
 * strip, vertical stepper (task context pane).
 */
import { Check } from "lucide-react";
import type { ProjectStepProgress, StepState } from "../types";

// ── Single bar ─────────────────────────────────────────────────────────

export function ProgressBar({
  percent,
  tone = "accent",
}: {
  percent: number;
  tone?: "accent" | "primary";
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1 w-full rounded-full bg-kad-surface-2 overflow-hidden">
      <div
        className={`h-full rounded-full ${tone === "primary" ? "bg-kad-primary" : "bg-kad-accent"}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ── Segmented workflow strip ──────────────────────────────────────────────

const SEGMENT_COLOR: Record<StepState, string> = {
  done: "var(--kad-success)",
  doing: "var(--kad-accent)",
  waiting_human: "var(--kad-warning)",
  failed: "var(--kad-danger)",
  todo: "var(--kad-border-strong)",
};

export function SegmentedProgress({
  steps,
  height = 6,
  showLabels = false,
  pulseDoing = false,
  onSegmentClick,
}: {
  steps: ProjectStepProgress[];
  height?: 4 | 6;
  showLabels?: boolean;
  pulseDoing?: boolean;
  onSegmentClick?: (step: ProjectStepProgress) => void;
}) {
  return (
    <div className="w-full">
      <div className="flex gap-[3px]">
        {steps.map((step) => (
          <button
            key={step.key}
            type="button"
            onClick={onSegmentClick ? () => onSegmentClick(step) : undefined}
            title={`${step.label} — ${STEP_STATE_LABEL[step.state]}`}
            className={`flex-1 rounded-full ${onSegmentClick ? "cursor-pointer" : "cursor-default"} ${
              step.state === "doing" && pulseDoing ? "animate-[kad-breathe_2.4s_ease-in-out_infinite]" : ""
            }`}
            style={{ height, backgroundColor: SEGMENT_COLOR[step.state] }}
          />
        ))}
      </div>
      {showLabels && (
        <div className="flex gap-[3px] mt-1">
          {steps.map((step) => (
            <span key={step.key} className="flex-1 kad-caption text-kad-text-faint text-center truncate">
              {step.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const STEP_STATE_LABEL: Record<StepState, string> = {
  done: "Xong",
  doing: "Đang chạy",
  waiting_human: "Chờ duyệt",
  failed: "Lỗi",
  todo: "Chưa tới",
};

// ── Vertical stepper (task context pane) ──────────────────────────────────

export function VerticalStepper({
  steps,
  onStepClick,
}: {
  steps: ProjectStepProgress[];
  onStepClick?: (step: ProjectStepProgress) => void;
}) {
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const isCurrent = step.state === "doing" || step.state === "waiting_human";
        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex-shrink-0 rounded-full flex items-center justify-center ${
                  isCurrent ? "w-4 h-4 ring-[3px] ring-kad-accent/20" : "w-2 h-2"
                }`}
                style={{
                  backgroundColor:
                    step.state === "done"
                      ? "var(--kad-success)"
                      : step.state === "failed"
                        ? "var(--kad-danger)"
                        : isCurrent
                          ? "var(--kad-accent)"
                          : "var(--kad-border-strong)",
                  marginTop: isCurrent ? 0 : 3,
                }}
              >
                {step.state === "done" && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
              </span>
              {!isLast && (
                <span
                  className="w-px flex-1 min-h-[20px]"
                  style={{
                    backgroundColor:
                      step.state === "done" ? "#1fae7355" : "var(--kad-border)",
                  }}
                />
              )}
            </div>
            <button
              type="button"
              onClick={onStepClick ? () => onStepClick(step) : undefined}
              className={`kad-body text-left pb-4 ${isCurrent ? "text-kad-text-strong font-medium" : "text-kad-text-muted"} ${onStepClick ? "hover:text-kad-text" : ""}`}
            >
              {step.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
