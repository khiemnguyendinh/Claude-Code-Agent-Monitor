/**
 * @file KanbanBoard.tsx
 * @description Kanban-style board with two views: agents grouped by their
 * AgentStatus (working/waiting/completed/error) or sessions grouped
 * by their SessionStatus (active/completed/error/abandoned). The view toggle
 * is persisted in localStorage so the user's choice survives reloads. Each
 * column paginates client-side at COLUMN_PAGE_SIZE.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useEffect, useState, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Columns3, ChevronDown, ChevronUp, HelpCircle } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { Tabs } from "../kad/components/Tabs";
import { BaoCao } from "../kad/pages/BaoCao";
import { SegmentedProgress } from "../kad/components/Progress";
import { KadStoreProvider } from "../kad/store";
import { KadToastProvider } from "../kad/components/Toast";
import { PeekDrawerHost, usePeek } from "../kad/components/PeekDrawer";
import { LiveFlowSection } from "../kad/components/LiveFlowSection";
import { AgentCard } from "../components/AgentCard";
import { SessionCard } from "../components/SessionCard";
import { EmptyState } from "../components/EmptyState";
import { CardSkeleton } from "../components/Skeleton";
import {
  STATUS_CONFIG,
  SESSION_STATUS_CONFIG,
  isAgentAwaitingInput,
  isSessionAwaitingInput,
} from "../lib/types";
import type {
  Agent,
  AgentStatus,
  EffectiveAgentStatus,
  EffectiveSessionStatus,
  Session,
  WSMessage,
} from "../lib/types";
import { kadApi, type KadTask, type KadWorkflowStep } from "../kad/api-client";
import type { AgentProfile } from "../kad/types";
import { taskToProject } from "../kad/project-from-task";

type BoardView = "agents" | "sessions";

// Persisted statuses we fetch from the API.
const AGENT_FETCH_STATUSES: AgentStatus[] = ["working", "waiting", "completed", "error"];

// Columns rendered on the Agents board.
const AGENT_COLUMNS: EffectiveAgentStatus[] = ["working", "waiting", "completed", "error"];
const SESSION_COLUMNS: EffectiveSessionStatus[] = [
  "active",
  "waiting",
  "completed",
  "error",
  "abandoned",
];
const COLUMN_PAGE_SIZE = 10;
const VIEW_STORAGE_KEY = "kanban-board-view";

function loadView(): BoardView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "agents" || stored === "sessions") return stored;
  } catch {
    /* ignore */
  }
  // Default tab is "sessions" (Khiêm's call) when nothing is stored yet.
  return "sessions";
}

function persistView(view: BoardView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* ignore */
  }
}

