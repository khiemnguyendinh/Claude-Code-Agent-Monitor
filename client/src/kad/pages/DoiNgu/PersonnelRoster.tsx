/**
 * "Nhân sự số" roster — tab Tổ chức. Add/edit/archive agent_profiles +
 * permission assignment (server allow-list: server/lib/kad/repo/personnel.js).
 * Split out of ToChucTab.tsx to keep that file focused on the read-only
 * hub-and-spoke chart (this panel is a genuinely new admin surface, not the
 * old PersonnelCard grid removed 2026-07-04 — see ToChucTab.tsx's header
 * comment for that history).
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import { kadApi } from "../../api-client";
import type { AgentProfile, AgentPermissions } from "../../types";
import { AgentAvatar } from "../../components/Avatar";
import {
  KadButton,
  KadCard,
  KadCardHeader,
  KadInput,
  KadTextarea,
  KadFieldLabel,
} from "../../components/primitives";
import { useKadToast } from "../../components/Toast";

const PERMISSION_LABELS: Record<keyof AgentPermissions, string> = {
  createTask: "Tạo việc",
  assignTask: "Giao việc",
  createHelper: "Tạo trợ thủ tạm thời",
  readOrgContext: "Đọc tri thức tổ chức",
  readTemplates: "Đọc thư viện mẫu",
  webSearch: "Tìm kiếm web",
  requestApproval: "Xin duyệt",
  writeAudit: "Ghi audit",
  publishConnector: "Xuất bản kết nối",
  modifyBlueprint: "Sửa blueprint",
  modifyOrgContext: "Sửa tri thức tổ chức",
};
const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as (keyof AgentPermissions)[];
// camelCase (AgentProfile contract) <-> snake_case (server allow-list) — same keys as
// server/lib/kad/repo/personnel.js's PERMISSION_KEYS and api-client.ts's toAgent().
const SNAKE_KEY: Record<keyof AgentPermissions, string> = {
  createTask: "create_task",
  assignTask: "assign_task",
  createHelper: "create_helper",
  readOrgContext: "read_org_context",
  readTemplates: "read_templates",
  webSearch: "web_search",
  requestApproval: "request_approval",
  writeAudit: "write_audit",
  publishConnector: "publish_connector",
  modifyBlueprint: "modify_blueprint",
  modifyOrgContext: "modify_org_context",
};

interface FormState {
  id: string | null; // null = creating
  display_name: string;
  agent_type: "sub" | "helper";
  engine: "claude" | "codex" | "antigravity";
  role_description: string;
  parent_agent_id: string;
  permissions: Record<string, boolean>;
}

function emptyForm(): FormState {
  return {
    id: null,
    display_name: "",
    agent_type: "sub",
    engine: "claude",
    role_description: "",
    parent_agent_id: "",
    permissions: {},
  };
}

function formFromAgent(agent: AgentProfile): FormState {
  const permissions: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) permissions[SNAKE_KEY[key]] = Boolean(agent.permissions[key]);
  return {
    id: agent.id,
    display_name: agent.displayName,
    agent_type: agent.agentType === "helper" ? "helper" : "sub",
    engine: agent.engine,
    role_description: agent.roleDescription,
    parent_agent_id: agent.parentAgentId ?? "",
    permissions,
  };
}

export function PersonnelRoster({
  agents,
  onChanged,
}: {
  agents: AgentProfile[];
  onChanged: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useKadToast();

  const visible = agents.filter(
    (a) => a.agentType !== "main" && (showArchived || a.status !== "archived")
  );
  const parentCandidates = agents.filter((a) => a.status !== "archived");

  const submit = () => {
    if (!form) return;
    if (!form.display_name.trim()) {
      toast({ message: "Cần nhập tên nhân sự.", tone: "warning" });
      return;
    }
    setSaving(true);
    const payload = {
      display_name: form.display_name.trim(),
      role_description: form.role_description.trim() || undefined,
      permissions: form.permissions,
      parent_agent_id: form.parent_agent_id || null,
    };
    const req = form.id
      ? kadApi.agents.update(form.id, payload)
      : kadApi.agents.create({
          ...payload,
          agent_type: form.agent_type,
          engine: form.engine,
        });
    req
      .then(() => {
        toast({ message: form.id ? "Đã cập nhật nhân sự." : "Đã thêm nhân sự.", tone: "success" });
        setForm(null);
        onChanged();
      })
      .catch((e) =>
        toast({
          message: e instanceof Error ? e.message : "Không lưu được nhân sự.",
          tone: "warning",
        })
      )
      .finally(() => setSaving(false));
  };

  const archive = (agent: AgentProfile) => {
    if (!window.confirm(`Xóa (archive) "${agent.displayName}"? Có thể khôi phục lại nếu cần.`))
      return;
    kadApi.agents
      .archive(agent.id)
      .then(() => {
        toast({ message: "Đã xóa nhân sự.", tone: "success" });
        onChanged();
      })
      .catch((e) =>
        toast({ message: e instanceof Error ? e.message : "Không xóa được.", tone: "warning" })
      );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="kad-heading text-kad-text-strong">Nhân sự số</h3>
        <div className="flex items-center gap-3">
          <label className="kad-caption text-kad-text-muted inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              style={{ accentColor: "var(--kad-accent)" }}
            />
            Hiện đã xóa
          </label>
          <KadButton size="row" variant="primary" icon={Plus} onClick={() => setForm(emptyForm())}>
            Thêm nhân sự
          </KadButton>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {visible.length === 0 ? (
          <p className="kad-body text-kad-text-faint">
            Chưa có nhân sự số nào ngoài Trợ lý vận hành.
          </p>
        ) : (
          visible.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center justify-between gap-3 border border-kad-border rounded-lg px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AgentAvatar
                  agentId={agent.id}
                  size={24}
                  displayNameOverride={agent.displayName}
                  agentNameOverride={agent.name}
                />
                <div className="min-w-0">
                  <p className="kad-body text-kad-text truncate">
                    {agent.displayName}
                    {agent.status === "archived" && (
                      <span className="kad-caption text-kad-text-faint ml-2">(đã xóa)</span>
                    )}
                  </p>
                  <p className="kad-caption text-kad-text-muted truncate">
                    {agent.agentType === "helper" ? "Trợ thủ tạm thời" : "Sub-agent"} ·{" "}
                    {agent.engine}
                  </p>
                </div>
              </div>
              {agent.status !== "archived" && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <KadButton
                    size="row"
                    variant="ghost"
                    onClick={() => setForm(formFromAgent(agent))}
                  >
                    Sửa
                  </KadButton>
                  <KadButton size="row" variant="danger" onClick={() => archive(agent)}>
                    Xóa
                  </KadButton>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {form && (
        <KadCard>
          <KadCardHeader title={form.id ? "Sửa nhân sự" : "Thêm nhân sự"} />
          <div className="space-y-3">
            <div>
              <KadFieldLabel>Tên hiển thị</KadFieldLabel>
              <KadInput
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="VD: Trợ lý nghiên cứu"
              />
            </div>

            {!form.id && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <KadFieldLabel>Loại</KadFieldLabel>
                  <select
                    value={form.agent_type}
                    onChange={(e) =>
                      setForm({ ...form, agent_type: e.target.value as FormState["agent_type"] })
                    }
                    className="kad-body h-9 w-full rounded-lg bg-kad-surface-2 px-3 text-kad-text"
                  >
                    <option value="sub">Sub-agent</option>
                    <option value="helper">Trợ thủ tạm thời</option>
                  </select>
                </div>
                <div>
                  <KadFieldLabel>Engine</KadFieldLabel>
                  <select
                    value={form.engine}
                    onChange={(e) =>
                      setForm({ ...form, engine: e.target.value as FormState["engine"] })
                    }
                    className="kad-body h-9 w-full rounded-lg bg-kad-surface-2 px-3 text-kad-text"
                  >
                    <option value="claude">claude</option>
                    <option value="codex">codex</option>
                    <option value="antigravity">antigravity</option>
                  </select>
                </div>
              </div>
            )}

            <div>
              <KadFieldLabel>JD / mô tả vai trò</KadFieldLabel>
              <KadTextarea
                value={form.role_description}
                onChange={(e) => setForm({ ...form, role_description: e.target.value })}
                className="min-h-[100px]"
              />
            </div>

            <div>
              <KadFieldLabel>Báo cáo cho (parent)</KadFieldLabel>
              <select
                value={form.parent_agent_id}
                onChange={(e) => setForm({ ...form, parent_agent_id: e.target.value })}
                className="kad-body h-9 w-full rounded-lg bg-kad-surface-2 px-3 text-kad-text"
              >
                <option value="">(không có)</option>
                {parentCandidates
                  .filter((a) => a.id !== form.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <KadFieldLabel>Phân quyền</KadFieldLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                {PERMISSION_KEYS.map((key) => {
                  const snakeKey = SNAKE_KEY[key];
                  return (
                    <label
                      key={key}
                      className="kad-caption text-kad-text-muted inline-flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(form.permissions[snakeKey])}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            permissions: { ...form.permissions, [snakeKey]: e.target.checked },
                          })
                        }
                        style={{ accentColor: "var(--kad-accent)" }}
                      />
                      {PERMISSION_LABELS[key]}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <KadButton variant="primary" loading={saving} onClick={submit}>
                {form.id ? "Lưu thay đổi" : "Tạo nhân sự"}
              </KadButton>
              <KadButton variant="ghost" onClick={() => setForm(null)}>
                Hủy
              </KadButton>
            </div>
          </div>
        </KadCard>
      )}
    </div>
  );
}
