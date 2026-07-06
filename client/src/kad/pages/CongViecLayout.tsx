/**
 * @file client/src/kad/pages/CongViecLayout.tsx — the "Giao việc" area shell:
 * a persistent left column listing chat/task sessions (with a filter + search
 * box, Claude-Desktop style) next to the active chat (Outlet). Wraps
 * /cong-viec/moi, /cong-viec/tu-dong-hoa and /cong-viec/:id so the list is
 * always visible while switching between tasks.
 *
 * Filters: "Gần nhất" (flat, newest first) and "Dự án" (grouped by working_dir,
 * the closest real project key a task carries). Search matches title. Data is
 * the real GET /api/kad/tasks — refetched whenever the route changes so a task
 * just created in the composer appears immediately.
 */
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { kadApi, type KadTask } from "../api-client";
import { TaskStatusChip } from "../components/StatusChip";
import { formatRelativeTime } from "../format";

type Filter = "recent" | "project";

export function CongViecLayout() {
  const location = useLocation();
  const [tasks, setTasks] = useState<KadTask[]>([]);
  const [filter, setFilter] = useState<Filter>("recent");
  const [query, setQuery] = useState("");

  // Refetch on every navigation within the area (cheap, ≤100 rows) so a task
  // created in the composer or by an automation rule shows up without a reload.
  useEffect(() => {
    let alive = true;
    kadApi.tasks
      .list({ limit: 100 })
      .then((rows) => {
        if (alive) setTasks(rows);
      })
      .catch(() => {
        if (alive) setTasks([]);
      });
    return () => {
      alive = false;
    };
  }, [location.pathname]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
    return [...rows].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [tasks, query]);

  // "Dự án" grouping — by working_dir (the real per-task project folder).
  const groups = useMemo(() => {
    if (filter !== "project") return null;
    const map = new Map<string, KadTask[]>();
    for (const t of filtered) {
      const key = t.workingDir || "(chưa gán dự án)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, filter]);

  return (
    <div className="flex gap-6 min-w-0">
      <aside className="w-[260px] flex-shrink-0 flex flex-col gap-3">
        <NavLink
          to="/cong-viec/moi"
          className="kad-label h-9 rounded-lg bg-kad-accent text-white flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
        >
          <span aria-hidden>＋</span> Giao việc mới
        </NavLink>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm việc…"
          className="kad-caption h-8 rounded-md bg-kad-surface-2 border border-transparent px-2.5 text-kad-text focus:outline-none focus:border-kad-border-strong"
        />

        <div className="inline-flex rounded-lg bg-kad-surface-2 p-0.5 self-start">
          {(
            [
              ["recent", "Gần nhất"],
              ["project", "Dự án"],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`kad-label h-7 px-3 rounded-md transition-colors ${
                filter === id
                  ? "bg-kad-surface text-kad-text-strong"
                  : "text-kad-text-muted hover:text-kad-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
          {filtered.length === 0 && (
            <p className="kad-caption text-kad-text-faint px-1 py-2">
              {query ? "Không có việc khớp." : "Chưa có việc nào."}
            </p>
          )}

          {filter === "recent" &&
            filtered.map((t) => <TaskRow key={t.id} task={t} />)}

          {filter === "project" &&
            groups!.map(([dir, rows]) => (
              <div key={dir} className="mt-1">
                <p className="kad-overline text-kad-text-faint px-1 py-1 truncate" title={dir}>
                  {dir}
                </p>
                {rows.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            ))}
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: KadTask }) {
  return (
    <NavLink
      to={`/cong-viec/${task.id}`}
      className={({ isActive }) =>
        `block rounded-lg px-2.5 py-2 transition-colors ${
          isActive ? "bg-kad-surface-2" : "hover:bg-kad-surface"
        }`
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className="kad-label text-kad-text-strong line-clamp-2 min-w-0">{task.title}</p>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <TaskStatusChip status={task.status} />
        <span className="kad-caption text-kad-text-faint flex-shrink-0">
          {formatRelativeTime(task.updatedAt)}
        </span>
      </div>
    </NavLink>
  );
}
