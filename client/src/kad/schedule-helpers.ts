/**
 * client/src/kad/schedule-helpers.ts — shared "Theo lịch" building blocks
 * (spec/ui/09 §1) used by both CongViecMoi.tsx's composer control and
 * AutomationRuleForm.tsx's "+ Tạo luật" form. Pure data/labels only — no
 * JSX here, each caller keeps its own layout (spec 07/09: no redesign).
 */
import type { ScheduleFrequency } from "./types";

export const SCHEDULE_FREQS: { id: ScheduleFrequency; label: string }[] = [
  { id: "once", label: "Một lần" },
  { id: "daily", label: "Hằng ngày" },
  { id: "weekly", label: "Hằng tuần" },
  { id: "monthly", label: "Hằng tháng" },
];

export const WEEKDAYS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

/** Ngôn ngữ tự nhiên hiển thị + lưu vào trigger_config.label (spec/ui/09 §1: "không cron thô"). */
export function scheduleLabel(
  freq: ScheduleFrequency,
  time: string,
  weekday: string,
  day: string
): string {
  switch (freq) {
    case "once":
      return `Một lần vào ngày ${day || "1"} lúc ${time}`;
    case "daily":
      return `Hằng ngày lúc ${time}`;
    case "weekly":
      return `Hằng tuần, ${weekday} lúc ${time}`;
    case "monthly":
      return `Hằng tháng, ngày ${day || "1"} lúc ${time}`;
  }
}
