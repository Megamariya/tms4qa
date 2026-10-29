import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import "./EnvironmentsPage.css";

type EnvType = "dev" | "test" | "preprod" | "prod" | "custom";

type Env = {
  id: string;
  name: string;
  type: EnvType;
  description?: string;
  url?: string;
};

const DEFAULT_ENVS: Env[] = [
  { id: "default-dev",     name: "DEV",     type: "dev",     description: "Development environment" },
  { id: "default-test",    name: "TEST",     type: "test",    description: "Testing environment" },
  { id: "default-preprod", name: "PREPROD",  type: "preprod", description: "Pre-production environment" },
  { id: "default-prod",    name: "PROD",     type: "prod",    description: "Production environment" },
];

const TYPE_META: Record<EnvType, { label: string; color: string; bg: string }> = {
  dev:     { label: "Dev",     color: "#1d4ed8", bg: "#dbeafe" },
  test:    { label: "Test",    color: "#92400e", bg: "#fef3c7" },
  preprod: { label: "Preprod", color: "#6d28d9", bg: "#ede9fe" },
  prod:    { label: "Prod",    color: "#15803d", bg: "#dcfce7" },
  custom:  { label: "Custom",  color: "#6b7280", bg: "#f3f4f6" },
};

const ENV_TYPES: EnvType[] = ["dev", "test", "preprod", "prod", "custom"];

function loadEnvs(pid: string): Env[] {
  try {
    const raw = localStorage.getItem(`envs_${pid}`);
    if (!raw) return DEFAULT_ENVS;
    return JSON.parse(raw);
  } catch { return DEFAULT_ENVS; }
}
function saveEnvs(pid: string, envs: Env[]) {
  localStorage.setItem(`envs_${pid}`, JSON.stringify(envs));
}

const emptyForm = (): Omit<Env, "id"> => ({ name: "", type: "dev", description: "", url: "" });

export default function EnvironmentsPage() {
  const { projectId } = useParams();
  const pid = projectId ?? "";

  const [envs, setEnvs] = useState<Env[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Env | null>(null);
  const [form, setForm] = useState<Omit<Env, "id">>(emptyForm());

  useEffect(() => {
    if (pid) setEnvs(loadEnvs(pid));
  }, [pid]);

  const persist = (next: Env[]) => { setEnvs(next); saveEnvs(pid, next); };

  const openNew = () => { setEditing(null); setForm(emptyForm()); setFormOpen(true); };
  const openEdit = (e: Env) => { setEditing(e); setForm({ name: e.name, type: e.type, description: e.description ?? "", url: e.url ?? "" }); setFormOpen(true); };
  const remove = (id: string) => {
    if (!confirm("Удалить среду?")) return;
    persist(envs.filter((e) => e.id !== id));
  };
  const save = () => {
    if (!form.name.trim()) return;
    if (editing) {
      persist(envs.map((e) => e.id === editing.id ? { ...editing, ...form } : e));
    } else {
      persist([...envs, { ...form, id: crypto.randomUUID() }]);
    }
    setFormOpen(false);
  };

  return (
    <div className="env-page">
      <div className="env-header">
        <div>
          <h1 className="env-title">Environments</h1>
          <p className="env-subtitle">Configure test environments for this project</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Environment</button>
      </div>

      {envs.length === 0 ? (
        <div className="env-empty">
          <div className="env-empty-icon">🌐</div>
          <p>Нет сред. Нажмите «+ Add Environment».</p>
        </div>
      ) : (
        <div className="env-grid">
          {envs.map((env) => {
            const meta = TYPE_META[env.type] ?? TYPE_META.custom;
            return (
              <div key={env.id} className="env-card">
                <div className="env-card-header">
                  <span className="env-type-badge" style={{ background: meta.bg, color: meta.color }}>
                    {meta.label}
                  </span>
                  <div className="env-card-actions">
                    <button className="btn-icon" title="Edit" onClick={() => openEdit(env)}>✎</button>
                    <button className="btn-icon" title="Delete" onClick={() => remove(env.id)}>🗑</button>
                  </div>
                </div>
                <div className="env-card-name">{env.name}</div>
                {env.description && <div className="env-card-desc">{env.description}</div>}
                {env.url && (
                  <a href={env.url} target="_blank" rel="noreferrer" className="env-card-url">
                    {env.url}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {formOpen && (
        <div className="modal-backdrop" onClick={() => setFormOpen(false)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editing ? "Edit Environment" : "Add Environment"}</h2>
              <button className="btn-icon" onClick={() => setFormOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="form-label">Name *</label>
                <input className="input" style={{ width: "100%" }} autoFocus placeholder="e.g. STAGING"
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Type</label>
                <select className="input" style={{ width: "100%" }}
                  value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EnvType })}>
                  {ENV_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Description</label>
                <input className="input" style={{ width: "100%" }} placeholder="Optional description"
                  value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Base URL</label>
                <input className="input" style={{ width: "100%" }} placeholder="https://..."
                  value={form.url ?? ""} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()}>
                {editing ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
