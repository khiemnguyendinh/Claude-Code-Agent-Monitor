/**
 * Màn Tự động hoá (`/cong-viec/tu-dong-hoa`) — spec/ui/09 §3.
 * Quản lý luật/lịch + việc đang chờ điều kiện, tích hợp với luồng Giao việc.
 * Nguyên tắc: trigger tạo ra việc; việc tự tạo vẫn vào Hàng đợi chờ xác nhận
 * trước khi tiêu token (spec 02 §6b / 01 §8). Không tiêu token trong dry-run.
 *
 * Wired to the real Phase 2c backend via the shared api-client.ts (no mock
 * store). Evaluating/firing a rule (turning a satisfied condition or a due
 * schedule into a real task) is the Phase 6.5 worker — this screen only
 * covers create (from Giao việc)/read/toggle/pause, which is all it needs to.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronRight,
  FileQuestion,
  Gauge,
  Plus,
  Zap,
} from "lucide-react";
import { kadApi } from "../api-client";
import { useKadToast } from "../components/Toast";
import { AutomationRuleForm } from "../components/AutomationRuleForm";
import { KadButton, KadCard, KadCardHeader, KadEmptyState } from "../components/primitives";
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

interface BlockedRow {
  id: string;
  title: string;
  startCondition: string | null;
  dependencyId: string | null;
}

// An auto-task (origin_rule_id set) still in 'inbox' = created by a rule but not
// yet confirmed → sits in the "chờ xác nhận" queue, no agent spawned (spec 02 §6b).
interface PendingRow {
  id: string;
  title: string;
  originRuleId: string | null;
}

export function TuDongHoa() {
  const showToast = useKadToast();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [blocked, setBlocked] = useState<BlockedRow[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [allAutomationPaused, setAllAutomationPaused] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  // Real dry-run summaries fetched lazily on row expand (spec 03 — no task created).
  const [dryRuns, setDryRuns] = useState<Record<string, string>>({});

  const refreshBlocked = useCallback(async () => {
    const [blockedTasks, allTasks] = await Promise.all([
      kadApi.tasks.list({ status: "blocked", limit: 200 }),
      kadApi.tasks.list({ limit: 500 }),
    ]);
    const titleById = new Map(allTasks.map((t) => [t.id, t.title]));
    const rows = await Promise.all(
      blockedTasks.map(async (t): Promise<BlockedRow> => {
        const deps = await kadApi.dependencies.listByTask(t.id);
        const waiting = deps.find((d) => d.status === "waiting");
        if (!waiting) return { id: t.id, title: t.title, startCondition: null, dependencyId: null };
        const sourceTitle =
          (waiting.depends_on_task_id && titleById.get(waiting.depends_on_task_id)) || "—";
        const condLabel =
          waiting.release_condition === "dep_artifact_approved" ? "được duyệt" : "hoàn thành";
        return {
          id: t.id,
          title: t.title,
          startCondition: `Khi "${sourceTitle}" ${condLabel}`,
          dependencyId: waiting.id,
        };
      })
    );
    setBlocked(rows);
  }, []);

  const refreshRules = useCallback(async () => {
    setRules(await kadApi.automationRules.list());
  }, []);

  // Auto-tasks in the "chờ xác nhận" queue: created by a rule (originRuleId set),
  // still 'inbox' (no agent spawned). Confirming kicks the first turn.
  const refreshPending = useCallback(async () => {
    const inbox = await kadApi.tasks.list({ status: "inbox", limit: 200 });
    setPending(
      inbox
        .filter((t) => t.originRuleId)
        .map((t) => ({ id: t.id, title: t.title, originRuleId: t.originRuleId }))
    );
  }, []);

  const refreshPaused = useCallback(async () => {
    const { paused } = await kadApi.automation.getPaused();
    setAllAutomationPaused(paused);
  }, []);

  const loadAll = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    return Promise.all([refreshBlocked(), refreshPending(), refreshRules(), refreshPaused()])
      .catch((e) => {
        console.warn("[kad] failed to load automation screen:", e && e.message);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [refreshBlocked, refreshPending, refreshRules, refreshPaused]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAction(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Có lỗi xảy ra, thử lại.",
        tone: "warning",
      });
    }
  }

  const handleRelease = (row: BlockedRow) =>
    runAction(async () => {
      if (!row.dependencyId) return;
      await kadApi.dependencies.release(row.dependencyId);
      showToast({ message: "Đã gỡ điều kiện — việc chuyển vào Hàng đợi.", tone: "success" });
      await refreshBlocked();
    });

  const handlePauseAll = () =>
    runAction(async () => {
      const next = !allAutomationPaused;
      await kadApi.automation.setPaused(next);
      setAllAutomationPaused(next);
      showToast({
        message: next ? "Đã tạm dừng mọi luật tự động." : "Đã bật lại tự động hoá.",
        tone: next ? "warning" : "success",
      });
    });

  const handleToggleRule = (rule: AutomationRule) =>
    runAction(async () => {
      await kadApi.automationRules.toggle(rule.id, !rule.enabled);
      await refreshRules();
    });

  const handleConfirm = (row: PendingRow) =>
    runAction(async () => {
      await kadApi.tasks.confirm(row.id);
      showToast({ message: "Đã xác nhận — việc bắt đầu chạy.", tone: "success" });
      await refreshPending();
    });

  // Expand a rule row and lazily fetch its real dry-run ("30 ngày qua sẽ kích ở đâu").
  const handleExpand = (ruleId: string) => {
    setExpanded((cur) => (cur === ruleId ? null : ruleId));
    if (dryRuns[ruleId] === undefined) {
      kadApi.automationRules
        .dryRun(ruleId)
        .then((r) => setDryRuns((prev) => ({ ...prev, [ruleId]: r.summary })))
        .catch(() => setDryRuns((prev) => ({ ...prev, [ruleId]: "" })));
    }
  };

  if (loading) {
    return (
      <div className="pt-16">
        <KadEmptyState icon={FileQuestion} message="Đang tải tự động hoá…" />
      </div>
    );
  }

  return (
    <div className="max-w-[880px] mx-auto pb-10 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="kad-title text-kad-text-strong mr-1">Tự động hoá</h1>
        <div className="flex-1" />
        <KadButton variant={allAutomationPaused ? "secondary" : "danger"} onClick={handlePauseAll}>
          {allAutomationPaused ? "Bật lại tất cả" : "Tạm dừng tất cả"}
        </KadButton>
        <KadButton variant="primary" icon={Plus} onClick={() => setShowCreateForm((v) => !v)}>
          Tạo luật
        </KadButton>
      </div>

      <p className="kad-caption text-kad-text-muted">
        Trigger tạo ra việc; việc tự tạo vẫn vào Hàng đợi chờ anh xác nhận trước khi tiêu token.
        Chạy thử không tiêu token.
      </p>

      {showCreateForm && (
        <AutomationRuleForm
          onCancel={() => setShowCreateForm(false)}
          onCreated={() => {
            setShowCreateForm(false);
            showToast({ message: "Đã tạo luật.", tone: "success" });
            refreshRules();
          }}
        />
      )}

      {loadError && (
        <div
          className="rounded-lg px-3 py-2 kad-caption flex items-center justify-between gap-2"
          style={{ background: "#FBE4E4", color: "#B91C1C", border: "1px solid #B91C1C55" }}
        >
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Không tải được dữ liệu tự động hoá — danh sách dưới đây có thể chưa đầy đủ.
          </span>
          <button type="button" onClick={loadAll} className="underline flex-shrink-0">
            Thử lại
          </button>
        </div>
      )}

      {allAutomationPaused && (
        <div
          className="rounded-lg px-3 py-2 kad-caption"
          style={{ background: "#FBF3E4", color: "#B97D10", border: "1px solid #B97D1055" }}
        >
          Mọi luật tự động đang tạm dừng — không luật nào kích cho tới khi bật lại.
        </div>
      )}

      {/* Việc tự động chờ xác nhận (spec 02 §6b — auto-task chưa spawn agent) */}
      {pending.length > 0 && (
        <KadCard>
          <KadCardHeader title={`Việc chờ xác nhận (${pending.length})`} />
          <div className="divide-y divide-kad-border">
            {pending.map((p) => {
              const ruleName = rules.find((r) => r.id === p.originRuleId)?.name ?? "luật tự động";
              return (
                <div key={p.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="kad-body text-kad-text-strong truncate">{p.title}</p>
                    <p className="kad-caption text-kad-text-muted truncate">
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                        style={{ background: "var(--kad-surface-2)" }}
                      >
                        <Zap className="w-3 h-3" aria-hidden />
                        {ruleName}
                      </span>{" "}
                      · chờ xác nhận (chưa tiêu token)
                    </p>
                  </div>
                  <KadButton variant="primary" onClick={() => handleConfirm(p)}>
                    Xác nhận
                  </KadButton>
                </div>
              );
            })}
          </div>
        </KadCard>
      )}

      {/* Việc đang chờ điều kiện */}
      <KadCard>
        <KadCardHeader title={`Việc đang chờ điều kiện (${blocked.length})`} />
        {blocked.length === 0 ? (
          <p className="kad-caption text-kad-text-faint py-2">
            Không có việc nào đang chờ điều kiện.
          </p>
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
                  onClick={() => handleRelease(t)}
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
        <KadCardHeader title={`Luật & lịch (${rules.length})`} />
        {rules.length === 0 ? (
          <p className="kad-caption text-kad-text-faint py-2">Chưa có luật tự động nào.</p>
        ) : (
          <div className="divide-y divide-kad-border">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                paused={allAutomationPaused}
                expanded={expanded === rule.id}
                dryRunSummary={dryRuns[rule.id]}
                onToggleExpand={() => handleExpand(rule.id)}
                onToggle={() => handleToggleRule(rule)}
              />
            ))}
          </div>
        )}
      </KadCard>
    </div>
  );
}

function RuleRow({
  rule,
  paused,
  expanded,
  dryRunSummary,
  onToggleExpand,
  onToggle,
}: {
  rule: AutomationRule;
  paused: boolean;
  expanded: boolean;
  dryRunSummary: string | undefined;
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
            <span className="kad-caption text-kad-text-muted truncate block">
              {rule.trigger.label}
            </span>
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
              <span className="text-kad-text-strong">Chạy thử 30 ngày:</span>{" "}
              {dryRunSummary === undefined
                ? "đang tính…"
                : dryRunSummary || rule.dryRun30d}
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
                      <span className="text-kad-text-faint w-10 flex-shrink-0">
                        {fireDate(f.firedAt)}
                      </span>
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: fm.color }}
                      />
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
