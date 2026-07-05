/**
 * "Đang chạy trực tiếp" (live flow) — vốn là 04-man-doi-ngu §1c; 2026-07-04
 * chuyển sang tab "Công việc" của trang /he-thong/kanban (spec/ui/08) theo yêu
 * cầu Khiêm. [Phase 7 hardening] nguồn thật: `/api/kad/tasks` status=doing +
 * assignedAgentId (do KanbanBoard fetch, truyền xuống) — thay TASK_CARDS mock.
 * `onOpenTask` do nơi nhúng quyết định — mở khay peek (khi có PeekDrawerHost)
 * hoặc điều hướng.
 */
import { Zap } from "lucide-react";
import { AgentAvatar } from "./Avatar";
import { KadCard, KadEmptyState } from "./primitives";
import { StatusChip } from "./StatusChip";
import { formatRelativeTime } from "../format";
import type { AgentProfile } from "../types";
import type { KadTask } from "../api-client";

export function LiveFlowSection({
  mainAgent,
  tasks,
  agentsById,
  onOpenTask,
}: {
  mainAgent: AgentProfile | undefined;
  tasks: KadTask[];
  agentsById: Map<string, AgentProfile>;
  onOpenTask: (taskId: string) => void;
}) {
  const running = tasks.filter((t) => t.status === "doing" && t.assignedAgentId);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h3 className="kad-heading text-kad-text-strong">Đang chạy trực tiếp</h3>
        {running.length > 0 && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-kad-success animate-[kad-breathe_2.4s_ease-in-out_infinite]"
            aria-hidden
          />
        )}
      </div>
      <p className="kad-caption text-kad-text-faint mb-3">
        Các phiên Trợ lý vận hành đang giao việc ngay lúc này — bấm để xem chi tiết.
      </p>
      <KadCard padding="sm">
        {running.length === 0 ? (
          <KadEmptyState icon={Zap} message="Không có phiên nào đang chạy." />
        ) : (
          <div>
            {running.map((task) => (
              <FlowRow
                key={task.id}
                mainAgent={mainAgent}
                task={task}
                agentsById={agentsById}
                onOpen={() => onOpenTask(task.id)}
              />
            ))}
          </div>
        )}
      </KadCard>
    </div>
  );
}

function FlowRow({
  mainAgent,
  task,
  agentsById,
  onOpen,
}: {
  mainAgent: AgentProfile | undefined;
  task: KadTask;
  agentsById: Map<string, AgentProfile>;
  onOpen: () => void;
}) {
  if (!task.assignedAgentId) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-2.5 py-2 px-1.5 rounded-lg border-b border-kad-border last:border-0 hover:bg-kad-surface-2 text-left"
    >
      {mainAgent && <AgentAvatar agentId={mainAgent.id} size={24} />}
      <svg width="36" height="14" className="flex-shrink-0" aria-hidden>
        <line
          x1="1"
          y1="7"
          x2="35"
          y2="7"
          stroke="var(--kad-accent)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          strokeLinecap="round"
          className="kad-flow-line"
        />
      </svg>
      <AgentAvatar agentId={task.assignedAgentId} size={24} status="running" />
      <div className="min-w-0 flex-1">
        <p className="kad-body text-kad-text truncate">{task.title}</p>
        <p className="kad-caption text-kad-text-faint">
          {(task.assignedAgentId && agentsById.get(task.assignedAgentId)?.displayName) || "—"} ·{" "}
          {formatRelativeTime(task.updatedAt)}
        </p>
      </div>
      <StatusChip kind="doing" label="Đang chạy" />
    </button>
  );
}
