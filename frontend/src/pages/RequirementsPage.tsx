import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  requirementsApi, runsApi,
  type Requirement,
  type RequirementInput,
  type ReqType,
  type ReqStatus,
  REQ_TYPES,
  REQ_STATUSES,
  PRIORITY,
} from "../api/client";
import Modal from "../components/Modal";
import SelectCasesModal from "../components/SelectCasesModal";
import "./RequirementsPage.css";

// ── Metadata ────────────────────────────────────────────────────────────────

const TYPE_META: Record<ReqType, { label: string; color: string; bg: string; icon: string }> = {
  epic:        { label: "Epic",        color: "#c2410c", bg: "#ffedd5", icon: "E" },
  feature:     { label: "Feature",     color: "#1d4ed8", bg: "#dbeafe", icon: "F" },
  story:       { label: "Story",       color: "#15803d", bg: "#dcfce7", icon: "S" },
  requirement: { label: "Requirement", color: "#6d28d9", bg: "#ede9fe", icon: "R" },
};

const STATUS_META: Record<ReqStatus, { label: string; color: string; bg: string }> = {
  new:         { label: "New",         color: "#374151", bg: "#f3f4f6" },
  in_progress: { label: "In Progress", color: "#1d4ed8", bg: "#dbeafe" },
  completed:   { label: "Completed",   color: "#15803d", bg: "#dcfce7" },
  reviewed:    { label: "Reviewed",    color: "#0e7490", bg: "#cffafe" },
  deprecated:  { label: "Deprecated",  color: "#9ca3af", bg: "#f9fafb" },
};

// ── Tree helpers ─────────────────────────────────────────────────────────────

interface ReqNode extends Requirement {
  children: ReqNode[];
  depth: number;
}

