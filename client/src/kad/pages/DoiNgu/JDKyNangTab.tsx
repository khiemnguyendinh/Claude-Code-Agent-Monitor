import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { kadApi } from "../../api-client";
import type { BlueprintRow, TemplateLibraryRow } from "../../api-client";
import type { AgentProfile } from "../../types";
import { useKadToast } from "../../components/Toast";
import { AgentAvatar } from "../../components/Avatar";
import { KadButton, KadErrorBlock, KadSkeleton } from "../../components/primitives";
import { MarkdownLite } from "../../components/MarkdownLite";
import { OrgContextImportModal } from "../../components/OrgContextImportModal";

export function JDKyNangTab() {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [templates, setTemplates] = useState<TemplateLibraryRow[]>([]);
  const [blueprints, setBlueprints] = useState<BlueprintRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const toast = useKadToast();

  const refresh = () => {
    setLoading(true);
    setError(false);
    Promise.all([kadApi.agents.list(), kadApi.templates.list(), kadApi.orgContext.blueprints()])
      .then(([agentRows, templateRows, blueprintRows]) => {
        setAgents(agentRows);
        setTemplates(templateRows);
        setBlueprints(blueprintRows);
        setSelectedId((prev) => prev || agentRows[0]?.id || "");
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        <KadSkeleton className="h-64 w-full" />
        <KadSkeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error) return <KadErrorBlock onRetry={refresh} />;

  const agent = agents.find((a) => a.id === selectedId) || agents[0];
  const approved = blueprints.find((bp) => bp.status === "approved");
  const pending = blueprints.find((bp) => bp.status === "pending_approval");
  const visibleTemplates = agent?.permissions.readTemplates ? templates : [];

  const proposeBlueprint = (summary: string) => {
    if (!approved) return;
    kadApi.orgContext
      .proposeBlueprint(approved.id, {
        data: {
          ...approved.data,
          last_ui_proposal: {
            summary,
            agent_id: agent?.id,
            proposed_at: new Date().toISOString(),
          },
        },
        change_summary: summary,
      })
      .then(() => {
        toast({ message: "Đã gửi duyệt thay đổi blueprint.", tone: "success" });
        refresh();
      })
      .catch((e) =>
        toast({
          message: e instanceof Error ? e.message : "Không gửi được blueprint.",
          tone: "warning",
        })
      );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <div className="border border-kad-border rounded-xl overflow-hidden h-fit">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelectedId(a.id)}
            className={`w-full h-11 flex items-center gap-2.5 px-3 border-b border-kad-border last:border-0 text-left ${
              a.id === agent?.id ? "bg-kad-surface-2" : "hover:bg-kad-surface-2/60"
            }`}
          >
            <AgentAvatar
              agentId={a.id}
              size={20}
              displayNameOverride={a.displayName}
              agentNameOverride={a.name}
            />
            <div className="min-w-0">
              <p className="kad-label text-kad-text-strong truncate">{a.displayName}</p>
            </div>
          </button>
        ))}
      </div>

      {agent && (
        <div className="space-y-6 max-w-[720px]">
          <div className="flex justify-end">
            <KadButton variant="secondary" size="row" onClick={() => setIsImportModalOpen(true)}>
              📥 Import JD & Kỹ năng
            </KadButton>
          </div>
          {pending && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-[#fbf3e4] px-3 py-2">
              <p className="kad-caption text-[#99690f]">
                Blueprint v{pending.version} đang chờ duyệt.
              </p>
              <KadButton
                variant="primary"
                size="row"
                onClick={() => {
                  kadApi.orgContext
                    .decideBlueprint(pending.id, "approved")
                    .then(() => {
                      toast({ message: "Đã duyệt blueprint mới.", tone: "success" });
                      refresh();
                    })
                    .catch((e) =>
                      toast({
                        message: e instanceof Error ? e.message : "Không duyệt được blueprint.",
                        tone: "warning",
                      })
                    );
                }}
              >
                Duyệt
              </KadButton>
            </div>
          )}

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="kad-title text-kad-text-strong">JD — {agent.displayName}</h2>
              <KadButton
                variant="ghost"
                size="row"
                onClick={() => proposeBlueprint(`Đề xuất sửa JD cho ${agent.name}`)}
              >
                Đề xuất sửa
              </KadButton>
            </div>
            <MarkdownLite content={agent.roleDescription || "(chưa có JD)"} />
            <p className="kad-caption text-kad-text-faint mt-2">
              Blueprint v{approved?.version ?? "-"} · duyệt{" "}
              {approved?.approved_at
                ? new Date(approved.approved_at).toLocaleDateString("vi-VN")
                : "chưa có"}
            </p>
          </section>

          <section className="pt-4 border-t border-kad-border">
            <div className="flex items-center justify-between mb-2">
              <h3 className="kad-heading text-kad-text-strong">
                Kỹ năng (prompt pack & templates)
              </h3>
              <KadButton
                variant="ghost"
                size="row"
                icon={Plus}
                onClick={() => proposeBlueprint(`Đề xuất thêm kỹ năng cho ${agent.name}`)}
              >
                Thêm kỹ năng
              </KadButton>
            </div>
            <div className="space-y-2">
              {visibleTemplates.length === 0 ? (
                <p className="kad-body text-kad-text-faint">
                  Agent này chưa được cấp quyền đọc template.
                </p>
              ) : (
                visibleTemplates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between gap-3 border border-kad-border rounded-lg px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="kad-body text-kad-text truncate">{tpl.name}</p>
                      <p className="kad-caption text-kad-text-muted truncate">
                        {tpl.template_type} · v{tpl.approved_version?.version ?? "-"} ·{" "}
                        {tpl.usage_count} lượt dùng
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 flex-shrink-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked
                        readOnly
                        onClick={() =>
                          proposeBlueprint(
                            `Đề xuất đổi quyền template ${tpl.name} cho ${agent.name}`
                          )
                        }
                        style={{ accentColor: "var(--kad-accent)" }}
                      />
                      <span className="kad-caption text-kad-text-muted">Bật</span>
                    </label>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="pt-4 border-t border-kad-border">
            <h3 className="kad-heading text-kad-text-strong mb-2">Cấu hình engine</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="kad-caption text-kad-text-muted">Engine</p>
                <p className="kad-body text-kad-text capitalize">{agent.engine}</p>
              </div>
              <div>
                <p className="kad-caption text-kad-text-muted">Model</p>
                <p className="kad-body text-kad-text">{agent.model || "Claude CLI"}</p>
              </div>
            </div>
            <KadButton
              variant="ghost"
              size="row"
              className="mt-3"
              onClick={() => proposeBlueprint(`Đề xuất sửa engine cho ${agent.name}`)}
            >
              Gửi duyệt thay đổi
            </KadButton>
          </section>

          <OrgContextImportModal
            isOpen={isImportModalOpen}
            onClose={() => setIsImportModalOpen(false)}
            onSuccess={refresh}
          />
        </div>
      )}
    </div>
  );
}
