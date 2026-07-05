/**
 * Màn Trao đổi công việc (`/cong-viec/:id`) — spec/ui/05-man-trao-doi-cong-viec.md
 * + spec/ui/07-giao-viec-intake-report-card.md (delta: intake/brief/report).
 * "Việc này đang ở đâu, Trợ lý vận hành đang nói gì với tôi, và sản phẩm đâu?"
 *
 * Wired to the real Phase 1 backend (Claude-Code-Agent-Monitor server/routes/
 * kad/*) via the shared api-client.ts + ws-client.ts. No local script/timer
 * simulates the conversation — every message, approval, delegation, artifact
 * and report on screen comes from `GET /tasks/:id/timeline` + the task-scoped
 * WebSocket channel (`kad:task:<id>`). The Main Agent itself (a real Claude
 * turn) decides when to ask intake questions (spec 07 §2), propose a Brief
 * Card (§3), plan, delegate, and present a Report Card (§4) — this screen
 * only renders what already happened and posts the human's replies/decisions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  FileQuestion,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  Square,
} from "lucide-react";
import {
  kadApi,
  toApproval,
  toDelegation,
  toMessage,
  type ApprovalRow,
  type DelegationRow,
  type KadTask,
  type KadTimelineItem,
  type KadWorkflow,
  type MessageRow,
} from "../api-client";
import { onKadWsConnectionChange, subscribeKadScope, taskScope } from "../ws-client";
import { takePendingFiles } from "../pending-uploads";
import { usePeek } from "../components/PeekDrawer";
import { useKadToast } from "../components/Toast";
import { KadButton, KadEmptyState, KadTextarea } from "../components/primitives";
import { TaskComposer, type TaskComposerHandle } from "../components/TaskComposer";
import { TaskStatusChip, DelegationStatusChip, StatusChip } from "../components/StatusChip";
import { VerticalStepper } from "../components/Progress";
import { AgentAvatar } from "../components/Avatar";
import { ArtifactViewer } from "../components/ArtifactViewer";
import { MarkdownLite } from "../components/MarkdownLite";
import { ARTIFACT_TYPE_LABEL } from "../labels";
import {
  formatAbsoluteDateTime,
  formatDueDate,
  formatRelativeTime,
  formatTokens,
  formatVnd,
} from "../format";
import type {
  AgentProfile,
  BriefPayload,
  ProjectStepProgress,
  ReportPayload,
  TaskDelegation,
  TaskMessage,
} from "../types";

interface RouterFreshState {
  fresh?: boolean;
  description?: string;
  // [Phase 2c "Giao việc"] carried from CongViecMoi.tsx's composer — see the
  // fresh-flow create call below.
  workingDir?: string;
  workflowId?: string;
}

export function TraoDoiCongViec() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  if (!id) return null;
  const state = (location.state as RouterFreshState | null) ?? null;
  return (
    <TraoDoiCongViecInner
      key={id}
      routeId={id}
      fresh={Boolean(state?.fresh)}
      freshDescription={state?.description}
      freshWorkingDir={state?.workingDir}
      freshWorkflowId={state?.workflowId}
    />
  );
}

// ── Pane A stepper derivation ────────────────────────────────────────────
// Phase 1 does not persist per-step progress (`tasks.workflow_step` is never
// written by the orchestrator yet) — so a task with no workflow linked (the
// common path: conversational tasks created from a free-text description)
// gets a generic 4-stage lifecycle stepper derived from real signals (spec 07
// §1's own hero copy: mô tả → làm rõ → chốt brief → thực thi & báo cáo). A
// task that DOES have a workflow_id gets the real step list, with state
// inferred from matching delegations (agent_ref === delegation.toAgentId).

function genericLifecycleSteps(task: KadTask, hasBriefMessage: boolean): ProjectStepProgress[] {
  const briefDecided = Boolean(task.brief?.decidedAt);
  const failed = task.status === "failed";
  const s2state: ProjectStepProgress["state"] = hasBriefMessage || briefDecided ? "done" : "doing";
  const s3state: ProjectStepProgress["state"] = briefDecided
    ? "done"
    : hasBriefMessage
      ? "doing"
      : "todo";
  const s4state: ProjectStepProgress["state"] = failed
    ? "failed"
    : task.status === "done"
      ? "done"
      : briefDecided
        ? task.status === "waiting_human" || task.status === "review"
          ? "waiting_human"
          : "doing"
        : "todo";
  return [
    { key: "mo-ta", label: "Mô tả việc", state: "done" },
    { key: "lam-ro", label: "Trợ lý làm rõ", state: s2state },
    { key: "chot-brief", label: "Chốt brief", state: s3state },
    { key: "thuc-thi", label: "Thực thi & báo cáo", state: s4state },
  ];
}

function workflowSteps(
  workflow: KadWorkflow,
  delegations: TaskDelegation[]
): ProjectStepProgress[] {
  let seenActive = false;
  return workflow.steps.map((s) => {
    const deleg = s.agent_ref
      ? [...delegations].reverse().find((d) => d.toAgentId === s.agent_ref)
      : undefined;
    let state: ProjectStepProgress["state"];
    if (deleg) {
      state = deleg.status === "done" ? "done" : deleg.status === "failed" ? "failed" : "doing";
      if (deleg.status === "done" || deleg.status === "failed") seenActive = true;
    } else if (!seenActive) {
      state = "doing";
      seenActive = true;
    } else {
      state = "todo";
    }
    return { key: s.id, label: s.name, state, agentId: s.agent_ref };
  });
}

function TraoDoiCongViecInner({
  routeId,
  fresh,
  freshDescription,
  freshWorkingDir,
  freshWorkflowId,
}: {
  routeId: string;
  fresh: boolean;
  freshDescription?: string;
  freshWorkingDir?: string;
  freshWorkflowId?: string;
}) {
  const navigate = useNavigate();
  const { openPeek } = usePeek();
  const showToast = useKadToast();

  const [taskId, setTaskId] = useState<string | null>(fresh ? null : routeId);
  const [task, setTask] = useState<KadTask | null>(null);
  const [timeline, setTimeline] = useState<KadTimelineItem[]>([]);
  const [agentsById, setAgentsById] = useState<Map<string, AgentProfile>>(new Map());
  const [workflow, setWorkflow] = useState<KadWorkflow | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Real attachment ids (server-issued at upload time — see
  // handleDockedFilesSelected) alongside display names; id-keyed so a second
  // upload sharing a name with an earlier one stays independently removable.
  const [dockAttachments, setDockAttachments] = useState<{ id: string; file_name: string }[]>([]);
  const composerRef = useRef<TaskComposerHandle>(null);
  const initRef = useRef(false);

  const upsertTimelineItem = useCallback((item: KadTimelineItem) => {
    setTimeline((prev) => {
      const idOf = (x: KadTimelineItem) =>
        x.kind === "run" ? undefined : (x.data as { id: string }).id;
      const thisId = idOf(item);
      const next = thisId
        ? prev.filter((p) => !(p.kind === item.kind && idOf(p) === thisId))
        : prev.slice();
      next.push(item);
      next.sort((a, b) => a.at.localeCompare(b.at));
      return next;
    });
  }, []);

  // ── Load: create (fresh) or fetch (existing), subscribe WS, hydrate ──────
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let unsubscribe: (() => void) | null = null;
    let realIdKnown: string | null = null;

    // The WS connection can drop (laptop sleep, flaky wifi) and reconnect —
    // `subscribeKadScope` resubscribes the channel automatically, but any
    // event broadcast during the gap is gone for good (no server-side replay).
    // Re-fetch task + timeline once we regain connectivity so anything missed
    // (an agent run finishing, a message, a status flip) still shows up
    // instead of leaving the screen stuck on stale state. Skip the very first
    // "connected" firing — that's just the initial connect the load below
    // already covers, not a recovery.
    let sawFirstConnect = false;
    const unsubscribeConn = onKadWsConnectionChange((isConnected) => {
      if (!isConnected) return;
      if (!sawFirstConnect) {
        sawFirstConnect = true;
        return;
      }
      const id = realIdKnown;
      if (!id) return;
      kadApi.tasks
        .get(id)
        .then(setTask)
        .catch(() => {});
      kadApi.tasks
        .timeline(id)
        .then((timelineRows) => {
          setTimeline(timelineRows);
          const lastRun = [...timelineRows].reverse().find((t) => t.kind === "run");
          setIsRunning(!!lastRun && lastRun.kind === "run" && lastRun.data.status === "running");
        })
        .catch(() => {});
    });

    (async () => {
      let realId = routeId;
      try {
        if (fresh) {
          const description = freshDescription ?? "";
          const created = await kadApi.tasks.create({
            title: description,
            working_dir: freshWorkingDir,
            workflow_id: freshWorkflowId,
          });
          realId = created.id;
          realIdKnown = realId;
          unsubscribe = subscribeKadScope(taskScope(realId), (ev) => handleWsEvent(ev));
          // Real File objects from CongViecMoi.tsx's composer, handed off via
          // pending-uploads.ts (no task_id existed yet when they were picked).
          // Names for the text mention + chip metadata come from what the
          // upload actually returned, not from intent — if it fails, neither
          // is populated instead of claiming a file made it that didn't.
          const pendingFiles = takePendingFiles(routeId);
          let uploadedNames: string[] = [];
          if (pendingFiles.length) {
            try {
              const uploaded = await kadApi.attachments.upload(realId, pendingFiles);
              uploadedNames = uploaded.map((u) => u.file_name);
            } catch (e) {
              showToast({
                message: e instanceof Error ? e.message : "Không thể tải file đính kèm lên.",
                tone: "warning",
              });
            }
          }
          // Kept as plain text too (not metadata-only): orchestrator.js's
          // startTaskTurn/resumeTaskTurn read the Main Agent's prompt straight
          // off `content`, not message metadata — the agent needs to see this
          // mention to know a file exists at all. Metadata is only for the
          // human-facing chip (TimelineItemRenderer).
          let content = description;
          if (uploadedNames.length) {
            content += `\n\n📎 Đính kèm: ${uploadedNames.join(", ")}`;
          }
          await kadApi.tasks.sendMessage(
            realId,
            content,
            uploadedNames.length ? uploadedNames : undefined
          );
          setTaskId(realId);
          navigate(`/cong-viec/${realId}`, { replace: true });
        } else {
          realIdKnown = realId;
          unsubscribe = subscribeKadScope(taskScope(realId), (ev) => handleWsEvent(ev));
        }

        const [taskRow, timelineRows, agentRows] = await Promise.all([
          kadApi.tasks.get(realId),
          kadApi.tasks.timeline(realId),
          kadApi.agents.list(),
        ]);
        setTask(taskRow);
        setTimeline(timelineRows);
        setAgentsById(new Map(agentRows.map((a) => [a.id, a])));
        const lastRun = [...timelineRows].reverse().find((t) => t.kind === "run");
        setIsRunning(!!lastRun && lastRun.kind === "run" && lastRun.data.status === "running");
        if (taskRow.workflowId) {
          kadApi.workflows
            .get(taskRow.workflowId)
            .then(setWorkflow)
            .catch(() => setWorkflow(null));
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();

    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    function handleWsEvent(ev: { type: string; data: Record<string, unknown> }) {
      switch (ev.type) {
        case "kad.message.created":
        case "kad.message.updated": {
          const msg = toMessage(ev.data as unknown as MessageRow);
          upsertTimelineItem({ kind: "message", at: msg.createdAt, data: msg });
          break;
        }
        case "kad.approval.created":
        case "kad.approval.decided": {
          const appr = toApproval(ev.data as unknown as ApprovalRow);
          upsertTimelineItem({ kind: "approval", at: appr.createdAt, data: appr });
          break;
        }
        case "kad.delegation.status": {
          const deleg = toDelegation(ev.data as unknown as DelegationRow);
          upsertTimelineItem({ kind: "delegation", at: deleg.createdAt, data: deleg });
          break;
        }
        case "kad.artifact.created":
          if (typeof ev.data.artifact_id === "string") {
            const artifactId = ev.data.artifact_id;
            kadApi.artifacts
              .get(artifactId)
              .then((a) => {
                upsertTimelineItem({ kind: "artifact", at: a.createdAt, data: a });
                setSelectedArtifactId((cur) => cur ?? artifactId);
              })
              .catch((e) =>
                console.warn(`[kad] failed to load artifact ${artifactId}:`, e && e.message)
              );
          }
          break;
        case "kad.run.status":
          setIsRunning(ev.data.status === "running");
          break;
        case "kad.task.status":
          setTask((prev) =>
            prev ? { ...prev, status: ev.data.status as KadTask["status"] } : prev
          );
          break;
        default:
          break;
      }
    }

    return () => {
      unsubscribe?.();
      unsubscribeConn();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default pane C selection to the newest artifact once one exists.
  useEffect(() => {
    if (selectedArtifactId) return;
    const arts = timeline.filter(
      (t): t is Extract<KadTimelineItem, { kind: "artifact" }> => t.kind === "artifact"
    );
    if (arts.length)
      setSelectedArtifactId([...arts].sort((a, b) => b.data.version - a.data.version)[0]!.data.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  useEffect(() => {
    return () => composerRef.current?.focus && undefined;
  }, []);

  if (loading) {
    return (
      <div className="pt-16">
        <KadEmptyState icon={FileQuestion} message="Đang tải công việc…" />
      </div>
    );
  }
  if (notFound || !task || !taskId) {
    return (
      <div className="pt-16">
        <KadEmptyState
          icon={FileQuestion}
          message="Không tìm thấy công việc này."
          action={
            <KadButton variant="secondary" onClick={() => navigate("/he-thong/kanban")}>
              Về Công việc
            </KadButton>
          }
        />
      </div>
    );
  }

  const messages = timeline.filter(
    (t): t is Extract<KadTimelineItem, { kind: "message" }> => t.kind === "message"
  );
  // spec 05 §2 "Câu đã trả lời → chips ẩn, giữ text" — an intake question is
  // answered once the human sends any later chat message (chip click or free
  // text both just call sendMessage; there is no separate "answer" concept in
  // the real data model).
  const humanChatTimes = messages
    .filter((m) => m.data.senderType === "human" && m.data.messageType === "chat")
    .map((m) => m.data.createdAt);
  const answeredIntakeIds = new Set(
    messages
      .filter(
        (m) =>
          m.data.messageType === "intake_question" &&
          humanChatTimes.some((t) => t > m.data.createdAt)
      )
      .map((m) => m.data.id)
  );
  const briefMessages = messages.filter((m) => m.data.messageType === "brief");
  const pinnedBrief: BriefPayload | null = briefMessages.length
    ? (briefMessages[briefMessages.length - 1]!.data.metadata?.brief ?? null)
    : null;
  const taskArtifacts = timeline
    .filter((t): t is Extract<KadTimelineItem, { kind: "artifact" }> => t.kind === "artifact")
    .map((t) => t.data)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const activeDelegation = [...timeline]
    .reverse()
    .find(
      (t): t is Extract<KadTimelineItem, { kind: "delegation" }> =>
        t.kind === "delegation" && ["pending", "running"].includes(t.data.status)
    );
  const reportCost = messages.reduce(
    (acc, m) => {
      const r = m.data.messageType === "report" ? m.data.metadata?.report : undefined;
      if (!r?.costRaw) return acc;
      return { tokens: acc.tokens + r.costRaw.tokens, vnd: acc.vnd + r.costRaw.vnd };
    },
    { tokens: 0, vnd: 0 }
  );
  const steps = workflow
    ? workflowSteps(
        workflow,
        timeline
          .filter(
            (t): t is Extract<KadTimelineItem, { kind: "delegation" }> => t.kind === "delegation"
          )
          .map((t) => t.data)
      )
    : genericLifecycleSteps(task, briefMessages.length > 0);

  const agentLabel = (id: string) => agentsById.get(id)?.displayName ?? id;
  const avatarProps = (id: string) => ({
    displayNameOverride: agentsById.get(id)?.displayName,
    agentNameOverride: agentsById.get(id)?.name,
  });

  // ── Actions (each is one real API call — no local script) ───────────────
  // Every mutating call is wrapped so a failed request surfaces as a toast
  // instead of a silent unhandled rejection (composer/cards optimistically
  // rely on the WS echo to update state, so there's nothing else to roll back).
  /** Returns whether `fn` succeeded so callers can roll back optimistic state
   * on failure instead of assuming the request landed. */
  async function runAction(fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Có lỗi xảy ra, thử lại.",
        tone: "warning",
      });
      return false;
    }
  }

  async function handleAnswerIntake(answer: string) {
    await runAction(() => kadApi.tasks.sendMessage(taskId!, answer));
  }

  async function handleLockBrief() {
    await runAction(() => kadApi.tasks.lockBrief(taskId!));
  }

  function handleEditBrief() {
    composerRef.current?.focus();
  }

  async function handleApproveReport(messageId: string) {
    await runAction(() => kadApi.tasks.decideReport(taskId!, messageId, "approved"));
  }

  async function handleRequestChangesReport(messageId: string, reason: string) {
    await runAction(() => kadApi.tasks.decideReport(taskId!, messageId, "needs_changes", reason));
  }

  async function handleDecideApproval(
    approvalId: string,
    decision: "approved" | "needs_changes" | "rejected",
    reason: string | null
  ) {
    await runAction(() => kadApi.approvals.decide(approvalId, decision, reason));
  }

  async function handleDockedSend() {
    const text = draft.trim();
    const attachmentsSnapshot = dockAttachments;
    const names = attachmentsSnapshot.map((a) => a.file_name);
    if (!text && names.length === 0) return;
    setDraft("");
    setDockAttachments([]);
    // Text mention for the agent's prompt (orchestrator.js reads `content`,
    // not metadata) + metadata for the human-facing chip — see the fresh-flow
    // effect above for the same dual-write and why both are needed.
    const content = names.length ? `${text || "(gửi tài liệu)"}\n\n📎 ${names.join(", ")}` : text;
    const ok = await runAction(() =>
      kadApi.tasks.sendMessage(taskId!, content, names.length ? names : undefined)
    );
    // The files were already durably uploaded (handleDockedFilesSelected) —
    // only the message send failed, so restore the draft/attachments instead
    // of silently discarding what the human typed and dropping the reference
    // to attachments that are still sitting on the server.
    if (!ok) {
      setDraft(text);
      setDockAttachments(attachmentsSnapshot);
    }
  }

  async function handleDockedFilesSelected(files: File[]) {
    if (!taskId) return;
    try {
      const uploaded = await kadApi.attachments.upload(taskId, files);
      setDockAttachments((prev) => [
        ...prev,
        ...uploaded.map((u) => ({ id: u.id, file_name: u.file_name })),
      ]);
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Không thể tải file lên.",
        tone: "warning",
      });
    }
  }

  async function handleRemoveDockAttachment(id: string) {
    setDockAttachments((prev) => prev.filter((a) => a.id !== id));
    try {
      await kadApi.attachments.remove(id);
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Không thể gỡ file.",
        tone: "warning",
      });
    }
  }

  async function stopAndSteer() {
    // Only clear the "đang viết" state once the cancel actually landed — the
    // agent run is still live server-side on failure, and `kad.run.status`
    // will re-confirm that over WS; flipping optimistically here would let
    // the human send new instructions while the original run keeps going.
    const ok = await runAction(() => kadApi.tasks.cancelRun(taskId!));
    if (ok) setIsRunning(false);
    composerRef.current?.focus();
  }

  async function openDelegationTrace(delegation: TaskDelegation) {
    if (!delegation.runId) return;
    const run = await kadApi.runs.get(delegation.runId).catch(() => null);
    if (run?.monitor_session_id)
      window.open(`/he-thong/sessions/${run.monitor_session_id}`, "_blank");
  }

  const suggestedChips = ["Tình trạng?", "Xem học liệu mới nhất"];

  return (
    <div className="flex h-[calc(100vh-56px-48px)] -mx-6 -my-6 min-w-0 overflow-x-auto">
      {/* Pane A */}
      <aside className="w-[220px] xl:w-[260px] flex-shrink-0 border-r border-kad-border overflow-y-auto p-4">
        <button
          type="button"
          onClick={() => navigate("/he-thong/kanban")}
          className="kad-caption text-kad-text-muted hover:text-kad-text flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Công việc
        </button>
        <h1 className="kad-title text-kad-text-strong">{task.title}</h1>
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <TaskStatusChip status={task.status} />
        </div>

        {pinnedBrief && (
          <div className="border border-kad-border rounded-xl bg-kad-surface p-3 mt-4">
            <p className="kad-label text-kad-text-strong mb-1">
              {pinnedBrief.decidedAt ? "Brief đã chốt" : "Brief — chờ chốt"}
            </p>
            <p className="kad-caption text-kad-text-muted">{pinnedBrief.goal}</p>
          </div>
        )}

        {steps.length > 0 && (
          <>
            <p className="kad-overline text-kad-text-faint mt-5 mb-2">Tiến trình</p>
            <VerticalStepper steps={steps} />
          </>
        )}

        {activeDelegation && (
          <div className="mt-2">
            <p className="kad-overline text-kad-text-faint mb-2">Delegation đang chạy</p>
            <button
              type="button"
              onClick={() => openDelegationTrace(activeDelegation.data)}
              className="w-full text-left border border-kad-border rounded-lg p-2.5 hover:bg-kad-surface-2"
            >
              <div className="flex items-center gap-1.5">
                <AgentAvatar
                  agentId={activeDelegation.data.toAgentId}
                  size={20}
                  {...avatarProps(activeDelegation.data.toAgentId)}
                />
                <span className="kad-caption text-kad-text truncate flex-1">
                  {agentLabel(activeDelegation.data.toAgentId)}
                </span>
                <ExternalLink className="w-3 h-3 text-kad-text-faint flex-shrink-0" />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <DelegationStatusChip status={activeDelegation.data.status} />
                {activeDelegation.data.retryCount > 0 && (
                  <span className="kad-caption text-kad-warning">
                    retry {activeDelegation.data.retryCount}
                  </span>
                )}
              </div>
            </button>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-kad-border space-y-1.5">
          {task.dueDate && (
            <p className="kad-caption text-kad-text-muted">Hạn: {formatDueDate(task.dueDate)}</p>
          )}
          <p className="kad-caption text-kad-text-muted">Ưu tiên: {task.priority}</p>
          <p className="kad-caption text-kad-text-muted">
            Tạo lúc: {formatAbsoluteDateTime(task.createdAt)}
          </p>
          {task.workingDir && (
            <p className="kad-caption text-kad-text-muted">Thư mục: {task.workingDir}</p>
          )}
          <p className="kad-caption text-kad-text-muted">
            Chi phí đến nay: {formatTokens(reportCost.tokens)} · ~{formatVnd(reportCost.vnd)}
          </p>
        </div>
      </aside>

      {/* Pane B */}
      <main className="flex-1 min-w-[280px] flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {timeline.map((item) => (
            <TimelineItemRenderer
              key={`${item.kind}-${item.kind === "run" ? item.data.id : (item.data as { id: string }).id}`}
              item={item}
              agentLabel={agentLabel}
              avatarProps={avatarProps}
              intakeAnswered={item.kind === "message" && answeredIntakeIds.has(item.data.id)}
              onOpenPeek={openPeek}
              onOpenArtifactInPanel={setSelectedArtifactId}
              onAnswerIntake={handleAnswerIntake}
              onLockBrief={handleLockBrief}
              onEditBrief={handleEditBrief}
              onApproveReport={handleApproveReport}
              onRequestChangesReport={handleRequestChangesReport}
              onDecideApproval={handleDecideApproval}
              onOpenDelegationTrace={openDelegationTrace}
            />
          ))}
        </div>
        <div className="flex-shrink-0 border-t border-kad-border p-3">
          {isRunning ? (
            <div className="flex items-center justify-between bg-kad-surface-2 rounded-lg px-3 py-2.5">
              <span className="kad-body text-kad-text-muted">Trợ lý đang viết…</span>
              <KadButton variant="secondary" size="row" icon={Square} onClick={stopAndSteer}>
                Dừng & bổ sung chỉ đạo
              </KadButton>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                {suggestedChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setDraft(chip)}
                    className="kad-caption text-kad-text-muted border border-kad-border rounded-full px-2 py-0.5 hover:bg-kad-surface-2"
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <TaskComposer
                ref={composerRef}
                size="compact"
                value={draft}
                onChange={setDraft}
                onSubmit={handleDockedSend}
                placeholder="Nhắn cho Trợ lý vận hành…  (⌘Enter để gửi)"
                attachments={dockAttachments.map((a) => ({ id: a.id, name: a.file_name }))}
                onFilesSelected={handleDockedFilesSelected}
                onRemoveAttachment={handleRemoveDockAttachment}
              />
            </>
          )}
        </div>
      </main>

      {/* Pane C */}
      {panelOpen ? (
        <aside className="w-[300px] xl:w-[360px] flex-shrink-0 border-l border-kad-border overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="kad-heading text-kad-text-strong">Học liệu</h3>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Đóng panel"
              className="text-kad-text-muted hover:text-kad-text"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
          {taskArtifacts.length > 1 && (
            <div className="flex items-center gap-1 border border-kad-border rounded-lg p-0.5 mb-3 w-fit">
              {taskArtifacts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedArtifactId(a.id)}
                  className={`kad-caption px-2 py-1 rounded-md ${
                    a.id === selectedArtifactId
                      ? "bg-kad-surface-2 text-kad-text-strong font-medium"
                      : "text-kad-text-muted"
                  }`}
                >
                  {ARTIFACT_TYPE_LABEL[a.artifactType]} v{a.version}
                </button>
              ))}
            </div>
          )}
          {selectedArtifactId ? (
            (() => {
              const selected = taskArtifacts.find((a) => a.id === selectedArtifactId);
              const versions = selected
                ? taskArtifacts.filter((a) => a.artifactType === selected.artifactType)
                : [];
              return (
                <ArtifactViewer
                  artifactId={selectedArtifactId}
                  artifact={selected}
                  versions={versions}
                />
              );
            })()
          ) : (
            <KadEmptyState icon={FileQuestion} message="Chưa có học liệu cho công việc này." />
          )}
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          aria-label="Mở panel học liệu"
          title="Mở panel học liệu"
          className="w-9 flex-shrink-0 border-l border-kad-border flex items-start justify-center pt-4 text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// ── Timeline item renderer — real kinds: message / delegation / approval /
