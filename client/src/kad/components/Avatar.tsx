/**
 * Avatar & identity — 06-components.md §6. Agent avatars use the fixed hue
 * map (agentTheme.ts); the human lead always renders distinctly (solid
 * primary background) so they're never mistaken for an AI teammate.
 */
import { agentHue, agentTintStyle, initialsFromName } from "../agentTheme";
import { findAgent } from "../mockData";

export type DotStatus = "running" | "idle" | "waiting" | "error";

const DOT_COLOR: Record<DotStatus, string> = {
  running: "var(--kad-success)",
  idle: "var(--kad-text-faint)",
  waiting: "var(--kad-warning)",
  error: "var(--kad-danger)",
};

const SIZE_PX = { 20: 20, 24: 24, 28: 28, 40: 40 } as const;
type AvatarSize = keyof typeof SIZE_PX;

function StatusDot({ status, size }: { status: DotStatus; size: AvatarSize }) {
  const dotSize = size >= 28 ? 9 : 7;
  return (
    <span
      className="absolute rounded-full border-2 border-kad-surface"
      style={{
        width: dotSize,
        height: dotSize,
        backgroundColor: DOT_COLOR[status],
        right: -1,
        bottom: -1,
      }}
      aria-hidden
    />
  );
}

export function AgentAvatar({
  agentId,
  size = 24,
  status,
  helper = false,
  // Real-data override (screens wired to /api/kad/* pass the already-fetched
  // agent's name/displayName instead of relying on the mockData registry).
  displayNameOverride,
  agentNameOverride,
}: {
  agentId: string;
  size?: AvatarSize;
  status?: DotStatus;
  helper?: boolean;
  displayNameOverride?: string;
  agentNameOverride?: string;
}) {
  const agent = displayNameOverride ? null : findAgent(agentId);
  const name = displayNameOverride ?? agent?.displayName ?? "?";
  const hue = agentHue(agentNameOverride ?? agent?.name ?? agentId);
  const px = SIZE_PX[size];
  return (
    <span
      className="relative inline-flex flex-shrink-0"
      style={{ width: px, height: px }}
      title={name}
    >
      <span
        className={`flex items-center justify-center rounded-full font-semibold ${helper ? "border border-dashed" : ""}`}
        style={{
          width: px,
          height: px,
          fontSize: px <= 20 ? 9 : px <= 28 ? 11 : 14,
          borderColor: helper ? hue : undefined,
          ...agentTintStyle(agentNameOverride ?? agent?.name ?? agentId),
        }}
      >
        {initialsFromName(name)}
      </span>
      {status && <StatusDot status={status} size={size} />}
    </span>
  );
}

export function HumanAvatar({ name, size = 24 }: { name: string; size?: AvatarSize }) {
  const px = SIZE_PX[size];
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-kad-primary text-white font-semibold flex-shrink-0"
      style={{ width: px, height: px, fontSize: px <= 20 ? 9 : px <= 28 ? 11 : 14 }}
      title={name}
    >
      {initialsFromName(name)}
    </span>
  );
}

/** Small stack for "agent đang tham gia" (max 3 + N), 03-man-cong-viec §3. */
export function AgentAvatarStack({ agentIds, max = 3 }: { agentIds: string[]; max?: number }) {
  const shown = agentIds.slice(0, max);
  const rest = agentIds.length - shown.length;
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((id) => (
        <span key={id} className="ring-2 ring-kad-surface rounded-full">
          <AgentAvatar agentId={id} size={20} />
        </span>
      ))}
      {rest > 0 && (
        <span className="ring-2 ring-kad-surface rounded-full w-5 h-5 flex items-center justify-center bg-kad-surface-2 text-kad-text-muted kad-caption font-medium">
          +{rest}
        </span>
      )}
    </span>
  );
}
