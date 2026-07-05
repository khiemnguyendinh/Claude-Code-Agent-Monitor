/**
 * Reactive overlay shared across KAD screens (Tổng quan, peek drawer, command
 * palette, ...) so an action in one place (e.g. "Duyệt" in the peek drawer)
 * is reflected everywhere on screen. `approvals`/`standup`/`agentsById` are
 * wired to the real `/api/kad/*` backend (Phase 2 "Tổng quan" track) + WS —
 * this was always the intended seam for that swap (see git history). The rest
 * (tasks/automation/goals/notifications) is still the mock overlay, out of
 * scope for that track.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { kadApi } from "./api-client";
import { departmentScope, subscribeKadScope } from "./ws-client";
import {
  AUTOMATION_RULES,
  BLOCKED_TASKS,
  GOALS,
  NOTIFICATIONS,
  ORG_CONTEXT_SECTIONS,
  TASK_CARDS,
} from "./mockData";
import type {
  AgentProfile,
  Approval,
  ApprovalStatus,
  AutomationRule,
  Goal,
  KadNotification,
  StandupBrief,
  StrategyPlan,
  TaskCard,
  TaskStatus,
} from "./types";

const EMPTY_STANDUP: StandupBrief = {
  generatedAt: null,
  dangChay: [],
  choAnh: [],
  ruiRo: [],
  costYesterdayTokens: 0,
  costYesterdayVnd: 0,
};

const INITIAL_STRATEGY: StrategyPlan = {
  bodyMarkdown: ORG_CONTEXT_SECTIONS.find((s) => s.key === "chien-luoc")?.bodyMarkdown ?? "",
  updatedAt: ORG_CONTEXT_SECTIONS.find((s) => s.key === "chien-luoc")?.approvedAt ?? null,
};

let taskIdSeq = 0;

interface KadStoreValue {
  approvals: Approval[];
  /** Rejects on request failure so callers can show an error / avoid an
   * optimistic success toast instead of assuming the decision landed. */
  decideApproval: (id: string, status: ApprovalStatus, reason: string | null) => Promise<void>;
  /** Real agent_profiles by id (spec 03) — ids don't match mockData's, so screens
   * rendering a real agentId must pass AgentAvatar's displayNameOverride/agentNameOverride
   * from this map instead of relying on mockData's findAgent(). */
  agentsById: Map<string, AgentProfile>;
  notifications: KadNotification[];
  unreadCount: number;
  markAllNotificationsRead: () => void;
  standup: StandupBrief;
  regenerateStandup: () => void;
  tasks: TaskCard[];
  addTask: (input: {
    title: string;
    dueDate?: string | null;
    workingDir?: string | null;
    attachmentNames?: string[];
    startCondition?: string | null;
  }) => string;
  assignTask: (id: string, agentId: string) => void;
  releaseDependency: (taskId: string) => void;
  automationRules: AutomationRule[];
  allAutomationPaused: boolean;
  toggleRule: (id: string) => void;
  togglePauseAll: () => void;
  addRule: (rule: AutomationRule) => void;
  goals: Goal[];
  strategy: StrategyPlan;
  saveGoalsAndStrategy: (input: { goals: Goal[]; strategyMarkdown: string }) => void;
}

const KadStoreContext = createContext<KadStoreValue | null>(null);

