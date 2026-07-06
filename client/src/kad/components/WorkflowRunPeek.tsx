/**
 * Peek drawer body for a workflow run (Kanban "Workflow" tab card click).
 * Sections follow the kad-drawer-chi-tiet mockup: Context → Workflow → Steps
 * → Approval → Artifacts & Logs. Two real sources share this drawer:
 *   - "kadtask:<id>"  — KAD workflow-bound task (steps from the workflow
 *     definition catalog, current step from tasks.workflow_step).
 *   - "ccrun:<runId>" — Claude Code Workflow-tool run (phases + inner agents
 *     from the ingested run journal).
 * All data fetched live; no mock fallback — missing pieces render as "—".
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Bot, FileText, Loader2 } from "lucide-react";
import type { PeekTarget } from "./PeekDrawer";
import { kadApi } from "../api-client";
import type { KadTask, KadWorkflow } from "../api-client";
import { api } from "../../lib/api";
import type { Agent, WorkflowRun } from "../../lib/types";
import { mapKadTaskStatus, mapCcRunStatus, progressEntryTitle } from "../../lib/workflow-board";
import type { WorkflowBoardStatus } from "../../lib/workflow-board";
import { timeAgo } from "../../lib/format";

// ── Shared bits ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<WorkflowBoardStatus, string> = {
  queued: "Chờ chạy",
  running: "Đang chạy",
  waiting_approval: "Chờ duyệt",
  blocked: "Bị chặn",
  done: "Hoàn tất",
};

const STATUS_CHIP: Record<WorkflowBoardStatus, string> = {
  queued: "text-kad-text-muted bg-kad-surface-2 border-kad-border",
  running: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  waiting_approval: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  blocked: "text-red-400 bg-red-500/10 border-red-500/20",
  done: "text-sky-400 bg-sky-500/10 border-sky-500/20",
};

function StatusChip({ status }: { status: WorkflowBoardStatus }) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium border rounded-full px-2 py-0.5 ${STATUS_CHIP[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3 border-b border-kad-border last:border-b-0">
      <h3 className="kad-overline text-kad-text-faint mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1 text-sm min-w-0">
      <span className="kad-caption text-kad-text-muted w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-kad-text min-w-0 flex-1 break-words">{children ?? "—"}</span>
    </div>
  );
}

type StepState = "pending" | "running" | "waiting_approval" | "done" | "blocked";

const STEP_DOT: Record<StepState, string> = {
  pending: "bg-kad-border",
  running: "bg-emerald-400 animate-pulse-dot",
  waiting_approval: "bg-yellow-400",
  blocked: "bg-red-400",
  done: "bg-sky-400",
};

function StepRow({
  name,
  state,
  detail,
  requiresApproval,
}: {
  name: string;
  state: StepState;
  detail?: string | null;
  requiresApproval?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${STEP_DOT[state]}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-kad-text flex items-center gap-2 min-w-0">
          <span className="truncate">{name}</span>
          {requiresApproval && (
            <span className="text-[10px] text-yellow-400 border border-yellow-500/20 bg-yellow-500/10 rounded px-1 flex-shrink-0">
              cần duyệt
            </span>
          )}
        </p>
        {detail && <p className="kad-caption text-kad-text-muted truncate">{detail}</p>}
      </div>
      <span className="kad-caption text-kad-text-faint flex-shrink-0 pt-0.5">
        {STATUS_LABEL[state === "pending" ? "queued" : (state as WorkflowBoardStatus)] ??
          STATUS_LABEL.queued}
      </span>
    </div>
  );
}

// ── Entry ──────────────────────────────────────────────────────────────────

export function WorkflowRunPeek({
  id,
  onOpenPeek,
}: {
  id: string;
  onOpenPeek: (t: PeekTarget) => void;
}) {
  if (id.startsWith("ccrun:")) return <CcRunPeek runId={id.slice("ccrun:".length)} />;
  if (id.startsWith("kadtask:"))
    return <KadTaskRunPeek taskId={id.slice("kadtask:".length)} onOpenPeek={onOpenPeek} />;
  return <PeekError message="Không nhận diện được workflow run." />;
}

function PeekError({ message }: { message: string }) {
  return (
    <div className="p-6 flex items-center gap-2 text-sm text-kad-text-muted">
      <AlertCircle className="w-4 h-4 flex-shrink-0" /> {message}
    </div>
  );
}

function PeekLoading() {
  return (
    <div className="p-6 flex items-center gap-2 text-sm text-kad-text-muted">
      <Loader2 className="w-4 h-4 animate-spin" /> Đang tải…
    </div>
  );
}

// ── KAD workflow-bound task ────────────────────────────────────────────────

function kadStepState(
  idx: number,
  currentIdx: number,
  boardStatus: WorkflowBoardStatus
): StepState {
  if (currentIdx < 0) return "pending";
  if (idx < currentIdx) return "done";
  if (idx > currentIdx) return "pending";
  // current step inherits the task's live state
  if (boardStatus === "waiting_approval") return "waiting_approval";
  if (boardStatus === "blocked") return "blocked";
  if (boardStatus === "done") return "done";
  return "running";
}

function KadTaskRunPeek({
  taskId,
  onOpenPeek,
}: {
  taskId: string;
  onOpenPeek: (t: PeekTarget) => void;
}) {
  const [task, setTask] = useState<KadTask | null>(null);
  const [wf, setWf] = useState<KadWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    kadApi.tasks
      .get(taskId)
      .then(async (t) => {
        if (!alive) return;
        setTask(t);
        if (t.workflowId) {
          const w = await kadApi.workflows.get(t.workflowId).catch(() => null);
          if (alive) setWf(w);
        }
      })
      .catch((e) => alive && setError(e?.message || "Không tải được công việc."));
    return () => {
      alive = false;
    };
  }, [taskId]);

  if (error) return <PeekError message={error} />;
  if (!task) return <PeekLoading />;

  const boardStatus = mapKadTaskStatus(task.status);
  const steps = wf?.steps ?? [];
  const currentIdx = task.workflowStep ? steps.findIndex((s) => s.id === task.workflowStep) : -1;
  const currentStep = currentIdx >= 0 ? steps[currentIdx] : null;
  const done = boardStatus === "done" ? steps.length : Math.max(0, currentIdx);
  const approvalStep =
    boardStatus === "waiting_approval"
      ? (currentStep ?? null)
      : (steps.find((s, i) => i >= currentIdx && s.approval) ?? null);
  const nextStep = currentIdx >= 0 && currentIdx + 1 < steps.length ? steps[currentIdx + 1] : null;

  return (
    <div>
      {/* 1. Context */}
      <Section title="Bối cảnh">
        <h2 className="text-base font-semibold text-kad-text-strong mb-1 break-words">
          {task.title}
        </h2>
        <Row label="Dự án / hạng mục">{task.workingDir || task.departmentId || "—"}</Row>
        <Row label="Mục tiêu">{task.brief?.goal || task.description || "—"}</Row>
        <Row label="Đầu ra mong muốn">{task.brief?.deliverable || "—"}</Row>
        <Row label="Agent phụ trách">
          {task.assignedAgentId ? (
            <span className="inline-flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-kad-text-muted" /> {task.assignedAgentId}
            </span>
          ) : (
            "—"
          )}
        </Row>
      </Section>

      {/* 2. Workflow */}
      <Section title="Workflow">
        <Row label="Workflow">{wf?.name ?? task.workflowId ?? "—"}</Row>
        <Row label="Trạng thái">
          <StatusChip status={boardStatus} />
        </Row>
        <Row label="Bước hiện tại">{currentStep?.name ?? task.workflowStep ?? "—"}</Row>
        <Row label="Tiến độ">{steps.length > 0 ? `${done}/${steps.length} bước` : "—"}</Row>
      </Section>

      {/* 3. Steps */}
      <Section title="Các bước">
        {steps.length > 0 ? (
          steps.map((s, i) => (
            <StepRow
              key={s.id}
              name={s.name}
              state={kadStepState(i, currentIdx, boardStatus)}
              detail={s.agent_ref ? `Agent: ${s.agent_ref}` : null}
              requiresApproval={Boolean(s.approval)}
            />
          ))
        ) : (
          <p className="kad-caption text-kad-text-muted">
            Workflow chưa có danh sách bước (định nghĩa không tải được).
          </p>
        )}
      </Section>

      {/* 4. Approval */}
      <Section title="Phê duyệt">
        {boardStatus === "waiting_approval" ? (
          <>
            <Row label="Bước chờ duyệt">{currentStep?.name ?? task.workflowStep ?? "—"}</Row>
            <Row label="Chờ ai duyệt">CEO / người phụ trách phòng</Row>
            <Row label="Sau khi duyệt">
              {nextStep ? `Chạy tiếp bước "${nextStep.name}"` : "Hoàn tất workflow"}
            </Row>
          </>
        ) : approvalStep ? (
          <p className="text-sm text-kad-text-muted">
            Bước "{approvalStep.name}" sẽ cần duyệt khi tới lượt.
          </p>
        ) : (
          <p className="text-sm text-kad-text-muted">Không có bước nào cần duyệt.</p>
        )}
      </Section>

      {/* 5. Artifacts & Logs */}
      <Section title="Sản phẩm & nhật ký">
        <button
          type="button"
          onClick={() => onOpenPeek({ type: "task", id: task.id })}
          className="inline-flex items-center gap-1.5 text-sm text-kad-accent hover:underline"
        >
          <FileText className="w-3.5 h-3.5" /> Xem chi tiết công việc (trao đổi, học liệu)
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <p className="kad-caption text-kad-text-faint mt-2">Cập nhật {timeAgo(task.updatedAt)}</p>
      </Section>
    </div>
  );
}

