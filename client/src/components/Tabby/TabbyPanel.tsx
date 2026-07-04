/**
 * @file TabbyPanel.tsx
 * @description Expanded Tabby panel: a live status strip (live / waiting /
 *   errored stat chips + connection state), quick navigation actions, and a
 *   local "Ask" box. Pure presentational - all data and the ask/navigation
 *   behavior are injected by the container.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useState, type FormEvent, type ReactNode } from "react";
import {
  Play,
  Activity,
  LayoutList,
  Bell,
  BellOff,
  Trash2,
  X,
  Send,
  AlertTriangle,
  Hourglass,
  Radio,
  type LucideIcon,
} from "lucide-react";
import type { TabbyStatus } from "./brain";

interface TabbyPanelProps {
  status: TabbyStatus;
  muted: boolean;
  onToggleMute: () => void;
  onClearAlerts: () => void;
  onNavigate: (route: string) => void;
  /** Returns an answer to display, or null when the query was handed off. */
  onAsk: (query: string) => string | null;
  onClose: () => void;
}

export function TabbyPanel({
  status,
  muted,
  onToggleMute,
  onClearAlerts,
  onNavigate,
  onAsk,
  onClose,
}: TabbyPanelProps) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = onAsk(query);
    setAnswer(result); // null means it handed off (container navigates/closes)
    setQuery("");
  };

  return (
    <div
      className="w-72 overflow-hidden rounded-2xl border border-border-light bg-surface-2/95 backdrop-blur-md animate-slide-up"
      style={{ boxShadow: "var(--kad-shadow-1)" }}
      role="dialog"
      aria-label="Tabby companion"
    >
      {/* header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-kad-accent/10 px-3.5 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base leading-none" aria-hidden>
            🐾
          </span>
          <span className="text-sm font-semibold text-kad-text-strong">Tabby</span>
          <span
            className={`ml-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              status.connected ? "bg-kad-success/15 text-kad-success" : "bg-kad-danger/15 text-kad-danger"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                status.connected ? "bg-kad-success" : "bg-kad-danger"
              }`}
              aria-hidden
            />
            {status.connected ? "Live" : "Offline"}
          </span>
        </div>
        <button
          className="rounded-md p-1 text-kad-text-muted transition-colors hover:bg-surface-4 hover:text-kad-text"
          onClick={onClose}
          aria-label="Close Tabby"
        >
          <X size={15} />
        </button>
      </div>

      <div className="p-3">
        {/* status stat chips */}
        <div className="mb-3 grid grid-cols-3 gap-1.5">
          <StatChip
            icon={Radio}
            label="live"
            value={status.liveCount}
            tone={status.liveCount > 0 ? "accent" : "muted"}
          />
          <StatChip
            icon={Hourglass}
            label="waiting"
            value={status.waitingCount}
            tone={status.waitingCount > 0 ? "amber" : "muted"}
          />
          <StatChip
            icon={AlertTriangle}
            label="errored"
            value={status.errorCount}
            tone={status.errorCount > 0 ? "red" : "muted"}
          />
        </div>

        {/* quick actions */}
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          <ActionButton icon={Play} label="Run Claude" onClick={() => onNavigate("/run")} />
          <ActionButton icon={Activity} label="Activity" onClick={() => onNavigate("/activity")} />
          <ActionButton
            icon={LayoutList}
            label="Sessions"
            onClick={() => onNavigate("/sessions")}
          />
          <ActionButton
            icon={AlertTriangle}
            label="Errored"
            disabled={status.errorCount === 0}
            onClick={() => onNavigate("/sessions")}
          />
          <ActionButton
            icon={muted ? BellOff : Bell}
            label={muted ? "Unmute" : "Mute"}
            onClick={onToggleMute}
          />
          <ActionButton
            icon={Trash2}
            label="Clear alerts"
            disabled={status.errorCount === 0}
            onClick={onClearAlerts}
          />
        </div>

        {/* ask */}
        <form onSubmit={submit} className="flex items-center gap-1.5">
          <input
            className="flex-1 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-xs text-kad-text placeholder-kad-text-muted transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            placeholder="Ask Tabby… (e.g. any errors?)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Ask Tabby"
          />
          <button
            type="submit"
            className="flex items-center justify-center rounded-lg bg-accent px-2.5 py-2 text-white transition-colors hover:bg-accent-hover"
            aria-label="Send"
          >
            <Send size={14} />
          </button>
        </form>
        {answer && (
          <p className="mt-2 rounded-lg bg-surface-1/70 px-2.5 py-2 text-xs leading-relaxed text-kad-text">
            {answer}
          </p>
        )}
      </div>
    </div>
  );
}

interface Tone {
  wrap: string;
  value: string;
  icon: string;
}

const TONE_MUTED: Tone = {
  wrap: "border-border bg-surface-1",
  value: "text-kad-text",
  icon: "text-kad-text-muted",
};

const TONES: Record<string, Tone> = {
  accent: { wrap: "border-accent/30 bg-accent/10", value: "text-kad-text-strong", icon: "text-accent" },
  amber: {
    wrap: "border-kad-warning/30 bg-kad-warning/10",
    value: "text-kad-warning",
    icon: "text-kad-warning",
  },
  red: { wrap: "border-kad-danger/30 bg-kad-danger/10", value: "text-kad-danger", icon: "text-kad-danger" },
  muted: TONE_MUTED,
};

function StatChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: string;
}): ReactNode {
  const t = TONES[tone] ?? TONE_MUTED;
  return (
    <div className={`flex flex-col items-center gap-0.5 rounded-xl border py-1.5 ${t.wrap}`}>
      <Icon size={13} className={t.icon} aria-hidden />
      <span className={`text-base font-semibold leading-none tabular-nums ${t.value}`}>
        {value}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-kad-text-muted">{label}</span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-lg bg-surface-1 px-2 py-1.5 text-xs text-kad-text transition-colors hover:bg-surface-4 hover:text-kad-text-strong disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={14} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
