/**
 * @file WorkflowRunsPanel.tsx
 * @description Surfaces dynamic Workflow-tool runs (issue #167) - fleets of
 * inner sub-agents spawned by the Claude Code "Workflow" tool, ingested from
 * on-disk run journals. Works in two modes: controlled (pass `runs`, e.g. from
 * SessionDetail) or self-fetching (pass a `statusFilter`, e.g. the Workflows
 * page) with live `workflow_upserted` updates. Each run expands to colored,
 * clickable phase filters, a per-agent metrics table, and an expandable list of
 * per-agent results. The collapsed row shows a short teaser from the run
 * journal; expanding an agent lazily fetches its full transcript (the journal
 * only carries server-truncated previews) and renders the complete prompt and
 * result, falling back to the teaser when the transcript is pruned/unavailable.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Workflow, ChevronRight, ChevronDown, Layers, ExternalLink, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { eventBus } from "../../lib/eventBus";
import type {
  WorkflowRun,
  WorkflowProgressEntry,
  WSMessage,
  TranscriptMessage,
} from "../../lib/types";
import { fmt, formatMs, timeAgo, truncate } from "../../lib/format";

type StatusFilter = "all" | "active" | "completed";

interface Props {
  /** Controlled mode: render exactly these runs (no fetch, no live updates). */
  runs?: WorkflowRun[];
  /** Self-fetch mode: page-level status filter (active → running). */
  statusFilter?: StatusFilter;
  /** Self-fetch mode: scope to one session. */
  sessionId?: string;
  /** Hide the parent-session link (e.g. when already on that session). */
  hideSessionLink?: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  running: "bg-[var(--kad-warning)]/15 text-[var(--kad-warning)] border-[var(--kad-warning)]/30",
  working: "bg-[var(--kad-warning)]/15 text-[var(--kad-warning)] border-[var(--kad-warning)]/30",
  queued:
    "bg-[var(--kad-text-muted)]/15 text-[var(--kad-text-muted)] border-[var(--kad-text-muted)]/30",
  completed: "bg-[var(--kad-success)]/15 text-[var(--kad-success)] border-[var(--kad-success)]/30",
  done: "bg-[var(--kad-success)]/15 text-[var(--kad-success)] border-[var(--kad-success)]/30",
  success: "bg-[var(--kad-success)]/15 text-[var(--kad-success)] border-[var(--kad-success)]/30",
  error: "bg-[var(--kad-danger)]/15 text-[var(--kad-danger)] border-[var(--kad-danger)]/30",
  failed: "bg-[var(--kad-danger)]/15 text-[var(--kad-danger)] border-[var(--kad-danger)]/30",
};

function statusClass(status: string): string {
  return (
    STATUS_STYLES[status] ||
    "bg-[var(--kad-text-muted)]/15 text-[var(--kad-text-muted)] border-[var(--kad-text-muted)]/30"
  );
}

// Distinct per-phase chip colors, cycled by phase index so every phase
// (e.g. Scout / Verify / Synthesize, or Explain / Interview / Gotcha) reads
// as its own color in both the filter row and the result label chips.
// Categorical (no success/fail meaning): first 4 reuse kad tokens
// (accent/primary/info/text-muted), remaining 3 are new muted/desaturated hex
// distinct from each other and from the kad tokens above.
const PHASE_PALETTE = [
  "bg-[var(--kad-accent)]/15 text-[var(--kad-accent)] border-[var(--kad-accent)]/40",
  "bg-[var(--kad-primary)]/15 text-[var(--kad-primary)] border-[var(--kad-primary)]/40",
  "bg-[var(--kad-info)]/15 text-[var(--kad-info)] border-[var(--kad-info)]/40",
  "bg-[var(--kad-text-muted)]/15 text-[var(--kad-text-muted)] border-[var(--kad-text-muted)]/40",
  "bg-[#a35a2f]/15 text-[#a35a2f] border-[#a35a2f]/40",
  "bg-[#6d3fae]/15 text-[#6d3fae] border-[#6d3fae]/40",
  "bg-[#b0518a]/15 text-[#b0518a] border-[#b0518a]/40",
];

