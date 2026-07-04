/**
 * Tab "JD & Kỹ năng" — 04-man-doi-ngu.md §3. Master–detail. Every change here
 * is a blueprint_change proposal, never a direct save.
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import { AGENTS, TEMPLATE_SKILLS } from "../../mockData";
import { useKadToast } from "../../components/Toast";
import { AgentAvatar } from "../../components/Avatar";
import { KadButton } from "../../components/primitives";
import { MarkdownLite } from "../../components/MarkdownLite";

export function JDKyNangTab() {
  const [selectedId, setSelectedId] = useState(AGENTS[0]?.id ?? "");
  const [skillOverrides, setSkillOverrides] = useState<Record<string, boolean>>({});
  const toast = useKadToast();
  const agent = AGENTS.find((a) => a.id === selectedId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <div className="border border-kad-border rounded-xl overflow-hidden h-fit">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelectedId(a.id)}
            className={`w-full h-11 flex items-center gap-2.5 px-3 border-b border-kad-border last:border-0 text-left ${
              a.id === selectedId ? "bg-kad-surface-2" : "hover:bg-kad-surface-2/60"
            }`}
          >
            <AgentAvatar agentId={a.id} size={20} />
            <div className="min-w-0">
              <p className="kad-label text-kad-text-strong truncate">{a.displayName}</p>
            </div>
          </button>
        ))}
      </div>

      {agent && (
        <div className="space-y-6 max-w-[720px]">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="kad-title text-kad-text-strong">JD — {agent.displayName}</h2>
              <KadButton variant="ghost" size="row" onClick={() => toast({ message: "Đã gửi duyệt thay đổi JD." })}>
                Đề xuất sửa
              </KadButton>
            </div>
            <MarkdownLite content={agent.roleDescription} />
            <p className="kad-caption text-kad-text-faint mt-2">
              v{agent.jdVersion} · duyệt {new Date(agent.jdApprovedAt).toLocaleDateString("vi-VN")}
            </p>
          </section>

          <section className="pt-4 border-t border-kad-border">
            <div className="flex items-center justify-between mb-2">
              <h3 className="kad-heading text-kad-text-strong">Kỹ năng (prompt pack & templates)</h3>
              <KadButton
                variant="ghost"
                size="row"
                icon={Plus}
                onClick={() => toast({ message: "Chọn kỹ năng từ thư viện mẫu — chưa nằm trong phạm vi mockup." })}
              >
                Thêm kỹ năng
              </KadButton>
            </div>
            <div className="space-y-2">
              {agent.skills.length === 0 ? (
                <p className="kad-body text-kad-text-faint">Chưa gán kỹ năng nào.</p>
              ) : (
                agent.skills.map((skill) => {
                  const template = TEMPLATE_SKILLS.find((t) => t.name === skill.name);
                  const enabled = skillOverrides[skill.name] ?? skill.enabled;
                  return (
                    <div
                      key={skill.name}
                      className="flex items-center justify-between gap-3 border border-kad-border rounded-lg px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="kad-body text-kad-text truncate">{template?.templateType ?? skill.name}</p>
                        <p className="kad-caption text-kad-text-muted truncate">
                          {skill.description} · v{skill.version} · {skill.usageCount} lượt dùng
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 flex-shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => {
                            setSkillOverrides((prev) => ({ ...prev, [skill.name]: !enabled }));
                            toast({ message: "Đã gửi duyệt thay đổi blueprint.", tone: "warning" });
                          }}
                          style={{ accentColor: "var(--kad-accent)" }}
                        />
                        <span className="kad-caption text-kad-text-muted">Bật</span>
                      </label>
                    </div>
                  );
                })
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
                <p className="kad-body text-kad-text">{agent.model}</p>
              </div>
            </div>
            <KadButton
              variant="ghost"
              size="row"
              className="mt-3"
              onClick={() => toast({ message: "Đã gửi duyệt thay đổi cấu hình engine." })}
            >
              Gửi duyệt thay đổi
            </KadButton>
          </section>
        </div>
      )}
    </div>
  );
}
