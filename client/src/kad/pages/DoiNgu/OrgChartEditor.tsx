/**
 * Org chart editor — tab Tổ chức. Form CRUD, tree auto-redraws from data (no
 * drag-drop graph lib). Add/delete need no new backend route: PUT
 * /api/kad/org-chart already does a full bulk replace (delete removed rows,
 * insert new ones — see server/lib/kad/repo/org-context.js replaceOrgChart),
 * so add/delete just mutate the local `nodes` array and "Lưu" persists it.
 */
import type { Dispatch, SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { OrgChartNodeRow } from "../../api-client";
import { KadButton, KadInput } from "../../components/primitives";
import { useKadToast } from "../../components/Toast";

let tempSeq = 0;
const newTempId = () => `node-new-${(tempSeq += 1)}`;

export function OrgChartEditor({
  nodes,
  onChange,
  onSave,
}: {
  nodes: OrgChartNodeRow[];
  onChange: Dispatch<SetStateAction<OrgChartNodeRow[]>>;
  onSave: () => void;
}) {
  const toast = useKadToast();

  // Functional updates throughout — two clicks (add/delete) landing in the
  // same tick must not silently drop one another via a stale `nodes` closure.
  const update = (id: string, patch: Partial<OrgChartNodeRow>) => {
    onChange((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  };

  const addNode = () => {
    onChange((prev) => [
      ...prev,
      {
        id: newTempId(),
        parent_id: null,
        name: "",
        node_type: "position",
        lead_name: null,
        mission: null,
        sort_order: prev.length,
      },
    ]);
  };

  const removeNode = (id: string) => {
    onChange((prev) => {
      if (prev.some((n) => n.parent_id === id)) {
        toast({ message: "Xóa node con trước.", tone: "warning" });
        return prev;
      }
      return prev.filter((n) => n.id !== id);
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="kad-heading text-kad-text-strong">Org chart editor</h3>
        <div className="flex items-center gap-2">
          <KadButton size="row" variant="ghost" icon={Plus} onClick={addNode}>
            Thêm node
          </KadButton>
          <KadButton size="row" variant="primary" onClick={onSave}>
            Lưu
          </KadButton>
        </div>
      </div>
      <div className="space-y-2">
        {nodes.map((node) => (
          <div
            key={node.id}
            className="grid grid-cols-1 sm:grid-cols-[1fr_150px_1fr_auto] gap-2 border border-kad-border rounded-lg p-3 items-center"
          >
            <KadInput
              value={node.name}
              placeholder="Tên node"
              onChange={(e) => update(node.id, { name: e.target.value })}
            />
            <select
              value={node.node_type}
              onChange={(e) =>
                update(node.id, { node_type: e.target.value as OrgChartNodeRow["node_type"] })
              }
              className="kad-body h-9 rounded-lg bg-kad-surface-2 px-3 text-kad-text"
            >
              <option value="company">company</option>
              <option value="department">department</option>
              <option value="position">position</option>
            </select>
            <KadInput
              value={node.parent_id ?? ""}
              placeholder="parent_id"
              onChange={(e) => update(node.id, { parent_id: e.target.value || null })}
            />
            <button
              type="button"
              onClick={() => removeNode(node.id)}
              aria-label="Xóa node"
              className="text-kad-text-faint hover:text-kad-danger transition-colors justify-self-end"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