function phaseColor(phaseTitles: string[], title: string | null | undefined): string {
  if (!title)
    return (
      "bg-[var(--kad-text-muted)]/15 text-[var(--kad-text-muted)] border-[var(--kad-text-muted)]/40"
    );
  const i = phaseTitles.indexOf(title);
  const idx = i >= 0 ? i : Math.abs(hashStr(title)) % PHASE_PALETTE.length;
  return PHASE_PALETTE[idx % PHASE_PALETTE.length] as string;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Surface a human-readable excerpt from an agent's result preview, which is
 * often a (frequently truncated) JSON blob. Prefer a known content field, then
 * the first substantial quoted string, then a de-JSON'd snippet - so the panel
 * shows a sentence instead of raw `{"angle":"…","findings":[{"claim":"…`.
 */
export function friendlyPreview(raw: unknown): string {
  if (!raw) return "";
  const s = String(raw).trim();
  const keyed = s.match(
    /"(?:claim|pitch|note|text|summary|result|answer|brief|description|title|content)"\s*:\s*"([^"\\]{8,})/i
  );
  if (keyed && keyed[1]) return keyed[1].trim();
  const firstLong = s.match(/"([^"\\]{24,})"/);
  if (firstLong && firstLong[1]) return firstLong[1].trim();
  if (/^[[{]/.test(s)) {
    return s
      .replace(/[{}[\]"]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return s;
}

/** Full, un-truncated content for the expanded view - pretty-printed if JSON. */
export function fullPreview(raw: unknown): string {
  if (raw == null) return "";
  const s = String(raw);
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** Join the text blocks of one transcript message into a single string. */
function messageText(m: TranscriptMessage): string {
  return (m.content || [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("\n\n")
    .trim();
}

/**
 * Derive an agent's full prompt and result from its fetched transcript: the
 * first user message carries the task prompt; the last assistant message that
 * has text carries the returned result. Either is "" when absent (e.g. a
 * schema-mode agent whose final turn is a tool call rather than text) - callers
 * fall back to the journal teaser in that case.
 */
export function extractPromptResult(messages: TranscriptMessage[]): {
  prompt: string;
  result: string;
} {
  let prompt = "";
  let result = "";
  for (const m of messages || []) {
    if (m.type === "user" && !prompt) {
      const t = messageText(m);
      if (t) prompt = t;
    } else if (m.type === "assistant") {
      const t = messageText(m);
      if (t) result = t; // keep the last non-empty assistant text
    }
  }
  return { prompt, result };
}

/** Per-agent transcript fetch state, keyed `${run_id}::${agentId}`. */
interface AgentTranscriptState {
  loading: boolean;
  prompt?: string;
  result?: string;
  error?: boolean;
}

export function WorkflowRunsPanel({
  runs: controlledRuns,
  statusFilter,
  sessionId,
  hideSessionLink,
}: Props) {
  const { t } = useTranslation("workflows");
  const controlled = controlledRuns != null;

  const [fetchedRuns, setFetchedRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(!controlled);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [phaseFilter, setPhaseFilter] = useState<Record<string, string | null>>({});
  const [openResults, setOpenResults] = useState<Set<string>>(() => new Set());
  // Full agent transcripts fetched on demand when a result row is expanded,
  // keyed `${run_id}::${agentId}`. The run journal only carries truncated
  // previews; the complete text lives in the per-agent transcript file.
  const [transcripts, setTranscripts] = useState<Record<string, AgentTranscriptState>>({});
  const inflightRef = useRef<Set<string>>(new Set());

  const loadTranscript = useCallback(
    async (sessionId: string, runId: string, agentId: string, key: string) => {
      if (inflightRef.current.has(key)) return;
      inflightRef.current.add(key);
      setTranscripts((prev) => ({ ...prev, [key]: { loading: true } }));
      try {
        const res = await api.sessions.transcript(sessionId, {
          agent_id: agentId,
          run_id: runId,
          limit: 200,
        });
        const { prompt, result } = extractPromptResult(res.messages || []);
        setTranscripts((prev) => ({ ...prev, [key]: { loading: false, prompt, result } }));
      } catch {
        setTranscripts((prev) => ({ ...prev, [key]: { loading: false, error: true } }));
      }
    },
    []
  );

  const fetchRuns = useCallback(async () => {
    if (controlled) return;
    try {
      const status =
        statusFilter === "active"
          ? "running"
          : statusFilter === "completed"
            ? "completed"
            : undefined;
      const res = await api.workflows.runs({ status, session_id: sessionId, limit: 200 });
      setFetchedRuns(res.runs);
    } catch {
      /* leave previous runs in place */
    } finally {
      setLoading(false);
    }
  }, [controlled, statusFilter, sessionId]);

  useEffect(() => {
    if (controlled) return;
    fetchRuns();
  }, [controlled, fetchRuns]);

  // Live updates: debounce a refetch when a workflow row changes.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (controlled) return;
    const handler = (msg: WSMessage) => {
      if (msg.type !== "workflow_upserted") return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fetchRuns, 1500);
    };
    const unsub = eventBus.subscribe(handler);
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [controlled, fetchRuns]);

  const runs = controlled ? controlledRuns : fetchedRuns;

  const toggle = (runId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  const setPhase = (runId: string, phase: string) =>
    setPhaseFilter((prev) => ({ ...prev, [runId]: prev[runId] === phase ? null : phase }));
  const toggleResult = (key: string) =>
    setOpenResults((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!controlled && loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--kad-text-muted)]">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--kad-accent)]" />
        <span className="animate-pulse">{t("runs.loading")}</span>
      </div>
    );
  }
  if (runs.length === 0) {
    return (
      <div className="text-sm text-[var(--kad-text-muted)] flex items-center gap-2">
        <Workflow className="w-4 h-4 text-[var(--kad-text-faint)]" />
        {t("runs.empty")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const isOpen = expanded.has(run.run_id);
        const running = run.status === "running" || run.status === "working";
        // progress[] mixes phase markers and agents; only `workflow_agent`
        // entries are real agents.
        const agentRows = (run.progress || []).filter((p) => p.type === "workflow_agent");
        const phaseTitles = (run.phases || []).map((p) => p.title || "").filter(Boolean);
        const sel = phaseFilter[run.run_id] || null;
        const shown = sel ? agentRows.filter((a) => a.phaseTitle === sel) : agentRows;
        const resultRows = shown.filter((a) => a.resultPreview);
        return (
          <div
            key={run.run_id}
            className="rounded-lg border border-[var(--kad-border)] bg-[var(--kad-surface)] overflow-hidden"
          >
            <button
              onClick={() => toggle(run.run_id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--kad-surface-2)] transition-colors"
              aria-expanded={isOpen}
            >
              {isOpen ? (
                <ChevronDown className="w-4 h-4 text-[var(--kad-text-muted)] flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-[var(--kad-text-muted)] flex-shrink-0" />
              )}
              {running ? (
                <Loader2 className="w-4 h-4 text-[var(--kad-warning)] flex-shrink-0 animate-spin" />
              ) : (
                <Workflow className="w-4 h-4 text-[var(--kad-accent)] flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--kad-text-strong)] truncate">
                    {run.name || run.run_id}
                  </span>
                  <span className={`badge text-[10px] border ${statusClass(run.status)}`}>
                    {t(`runs.status.${run.status}`, run.status)}
                  </span>
                  {run.default_model && (
                    <span className="text-[10px] font-mono text-[var(--kad-text-muted)]">
                      {run.default_model}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[var(--kad-text-muted)] flex-wrap">
                  <span>{t("runs.agents", { count: run.agent_count })}</span>
                  <span>{t("runs.tools", { count: run.total_tool_calls })}</span>
                  <span>
                    {fmt(run.total_tokens)} {t("runs.tokens")}
                  </span>
                  {run.duration_ms != null && <span>{formatMs(run.duration_ms)}</span>}
                  {run.started_at && <span>{timeAgo(run.started_at)}</span>}
                </div>
              </div>
              {!hideSessionLink && (
                <Link
                  to={`/sessions/${encodeURIComponent(run.session_id)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[var(--kad-text-muted)] hover:text-[var(--kad-accent)] transition-colors flex-shrink-0"
                  title={t("runs.openSession")}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}
            </button>

            {isOpen && (
              <div className="px-3 pb-3 pt-3 border-t border-[var(--kad-border)] space-y-3">
                {/* Clickable, colored phase filters */}
                {phaseTitles.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Layers className="w-3.5 h-3.5 text-[var(--kad-text-muted)]" />
                    {phaseTitles.map((title, i) => {
                      const active = sel === title;
                      return (
                        <button
                          key={i}
                          onClick={() => setPhase(run.run_id, title)}
                          className={`badge text-[10px] border transition ${phaseColor(phaseTitles, title)} ${
                            active
                              ? "ring-1 ring-[var(--kad-text-strong)]/50"
                              : sel
                                ? "opacity-40 hover:opacity-100"
                                : "hover:ring-1 hover:ring-[var(--kad-border-strong)]"
                          }`}
                          title={t("runs.filterPhase")}
                        >
                          {title}
                        </button>
                      );
                    })}
                    {sel && (
                      <button
                        onClick={() => setPhase(run.run_id, sel)}
                        className="text-[10px] text-[var(--kad-text-muted)] hover:text-[var(--kad-text)] underline"
                      >
                        {t("runs.clearFilter")}
                      </button>
                    )}
                  </div>
                )}

                {shown.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-[var(--kad-text-muted)] text-left border-b border-[var(--kad-border)]">
                          <th className="py-1 pr-3 font-medium">{t("runs.col.agent")}</th>
                          <th className="py-1 pr-3 font-medium">{t("runs.col.phase")}</th>
                          <th className="py-1 pr-3 font-medium">{t("runs.col.state")}</th>
                          <th className="py-1 pr-3 font-medium text-right">
                            {t("runs.col.tokens")}
                          </th>
                          <th className="py-1 pr-3 font-medium text-right">
                            {t("runs.col.tools")}
                          </th>
                          <th className="py-1 pr-3 font-medium text-right">
                            {t("runs.col.duration")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((a: WorkflowProgressEntry, i) => (
                          <tr
                            key={a.agentId || i}
                            className="border-b border-[var(--kad-border)]/60"
                          >
                            <td className="py-1 pr-3 text-[var(--kad-text)]">
                              {a.label || a.agentType || a.agentId}
                              {a.lastToolName && (
                                <span className="text-[var(--kad-text-faint)] font-mono ml-1">
                                  · {a.lastToolName}
                                </span>
                              )}
                            </td>
                            <td className="py-1 pr-3">
                              <span
                                className={`badge text-[10px] border ${phaseColor(phaseTitles, a.phaseTitle)}`}
                              >
                                {a.phaseTitle || "-"}
                              </span>
                            </td>
                            <td className="py-1 pr-3">
                              <span
                                className={`badge text-[10px] border ${statusClass(String(a.state || ""))}`}
                              >
                                {t(`runs.status.${a.state}`, String(a.state || "-"))}
                              </span>
                            </td>
                            <td className="py-1 pr-3 text-right text-[var(--kad-text-muted)]">
                              {fmt(a.tokens || 0)}
                            </td>
                            <td className="py-1 pr-3 text-right text-[var(--kad-text-muted)]">
                              {a.toolCalls || 0}
                            </td>
                            <td className="py-1 pr-3 text-right text-[var(--kad-text-muted)]">
                              {a.durationMs != null ? formatMs(a.durationMs) : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--kad-text-faint)]">{t("runs.noAgents")}</p>
                )}

                {/* Clickable, colored, expandable results - full content on click */}
                {resultRows.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--kad-text-faint)]">
                      {t("runs.resultsLabel")}
                      <span className="ml-1 text-[var(--kad-text-faint)]">
                        · {resultRows.length}
                      </span>
                    </div>
                    {resultRows.map((a, i) => {
                      const key = `${run.run_id}::${a.agentId || i}`;
                      const open = openResults.has(key);
                      const ts = transcripts[key];
                      const hasFull = !!ts && !ts.loading && !ts.error;
                      const fullPrompt =
                        hasFull && ts.prompt
                          ? ts.prompt
                          : a.promptPreview
                            ? String(a.promptPreview)
                            : "";
                      const fullResult =
                        hasFull && ts.result ? ts.result : fullPreview(a.resultPreview);
                      return (
                        <div
                          key={key}
                          className="rounded border border-[var(--kad-border)] bg-[var(--kad-surface-2)] overflow-hidden"
                        >
                          <button
                            onClick={() => {
                              if (!open && a.agentId) {
                                loadTranscript(run.session_id, run.run_id, a.agentId, key);
                              }
                              toggleResult(key);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-[var(--kad-border)]/40 transition-colors"
                            aria-expanded={open}
                          >
                            {open ? (
                              <ChevronDown className="w-3.5 h-3.5 text-[var(--kad-text-muted)] flex-shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-[var(--kad-text-muted)] flex-shrink-0" />
                            )}
                            <span
                              className={`badge text-[10px] border flex-shrink-0 ${phaseColor(phaseTitles, a.phaseTitle)}`}
                            >
                              {a.label || a.agentType || a.agentId}
                            </span>
                            {!open && (
                              <span className="text-[11px] text-[var(--kad-text-muted)] leading-snug min-w-0">
                                {truncate(friendlyPreview(a.resultPreview), 160)}
                              </span>
                            )}
                          </button>
                          {open && (
                            <div className="px-2.5 pb-2.5 pt-0.5 space-y-2">
                              <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--kad-text-muted)]">
                                {a.model && <span className="font-mono">{a.model}</span>}
                                <span
                                  className={`badge border ${statusClass(String(a.state || ""))}`}
                                >
                                  {t(`runs.status.${a.state}`, String(a.state || "-"))}
                                </span>
                                <span>
                                  {fmt(a.tokens || 0)} {t("runs.tokens")}
                                </span>
                                <span>{t("runs.tools", { count: a.toolCalls || 0 })}</span>
                                {a.durationMs != null && <span>{formatMs(a.durationMs)}</span>}
                                {ts?.loading && (
                                  <span className="flex items-center gap-1 text-[var(--kad-accent)]">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    {t("runs.loadingFull")}
                                  </span>
                                )}
                              </div>
                              {fullPrompt && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-[var(--kad-text-faint)] mb-0.5">
                                    {t("runs.promptLabel")}
                                  </div>
                                  <pre className="text-[11px] text-[var(--kad-text-muted)] whitespace-pre-wrap break-words bg-[var(--kad-surface)] border border-[var(--kad-border)] rounded p-2 max-h-48 overflow-auto">
                                    {fullPrompt}
                                  </pre>
                                </div>
                              )}
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-[var(--kad-text-faint)] mb-0.5">
                                  {t("runs.resultLabel")}
                                </div>
                                <pre className="text-[11px] text-[var(--kad-text)] whitespace-pre-wrap break-words bg-[var(--kad-surface)] border border-[var(--kad-border)] rounded p-2 max-h-96 overflow-auto">
                                  {fullResult}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
