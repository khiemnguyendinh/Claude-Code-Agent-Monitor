/**
 * Phase 7 reports: read real KPI/cost from /api/kad/reports/*.
 * No mockData import in this page.
 */
import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, ScrollText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { dashboardToken } from "../../lib/api";
import {
  KadButton,
  KadCard,
  KadCardHeader,
  KadEmptyState,
  KadErrorBlock,
  KadSkeleton,
} from "../components/primitives";
import { StatusChip } from "../components/StatusChip";
import { formatPercent, formatTokens, formatVnd } from "../format";

interface CostRow {
  agent_id?: string | null;
  agent_name?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  tokens: number;
  usd: number;
  vnd: number;
  runs: number;
}

interface ReportKpi {
  range: string;
  approval_turnaround_avg_hours: number;
  approval_decided_count: number;
  task_completion_rate_7d: number;
  task_completion_done: number;
  task_completion_total: number;
  quality_pass_rate: number;
  quality_passed: number;
  quality_total: number;
  cost: {
    source: "token_usage";
    token_usage_rows: number;
    missing_engine_sessions: number;
    unpriced_rows: number;
    total_tokens: number;
    total_usd: number;
    total_vnd: number;
    by_agent: CostRow[];
    by_task: CostRow[];
  };
  verified: { item: string; source: string; status: "real" | "empty" }[];
}

