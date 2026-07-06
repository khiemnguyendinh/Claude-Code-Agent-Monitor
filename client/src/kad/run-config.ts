/**
 * @file client/src/kad/run-config.ts — shared option lists for the per-task run
 * configuration the "Giao việc" composer lets a user pick (kad-007): which model,
 * how much thinking (effort), and the permission mode the spawned `claude` turn
 * runs under. Kept in one module so the immediate composer (CongViecMoi), the
 * ongoing-task chat (TraoDoiCongViec), and the automation-rule form stay in sync.
 *
 * The empty-string value means "inherit / default" — callers send `null` (or omit)
 * so the server threads nothing and the engine/model default applies.
 */

export type OptionTuple = [value: string, label: string];

// Model ids mirror the current Claude family (see project knowledge). Empty →
// inherit the engine default configured for the agent.
export const MODEL_OPTIONS: OptionTuple[] = [
  ["", "Mặc định"],
  ["claude-opus-4-8", "Opus 4.8 (mạnh nhất)"],
  ["claude-sonnet-5", "Sonnet 5 (cân bằng)"],
  ["claude-haiku-4-5-20251001", "Haiku 4.5 (nhanh, rẻ)"],
];

// Maps to `claude --effort`. Empty → the model's own default depth.
export const THINKING_OPTIONS: OptionTuple[] = [
  ["", "Tư duy tiêu chuẩn"],
  ["low", "Tư duy thấp (nhanh)"],
  ["medium", "Tư duy vừa"],
  ["high", "Tư duy cao (kỹ)"],
];

// Maps to `claude --permission-mode`. acceptEdits is the historical KAD default.
export const PERMISSION_OPTIONS: OptionTuple[] = [
  ["acceptEdits", "Tự sửa file (mặc định)"],
  ["plan", "Chỉ lập kế hoạch"],
  ["default", "Hỏi trước khi sửa"],
  ["bypassPermissions", "Toàn quyền (bỏ hỏi)"],
];

/** Composer state → create/patch payload fields ("" → null so server inherits). */
export interface RunConfigState {
  model: string;
  thinking: string;
  permission: string;
}

export const DEFAULT_RUN_CONFIG: RunConfigState = {
  model: "",
  thinking: "",
  permission: "acceptEdits",
};

export function runConfigToPayload(rc: RunConfigState): {
  model: string | null;
  thinking_level: string | null;
  permission_mode: string | null;
} {
  return {
    model: rc.model || null,
    thinking_level: rc.thinking || null,
    // acceptEdits is the default; still send it so the choice is explicit/durable.
    permission_mode: rc.permission || null,
  };
}

/** Short human label for a stored value (for chips/summaries); "" → "Mặc định". */
export function labelFor(options: OptionTuple[], value: string | null | undefined): string {
  const v = value || "";
  const hit = options.find((o) => o[0] === v);
  return hit ? hit[1] : v || "Mặc định";
}
