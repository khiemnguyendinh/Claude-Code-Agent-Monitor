/**
 * Peek drawer — 01-app-shell.md §4, the central "look at anything without
 * leaving the screen" pattern. One global instance (mounted by KadShell);
 * any screen opens it via usePeek(). Stacks at most 1 level deep (opening a
 * peek from within a peek replaces the content and shows a back arrow).
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PeekContent, PEEK_TITLES, peekFullPagePath } from "./PeekContent";

export type PeekType =
  | "task"
  | "project"
  | "artifact"
  | "approval"
  | "agent"
  | "goal"
  | "workflow-run";

export interface PeekTarget {
  type: PeekType;
  id: string;
}

interface PeekContextValue {
  openPeek: (target: PeekTarget) => void;
  closePeek: () => void;
}

const PeekContext = createContext<PeekContextValue | null>(null);

export function usePeek(): PeekContextValue {
  const ctx = useContext(PeekContext);
  if (!ctx) {
    return { openPeek: () => {}, closePeek: () => {} };
  }
  return ctx;
}

export function PeekDrawerHost({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<PeekTarget[]>([]);
  const navigate = useNavigate();

  const openPeek = useCallback((target: PeekTarget) => {
    setStack((prev) => [...prev, target]);
  }, []);

  const closePeek = useCallback(() => setStack([]), []);
  const goBack = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);

  const current = stack[stack.length - 1];

  useEffect(() => {
    if (!current) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePeek();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, closePeek]);

  const width = current?.type === "artifact" ? 560 : 480;
  const fullPagePath = current ? peekFullPagePath(current) : null;

  return (
    <PeekContext.Provider value={{ openPeek, closePeek }}>
      {children}
      {current && (
        <>
          <div
            className="fixed inset-0 z-[150] bg-[#0E1230]/25 animate-[kad-fade-in_160ms_var(--kad-ease)]"
            onClick={closePeek}
            aria-hidden
          />
          <aside
            className="fixed right-0 top-0 bottom-0 z-[151] bg-kad-surface flex flex-col animate-[kad-slide-in_200ms_var(--kad-ease)]"
            style={{ width, boxShadow: "var(--kad-shadow-1)" }}
            role="dialog"
            aria-modal="true"
            aria-label={PEEK_TITLES[current.type]}
          >
            <header className="h-14 flex-shrink-0 flex items-center justify-between gap-2 px-4 border-b border-kad-border">
              <div className="flex items-center gap-2 min-w-0">
                {stack.length > 1 && (
                  <button
                    type="button"
                    onClick={goBack}
                    aria-label="Quay lại"
                    className="text-kad-text-muted hover:text-kad-text flex-shrink-0"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <span className="kad-overline text-kad-text-faint flex-shrink-0">
                  {PEEK_TITLES[current.type]}
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {fullPagePath && (
                  <button
                    type="button"
                    onClick={() => {
                      closePeek();
                      navigate(fullPagePath);
                    }}
                    aria-label="Mở trang đầy đủ"
                    title="Mở trang đầy đủ"
                    className="w-7 h-7 flex items-center justify-center rounded-md text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={closePeek}
                  aria-label="Đóng"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <PeekContent target={current} onOpenPeek={openPeek} onClose={closePeek} />
            </div>
          </aside>
        </>
      )}
    </PeekContext.Provider>
  );
}