// 2026-07-04: "Công việc" in the unified sidebar points straight at this
// route. Per Khiêm's spec it now carries a top-level tab bar merging in the
// old standalone "Báo cáo" (KAD) page as a second tab, so the outer
// `KanbanBoard` export below is just a thin tab shell — all the pre-existing
// board logic lives unchanged in `KanbanBoardInner`.
function KanbanBoardInner() {
  const { t } = useTranslation("kanban");
  const [view, setViewState] = useState<BoardView>(loadView);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  // [Phase 7 hardening, spec/ui/08] engine_session_id -> task title, so a
  // session/agent card backed by a KAD delegation shows "tên phiên = tên công
  // việc" instead of the generic Session <id8> / cwd-heuristic fallback.
  const [sessionTaskTitles, setSessionTaskTitles] = useState<Record<string, string>>({});

  const loadSessionTaskMap = useCallback(async () => {
    try {
      const map = await kadApi.sessionTaskMap();
      const titles: Record<string, string> = {};
      for (const [sessionId, entry] of Object.entries(map)) titles[sessionId] = entry.task_title;
      setSessionTaskTitles(titles);
    } catch {
      /* KAD backend optional at runtime — board still works without it */
    }
  }, []);

  const setView = useCallback((next: BoardView) => {
    setViewState(next);
    persistView(next);
    setExpanded({}); // reset per-column pagination when switching views
  }, []);

  const loadAgents = useCallback(async () => {
    // Fetch every persisted agent status. Bucketing happens below in
    // `groupedAgents`.
    //
    // Also fetch sessions so AgentCard can surface model / cwd / cost on
    // main-agent cards (they have no task and a generic name on their
    // own - the session metadata is what makes the card useful).
    const [agentResults, sessionsRes] = await Promise.all([
      Promise.all(AGENT_FETCH_STATUSES.map((status) => api.agents.list({ status }))),
      api.sessions.list({ limit: 10000 }),
    ]);
    setAgents(agentResults.flatMap((r) => r.agents));
    setSessions(sessionsRes.sessions);
  }, []);

  const loadSessions = useCallback(async () => {
    // Each column needs the full set for its status - column-level
    // pagination ("show more") is handled client-side at COLUMN_PAGE_SIZE.
    // Wire-limit raised to the server's safety cap (10000); cost
    // computation on the server scales with returned rows, so each
    // column's request stays bounded by how many sessions actually have
    // that status. The "waiting" column is derived client-side from the
    // active set (see grouping below).
    const persistedStatuses = SESSION_COLUMNS.filter((s) => s !== "waiting");
    const results = await Promise.all(
      persistedStatuses.map((status) => api.sessions.list({ status, limit: 10000 }))
    );
    setSessions(results.flatMap((r) => r.sessions));
  }, []);

  const load = useCallback(async () => {
    try {
      if (view === "agents") await loadAgents();
      else await loadSessions();
      await loadSessionTaskMap();
    } finally {
      setLoading(false);
    }
  }, [view, loadAgents, loadSessions, loadSessionTaskMap]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    return eventBus.subscribe((msg: WSMessage) => {
      if (view === "agents") {
        if (
          msg.type === "agent_created" ||
          msg.type === "agent_updated" ||
          msg.type === "session_updated" ||
          msg.type === "session_created"
        ) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(loadAgents, 300);
        }
      } else {
        if (msg.type === "session_created" || msg.type === "session_updated") {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(loadSessions, 300);
        }
      }
    });
  }, [view, loadAgents, loadSessions]);

  // Lookup map for AgentCard's session prop - memoized to avoid rebuilding on every render
  const sessionsById = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  // Bucket by effective status: agents with status "waiting" OR those with
  // awaiting_input_since set go into the "waiting" column. Other columns
  // exclude agents that belong in "waiting".
  const isEffectivelyWaiting = (a: Agent) => a.status === "waiting" || isAgentAwaitingInput(a);

  const groupedAgents = AGENT_COLUMNS.reduce(
    (acc, status) => {
      acc[status] =
        status === "waiting"
          ? agents.filter(isEffectivelyWaiting)
          : agents.filter((a) => a.status === status && !isEffectivelyWaiting(a));
      return acc;
    },
    {} as Record<EffectiveAgentStatus, Agent[]>
  );

  const groupedSessions = SESSION_COLUMNS.reduce(
    (acc, status) => {
      acc[status] =
        status === "waiting"
          ? sessions.filter(isSessionAwaitingInput)
          : sessions.filter((s) => s.status === status && !isSessionAwaitingInput(s));
      return acc;
    },
    {} as Record<EffectiveSessionStatus, Session[]>
  );

  const total = view === "agents" ? agents.length : sessions.length;
  const subtitle =
    view === "agents"
      ? t("agentCount", { count: agents.length })
      : t("sessionCount", { count: sessions.length });

  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);

  const Header = (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center flex-shrink-0">
          <Columns3 className="w-4.5 h-4.5 text-accent" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-kad-text-strong truncate">{t("title")}</h1>
            {wsConnected ? (
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
                {t("common:live")}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[11px] text-kad-text-muted bg-kad-surface-2 border border-kad-border px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-kad-text-muted" />
                {t("common:offline")}
              </span>
            )}
          </div>
          <p className="text-xs text-kad-text-muted truncate">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <ViewToggle view={view} onChange={setView} />
        <button onClick={load} className="btn-ghost flex-shrink-0">
          <RefreshCw className="w-4 h-4" /> {t("common:refresh")}
        </button>
      </div>
    </div>
  );

  if (!loading && total === 0) {
    return (
      <div className="animate-fade-in flex flex-col min-h-[60vh]">
        {Header}
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={Columns3}
            title={view === "agents" ? t("noAgents") : t("noSessions")}
            description={view === "agents" ? t("noAgentsDesc") : t("noSessionsDesc")}
            action={
              <button onClick={load} className="btn-primary">
                <RefreshCw className="w-4 h-4" /> {t("common:refresh")}
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {Header}

      <div className="flex gap-4 min-h-[600px] overflow-x-auto pb-4 -mx-8 px-8">
        {view === "agents"
          ? AGENT_COLUMNS.map((status) => {
              const config = STATUS_CONFIG[status];
              const items = groupedAgents[status];
              const limit = expanded[status] || COLUMN_PAGE_SIZE;
              return (
                <Column
                  key={status}
                  labelKey={config.labelKey}
                  color={config.color}
                  dotClass={config.dot}
                  pulse={status === "working" || status === "waiting"}
                  count={items?.length ?? 0}
                  emptyLabel={t("noAgentsInColumn")}
                  tooltip={t(`tooltip.agent.${status}`)}
                  remaining={Math.max(0, (items?.length ?? 0) - limit)}
                  onShowMore={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [status]: limit + COLUMN_PAGE_SIZE,
                    }))
                  }
                >
                  {loading && (items?.length ?? 0) === 0
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <CardSkeleton key={`sk-${status}-${i}`} />
                      ))
                    : items
                        ?.slice(0, limit)
                        .map((agent) => (
                          <AgentCard
                            key={agent.id}
                            agent={agent}
                            session={sessionsById.get(agent.session_id)}
                            taskTitle={sessionTaskTitles[agent.session_id]}
                          />
                        ))}
                </Column>
              );
            })
          : SESSION_COLUMNS.map((status) => {
              const config = SESSION_STATUS_CONFIG[status];
              const items = groupedSessions[status];
              const limit = expanded[status] || COLUMN_PAGE_SIZE;
              return (
                <Column
                  key={status}
                  labelKey={config.labelKey}
                  color={config.color}
                  dotClass={config.dot}
                  pulse={status === "active" || status === "waiting"}
                  count={items?.length ?? 0}
                  emptyLabel={t("noSessionsInColumn")}
                  tooltip={t(`tooltip.session.${status}`)}
                  remaining={Math.max(0, (items?.length ?? 0) - limit)}
                  onShowMore={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [status]: limit + COLUMN_PAGE_SIZE,
                    }))
                  }
                >
                  {loading && (items?.length ?? 0) === 0
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <CardSkeleton key={`sk-${status}-${i}`} />
                      ))
                    : items
                        ?.slice(0, limit)
                        .map((session) => (
                          <SessionCard
                            key={session.id}
                            session={session}
                            taskTitle={sessionTaskTitles[session.id]}
                          />
                        ))}
                </Column>
              );
            })}
      </div>
    </div>
  );
}

