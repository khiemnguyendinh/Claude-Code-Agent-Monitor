/**
 * Tab "Tổ chức" — 04-man-doi-ngu.md §1. Hub-and-spoke org chart (1a) + quy
 * trình chuẩn (1b) + luồng đang chạy trực tiếp (1c). No lines between
 * sub-agents on purpose — that empty space IS the point (centralized
 * management model, not peer-to-peer).
 *
 * 1b/1c thay cho grid "Nhân sự" ban đầu (PersonnelCard) — bị bỏ 2026-07-04
 * theo góp ý anh Khiêm: grid đó trùng chức năng với peek khi click node
 * trên sơ đồ 1a. Thay bằng 2 khối có giá trị riêng, không lặp lại cấu trúc
 * cây tĩnh ở trên: quy trình chuẩn của phòng ban (tĩnh, RD_WORKFLOW) và
 * các phiên đang thực sự chạy ngay lúc này (động, từ TASK_CARDS).
 */
import { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { RD_WORKFLOW } from "../../mockData";
import { kadApi } from "../../api-client";
import type { OrgChartNodeRow } from "../../api-client";
import type { AgentProfile } from "../../types";
import { usePeek } from "../../components/PeekDrawer";
import { AgentAvatar, HumanAvatar } from "../../components/Avatar";
import { KadButton, KadCard, KadInput, KadSkeleton } from "../../components/primitives";
import { useKadToast } from "../../components/Toast";

export function ToChucTab() {
  const { openPeek } = usePeek();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [nodes, setNodes] = useState<OrgChartNodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useKadToast();

  useEffect(() => {
    Promise.all([kadApi.agents.list(), kadApi.orgContext.orgChart()])
      .then(([agentRows, nodeRows]) => {
        setAgents(agentRows);
        setNodes(nodeRows);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <KadSkeleton className="h-72 w-full" />;

  const subAgents = agents.filter((a) => a.agentType === "sub");
  const mainAgent = agents.find((a) => a.agentType === "main");
  const helperGhosts = agents.filter((a) => a.agentType === "helper");

  return (
    <div className="space-y-8">
      {/* 1a — sơ đồ tổ chức */}
      <KadCard>
        <div className="overflow-x-auto pb-2">
          <div className="flex flex-col items-center min-w-fit px-4">
            <NodeCard kind="human" name="Anh Khiêm" title="Trưởng phòng R&D" />
            <div className="w-px h-6 bg-kad-text-faint" />
            {mainAgent && (
              <NodeCard
                kind="main"
                agentId={mainAgent.id}
                agentName={mainAgent.name}
                name={mainAgent.displayName}
                title="Điều phối"
              />
            )}

            <div className="relative" style={{ width: Math.max(subAgents.length, 1) * 152 - 12 }}>
              <svg
                className="absolute left-0 top-0 w-full h-6 pointer-events-none"
                preserveAspectRatio="none"
                viewBox={`0 0 ${Math.max(subAgents.length, 1) * 152 - 12} 24`}
              >
                <line
                  x1={(Math.max(subAgents.length, 1) * 152 - 12) / 2}
                  y1="0"
                  x2={(Math.max(subAgents.length, 1) * 152 - 12) / 2}
                  y2="8"
                  stroke="var(--kad-text-faint)"
                  strokeWidth="1.5"
                />
                <line
                  x1={70}
                  y1="8"
                  x2={(Math.max(subAgents.length, 1) - 1) * 152 + 70}
                  y2="8"
                  stroke="var(--kad-text-faint)"
                  strokeWidth="1.5"
                />
                {subAgents.map((_, i) => (
                  <line
                    key={i}
                    x1={i * 152 + 70}
                    y1="8"
                    x2={i * 152 + 70}
                    y2="24"
                    stroke="var(--kad-text-faint)"
                    strokeWidth="1.5"
                  />
                ))}
              </svg>
              <div className="flex gap-3 pt-6">
                {subAgents.map((agent) => {
                  const helper = helperGhosts.find((h) => h.parentAgentId === agent.id);
                  return (
                    <div key={agent.id} className="flex flex-col items-center">
                      <button
                        type="button"
                        onClick={() => openPeek({ type: "agent", id: agent.id })}
                      >
                        <NodeCard
                          kind="sub"
                          agentId={agent.id}
                          agentName={agent.name}
                          name={agent.displayName}
                          title={agent.title || agent.name}
                        />
                      </button>
                      {helper && (
                        <>
                          <div className="w-px h-4 border-l border-dashed border-kad-text-faint" />
                          <div className="w-[110px] rounded-lg border border-dashed border-kad-text-faint px-1.5 py-1 text-center">
                            <p className="kad-caption text-kad-text-muted leading-tight">
                              Trợ thủ tạm thời
                            </p>
                            <p className="kad-caption text-kad-text-faint">helper</p>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <p className="kad-caption text-kad-text-faint mt-4 text-center">
          Đường nối = giao việc / báo cáo (2 chiều giữa Trưởng phòng ↔ Trợ lý vận hành). Không có
          đường ngang giữa các thành viên AI — mọi điều phối đi qua Trợ lý vận hành.
        </p>
      </KadCard>

      {/* 1b — quy trình chuẩn */}
      <WorkflowSection agents={agents} />
      <OrgChartEditor
        nodes={nodes}
        onChange={setNodes}
        onSave={() => {
          kadApi.orgContext
            .updateOrgChart(nodes)
            .then((saved) => {
              setNodes(saved);
              toast({ message: "Đã lưu org chart.", tone: "success" });
            })
            .catch((e) =>
              toast({
                message: e instanceof Error ? e.message : "Không lưu được org chart.",
                tone: "warning",
              })
            );
        }}
      />
      <AgentAssignment
        agents={agents}
        nodes={nodes}
        onChange={setNodes}
        onSave={() => {
          kadApi.orgContext
            .updateOrgChart(nodes)
            .then((saved) => {
              setNodes(saved);
              toast({ message: "Đã lưu phân quyền nhân sự.", tone: "success" });
            })
            .catch((e) =>
              toast({
                message: e instanceof Error ? e.message : "Không lưu được phân quyền.",
                tone: "warning",
              })
            );
        }}
      />
    </div>
  );
}

function NodeCard({
  kind,
  agentId,
  agentName,
  name,
  title,
}: {
  kind: "human" | "main" | "sub";
  agentId?: string;
  agentName?: string;
  name: string;
  title: string;
}) {
  return (
    <div
      className={`w-[140px] h-16 rounded-lg border flex items-center gap-2 px-2.5 flex-shrink-0 ${
        kind === "human"
          ? "border-[1.5px] border-kad-primary bg-kad-surface"
          : kind === "main"
            ? "border-kad-border bg-kad-surface-2"
            : "border-kad-border bg-kad-surface"
      }`}
    >
      {kind === "human" ? (
        <HumanAvatar name={name} size={28} />
      ) : (
        <AgentAvatar
          agentId={agentId ?? ""}
          size={28}
          status="running"
          displayNameOverride={name}
          agentNameOverride={agentName}
        />
      )}
      <div className="min-w-0 text-left">
        <p className="kad-caption font-medium text-kad-text-strong leading-tight line-clamp-2">
          {name}
        </p>
        <p className="kad-caption text-kad-text-faint leading-tight truncate">{title}</p>
      </div>
    </div>
  );
}

// ── 1b — Quy trình chuẩn ─────────────────────────────────────────────────
// Chỉ render workflow thật đang có (RD_WORKFLOW) — không bịa thêm quy
// trình khác. Cấu trúc để sẵn cho nhiều workflow (map qua 1 mảng), nên khi
// phòng ban có thêm loại việc mới chỉ cần thêm phần tử, không đổi UI.

const WORKFLOWS = [RD_WORKFLOW];

function WorkflowSection({ agents }: { agents: AgentProfile[] }) {
  return (
    <div>
      <h3 className="kad-heading text-kad-text-strong mb-3">Quy trình chuẩn</h3>
      <div className="space-y-4">
        {WORKFLOWS.map((wf) => (
          <KadCard key={wf.id}>
            <div className="flex items-center justify-between mb-3">
              <p className="kad-label text-kad-text-strong">{wf.name}</p>
              <span className="kad-caption text-kad-text-faint">{wf.description}</span>
            </div>
            <div className="flex items-center overflow-x-auto pb-1 -mx-1 px-1">
              {wf.steps.map((step, i) => {
                const agent = agents.find((a) => a.name === step.agentName);
                const isLast = i === wf.steps.length - 1;
                return (
                  <div key={step.key} className="flex items-center flex-shrink-0">
                    <div className="w-[132px] flex flex-col items-center text-center gap-1.5 px-1">
                      {agent ? (
                        <AgentAvatar
                          agentId={agent.id}
                          size={28}
                          displayNameOverride={agent.displayName}
                          agentNameOverride={agent.name}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-kad-surface-2" />
                      )}
                      <p className="kad-label text-kad-text-strong leading-tight">{step.label}</p>
                      <p className="kad-caption text-kad-text-faint truncate w-full">
                        {agent?.displayName ?? step.agentName}
                      </p>
                      {step.approval && (
                        <span className="kad-caption inline-flex items-center gap-1 text-kad-warning">
                          <ShieldCheck className="w-3 h-3" aria-hidden />
                          Cần duyệt
                        </span>
                      )}
                    </div>
                    {!isLast && (
                      <ArrowRight
                        className="w-4 h-4 text-kad-text-faint flex-shrink-0 mx-1"
                        aria-hidden
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </KadCard>
        ))}
      </div>
    </div>
  );
}

function OrgChartEditor({
  nodes,
  onChange,
  onSave,
}: {
  nodes: OrgChartNodeRow[];
  onChange: (nodes: OrgChartNodeRow[]) => void;
  onSave: () => void;
}) {
  const update = (id: string, patch: Partial<OrgChartNodeRow>) => {
    onChange(nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  };
  const addNode = () => {
    onChange([
      ...nodes,
      {
        id: `node-${Date.now()}`,
        name: "",
        node_type: "department",
        parent_id: null,
        agent_id: null,
        sort_order: nodes.length,
      },
    ]);
  };
  const removeNode = (id: string) => {
    onChange(nodes.filter((n) => n.id !== id));
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="kad-heading text-kad-text-strong">Org chart editor</h3>
        <div className="flex gap-2">
          <KadButton size="row" variant="secondary" onClick={addNode}>
            + Thêm node
          </KadButton>
          <KadButton size="row" variant="primary" onClick={onSave}>
            Lưu
          </KadButton>
        </div>
      </div>
      <div className="space-y-2">
        {nodes.map((node) => (
          <div
            key={node.id}
            className="grid grid-cols-1 sm:grid-cols-[1fr_150px_1fr_auto] gap-2 border border-kad-border rounded-lg p-3 items-center"
          >
            <KadInput
              value={node.name}
              onChange={(e) => update(node.id, { name: e.target.value })}
              placeholder="Tên node"
            />
            <select
              value={node.node_type}
              onChange={(e) =>
                update(node.id, { node_type: e.target.value as OrgChartNodeRow["node_type"] })
              }
              className="kad-body h-9 rounded-lg bg-kad-surface-2 px-3 text-kad-text"
            >
              <option value="company">company</option>
              <option value="department">department</option>
              <option value="position">position</option>
            </select>
            <KadInput
              value={node.parent_id ?? ""}
              onChange={(e) => update(node.id, { parent_id: e.target.value || null })}
              placeholder="Parent ID"
            />
            <button
              onClick={() => removeNode(node.id)}
              className="p-2 text-kad-text-faint hover:text-kad-error rounded-lg"
              title="Xóa"
            >
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentAssignment({
  agents,
  nodes,
  onChange,
  onSave,
}: {
  agents: AgentProfile[];
  nodes: OrgChartNodeRow[];
  onChange: (nodes: OrgChartNodeRow[]) => void;
  onSave: () => void;
}) {
  const assignAgentToNode = (agentId: string, nodeId: string | null) => {
    let newNodes = nodes.map((n) => (n.agent_id === agentId ? { ...n, agent_id: null } : n));
    if (nodeId) {
      newNodes = newNodes.map((n) => (n.id === nodeId ? { ...n, agent_id: agentId } : n));
    }
    onChange(newNodes);
  };

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="kad-heading text-kad-text-strong">Phân quyền nhân sự số</h3>
        <KadButton size="row" variant="primary" onClick={onSave}>
          Lưu
        </KadButton>
      </div>
      <div className="space-y-2">
        {agents.map((agent) => {
          const assignedNode = nodes.find((n) => n.agent_id === agent.id);
          return (
            <div
              key={agent.id}
              className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-2 border border-kad-border rounded-lg p-3 items-center"
            >
              <div className="flex items-center gap-2">
                <AgentAvatar
                  agentId={agent.id}
                  size={28}
                  displayNameOverride={agent.displayName}
                  agentNameOverride={agent.name}
                />
                <span>{agent.displayName}</span>
              </div>
              <select
                value={assignedNode?.id || ""}
                onChange={(e) => assignAgentToNode(agent.id, e.target.value || null)}
                className="kad-body h-9 rounded-lg bg-kad-surface-2 px-3 text-kad-text"
              >
                <option value="">-- Không gán --</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.node_type})
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
