import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { kadApi } from "../../api-client";
import type { BlueprintRow, TemplateLibraryRow } from "../../api-client";
import type { AgentProfile } from "../../types";
import { useKadToast } from "../../components/Toast";
import { AgentAvatar } from "../../components/Avatar";
import {
  KadButton,
  KadErrorBlock,
  KadFieldLabel,
  KadInput,
  KadSkeleton,
  KadTextarea,
} from "../../components/primitives";
import { MarkdownLite } from "../../components/MarkdownLite";
import { XlsxImportButton } from "../../components/XlsxImportButton";

export function JDKyNangTab() {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [templates, setTemplates] = useState<TemplateLibraryRow[]>([]);
  const [blueprints, setBlueprints] = useState<BlueprintRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editingJd, setEditingJd] = useState(false);
  const [jdDraft, setJdDraft] = useState("");
  const [savingJd, setSavingJd] = useState(false);
  const [editingEngine, setEditingEngine] = useState(false);
  const [engineDraft, setEngineDraft] = useState<"claude" | "codex" | "antigravity">("claude");
  const [modelDraft, setModelDraft] = useState("");
  const [savingEngine, setSavingEngine] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const [savingSkills, setSavingSkills] = useState(false);
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

  const saveEngine = () => {
    if (!agent) return;
    setSavingEngine(true);
    kadApi.agents
      .update(agent.id, { engine: engineDraft, model: modelDraft.trim() || null })
      .then(() => {
        toast({ message: "Đã cập nhật cấu hình engine.", tone: "success" });
        setEditingEngine(false);
        refresh();
      })
      .catch((e) =>
        toast({
          message: e instanceof Error ? e.message : "Không lưu được cấu hình engine.",
          tone: "warning",
        })
      )
      .finally(() => setSavingEngine(false));
  };

  const saveJd = () => {
    if (!agent) return;
    setSavingJd(true);
    kadApi.agents
      .update(agent.id, { role_description: jdDraft })
      .then(() => {
        toast({ message: "Đã cập nhật JD.", tone: "success" });
        setEditingJd(false);
        refresh();
      })
      .catch((e) =>
        toast({ message: e instanceof Error ? e.message : "Không lưu được JD.", tone: "warning" })
      )
      .finally(() => setSavingJd(false));
  };

  const saveSkills = (nextSkills: string[]) => {
    if (!agent) return;
    setSavingSkills(true);
    kadApi.agents
      .update(agent.id, { skills: nextSkills })
      .then(() => refresh())
      .catch((e) =>
        toast({
          message: e instanceof Error ? e.message : "Không lưu được kỹ năng.",
          tone: "warning",
        })
      )
      .finally(() => setSavingSkills(false));
  };

  const addSkill = () => {
    const skill = newSkill.trim();
    if (!agent || !skill) return;
    if (agent.skills.includes(skill)) {
      setNewSkill("");
      return;
    }
    saveSkills([...agent.skills, skill]);
    setNewSkill("");
  };

  const removeSkill = (skill: string) => {
    if (!agent) return;
    saveSkills(agent.skills.filter((s) => s !== skill));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <div className="border border-kad-border rounded-xl overflow-hidden h-fit">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setSelectedId(a.id);
              setEditingJd(false);
            }}
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
          <div className="flex items-center justify-end">
            <XlsxImportButton
              kind="jd-ky-nang"
              onImport={(file) => kadApi.importXlsx.agentJd(agent.id, file).then(() => refresh())}
            />
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
              {!editingJd && (
                <KadButton
                  variant="ghost"
                  size="row"
                  onClick={() => {
                    setJdDraft(agent.roleDescription);
                    setEditingJd(true);
                  }}
                >
                  Sửa
                </KadButton>
              )}
            </div>
            {editingJd ? (
              <div className="space-y-2">
                <KadTextarea
                  value={jdDraft}
                  onChange={(e) => setJdDraft(e.target.value)}
                  className="min-h-[160px]"
                />
                <div className="flex items-center gap-2">
                  <KadButton variant="primary" size="row" loading={savingJd} onClick={saveJd}>
                    Lưu
                  </KadButton>
                  <KadButton variant="ghost" size="row" onClick={() => setEditingJd(false)}>
                    Hủy
                  </KadButton>
                </div>
              </div>
            ) : (
              <MarkdownLite content={agent.roleDescription || "(chưa có JD)"} />
            )}
            <p className="kad-caption text-kad-text-faint mt-2">
              Blueprint v{approved?.version ?? "-"} · duyệt{" "}
              {approved?.approved_at
                ? new Date(approved.approved_at).toLocaleDateString("vi-VN")
                : "chưa có"}
            </p>
          </section>

          <section className="pt-4 border-t border-kad-border">
            <h3 className="kad-heading text-kad-text-strong mb-2">Kỹ năng</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {agent.skills.length === 0 ? (
                <p className="kad-body text-kad-text-faint">Chưa có kỹ năng nào.</p>
              ) : (
                agent.skills.map((skill) => (
                  <span
                    key={skill}
                    className="kad-caption inline-flex items-center gap-1.5 rounded-full border border-kad-border bg-kad-surface-2 px-2.5 py-1 text-kad-text"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      disabled={savingSkills}
                      aria-label={`Xóa kỹ năng ${skill}`}
                      className="text-kad-text-faint hover:text-kad-danger disabled:opacity-50 disabled:pointer-events-none"
                    >
                      <X className="w-3 h-3" aria-hidden />
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="flex items-center gap-2">
              <KadInput
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                placeholder="Kỹ năng mới…"
                className="max-w-[220px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSkill();
                  }
                }}
              />
              <KadButton
                variant="ghost"
                size="row"
                icon={Plus}
                loading={savingSkills}
                onClick={addSkill}
              >
                Thêm
              </KadButton>
            </div>
          </section>

          <section className="pt-4 border-t border-kad-border">
            <h3 className="kad-heading text-kad-text-strong mb-2">Template được cấp quyền đọc</h3>
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
                    <span className="kad-caption text-kad-text-muted flex-shrink-0">Bật</span>
                  </div>
                ))
              )}
            </div>
            <p className="kad-caption text-kad-text-faint mt-2">
              Đổi quyền đọc template ở form "Sửa nhân sự" trong tab Tổ chức (checkbox "Đọc thư viện
              mẫu").
            </p>
          </section>

          <section className="pt-4 border-t border-kad-border">
            <div className="flex items-center justify-between mb-2">
              <h3 className="kad-heading text-kad-text-strong">Cấu hình engine</h3>
              {!editingEngine && (
                <KadButton
                  variant="ghost"
                  size="row"
                  onClick={() => {
                    setEngineDraft(agent.engine);
                    setModelDraft(agent.model || "");
                    setEditingEngine(true);
                  }}
                >
                  Sửa
                </KadButton>
              )}
            </div>
            {editingEngine ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <KadFieldLabel>Engine</KadFieldLabel>
                    <select
                      value={engineDraft}
                      onChange={(e) => setEngineDraft(e.target.value as typeof engineDraft)}
                      className="kad-body h-9 w-full rounded-lg bg-kad-surface-2 px-3 text-kad-text"
                    >
                      <option value="claude">claude</option>
                      <option value="codex">codex</option>
                      <option value="antigravity">antigravity</option>
                    </select>
                  </div>
                  <div>
                    <KadFieldLabel>Model</KadFieldLabel>
                    <KadInput
                      value={modelDraft}
                      onChange={(e) => setModelDraft(e.target.value)}
                      placeholder="Claude Sonnet 5"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <KadButton
                    variant="primary"
                    size="row"
                    loading={savingEngine}
                    onClick={saveEngine}
                  >
                    Lưu
                  </KadButton>
                  <KadButton variant="ghost" size="row" onClick={() => setEditingEngine(false)}>
                    Hủy
                  </KadButton>
                </div>
              </div>
            ) : (
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
            )}
          </section>
        </div>
      )}
    </div>
  );
}
