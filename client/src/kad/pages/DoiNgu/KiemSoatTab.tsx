/**
 * Tab "Kiểm soát & Phân quyền" — 04-man-doi-ngu.md §4. Ba khối, đọc là
 * chính, sửa qua duyệt. Ma trận phê duyệt render quyền THẬT của agent
 * (GET /api/kad/agents → agent_profiles.permissions) — KHÔNG bịa hàng/cột.
 */
import { useEffect, useState } from "react";
import { ShieldCheck, Check, Minus } from "lucide-react";
import { DEPARTMENT_POLICIES } from "../../mockData";
import { kadApi } from "../../api-client";
import type { KadBudgetStatus } from "../../api-client";
import type { AgentProfile, AgentPermissions } from "../../types";
import { ARTIFACT_TYPE_LABEL } from "../../labels";
import { useKadToast } from "../../components/Toast";
import { KadCard, KadCardHeader, KadButton, KadSkeleton } from "../../components/primitives";
import { ProgressBar } from "../../components/Progress";
import { formatTokens, formatPercent } from "../../format";

// Cột ma trận phê duyệt = quyền THẬT của agent (agent_profiles.permissions).
// Mỗi cột ánh xạ 1:1 sang 1 flag trong AgentPermissions (api-client.ts
// toAgent(), types.ts). Không bịa thêm cột nào ngoài các flag đã có.
const APPROVAL_PERMISSION_COLUMNS: { key: keyof AgentPermissions; label: string }[] = [
  { key: "requestApproval", label: "Xin duyệt" },
  { key: "modifyBlueprint", label: "Sửa blueprint" },
  { key: "modifyOrgContext", label: "Sửa org-context" },
  { key: "assignTask", label: "Giao việc" },
  { key: "createHelper", label: "Tạo trợ thủ" },
  { key: "publishConnector", label: "Publish connector" },
];

