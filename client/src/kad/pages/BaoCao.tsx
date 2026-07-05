/**
 * Màn Báo cáo (`/bao-cao`) — nhóm phụ sidebar, "Spec sau" (README §routes).
 * Mockup: chỉ dựng phần có thể suy ra an toàn từ dữ liệu đã có (chi phí
 * & chất lượng theo agent, từ AGENT_STATS — cùng nguồn đã dùng ở Đội ngũ).
 * KHÔNG bịa thêm chart/biểu đồ trục đầy đủ hay bảng chi phí theo ngày —
 * phần đó cần workflow_definitions + token_usage thật, để dành spec riêng
 * (06-components.md: "chỉ chart trong Báo cáo mới có axis đầy đủ").
 */
import { BarChart3 } from "lucide-react";
import { AGENTS, AGENT_STATS } from "../mockData";
import { KadCard, KadCardHeader, KadEmptyState } from "../components/primitives";
import { AgentAvatar } from "../components/Avatar";
import { formatPercent, formatVnd } from "../format";
import { useNavigate } from "react-router-dom";

export function BaoCao() {
  const rows = AGENTS.map((a) => ({ agent: a, stats: AGENT_STATS[a.id] })).filter((r) => r.stats);
  const totalCost7d = rows.reduce((sum, r) => sum + (r.stats?.cost7dVnd ?? 0), 0);
  const totalTasks = rows.reduce((sum, r) => sum + (r.stats?.tasksThisWeek ?? 0), 0);
  const navigate = useNavigate();

  return (
    <div className="pb-10 max-w-[900px]">
      <div className="flex justify-between items-center mb-1">
        <h1 className="kad-title text-kad-text-strong">Báo cáo</h1>
        <button 
          onClick={() => navigate('/bao-cao/learning')}
          className="kad-label bg-kad-surface-2 text-kad-text-strong px-4 py-2 rounded-lg border border-kad-border hover:border-kad-border-strong"
        >
          Kinh nghiệm (Learning)
        </button>
      </div>
      <p className="kad-caption text-kad-text-faint mb-5">
        Phân tích sâu theo thời gian, chi phí chi tiết & chart đầy đủ trục đang chờ chốt spec riêng. Dưới đây là tổng
        hợp nhanh theo thành viên AI, 7 ngày gần nhất.
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
                      <AgentAvatar agentId={agent.id} size={20} />
                      <span className="kad-body text-kad-text truncate">{agent.displayName}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 kad-body text-kad-text-muted">{stats?.tasksThisWeek}</td>
                  <td className="py-2.5 pr-3 kad-body text-kad-text-muted">
                    {formatPercent(stats?.qualityPassRate30d ?? 0)}
                  </td>
                  <td className="py-2.5 kad-body text-kad-text-muted">{formatVnd(stats?.cost7dVnd ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
