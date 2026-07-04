/**
 * Màn Tự động hoá (`/cong-viec/tu-dong-hoa`) — spec/ui/09 §3.
 * Quản lý luật/lịch + việc đang chờ điều kiện, tích hợp với luồng Giao việc.
 * Nguyên tắc: trigger tạo ra việc; việc tự tạo vẫn vào Hàng đợi chờ xác nhận
 * trước khi tiêu token (spec 02 §6b / 01 §8). Không tiêu token trong dry-run.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, ChevronDown, ChevronRight, Gauge, Plus, Zap } from "lucide-react";
import { useKadStore } from "../store";
import { useKadToast } from "../components/Toast";
import { KadButton, KadCard, KadCardHeader } from "../components/primitives";
import type { AutomationRule, AutomationTriggerType, RuleFireResult } from "../types";

const TRIGGER_META: Record<AutomationTriggerType, { label: string; icon: typeof Calendar }> = {
  schedule: { label: "Lịch", icon: Calendar },
  event: { label: "Sự kiện", icon: Zap },
  metric_threshold: { label: "Ngưỡng", icon: Gauge },
};

const FIRE_META: Record<RuleFireResult, { label: string; color: string }> = {
  created: { label: "Đã tạo việc", color: "var(--kad-success)" },
  notified: { label: "Đã cảnh báo", color: "var(--kad-info)" },
  skipped_budget: { label: "Bỏ qua — vượt ngân sách", color: "var(--kad-warning)" },
  skipped_cooldown: { label: "Bỏ qua — cooldown", color: "var(--kad-warning)" },
  skipped_maxfires: { label: "Bỏ qua — hết lượt", color: "var(--kad-warning)" },
  blocked_loop: { label: "Chặn — vòng lặp", color: "var(--kad-warning)" },
};

function fireDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

export function TuDongHoa() {
  const { tasks, releaseDependency, automationRules, allAutomationPaused, toggleRule, togglePauseAll } = useKadStore();
  const showToast = useKadToast();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);

  const blocked = tasks.filter((t) => t.status === "blocked");

  const handleRelease = (id: string) => {
    releaseDependency(id);
    showToast({ message: "Đã gỡ điều kiện — việc chuyển vào Hàng đợi.", tone: "success" });
  };

  const handlePauseAll = () => {
    togglePauseAll();
    showToast({
      message: allAutomationPaused ? "Đã bật lại tự động hoá." : "Đã tạm dừng mọi luật tự động.",
      tone: allAutomationPaused ? "success" : "warning",
    });
  };

  return (
    <div className="max-w-[880px] mx-auto pb-10 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="kad-title text-kad-text-strong mr-1">Tự động hoá</h1>
        <div className="flex-1" />
        <KadButton
          variant={allAutomationPaused ? "secondary" : "danger"}
          onClick={handlePauseAll}
        >
          {allAutomationPaused ? "Bật lại tất cả" : "Tạm dừng tất cả"}
        </KadButton>
        <KadButton variant="primary" icon={Plus} onClick={() => navigate("/cong-viec/moi")}>
          Tạo luật
        </KadButton>
      </div>

      <p className="kad-caption text-kad-text-muted">
        Trigger tạo ra việc; việc tự tạo vẫn vào Hàng đợi chờ anh xác nhận trước khi tiêu token. Chạy thử không tiêu
        token.
      </p>

      {allAutomationPaused && (
        <div
          className="rounded-lg px-3 py-2 kad-caption"
          style={{ background: "#FBF3E4", color: "#B97D10", border: "1px solid #B97D1055" }}
        >
          Mọi luật tự động đang tạm dừng — không luật nào kích cho tới khi bật lại.
        </div>
      )}

      {/* Việc đang chờ điều kiện */}
      <KadCard>
        <KadCardHeader title={`Việc đang chờ điều kiện (${blocked.length})`} />
        {blocked.length === 0 ? (
          <p className="kad-caption text-kad-text-faint py-2">Không có việc nào đang chờ điều kiện.</p>
        ) : (
          <div className="divide-y divide-kad-border">
            {blocked.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="kad-body text-kad-text-strong truncate">{t.title}</p>
                  <p className="kad-caption text-kad-text-muted truncate">{t.startCondition}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRelease(t.id)}
                  className="kad-caption text-kad-accent hover:underline flex-shrink-0"
                >
                  Gỡ điều kiện
                </button>
              </div>
            ))}
          </div>
        )}
      </KadCard>

      {/* Luật & lịch */}
      <KadCard>
        <KadCardHeader title={`Luật & lịch (${automationRules.length})`} />
        <div className="divide-y divide-kad-border">
          {automationRules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              paused={allAutomationPaused}
              expanded={expanded === rule.id}
              onToggleExpand={() => setExpanded((cur) => (cur === rule.id ? null : rule.id))}
              onToggle={() => toggleRule(rule.id)}
            />
          ))}
        </div>
      </KadCard>
    </div>
  );
}

