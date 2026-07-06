/**
 * Tab "Kiểm soát & Phân quyền" — 04-man-doi-ngu.md §4. Ba khối, đọc là
 * chính, sửa qua duyệt. Ma trận phê duyệt render đúng data spec 01 —
 * KHÔNG bịa hàng mới.
 */
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { APPROVAL_MATRIX, DEPARTMENT_POLICIES } from "../../mockData";
import { kadApi } from "../../api-client";
import type { KadBudgetStatus } from "../../api-client";
import { ARTIFACT_TYPE_LABEL } from "../../labels";
import { useKadToast } from "../../components/Toast";
import { KadCard, KadCardHeader, KadButton } from "../../components/primitives";
import { StatusChip, SensitivityBadge } from "../../components/StatusChip";
import { ProgressBar } from "../../components/Progress";
import { formatTokens, formatPercent } from "../../format";

const SENSITIVE_ROW_ACTION = "Nội dung chứa số liệu / con người / thương hiệu";

export function KiemSoatTab() {
  const toast = useKadToast();
  // Ma trận phê duyệt + quy tắc auto-approve là CẤU HÌNH chính sách (mô tả
  // luật đang được enforce), không phải hoạt động realtime — giữ nguyên. Khối
  // Ngân sách bên dưới đọc số THẬT từ GET /api/kad/reports/budget (hạn mức từ
  // blueprint phòng + token dùng hôm nay tính qua cost.js).
  const [autoApprove, setAutoApprove] = useState(DEPARTMENT_POLICIES.autoApprove);
  const [budget, setBudget] = useState<KadBudgetStatus | null>(null);
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
          Loại việc/nội dung · Ai xin · Người duyệt · SLA · Cooldown — nguồn: approval matrix (spec 01 §4).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-kad-border">
                <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Hành động / nội dung</th>
                <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Ai xin</th>
                <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Người duyệt</th>
                <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">SLA</th>
                <th className="kad-caption text-kad-text-faint font-normal py-2">Cooldown</th>
              </tr>
            </thead>
            <tbody>
              {APPROVAL_MATRIX.map((row) => (
                <tr key={row.action} className="border-b border-kad-border last:border-0 align-top">
                  <td className="py-2.5 pr-3 max-w-[260px]">
                    <p className="kad-body text-kad-text">{row.action}</p>
                    {row.action === SENSITIVE_ROW_ACTION && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <SensitivityBadge subtype="metrics" />
                        <SensitivityBadge subtype="people" />
                        <SensitivityBadge subtype="brand" />
                      </div>
                    )}
                    {row.condition && <p className="kad-caption text-kad-text-faint mt-1">{row.condition}</p>}
                  </td>
                  <td className="py-2.5 pr-3 kad-body text-kad-text-muted whitespace-nowrap">{row.requestedBy}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {row.automatic ? (
                      <StatusChip kind="neutral" label="Hệ thống (auto)" />
                    ) : (
                      <span className="kad-body text-kad-text-muted">Anh Khiêm</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 kad-body text-kad-text-muted whitespace-nowrap">{row.slaHours}</td>
                  <td className="py-2.5 kad-body text-kad-text-muted whitespace-nowrap">{row.cooldown}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
