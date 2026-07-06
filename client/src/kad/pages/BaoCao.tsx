/**
 * Màn Báo cáo (`/bao-cao`) — tổng hợp nhanh chi phí & chất lượng theo thành
 * viên AI, 7 ngày gần nhất. Dữ liệu THẬT từ GET /api/kad/reports/agent-stats
 * (server/lib/kad/repo/reports.js): việc hoàn thành / tỉ lệ duyệt-đạt 30 ngày /
 * chi phí run 7 ngày (định giá qua cost.js). Chart trục đầy đủ theo ngày +
 * xuất PDF vẫn chờ spec riêng (06-components.md) — không bịa thêm ở đây.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { kadApi } from "../api-client";
import type { KadAgentStats } from "../api-client";
import { useKadStore } from "../store";
import { KadCard, KadCardHeader, KadEmptyState } from "../components/primitives";
import { AgentAvatar } from "../components/Avatar";
import { formatPercent, formatVnd } from "../format";

export function BaoCao() {
  const navigate = useNavigate();
  const { agentsById } = useKadStore();
  const [stats, setStats] = useState<KadAgentStats[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    kadApi.reports
      .agentStats()
      .then((rows) => {
        if (!cancelled) setStats(rows);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = stats === null && !error;
  // Join real stats with real agent identities (agentsById, spec 03); drop rows
  // whose agent isn't in the roster (archived/unknown id).
  const rows = (stats ?? [])
    .map((s) => ({ stats: s, agent: agentsById.get(s.agentId) }))
    .filter((r): r is { stats: KadAgentStats; agent: NonNullable<typeof r.agent> } => !!r.agent)
    .sort((a, b) => b.stats.cost7dVnd - a.stats.cost7dVnd);
  const totalCost7d = rows.reduce((sum, r) => sum + r.stats.cost7dVnd, 0);
  const totalTasks = rows.reduce((sum, r) => sum + r.stats.tasksThisWeek, 0);

  return (
    <div className="pb-10 max-w-[900px]">
      <div className="flex justify-between items-center mb-1">
        <h1 className="kad-title text-kad-text-strong">Báo cáo</h1>
        <button
          onClick={() => navigate("/bao-cao/learning")}
          className="kad-label bg-kad-surface-2 text-kad-text-strong px-4 py-2 rounded-lg border border-kad-border hover:border-kad-border-strong"
        >
          Kinh nghiệm (Learning)
        </button>
      </div>
      <p className="kad-caption text-kad-text-faint mb-5">
        Phân tích sâu theo thời gian, chi phí chi tiết & chart đầy đủ trục đang chờ chốt spec riêng.
        Dưới đây là tổng hợp nhanh theo thành viên AI, 7 ngày gần nhất.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-5">
        <KadCard padding="sm">
          <p className="kad-caption text-kad-text-muted">Tổng chi phí 7 ngày</p>
          <p className="kad-display text-kad-text-strong mt-1">{formatVnd(totalCost7d)}</p>
        </KadCard>
        <KadCard padding="sm">
          <p className="kad-caption text-kad-text-muted">Tổng việc hoàn thành tuần này</p>
          <p className="kad-display text-kad-text-strong mt-1">{totalTasks}</p>
        </KadCard>
      </div>

      <KadCard>
        <KadCardHeader title="Chi phí & chất lượng theo thành viên AI" />
        {loading ? (
          <p className="kad-body text-kad-text-faint text-center py-8">Đang tải…</p>
        ) : error ? (
          <KadEmptyState icon={BarChart3} message="Không tải được báo cáo." />
        ) : rows.length === 0 ? (
          <KadEmptyState icon={BarChart3} message="Chưa có dữ liệu hoạt động của thành viên AI." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-kad-border">
                  <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Thành viên</th>
                  <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Việc tuần này</th>
                  <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Đạt lần đầu (30d)</th>
                  <th className="kad-caption text-kad-text-faint font-normal py-2">Chi phí 7 ngày</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ agent, stats }) => (
                  <tr key={agent.id} className="border-b border-kad-border last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <AgentAvatar
                          agentId={agent.id}
                          size={20}
                          displayNameOverride={agent.displayName}
                          agentNameOverride={agent.name}
                        />
                        <span className="kad-body text-kad-text truncate">{agent.displayName}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 kad-body text-kad-text-muted">{stats.tasksThisWeek}</td>
                    <td className="py-2.5 pr-3 kad-body text-kad-text-muted">
                      {formatPercent(stats.qualityPassRate30d)}
                    </td>
                    <td className="py-2.5 kad-body text-kad-text-muted">{formatVnd(stats.cost7dVnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </KadCard>

      <div className="mt-5">
        <KadEmptyState
          icon={BarChart3}
          message="Chart xu hướng theo ngày, breakdown chi phí theo dự án & xuất báo cáo PDF sẽ có khi chốt spec chi tiết."
        />
      </div>
    </div>
  );
}
