/**
 * KPI card — 06-components.md §4. Used by Tổng quan block C (3 ops metrics).
 */
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { OpsMetricCard } from "../types";
import { Sparkline } from "./Sparkline";

export function KpiCard({ metric, onClick }: { metric: OpsMetricCard; onClick?: () => void }) {
  const DeltaIcon =
    metric.deltaDirection === "up" ? ArrowUp : metric.deltaDirection === "down" ? ArrowDown : Minus;
  const deltaColor = metric.deltaGood ? "text-kad-success" : "text-kad-danger";

  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 min-h-[120px] w-full text-left bg-kad-surface border border-kad-border rounded-xl p-4 flex flex-col justify-between hover:border-kad-border-strong transition-colors"
    >
      <div>
        <p className="kad-caption text-kad-text-muted truncate">{metric.label}</p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="kad-display text-kad-text-strong">{metric.value}</span>
          <span className={`kad-caption inline-flex items-center gap-0.5 ${deltaColor}`}>
            <DeltaIcon className="w-3 h-3" aria-hidden />
            {metric.deltaLabel}
          </span>
        </div>
      </div>
      <div className="mt-2">
        <Sparkline values={metric.series14d} variant="bar" height={36} />
      </div>
    </button>
  );
}
