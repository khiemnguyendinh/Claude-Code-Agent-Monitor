/**
 * ⌘K command palette — 01-app-shell.md §5. Client-side substring search over
 * mock tasks/agents/artifacts + a few quick commands. Real version reads
 * `/api/kad/search` [GAP — đề xuất endpoint search gộp].
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Bot, FileText, ListChecks, Search, Sunrise, UserPlus } from "lucide-react";
import { AGENTS, ARTIFACTS, TASK_CARDS } from "../mockData";
import { useKadStore } from "../store";
import { usePeek } from "./PeekDrawer";

interface ResultItem {
  id: string;
  group: "Lệnh nhanh" | "Công việc" | "Thành viên AI" | "Học liệu";
  label: string;
  icon: typeof Search;
  onSelect: () => void;
  onSelectPeek?: () => void;
}

export function useCommandPaletteHotkey(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { openPeek } = usePeek();
  const { regenerateStandup } = useKadStore();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const results = useMemo<ResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    const quickCommands: ResultItem[] = [
      {
        id: "cmd-approve-queue",
        group: "Lệnh nhanh",
        label: "Duyệt hàng chờ",
        icon: ListChecks,
        onSelect: () => navigate("/"),
      },
      {
        id: "cmd-new-task",
        group: "Lệnh nhanh",
        label: "Giao việc mới",
        icon: UserPlus,
        onSelect: () => navigate("/cong-viec/moi"),
      },
      {
        id: "cmd-standup",
        group: "Lệnh nhanh",
        label: "Giao ban sáng",
        icon: Sunrise,
        onSelect: () => {
          regenerateStandup();
          navigate("/");
        },
      },
    ];
    const matches = (text: string) => q.length === 0 || text.toLowerCase().includes(q);

    const taskResults: ResultItem[] = TASK_CARDS.filter((t) => matches(t.title))
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        group: "Công việc",
        label: t.title,
        icon: ListChecks,
        onSelect: () => navigate(`/cong-viec/${t.id}`),
        onSelectPeek: () => openPeek({ type: "task", id: t.id }),
      }));

    const agentResults: ResultItem[] = AGENTS.filter((a) => matches(a.displayName))
      .slice(0, 5)
      .map((a) => ({
        id: a.id,
        group: "Thành viên AI",
        label: a.displayName,
        icon: Bot,
        onSelect: () => navigate("/doi-ngu"),
        onSelectPeek: () => openPeek({ type: "agent", id: a.id }),
      }));

    const artifactResults: ResultItem[] = ARTIFACTS.filter((a) => matches(a.title))
      .slice(0, 5)
      .map((a) => ({
        id: a.id,
        group: "Học liệu",
        label: a.title,
        icon: FileText,
        onSelect: () => openPeek({ type: "artifact", id: a.id }),
      }));

    const cmdResults = quickCommands.filter((c) => matches(c.label));
    return [...cmdResults, ...taskResults, ...agentResults, ...artifactResults];
  }, [query, navigate, openPeek, regenerateStandup]);

  const groups = useMemo(() => {
    const order: ResultItem["group"][] = ["Lệnh nhanh", "Công việc", "Thành viên AI", "Học liệu"];
    return order
      .map((g) => ({ group: g, items: results.filter((r) => r.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [results]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="kad-root fixed inset-0 z-[220] flex items-start justify-center pt-[15vh] px-4 bg-[#0e12304d]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[560px] bg-kad-surface border border-kad-border rounded-xl overflow-hidden"
        style={{ boxShadow: "var(--kad-shadow-1)" }}
      >
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-kad-border">
          <Search className="w-4 h-4 text-kad-text-faint flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm task, agent, học liệu, hoặc lệnh nhanh…"
            className="kad-body flex-1 bg-transparent outline-none text-kad-text placeholder:text-kad-text-faint"
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                if (e.metaKey || e.ctrlKey) {
                  (results[0].onSelectPeek ?? results[0].onSelect)();
                } else {
                  results[0].onSelect();
                }
                onClose();
              }
            }}
          />
        </div>
        <div className="max-h-[360px] overflow-y-auto py-2">
          {groups.length === 0 ? (
            <p className="kad-body text-kad-text-faint text-center py-8">Không có kết quả.</p>
          ) : (
            groups.map((g) => (
              <div key={g.group} className="px-2 py-1">
                <p className="kad-overline text-kad-text-faint px-2 py-1">{g.group}</p>
                {g.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        item.onSelect();
                        onClose();
                      }}
                      className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-kad-surface-2 text-left"
                    >
                      <Icon className="w-4 h-4 text-kad-text-muted flex-shrink-0" />
                      <span className="kad-body text-kad-text truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 px-4 h-9 border-t border-kad-border">
          <span className="kad-caption text-kad-text-faint">⏎ mở</span>
          <span className="kad-caption text-kad-text-faint">⌘⏎ xem nhanh</span>
          <span className="kad-caption text-kad-text-faint">ESC đóng</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