const CONG_VIEC_TABS = [
  { key: "cong-viec", label: "Công việc" },
  { key: "kanban", label: "Kanban" },
  { key: "bao-cao", label: "Báo cáo" },
];
const CONG_VIEC_TAB_KEY = "cong-viec-page-tab";

function loadCongViecTab(): string {
  try {
    const stored = localStorage.getItem(CONG_VIEC_TAB_KEY);
    if (stored === "cong-viec" || stored === "kanban" || stored === "bao-cao") return stored;
  } catch {
    /* ignore */
  }
  return "cong-viec";
}

// 2026-07-04 (spec/ui/08): trang Công việc (/he-thong/kanban) tách 3 tab theo
// yêu cầu Khiêm — "Công việc" (Tiến độ dự án + Đang chạy trực tiếp) | "Kanban"
// (board phiên/agent thật) | "Báo cáo". Bọc KadStore/Toast/PeekDrawerHost để
// khay chi tiết (peek dự án / công việc) chạy ngay trong /he-thong (Layout gốc
// không mount provider KAD). Store là instance riêng cho trang này — mock nên
// đồng seed với KAD shell, chấp nhận được ở giai đoạn chưa có backend.
export function KanbanBoard() {
  const [tab, setTab] = useState<string>(loadCongViecTab);

  const changeTab = (key: string) => {
    setTab(key);
    try {
      localStorage.setItem(CONG_VIEC_TAB_KEY, key);
    } catch {
      /* ignore */
    }
  };

  return (
    <KadStoreProvider>
      <KadToastProvider>
        <PeekDrawerHost>
          <div className="animate-fade-in">
            <Tabs items={CONG_VIEC_TABS} active={tab} onChange={changeTab} />
            <div className="mt-6">
              {tab === "cong-viec" ? (
                <CongViecTab />
              ) : tab === "kanban" ? (
                <KanbanBoardInner />
              ) : (
                <BaoCao />
              )}
            </div>
          </div>
        </PeekDrawerHost>
      </KadToastProvider>
    </KadStoreProvider>
  );
}