function RuleRow({
  rule,
  paused,
  expanded,
  onToggleExpand,
  onToggle,
}: {
  rule: AutomationRule;
  paused: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: () => void;
}) {
  const meta = TRIGGER_META[rule.trigger.type];
  const Icon = meta.icon;
  const on = rule.enabled && !paused;

  return (
    <div className="py-1">
      <div className="flex items-center gap-3 py-2">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-kad-text-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-kad-text-muted flex-shrink-0" />
          )}
          <span className="flex-1 min-w-0">
            <span className="kad-body text-kad-text-strong truncate block">{rule.name}</span>
            <span className="kad-caption text-kad-text-muted truncate block">{rule.trigger.label}</span>
          </span>
        </button>

        <span className="inline-flex items-center gap-1 kad-caption text-kad-text-muted flex-shrink-0">
          <Icon className="w-3.5 h-3.5" aria-hidden />
          {meta.label}
        </span>

        <span className="kad-caption text-kad-text-muted flex-shrink-0 hidden sm:inline max-w-[200px] truncate">
          {rule.actionType === "create_task" ? (
            <>
              {rule.actionLabel}
              {rule.approvalRequired && <span className="text-kad-text-faint"> (duyệt)</span>}
            </>
          ) : (
            rule.actionLabel
          )}
        </span>

        <span className="kad-caption text-kad-text-faint flex-shrink-0 w-16 text-right">
          {rule.lastFiredAtLabel ?? "—"}
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`Bật/tắt luật ${rule.name}`}
          onClick={onToggle}
          disabled={paused}
          className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 ${
            on ? "bg-kad-accent" : "bg-kad-surface-2 border border-kad-border-strong"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`}
            style={{ boxShadow: "var(--kad-shadow-1)" }}
          />
        </button>
      </div>

      {expanded && (
        <div className="pl-6 pb-3 space-y-2">
          <div className="rounded-lg bg-kad-surface-2 px-3 py-2">
            <p className="kad-caption text-kad-text-muted">
              <span className="text-kad-text-strong">Chạy thử 30 ngày:</span> {rule.dryRun30d}
            </p>
          </div>
          <div>
            <p className="kad-overline text-kad-text-muted mb-1.5">Lịch sử kích</p>
            {rule.fires.length === 0 ? (
              <p className="kad-caption text-kad-text-faint">Chưa kích lần nào.</p>
            ) : (
              <div className="space-y-1">
                {rule.fires.map((f) => {
                  const fm = FIRE_META[f.result];
                  return (
                    <div key={f.id} className="flex items-center gap-2 kad-caption">
                      <span className="text-kad-text-faint w-10 flex-shrink-0">{fireDate(f.firedAt)}</span>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: fm.color }} />
                      <span className="flex-shrink-0" style={{ color: fm.color }}>
                        {fm.label}
                      </span>
                      {f.note && <span className="text-kad-text-muted truncate">· {f.note}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
