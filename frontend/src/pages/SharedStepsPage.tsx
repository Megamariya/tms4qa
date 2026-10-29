import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { sharedStepsApi, type SharedStep, type SharedStepFolder, type Step } from "../api/client";
import { useToast } from "../components/Toast";
import "./SharedStepsPage.css";

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SharedStepsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId!;
  const toast = useToast();

  const [steps, setSteps] = useState<SharedStep[]>([]);
  const [folders, setFolders] = useState<SharedStepFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [stepModalOpen, setStepModalOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<SharedStep | null>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, f] = await Promise.all([sharedStepsApi.list(pid), sharedStepsApi.listFolders(pid)]);
      setSteps(s);
      setFolders(f);
    } catch {
      toast.error("Ошибка загрузки shared steps");
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { reload(); }, [reload]);

  const displaySteps = useMemo(() => {
    let result = activeFolderId === null ? steps : steps.filter((s) => s.folder_id === activeFolderId);
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter((s) =>
        s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false)
      );
    }
    return result;
  }, [steps, activeFolderId, searchText]);

  const handleSaveStep = async (data: {
    name: string; description?: string | null; steps: Step[]; folder_id: string | null;
  }) => {
    try {
      if (editingStep) {
        await sharedStepsApi.update(editingStep.id, data);
        toast.success("Shared step сохранён");
      } else {
        await sharedStepsApi.create({ project_id: pid, ...data });
        toast.success("Shared step создан");
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
    }
    setStepModalOpen(false);
    setEditingStep(null);
  };

  const handleDeleteStep = async (id: string) => {
    if (!confirm("Удалить shared step?")) return;
    try {
      await sharedStepsApi.delete(id);
      toast.success("Удалено");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleSaveFolder = async (name: string) => {
    try {
      await sharedStepsApi.createFolder({ project_id: pid, name });
      toast.success("Папка создана");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка создания папки");
    }
    setFolderModalOpen(false);
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Удалить папку? Шаги внутри станут без папки.")) return;
    try {
      await sharedStepsApi.deleteFolder(id);
      toast.success("Папка удалена");
      if (activeFolderId === id) setActiveFolderId(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const openNewStep = () => { setEditingStep(null); setStepModalOpen(true); };
  const openEditStep = (step: SharedStep) => { setEditingStep(step); setStepModalOpen(true); };

  return (
    <div className="ss-page">
      <div className="ss-header">
        <h1 className="ss-title">Shared steps</h1>
        <div className="ss-header-actions">
          <button className="btn btn-primary" onClick={openNewStep}>+ New shared step</button>
          <input
            className="input ss-search"
            placeholder="Search for shared steps"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      <div className="ss-body">
        {/* Left: Folders */}
        <aside className="ss-left">
          <div className="ss-left-head">
            <span className="ss-left-title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              Folders
            </span>
            <button className="ss-new-folder-btn" onClick={() => setFolderModalOpen(true)}>+ New folder</button>
          </div>

          <div
            className={`ss-folder-item${activeFolderId === null ? " is-active" : ""}`}
            onClick={() => setActiveFolderId(null)}
          >
            <span className="ss-folder-icon">📁</span>
            <span className="ss-folder-name">All shared steps</span>
            <span className="ss-folder-count">{steps.length}</span>
          </div>

          {folders.map((f) => (
            <div
              key={f.id}
              className={`ss-folder-item${activeFolderId === f.id ? " is-active" : ""}`}
              onClick={() => setActiveFolderId(f.id)}
            >
              <span className="ss-folder-icon">📁</span>
              <span className="ss-folder-name">{f.name}</span>
              <span className="ss-folder-count">{steps.filter((s) => s.folder_id === f.id).length}</span>
              <button
                className="ss-folder-del"
                title="Delete folder"
                onClick={(e) => { e.stopPropagation(); handleDeleteFolder(f.id); }}
              >✕</button>
            </div>
          ))}
        </aside>

        <div className="ss-divider" />

        {/* Right: Steps */}
        <main className="ss-right">
          <div className="ss-right-head">
            <h2 className="ss-right-title">
              {activeFolderId === null
                ? "All shared steps"
                : (folders.find((f) => f.id === activeFolderId)?.name ?? "Folder")}
            </h2>
          </div>

          {loading ? (
            <div className="ss-empty"><p>Загружаем…</p></div>
          ) : displaySteps.length === 0 ? (
            <div className="ss-empty">
              <div className="ss-empty-icon">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6366f1", opacity: 0.6 }}>
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" fill="#e0e7ff"/>
                </svg>
              </div>
              <p className="ss-empty-text">Folder is empty</p>
              <button className="ss-empty-link" onClick={openNewStep}>+ New shared step</button>
            </div>
          ) : (
            <div className="ss-list">
              {displaySteps.map((step) => (
                <SharedStepCard
                  key={step.id}
                  step={step}
                  folders={folders}
                  onEdit={() => openEditStep(step)}
                  onDelete={() => handleDeleteStep(step.id)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {stepModalOpen && (
        <StepModal
          initial={editingStep}
          folders={folders}
          defaultFolderId={activeFolderId}
          onSave={handleSaveStep}
          onClose={() => { setStepModalOpen(false); setEditingStep(null); }}
        />
      )}

      {folderModalOpen && (
        <FolderModal
          onSave={handleSaveFolder}
          onClose={() => setFolderModalOpen(false)}
        />
      )}
    </div>
  );
}

// ── SharedStepCard ────────────────────────────────────────────────────────────

function SharedStepCard({ step, folders, onEdit, onDelete }: {
  step: SharedStep; folders: SharedStepFolder[];
  onEdit: () => void; onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const folder = step.folder_id ? folders.find((f) => f.id === step.folder_id) : null;

  return (
    <div className="ss-card">
      <div className="ss-card-header" onClick={() => setExpanded((v) => !v)}>
        <span className="ss-card-toggle">{expanded ? "▼" : "▶"}</span>
        <span className="ss-card-name">{step.name}</span>
        {folder && <span className="ss-card-folder">{folder.name}</span>}
        <span className="ss-card-count">{step.steps.length} step{step.steps.length !== 1 ? "s" : ""}</span>
        <div className="ss-card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="ss-card-btn" onClick={onEdit} title="Edit">✎</button>
          <button className="ss-card-btn ss-card-btn-del" onClick={onDelete} title="Delete">🗑</button>
        </div>
      </div>
      {expanded && step.description && (
        <div className="ss-card-desc">{step.description}</div>
      )}
      {expanded && step.steps.length > 0 && (
        <table className="ss-card-steps">
          <thead>
            <tr>
              <th>#</th>
              <th>Action</th>
              <th>Test Data</th>
              <th>Expected Result</th>
            </tr>
          </thead>
          <tbody>
            {step.steps.map((s, i) => (
              <tr key={i}>
                <td style={{ color: "var(--color-text-muted)", width: 28 }}>{i + 1}</td>
                <td>{s.action || "—"}</td>
                <td style={{ color: "var(--color-text-muted)" }}>{s.data || "—"}</td>
                <td style={{ color: "var(--color-text-muted)" }}>{s.expected || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {expanded && step.steps.length === 0 && (
        <div className="ss-card-desc" style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>No steps defined</div>
      )}
    </div>
  );
}

// ── StepModal ─────────────────────────────────────────────────────────────────

function StepModal({ initial, folders, defaultFolderId, onSave, onClose }: {
  initial: SharedStep | null;
  folders: SharedStepFolder[];
  defaultFolderId: string | null;
  onSave: (data: { name: string; description?: string | null; steps: Step[]; folder_id: string | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [folderId, setFolderId] = useState<string | null>(initial?.folder_id ?? defaultFolderId ?? null);
  const [steps, setSteps] = useState<Step[]>(initial?.steps ?? []);

  const addStep = () => setSteps((p) => [...p, { action: "", data: "", expected: "" }]);
  const updateStep = (i: number, field: keyof Step, value: string) =>
    setSteps((p) => { const n = [...p]; n[i] = { ...n[i], [field]: value }; return n; });
  const removeStep = (i: number) =>
    setSteps((p) => { const n = [...p]; n.splice(i, 1); return n; });

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), description: description.trim() || null, steps, folder_id: folderId });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 720, maxHeight: "88vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{initial ? "Edit shared step" : "New shared step"}</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14, overflow: "auto", flex: 1 }}>
          <div>
            <label className="form-label">Title *</label>
            <input className="input" style={{ width: "100%" }} placeholder="e.g. Login to the system"
              value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="form-label">Description</label>
            <textarea className="input" style={{ width: "100%", height: 56, resize: "vertical" }}
              placeholder="Optional description"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Folder</label>
            <select className="input" style={{ width: 240 }}
              value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value || null)}>
              <option value="">No folder</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label className="form-label" style={{ margin: 0 }}>Steps</label>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 10px" }} onClick={addStep}>+ Add step</button>
            </div>
            {steps.length === 0 && (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>No steps yet. Click "+ Add step".</p>
            )}
            {steps.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
                <thead>
                  <tr style={{ background: "var(--color-bg-soft)" }}>
                    <th style={{ padding: "6px 8px", textAlign: "left", width: 28, color: "var(--color-text-muted)", fontWeight: 600, fontSize: 11 }}>#</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--color-text-muted)", fontWeight: 600, fontSize: 11 }}>Action</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--color-text-muted)", fontWeight: 600, fontSize: 11, width: 170 }}>Test Data</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--color-text-muted)", fontWeight: 600, fontSize: 11, width: 170 }}>Expected</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((step, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "4px 8px", color: "var(--color-text-muted)" }}>{i + 1}</td>
                      <td style={{ padding: "3px 4px" }}>
                        <input className="input" style={{ width: "100%", fontSize: 12, padding: "4px 6px" }}
                          value={step.action} onChange={(e) => updateStep(i, "action", e.target.value)} placeholder="Action" />
                      </td>
                      <td style={{ padding: "3px 4px" }}>
                        <input className="input" style={{ width: "100%", fontSize: 12, padding: "4px 6px" }}
                          value={step.data ?? ""} onChange={(e) => updateStep(i, "data", e.target.value)} placeholder="Test data" />
                      </td>
                      <td style={{ padding: "3px 4px" }}>
                        <input className="input" style={{ width: "100%", fontSize: 12, padding: "4px 6px" }}
                          value={step.expected ?? ""} onChange={(e) => updateStep(i, "expected", e.target.value)} placeholder="Expected result" />
                      </td>
                      <td style={{ padding: "3px 6px" }}>
                        <button className="btn-icon" style={{ color: "var(--color-failed)" }} onClick={() => removeStep(i)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!name.trim()}>
            {initial ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── FolderModal ───────────────────────────────────────────────────────────────

function FolderModal({ onSave, onClose }: {
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">New folder</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <label className="form-label">Folder name *</label>
          <input className="input" style={{ width: "100%" }} placeholder="e.g. Authentication"
            value={name} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())} />
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}>Create</button>
        </div>
      </div>
    </div>
  );
}
