/**
 * Tab "Văn hóa & Nguyên tắc" — 04-man-doi-ngu.md §2. Living document, read
 * is primary; edits always go through a draft + approval, never a direct
 * save (§2: "mọi nút sửa đổi đều là 'Gửi duyệt', không có nút Lưu trực tiếp").
 *
 * "Chiến lược & Ưu tiên" đã tách sang tab "Mục tiêu" (2026-07-04) — không còn
 * hiển thị ở đây; tab này chỉ còn tri thức tổ chức sửa qua Gửi duyệt.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ORG_CONTEXT_SECTIONS } from "../../mockData";
import { useKadToast } from "../../components/Toast";
import { KadButton, KadTextarea } from "../../components/primitives";
import { MarkdownLite } from "../../components/MarkdownLite";
import type { OrgContextSection } from "../../types";

const CORE_VALUES = ["AI-First", "Asset-light (Ultra-lean)", "Thực chiến, đo lường được"];

// Scroll-spy: mục cột trái nào ứng với section đang lọt vào vùng đọc.
function useScrollSpy(keys: string[]): string | null {
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

export function VanHoaTab() {
  const [sections, setSections] = useState<OrgContextSection[]>(
    ORG_CONTEXT_SECTIONS.filter((s) => s.key !== "chien-luoc")
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const activeKey = useScrollSpy(sections.map((s) => s.key));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8">
      {/* Cột trái — card điều hướng, đồng bộ style với cột trái tab JD & Kỹ
          năng; mục đang xem được highlight qua scroll-spy. */}
      <nav className="hidden lg:block sticky top-20 self-start h-fit border border-kad-border rounded-xl overflow-hidden">
        {sections.map((s) => (
          <a
            key={s.key}
            href={`#section-${s.key}`}
            aria-current={activeKey === s.key ? "true" : undefined}
            className={`flex items-center h-11 px-3 border-b border-kad-border last:border-0 kad-label truncate transition-colors ${
              activeKey === s.key
                ? "bg-kad-surface-2 text-kad-text-strong"
                : "text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2/60"
            }`}
          >
            {s.title}
          </a>
        ))}
      </nav>

      <div className="max-w-[720px] space-y-8">
        <p className="kad-caption text-kad-text-faint border-b border-kad-border pb-4">
          Nội dung trang này được nạp vào ngữ cảnh của mọi thành viên AI.
        </p>

        {sections.map((section) => (
          <SectionBlock
            key={section.key}
            section={section}
            isEditing={editingKey === section.key}
            onToggleEdit={() => setEditingKey(editingKey === section.key ? null : section.key)}
            onSubmitted={() => {
              setSections((prev) => prev.map((s) => (s.key === section.key ? { ...s, pendingChange: true } : s)));
              setEditingKey(null);
            }}
          >
            {section.key === "gia-tri" ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {CORE_VALUES.map((v) => (
                  <div key={v} className="border border-kad-border rounded-lg p-3 text-center">
                    <p className="kad-label text-kad-text-strong">{v}</p>
                  </div>
                ))}
              </div>
            ) : (
              <MarkdownLite content={section.bodyMarkdown} />
            )}
          </SectionBlock>
        ))}
      </div>
    </div>
  );
}

// StrategyBlock đã chuyển sang tab "Mục tiêu" (MucTieuTab.tsx).

function SectionBlock({
  section,
  isEditing,
  onToggleEdit,
  onSubmitted,
  children,
}: {
  section: OrgContextSection;
  isEditing: boolean;
  onToggleEdit: () => void;
  onSubmitted: () => void;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState(section.bodyMarkdown);
  const toast = useKadToast();

  return (
    <section id={`section-${section.key}`} className="scroll-mt-20">
      <div className="flex items-center justify-between mb-2">
        <h2 className="kad-title text-kad-text-strong">{section.title}</h2>
        <KadButton variant="ghost" size="row" onClick={onToggleEdit}>
          Đề xuất sửa
        </KadButton>
      </div>

      {section.pendingChange && (
        <div className="kad-caption bg-[#fbf3e4] text-[#b97d10] rounded-lg px-3 py-1.5 mb-3">
          Có bản sửa đang chờ duyệt
        </div>
      )}

      {isEditing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="kad-overline text-kad-text-faint mb-1.5">Bản hiện tại</p>
            <div className="border border-kad-border rounded-lg p-3">{children}</div>
          </div>
          <div>
            <p className="kad-overline text-kad-text-faint mb-1.5">Bản sửa</p>
            <KadTextarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[140px]" />
            <div className="flex items-center gap-2 mt-2">
              <KadButton
                variant="primary"
                size="row"
                onClick={() => {
                  toast({ message: "Đã gửi duyệt thay đổi.", tone: "success" });
                  onSubmitted();
                }}
              >
                Gửi duyệt thay đổi
              </KadButton>
              <KadButton variant="ghost" size="row" onClick={onToggleEdit}>
                Hủy
              </KadButton>
            </div>
          </div>
        </div>
      ) : (
        children
      )}

      <p className="kad-caption text-kad-text-faint mt-2">
        v{section.version} · duyệt {section.approvedAt}
      </p>
    </section>
  );
}
