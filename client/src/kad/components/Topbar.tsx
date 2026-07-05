/**
 * Topbar — 01-app-shell.md §3. Breadcrumb (max 2 levels) · ⌘K trigger ·
 * notification bell. No avatar (already in sidebar), no theme switcher.
 */
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, Search } from "lucide-react";
import { TASK_CARDS } from "../mockData";
import { useKadStore } from "../store";
import { formatRelativeTime } from "../format";

function useBreadcrumb(): string[] {
  const { pathname } = useLocation();
  if (pathname === "/") return ["Tổng quan"];
  if (pathname === "/cong-viec/moi") return ["Giao việc"];
  if (pathname === "/cong-viec") return ["Công việc"];
  if (pathname.startsWith("/cong-viec/")) {
    const id = pathname.split("/")[2];
    const task = TASK_CARDS.find((t) => t.id === id);
    return ["Công việc", task?.title ?? "Trao đổi công việc"];
  }
  if (pathname === "/doi-ngu") return ["Đội ngũ"];
  if (pathname === "/hoc-lieu") return ["Học liệu"];
  if (pathname === "/ket-noi") return ["Kết nối"];
  if (pathname.startsWith("/phe-duyet/")) return ["Phê duyệt"];
  if (pathname === "/bao-cao") return ["Báo cáo"];
  if (pathname === "/nhat-ky") return ["Nhật ký"];
  return ["Tổng quan"];
}

export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const crumbs = useBreadcrumb();
  const [bellOpen, setBellOpen] = useState(false);
  const { notifications, unreadCount, markAllNotificationsRead } = useKadStore();
  const navigate = useNavigate();

  return (
    <header className="h-14 flex-shrink-0 flex items-center gap-3 px-6 border-b border-kad-border">
      <nav className="kad-label text-kad-text-muted flex items-center gap-1.5 min-w-0">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <span className="text-kad-text-faint">/</span>}
            <span
              className={`truncate ${i === crumbs.length - 1 ? "text-kad-text-strong font-medium" : ""}`}
            >
              {c}
            </span>
          </span>
        ))}
      </nav>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onOpenPalette}
        className="kad-label hidden sm:flex items-center gap-2 w-[140px] h-8 px-2.5 rounded-lg border border-kad-border text-kad-text-muted hover:border-kad-border-strong flex-shrink-0"
      >
        <Search className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">Tìm kiếm…</span>
        <span className="ml-auto kad-caption text-kad-text-faint">⌘K</span>
      </button>
      <div className="relative flex-shrink-0">
        <button
          type="button"
          aria-label="Thông báo"
          onClick={() => setBellOpen((s) => !s)}
          className="relative w-8 h-8 flex items-center justify-center rounded-lg text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-kad-danger" />
          )}
        </button>
        {bellOpen && (
          <>
            <div className="fixed inset-0 z-[140]" onClick={() => setBellOpen(false)} aria-hidden />
            <div
              className="absolute right-0 top-10 z-[141] w-[380px] bg-kad-surface border border-kad-border rounded-xl overflow-hidden"
              style={{ boxShadow: "var(--kad-shadow-1)" }}
            >
              <div className="flex items-center justify-between px-4 h-11 border-b border-kad-border">
                <span className="kad-heading text-kad-text-strong">Thông báo</span>
                <button
                  type="button"
                  onClick={markAllNotificationsRead}
                  className="kad-caption text-kad-accent hover:underline"
                >
                  Đánh dấu đã đọc hết
                </button>
              </div>
              <div className="max-h-[360px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="kad-body text-kad-text-faint text-center py-8">
                    Không có thông báo.
                  </p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        setBellOpen(false);
                        navigate(n.linkPath);
                      }}
                      className="w-full flex items-start gap-2 px-4 py-2.5 hover:bg-kad-surface-2 text-left border-b border-kad-border last:border-0"
                    >
                      {!n.readAt && (
                        <span className="w-1.5 h-1.5 rounded-full bg-kad-accent mt-1.5 flex-shrink-0" />
                      )}
                      <span className={n.readAt ? "pl-3.5" : ""}>
                        <span className="kad-body text-kad-text block">{n.body}</span>
                        <span className="kad-caption text-kad-text-faint">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
