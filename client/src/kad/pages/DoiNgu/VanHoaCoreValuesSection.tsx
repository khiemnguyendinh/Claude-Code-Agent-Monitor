/**
 * Giá trị cốt lõi — dedicated add/edit/delete chip UI (VanHoaTab.tsx). Same
 * data shape as before (core_values: string[]), just a real chip editor
 * instead of one newline-per-value textarea.
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { kadApi } from "../../api-client";
import type { OrgContextVersionRow } from "../../api-client";
import { useKadToast } from "../../components/Toast";
import { KadButton, KadInput } from "../../components/primitives";
import { fmtDate } from "./org-context-helpers";

export function VanHoaCoreValuesSection({
  current,
  pendingChange,
  onDraftCreated,
}: {
  current: OrgContextVersionRow;
  pendingChange: boolean;
  onDraftCreated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<string[]>(current.data.core_values);
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useKadToast();

  const startEdit = () => {
    setValues(current.data.core_values);
    setEditing(true);
  };

  const addValue = () => {
    const v = newValue.trim();
    if (!v || values.includes(v)) {
      setNewValue("");
      return;
    }
    setValues((prev) => [...prev, v]);
    setNewValue("");
  };

  const removeValue = (v: string) => setValues((prev) => prev.filter((x) => x !== v));

  const submit = () => {
    setSaving(true);
    kadApi.orgContext
      .createDraft({
        data: { ...current.data, core_values: values },
        change_summary: "Đề xuất sửa Giá trị cốt lõi",
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
  };

  return (
    <section id="section-gia-tri" className="scroll-mt-20">
      <div className="flex items-center justify-between mb-2">
        <h2 className="kad-title text-kad-text-strong">Giá trị cốt lõi</h2>
        {!editing && (
          <KadButton variant="ghost" size="row" onClick={startEdit}>
            Đề xuất sửa
          </KadButton>
        )}
      </div>

      {pendingChange && (
        <div className="kad-caption bg-[#fbf3e4] text-[#b97d10] rounded-lg px-3 py-1.5 mb-3">
          Có bản sửa đang chờ duyệt
        </div>
      )}

      {editing ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {values.map((v) => (
              <span
                key={v}
                className="kad-caption inline-flex items-center gap-1.5 rounded-full border border-kad-border bg-kad-surface-2 px-2.5 py-1 text-kad-text"
              >
                {v}
                <button
                  type="button"
                  onClick={() => removeValue(v)}
                  aria-label={`Xóa giá trị ${v}`}
                  className="text-kad-text-faint hover:text-kad-danger"
                >
                  <X className="w-3 h-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <KadInput
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Giá trị mới…"
              className="max-w-[220px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addValue();
                }
              }}
            />
            <KadButton variant="ghost" size="row" icon={Plus} onClick={addValue}>
              Thêm
            </KadButton>
          </div>
          <div className="flex items-center gap-2">
            <KadButton variant="primary" size="row" loading={saving} onClick={submit}>
              Gửi duyệt thay đổi
            </KadButton>
            <KadButton variant="ghost" size="row" onClick={() => setEditing(false)}>
              Hủy
            </KadButton>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {current.data.core_values.map((v) => (
            <div key={v} className="border border-kad-border rounded-lg p-3 text-center">
              <p className="kad-label text-kad-text-strong">{v}</p>
            </div>
          ))}
        </div>
      )}

      <p className="kad-caption text-kad-text-faint mt-2">
        v{current.version} · duyệt {fmtDate(current.approved_at)}
      </p>
    </section>
  );
}
