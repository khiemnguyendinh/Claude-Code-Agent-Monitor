/**
 * vi-VN display formatting for KAD — 06-components.md §13.
 * Decimal separator is a comma (vi-VN locale), numbers compact to
 * "k" (nghìn) / "tr" (triệu), max 1 decimal place, trailing ",0" dropped.
 */

function compact(n: number, divisor: number, suffix: string): string {
  const value = n / divisor;
  const rounded = Math.round(value * 10) / 10;
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${str}${suffix}`;
}

/** 1234 -> "1,2k" · 1234567 -> "1,2tr" · <1000 -> as-is. */
export function formatCompactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return compact(n, 1_000_000, "tr");
  if (abs >= 1_000) return compact(n, 1_000, "k");
  return String(Math.round(n));
}

export function formatTokens(n: number): string {
  return `${formatCompactNumber(n)} tokens`;
}

export function formatVnd(n: number): string {
  return `${formatCompactNumber(n)} đ`;
}

/** Max 1 decimal, comma separator. 84 -> "84%" · 84.5 -> "84,5%". */
export function formatPercent(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${str}%`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatAbsoluteDate(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

/** "8 phút trước" / "3 giờ trước" / "Hôm qua" / after 7 days -> "12/06". */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, now - then);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Vừa xong";
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return "Hôm qua";
  if (diffDay < 7) return `${diffDay} ngày trước`;
  return formatAbsoluteDate(new Date(then));
}

/** Absolute tooltip value, e.g. "14:32 · 28/06/2026". */
export function formatAbsoluteDateTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())} · ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** SLA countdown: "còn 3h" (on time) or "quá 4h" (overdue, danger=true). */
export function formatSlaCountdown(
  dueIso: string,
  now: number = Date.now()
): { text: string; overdue: boolean } {
  const due = new Date(dueIso).getTime();
  const diffHours = (due - now) / 3_600_000;
  if (diffHours >= 0) {
    const h = Math.max(1, Math.round(diffHours));
    return { text: `còn ${h}h`, overdue: false };
  }
  const overdueHours = Math.max(1, Math.round(-diffHours));
  return { text: `quá ${overdueHours}h`, overdue: true };
}

/** Due-date caption for kanban/list rows — reads relative for <7 days out. */
export function formatDueDate(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const due = new Date(iso).getTime();
  const diffDays = Math.round((due - now) / 86_400_000);
  if (diffDays === 0) return "Hôm nay";
  if (diffDays === 1) return "Ngày mai";
  if (diffDays === -1) return "Hôm qua";
  if (diffDays < 0) return `Quá hạn ${Math.abs(diffDays)} ngày`;
  if (diffDays < 7) return `${diffDays} ngày nữa`;
  return formatAbsoluteDate(new Date(due));
}

export function isOverdue(iso: string | null, now: number = Date.now()): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < now;
}
