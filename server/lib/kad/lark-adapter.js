/**
 * @file KAD <-> Lark adapter. Lark is a front-end over the existing KAD task
 * flow: messages/actions are normalized here, then written through the same
 * repo/orchestrator path as the web UI.
 */
const repo = require("./repo");
const orchestrator = require("./orchestrator");
const workflowEngine = require("./workflow-engine");
const { emitTask, emitDept } = require("./events");
const lark = require("./lark-client");
const { isOwnerOpenId, ownerOpenId } = require("./auth");

const OPEN_STATUSES = new Set([
  "blocked",
  "inbox",
  "triaged",
  "doing",
  "waiting_human",
  "review",
  "needs_changes",
  "failed",
]);

function defaultDeptId() {
  const d = repo.catalog.getDepartmentBySlug("rd");
  return d ? d.id : null;
}

function truncate(value, max) {
  const s = String(value == null ? "" : value).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function titleFromText(text) {
  const first =
    String(text || "")
      .split(/\r?\n/)
      .find(Boolean) || "Việc mới từ Lark";
  return truncate(first, 90) || "Việc mới từ Lark";
}

function isGroupChat(chatType) {
  return !["p2p", "private", "dm"].includes(String(chatType || "").toLowerCase());
}

function auditLark({ task_id, action, open_id, chat_id, target_type, target_id, details }) {
  const task = task_id ? repo.tasks.getTask(task_id) : null;
  return repo.audit({
    department_id: task ? task.department_id : defaultDeptId(),
    task_id: task_id || null,
    action,
    actor_type: "human",
    actor_id: "human",
    channel: "lark",
    target_type: target_type || null,
    target_id: target_id || null,
    details: { actor_ref: open_id || null, chat_id: chat_id || null, ...(details || {}) },
  });
}

function taskCreatedAuditDetails(taskId) {
  const rows = repo.listAudit({ task_id: taskId, action: "task_created", limit: 10 });
  const row = rows.find((r) => r.action === "task_created");
  return (row && row.details) || {};
}

function latestOpenTaskFromAudit(predicate) {
  const rows = repo.listAudit({ action: "task_created", limit: 1000 }).slice().reverse();
  for (const row of rows) {
    if (!predicate(row.details || {}, row)) continue;
    const task = row.task_id && repo.tasks.getTask(row.task_id);
    if (task && OPEN_STATUSES.has(task.status)) return task;
  }
  return null;
}

function findDmTask(openId, chatId) {
  return latestOpenTaskFromAudit(
    (d) =>
      d.channel === "lark" &&
      d.channel_actor_ref === openId &&
      d.channel_chat_type === "p2p" &&
      (!chatId || d.channel_context_ref === chatId)
  );
}

function findGroupTask(chatId) {
  const pinned = process.env.KAD_LARK_GROUP_TASK_ID;
  if (pinned) {
    const task = repo.tasks.getTask(pinned);
    if (task && OPEN_STATUSES.has(task.status)) return task;
  }
  return latestOpenTaskFromAudit(
    (d) =>
      d.channel === "lark" && d.channel_chat_type === "group" && d.channel_context_ref === chatId
  );
}

function createLarkTask({ text, open_id, chat_id, chat_type }) {
  const group = isGroupChat(chat_type);
  const task = repo.tasks.createTask({
    department_id: defaultDeptId(),
    title: group ? `Lark group: ${truncate(chat_id || "group", 60)}` : titleFromText(text),
    description: text,
    channel: "lark",
    channel_actor_ref: open_id,
    channel_context_ref: chat_id,
    channel_chat_type: group ? "group" : "p2p",
  });
  emitDept(task.department_id, "kad.task.status", { task_id: task.id, status: task.status });
  return task;
}

function enqueueEvaluateOnDone(task) {
  if (!task || !task.department_id) return;
  try {
    repo.jobs.enqueue({
      kind: "evaluate_rules",
      payload: { department_id: task.department_id, event: "task.done", task_id: task.id },
    });
  } catch (e) {
    console.warn(`[kad:lark] evaluate_rules enqueue failed for task ${task.id}:`, e && e.message);
  }
}

function addHumanMessage({ task, text, open_id }) {
  const msg = repo.tasks.addMessage({
    task_id: task.id,
    sender_type: "human",
    sender_id: "human",
    content: text,
    message_type: "chat",
    channel: "lark",
    channel_actor_ref: open_id,
  });
  emitTask(task.id, "kad.message.created", msg);

  const hasPriorRun = repo.runs.listByTask(task.id).length > 0;
  setImmediate(() => {
    const turn = hasPriorRun
      ? orchestrator.resumeTaskTurn(task.id, { message: text })
      : orchestrator.startTaskTurn(task.id);
    turn.catch((e) => console.warn(`[kad:lark] task turn(${task.id}) error:`, e && e.message));
  });
  return msg;
}

function handleIncomingMessage({ open_id, chat_id, chat_type, text, message_id }) {
  if (!open_id || !text) {
    return {
      status: 400,
      body: { error: { code: "EBADLARKMSG", message: "open_id and text are required" } },
    };
  }
  if (!isOwnerOpenId(open_id)) {
    auditLark({
      action: "lark_readonly_rejected",
      open_id,
      chat_id,
      details: { lark_message_id: message_id || null, reason: "non_owner_message" },
    });
    return {
      status: 403,
      body: { error: { code: "ELARKREADONLY", message: "Lark actor is read-only" } },
    };
  }

  const group = isGroupChat(chat_type);
  const task = group
    ? findGroupTask(chat_id) || createLarkTask({ text, open_id, chat_id, chat_type })
    : findDmTask(open_id, chat_id) || createLarkTask({ text, open_id, chat_id, chat_type: "p2p" });
  const msg = addHumanMessage({ task, text, open_id });
  return { status: 201, body: { task, message: msg, run_kicked: true } };
}

function lockBriefFromLark({ task_id, open_id, chat_id }) {
  const task = repo.tasks.getTask(task_id);
  if (!task)
    return { status: 404, body: { error: { code: "ENOTFOUND", message: "task not found" } } };
  const briefMsg = repo.tasks.latestMessageByType(task.id, "brief");
  if (!briefMsg || !briefMsg.metadata || !briefMsg.metadata.brief)
    return { status: 404, body: { error: { code: "ENOBRIEF", message: "no brief to lock" } } };
  if (briefMsg.metadata.brief.decidedAt)
    return {
      status: 409,
      body: { error: { code: "EALREADYDECIDED", message: "brief already locked" } },
    };

  const decidedAt = new Date().toISOString();
  const brief = { ...briefMsg.metadata.brief, decidedAt };
  let updatedMsg;
  repo.tx(() => {
    updatedMsg = repo.tasks.updateMessageMetadata(briefMsg.id, { brief });
    repo.tasks.updateTask(task.id, {
      brief,
      status: ["inbox", "triaged"].includes(task.status) ? "doing" : task.status,
    });
    auditLark({
      task_id: task.id,
      action: "brief_locked",
      open_id,
      chat_id,
      target_type: "message",
      target_id: briefMsg.id,
    });
  });
  emitTask(task.id, "kad.message.updated", updatedMsg);
  emitTask(task.id, "kad.task.status", {
    task_id: task.id,
    status: repo.tasks.getTask(task.id).status,
  });
  try {
    repo.jobs.enqueue({
      kind: "resume_task",
      payload: {
        task_id: task.id,
        message:
          "Brief đã được trưởng phòng CHỐT — không cần hỏi thêm gì nữa. HÀNH ĐỘNG DUY NHẤT của lượt này: gọi tool kad_plan_task với kế hoạch thực hiện (không nhắn text thường trước, không tool nào khác). Sau khi gọi kad_plan_task, DỪNG lượt ngay.",
      },
      dedupKey: `resume:${task.id}`,
    });
  } catch (e) {
    return {
      status: 200,
      body: { message: updatedMsg, resume_enqueued: false, resume_error: e && e.message },
    };
  }
  return { status: 200, body: { message: updatedMsg, resume_enqueued: true } };
}

function decideReportFromLark({ task_id, message_id, decision, reason, open_id, chat_id }) {
  const task = repo.tasks.getTask(task_id);
  if (!task)
    return { status: 404, body: { error: { code: "ENOTFOUND", message: "task not found" } } };
  const msg = repo.tasks.getMessage(message_id);
  if (!msg || msg.task_id !== task.id || msg.message_type !== "report")
    return {
      status: 404,
      body: { error: { code: "ENOTFOUND", message: "report message not found" } },
    };
  const report = msg.metadata && msg.metadata.report;
  if (!report)
    return {
      status: 400,
      body: { error: { code: "EBADSTATE", message: "message has no report payload" } },
    };
  if (report.decision)
    return {
      status: 409,
      body: {
        error: { code: "EALREADYDECIDED", message: `report already ${report.decision.status}` },
      },
    };
  if (!["approved", "needs_changes"].includes(decision))
    return {
      status: 400,
      body: { error: { code: "EBADDECISION", message: "decision must be approved|needs_changes" } },
    };

  const at = new Date().toISOString();
  let updatedMsg;
  repo.tx(() => {
    if (decision === "approved") {
      for (const a of report.artifacts || []) {
        const art = repo.artifacts.getArtifact(a.artifactId);
        if (art && art.status !== "approved")
          repo.artifacts.updateArtifact(art.id, { status: "approved" });
      }
    }
    const finalReason = reason || "Yêu cầu sửa từ Lark";
    const reportDecision =
      decision === "needs_changes"
        ? { status: decision, at, reason: finalReason }
        : { status: decision, at };
    updatedMsg = repo.tasks.updateMessageMetadata(msg.id, {
      report: { ...report, decision: reportDecision },
    });
    repo.tasks.updateTask(task.id, { status: decision === "approved" ? "done" : "needs_changes" });
    if (decision === "needs_changes") {
      repo.tasks.addMessage({
        task_id: task.id,
        sender_type: "human",
        sender_id: "human",
        content: finalReason,
        message_type: "chat",
        channel: "lark",
        channel_actor_ref: open_id,
      });
      repo.learning.createNote({
        department_id: task.department_id,
        task_id: task.id,
        trigger_type: "human_revision",
        feedback_content: finalReason,
        severity: "major",
        affected_areas: ["report"],
      });
    }
    auditLark({
      task_id: task.id,
      action: "report_decided",
      open_id,
      chat_id,
      target_type: "message",
      target_id: msg.id,
      details: { decision },
    });
  });
  emitTask(task.id, "kad.message.updated", updatedMsg);
  emitTask(task.id, "kad.task.status", {
    task_id: task.id,
    status: repo.tasks.getTask(task.id).status,
  });
  if (decision === "approved") {
    try {
      workflowEngine.syncStep(task.id);
    } catch (e) {
      console.warn(`[kad:lark] report/decide syncStep failed for task ${task.id}:`, e && e.message);
    }
    enqueueEvaluateOnDone(repo.tasks.getTask(task.id));
  }
  if (decision === "needs_changes") {
    try {
      repo.jobs.enqueue({
        kind: "resume_task",
        payload: {
          task_id: task.id,
          message: `Trưởng phòng YÊU CẦU SỬA báo cáo. Lý do: ${reason || "Yêu cầu sửa từ Lark"}. Hãy xử lý rồi gửi báo cáo mới (kad_present_report) khi xong.`,
        },
        dedupKey: `resume:${task.id}`,
      });
    } catch (e) {
      return {
        status: 200,
        body: { message: updatedMsg, resume_enqueued: false, resume_error: e && e.message },
      };
    }
  }
  return {
    status: 200,
    body: { message: updatedMsg, resume_enqueued: decision === "needs_changes" },
  };
}

function handleCardAction({ open_id, chat_id, value }) {
  if (!open_id || !value || typeof value !== "object") {
    return {
      status: 400,
      body: { error: { code: "EBADACTION", message: "open_id and action value are required" } },
    };
  }
  if (!isOwnerOpenId(open_id)) {
    auditLark({
      task_id: value.task_id,
      action: "lark_action_denied",
      open_id,
      chat_id,
      target_type: value.message_id ? "message" : "task",
      target_id: value.message_id || value.task_id || null,
      details: { kad_action: value.kad_action || null, reason: "non_owner_action" },
    });
    return {
      status: 403,
      body: { error: { code: "ELARKREADONLY", message: "Lark actor is read-only" } },
    };
  }

  if (value.kad_action === "reply") {
    const task = repo.tasks.getTask(value.task_id);
    if (!task)
      return { status: 404, body: { error: { code: "ENOTFOUND", message: "task not found" } } };
    const msg = addHumanMessage({ task, text: value.reply || "", open_id });
    return { status: 201, body: { task, message: msg, run_kicked: true } };
  }
  if (value.kad_action === "brief_lock") {
    return lockBriefFromLark({ task_id: value.task_id, open_id, chat_id });
  }
  if (value.kad_action === "report_approve") {
    return decideReportFromLark({
      task_id: value.task_id,
      message_id: value.message_id,
      decision: "approved",
      open_id,
      chat_id,
    });
  }
  if (value.kad_action === "report_changes") {
    return decideReportFromLark({
      task_id: value.task_id,
      message_id: value.message_id,
      decision: "needs_changes",
      reason: value.reason,
      open_id,
      chat_id,
    });
  }
  return { status: 400, body: { error: { code: "EBADACTION", message: "unknown Lark action" } } };
}

function md(value) {
  return String(value == null ? "" : value).replace(/([*_`])/g, "\\$1");
}

function button(text, type, value) {
  return { tag: "button", text: { tag: "plain_text", content: text }, type, value };
}

function renderTaskMessageCard(message, task) {
  const base = {
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: task ? task.title : "KAD" },
    },
    elements: [],
  };

  if (message.message_type === "intake_question") {
    const options = (message.metadata && message.metadata.options) || [];
    base.header.template = "wathet";
    base.elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `**Cần anh trả lời**\n${md(message.content)}` },
    });
    if (options.length) {
      base.elements.push({
        tag: "action",
        actions: options.slice(0, 4).map((opt) =>
          button(truncate(opt, 30), "default", {
            kad_action: "reply",
            task_id: message.task_id,
            reply: opt,
          })
        ),
      });
    }
    return base;
  }

  if (message.message_type === "brief") {
    const brief = message.metadata && message.metadata.brief;
    base.header.template = "turquoise";
    base.elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: [
          "**Brief chờ chốt**",
          brief && `Mục tiêu: ${md(brief.goal)}`,
          brief && `Deliverable: ${md(brief.deliverable)}`,
          brief && `Workflow: ${md(brief.workflowName)}`,
          brief && `Hạn: ${md(brief.dueLabel)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });
    if (!brief || !brief.decidedAt) {
      base.elements.push({
        tag: "action",
        actions: [
          button("Chốt & giao", "primary", { kad_action: "brief_lock", task_id: message.task_id }),
        ],
      });
    }
    return base;
  }

  if (message.message_type === "report") {
    const report = message.metadata && message.metadata.report;
    base.header.template = "green";
    const artifacts = (report && report.artifacts) || [];
    base.elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: [
          `**Báo cáo kết quả${report && report.version ? ` v${report.version}` : ""}**`,
          report && md(report.summary),
          artifacts.length ? `Artifacts: ${artifacts.map((a) => md(a.title)).join(", ")}` : null,
          report && report.cost ? `Chi phí vòng này: ${report.cost.vnd || 0} VND` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });
    if (!report || !report.decision) {
      base.elements.push({
        tag: "action",
        actions: [
          button("Duyệt tất cả", "primary", {
            kad_action: "report_approve",
            task_id: message.task_id,
            message_id: message.id,
          }),
          button("Yêu cầu sửa", "default", {
            kad_action: "report_changes",
            task_id: message.task_id,
            message_id: message.id,
            reason: "Yêu cầu sửa từ Lark",
          }),
        ],
      });
    }
    return base;
  }

  base.elements.push({ tag: "div", text: { tag: "lark_md", content: md(message.content) } });
  return base;
}

function destinationsForMessage(message, task) {
  const details = taskCreatedAuditDetails(task.id);
  const out = [];
  if (details.channel_context_ref && details.channel_chat_type === "group") {
    out.push({ receiveId: details.channel_context_ref, receiveIdType: "chat_id" });
  } else if (details.channel_actor_ref) {
    out.push({ receiveId: details.channel_actor_ref, receiveIdType: "open_id" });
  }
  if (message.message_type === "report") {
    const reportChat =
      process.env.KAD_LARK_REPORT_CHAT_ID || process.env.KAD_LARK_GROUP_CHAT_ID || "";
    if (reportChat && !out.some((d) => d.receiveId === reportChat)) {
      out.push({ receiveId: reportChat, receiveIdType: "chat_id" });
    }
  }
  return out;
}

function pushTaskMessage(message) {
  if (!message || !["intake_question", "brief", "report"].includes(message.message_type)) {
    return Promise.resolve({ ok: false, skipped: true, reason: "unsupported_message_type" });
  }
  const task = repo.tasks.getTask(message.task_id);
  if (!task) return Promise.resolve({ ok: false, skipped: true, reason: "task_not_found" });
  const card = renderTaskMessageCard(message, task);
  const destinations = destinationsForMessage(message, task);
  if (!destinations.length)
    return Promise.resolve({ ok: false, skipped: true, reason: "no_lark_destination" });

  return Promise.all(
    destinations.map((d) =>
      lark
        .sendInteractiveCard({ receiveId: d.receiveId, receiveIdType: d.receiveIdType, card })
        .catch((e) => ({ ok: false, error: e && e.message }))
    )
  );
}

function extractTextContent(content) {
  if (!content) return "";
  if (typeof content === "object") return content.text || "";
  try {
    const parsed = JSON.parse(content);
    return parsed.text || "";
  } catch {
    return String(content);
  }
}

function normalizeEvent(body) {
  const event = body && (body.event || (body.header && body.event));
  const message = event && event.message;
  const sender = event && event.sender;
  if (!message || !sender) return null;
  return {
    open_id:
      sender.sender_id?.open_id ||
      sender.sender_id?.user_id ||
      sender.open_id ||
      sender.user_id ||
      null,
    chat_id: message.chat_id || message.chat_id_str || null,
    chat_type: message.chat_type || "p2p",
    text: extractTextContent(message.content),
    message_id: message.message_id || null,
  };
}

function normalizeAction(body) {
  const event = body && (body.event || body);
  const operator = event.operator || event.user || {};
  const action = event.action || body.action || {};
  return {
    open_id:
      event.open_id ||
      operator.operator_id?.open_id ||
      operator.open_id ||
      operator.user_id ||
      null,
    chat_id: event.context?.open_chat_id || event.open_chat_id || event.chat_id || null,
    value: action.value || {},
  };
}

module.exports = {
  handleIncomingMessage,
  handleCardAction,
  normalizeEvent,
  normalizeAction,
  renderTaskMessageCard,
  pushTaskMessage,
  ownerOpenId,
};