function buildTree(items: Requirement[]): ReqNode[] {
  const map = new Map<string, ReqNode>();
  for (const item of items) {
    map.set(item.id, { ...item, children: [], depth: 0 });
  }
  const roots: ReqNode[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  function setDepth(nodes: ReqNode[], d: number) {
    for (const n of nodes) {
      n.depth = d;
      setDepth(n.children, d + 1);
    }
  }
  setDepth(roots, 0);
  return roots;
}

function flattenTree(nodes: ReqNode[], collapsed: Set<string>): ReqNode[] {
  const result: ReqNode[] = [];
  for (const n of nodes) {
    result.push(n);
    if (!collapsed.has(n.id) && n.children.length > 0) {
      result.push(...flattenTree(n.children, collapsed));
    }
  }
  return result;
}

// ── Empty form ────────────────────────────────────────────────────────────────

const emptyForm = (): RequirementInput & { project_id: string } => ({
  title: "",
  project_id: "",
  description: "",
  req_type: "requirement",
  parent_id: null,
  status: "new",
  priority: "medium",
  external_id: "",
  external_url: "",
  source: "manual",
});

// ── Component ─────────────────────────────────────────────────────────────────

function fmtRunDate() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy}_${hh}:${min}:${ss}`;
}

async function collectAllCaseIds(nodeId: string, allItems: Requirement[]): Promise<string[]> {
  const direct = await requirementsApi.getTestCases(nodeId).catch(() => []);
  const children = allItems.filter((i) => i.parent_id === nodeId);
  const childIds = await Promise.all(children.map((c) => collectAllCaseIds(c.id, allItems)));
  return [...new Set([...direct.map((c) => c.id), ...childIds.flat()])];
}

export default function RequirementsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // form modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  // view drawer
  const [viewing, setViewing] = useState<Requirement | null>(null);

  // link cases modal
  const [linkTarget, setLinkTarget] = useState<Requirement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkedCaseIds, setLinkedCaseIds] = useState<string[]>([]);

  // quick run modal
  const [runModalReq, setRunModalReq] = useState<Requirement | null>(null);
  const [runName, setRunName] = useState("");
  const [runCreating, setRunCreating] = useState(false);

  const reload = () => {
    if (!projectId) return;
    setLoading(true);
    requirementsApi
      .list(projectId)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [projectId]);

  const tree = useMemo(() => buildTree(items), [items]);
  const flat = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  // ── Form helpers ──────────────────────────────────────────────────────────

  const openCreate = (parentId?: string, defaultType?: ReqType) => {
    const f = emptyForm();
    f.project_id = projectId!;
    if (parentId) f.parent_id = parentId;
    if (defaultType) f.req_type = defaultType;
    setEditing(null);
    setForm(f);
    setFormOpen(true);
  };

  const openEdit = (req: Requirement) => {
    setEditing(req);
    setForm({
      title: req.title,
      project_id: projectId!,
      description: req.description ?? "",
      req_type: req.req_type ?? "requirement",
      parent_id: req.parent_id ?? null,
      status: req.status ?? "new",
      priority: req.priority ?? "medium",
      external_id: req.external_id ?? "",
      external_url: req.external_url ?? "",
      source: req.source ?? "manual",
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        project_id: projectId!,
        description: form.description || null,
        external_id: form.external_id || null,
        external_url: form.external_url || null,
      };
      if (editing) {
        await requirementsApi.update(editing.id, payload);
      } else {
        await requirementsApi.create(payload);
      }
      setFormOpen(false);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (req: Requirement) => {
    if (!confirm(`Удалить «${req.title}»?`)) return;
    await requirementsApi.delete(req.id);
    reload();
  };

  // ── Link cases ────────────────────────────────────────────────────────────

  const openLink = async (req: Requirement) => {
    setLinkTarget(req);
    const cases = await requirementsApi.getTestCases(req.id).catch(() => []);
    setLinkedCaseIds(cases.map((c) => c.id));
    setLinkOpen(true);
  };

  const saveLink = async (ids: string[]) => {
    if (!linkTarget) return;
    await requirementsApi.setTestCases(linkTarget.id, ids);
    setLinkOpen(false);
    reload();
  };

  // ── Quick Run ─────────────────────────────────────────────────────────────

  const openRunModal = (req: Requirement) => {
    setRunModalReq(req);
    setRunName(`Quick Test Run - ${req.title} - ${fmtRunDate()}`);
  };

  const createRun = async (andGo: boolean) => {
    if (!runModalReq || !projectId) return;
    setRunCreating(true);
    try {
      const caseIds = await collectAllCaseIds(runModalReq.id, items);
      const run = await runsApi.create({
        project_id: projectId,
        name: runName,
        test_case_ids: caseIds.length > 0 ? caseIds : undefined,
      });
      setRunModalReq(null);
      if (andGo) navigate(`/project/${projectId}/run/${run.id}`);
      else navigate(`/project/${projectId}/runs`);
    } finally {
      setRunCreating(false);
    }
  };

  // ── Collapse ──────────────────────────────────────────────────────────────

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const collapseAll = () => setCollapsed(new Set(items.filter((i) => items.some((c) => c.parent_id === i.id)).map((i) => i.id)));
  const expandAll = () => setCollapsed(new Set());

  // ── Child type helper ─────────────────────────────────────────────────────

  const childType = (parentType: ReqType | null | undefined): ReqType => {
    if (!parentType || parentType === "requirement") return "requirement";
    const order: ReqType[] = ["epic", "feature", "story", "requirement"];
    const idx = order.indexOf(parentType);
    return order[Math.min(idx + 1, 3)];
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="req-page">
      {/* Header */}
      <div className="req-header">
        <h1 className="req-title">Requirements</h1>
        <div className="req-header-actions">
          {flat.length > 0 && (
            <>
              <button className="btn btn-secondary" onClick={collapseAll} title="Свернуть все">
                ⇑ Collapse All
              </button>
              <button className="btn btn-secondary" onClick={expandAll} title="Развернуть все">
                ⇓ Expand All
              </button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => openCreate()}>
            + Add requirement
          </button>
        </div>
      </div>

      {error && <div className="req-banner">⚠ {error}</div>}

      {loading ? (
        <div className="req-empty">Загружаем…</div>
      ) : flat.length === 0 ? (
        <div className="req-empty">
          <div className="req-empty-icon">📑</div>
          <p>Нет требований. Создайте Epic или Requirement.</p>
        </div>
      ) : (
        <div className="req-tree">
          {/* Table head */}
          <div className="req-row req-row-head">
            <div className="req-col req-col-title">Title</div>
            <div className="req-col req-col-type">Type</div>
            <div className="req-col req-col-status">Status</div>
            <div className="req-col req-col-priority">Priority</div>
            <div className="req-col req-col-cases">Cases</div>
            <div className="req-col req-col-jira">Jira</div>
            <div className="req-col req-col-actions"></div>
          </div>

          {flat.map((node) => {
            const tm = TYPE_META[node.req_type as ReqType] ?? TYPE_META.requirement;
            const sm = STATUS_META[node.status as ReqStatus] ?? STATUS_META.new;
            const hasChildren = node.children.length > 0;
            const isCollapsed = collapsed.has(node.id);

            return (
              <div
                key={node.id}
                className="req-row req-row-data"
                style={{ paddingLeft: `${16 + node.depth * 24}px` }}
                onClick={() => setViewing(node)}
              >
                {/* Expand toggle */}
                <span
                  className="req-expand"
                  onClick={(e) => { e.stopPropagation(); hasChildren && toggleCollapse(node.id); }}
                  style={{ visibility: hasChildren ? "visible" : "hidden" }}
                >
                  {isCollapsed ? "▶" : "▼"}
                </span>

                {/* Type badge */}
                <div className="req-col req-col-title">
                  <span
                    className="req-type-badge"
                    style={{ background: tm.bg, color: tm.color }}
                  >
                    {tm.icon}
                  </span>
                  <span className="req-node-title">{node.title}</span>
                  {node.display_seq && (
                    <span className="req-id-chip">REQ-{node.display_seq}</span>
                  )}
                </div>

                <div className="req-col req-col-type">
                  <span className="req-label" style={{ color: tm.color }}>{tm.label}</span>
                </div>

                <div className="req-col req-col-status">
                  <span
                    className="req-status-badge"
                    style={{ background: sm.bg, color: sm.color }}
                  >
                    {sm.label}
                  </span>
                </div>

                <div className="req-col req-col-priority">
                  <span className={`req-priority req-priority-${node.priority ?? "medium"}`}>
                    {node.priority ?? "medium"}
                  </span>
                </div>

                <div className="req-col req-col-cases">
                  <button
                    className="req-cases-btn"
                    onClick={() => openLink(node)}
                    title="Link test cases"
                  >
                    🔗 {node.case_count}
                  </button>
                </div>

                <div className="req-col req-col-jira">
                  {node.external_url ? (
                    <a
                      href={node.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="req-jira-link"
                      title={node.external_id || node.external_url}
                    >
                      {node.external_id || "Jira"}
                    </a>
                  ) : node.external_id ? (
                    <span className="req-jira-id">{node.external_id}</span>
                  ) : (
                    <span className="req-empty-cell">—</span>
                  )}
                </div>

                <div className="req-col req-col-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="req-action-btn req-action-run"
                    title="Запустить тестовый прогон"
                    onClick={() => openRunModal(node)}
                  >
                    ▶
                  </button>
                  <button
                    className="req-action-btn"
                    title="Add child"
                    onClick={() => openCreate(node.id, childType(node.req_type as ReqType))}
                  >
                    +
                  </button>
                  <button
                    className="req-action-btn"
                    title="Edit"
                    onClick={() => openEdit(node)}
                  >
                    ✎
                  </button>
                  <button
                    className="req-action-btn req-action-del"
                    title="Delete"
                    onClick={() => remove(node)}
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={formOpen}
        title={editing ? "Edit Requirement" : "Create Requirement"}
        onClose={() => setFormOpen(false)}
      >
        <div className="req-form">
          <label className="req-form-label">
            Title *
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Requirement title"
              autoFocus
            />
          </label>

          <div className="req-form-row">
            <label className="req-form-label">
              Type
              <select
                className="input"
                value={form.req_type ?? "requirement"}
                onChange={(e) => setForm({ ...form, req_type: e.target.value as ReqType })}
              >
                {REQ_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_META[t].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="req-form-label">
              Status
              <select
                className="input"
                value={form.status ?? "new"}
                onChange={(e) => setForm({ ...form, status: e.target.value as ReqStatus })}
              >
                {REQ_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="req-form-label">
              Priority
              <select
                className="input"
                value={form.priority ?? "medium"}
                onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
              >
                {PRIORITY.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="req-form-label">
            Parent
            <select
              className="input"
              value={form.parent_id ?? ""}
              onChange={(e) => setForm({ ...form, parent_id: e.target.value || null })}
            >
              <option value="">— No parent —</option>
              {items
                .filter((r) => !editing || r.id !== editing.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    [{TYPE_META[r.req_type as ReqType]?.icon ?? "R"}] {r.title}
                  </option>
                ))}
            </select>
          </label>

          <label className="req-form-label">
            Description
            <textarea
              className="input"
              rows={3}
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description"
            />
          </label>

          <div className="req-form-row">
            <label className="req-form-label">
              Jira ID
              <input
                className="input"
                value={form.external_id ?? ""}
                onChange={(e) => setForm({ ...form, external_id: e.target.value })}
                placeholder="PROJ-123"
              />
            </label>

            <label className="req-form-label" style={{ flex: 2 }}>
              Jira URL
              <input
                className="input"
                value={form.external_url ?? ""}
                onChange={(e) => setForm({ ...form, external_url: e.target.value })}
                placeholder="https://jira.company.com/browse/PROJ-123"
              />
            </label>
          </div>

          <div className="req-form-footer">
            <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={saveForm}
              disabled={!form.title.trim() || saving}
            >
              {saving ? "Saving…" : editing ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Link Test Cases Modal */}
      <SelectCasesModal
        open={linkOpen}
        projectId={projectId!}
        preSelectedIds={linkedCaseIds}
        onClose={() => setLinkOpen(false)}
        onDone={saveLink}
      />

      {/* Quick Run Modal */}
      <Modal
        open={!!runModalReq}
        title={`Запустить прогон по «${runModalReq?.title ?? ""}»`}
        onClose={() => setRunModalReq(null)}
      >
        <div className="req-form">
          <label className="req-form-label">
            Название прогона
            <input
              className="input"
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
            />
          </label>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 12px" }}>
            В прогон войдут все тест-кейсы этого требования и всех его дочерних требований.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={() => setRunModalReq(null)}>
              Отмена
            </button>
            <button
              className="btn btn-secondary"
              disabled={!runName.trim() || runCreating}
              onClick={() => createRun(false)}
              title="Создать прогон — перейти к списку прогонов"
            >
              {runCreating ? "Создаём…" : "⏸ Создать и запустить позже"}
            </button>
            <button
              className="btn btn-primary"
              disabled={!runName.trim() || runCreating}
              onClick={() => createRun(true)}
              title="Создать прогон и сразу перейти к выполнению"
            >
              {runCreating ? "Создаём…" : "▶ Создать и перейти к выполнению"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Requirement view drawer */}
      {viewing && (
        <ReqViewDrawer
          req={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { openEdit(viewing); setViewing(null); }}
        />
      )}
    </div>
  );
}

// ── Requirement view drawer ──────────────────────────────────────────────────

function ReqViewDrawer({ req, onClose, onEdit }: { req: Requirement; onClose: () => void; onEdit: () => void; }) {
  const tm = TYPE_META[req.req_type as ReqType] ?? TYPE_META.requirement;
  const sm = STATUS_META[req.status as ReqStatus] ?? STATUS_META.new;

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="req-view-overlay" onClick={onClose}>
      <div className="req-view-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="req-view-head">
          <div className="req-view-head-left">
            {req.display_seq && <span className="req-id-chip" style={{ marginRight: 6 }}>REQ-{req.display_seq}</span>}
            <span className="req-type-badge" style={{ background: tm.bg, color: tm.color }}>{tm.icon}</span>
            <span className="req-view-type-label" style={{ color: tm.color }}>{tm.label}</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="req-action-btn" title="Edit" onClick={onEdit}>✎ Edit</button>
            <button className="req-action-btn" onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        <div className="req-view-body">
          <h2 className="req-view-title">{req.title}</h2>

          <div className="req-view-meta">
            <div className="req-view-meta-item">
              <span className="req-view-meta-lbl">Status</span>
              <span className="req-status-badge" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>
            </div>
            <div className="req-view-meta-item">
              <span className="req-view-meta-lbl">Priority</span>
              <span className={`req-priority req-priority-${req.priority ?? "medium"}`}>{req.priority ?? "medium"}</span>
            </div>
            <div className="req-view-meta-item">
              <span className="req-view-meta-lbl">Test Cases</span>
              <span className="req-cases-count">{req.case_count}</span>
            </div>
          </div>

          {req.description && (
            <div className="req-view-section">
              <div className="req-view-section-lbl">Description</div>
              <p className="req-view-section-text">{req.description}</p>
            </div>
          )}

          {(req.external_id || req.external_url) && (
            <div className="req-view-section">
              <div className="req-view-section-lbl">Jira</div>
              {req.external_url ? (
                <a href={req.external_url} target="_blank" rel="noopener noreferrer" className="req-jira-link">
                  {req.external_id ?? req.external_url}
                </a>
              ) : <span className="req-jira-id">{req.external_id}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
