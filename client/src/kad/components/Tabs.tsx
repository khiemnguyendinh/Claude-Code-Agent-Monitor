/**
 * Main tab bar — 2026-07-04 restyle. Was an underline-only row (read like
 * plain small headings, not obviously clickable — Khiêm's feedback). Now a
 * flat Apple-style segmented control: a track (`kad-surface-2`) holding
 * pill buttons, the active one lifted with a white fill + soft shadow. Same
 * visual language already used for the sidebar language switcher and the
 * Tổng quan Ngày/Tuần/Tháng switch, just sized up for page-level tabs so
 * the whole app shares one "this is a segmented control" affordance.
 * Centered by default (`size="default"`) per Khiêm's request so the tab
 * group reads as a distinct control, not body text; `size="small"` (nested/
 * secondary tab bars) stays left-aligned and more compact.
 */

export interface TabItem {
  key: string;
  label: string;
}

export function Tabs({
  items,
  active,
  onChange,
  size = "default",
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  size?: "default" | "small";
}) {
  const small = size === "small";
  return (
    <div className={`flex ${small ? "justify-start" : "justify-center"}`}>
      <div
        className={`inline-flex items-center max-w-full overflow-x-auto rounded-xl border border-kad-border bg-kad-surface-2 ${
          small ? "gap-0.5 p-0.5" : "gap-1 p-1"
        }`}
      >
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              aria-current={isActive ? "page" : undefined}
              className={`flex-shrink-0 whitespace-nowrap rounded-lg font-semibold transition-colors duration-150 ${
                small ? "kad-caption h-7 px-2.5" : "kad-label h-8 px-4"
              } ${
                isActive
                  ? "bg-kad-surface text-kad-text-strong"
                  : "text-kad-text-muted hover:text-kad-text"
              }`}
              style={isActive ? { boxShadow: "var(--kad-shadow-1)" } : undefined}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
