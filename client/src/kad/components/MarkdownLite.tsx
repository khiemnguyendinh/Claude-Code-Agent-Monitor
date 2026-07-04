/**
 * Lightweight markdown-ish renderer for artifact content — deliberately not
 * a full parser (no new dependency); handles the subset (# / ## / - / plain
 * paragraph) that agent-authored artifacts actually use.
 */
import type { DiffLine } from "../diff";

function lineClass(text: string): { tag: "h3" | "h4" | "li" | "p"; content: string } {
  if (text.startsWith("## ")) return { tag: "h4", content: text.slice(3) };
  if (text.startsWith("# ")) return { tag: "h3", content: text.slice(2) };
  if (text.startsWith("- ")) return { tag: "li", content: text.slice(2) };
  return { tag: "p", content: text };
}

function LineBlock({ text }: { text: string }) {
  const { tag, content } = lineClass(text);
  if (content.trim() === "") return null;
  if (tag === "h3") return <h3 className="kad-title text-kad-text-strong mt-4 first:mt-0">{content}</h3>;
  if (tag === "h4") return <h4 className="kad-heading text-kad-text-strong mt-3">{content}</h4>;
  if (tag === "li")
    return (
      <p className="kad-body text-kad-text pl-4 relative">
        <span className="absolute left-0 text-kad-text-faint">•</span>
        {content}
      </p>
    );
  return <p className="kad-body text-kad-text">{content}</p>;
}

export function MarkdownLite({ content }: { content: string }) {
  return (
    <div className="space-y-1.5 max-w-[720px]">
      {content.split("\n").map((line, i) => (
        <LineBlock key={i} text={line} />
      ))}
    </div>
  );
}

const DIFF_BG: Record<DiffLine["type"], string> = {
  added: "#e6f6ef",
  removed: "#fceaea",
  same: "transparent",
};

export function MarkdownDiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="space-y-0.5 max-w-[720px]">
      {lines.map((line, i) => {
        const { tag, content } = lineClass(line.text);
        if (content.trim() === "" && line.type === "same") return null;
        const marker = line.type === "added" ? "+" : line.type === "removed" ? "−" : " ";
        const textClass =
          tag === "h3"
            ? "kad-title text-kad-text-strong"
            : tag === "h4"
              ? "kad-heading text-kad-text-strong"
              : "kad-body text-kad-text";
        return (
          <div
            key={i}
            className="flex gap-2 px-2 py-0.5 rounded"
            style={{ backgroundColor: DIFF_BG[line.type] }}
          >
            <span className="kad-caption text-kad-text-faint w-3 flex-shrink-0 select-none">{marker}</span>
            <span className={textClass}>{content || " "}</span>
          </div>
        );
      })}
    </div>
  );
}
