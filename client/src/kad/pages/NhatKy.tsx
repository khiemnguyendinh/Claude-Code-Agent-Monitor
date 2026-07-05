/**
 * Phase 7 audit viewer: filters task/agent/action/time against /api/kad/audit.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { RotateCw, ScrollText } from "lucide-react";
import { dashboardToken } from "../../lib/api";
import {
  KadButton,
  KadCard,
  KadEmptyState,
  KadErrorBlock,
  KadInput,
  KadSkeleton,
} from "../components/primitives";
import { formatAbsoluteDateTime } from "../format";

interface TaskRow {
  id: string;
  title: string;
}

interface AgentRow {
  id: string;
  display_name: string;
}

interface AuditRow {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  action: string;
  actor_type: "human" | "agent" | "system";
  actor_id: string | null;
  channel: string | null;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface Filters {
  task: string;
  agent: string;
  action: string;
  from: string;
  to: string;
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

function toIsoLocal(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function NhatKy() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filters, setFilters] = useState<Filters>({
    task: "",
    agent: "",
    action: "",
    from: "",
    to: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      kadGet<TaskRow[]>("/tasks?limit=500"),
      kadGet<AgentRow[]>("/agents?status=active"),
    ])
      .then(([taskRows, agentRows]) => {
        setTasks(taskRows);
        setAgents(agentRows);
      })
      .catch(() => {
        setTasks([]);
        setAgents([]);
      });
  }, []);

  const load = () => {
    setLoading(true);
    setError(false);
    const qs = new URLSearchParams();
    if (filters.task) qs.set("task", filters.task);
    if (filters.agent) qs.set("agent", filters.agent);
    if (filters.action) qs.set("action", filters.action.trim());
    if (filters.from) qs.set("from", toIsoLocal(filters.from));
    if (filters.to) qs.set("to", toIsoLocal(filters.to));
    kadGet<AuditRow[]>(`/audit${qs.toString() ? `?${qs.toString()}` : ""}`)
      .then((auditRows) =>
        setRows(
          [...auditRows].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        )
      )
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filters.task, filters.agent, filters.action, filters.from, filters.to]);

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a.display_name])), [agents]);
  const actionOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.action));
    [
      "task_created",
      "approval_requested",
      "approval_decided",
      "delegation_created",
      "artifact_created",
      "budget_exceeded",
    ].forEach((a) => set.add(a));
    return Array.from(set).sort();
  }, [rows]);

  return (
    <div className="pb-10 max-w-[1120px]">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-1">
        <h1 className="kad-title text-kad-text-strong">Nhật ký</h1>
        <KadButton icon={RotateCw} onClick={load}>
          Tải lại
        </KadButton>
      </div>
      <p className="kad-caption text-kad-text-faint mb-5">
        Audit log thật từ `/api/kad/audit`, lọc theo task, agent, action và thời gian.
      </p>

      <KadCard className="mb-5" padding="sm">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <FilterSelect
            label="Task"
            value={filters.task}
            onChange={(task) => setFilters((f) => ({ ...f, task }))}
          >
            <option value="">Tất cả task</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Agent"
            value={filters.agent}
            onChange={(agent) => setFilters((f) => ({ ...f, agent }))}
          >
            <option value="">Tất cả agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Action"
            value={filters.action}
            onChange={(action) => setFilters((f) => ({ ...f, action }))}
          >
            <option value="">Tất cả action</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </FilterSelect>
          <label>
            <span className="kad-caption text-kad-text-muted block mb-1">Từ</span>
            <KadInput
              type="datetime-local"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
          </label>
          <label>
            <span className="kad-caption text-kad-text-muted block mb-1">Đến</span>
            <KadInput
              type="datetime-local"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </label>
        </div>
      </KadCard>

      {error ? (
        <KadErrorBlock onRetry={load} />
      ) : loading ? (
        <KadCard>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 h-11 border-b border-kad-border last:border-0"
            >
              <KadSkeleton className="h-4 w-28" />
              <KadSkeleton className="h-4 w-40" />
              <KadSkeleton className="h-4 w-52" />
            </div>
          ))}
        </KadCard>
      ) : rows.length === 0 ? (
        <KadEmptyState icon={ScrollText} message="Không có audit log phù hợp bộ lọc." />
      ) : (
        <KadCard>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-kad-border">
                  <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">
                    Thời gian
                  </th>
                  <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Action</th>
                  <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Task</th>
                  <th className="kad-caption text-kad-text-faint font-normal py-2 pr-3">Agent</th>
                  <th className="kad-caption text-kad-text-faint font-normal py-2">Actor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-kad-border last:border-0">
                    <td
                      className="py-2.5 pr-3 kad-caption text-kad-text-muted whitespace-nowrap"
                      title={row.created_at}
                    >
                      {formatAbsoluteDateTime(row.created_at)}
                    </td>
                    <td className="py-2.5 pr-3 kad-body text-kad-text-strong whitespace-nowrap">
                      {row.action}
                    </td>
                    <td className="py-2.5 pr-3 kad-body text-kad-text truncate max-w-[260px]">
                      {row.task_id ? taskMap.get(row.task_id) || row.task_id : "—"}
                    </td>
                    <td className="py-2.5 pr-3 kad-body text-kad-text-muted truncate max-w-[220px]">
                      {row.agent_id ? agentMap.get(row.agent_id) || row.agent_id : "—"}
                    </td>
                    <td className="py-2.5 kad-body text-kad-text-muted whitespace-nowrap">
                      {row.actor_type}
                      {row.channel ? ` · ${row.channel}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </KadCard>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label>
      <span className="kad-caption text-kad-text-muted block mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="kad-body h-9 w-full rounded-lg bg-kad-surface-2 border border-transparent px-3 text-kad-text focus:outline-none focus:border-kad-border-strong focus:ring-2 focus:ring-kad-accent/30"
      >
        {children}
      </select>
    </label>
  );
}
