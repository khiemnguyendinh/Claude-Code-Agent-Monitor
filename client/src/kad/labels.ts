/**
 * Shared Vietnamese label maps — kept in one place so the same enum value
 * always reads the same way across Tổng quan / Công việc / Đội ngũ.
 */
import type { ApprovalType, ArtifactType, StepState } from "./types";
import type { ChipKind } from "./components/StatusChip";

export const ARTIFACT_TYPE_LABEL: Record<ArtifactType, string> = {
  program_framework: "Khung chương trình",
  research_report: "Nghiên cứu",
  syllabus: "Syllabus",
  lesson_plan: "Lesson plan",
  slide_outline: "Slide outline",
  video_script: "Video script",
  quality_report: "Quality report",
  connector_draft: "Bản nháp xuất bản",
  other: "Khác",
};

export const STEP_STATE_CHIP_KIND: Record<StepState, ChipKind> = {
  done: "done",
  doing: "doing",
  waiting_human: "pending",
  failed: "error",
  todo: "neutral",
};

const APPROVAL_CATEGORY_LABEL: Partial<Record<ApprovalType, string>> = {
  plan: "Kế hoạch",
  strategy: "Kế hoạch",
  artifact: "Học liệu",
  publish_facebook: "Xuất bản",
  publish_wordpress: "Xuất bản",
  blueprint_change: "Kế hoạch",
  template_change: "Kế hoạch",
  org_context_change: "Kế hoạch",
  sensitive_content: "Nhạy cảm",
};

export function approvalCategoryLabel(type: ApprovalType): string {
  return APPROVAL_CATEGORY_LABEL[type] ?? "Kế hoạch";
}

/** Step key -> the artifact_type it produces, for linking hạng mục rows to
 * their output học liệu (02-man-tong-quan §3 / 03-man-cong-viec §3). */
export const STEP_ARTIFACT_TYPE: Record<string, ArtifactType> = {
  framework: "program_framework",
  research: "research_report",
  syllabus: "syllabus",
  lesson: "lesson_plan",
  slide: "slide_outline",
  video: "video_script",
  review: "quality_report",
};