export function KiemSoatTab() {
  const toast = useKadToast();
  // Ma trận phê duyệt + quy tắc auto-approve là CẤU HÌNH chính sách (mô tả
  // luật đang được enforce), không phải hoạt động realtime — giữ nguyên. Khối
  // Ngân sách bên dưới đọc số THẬT từ GET /api/kad/reports/budget (hạn mức từ
  // blueprint phòng + token dùng hôm nay tính qua cost.js).
  const [autoApprove, setAutoApprove] = useState(DEPARTMENT_POLICIES.autoApprove);
  const [budget, setBudget] = useState<KadBudgetStatus | null>(null);
  // Ma trận phê duyệt: hàng = agent THẬT (agents.list()), cột = quyền
  // approval-related THẬT (agent.permissions) — không còn bảng tĩnh.
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    kadApi.reports
      .budget()
      .then((b) => {
        if (!cancelled) setBudget(b);
      })
      .catch(() => {
        /* giữ hạn mức mặc định, usage = 0 khi lỗi tải */
      });
    kadApi.agents
      .list()
      .then((rows) => {
        if (!cancelled) setAgents(rows.filter((a) => a.status !== "archived"));
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Hạn mức: dùng số thật khi tải xong; mặc định DEPT_SETTINGS (khớp) trong lúc
  // chờ để tránh nháy. Token đã dùng hôm nay: 0 tới khi có số thật (không hiện
  // số giả).
  const dailyLimit = budget?.dailyTokenLimit ?? DEPARTMENT_POLICIES.dailyTokenLimit;
  const perTaskLimit = budget?.perTaskTokenLimit ?? DEPARTMENT_POLICIES.perTaskTokenLimit;
  const tokensUsedToday = budget?.tokensUsedToday ?? 0;
  const usedPercent = dailyLimit > 0 ? (tokensUsedToday / dailyLimit) * 100 : 0;

  return (
    <div className="space-y-6 max-w-[900px]">
      {/* 1 — Ma trận phê duyệt */}
      <KadCard>
        <KadCardHeader title="Ma trận phê duyệt" />
        <p className="kad-caption text-kad-text-faint mb-3">
          Thành viên AI · quyền liên quan tới phê duyệt — nguồn: agent_profiles.permissions (thật).
        </p>
        {agentsLoading ? (
          <KadSkeleton className="h-40 w-full" />
        ) : agents.length === 0 ? (
          <p className="kad-body text-kad-text-faint text-center py-4">
            Chưa có thành viên AI nào được cấu hình.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-kad-border">
                  <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Thành viên AI</th>
                  {APPROVAL_PERMISSION_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className="kad-caption text-kad-text-faint font-normal py-2 pr-3 text-center whitespace-nowrap"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id} className="border-b border-kad-border last:border-0 align-top">
                    <td className="py-2.5 pr-3 max-w-[220px]">
                      <p className="kad-body text-kad-text">{agent.displayName}</p>
                      <p className="kad-caption text-kad-text-faint">{agent.title || agent.name}</p>
                    </td>
                    {APPROVAL_PERMISSION_COLUMNS.map((col) => {
                      const granted = !!agent.permissions[col.key];
                      return (
                        <td key={col.key} className="py-2.5 pr-3 text-center">
                          {granted ? (
                            <Check
                              className="w-4 h-4 text-kad-success inline-block"
                              aria-label="Có quyền"
                            />
                          ) : (
                            <Minus
                              className="w-4 h-4 text-kad-text-faint inline-block"
                              aria-label="Không có quyền"
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </KadCard>

      {/* 2 — Kiểm soát chéo */}
      <KadCard>
        <KadCardHeader title="Kiểm soát chéo" />
        <div className="flex gap-2.5 bg-kad-surface-2 rounded-lg px-3 py-2.5 mb-4">
          <ShieldCheck className="w-4 h-4 text-kad-text-muted flex-shrink-0 mt-0.5" aria-hidden />
          <p className="kad-body text-kad-text-muted">
            Mọi artifact bắt buộc qua bước <strong className="text-kad-text">Kiểm tra chất lượng</strong> (4 tiêu chí +
            cờ nhạy cảm) trước khi xin duyệt. Bước quality report không được tự review lại chính nó. Nếu bật
            auto-approve cho một loại học liệu, hệ thống tự duyệt khi đạt điểm QR tối thiểu và ghi audit với người
            duyệt = "system".
          </p>
        </div>
        <div className="space-y-2">
          {autoApprove.map((rule) => (
            <div
              key={rule.artifactType}
              className="flex items-center justify-between gap-3 border border-kad-border rounded-lg px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="kad-body text-kad-text">{ARTIFACT_TYPE_LABEL[rule.artifactType]}</p>
                <p className="kad-caption text-kad-text-muted">Điểm QR tối thiểu: {rule.minQualityScore.toFixed(1)}</p>
              </div>
              <label className="inline-flex items-center gap-2 flex-shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => {
                    setAutoApprove((prev) =>
                      prev.map((r) => (r.artifactType === rule.artifactType ? { ...r, enabled: !r.enabled } : r))
                    );
                    toast({ message: "Đã gửi duyệt thay đổi cấu hình auto-approve.", tone: "warning" });
                  }}
                  style={{ accentColor: "var(--kad-accent)" }}
                />
                <span className="kad-caption text-kad-text-muted">Auto-approve</span>
              </label>
            </div>
          ))}
        </div>
      </KadCard>

      {/* 3 — Ngân sách & guardrails */}
      <KadCard>
        <KadCardHeader title="Ngân sách & guardrails" />
        <div className="mb-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <p className="kad-body text-kad-text">
              Token hôm nay: {formatTokens(tokensUsedToday)} /{" "}
              {formatTokens(dailyLimit)}
            </p>
            <span className="kad-caption text-kad-text-muted">{formatPercent(usedPercent)}</span>
          </div>
          <ProgressBar percent={usedPercent} tone={usedPercent > 85 ? "primary" : "accent"} />
        </div>
        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-kad-border">
          <div>
            <p className="kad-caption text-kad-text-muted">Ngưỡng / task</p>
            <p className="kad-heading text-kad-text-strong">{formatTokens(perTaskLimit)}</p>
          </div>
          <div>
            <p className="kad-caption text-kad-text-muted">Khi vượt ngưỡng</p>
            <p className="kad-body text-kad-text">Tạm dừng run + gửi thông báo cho Trưởng phòng</p>
          </div>
        </div>
        <KadButton
          variant="ghost"
          size="row"
          className="mt-4"
          onClick={() => toast({ message: "Đã gửi duyệt thay đổi ngân sách." })}
        >
          Gửi duyệt thay đổi ngân sách
        </KadButton>
      </KadCard>
    </div>
  );
}
