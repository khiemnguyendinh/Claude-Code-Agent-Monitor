import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { kadApi } from "../../api-client";
import type { OrgContextVersionRow } from "../../api-client";
import { useKadToast } from "../../components/Toast";
import { KadButton, KadErrorBlock, KadSkeleton, KadTextarea } from "../../components/primitives";
import { MarkdownLite } from "../../components/MarkdownLite";
import { XlsxImportButton } from "../../components/XlsxImportButton";
import type { OrgContextSection } from "../../types";
import { OrgContextWizard } from "./OrgContextWizard";
import { VanHoaStrategySection } from "./VanHoaStrategySection";
import { VanHoaCoreValuesSection } from "./VanHoaCoreValuesSection";
import { type SectionKey, useScrollSpy, nextData, toSections } from "./org-context-helpers";

export function VanHoaTab() {
  const [current, setCurrent] = useState<OrgContextVersionRow | null>(null);
  const [versions, setVersions] = useState<OrgContextVersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsWizard, setNeedsWizard] = useState(false);
  const [error, setError] = useState(false);

  const refresh = () => {
    setLoading(true);
    setError(false);
    Promise.all([kadApi.orgContext.current(), kadApi.orgContext.versions()])
      .then(([ctx, all]) => {
        setCurrent(ctx);
        setVersions(all);
        setNeedsWizard(false);
      })
      .catch(() => {
        setNeedsWizard(true);
        setCurrent(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const pendingDraft = versions.find((v) => v.status === "draft");
  const sections = useMemo(
    () => (current ? toSections(current, Boolean(pendingDraft)) : []),
    [current, pendingDraft]
  );
  const activeKey = useScrollSpy(sections.map((s) => s.key));
  const toast = useKadToast();

  if (loading) {
    return (
      <div className="max-w-[720px] space-y-3">
        <KadSkeleton className="h-4 w-2/3" />
        <KadSkeleton className="h-28 w-full" />
        <KadSkeleton className="h-28 w-full" />
      </div>
    );
  }

  if (needsWizard) return <OrgContextWizard onCompleted={refresh} />;
  if (error || !current) return <KadErrorBlock onRetry={refresh} />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8">
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
        <div className="flex items-center justify-between gap-3 border-b border-kad-border pb-4">
          <p className="kad-caption text-kad-text-faint">
            Nội dung trang này được nạp vào ngữ cảnh của mọi thành viên AI.
          </p>
          <div className="flex items-center gap-3 flex-shrink-0">
            <XlsxImportButton
              kind="van-hoa"
              onImport={(file) => kadApi.importXlsx.orgContext(file).then(() => refresh())}
            />
            {pendingDraft && (
              <KadButton
                variant="primary"
                size="row"
                onClick={() => {
                  kadApi.orgContext
                    .approve(pendingDraft.id)
                    .then(() => {
                      toast({ message: "Đã duyệt bản tri thức mới.", tone: "success" });
                      refresh();
                    })
                    .catch((e) =>
                      toast({
                        message: e instanceof Error ? e.message : "Không duyệt được.",
                        tone: "warning",
                      })
                    );
                }}
              >
                Duyệt bản nháp v{pendingDraft.version}
              </KadButton>
            )}
          </div>
        </div>

        {sections.map((section) => {
          if (section.key === "chien-luoc") {
            return (
              <VanHoaStrategySection
                key={section.key}
                current={current}
                pendingChange={section.pendingChange}
                onDraftCreated={refresh}
              />
            );
          }
          if (section.key === "gia-tri") {
            return (
              <VanHoaCoreValuesSection
                key={section.key}
                current={current}
                pendingChange={section.pendingChange}
                onDraftCreated={refresh}
              />
            );
          }
          return (
            <SectionBlock
              key={section.key}
              section={section}
              current={current}
              onDraftCreated={refresh}
            >
              <MarkdownLite content={section.bodyMarkdown} />
            </SectionBlock>
          );
        })}
      </div>
    </div>
  );
}

function SectionBlock({
  section,
  current,
  onDraftCreated,
  children,
}: {
  section: OrgContextSection;
  current: OrgContextVersionRow;
  onDraftCreated: () => void;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.bodyMarkdown);
  const [saving, setSaving] = useState(false);
  const toast = useKadToast();

  return (
    <section id={`section-${section.key}`} className="scroll-mt-20">
      <div className="flex items-center justify-between mb-2">
        <h2 className="kad-title text-kad-text-strong">{section.title}</h2>
        <KadButton variant="ghost" size="row" onClick={() => setEditing((v) => !v)}>
          Đề xuất sửa
        </KadButton>
      </div>

      {section.pendingChange && (
        <div className="kad-caption bg-[#fbf3e4] text-[#b97d10] rounded-lg px-3 py-1.5 mb-3">
          Có bản sửa đang chờ duyệt
        </div>
      )}

      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="kad-overline text-kad-text-faint mb-1.5">Bản hiện tại</p>
            <div className="border border-kad-border rounded-lg p-3">{children}</div>
          </div>
          <div>
            <p className="kad-overline text-kad-text-faint mb-1.5">Bản sửa</p>
            <KadTextarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[160px]"
            />
            <div className="flex items-center gap-2 mt-2">
              <KadButton
                variant="primary"
                size="row"
                loading={saving}
                onClick={() => {
                  setSaving(true);
                  // Safe: this generic block is only ever mounted for the 4 plain-text
                  // sections — "gia-tri" and "chien-luoc" render VanHoaCoreValuesSection /
                  // VanHoaStrategySection instead (see the sections.map branch above).
                  kadApi.orgContext
                    .createDraft({
                      data: nextData(
                        current.data,
                        section.key as Exclude<SectionKey, "gia-tri" | "chien-luoc">,
                        draft
                      ),
                      change_summary: `Đề xuất sửa ${section.title}`,
                    })
                    .then(() => {
                      toast({ message: "Đã tạo draft chờ duyệt.", tone: "success" });
                      setEditing(false);
                      onDraftCreated();
                    })
                    .catch((e) =>
                      toast({
                        message: e instanceof Error ? e.message : "Không tạo được draft.",
                        tone: "warning",
                      })
                    )
                    .finally(() => setSaving(false));
                }}
              >
                Gửi duyệt thay đổi
              </KadButton>
              <KadButton variant="ghost" size="row" onClick={() => setEditing(false)}>
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