// Tab "Công việc": Tiến độ dự án (real /api/kad/tasks) + Đang chạy trực tiếp
// (live flow, chuyển từ Đội ngũ > Tổ chức). Bấm 1 dự án / 1 phiên đang chạy →
// mở khay chi tiết bên phải (peek), nhờ PeekDrawerHost bọc ở KanbanBoard.
// [Phase 7 hardening] tasks/agents fetched once here, real — thay PROJECTS /
// TASK_CARDS / AGENTS mock (spec/ui/08).
function CongViecTab() {
  const { openPeek } = usePeek();
  const [tasks, setTasks] = useState<KadTask[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [taskRows, agentRows] = await Promise.all([kadApi.tasks.list(), kadApi.agents.list()]);
        if (!cancelled) {
          setTasks(taskRows);
          setAgents(agentRows);
        }
      } catch {
        // Board still renders (empty strip/live-flow) if the KAD API is down —
        // this tab isn't the whole page, no need for a hard error state here.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const mainAgent = agents.find((a) => a.agentType === "main");

  return (
    <div className="space-y-6">
      <ProjectProgressStrip tasks={tasks} agents={agents} loading={loading} />
      <LiveFlowSection
        mainAgent={mainAgent}
        tasks={tasks}
        agentsById={agentsById}
        onOpenTask={(taskId) => openPeek({ type: "task", id: taskId })}
      />
    </div>
  );
}

// ── Tiến độ dự án ─────────────────────────────────────────────────────────
// Nằm trong tab "Công việc". Bấm 1 dự án → mở khay chi tiết (peek) bên phải —
// dùng chung PeekContent.ProjectPeek với KAD shell nhờ KanbanBoard bọc
// PeekDrawerHost. [Phase 7 hardening] "dự án" = mọi task thật có workflow_id
// (không có bảng "projects" riêng trong spec 02 — mỗi task chạy 1 workflow
// LÀ 1 dự án trong mô hình dữ liệu hiện tại); % và steps tính từ
// workflow_definitions.steps thật + tasks.workflow_step thật, không suy diễn.
const PROGRESS_COLLAPSE_KEY = "kanban-progress-collapsed";

function ProjectProgressStrip({
  tasks,
  agents,
  loading,
}: {
  tasks: KadTask[];
  agents: AgentProfile[];
  loading: boolean;
}) {
  const { openPeek } = usePeek();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(PROGRESS_COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [workflowSteps, setWorkflowSteps] = useState<Record<string, KadWorkflowStep[]>>({});

  const workflowTasks = useMemo(() => tasks.filter((t) => t.workflowId), [tasks]);
  const workflowIds = useMemo(
    () => Array.from(new Set(workflowTasks.map((t) => t.workflowId as string))),
    [workflowTasks]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = workflowIds.filter((id) => !(id in workflowSteps));
      if (!missing.length) return;
      try {
        const fetched = await Promise.all(
          missing.map(async (id) => [id, (await kadApi.workflows.get(id)).steps] as const)
        );
        if (!cancelled) {
          setWorkflowSteps((prev) => {
            const next = { ...prev };
            for (const [id, steps] of fetched) next[id] = steps;
            return next;
          });
        }
      } catch {
        // A workflow fetch failing just drops that project from the strip
        // (filtered out below since workflowSteps[id] stays unset) — not a
        // hard error for the whole board.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refetch when the SET of workflow ids changes
  }, [workflowIds.join(",")]);

  const agentsByName = useMemo(() => new Map(agents.map((a) => [a.name, a])), [agents]);

  const projects = useMemo(
    () =>
      workflowTasks
        .map((t) => ({ task: t, steps: t.workflowId ? workflowSteps[t.workflowId] : undefined }))
        .filter((x): x is { task: KadTask; steps: KadWorkflowStep[] } => Boolean(x.steps))
        .map(({ task, steps }) => taskToProject(task, steps, agentsByName)),
    [workflowTasks, workflowSteps, agentsByName]
  );

  const toggle = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PROGRESS_COLLAPSE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  if (!loading && projects.length === 0) return null;

  return (
    <div>
      <div className="bg-surface-1 border border-border rounded-xl p-4">
        <button type="button" onClick={toggle} className="w-full flex items-center justify-between">
          <span className="text-sm font-semibold text-kad-text-strong">Tiến độ dự án</span>
          {collapsed ? (
            <ChevronDown className="w-4 h-4 text-kad-text-muted" />
          ) : (
            <ChevronUp className="w-4 h-4 text-kad-text-muted" />
          )}
        </button>
        {!collapsed && (
          <div className="mt-3 max-h-[280px] overflow-y-auto space-y-3">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => openPeek({ type: "project", id: project.id })}
                className="w-full flex items-center gap-3 text-left hover:opacity-90 transition-opacity"
              >
                <span className="text-sm text-kad-text truncate w-44 flex-shrink-0">{project.title}</span>
                <span className="flex-1 min-w-[160px]">
                  <SegmentedProgress steps={project.steps} height={6} showLabels pulseDoing />
                </span>
                <span className="text-xs font-semibold text-kad-text-strong flex-shrink-0 w-10 text-right">
                  {project.itemsTotal > 0 ? Math.round((project.itemsDone / project.itemsTotal) * 100) : 0}%
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ViewToggleProps {
  view: BoardView;
  onChange: (next: BoardView) => void;
}

function ViewToggle({ view, onChange }: ViewToggleProps) {
  const { t } = useTranslation("kanban");
  const baseClass =
    "px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-lg last:rounded-r-lg";
  const activeClass = "bg-accent/15 text-accent";
  const inactiveClass = "text-kad-text-muted hover:text-kad-text hover:bg-surface-3";

  return (
    <div
      role="tablist"
      aria-label={t("viewToggle.agents") + " / " + t("viewToggle.sessions")}
      className="inline-flex border border-border rounded-lg overflow-hidden bg-surface-2"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === "agents"}
        onClick={() => onChange("agents")}
        className={`${baseClass} ${view === "agents" ? activeClass : inactiveClass}`}
      >
        {t("viewToggle.agents")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "sessions"}
        onClick={() => onChange("sessions")}
        className={`${baseClass} border-l border-border ${
          view === "sessions" ? activeClass : inactiveClass
        }`}
      >
        {t("viewToggle.sessions")}
      </button>
    </div>
  );
}

interface ColumnProps {
  labelKey: string;
  color: string;
  dotClass: string;
  pulse: boolean;
  count: number;
  emptyLabel: string;
  /** Multi-line description rendered in a tooltip when the user hovers
   *  the column's help icon. Pass an empty string to suppress the icon. */
  tooltip?: string;
  remaining: number;
  onShowMore: () => void;
  children: React.ReactNode;
}

function Column({
  labelKey,
  color,
  dotClass,
  pulse,
  count,
  emptyLabel,
  tooltip,
  remaining,
  onShowMore,
  children,
}: ColumnProps) {
  const { t } = useTranslation("kanban");
  const childrenArray = Array.isArray(children) ? children : children ? [children] : [];
  const hasChildren = childrenArray.length > 0;

  return (
    <div className="bg-surface-1 rounded-xl border border-border p-3 flex flex-col flex-shrink-0 w-72">
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className={`w-2 h-2 rounded-full ${dotClass} ${pulse ? "animate-pulse-dot" : ""}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>
          {t(labelKey)}
        </span>
        {tooltip && <ColumnHelp text={tooltip} />}
        <span className="ml-auto text-[11px] text-kad-text-faint bg-surface-3 px-2 py-0.5 rounded-full">
          {count}
        </span>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto">
        {hasChildren ? (
          <>
            {children}
            {remaining > 0 && (
              <button
                onClick={onShowMore}
                className="w-full py-2 text-[11px] text-kad-text-muted hover:text-kad-text flex items-center justify-center gap-1 transition-colors"
              >
                <ChevronDown className="w-3 h-3" />
                {t("common:showMore", { count: remaining })}
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-24 text-xs text-kad-text-faint">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Help icon + tooltip for a Kanban column header. Hover or focus shows a
 * multi-line description explaining what the column lists and what the
 * status means in lifecycle terms. Keyboard-focusable for accessibility.
 */
function ColumnHelp({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  // Anchor positioning to the column header so the tooltip stays in-page on
  // the leftmost columns (where a centered tooltip would clip on narrow
  // viewports). We always anchor left-aligned to the trigger.
  const triggerRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center cursor-help"
      tabIndex={0}
      role="img"
      aria-label={text}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      <HelpCircle className="w-3 h-3 text-kad-text-muted hover:text-kad-text transition-colors" />
      {show && (
        <span
          role="tooltip"
          className="absolute left-0 top-full mt-1.5 w-64 px-3 py-2 text-[11px] leading-relaxed text-kad-text bg-surface-3 border border-border rounded-md z-50 pointer-events-none whitespace-pre-line"
          style={{ boxShadow: "var(--kad-shadow-1)" }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
