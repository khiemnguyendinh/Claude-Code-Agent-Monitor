/**
 * Màn Trao đổi công việc (`/cong-viec/:id`) — spec/ui/05-man-trao-doi-cong-viec.md
 * + spec/ui/07-giao-viec-intake-report-card.md (delta: intake/brief/report).
 * "Việc này đang ở đâu, Trợ lý vận hành đang nói gì với tôi, và sản phẩm đâu?"
 *
 * Khi đến từ `/cong-viec/moi` (router state `fresh=true`), trang này chạy
 * kịch bản mô tả → intake (tối đa 3 câu) → Brief Card → Chốt & giao → thực
 * thi → Report Card → Duyệt/Yêu cầu sửa — spec 07 §1-4. Không có backend
 * thật nên kịch bản được mô phỏng bằng setTimeout có thể huỷ (Dừng & bổ
 * sung chỉ đạo xoá hết timer đang chờ).
 */
import { useEffect, useRef, useState } from "react";
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
  ARTIFACTS,
  DEMO_ATTACHMENT_NAMES,
  RD_WORKFLOW,
  TASK_DETAIL_SYLLABUS_K3,
  WF_CONTENT_FUNNEL,
  WF_FREEFORM,
  WORKFLOW_QUICKSTARTS,
  findAgent,
  findArtifact,
} from "../mockData";
import { useKadStore } from "../store";
import { usePeek } from "../components/PeekDrawer";
import { KadButton, KadEmptyState, KadTextarea } from "../components/primitives";
import { TaskComposer, type TaskComposerHandle } from "../components/TaskComposer";
import { TaskStatusChip, DelegationStatusChip, StatusChip } from "../components/StatusChip";
import { VerticalStepper } from "../components/Progress";
import { AgentAvatar } from "../components/Avatar";
import { ArtifactViewer } from "../components/ArtifactViewer";
import { MarkdownLite } from "../components/MarkdownLite";
import { ARTIFACT_TYPE_LABEL } from "../labels";
import { formatAbsoluteDateTime, formatDueDate, formatRelativeTime, formatTokens, formatVnd } from "../format";
import type {
  BriefPayload,
  ProjectStepProgress,
  ReportPayload,
  TaskCard,
  TaskDetail,
  TaskMessage,
  TaskStatus,
  WorkflowDefinition,
} from "../types";

// ── Kịch bản intake → brief → report theo workflow (spec 07) ────────────────
// Không có sub-agent chuyên trách content/freeform trong roster R&D (spec 01
// §3.1) nên 2 nhánh đó để Main Agent tự thực thi (không delegation card) thay
// vì bịa ra agent không có thật — chỉ nhánh "Soạn syllabus" có agent thật
// (sub-syllabus-designer) nên được mô phỏng chi tiết đầy đủ nhất.

interface WorkflowScriptConfig {
  taskSteps: { key: string; label: string }[];
  deliverableLabel: string;
  artifactV1Id: string;
  artifactV2Id?: string;
  delegateAgentId?: string;
  runStates: string[];
  frameworkQuestion?: { text: string; options: [string, string]; label: (answer: string) => string };
  reportSummaryV1: string;
  reportSummaryV2?: string;
  needsDecisionV1?: string[];
  costV1: { duration: string; tokens: string; vnd: string };
  costV2?: { duration: string; tokens: string; vnd: string };
  agentDisplayName: string;
}

