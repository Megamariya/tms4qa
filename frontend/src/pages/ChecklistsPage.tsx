import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { checklistsApi, type Checklist, type ChecklistItem } from "../api/client";
import { useToast } from "../components/Toast";

export default function ChecklistsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId!;
  const toast = useToast();

  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Checklist | null>(null);
  const [search, setSearch] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      setChecklists(await checklistsApi.list(pid));
    } catch {
      toast.error("Ошибка загрузки чек-листов");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [pid]);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (c: Checklist) => { setEditing(c); setFormOpen(true); };

  const handleSave = async (data: { title: string; items: ChecklistItem[] }) => {
    try {
      if (editing) {
        await checklistsApi.update(editing.id, data);
        toast.success("Чек-лист сохранён");
      } else {
        await checklistsApi.create({ project_id: pid, ...data });
        toast.success("Чек-лист создан");
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
    }
    setFormOpen(false);
    setEditing(null);
  };

  const handleDelete = async (c: Checklist) => {
    if (!confirm(`Удалить чек-лист «${c.title}»?`)) return;
    try {
      await checklistsApi.delete(c.id);
      toast.success("Удалено");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const displayed = search.trim()
    ? checklists.filter((c) => c.title.toLowerCase().includes(search.trim().toLowerCase()))
    : checklists;

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Check lists</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="input"
            placeholder="Search checklists"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
          />
          <button className="btn btn-primary" onClick={openNew}>+ New checklist</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-muted)" }}>Загружаем…</div>
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 24px", color: "var(--color-text-muted)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>☑️</div>
          <div style={{ fontSize: 14, marginBottom: 10 }}>
            {checklists.length === 0 ? "Чек-листов пока нет" : "Ничего не найдено"}
          </div>
          {checklists.length === 0 && (
            <button className="btn btn-primary" onClick={openNew}>+ New checklist</button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {displayed.map((c) => (
            <ChecklistCard key={c.id} checklist={c} onEdit={() => openEdit(c)} onDelete={() => handleDelete(c)} />
          ))}
        </div>
      )}

      {formOpen && (
        <ChecklistFormModal
          initial={editing}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ChecklistCard({ checklist, onEdit, onDelete }: {
  checklist: Checklist; onEdit: () => void; onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-bg)" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={{ fontSize: 12, color: "var(--color-text-muted)", width: 14 }}>{expanded ? "▼" : "▶"}</span>
        <span style={{ fontWeight: 600, flex: 1 }}>{checklist.title}</span>
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {checklist.items.length} item{checklist.items.length !== 1 ? "s" : ""}
        </span>
        <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn-icon" title="Edit" onClick={onEdit}>✎</button>
          <button className="btn-icon" title="Delete" style={{ color: "var(--color-failed)" }} onClick={onDelete}>🗑</button>
        </div>
      </div>
      {expanded && (
        checklist.items.length === 0 ? (
          <div style={{ padding: "0 14px 12px", fontSize: 13, color: "var(--color-text-muted)", fontStyle: "italic" }}>
            No items yet
          </div>
        ) : (
          <ul style={{ margin: 0, padding: "0 14px 12px 34px", fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
            {checklist.items.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function ChecklistFormModal({ initial, onSave, onClose }: {
  initial: Checklist | null;
  onSave: (data: { title: string; items: ChecklistItem[] }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [items, setItems] = useState<ChecklistItem[]>(initial?.items ?? []);

  const itemRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    if (focusIndex === null) return;
    itemRefs.current[focusIndex]?.focus();
    setFocusIndex(null);
  }, [focusIndex, items.length]);

  const addItem = () => {
    setItems((p) => [...p, { id: crypto.randomUUID(), text: "" }]);
    setFocusIndex(items.length);
  };
  const updateItem = (i: number, text: string) =>
    setItems((p) => { const n = [...p]; n[i] = { ...n[i], text }; return n; });
  const removeItem = (i: number) =>
    setItems((p) => { const n = [...p]; n.splice(i, 1); return n; });

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({ title: title.trim(), items: items.filter((it) => it.text.trim()) });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 560, maxHeight: "88vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{initial ? "Edit checklist" : "New checklist"}</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14, overflow: "auto", flex: 1 }}>
          <div>
            <label className="form-label">Title *</label>
            <input className="input" style={{ width: "100%" }} placeholder="e.g. Pre-release smoke check"
              value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label className="form-label" style={{ margin: 0 }}>Items</label>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 10px" }} onClick={addItem}>+ Add item</button>
            </div>
            {items.length === 0 && (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>No items yet. Click "+ Add item".</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((item, i) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 18, fontSize: 12, color: "var(--color-text-muted)", textAlign: "right" }}>{i + 1}</span>
                  <input
                    ref={(el) => { itemRefs.current[i] = el; }}
                    className="input"
                    style={{ flex: 1, fontSize: 13 }}
                    placeholder="Checklist item"
                    value={item.text}
                    onChange={(e) => updateItem(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
                  />
                  <button className="btn-icon" style={{ color: "var(--color-failed)" }} onClick={() => removeItem(i)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!title.trim()}>
            {initial ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
