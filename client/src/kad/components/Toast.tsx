/**
 * Toast — 06-components.md §12. Bottom-right, max 2 concurrent, 5s auto-
 * dismiss (paused on hover). Reserved for actions with no other on-screen
 * confirmation — a chip that already changed color should NOT also toast.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type ToastTone = "success" | "info" | "warning";

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
}

interface ShowToastInput {
  message: string;
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
}

const ToastContext = createContext<((input: ShowToastInput) => void) | null>(null);

const TONE_ICON: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
};

const TONE_COLOR: Record<ToastTone, string> = {
  success: "var(--kad-success)",
  info: "var(--kad-info)",
  warning: "var(--kad-warning)",
};

let idSeq = 0;

export function KadToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const schedule = useCallback(
    (id: string) => {
      const timer = setTimeout(() => dismiss(id), 5000);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  const showToast = useCallback(
    (input: ShowToastInput) => {
      idSeq += 1;
      const id = `toast-${idSeq}`;
      const item: ToastItem = { id, tone: "info", ...input };
      setToasts((prev) => [...prev.slice(-1), item]); // max 2 concurrent
      schedule(id);
    },
    [schedule]
  );

  const pause = (id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
  };
  const resume = (id: string) => schedule(id);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 items-end">
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <div
              key={t.id}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              className="kad-root min-w-[320px] max-w-sm bg-kad-surface border border-kad-border rounded-xl px-4 py-3 flex items-start gap-2.5"
              style={{ boxShadow: "var(--kad-shadow-1)" }}
            >
              <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: TONE_COLOR[t.tone] }} aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="kad-body text-kad-text">{t.message}</p>
                {t.actionLabel && t.onAction && (
                  <button
                    type="button"
                    onClick={t.onAction}
                    className="kad-label text-kad-accent hover:underline mt-1"
                  >
                    {t.actionLabel}
                  </button>
                )}
              </div>
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => dismiss(t.id)}
                className="text-kad-text-faint hover:text-kad-text-muted flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useKadToast() {
  const ctx = useContext(ToastContext);
  return useMemo(
    () =>
      ctx ??
      (() => {
        /* no-op outside provider */
      }),
    [ctx]
  );
}
