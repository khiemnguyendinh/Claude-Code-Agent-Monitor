/**
 * Small shared atoms — 06-components.md §1 (Button), §8 (Card), §10
 * (Form & input), plus empty/skeleton states matching 01-app-shell §6.
 */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

// ── Button — 06 §1 ───────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "row" | "form"; // 32px in tables/rows, 36px in forms/headers

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-kad-primary text-white hover:brightness-[0.94] active:brightness-[0.88]",
  secondary:
    "bg-kad-surface text-kad-text border border-kad-border-strong hover:bg-kad-surface-2",
  ghost: "bg-transparent text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2",
  danger: "bg-transparent text-kad-danger border border-[#d6373d4d] hover:bg-[#fceaea]",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  row: "h-8 px-3",
  form: "h-9 px-3.5",
};

export const KadButton = forwardRef<HTMLButtonElement, ButtonProps>(function KadButton(
  { variant = "secondary", size = "form", icon: Icon, loading, className = "", children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`kad-label inline-flex items-center justify-center gap-1.5 rounded-lg transition-[filter,background-color,color] duration-[120ms] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
      ) : (
        Icon && <Icon className="w-4 h-4 flex-shrink-0" aria-hidden />
      )}
      {children}
    </button>
  );
});

// ── Icon-only button (topbar bell, drawer close, ⌘K trigger, etc.) ───────

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
}

export const KadIconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function KadIconButton(
  { icon: Icon, label, className = "", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2 transition-colors duration-[120ms] ${className}`}
      {...rest}
    >
      <Icon className="w-4 h-4" aria-hidden />
    </button>
  );
});

// ── Card — 06 §8 ─────────────────────────────────────────────────────────

export function KadCard({
  className = "",
  children,
  padding = "md",
}: {
  className?: string;
  children: ReactNode;
  padding?: "sm" | "md";
}) {
  return (
    <div
      className={`bg-kad-surface border border-kad-border rounded-xl ${padding === "sm" ? "p-4" : "p-5"} ${className}`}
    >
      {children}
    </div>
  );
}

export function KadCardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="kad-heading text-kad-text-strong">{title}</h3>
      {action}
    </div>
  );
}

// ── Form controls — 06 §10 ────────────────────────────────────────────────

export const KadInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function KadInput({ className = "", ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`kad-body h-9 w-full rounded-lg bg-kad-surface-2 border border-transparent px-3 text-kad-text placeholder:text-kad-text-faint focus:outline-none focus:border-kad-border-strong focus:ring-2 focus:ring-kad-accent/30 transition-colors ${className}`}
        {...rest}
      />
    );
  }
);

export const KadTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function KadTextarea({ className = "", ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={`kad-body min-h-[80px] w-full rounded-lg bg-kad-surface-2 border border-transparent px-3 py-2 text-kad-text placeholder:text-kad-text-faint focus:outline-none focus:border-kad-border-strong focus:ring-2 focus:ring-kad-accent/30 transition-colors resize-none ${className}`}
        {...rest}
      />
    );
  }
);

export function KadFieldLabel({ children }: { children: ReactNode }) {
  return <label className="kad-label text-kad-text block mb-1.5">{children}</label>;
}

// ── Empty state — 01-app-shell §6 ("icon 20 mờ + 1 câu + tối đa 1 nút") ──

export function KadEmptyState({
  icon: Icon,
  message,
  action,
}: {
  icon: LucideIcon;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <Icon className="w-5 h-5 text-kad-text-faint" aria-hidden />
      <p className="kad-body text-kad-text-muted">{message}</p>
      {action}
    </div>
  );
}

// ── Error block — 01-app-shell §6 ─────────────────────────────────────────

export function KadErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[#fceaea] px-4 py-3">
      <span className="kad-body text-[#c22f35]">Không tải được dữ liệu.</span>
      <KadButton variant="secondary" size="row" onClick={onRetry}>
        Thử lại
      </KadButton>
    </div>
  );
}

// ── Skeleton — static dim block, no shimmer (00 §5) ───────────────────────

export function KadSkeleton({ className = "" }: { className?: string }) {
  return <span className={`kad-skeleton inline-block ${className}`} aria-hidden />;
}

export function KadSkeletonRow({ widths = ["w-1/3", "w-1/4", "w-16"] }: { widths?: string[] }) {
  return (
    <div className="flex items-center gap-3 h-11 px-3">
      {widths.map((w, i) => (
        <KadSkeleton key={i} className={`h-3 ${w}`} />
      ))}
    </div>
  );
}
