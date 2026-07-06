/**
 * @file WorkflowRunCard.tsx
 * @description Compact workflow-run card for the Kanban board's "Workflow"
 * view. Mirrors SessionCard's information hierarchy but surfaces the
 * operational unit the CEO cares about: which workflow is running, for which
 * project/hạng mục, at which step, how far along, and who to chase.
 * Clicking opens the workflow-run peek drawer (detail sidebar).
 */
import { useTranslation } from "react-i18next";
import { Workflow, Bot, Clock, Link2Off, ShieldAlert, ListChecks } from "lucide-react";
import type { WorkflowBoardItem } from "../lib/workflow-board";
import { timeAgo } from "../lib/format";

interface WorkflowRunCardProps {
  item: WorkflowBoardItem;
  onClick: () => void;
}

export function WorkflowRunCard({ item, onClick }: WorkflowRunCardProps) {
  const { t } = useTranslation("kanban");
  const isRunning = item.status === "running";
  const isWaiting = item.status === "waiting_approval";
  const pct = item.stepsTotal > 0 ? Math.round((item.stepsDone / item.stepsTotal) * 100) : null;

  return (
    <div
      onClick={onClick}
      className={`card-hover p-4 cursor-pointer animate-fade-in overflow-hidden ${
        isWaiting
          ? "border-l-2 border-l-yellow-500/60"
          : isRunning
            ? "border-l-2 border-l-emerald-500/50"
            : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-accent/15 text-accent">
            <Workflow className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 overflow-hidden">
            <p className="text-sm font-medium text-kad-text truncate">{item.title}</p>
            <p className="text-[11px] text-kad-text-muted font-mono truncate">{item.workflowKey}</p>
          </div>
        </div>
        {item.needsApproval && (
          <span
            className="flex items-center gap-1 text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0"
            title={t("wf.approvalNeeded")}
          >
            <ShieldAlert className="w-3 h-3" />
            {t("wf.approvalBadge")}
          </span>
        )}
      </div>

      {/* Project / hạng mục — "Unlinked" when the run has no project link. */}
      <p className="text-xs mb-2 truncate leading-relaxed">
        {item.projectLabel ? (
          <span className="text-kad-text-muted">{item.projectLabel}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-kad-text-faint">
            <Link2Off className="w-3 h-3" /> {t("wf.unlinked")}
          </span>
        )}
      </p>

      {/* Step + progress */}
      {item.stepsTotal > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[11px] text-kad-text-muted mb-1 gap-2 min-w-0">
            <span className="truncate">
              {item.currentStep
                ? `${t("wf.step")}: ${item.currentStep}`
                : item.status === "done"
                  ? t("wf.done")
                  : t("wf.noCurrentStep")}
            </span>
            <span className="flex-shrink-0 font-mono">
              {item.stepsDone}/{item.stepsTotal}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <div
              className={`h-full rounded-full ${isWaiting ? "bg-yellow-500/70" : "bg-emerald-500/70"}`}
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-kad-text-muted min-w-0 overflow-hidden flex-wrap">
        {item.agentLabel && (
          <span className="flex items-center gap-1 flex-shrink-0 truncate">
            <Bot className="w-3 h-3" />
            <span className="truncate">{item.agentLabel}</span>
          </span>
        )}
        {item.source === "cc-run" && (
          <span className="flex items-center gap-1 flex-shrink-0" title={t("wf.sourceCcRun")}>
            <ListChecks className="w-3 h-3" /> {t("wf.sourceCcRunShort")}
          </span>
        )}
        <span className="flex items-center gap-1 flex-shrink-0 ml-auto">
          <Clock className="w-3 h-3" />
          {timeAgo(item.updatedAt)}
        </span>
      </div>
    </div>
  );
}
