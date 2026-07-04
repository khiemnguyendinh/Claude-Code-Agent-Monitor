import type { CSSProperties } from "react";

/**
 * Fixed per-agent identity color — 06-components.md §6. Keyed by
 * agent_profiles.name (kebab-case id), permanent so the department "learns"
 * to recognize agents by color across every screen.
 */
const AGENT_HUE: Record<string, string> = {
  "main-agent-rd": "#1D237D", // Trợ lý vận hành
  "sub-program-architect": "#0E5BD1", // Kiến trúc
  "sub-curriculum-researcher": "#0E7490", // Nghiên cứu
  "sub-syllabus-designer": "#177E56", // Syllabus
  "sub-lesson-planner": "#B97D10", // Lesson
  "sub-slide-builder": "#7C4DBE", // Slide
  "sub-video-script-writer": "#C22F35", // Video
  "sub-quality-reviewer": "#3B4063", // QR
};

const FALLBACK_HUE = "#6B7099"; // --kad-text-muted, for helpers/unknown agents

export function agentHue(agentName: string): string {
  return AGENT_HUE[agentName] ?? FALLBACK_HUE;
}

/** 10% tint background + full-strength text/border, matching the chip/avatar
 * "tint bg + text đậm cùng họ" rule (00-design-language §2). */
export function agentTintStyle(agentName: string): CSSProperties {
  const hue = agentHue(agentName);
  return {
    backgroundColor: `${hue}1a`, // ~10% alpha
    color: hue,
  };
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
