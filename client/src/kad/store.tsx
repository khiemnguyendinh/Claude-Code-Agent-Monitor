/**
 * In-memory interaction layer for the mockup. There is no `/api/kad/*` yet,
 * so this is NOT a data-fetching store — it's a thin reactive overlay on top
 * of the static mock arrays (mockData.ts) purely so that clicking "Duyệt" in
 * one place (e.g. the peek drawer) is reflected everywhere else on screen
 * (Tổng quan, Kanban, chat, notification bell) within the same session. Real
 * wiring later replaces this with WS events + refetch, per spec/ui.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  APPROVALS,
  AUTOMATION_RULES,
  BLOCKED_TASKS,
  GOALS,
  NOTIFICATIONS,
  ORG_CONTEXT_SECTIONS,
  STANDUP,
  TASK_CARDS,
} from "./mockData";
import type {
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

const INITIAL_STRATEGY: StrategyPlan = {
  bodyMarkdown: ORG_CONTEXT_SECTIONS.find((s) => s.key === "chien-luoc")?.bodyMarkdown ?? "",
  updatedAt: ORG_CONTEXT_SECTIONS.find((s) => s.key === "chien-luoc")?.approvedAt ?? null,
};

let taskIdSeq = 0;

interface ApprovalDecision {
  status: ApprovalStatus;
  decisionReason: string | null;
}

interface KadStoreValue {
  approvals: Approval[];
  decideApproval: (id: string, status: ApprovalStatus, reason: string | null) => void;
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
  const [decisions, setDecisions] = useState<Record<string, ApprovalDecision>>({});
  const [notifications, setNotifications] = useState<KadNotification[]>(NOTIFICATIONS);
  const [standup, setStandup] = useState<StandupBrief>(STANDUP);
  const [tasks, setTasks] = useState<TaskCard[]>([...BLOCKED_TASKS, ...TASK_CARDS]);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>(AUTOMATION_RULES);
  const [allAutomationPaused, setAllAutomationPaused] = useState(false);
  const [goals, setGoals] = useState<Goal[]>(GOALS);
  const [strategy, setStrategy] = useState<StrategyPlan>(INITIAL_STRATEGY);

  const approvals = useMemo(
    () =>
      APPROVALS.map((a) => {
        const decision = decisions[a.id];
        return decision ? { ...a, status: decision.status, decisionReason: decision.decisionReason } : a;
      }),
    [decisions]
  );

  const decideApproval = useCallback((id: string, status: ApprovalStatus, reason: string | null) => {
    setDecisions((prev) => ({ ...prev, [id]: { status, decisionReason: reason } }));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }, []);

  const regenerateStandup = useCallback(() => {
    setStandup((prev) => ({ ...prev, generatedAt: new Date().toISOString() }));
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
      prev.map((t) => (t.id === id ? { ...t, assignedAgentId: agentId, status: "doing" as TaskStatus } : t))
    );
  }, []);

  // spec/ui/09 — gỡ điều kiện: task blocked → inbox (worker thả khi điều kiện thoả;
  // ở mockup người gỡ tay để demo).
  const releaseDependency = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "inbox" as TaskStatus, startCondition: null } : t))
    );
  }, []);

  const toggleRule = useCallback((id: string) => {
    setAutomationRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
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
    setStrategy({ bodyMarkdown: input.strategyMarkdown, updatedAt: new Date().toLocaleDateString("vi-VN") });
  }, []);

  const value: KadStoreValue = {
    approvals,
    decideApproval,
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