// artifact (run is not rendered directly, only drives isRunning upstream) ──

function TimelineItemRenderer({
  item,
  agentLabel,
  avatarProps,
  intakeAnswered,
  onOpenPeek,
  onOpenArtifactInPanel,
  onAnswerIntake,
  onLockBrief,
  onEditBrief,
  onApproveReport,
  onRequestChangesReport,
  onDecideApproval,
  onOpenDelegationTrace,
}: {
  item: KadTimelineItem;
  agentLabel: (id: string) => string;
  avatarProps: (id: string) => { displayNameOverride?: string; agentNameOverride?: string };
  intakeAnswered: boolean;
  onOpenPeek: (t: { type: "artifact" | "approval"; id: string }) => void;
  onOpenArtifactInPanel: (id: string) => void;
  onAnswerIntake: (answer: string) => void;
  onLockBrief: () => void;
  onEditBrief: () => void;
  onApproveReport: (messageId: string) => void;
  onRequestChangesReport: (messageId: string, reason: string) => void;
  onDecideApproval: (
    approvalId: string,
    decision: "approved" | "needs_changes" | "rejected",
    reason: string | null
  ) => void;
  onOpenDelegationTrace: (delegation: TaskDelegation) => void;
}) {
  if (item.kind === "run") return null;

  if (item.kind === "approval") {
    const a = item.data;
    return (
      <InlineApprovalCard
        title={a.title}
        status={a.status}
        decisionReason={a.decisionReason}
        onApprove={() => onDecideApproval(a.id, "approved", null)}
        onNeedsChanges={(reason) => onDecideApproval(a.id, "needs_changes", reason)}
        onReject={(reason) => onDecideApproval(a.id, "rejected", reason)}
      />
    );
  }

  if (item.kind === "delegation") {
    const d = item.data;
    return (
      <button
        type="button"
        onClick={() => onOpenDelegationTrace(d)}
        className="border border-kad-border rounded-lg p-3 max-w-[85%] text-left hover:bg-kad-surface-2"
      >
        <div className="flex items-center gap-1.5">
          <AgentAvatar agentId={d.toAgentId} size={20} {...avatarProps(d.toAgentId)} />
          <span className="kad-label text-kad-text-strong flex-1 truncate">
            {agentLabel(d.toAgentId)}
          </span>
          <DelegationStatusChip status={d.status} />
        </div>
        <p className="kad-caption text-kad-text-muted mt-1.5">{d.instruction}</p>
        {d.retryCount > 0 && (
          <p className="kad-caption text-kad-warning mt-0.5">retry {d.retryCount}</p>
        )}
      </button>
    );
  }

  if (item.kind === "artifact") {
    const artifact = item.data;
    return (
      <div className="border border-kad-border rounded-lg p-3 max-w-[85%] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="kad-caption text-kad-text-faint">
            {ARTIFACT_TYPE_LABEL[artifact.artifactType]}
          </p>
          <p className="kad-body text-kad-text truncate">
            {artifact.title} · v{artifact.version}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <KadButton variant="ghost" size="row" onClick={() => onOpenArtifactInPanel(artifact.id)}>
            Xem ở panel
          </KadButton>
          <KadButton
            variant="ghost"
            size="row"
            icon={Eye}
            onClick={() => onOpenPeek({ type: "artifact", id: artifact.id })}
          />
        </div>
      </div>
    );
  }

  // item.kind === "message"
  const message = item.data;

  if (message.messageType === "chat") {
    const isHuman = message.senderType === "human";
    const attachmentNames = message.metadata?.attachmentNames;
    return (
      <div className={`flex ${isHuman ? "justify-end" : ""}`}>
        <div
          className={`max-w-[85%] rounded-lg border border-kad-border px-3.5 py-2.5 ${isHuman ? "bg-kad-surface-2" : "bg-kad-surface"}`}
        >
          {!isHuman && (
            <div className="flex items-center gap-1.5 mb-1">
              <AgentAvatar
                agentId={message.senderId}
                size={20}
                {...avatarProps(message.senderId)}
              />
              <span className="kad-label text-kad-text-strong">{agentLabel(message.senderId)}</span>
            </div>
          )}
          <MarkdownLite content={message.content} />
          {attachmentNames && attachmentNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {attachmentNames.map((name) => (
                <span
                  key={name}
                  className="kad-caption inline-flex items-center gap-1 h-6 px-2 rounded-md bg-kad-surface text-kad-text-muted border border-kad-border"
                >
                  <FileText className="w-3 h-3" />
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (message.messageType === "intake_question") {
    return (
      <IntakeQuestionBlock
        message={message}
        agentLabel={agentLabel}
        avatarProps={avatarProps}
        answered={intakeAnswered}
        onAnswer={onAnswerIntake}
      />
    );
  }

  if (message.messageType === "brief" && message.metadata?.brief) {
    return (
      <BriefCardBlock brief={message.metadata.brief} onLock={onLockBrief} onEdit={onEditBrief} />
    );
  }

  if (message.messageType === "report" && message.metadata?.report) {
    return (
      <ReportCardBlock
        report={message.metadata.report}
        onApprove={() => onApproveReport(message.id)}
        onRequestChanges={(reason) => onRequestChangesReport(message.id, reason)}
        onOpenArtifact={onOpenArtifactInPanel}
      />
    );
  }

  if (message.messageType === "status") {
    return (
      <p className="kad-caption text-kad-text-faint text-center">
        {message.content} · {formatRelativeTime(message.createdAt)}
      </p>
    );
  }

  if (message.messageType === "escalation") {
    return (
      <div className="border-l-2 border-kad-danger bg-kad-surface border border-kad-border rounded-lg p-3 max-w-[85%]">
        <p className="kad-body text-kad-text">{message.content}</p>
        {message.metadata?.suggestedActions && (
          <div className="flex gap-1.5 mt-2">
            {message.metadata.suggestedActions.map((label) => (
              <span
                key={label}
                className="kad-caption border border-kad-border rounded-full px-2 py-0.5 text-kad-text-muted"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ── intake_question (spec 07 §2) ────────────────────────────────────────────

function IntakeQuestionBlock({
  message,
  agentLabel,
  avatarProps,
  answered,
  onAnswer,
}: {
  message: TaskMessage;
  agentLabel: (id: string) => string;
  avatarProps: (id: string) => { displayNameOverride?: string; agentNameOverride?: string };
  answered: boolean;
  onAnswer: (answer: string) => void;
}) {
  // spec 05 §2: "Câu đã trả lời → chips ẩn, giữ text".
  const options = answered ? undefined : message.metadata?.options;
  return (
    <div className="flex" data-testid="intake-question">
      <div className="max-w-[85%] rounded-lg border border-kad-border bg-kad-surface px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <AgentAvatar agentId={message.senderId} size={20} {...avatarProps(message.senderId)} />
          <span className="kad-label text-kad-text-strong">{agentLabel(message.senderId)}</span>
        </div>
        <p className="kad-body text-kad-text">{message.content}</p>
        {options && options.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                data-testid="intake-option"
                onClick={() => onAnswer(opt)}
                className="kad-label h-7 px-3 rounded-full border border-kad-border-strong text-kad-text bg-kad-surface hover:bg-kad-surface-2 transition-colors"
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Brief Card (spec 07 §3) ──────────────────────────────────────────────

function BriefRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-3 py-1 kad-body">
      <span className="w-24 flex-none text-kad-text-muted">{k}</span>
      <span className="text-kad-text">{v}</span>
    </div>
  );
}

function BriefCardBlock({
  brief,
  onLock,
  onEdit,
}: {
  brief: BriefPayload;
  onLock: () => void;
  onEdit: () => void;
}) {
  const decided = Boolean(brief.decidedAt);
  return (
    <div className="border border-kad-border rounded-xl bg-kad-surface max-w-[560px] overflow-hidden">
      <div className="px-4 py-3 border-b border-kad-border">
        <p className="kad-label text-kad-text-strong">Brief — chờ anh chốt</p>
      </div>
      <div className="px-4 py-3.5">
        <BriefRow k="Mục tiêu" v={brief.goal} />
        <BriefRow k="Deliverable" v={brief.deliverable} />
        <BriefRow k="Loại việc" v={<StatusChip kind="doing" label={brief.workflowName} />} />
        <BriefRow
          k="Thư mục"
          v={`${brief.workingDir ?? "—"}${brief.attachmentCount ? ` · ${brief.attachmentCount} file đính kèm` : ""}`}
        />
        <BriefRow k="Hạn" v={brief.dueLabel} />
        {brief.frameworkLabel && <BriefRow k="Khung" v={brief.frameworkLabel} />}
        {brief.assumption && (
          <div className="mt-2 rounded-lg bg-[#fbf3e4] text-[#b97d10] px-2.5 py-2 kad-caption">
            ⚠ Giả định: {brief.assumption}
          </div>
        )}
      </div>
      {decided ? (
        <div className="px-4 py-2.5 border-t border-kad-border kad-caption text-kad-text-muted">
          Đã chốt · {formatAbsoluteDateTime(brief.decidedAt!)}
        </div>
      ) : (
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-kad-border">
          <KadButton variant="secondary" size="row" onClick={onEdit}>
            Sửa brief
          </KadButton>
          <KadButton variant="primary" size="row" data-testid="brief-lock" onClick={onLock}>
            Chốt & giao ▸
          </KadButton>
        </div>
      )}
    </div>
  );
}

// ── Report Card (spec 07 §4) ─────────────────────────────────────────────

function ReportCardBlock({
  report,
  onApprove,
  onRequestChanges,
  onOpenArtifact,
}: {
  report: ReportPayload;
  onApprove: () => void;
  onRequestChanges: (reason: string) => void;
  onOpenArtifact: (id: string) => void;
}) {
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const decided = Boolean(report.decision);

  return (
    <div className="border border-kad-border rounded-xl bg-kad-surface max-w-[560px] overflow-hidden">
      <div className="px-4 py-3 border-b border-kad-border">
        <p className="kad-label text-kad-text-strong">
          Báo cáo kết quả{report.version > 1 ? ` · v${report.version}` : ""}
        </p>
      </div>
      <div className="px-4 py-3.5 space-y-3">
        <div>
          <p className="kad-caption font-semibold text-kad-success mb-1">✓ Kết quả chính</p>
          <p className="kad-body text-kad-text">{report.summary}</p>
        </div>
        <div>
          <p className="kad-caption font-semibold text-kad-text-muted mb-1">Deliverables</p>
          <div className="flex flex-wrap gap-1.5">
            {report.artifacts.map((a) => (
              <button key={a.artifactId} type="button" onClick={() => onOpenArtifact(a.artifactId)}>
                <StatusChip kind="doing" label={`${a.title} →`} />
              </button>
            ))}
          </div>
        </div>
        {report.needsDecision && report.needsDecision.length > 0 && (
          <div>
            <p className="kad-caption font-semibold text-kad-warning mb-1">⚠ Cần anh quyết</p>
            <div className="space-y-0.5">
              {report.needsDecision.map((line) => (
                <p key={line} className="kad-body text-kad-text pl-3 relative">
                  <span className="absolute left-0 text-kad-text-faint">•</span>
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}
        {report.blocker && (
          <div>
            <p className="kad-caption font-semibold text-kad-danger mb-1">⛔ Blocker</p>
            <p className="kad-body text-kad-text">{report.blocker}</p>
          </div>
        )}
      </div>
      <div className="px-4 pt-2.5 pb-1 border-t border-kad-border kad-caption text-kad-text-faint">
        {report.cost.duration} · {report.cost.tokens} · {report.cost.vnd} · {report.cost.agentName}
      </div>
      {decided ? (
        <div className="px-4 py-2.5 kad-caption text-kad-text-muted">
          {report.decision!.status === "approved" ? "Đã duyệt" : "Yêu cầu sửa"} ·{" "}
          {formatAbsoluteDateTime(report.decision!.at)}
          {report.decision!.reason ? ` — ${report.decision!.reason}` : ""}
        </div>
      ) : showReason ? (
        <div className="px-4 pb-3.5 pt-2 space-y-2">
          <KadTextarea
            autoFocus
            placeholder="Lý do / điểm cần sửa…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex justify-end">
            <KadButton
              variant="primary"
              size="row"
              disabled={reason.trim().length === 0}
              onClick={() => onRequestChanges(reason.trim())}
            >
              Gửi yêu cầu sửa
            </KadButton>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2 px-4 py-3">
          <KadButton variant="danger" size="row" onClick={() => setShowReason(true)}>
            Yêu cầu sửa
          </KadButton>
          <KadButton variant="primary" size="row" data-testid="report-approve" onClick={onApprove}>
            Duyệt tất cả
          </KadButton>
        </div>
      )}
    </div>
  );
}

// ── approval_request (không đổi so với 05) ───────────────────────────────

function InlineApprovalCard({
  title,
  status,
  decisionReason,
  onApprove,
  onNeedsChanges,
  onReject,
}: {
  title: string;
  status: string;
  decisionReason: string | null;
  onApprove: () => void;
  onNeedsChanges: (reason: string) => void;
  onReject: (reason: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "needs_changes" | "rejected">("idle");
  const [reason, setReason] = useState("");

  return (
    <div className="border border-kad-border rounded-lg p-3.5 max-w-[85%] bg-kad-surface">
      <p className="kad-overline text-kad-text-faint mb-1">Yêu cầu phê duyệt</p>
      <p className="kad-body text-kad-text-strong font-medium">{title}</p>
      {status !== "pending" ? (
        <p className="kad-caption text-kad-text-muted mt-2">
          Đã quyết định: <span className="font-medium text-kad-text-strong">{status}</span>
          {decisionReason ? ` — ${decisionReason}` : ""}
        </p>
      ) : mode === "idle" ? (
        <div className="flex items-center gap-2 mt-2.5">
          <KadButton
            variant="primary"
            size="row"
            data-testid="approval-approve"
            onClick={onApprove}
          >
            Duyệt
          </KadButton>
          <KadButton variant="secondary" size="row" onClick={() => setMode("needs_changes")}>
            Yêu cầu sửa
          </KadButton>
          <KadButton variant="danger" size="row" onClick={() => setMode("rejected")}>
            Từ chối
          </KadButton>
        </div>
      ) : (
        <div className="mt-2.5 space-y-2">
          <KadTextarea
            autoFocus
            placeholder={
              mode === "rejected" ? "Lý do từ chối (bắt buộc)…" : "Cần sửa gì (bắt buộc)…"
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <KadButton
              variant={mode === "rejected" ? "danger" : "primary"}
              size="row"
              disabled={reason.trim().length === 0}
              onClick={() =>
                mode === "rejected" ? onReject(reason.trim()) : onNeedsChanges(reason.trim())
              }
            >
              Gửi
            </KadButton>
            <KadButton variant="ghost" size="row" onClick={() => setMode("idle")}>
              Hủy
            </KadButton>
          </div>
        </div>
      )}
    </div>
  );
}