async function kadGet<T>(path: string): Promise<T> {
  const token = dashboardToken();
  const res = await fetch(`/api/kad${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-dashboard-token": token } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function BaoCao() {
  const navigate = useNavigate();
  const [range, setRange] = useState("7d");
  const [data, setData] = useState<ReportKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    kadGet<ReportKpi>(`/reports/kpi?range=${encodeURIComponent(range)}`)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, [range]);

  const topTasks = useMemo(() => data?.cost.by_task.slice(0, 6) ?? [], [data]);
  const maxTaskTokens = Math.max(1, ...topTasks.map((r) => r.tokens));

  if (loading) {
    return (
      <div className="pb-10 max-w-[1040px]">
        <Header range={range} setRange={setRange} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <KadCard key={i} padding="sm">
              <KadSkeleton className="h-4 w-28 mb-3" />
              <KadSkeleton className="h-8 w-20" />
            </KadCard>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="pb-10 max-w-[1040px]">
        <Header range={range} setRange={setRange} />
        <KadErrorBlock onRetry={load} />
      </div>
    );
  }

  return (
    <div className="pb-10 max-w-[1040px]">
      <Header range={range} setRange={setRange} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <MetricCard
          label="Duyệt trung bình"
          value={data.approval_decided_count ? `${data.approval_turnaround_avg_hours}h` : "—"}
          detail={`${data.approval_decided_count} quyết định`}
        />
        <MetricCard
          label="Hoàn thành 7 ngày"
          value={formatPercent(data.task_completion_rate_7d)}
          detail={`${data.task_completion_done}/${data.task_completion_total} việc`}
        />
        <MetricCard
          label="Quality pass"
          value={formatPercent(data.quality_pass_rate)}
          detail={`${data.quality_passed}/${data.quality_total} artifact`}
        />
        <MetricCard
          label="Chi phí agent-task"
          value={formatVnd(data.cost.total_vnd)}
          detail={formatTokens(data.cost.total_tokens)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-5 mb-5">
        <KadCard>
          <KadCardHeader title="Chi phí theo thành viên AI" />
          {data.cost.by_agent.length === 0 ? (
            <KadEmptyState
              icon={BarChart3}
              message="Chưa có token_usage gắn với run KAD trong khoảng này."
            />
          ) : (
            <CostTable rows={data.cost.by_agent} primary="agent" />
          )}
        </KadCard>

        <KadCard>
          <KadCardHeader title="Top việc theo token" />
          {topTasks.length === 0 ? (
            <KadEmptyState icon={BarChart3} message="Chưa có dữ liệu chi phí theo việc." />
          ) : (
            <div className="space-y-3">
              {topTasks.map((r) => (
                <div key={r.task_id || r.task_title}>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="kad-body text-kad-text truncate">{r.task_title}</span>
                    <span className="kad-caption text-kad-text-muted tabular-nums">
                      {formatTokens(r.tokens)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-kad-surface-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-kad-accent"
                      style={{ width: `${Math.max(4, (r.tokens / maxTaskTokens) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </KadCard>
      </div>

      <KadCard>
        <KadCardHeader title="Verified real / still mock" />
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-kad-border">
                <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Hạng mục</th>
                <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">
                  Verified real
                </th>
                <th className="kad-caption text-kad-text-faint font-normal py-2">Still mock</th>
              </tr>
            </thead>
            <tbody>
              {data.verified.map((row) => (
                <tr key={row.item} className="border-b border-kad-border last:border-0">
                  <td className="py-2.5 pr-3 kad-body text-kad-text">{labelVerified(row.item)}</td>
                  <td className="py-2.5 pr-3">
                    <span className="kad-caption text-kad-text-muted">{row.source}</span>
                  </td>
                  <td className="py-2.5">
                    {row.status === "real" ? (
                      <StatusChip kind="done" label="Không còn mock" />
                    ) : (
                      <StatusChip kind="neutral" label="Chưa có dữ liệu thật" />
                    )}
                  </td>
                </tr>
              ))}
              {data.cost.unpriced_rows > 0 && (
                <tr className="border-b border-kad-border last:border-0">
                  <td className="py-2.5 pr-3 kad-body text-kad-text">Định giá model</td>
                  <td className="py-2.5 pr-3 kad-caption text-kad-text-muted">model_pricing</td>
                  <td className="py-2.5">
                    <StatusChip
                      kind="pending"
                      label={`${data.cost.unpriced_rows} dòng chưa định giá`}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </KadCard>
    </div>
  );

  function Header({ range, setRange }: { range: string; setRange: (v: string) => void }) {
    return (
      <>
        <div className="flex flex-wrap justify-between items-center gap-3 mb-1">
          <h1 className="kad-title text-kad-text-strong">Báo cáo</h1>
          <div className="flex items-center gap-2">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="kad-label h-9 rounded-lg bg-kad-surface-2 border border-transparent px-3 text-kad-text"
            >
              <option value="7d">7 ngày</option>
              <option value="30d">30 ngày</option>
              <option value="90d">90 ngày</option>
            </select>
            <KadButton icon={ScrollText} onClick={() => navigate("/nhat-ky")}>
              Nhật ký
            </KadButton>
            <KadButton icon={BookOpen} onClick={() => navigate("/bao-cao/learning")}>
              Learning
            </KadButton>
          </div>
        </div>
        <p className="kad-caption text-kad-text-faint mb-5">
          KPI phòng ban đọc từ approvals, tasks và token_usage monitor; không dùng mockData.
        </p>
      </>
    );
  }
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <KadCard padding="sm">
      <p className="kad-caption text-kad-text-muted">{label}</p>
      <p className="kad-display text-kad-text-strong mt-1 tabular-nums">{value}</p>
      <p className="kad-caption text-kad-text-faint mt-1">{detail}</p>
    </KadCard>
  );
}

function CostTable({ rows, primary }: { rows: CostRow[]; primary: "agent" | "task" }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-kad-border">
            <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">
              {primary === "agent" ? "Thành viên" : "Việc"}
            </th>
            <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Runs</th>
            <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Tokens</th>
            <th className="kad-caption text-kad-text-faint font-normal py-2">Chi phí</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.agent_id || row.task_id || row.agent_name || row.task_title}
              className="border-b border-kad-border last:border-0"
            >
              <td className="py-2.5 pr-3 kad-body text-kad-text truncate max-w-[260px]">
                {primary === "agent" ? row.agent_name : row.task_title}
              </td>
              <td className="py-2.5 pr-3 kad-body text-kad-text-muted tabular-nums">{row.runs}</td>
              <td className="py-2.5 pr-3 kad-body text-kad-text-muted tabular-nums">
                {formatTokens(row.tokens)}
              </td>
              <td className="py-2.5 kad-body text-kad-text-muted tabular-nums">
                {formatVnd(row.vnd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function labelVerified(item: string): string {
  switch (item) {
    case "approval_turnaround":
      return "Approval turnaround";
    case "completion_rate_7d":
      return "Completion rate 7d";
    case "quality_pass_rate":
      return "Quality pass rate";
    case "cost_by_agent_task":
      return "Cost / agent-task";
    default:
      return item;
  }
}