const SCRIPT_CONFIG: Record<string, WorkflowScriptConfig> = {
  "wf-rd-standard": {
    taskSteps: [
      { key: "framework", label: "Phân tích khung chương trình" },
      { key: "syllabus", label: "Soạn syllabus" },
      { key: "review", label: "Review & trình duyệt" },
    ],
    deliverableLabel: "Syllabus .docx + file import .xlsx cho /admin/curriculum",
    artifactV1Id: "art-demo-syllabus-v1",
    artifactV2Id: "art-demo-syllabus-v2",
    delegateAgentId: "sub-syllabus-designer",
    runStates: [
      "Đang soạn khung 12 buổi…",
      "Đang map KASH × Bloom cho từng buổi…",
      "Đang viết mô tả buổi 7–12…",
      "Hoàn tất — chuyển review",
    ],
    frameworkQuestion: {
      text: "Syllabus dùng khung năng lực KASH chuẩn Bloom (mặc định Kstudy) hay anh muốn cấu trúc khác?",
      options: ["Theo chuẩn Kstudy", "Cấu trúc khác"],
      label: (a) =>
        a === "Theo chuẩn Kstudy" ? "KASH chuẩn Bloom (mặc định Kstudy)" : "Cấu trúc khác (Trợ lý đề xuất tạm, chờ anh bổ sung)",
    },
    reportSummaryV1: "Syllabus 12 buổi hoàn chỉnh theo khung KASH × Bloom, 3 module, tỷ trọng AI Agent 5/12 buổi.",
    reportSummaryV2: "Syllabus 12 buổi đã bổ sung dashboard tự động vào buổi 4 theo yêu cầu sửa.",
    needsDecisionV1: ["Buổi 9 case tổng hợp: dùng case Kstudy thật hay case giả lập?"],
    costV1: { duration: "6 phút", tokens: "84k tokens", vnd: "32k đ" },
    costV2: { duration: "2 phút", tokens: "26k tokens", vnd: "11k đ" },
    agentDisplayName: "Thiết kế syllabus",
  },
  "wf-content-funnel": {
    taskSteps: [
      { key: "insight", label: "Đọc insight học viên" },
      { key: "draft", label: "Viết nội dung" },
      { key: "review", label: "Review & trình duyệt" },
    ],
    deliverableLabel: "5 bài content phễu (.docx) kèm outline duyệt trước",
    artifactV1Id: "art-demo-content-v1",
    runStates: ["Đang đọc insight học viên…", "Đang lên outline 5 bài…", "Đang viết nội dung…"],
    frameworkQuestion: {
      text: "Giọng văn theo phong cách Kstudy hiện tại (chuyên gia gần gũi, thẳng thắn) hay anh muốn điều chỉnh?",
      options: ["Theo phong cách hiện tại", "Điều chỉnh"],
      label: (a) => (a === "Theo phong cách hiện tại" ? "Giọng văn Kstudy hiện tại" : "Giọng văn điều chỉnh (Trợ lý đề xuất tạm)"),
    },
    reportSummaryV1: "5 bài content phễu hoàn chỉnh theo công thức mỏ neo → insight → chốt bài học, tông chuyên gia gần gũi.",
    needsDecisionV1: ["Bài 5 CTA: ưu đãi sớm hay ưu đãi theo nhóm?"],
    costV1: { duration: "4 phút", tokens: "38k tokens", vnd: "14k đ" },
    agentDisplayName: "Trợ lý vận hành R&D",
  },
  "wf-freeform": {
    taskSteps: [{ key: "plan", label: "Phân tích & lên kế hoạch" }],
    deliverableLabel: "Trợ lý đề xuất kế hoạch cụ thể sau khi phân tích",
    artifactV1Id: "art-demo-freeform-v1",
    runStates: ["Đang phân tích yêu cầu…", "Đang phác kế hoạch…"],
    reportSummaryV1: "Đã phân tích yêu cầu và đề xuất kế hoạch thực thi theo từng giai đoạn nhỏ.",
    costV1: { duration: "3 phút", tokens: "21k tokens", vnd: "8k đ" },
    agentDisplayName: "Trợ lý vận hành R&D",
  },
};

const DUE_OPTIONS = ["Trong tuần này", "Cuối tháng", "Không gấp, làm kỹ"];
const DEFAULT_DUE_LABEL = "Trợ lý đề xuất: 2 tuần"; // dùng khi trả lời tự do không khớp chip nào
const DUE_LABEL_MAP: Record<string, string> = {
  "Trong tuần này": "Cuối tuần này",
  "Cuối tháng": "Cuối tháng này",
  "Không gấp, làm kỹ": DEFAULT_DUE_LABEL,
};

// SCRIPT_CONFIG luôn có đủ 3 key khớp WORKFLOW_QUICKSTARTS + WF_FREEFORM (xem
// mockData.ts) — non-null assertion ở đây an toàn theo bất biến đó, tập trung
// một chỗ thay vì rải "!" khắp các lần tra SCRIPT_CONFIG[wf.id].
function cfgFor(wf: WorkflowDefinition): WorkflowScriptConfig {
  return SCRIPT_CONFIG[wf.id]!;
}

function matchWorkflowByKeyword(text: string): WorkflowDefinition | null {
  const lower = text.toLowerCase();
  return WORKFLOW_QUICKSTARTS.find((wf) => wf.triggerKeywords?.some((k) => lower.includes(k))) ?? null;
}

function resolveWorkflow(workflowId: string | null | undefined, text: string): WorkflowDefinition {
  if (workflowId) {
    const found = WORKFLOW_QUICKSTARTS.find((wf) => wf.id === workflowId);
    if (found) return found;
  }
  return matchWorkflowByKeyword(text) ?? WF_FREEFORM;
}

function confirmQuestionFor(wf: WorkflowDefinition): { text: string; options: string[] } {
  if (wf.id === "wf-freeform") {
    return {
      text: "Việc này em chưa khớp loại có sẵn — em sẽ hỏi thêm vài câu rồi tự lập kế hoạch, được không anh?",
      options: ["Được", `Chọn loại: ${RD_WORKFLOW.displayName}`, `Chọn loại: ${WF_CONTENT_FUNNEL.displayName}`],
    };
  }
  const other = wf.id === "wf-rd-standard" ? WF_CONTENT_FUNNEL : RD_WORKFLOW;
  return {
    text: `Em hiểu đây là việc ${wf.displayName} (pipeline: ${wf.description}) — đúng không anh?`,
    options: ["Đúng", `Chọn loại: ${other.displayName}`, "Việc tự do"],
  };
}

// ── Xây TaskDetail khởi tạo ──────────────────────────────────────────────

