/**
 * Shared helpers for VanHoaTab.tsx + its two dedicated section components
 * (VanHoaStrategySection.tsx, VanHoaCoreValuesSection.tsx). Split out to keep
 * each file under the repo's ~200 LOC guideline.
 */
import { useEffect, useState } from "react";
import type { OrgContextData, OrgContextVersionRow } from "../../api-client";
import type { OrgContextSection } from "../../types";

export type SectionKey = OrgContextSection["key"];

export function useScrollSpy(keys: string[]): string | null {
  const [active, setActive] = useState<string | null>(keys[0] ?? null);
  const keyStr = keys.join("|");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace("section-", ""));
      },
      { rootMargin: "-88px 0px -60% 0px", threshold: 0 }
    );
    keyStr.split("|").forEach((k) => {
      const el = document.getElementById(`section-${k}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [keyStr]);
  return active;
}

export function fmtDate(value: string | null): string {
  if (!value) return "chưa duyệt";
  return new Date(value).toLocaleDateString("vi-VN");
}

export function strategyText(data: OrgContextData): string {
  const s = data.strategy || { goals: "", priorities: "", constraints: "", roadmap: "" };
  return [
    `## Goals\n${s.goals || ""}`,
    `## Priorities\n${s.priorities || ""}`,
    `## Constraints\n${s.constraints || ""}`,
    `## Roadmap\n${s.roadmap || ""}`,
  ].join("\n");
}

export function toSections(current: OrgContextVersionRow, pending: boolean): OrgContextSection[] {
  const data = current.data;
  return [
    {
      key: "su-menh",
      title: "Sứ mệnh",
      bodyMarkdown: data.mission || "",
      version: current.version,
      approvedAt: fmtDate(current.approved_at),
      pendingChange: pending,
    },
    {
      key: "tam-nhin",
      title: "Tầm nhìn",
      bodyMarkdown: data.vision || "",
      version: current.version,
      approvedAt: fmtDate(current.approved_at),
      pendingChange: pending,
    },
    {
      key: "gia-tri",
      title: "Giá trị cốt lõi",
      bodyMarkdown: (data.core_values || []).join("\n"),
      version: current.version,
      approvedAt: fmtDate(current.approved_at),
      pendingChange: pending,
    },
    {
      key: "nguyen-tac",
      title: "Nguyên tắc làm việc",
      bodyMarkdown: data.brand?.voice || "",
      version: current.version,
      approvedAt: fmtDate(current.approved_at),
      pendingChange: pending,
    },
    {
      key: "ky-luat",
      title: "Kỷ luật công việc",
      bodyMarkdown: data.brand?.guideline || "",
      version: current.version,
      approvedAt: fmtDate(current.approved_at),
      pendingChange: pending,
    },
    {
      key: "chien-luoc",
      title: "Chiến lược & Ưu tiên quý",
      bodyMarkdown: strategyText(data),
      version: current.version,
      approvedAt: fmtDate(current.approved_at),
      pendingChange: pending,
    },
  ];
}

// "gia-tri" (Giá trị cốt lõi) and "chien-luoc" (Chiến lược & Ưu tiên quý — 4
// sub-fields: goals/priorities/constraints/roadmap) have dedicated edit UIs
// (VanHoaCoreValuesSection, VanHoaStrategySection) that submit their own
// createDraft payload directly — they never call this. This used to also
// handle "chien-luoc" via a single free-text textarea whose *entire*
// contents (all 4 sub-fields concatenated with markdown headers) got written
// into just `strategy.priorities`, silently dropping goals/constraints/
// roadmap on every edit. Kept narrowed to the 4 keys that are genuinely a
// single free-text field.
export function nextData(
  data: OrgContextData,
  key: Exclude<SectionKey, "gia-tri" | "chien-luoc">,
  body: string
): OrgContextData {
  if (key === "su-menh") return { ...data, mission: body };
  if (key === "tam-nhin") return { ...data, vision: body };
  if (key === "nguyen-tac") return { ...data, brand: { ...data.brand, voice: body } };
  return { ...data, brand: { ...data.brand, guideline: body } };
}