export function KadStoreProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<KadNotification[]>(NOTIFICATIONS);
  const [tasks, setTasks] = useState<TaskCard[]>([...BLOCKED_TASKS, ...TASK_CARDS]);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>(AUTOMATION_RULES);
  const [allAutomationPaused, setAllAutomationPaused] = useState(false);
  const [goals, setGoals] = useState<Goal[]>(GOALS);
  const [strategy, setStrategy] = useState<StrategyPlan>(INITIAL_STRATEGY);

  // ── Real data: approvals + standup + agent identities (spec 03 / spec/ui/02) ──
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [standup, setStandup] = useState<StandupBrief>(EMPTY_STANDUP);
  const [agentsById, setAgentsById] = useState<Map<string, AgentProfile>>(new Map());
  // Bootstrapped once from GET /reports/overview (single-department MVP); kept in a
  // ref so decideApproval/regenerateStandup (defined once via useCallback) always
  // read the current value without re-subscribing WS on every render.
  const departmentIdRef = useRef<string | null>(null);

  const refetchApprovals = useCallback((deptId: string | null) => {
    kadApi.approvals
      .list(deptId ? { department: deptId } : undefined)
      .then(setApprovals)
      .catch((e) => {
        console.warn("[kad] failed to load approvals:", e && e.message);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    kadApi.agents
      .list()
      .then((rows) => {
        if (!cancelled) setAgentsById(new Map(rows.map((a) => [a.id, a])));
      })
      .catch((e) => console.warn("[kad] failed to load agents:", e && e.message));
    kadApi.reports
      .overview()
      .then((overview) => {
        if (cancelled) return;
        const deptId = overview.departmentId;
        departmentIdRef.current = deptId;
        refetchApprovals(deptId);
        kadApi.standup
          .today(deptId ?? undefined)
          .then(setStandup)
          .catch(() => {});
        if (!deptId) return;
        unsubscribe = subscribeKadScope(departmentScope(deptId), (ev) => {
          if (ev.type === "kad.approval.created" || ev.type === "kad.approval.decided") {
            refetchApprovals(departmentIdRef.current);
          }
        });
      })
      .catch((e) => console.warn("[kad] failed to load overview:", e && e.message));

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decideApproval = useCallback(
    (id: string, status: ApprovalStatus, reason: string | null) => {
      return kadApi.approvals
        .decide(id, status, reason)
        .then(() => {
          refetchApprovals(departmentIdRef.current);
        })
        .catch((e) => {
          console.warn("[kad] decide approval failed:", e && e.message);
          throw e;
        });
    },
    [refetchApprovals]
  );

  const regenerateStandup = useCallback(() => {
    kadApi.standup
      .regenerate(departmentIdRef.current ?? undefined)
      .then(setStandup)
      .catch((e) => console.warn("[kad] regenerate standup failed:", e && e.message));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))
    );
  }, []);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const addTask = useCallback(
    (input: {
      title: string;
      dueDate?: string | null;
      workingDir?: string | null;
      attachmentNames?: string[];
      startCondition?: string | null;
    }) => {
      taskIdSeq += 1;
      const id = `task-new-${taskIdSeq}`;
      const blocked = Boolean(input.startCondition);
      const newTask: TaskCard = {
        id,
        parentTaskId: null,
        title: input.title,
        status: (blocked ? "blocked" : "inbox") as TaskStatus,
        projectTitle: "Chưa gắn dự án",
        dueDate: input.dueDate ?? null,
        assignedAgentId: null,
        hasFailedRun: false,
        retryCount: 0,
        priority: "normal",
        updatedAt: new Date().toISOString(),
        workingDir: input.workingDir ?? null,
        attachmentNames: input.attachmentNames ?? [],
        startCondition: input.startCondition ?? null,
      };
      setTasks((prev) => [newTask, ...prev]);
      return id;
    },
    []
  );

  const assignTask = useCallback((id: string, agentId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, assignedAgentId: agentId, status: "doing" as TaskStatus } : t
      )
    );
  }, []);

  // spec/ui/09 — gỡ điều kiện: task blocked → inbox (worker thả khi điều kiện thoả;
  // ở mockup người gỡ tay để demo).
  const releaseDependency = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: "inbox" as TaskStatus, startCondition: null } : t
      )
    );
  }, []);

  const toggleRule = useCallback((id: string) => {
    setAutomationRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  }, []);

  const togglePauseAll = useCallback(() => {
    setAllAutomationPaused((p) => !p);
  }, []);

  const addRule = useCallback((rule: AutomationRule) => {
    setAutomationRules((prev) => [rule, ...prev]);
  }, []);

  // Trưởng phòng nhập trực tiếp mục tiêu + chiến lược (không phải đề xuất chờ
  // duyệt): ghi thẳng vào store để Tổng quan (thẻ mục tiêu) và tab Văn hóa
  // (mục "Chiến lược & Ưu tiên") phản ánh ngay. Trợ lý vận hành đọc lại để
  // điều chỉnh ưu tiên công việc.
  const saveGoalsAndStrategy = useCallback((input: { goals: Goal[]; strategyMarkdown: string }) => {
    setGoals(input.goals);
    setStrategy({
      bodyMarkdown: input.strategyMarkdown,
      updatedAt: new Date().toLocaleDateString("vi-VN"),
    });
  }, []);

  const value: KadStoreValue = {
    approvals,
    decideApproval,
    agentsById,
    notifications,
    unreadCount,
    markAllNotificationsRead,
    standup,
    regenerateStandup,
    tasks,
    addTask,
    assignTask,
    releaseDependency,
    automationRules,
    allAutomationPaused,
    toggleRule,
    togglePauseAll,
    addRule,
    goals,
    strategy,
    saveGoalsAndStrategy,
  };

  return <KadStoreContext.Provider value={value}>{children}</KadStoreContext.Provider>;
}

export function useKadStore(): KadStoreValue {
  const ctx = useContext(KadStoreContext);
  if (!ctx) throw new Error("useKadStore must be used within KadStoreProvider");
  return ctx;
}
