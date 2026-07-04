/**
 * @file MessageList.tsx
 * @description Renders the chronological message stream of a Claude Code
 * transcript: alternating user / assistant rows with collapsible thinking
 * blocks, inline ToolCallBlocks for tool_use / tool_result pairs, and
 * MarkdownContent for prose. Used by ConversationView as the main body of
 * the Conversation tab on the Session detail page.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Bot,
  User,
  Brain,
  ScrollText,
  Terminal,
  Info,
  AlertTriangle,
  Pencil,
  Workflow,
  Cog,
} from "lucide-react";
import type { TranscriptMessage, TranscriptContent, TranscriptSender } from "../../lib/types";

/** Per-sender visual treatment for a transcript row. A JSONL `type:"user"` line
 *  is not always the human (tool results, harness task-notifications, the
 *  orchestrator's task to a subagent) — each sender gets its own label, icon,
 *  and accent so attribution is unambiguous. */
const SENDER_STYLES: Record<
  TranscriptSender,
  { label: string; icon: typeof User; avatarRing: string; accentBar: string; headerText: string }
> = {
  user: {
    label: "User",
    icon: User,
    avatarRing: "bg-kad-accent/15 text-kad-accent ring-1 ring-kad-accent/30",
    accentBar: "before:bg-kad-accent/50",
    headerText: "text-kad-accent",
  },
  assistant: {
    label: "Assistant",
    icon: Bot,
    avatarRing: "bg-kad-primary/15 text-kad-primary ring-1 ring-kad-primary/30",
    accentBar: "before:bg-kad-primary/50",
    headerText: "text-kad-primary",
  },
  orchestrator: {
    label: "Main agent",
    icon: Workflow,
    avatarRing: "bg-kad-info/15 text-kad-info ring-1 ring-kad-info/30",
    accentBar: "before:bg-kad-info/50",
    headerText: "text-kad-info",
  },
  system: {
    label: "System",
    icon: Cog,
    avatarRing: "bg-kad-surface-2 text-kad-text-muted ring-1 ring-kad-border-strong",
    accentBar: "before:bg-kad-border-strong",
    headerText: "text-kad-text-muted",
  },
  tool: {
    label: "Tool",
    icon: Terminal,
    avatarRing: "bg-kad-warning/15 text-kad-warning ring-1 ring-kad-warning/30",
    accentBar: "before:bg-kad-warning/50",
    headerText: "text-kad-warning",
  },
};
import { ToolCallBlock } from "./ToolCallBlock";
import { MarkdownContent } from "./MarkdownContent";
import { fmt, formatModelName } from "../../lib/format";
import { parseTuiSegments, stripAnsi, hasTuiTags, type TuiSegment } from "./tuiSegments";

interface MessageListProps {
  messages: TranscriptMessage[];
  loading: boolean;
}

/** Build a map from tool_use id → tool_result for matching */
function buildToolResultMap(messages: TranscriptMessage[]): Map<string, TranscriptContent> {
  const map = new Map<string, TranscriptContent>();
  for (const msg of messages) {
    if (msg.type !== "user") continue;
    for (const c of msg.content) {
      if (c.type === "tool_result" && c.id) {
        map.set(c.id, c);
      }
    }
  }
  return map;
}

/** Detect if text is skill loading content (starts with "Base directory for this skill:") */
function isSkillContent(text: string): boolean {
  return text.startsWith("Base directory for this skill:");
}

/** Detect if text is a task notification (contains <task-notification> tag) */
function isTaskNotification(text: string): boolean {
  return text.includes("<task-notification>") || text.includes("<task-id>");
}

/** Format a timestamp as compact local time (e.g. "14:23:01"). */
function formatLocalTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return "";
  }
}

/** Centered marker for a session rename (/rename, `claude -n`, picker Ctrl+R).
 *  These TUI-only commands write no conversation turn, so without this they're
 *  invisible in the transcript. */