// ── Claude Code Workflow-tool run ──────────────────────────────────────────

function CcRunPeek({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.workflows
      .run(runId)
      .then((d) => {
        if (!alive) return;
        setRun(d.workflow);
        setAgents(d.agents || []);
      })
      .catch((e) => alive && setError(e?.message || "Không tải được workflow run."));
    return () => {
      alive = false;
    };
  }, [runId]);

  if (error) return <PeekError message={error} />;
  if (!run) return <PeekLoading />;

  const boardStatus = mapCcRunStatus(run.status);
  const phases = run.phases ?? [];
  const progress = run.progress ?? [];
  const phaseMarkers = progress.filter((p) => p.type === "workflow_phase");
  const currentPhase =
    run.status === "completed" ? null : progressEntryTitle(phaseMarkers[phaseMarkers.length - 1]);
  const done = run.status === "completed" ? phases.length : Math.max(0, phaseMarkers.length - 1);

  // Per-phase agent rollup from the journal's progress[] entries.
  const agentsByPhase = new Map<string, { done: number; total: number }>();
  for (const p of progress) {
    if (p.type !== "workflow_agent" || !p.phaseTitle) continue;
    const acc = agentsByPhase.get(p.phaseTitle) ?? { done: 0, total: 0 };
    acc.total += 1;
    if (p.state === "done") acc.done += 1;
    agentsByPhase.set(p.phaseTitle, acc);
  }

  function phaseState(title: string): StepState {
    if (run!.status === "completed") return "done";
    const seenIdx = phaseMarkers.findIndex((m) => progressEntryTitle(m) === title);
    if (seenIdx < 0) return "pending";
    if (seenIdx < phaseMarkers.length - 1) return "done";
    return boardStatus === "blocked" ? "blocked" : "running";
  }

  return (
    <div>
      {/* 1. Context */}
      <Section title="Bối cảnh">
        <h2 className="text-base font-semibold text-kad-text-strong mb-1 break-words">
          {run.name || run.run_id}
        </h2>
        <Row label="Dự án / hạng mục">
          <span className="text-kad-text-faint">
            Chưa gắn hạng mục (Unlinked)
            {run.task_id && <span className="font-mono text-xs"> · task {run.task_id}</span>}
          </span>
        </Row>
        <Row label="Agent">
          {run.agent_count > 0 ? `${run.agent_count} agent trong fleet` : "—"}
        </Row>
        <Row label="Phiên nguồn">
          {run.session_id ? (
            <button
              type="button"
              onClick={() => navigate(`/he-thong/sessions/${run.session_id}`)}
              className="text-kad-accent hover:underline font-mono text-xs"
            >
              {run.session_id.slice(0, 12)}…
            </button>
          ) : (
            "—"
          )}
        </Row>
      </Section>

      {/* 2. Workflow */}
      <Section title="Workflow">
        <Row label="Workflow">{run.name || run.run_id}</Row>
        <Row label="Model">{run.default_model || "—"}</Row>
        <Row label="Trạng thái">
          <StatusChip status={boardStatus} />
        </Row>
        <Row label="Bước hiện tại">{currentPhase ?? "—"}</Row>
        <Row label="Tiến độ">{phases.length > 0 ? `${done}/${phases.length} phase` : "—"}</Row>
      </Section>

      {/* 3. Steps (phases) */}
      <Section title="Các bước">
        {phases.length > 0 ? (
          phases.map((ph, i) => {
            const title = ph.title ?? `Phase ${i + 1}`;
            const roll = agentsByPhase.get(title);
            return (
              <StepRow
                key={`${title}-${i}`}
                name={title}
                state={phaseState(title)}
                detail={
                  [ph.detail, roll ? `${roll.done}/${roll.total} agent xong` : null]
                    .filter(Boolean)
                    .join(" · ") || null
                }
              />
            );
          })
        ) : (
          <p className="kad-caption text-kad-text-muted">Run không khai báo phase.</p>
        )}
      </Section>

      {/* 4. Approval */}
      <Section title="Phê duyệt">
        <p className="text-sm text-kad-text-muted">
          Workflow-tool run chạy tự động, không có bước duyệt.
        </p>
      </Section>

      {/* 5. Artifacts & Logs */}
      <Section title="Sản phẩm & nhật ký">
        {run.session_id && (
          <button
            type="button"
            onClick={() => navigate(`/he-thong/sessions/${run.session_id}`)}
            className="inline-flex items-center gap-1.5 text-sm text-kad-accent hover:underline"
          >
            <FileText className="w-3.5 h-3.5" /> Mở phiên nguồn (trace đầy đủ)
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="mt-2 space-y-1">
          {agents.slice(0, 8).map((a) => (
            <p key={a.id} className="kad-caption text-kad-text-muted truncate font-mono">
              {a.subagent_type || a.type} · {a.name || a.id.slice(0, 16)} · {a.status}
            </p>
          ))}
          {agents.length > 8 && (
            <p className="kad-caption text-kad-text-faint">… và {agents.length - 8} agent khác</p>
          )}
        </div>
        <p className="kad-caption text-kad-text-faint mt-2">
          {run.total_tokens > 0 && `${Math.round(run.total_tokens / 1000)}k tokens · `}
          {run.total_tool_calls > 0 && `${run.total_tool_calls} tool calls · `}
          Cập nhật {timeAgo(run.updated_at || run.ended_at || run.started_at || run.created_at)}
        </p>
      </Section>
    </div>
  );
}
