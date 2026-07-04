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
import { ArrowRight, ShieldCheck } from "lucide-react";
import { AGENTS, ORG_CHART_NODES, RD_WORKFLOW } from "../../mockData";
import { usePeek } from "../../components/PeekDrawer";
import { AgentAvatar, HumanAvatar } from "../../components/Avatar";
import { KadCard } from "../../components/primitives";

export function ToChucTab() {
  const { openPeek } = usePeek();
  const subAgents = AGENTS.filter((a) => a.agentType === "sub");
  const mainAgent = AGENTS.find((a) => a.agentType === "main");
  const helperGhosts = ORG_CHART_NODES.filter((n) => n.isHelperGhost);

  return (
    <div className="space-y-8">
      {/* 1a — sơ đồ tổ chức */}
      <KadCard>
        <div className="overflow-x-auto pb-2">
          <div className="flex flex-col items-center min-w-fit px-4">
            <NodeCard kind="human" name="Anh Khiêm" title="Trưởng phòng R&D" />
            <div className="w-px h-6 bg-kad-text-faint" />
            {mainAgent && (
              <NodeCard kind="main" agentId={mainAgent.id} name={mainAgent.displayName} title="Điều phối" />
            )}

            <div className="relative" style={{ width: subAgents.length * 152 - 12 }}>
              <svg
                className="absolute left-0 top-0 w-full h-6 pointer-events-none"
                preserveAspectRatio="none"
                viewBox={`0 0 ${subAgents.length * 152 - 12} 24`}
              >
                <line
                  x1={(subAgents.length * 152 - 12) / 2}
                  y1="0"
                  x2={(subAgents.length * 152 - 12) / 2}
                  y2="8"
                  stroke="var(--kad-text-faint)"
                  strokeWidth="1.5"
                />
                <line
                  x1={70}
                  y1="8"
                  x2={(subAgents.length - 1) * 152 + 70}
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
                  const helper = helperGhosts.find((h) => h.parentId === `node-${agent.id}`);
                  return (
                    <div key={agent.id} className="flex flex-col items-center">
                      <button type="button" onClick={() => openPeek({ type: "agent", id: agent.id })}>
                        <NodeCard kind="sub" agentId={agent.id} name={agent.displayName} title={agent.title} />
                      </button>
                      {helper && (
                        <>
                          <div className="w-px h-4 border-l border-dashed border-kad-text-faint" />
                          <div className="w-[110px] rounded-lg border border-dashed border-kad-text-faint px-1.5 py-1 text-center">
                            <p className="kad-caption text-kad-text-muted leading-tight">Trợ thủ tạm thời</p>
                            <p className="kad-caption text-kad-text-faint">
                              hết hạn sau {helper.helperExpiresInMinutes}ph
                            </p>
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
          Đường nối = giao việc / báo cáo (2 chiều giữa Trưởng phòng ↔ Trợ lý vận hành). Không có đường ngang giữa các
          thành viên AI — mọi điều phối đi qua Trợ lý vận hành.
        </p>
      </KadCard>

      {/* 1b — quy trình chuẩn */}
      <WorkflowSection />
    </div>
  );
}

function NodeCard({
  kind,
  agentId,
  name,
  title,
}: {
  kind: "human" | "main" | "sub";
  agentId?: string;
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
        <AgentAvatar agentId={agentId ?? ""} size={28} status="running" />
      )}
      <div className="min-w-0 text-left">
        <p className="kad-caption font-medium text-kad-text-strong leading-tight line-clamp-2">{name}</p>
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

function WorkflowSection() {
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
                const agent = AGENTS.find((a) => a.name === step.agentName);
                const isLast = i === wf.steps.length - 1;
                return (
                  <div key={step.key} className="flex items-center flex-shrink-0">
                    <div className="w-[132px] flex flex-col items-center text-center gap-1.5 px-1">
                      {agent ? (
                        <AgentAvatar agentId={agent.id} size={28} />
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
                      <ArrowRight className="w-4 h-4 text-kad-text-faint flex-shrink-0 mx-1" aria-hidden />
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

