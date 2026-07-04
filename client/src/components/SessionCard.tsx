/**
 * @file SessionCard.tsx
 * @description Compact session card for the Kanban board's "Sessions" view.
 * Mirrors AgentCard's information hierarchy (icon · title · meta line) but
 * surfaces session-relevant fields: model, agent count, cost, last activity.
 * Clicking the card navigates to the session detail page.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Bot, Clock, Coins, Cpu } from "lucide-react";
import { SessionStatusBadge } from "./StatusBadge";
import { effectiveSessionStatus, isSessionAwaitingInput } from "../lib/types";
import type { Session } from "../lib/types";
import { formatDuration, timeAgo, formatModelName } from "../lib/format";
import { projectFromCwd } from "../lib/event-grouping";

interface SessionCardProps {
  session: Session;
  onClick?: () => void;
}

function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0";
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

export function SessionCard({ session, onClick }: SessionCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation("kanban");
  const isActive = session.status === "active";
  const isWaiting = isSessionAwaitingInput(session);
  const status = effectiveSessionStatus(session);
  // Tên phiên do Claude Code tự sinh ("Session <id8>") không mang tên công
  // việc. Bản tạm: nếu tên rỗng/tự sinh thì suy tên thư mục làm việc (cwd)
  // làm nhãn dễ đọc. Bản chuẩn lấy tên công việc thật qua map task↔session
  // (/api/kad/*) — xem spec/ui/08-gop-cong-viec-kanban.md.
  const rawName = session.name?.trim() || "";
  const isGenericName = /^Session [0-9a-f]{8}$/i.test(rawName);
  const title = (!isGenericName && rawName) || projectFromCwd(session.cwd) || t("session.anonymous");
  const agentCount = session.agent_count ?? 0;
  const model = formatModelName(session.model);
  const lastActivity = session.last_activity || session.ended_at || session.started_at;

  function handleClick() {
    if (onClick) onClick();
    else navigate(`/he-thong/sessions/${session.id}`);
  }

  return (
    <div
      onClick={handleClick}
      className={`card-hover p-4 cursor-pointer animate-fade-in overflow-hidden ${
        isWaiting
          ? "border-l-2 border-l-yellow-500/60"
          : isActive
            ? "border-l-2 border-l-emerald-500/50"
            : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-accent/15 text-accent">
            <FolderOpen className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 overflow-hidden">
            <p className="text-sm font-medium text-kad-text truncate">{title}</p>
            <p className="text-[11px] text-kad-text-muted font-mono truncate">
              {session.id.slice(0, 12)}
            </p>
          </div>
        </div>
        <SessionStatusBadge status={status} />
      </div>

      {session.cwd && (
        <p className="text-xs text-kad-text-muted mb-3 truncate font-mono leading-relaxed">
          {session.cwd}
        </p>
      )}

      <div className="flex items-center gap-3 text-[11px] text-kad-text-muted min-w-0 overflow-hidden flex-wrap">
        <span className="flex items-center gap-1 flex-shrink-0">
          <Bot className="w-3 h-3" />
          {t("session.agentSummary", { count: agentCount })}
        </span>
        {model && (
          <span className="flex items-center gap-1 flex-shrink-0 truncate">
            <Cpu className="w-3 h-3" />
            <span className="truncate">{model}</span>
          </span>
        )}
        {typeof session.cost === "number" && session.cost > 0 && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Coins className="w-3 h-3" />
            {formatCost(session.cost)}
          </span>
        )}
        <span className="flex items-center gap-1 flex-shrink-0">
          <Clock className="w-3 h-3" />
          {session.ended_at
            ? `${t("ran")}${formatDuration(session.started_at, session.ended_at)}`
            : `${t("running")}${formatDuration(session.started_at, new Date().toISOString())}`}
        </span>
        <span className="text-kad-text-muted flex-shrink-0 ml-auto">
          {timeAgo(session.ended_at || lastActivity)}
        </span>
      </div>
    </div>
  );
}