function buildDefaultDetail(taskId: string, task: TaskCard, fresh: boolean): TaskDetail {
  if (fresh) {
    return {
      id: taskId,
      title: task.title,
      status: "inbox",
      projectTitle: "Chưa gắn dự án",
      priority: "normal",
      dueDate: null,
      createdAt: new Date().toISOString(),
      costToDateTokens: 0,
      costToDateVnd: 0,
      steps: [],
      currentStepKey: "",
      activeDelegation: null,
      isRunning: false,
      workingDir: task.workingDir ?? null,
      messages: [],
    };
  }
  const steps = RD_WORKFLOW.steps.map((s, i) => ({
    key: s.key,
    label: s.label,
    state: i === 0 ? ("doing" as const) : ("todo" as const),
    agentId: i === 0 ? "main-agent-rd" : undefined,
  }));
  return {
    id: taskId,
    title: task.title,
    status: "doing",
    projectTitle: "Chưa gắn dự án",
    priority: "normal",
    dueDate: null,
    createdAt: new Date().toISOString(),
    costToDateTokens: 0,
    costToDateVnd: 0,
    steps,
    currentStepKey: steps[0]?.key ?? "framework",
    activeDelegation: null,
    isRunning: true,
    workingDir: task.workingDir ?? null,
    messages: [
      {
        id: "m-created",
        taskId,
        senderType: "agent",
        senderId: "main-agent-rd",
        content: "Đã tạo công việc",
        messageType: "status",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

interface RouterFreshState {
  fresh?: boolean;
  description?: string;
  attachments?: string[];
  workflowId?: string | null;
}

export function TraoDoiCongViec() {
  const { id } = useParams<{ id: string }>();
  const { tasks } = useKadStore();
  const navigate = useNavigate();
  const location = useLocation();

  if (!id) return null;

  if (id === TASK_DETAIL_SYLLABUS_K3.id) {
    return <TraoDoiCongViecInner key={id} taskId={id} baseDetail={TASK_DETAIL_SYLLABUS_K3} fresh={false} />;
  }
  const task = tasks.find((t) => t.id === id);
  if (!task) {
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
  const state = (location.state as RouterFreshState | null) ?? null;
  const fresh = Boolean(state?.fresh);
  return (
    <TraoDoiCongViecInner
      key={id}
      taskId={id}
      baseDetail={buildDefaultDetail(id, task, fresh)}
      fresh={fresh}
      freshDescription={state?.description ?? task.title}
      freshAttachments={state?.attachments ?? task.attachmentNames ?? []}
      freshWorkflowId={state?.workflowId ?? null}
    />
  );
}

function TraoDoiCongViecInner({
  taskId,
  baseDetail,
  fresh,
  freshDescription,
  freshAttachments,
  freshWorkflowId,
}: {
  taskId: string;
  baseDetail: TaskDetail;
  fresh: boolean;
  freshDescription?: string;
  freshAttachments?: string[];
  freshWorkflowId?: string | null;
}) {
  const navigate = useNavigate();
  const { openPeek } = usePeek();
  const [messages, setMessages] = useState<TaskMessage[]>(baseDetail.messages);
  const [isRunning, setIsRunning] = useState(baseDetail.isRunning);
  const [status, setStatus] = useState<TaskStatus>(baseDetail.status);
  const [steps, setSteps] = useState<ProjectStepProgress[]>(baseDetail.steps);
  const [costTokens, setCostTokens] = useState(baseDetail.costToDateTokens);
  const [costVnd, setCostVnd] = useState(baseDetail.costToDateVnd);
  const [pinnedBrief, setPinnedBrief] = useState<BriefPayload | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    ARTIFACTS.filter((a) => a.taskId === taskId).sort((a, b) => b.version - a.version)[0]?.id ?? null
  );
  const [draft, setDraft] = useState("");
  const [dockAttachments, setDockAttachments] = useState<string[]>([]);
  const [dockAttachCycle, setDockAttachCycle] = useState(0);
  const composerRef = useRef<TaskComposerHandle>(null);

  const timersRef = useRef<number[]>([]);
  const costTimerRef = useRef<number | null>(null);
  const idSeqRef = useRef(0);
  const scriptRef = useRef<{
    workflow: WorkflowDefinition;
    dueLabel: string;
    frameworkLabel?: string;
    assumption?: string;
    briefPayload?: BriefPayload;
  } | null>(null);
  const pendingAnswerRef = useRef<((answer: string) => void) | null>(null);

  const taskArtifacts = ARTIFACTS.filter((a) => a.taskId === taskId).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  // ── Helpers dùng chung cho toàn kịch bản ──────────────────────────────

  function nextId(prefix: string) {
    idSeqRef.current += 1;
    return `${prefix}-${taskId}-${idSeqRef.current}`;
  }

  function pushMessage(msg: Omit<TaskMessage, "id" | "taskId" | "createdAt">): string {
    const msgId = nextId("m");
    setMessages((prev) => [...prev, { ...msg, id: msgId, taskId, createdAt: new Date().toISOString() }]);
    return msgId;
  }

  function updateMessage(msgId: string, updater: (m: TaskMessage) => TaskMessage) {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? updater(m) : m)));
  }

  function after(ms: number, fn: () => void) {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
  }

  function clearAllTimers() {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }

  function startCostTicker() {
    stopCostTicker();
    costTimerRef.current = window.setInterval(() => {
      setCostTokens((c) => c + 4000);
      setCostVnd((c) => c + 2700);
    }, 900);
  }

  function stopCostTicker() {
    if (costTimerRef.current !== null) {
      clearInterval(costTimerRef.current);
      costTimerRef.current = null;
    }
  }

  function setActiveStep(idx: number) {
    setSteps((prev) => prev.map((s, i) => ({ ...s, state: i < idx ? "done" : i === idx ? "doing" : "todo" })));
  }

  function closeIntakeChips(msgId: string) {
    updateMessage(msgId, (m) => ({ ...m, metadata: { ...m.metadata, options: undefined } }));
  }

  useEffect(() => {
    return () => {
      clearAllTimers();
      stopCostTicker();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Kịch bản: intake → brief → run → report (spec 07) ─────────────────

  function runIntakeStep1() {
    const wf = scriptRef.current!.workflow;
    const { text, options } = confirmQuestionFor(wf);
    const qId = pushMessage({
      senderType: "agent",
      senderId: "main-agent-rd",
      content: text,
      messageType: "intake_question",
      metadata: { options },
    });
    pendingAnswerRef.current = (answer) => {
      if (answer.startsWith("Chọn loại: ")) {
        const label = answer.replace("Chọn loại: ", "");
        const picked = WORKFLOW_QUICKSTARTS.find((w) => w.displayName === label);
        if (picked) scriptRef.current!.workflow = picked;
      } else if (answer === "Việc tự do") {
        scriptRef.current!.workflow = WF_FREEFORM;
      }
      closeIntakeChips(qId);
      after(600, runIntakeStep2);
    };
  }

  function runIntakeStep2() {
    const qId = pushMessage({
      senderType: "agent",
      senderId: "main-agent-rd",
      content: "Anh muốn hạn hoàn thành khi nào?",
      messageType: "intake_question",
      metadata: { options: [...DUE_OPTIONS] },
    });
    pendingAnswerRef.current = (answer) => {
      scriptRef.current!.dueLabel = DUE_LABEL_MAP[answer] ?? DEFAULT_DUE_LABEL;
      closeIntakeChips(qId);
      const cfg = cfgFor(scriptRef.current!.workflow);
      if (cfg.frameworkQuestion) after(600, runIntakeStep3);
      else after(700, showBrief);
    };
  }

  function runIntakeStep3() {
    const wf = scriptRef.current!.workflow;
    const fq = cfgFor(wf).frameworkQuestion!;
    const qId = pushMessage({
      senderType: "agent",
      senderId: "main-agent-rd",
      content: fq.text,
      messageType: "intake_question",
      metadata: { options: [...fq.options] },
    });
    pendingAnswerRef.current = (answer) => {
      scriptRef.current!.frameworkLabel = fq.label(answer);
      if (answer === fq.options[1]) {
        scriptRef.current!.assumption =
          "Dùng phương án mặc định tạm thời cho bản đầu tiên — anh phản hồi cụ thể hơn thì Trợ lý điều chỉnh ở bản sau.";
      }
      closeIntakeChips(qId);
      after(700, showBrief);
    };
  }

  function showBrief() {
    const wf = scriptRef.current!.workflow;
    const cfg = cfgFor(wf);
    const assumption =
      scriptRef.current!.assumption ??
      (wf.id === "wf-freeform"
        ? "Trợ lý sẽ tự đề xuất phạm vi cụ thể trong bản kế hoạch đầu tiên — có thể cần anh duyệt lại nếu chưa đúng ý."
        : undefined);
    const brief: BriefPayload = {
      goal: freshDescription ?? baseDetail.title,
      deliverable: cfg.deliverableLabel,
      workflowName: wf.displayName,
      workingDir: baseDetail.workingDir ?? null,
      attachmentCount: freshAttachments?.length ?? 0,
      dueLabel: scriptRef.current!.dueLabel || DEFAULT_DUE_LABEL,
      frameworkLabel: scriptRef.current!.frameworkLabel,
      assumption,
      decidedAt: null,
    };
    scriptRef.current!.briefPayload = brief;
    pushMessage({ senderType: "agent", senderId: "main-agent-rd", content: "Brief — chờ anh chốt", messageType: "brief", metadata: { brief } });
  }

  function handleLockBrief(msgId: string) {
    const decidedAt = new Date().toISOString();
    updateMessage(msgId, (m) => (m.metadata?.brief ? { ...m, metadata: { ...m.metadata, brief: { ...m.metadata.brief, decidedAt } } } : m));
    if (scriptRef.current?.briefPayload) setPinnedBrief({ ...scriptRef.current.briefPayload, decidedAt });
    const wf = scriptRef.current!.workflow;
    const taskSteps = cfgFor(wf).taskSteps;
    setSteps(taskSteps.map((s, i) => ({ key: s.key, label: s.label, state: i === 0 ? "doing" : "todo" })));
    setStatus("doing");
    setIsRunning(true);
    startCostTicker();
    pushMessage({ senderType: "agent", senderId: "main-agent-rd", content: "Brief đã chốt — bắt đầu thực thi", messageType: "status" });
    after(1200, () => {
      if (taskSteps.length > 1) setActiveStep(1);
      runMainPhase(wf);
    });
  }

  function handleEditBrief(msgId: string) {
    pendingAnswerRef.current = (freeText) => {
      updateMessage(msgId, (m) =>
        m.metadata?.brief
          ? { ...m, metadata: { ...m.metadata, brief: { ...m.metadata.brief, goal: `${m.metadata.brief.goal} (cập nhật: ${freeText})` } } }
          : m
      );
      after(500, () => pushMessage({ senderType: "agent", senderId: "main-agent-rd", content: "Em đã cập nhật brief theo góp ý.", messageType: "chat" }));
    };
    composerRef.current?.focus();
  }

  function runMainPhase(wf: WorkflowDefinition) {
    const cfg = cfgFor(wf);
    if (cfg.delegateAgentId) {
      const delegAgentId = cfg.delegateAgentId;
      const msgId = pushMessage({
        senderType: "agent",
        senderId: "main-agent-rd",
        content: `Đã giao cho ${findAgent(delegAgentId)?.displayName ?? delegAgentId}`,
        messageType: "status",
        metadata: {
          delegation: {
            id: nextId("deleg"),
            taskId,
            fromAgentId: "main-agent-rd",
            toAgentId: delegAgentId,
            instruction: cfg.runStates[0]!,
            status: "running",
            retryCount: 0,
            runId: null,
            outputArtifactId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      });
      let i = 0;
      const tick = () => {
        i += 1;
        if (i < cfg.runStates.length) {
          updateMessage(msgId, (m) =>
            m.metadata?.delegation
              ? { ...m, metadata: { ...m.metadata, delegation: { ...m.metadata.delegation, instruction: cfg.runStates[i]!, updatedAt: new Date().toISOString() } } }
              : m
          );
          after(1400, tick);
        } else {
          updateMessage(msgId, (m) =>
            m.metadata?.delegation
              ? { ...m, metadata: { ...m.metadata, delegation: { ...m.metadata.delegation, status: "done", updatedAt: new Date().toISOString() } } }
              : m
          );
          after(900, () => finishMainPhase(wf));
        }
      };
      after(1400, tick);
    } else {
      let i = 0;
      const step = () => {
        pushMessage({ senderType: "agent", senderId: "main-agent-rd", content: cfg.runStates[i]!, messageType: "status" });
        i += 1;
        if (i < cfg.runStates.length) after(1100, step);
        else after(900, () => finishMainPhase(wf));
      };
      step();
    }
  }

  function finishMainPhase(wf: WorkflowDefinition) {
    const cfg = cfgFor(wf);
    if (cfg.taskSteps.length > 2) setActiveStep(cfg.taskSteps.length - 1);
    else setSteps((prev) => prev.map((s) => ({ ...s, state: "done" })));
    deliverArtifact(wf, 1);
  }

  function deliverArtifact(wf: WorkflowDefinition, version: 1 | 2) {
    const cfg = cfgFor(wf);
    const artifactId = version === 2 ? cfg.artifactV2Id! : cfg.artifactV1Id;
    const artifact = findArtifact(artifactId);
    if (!artifact) return;
    pushMessage({
      senderType: "agent",
      senderId: cfg.delegateAgentId ?? "main-agent-rd",
      content: artifact.title,
      messageType: "artifact_delivery",
      metadata: { artifact },
    });
    setStatus("waiting_human");
    setIsRunning(false);
    stopCostTicker();
    after(1000, () => showReport(wf, version));
  }

  function showReport(wf: WorkflowDefinition, version: number) {
    const cfg = cfgFor(wf);
    const artifactId = version === 2 ? cfg.artifactV2Id! : cfg.artifactV1Id;
    const artifact = findArtifact(artifactId);
    if (!artifact) return;
    const report: ReportPayload = {
      version,
      summary: version > 1 && cfg.reportSummaryV2 ? cfg.reportSummaryV2 : cfg.reportSummaryV1,
      artifacts: [{ artifactId: artifact.id, title: artifact.title }],
      needsDecision: version === 1 ? cfg.needsDecisionV1 : undefined,
      cost: { ...(version > 1 && cfg.costV2 ? cfg.costV2 : cfg.costV1), agentName: cfg.agentDisplayName },
      decision: null,
    };
    pushMessage({
      senderType: "agent",
      senderId: cfg.delegateAgentId ?? "main-agent-rd",
      content: `Báo cáo kết quả${version > 1 ? " v2" : ""}`,
      messageType: "report",
      metadata: { report },
    });
  }

  function handleApproveReport(msgId: string) {
    const at = new Date().toISOString();
    updateMessage(msgId, (m) => (m.metadata?.report ? { ...m, metadata: { ...m.metadata, report: { ...m.metadata.report, decision: { status: "approved", at } } } } : m));
    setStatus("done");
    setSteps((prev) => prev.map((s) => ({ ...s, state: "done" })));
    after(500, () => pushMessage({ senderType: "agent", senderId: "main-agent-rd", content: "Việc hoàn thành — học liệu đã duyệt.", messageType: "chat" }));
  }

  function handleRequestChangesReport(msgId: string, reason: string) {
    const at = new Date().toISOString();
    updateMessage(msgId, (m) =>
      m.metadata?.report ? { ...m, metadata: { ...m.metadata, report: { ...m.metadata.report, decision: { status: "needs_changes", at, reason } } } } : m
    );
    pushMessage({ senderType: "human", senderId: "human", content: reason, messageType: "chat" });
    setStatus("needs_changes");
    const wf = scriptRef.current!.workflow;
    const cfg = cfgFor(wf);
    if (cfg.artifactV2Id) {
      setActiveStep(Math.max(cfg.taskSteps.length - 2, 0));
      setIsRunning(true);
      startCostTicker();
      after(600, () =>
        pushMessage({
          senderType: "agent",
          senderId: cfg.delegateAgentId ?? "main-agent-rd",
          content: "Em nhận yêu cầu. Đang cập nhật — bản v2 sẽ kèm diff để anh so sánh.",
          messageType: "chat",
        })
      );
      after(3200, () => {
        if (cfg.taskSteps.length > 2) setActiveStep(cfg.taskSteps.length - 1);
        else setSteps((prev) => prev.map((s) => ({ ...s, state: "done" })));
        deliverArtifact(wf, 2);
      });
    } else {
      after(700, () =>
        pushMessage({ senderType: "agent", senderId: "main-agent-rd", content: "Em đã ghi nhận, sẽ điều chỉnh trong bản tiếp theo.", messageType: "chat" })
      );
    }
  }

  // ── Kích hoạt kịch bản khi vừa tạo từ /cong-viec/moi ───────────────────

  useEffect(() => {
    if (!fresh) return;
    const description = freshDescription ?? baseDetail.title;
    const attachments = freshAttachments ?? [];
    const wf = resolveWorkflow(freshWorkflowId, description);
    scriptRef.current = { workflow: wf, dueLabel: "" };

    pushMessage({
      senderType: "human",
      senderId: "human",
      content: description,
      messageType: "chat",
      metadata: attachments.length ? { attachmentNames: attachments } : undefined,
    });

    after(500, () => {
      pushMessage({
        senderType: "agent",
        senderId: "main-agent-rd",
        content: `Đã tạo việc · Hàng đợi${baseDetail.workingDir ? ` · thư mục ${baseDetail.workingDir}` : ""}`,
        messageType: "status",
      });
    });

    // [spec 07 §2] "Bước 0 của intake: nếu composer CHƯA chọn workflow…" — khi
    // người dùng đã bấm thẳng một wfCard (freshWorkflowId có giá trị), việc
    // nhận diện không còn là suy đoán nên bỏ qua câu confirm, vào thẳng hạn.
    after(1300, () => {
      if (freshWorkflowId) runIntakeStep2();
      else runIntakeStep1();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Composer đáy chat (docked) — spec 07 §5 ────────────────────────────

  function handleDockedSend() {
    const text = draft.trim();
    const files = [...dockAttachments];
    if (!text && files.length === 0) return;
    pushMessage({
      senderType: "human",
      senderId: "human",
      content: text || "(gửi tài liệu)",
      messageType: "chat",
      metadata: files.length ? { attachmentNames: files } : undefined,
    });
    setDraft("");
    setDockAttachments([]);
    if (pendingAnswerRef.current) {
      const handler = pendingAnswerRef.current;
      pendingAnswerRef.current = null;
      handler(text);
      return;
    }
    if (files.length) {
      after(500, () =>
        pushMessage({
          senderType: "agent",
          senderId: "main-agent-rd",
          content: `Em nhận được ${files.length} tài liệu mới, sẽ đưa vào ngữ cảnh từ lượt làm việc kế tiếp.`,
          messageType: "status",
        })
      );
      return;
    }
    after(500, () =>
      pushMessage({
        senderType: "agent",
        senderId: "main-agent-rd",
        content: "Em ghi nhận. (Mockup UI chưa nối Trợ lý vận hành thật cho hội thoại tự do ngoài kịch bản — dùng nút trên card để đi tiếp vòng đời.)",
        messageType: "chat",
      })
    );
  }

  function handleDockedAttach() {
    const name = DEMO_ATTACHMENT_NAMES[dockAttachCycle % DEMO_ATTACHMENT_NAMES.length]!;
    setDockAttachCycle((n) => n + 1);
    setDockAttachments((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }

  function handleRemoveDockAttachment(name: string) {
    setDockAttachments((prev) => prev.filter((n) => n !== name));
  }

  function handleAnswerIntake(answer: string) {
    pushMessage({ senderType: "human", senderId: "human", content: answer, messageType: "chat" });
    if (pendingAnswerRef.current) {
      const handler = pendingAnswerRef.current;
      pendingAnswerRef.current = null;
      handler(answer);
    }
  }

  const stopAndRedirect = () => {
    clearAllTimers();
    stopCostTicker();
    setIsRunning(false);
    pushMessage({ senderType: "agent", senderId: "main-agent-rd", content: "Đã dừng — sẵn sàng nhận chỉ đạo thêm.", messageType: "status" });
    composerRef.current?.focus();
  };

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
        <h1 className="kad-title text-kad-text-strong">{baseDetail.title}</h1>
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <TaskStatusChip status={status} />
          <span className="kad-caption bg-kad-surface-2 text-kad-text-muted rounded px-1.5 py-0.5">
            {baseDetail.projectTitle}
          </span>
        </div>

        {pinnedBrief && (
          <div className="border border-kad-border rounded-xl bg-kad-surface p-3 mt-4">
            <p className="kad-label text-kad-text-strong mb-1">Brief đã chốt</p>
            <p className="kad-caption text-kad-text-muted">{pinnedBrief.goal}</p>
          </div>
        )}

        {steps.length > 0 && (
          <>
            <p className="kad-overline text-kad-text-faint mt-5 mb-2">Tiến trình</p>
            <VerticalStepper steps={steps} />
          </>
        )}

        {baseDetail.activeDelegation && (
          <div className="mt-2">
            <p className="kad-overline text-kad-text-faint mb-2">Delegation đang chạy</p>
            <button
              type="button"
              onClick={() =>
                baseDetail.activeDelegation &&
                window.open(`/he-thong/sessions/${baseDetail.activeDelegation.runId ?? ""}`, "_blank")
              }
              className="w-full text-left border border-kad-border rounded-lg p-2.5 hover:bg-kad-surface-2"
            >
              <div className="flex items-center gap-1.5">
                <AgentAvatar agentId={baseDetail.activeDelegation.toAgentId} size={20} />
                <span className="kad-caption text-kad-text truncate flex-1">
                  {findAgent(baseDetail.activeDelegation.toAgentId)?.displayName}
                </span>
                <ExternalLink className="w-3 h-3 text-kad-text-faint flex-shrink-0" />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <DelegationStatusChip status={baseDetail.activeDelegation.status} />
                {baseDetail.activeDelegation.retryCount > 0 && (
                  <span className="kad-caption text-kad-warning">retry {baseDetail.activeDelegation.retryCount}</span>
                )}
              </div>
            </button>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-kad-border space-y-1.5">
          {baseDetail.dueDate && (
            <p className="kad-caption text-kad-text-muted">Hạn: {formatDueDate(baseDetail.dueDate)}</p>
          )}
          <p className="kad-caption text-kad-text-muted">Ưu tiên: {baseDetail.priority}</p>
          <p className="kad-caption text-kad-text-muted">Tạo lúc: {formatAbsoluteDateTime(baseDetail.createdAt)}</p>
          {baseDetail.workingDir && <p className="kad-caption text-kad-text-muted">Thư mục: {baseDetail.workingDir}</p>}
          <p className="kad-caption text-kad-text-muted">
            Chi phí đến nay: {formatTokens(costTokens)} · ~{formatVnd(costVnd)}
          </p>
        </div>
      </aside>

      {/* Pane B */}
      <main className="flex-1 min-w-[280px] flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
            <MessageRenderer
              key={m.id}
              message={m}
              onOpenPeek={openPeek}
              onOpenArtifactInPanel={setSelectedArtifactId}
              onAnswerIntake={handleAnswerIntake}
              onLockBrief={handleLockBrief}
              onEditBrief={handleEditBrief}
              onApproveReport={handleApproveReport}
              onRequestChangesReport={handleRequestChangesReport}
            />
          ))}
        </div>
        <div className="flex-shrink-0 border-t border-kad-border p-3">
          {isRunning ? (
            <div className="flex items-center justify-between bg-kad-surface-2 rounded-lg px-3 py-2.5">
              <span className="kad-body text-kad-text-muted">Trợ lý đang làm việc…</span>
              <KadButton variant="secondary" size="row" icon={Square} onClick={stopAndRedirect}>
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
                attachments={dockAttachments}
                onAttach={handleDockedAttach}
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
            <ArtifactViewer artifactId={selectedArtifactId} />
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

// ── Message renderers — 10 message_type (7 gốc + intake_question/brief/report,
// spec 07 §2-4) + delegation-from-metadata ─────────────────────────────────

function MessageRenderer({
  message,
  onOpenPeek,
  onOpenArtifactInPanel,
  onAnswerIntake,
  onLockBrief,
  onEditBrief,
  onApproveReport,
  onRequestChangesReport,
}: {
  message: TaskMessage;
  onOpenPeek: (t: { type: "artifact" | "approval"; id: string }) => void;
  onOpenArtifactInPanel: (id: string) => void;
  onAnswerIntake: (answer: string) => void;
  onLockBrief: (messageId: string) => void;
  onEditBrief: (messageId: string) => void;
  onApproveReport: (messageId: string) => void;
  onRequestChangesReport: (messageId: string, reason: string) => void;
}) {
  const { approvals, decideApproval } = useKadStore();

  if (message.messageType === "chat") {
    const isHuman = message.senderType === "human";
    const attachmentNames = message.metadata?.attachmentNames;
    return (
      <div className={`flex ${isHuman ? "justify-end" : ""}`}>
        <div
          className={`max-w-[85%] rounded-lg border border-kad-border px-3.5 py-2.5 ${
            isHuman ? "bg-kad-surface-2" : "bg-kad-surface"
          }`}
        >
          {!isHuman && (
            <div className="flex items-center gap-1.5 mb-1">
              <AgentAvatar agentId={message.senderId} size={20} />
              <span className="kad-label text-kad-text-strong">{findAgent(message.senderId)?.displayName}</span>
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
    return <IntakeQuestionBlock message={message} onAnswer={onAnswerIntake} />;
  }

  if (message.messageType === "brief" && message.metadata?.brief) {
    return (
      <BriefCardBlock brief={message.metadata.brief} onLock={() => onLockBrief(message.id)} onEdit={() => onEditBrief(message.id)} />
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

  if (message.messageType === "status" && message.metadata?.delegation) {
    const d = message.metadata.delegation;
    return (
      <div className="border border-kad-border rounded-lg p-3 max-w-[85%]">
        <div className="flex items-center gap-1.5">
          <AgentAvatar agentId={d.toAgentId} size={20} />
          <span className="kad-label text-kad-text-strong flex-1 truncate">
            {findAgent(d.toAgentId)?.displayName}
          </span>
          <DelegationStatusChip status={d.status} />
        </div>
        <p className="kad-caption text-kad-text-muted mt-1.5">{d.instruction}</p>
        {d.retryCount > 0 && <p className="kad-caption text-kad-warning mt-0.5">retry {d.retryCount}</p>}
      </div>
    );
  }

  if (message.messageType === "status") {
    return <p className="kad-caption text-kad-text-faint text-center">{message.content} · {formatRelativeTime(message.createdAt)}</p>;
  }

  if (message.messageType === "escalation") {
    return (
      <div className="border-l-2 border-kad-danger bg-kad-surface border border-kad-border rounded-lg p-3 max-w-[85%]">
        <p className="kad-body text-kad-text">{message.content}</p>
        {message.metadata?.suggestedActions && (
          <div className="flex gap-1.5 mt-2">
            {message.metadata.suggestedActions.map((label) => (
              <span key={label} className="kad-caption border border-kad-border rounded-full px-2 py-0.5 text-kad-text-muted">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (message.messageType === "artifact_delivery") {
    const artifact = message.metadata?.artifact;
    if (!artifact) return null;
    return (
      <div className="border border-kad-border rounded-lg p-3 max-w-[85%] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="kad-caption text-kad-text-faint">{ARTIFACT_TYPE_LABEL[artifact.artifactType]}</p>
          <p className="kad-body text-kad-text truncate">
            {artifact.title} · v{artifact.version}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <KadButton variant="ghost" size="row" onClick={() => onOpenArtifactInPanel(artifact.id)}>
            Xem ở panel
          </KadButton>
          <KadButton variant="ghost" size="row" icon={Eye} onClick={() => onOpenPeek({ type: "artifact", id: artifact.id })} />
        </div>
      </div>
    );
  }

  if (message.messageType === "approval_request") {
    const staticApproval = message.metadata?.approval;
    const live = staticApproval ? approvals.find((a) => a.id === staticApproval.id) : undefined;
    const approval = live ?? staticApproval;
    if (!approval) return null;
    return (
      <InlineApprovalCard
        title={approval.title}
        status={approval.status}
        decisionReason={approval.decisionReason}
        onApprove={() => decideApproval(approval.id, "approved", null)}
        onNeedsChanges={(reason) => decideApproval(approval.id, "needs_changes", reason)}
        onReject={(reason) => decideApproval(approval.id, "rejected", reason)}
      />
    );
  }

  return null;
}

// ── intake_question (spec 07 §2) ────────────────────────────────────────────

function IntakeQuestionBlock({ message, onAnswer }: { message: TaskMessage; onAnswer: (answer: string) => void }) {
  const options = message.metadata?.options;
  return (
    <div className="flex">
      <div className="max-w-[85%] rounded-lg border border-kad-border bg-kad-surface px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <AgentAvatar agentId={message.senderId} size={20} />
          <span className="kad-label text-kad-text-strong">{findAgent(message.senderId)?.displayName}</span>
        </div>
        <p className="kad-body text-kad-text">{message.content}</p>
        {options && options.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
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

function BriefCardBlock({ brief, onLock, onEdit }: { brief: BriefPayload; onLock: () => void; onEdit: () => void }) {
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
          <div className="mt-2 rounded-lg bg-[#fbf3e4] text-[#b97d10] px-2.5 py-2 kad-caption">⚠ Giả định: {brief.assumption}</div>
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
          <KadButton variant="primary" size="row" onClick={onLock}>
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
        <p className="kad-label text-kad-text-strong">Báo cáo kết quả{report.version > 1 ? ` · v${report.version}` : ""}</p>
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
          {report.decision!.status === "approved" ? "Đã duyệt" : "Yêu cầu sửa"} · {formatAbsoluteDateTime(report.decision!.at)}
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
            <KadButton variant="primary" size="row" disabled={reason.trim().length === 0} onClick={() => onRequestChanges(reason.trim())}>
              Gửi yêu cầu sửa
            </KadButton>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2 px-4 py-3">
          <KadButton variant="danger" size="row" onClick={() => setShowReason(true)}>
            Yêu cầu sửa
          </KadButton>
          <KadButton variant="primary" size="row" onClick={onApprove}>
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
          <KadButton variant="primary" size="row" onClick={onApprove}>
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
            placeholder={mode === "rejected" ? "Lý do từ chối (bắt buộc)…" : "Cần sửa gì (bắt buộc)…"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <KadButton
              variant={mode === "rejected" ? "danger" : "primary"}
              size="row"
              disabled={reason.trim().length === 0}
              onClick={() => (mode === "rejected" ? onReject(reason.trim()) : onNeedsChanges(reason.trim()))}
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