function SessionEventRow({ title, timestamp }: { title?: string; timestamp: string | null }) {
  return (
    <div className="flex items-center justify-center py-1">
      <div className="inline-flex items-center gap-2 text-[11px] text-kad-text-muted bg-surface-2/70 border border-surface-3 rounded-full px-3 py-1 max-w-full">
        <Pencil className="w-3 h-3 text-kad-info/70 flex-shrink-0" />
        <span className="text-kad-text-muted">Renamed session →</span>
        <span className="text-kad-text font-medium truncate">{title || "(untitled)"}</span>
        {timestamp && (
          <span className="text-[10px] text-kad-text-faint font-mono flex-shrink-0">
            {formatLocalTime(timestamp)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Compact pill for /command invocations parsed out of TUI markup. */
function CommandPill({ display }: { display: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-sm text-kad-success font-mono bg-kad-success/10 border border-kad-success/20 rounded-md px-3 py-1.5 max-w-full">
      <span className="text-kad-success/70">›</span>
      <span className="break-all">{display}</span>
    </div>
  );
}

/** Terminal-style fenced block for stdout/stderr captured from local commands. */
function TerminalBlock({ text, stream }: { text: string; stream: "stdout" | "stderr" }) {
  const cleaned = stripAnsi(text).replace(/^\n+|\n+$/g, "");
  const isErr = stream === "stderr";
  const accent = isErr
    ? "border-kad-danger/30 bg-kad-danger/10 text-kad-danger"
    : "border-surface-3 bg-surface-4/60 text-kad-text";
  const labelColor = isErr ? "text-kad-danger/80" : "text-kad-text-muted";
  return (
    <div className={`rounded-lg border ${accent} overflow-hidden`}>
      <div
        className={`flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wider border-b border-current/10 ${labelColor}`}
      >
        <Terminal className="w-3 h-3" />
        <span>{stream}</span>
      </div>
      <pre className="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">
        {cleaned}
      </pre>
    </div>
  );
}

/** Subtle inline note for the local-command-caveat banner. */
function CaveatBlock({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-kad-warning/20 bg-kad-warning/5 px-3 py-1.5 text-[11px] text-kad-warning">
      <Info className="w-3.5 h-3.5 mt-px flex-shrink-0 opacity-60" />
      <span className="leading-relaxed italic">{stripAnsi(text).trim()}</span>
    </div>
  );
}

/** Render a single segment produced by parseTuiSegments. */
function renderSegment(seg: TuiSegment, key: number): React.ReactNode {
  switch (seg.kind) {
    case "command":
      return <CommandPill key={key} display={seg.display} />;
    case "stdout":
      return <TerminalBlock key={key} text={seg.text} stream="stdout" />;
    case "stderr":
      return <TerminalBlock key={key} text={seg.text} stream="stderr" />;
    case "caveat":
      return <CaveatBlock key={key} text={seg.text} />;
    case "system-reminder":
      return (
        <CollapsibleBlock
          key={key}
          text={seg.text}
          icon={<AlertTriangle className="w-3.5 h-3.5 text-kad-warning flex-shrink-0" />}
          title="System reminder"
          borderClass="border-kad-warning/20"
          bgClass="bg-kad-warning/5"
          textClass="text-kad-warning"
        />
      );
    case "persisted-output":
      return (
        <CollapsibleBlock
          key={key}
          text={seg.text}
          icon={<ScrollText className="w-3.5 h-3.5 text-kad-primary/70 flex-shrink-0" />}
          title="Persisted output"
          borderClass="border-kad-primary/20"
          bgClass="bg-kad-primary/5"
          textClass="text-kad-primary"
        />
      );
    case "text": {
      const cleaned = stripAnsi(seg.text);
      if (!cleaned.trim()) return null;
      return (
        <div key={key} className="min-w-0">
          <MarkdownContent text={cleaned} />
        </div>
      );
    }
  }
}

/** Generic collapsible content block */
function CollapsibleBlock({
  text,
  icon,
  title,
  borderClass,
  bgClass,
  textClass,
}: {
  text: string;
  icon: React.ReactNode;
  title: string;
  borderClass: string;
  bgClass: string;
  textClass: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-lg border ${borderClass} ${bgClass} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:opacity-80 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
        )}
        {icon}
        <span className={`text-xs ${textClass} truncate`}>{title}</span>
      </button>
      {expanded && (
        <div className="border-t border-current/10 px-3 py-2">
          <pre className="text-xs opacity-60 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages, loading }: MessageListProps) {
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(() => new Set());

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-kad-text-muted text-sm">
        Loading conversation...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="text-center py-12 text-kad-text-muted text-sm">
        No conversation records found.
      </div>
    );
  }

  const toolResultMap = buildToolResultMap(messages);

  // Track which user messages are pure tool_result (no text) - we merge those into the preceding assistant message
  const userMsgHasText = useMemo(() => {
    const map = new Map<number, boolean>();
    messages.forEach((msg, idx) => {
      if (msg.type !== "user") return;
      const hasText = msg.content.some((c) => c.type === "text");
      map.set(idx, hasText);
    });
    return map;
  }, [messages]);

  return (
    <div className="space-y-3">
      {messages.map((msg, idx) => {
        // Session lifecycle markers (e.g. /rename) render as a centered chip,
        // not as a user/assistant row.
        if (msg.type === "session_event") {
          return <SessionEventRow key={idx} title={msg.title} timestamp={msg.timestamp} />;
        }

        // Skip user messages that are purely tool_result - they're rendered inside ToolCallBlock
        if (msg.type === "user" && !userMsgHasText.get(idx)) {
          return null;
        }

        const isAssistant = msg.type === "assistant";
        // The true sender (classified server-side) drives the label + styling.
        // Falls back to the coarse type for older payloads without `sender`.
        const sender: TranscriptSender = msg.sender ?? (isAssistant ? "assistant" : "user");
        const style = SENDER_STYLES[sender] ?? SENDER_STYLES.user;
        const SenderIcon = style.icon;

        return (
          <div
            key={idx}
            className={`relative flex gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2/30 transition-colors before:absolute before:left-0 before:top-3 before:bottom-3 before:w-0.5 before:rounded-full before:opacity-60 ${style.accentBar}`}
          >
            {/* Avatar */}
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${style.avatarRing}`}
            >
              <SenderIcon className="w-4 h-4" />
            </div>

            {/* Message body */}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Header line */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold tracking-wide ${style.headerText}`}>
                  {style.label}
                </span>
                {msg.model && (
                  <span className="text-[10px] text-kad-text-muted font-mono bg-surface-3/60 border border-surface-3 rounded px-1.5 py-0.5">
                    {formatModelName(msg.model)}
                  </span>
                )}
                {msg.usage && (
                  <span className="text-[10px] text-kad-text-muted font-mono inline-flex items-center gap-1">
                    <span className="text-kad-success/70">↓ {fmt(msg.usage.input_tokens)}</span>
                    <span className="text-kad-text-faint">·</span>
                    <span className="text-kad-info/70">↑ {fmt(msg.usage.output_tokens)}</span>
                  </span>
                )}
                {msg.timestamp && (
                  <span className="text-[10px] text-kad-text-faint ml-auto font-mono">
                    {formatLocalTime(msg.timestamp)}
                  </span>
                )}
              </div>

              {/* Content blocks */}
              {msg.content.map((block, bIdx) => {
                if (block.type === "text" && block.text) {
                  // Detect task notifications, collapsed by default
                  if (isTaskNotification(block.text)) {
                    return (
                      <CollapsibleBlock
                        key={bIdx}
                        text={block.text}
                        icon={<ScrollText className="w-3.5 h-3.5 text-kad-info/70 flex-shrink-0" />}
                        title="Task Notification"
                        borderClass="border-kad-info/20"
                        bgClass="bg-kad-info/5"
                        textClass="text-kad-info"
                      />
                    );
                  }

                  // Detect skill content, collapsed by default
                  if (isSkillContent(block.text)) {
                    const pathMatch = block.text.match(/^Base directory for this skill:\s*(\S+)/);
                    const skillPath = pathMatch ? pathMatch[1]! : "Skill";
                    return (
                      <CollapsibleBlock
                        key={bIdx}
                        text={block.text}
                        icon={<ScrollText className="w-3.5 h-3.5 text-kad-accent/70 flex-shrink-0" />}
                        title={skillPath}
                        borderClass="border-kad-accent/20"
                        bgClass="bg-kad-accent/5"
                        textClass="text-kad-accent"
                      />
                    );
                  }

                  // Mixed TUI markup: caveat / command / stdout / stderr / system-reminder
                  // can appear inline (sometimes interleaved with prose). Parse the text
                  // into segments and render each with the appropriate visual treatment.
                  if (hasTuiTags(block.text)) {
                    const segments = parseTuiSegments(block.text);
                    return (
                      <div key={bIdx} className="space-y-2 min-w-0">
                        {segments.map((s, sIdx) => renderSegment(s, sIdx))}
                      </div>
                    );
                  }

                  return (
                    <div key={bIdx} className="min-w-0">
                      <MarkdownContent text={stripAnsi(block.text)} />
                    </div>
                  );
                }

                if (block.type === "thinking" && block.text) {
                  const thinkKey = idx * 100 + bIdx;
                  const isExpanded = expandedThinking.has(thinkKey);
                  return (
                    <div
                      key={bIdx}
                      className="rounded-lg border border-kad-warning/20 bg-kad-warning/5 overflow-hidden"
                    >
                      <button
                        onClick={() =>
                          setExpandedThinking((prev) => {
                            const next = new Set(prev);
                            if (next.has(thinkKey)) next.delete(thinkKey);
                            else next.add(thinkKey);
                            return next;
                          })
                        }
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-kad-warning/10 transition-colors"
                      >
                        <ChevronRight
                          className={`w-3.5 h-3.5 text-kad-warning/60 transition-transform duration-150 ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                        />
                        <Brain className="w-3.5 h-3.5 text-kad-warning/80" />
                        <span className="text-xs text-kad-warning font-medium">Thinking</span>
                        {!isExpanded && (
                          <span className="text-[10px] text-kad-warning/40 font-mono ml-auto">
                            {block.text.length.toLocaleString()} chars
                          </span>
                        )}
                      </button>
                      {isExpanded && (
                        <div className="border-t border-kad-warning/10 px-3 py-2 text-kad-warning">
                          <MarkdownContent text={block.text} dense />
                        </div>
                      )}
                    </div>
                  );
                }

                if (block.type === "tool_use") {
                  const matchedResult = block.id ? (toolResultMap.get(block.id) ?? null) : null;
                  return <ToolCallBlock key={bIdx} toolUse={block} toolResult={matchedResult} />;
                }

                // tool_result blocks rendered inside ToolCallBlock, skip standalone
                return null;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
