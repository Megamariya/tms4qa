import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { plansApi, releasesApi, type TestPlan, type PlanStatus, type Release, PLAN_STATUS } from "../api/client";
import TestPlanFormModal, { loadPlanTags } from "../components/TestPlanFormModal";
import TestRunFormModal from "../components/TestRunFormModal";
import { useToast } from "../components/Toast";
import TransferImportModal from "../components/TransferImportModal";
import { exportPlanBundle } from "../utils/transfer";
import "./TestPlansPage.css";

// ── Plan ID format ────────────────────────────────────────────────────────────

function toPlanId(display_id: string): string {
  return display_id.startsWith("R") ? "TP-" + display_id.slice(1) : display_id;
}

// ── Plan status (localStorage) ───────────────────────────────────────────────

function getPlanCustomStatus(planId: string): string {
  return localStorage.getItem(`planCustomStatus_${planId}`) ?? "active";
}

// ── Export helpers ────────────────────────────────────────────────────────────

function exportPDF(plans: TestPlan[], releaseMap: Map<string, Release | undefined>) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test Plans</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:10px;margin:15px}
    h2{font-size:14px;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:10px}
    th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}
    th{background:#f3f4f6;font-weight:600}
    @media print{@page{margin:10mm}}
  </style></head><body>
  <h2>Test Plans</h2>
  <p style="font-size:11px;color:#666">Exported: ${new Date().toLocaleString()}</p>
  <table><thead><tr>
    <th style="white-space:nowrap;min-width:60px">ID</th><th>Title</th><th>Status</th><th>Description</th><th>Release</th>
    <th>Cases</th><th>Runs</th><th>Start Date</th><th>End Date</th>
  </tr></thead><tbody>
  ${plans.map((p) => {
    const rel = releaseMap.get(p.id);
    return `<tr>
      <td style="white-space:nowrap">${toPlanId(p.display_id)}</td>
      <td>${p.name}</td>
      <td>${p.status}</td>
      <td>${p.description ?? ""}</td>
      <td>${rel ? `${rel.name} v${rel.version} (${rel.environment})` : "—"}</td>
      <td>${p.case_count}</td>
      <td>${p.run_count || 0}</td>
      <td>${p.start_date ?? "—"}</td>
      <td>${p.end_date ?? "—"}</td>
    </tr>`;
  }).join("")}
  </tbody></table>
  <script>window.onload=()=>{window.print();}</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function exportXLS(plans: TestPlan[], releaseMap: Map<string, Release | undefined>) {
  const rows = [
    ["ID", "Title", "Status", "Description", "Release", "Cases", "Runs", "Start Date", "End Date"],
    ...plans.map((p) => {
      const rel = releaseMap.get(p.id);
      return [
        toPlanId(p.display_id), p.name, p.status, p.description ?? "",
        rel ? `${rel.name} v${rel.version} (${rel.environment})` : "",
        p.case_count, p.run_count || 0, p.start_date ?? "", p.end_date ?? "",
      ];
    }),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `test_plans_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Status metadata ───────────────────────────────────────────────────────────

const STATUS_META: Record<PlanStatus, { label: string; color: string; bg: string }> = {
  active:   { label: "Active",   color: "#065f46", bg: "#d1fae5" },
  review:   { label: "Review",   color: "#713f12", bg: "#fef9c3" },
  archived: { label: "Archived", color: "#64748b", bg: "#f1f5f9" },
};

const ENV_META: Record<string, { label: string; color: string; bg: string }> = {
  dev:     { label: "DEV",     color: "#1d4ed8", bg: "#dbeafe" },
  test:    { label: "TEST",    color: "#92400e", bg: "#fef3c7" },
  preprod: { label: "PREPROD", color: "#6d28d9", bg: "#ede9fe" },
  prod:    { label: "PROD",    color: "#15803d", bg: "#dcfce7" },
};

// ── Main component ────────────────────────────────────────────────────────────

export default function TestPlansPage() {
  const { projectId } = useParams();
  const toast = useToast();
  const [plans, setPlans] = useState<TestPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TestPlan | null>(null);
  const [search, setSearch] = useState("");
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runModalPlanId, setRunModalPlanId] = useState<string>("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const navigate = useNavigate();

  // Bulk selection
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set());

  // Sort state
  type PlanSortCol = "id" | "created_at";
  const [planSort, setPlanSort] = useState<{ col: PlanSortCol; dir: "asc" | "desc" }>({ col: "id", dir: "asc" });

  const togglePlanSort = useCallback((col: PlanSortCol) => {
    setPlanSort((prev) => prev.col === col
      ? { col, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { col, dir: "asc" });
  }, []);

  const planSortIcon = (col: PlanSortCol) => {
    if (planSort.col !== col) return " ⇅";
    return planSort.dir === "asc" ? " ↑" : " ↓";
  };

  // Filter state
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterRelease, setFilterRelease] = useState("");
  const [filterHasRelease, setFilterHasRelease] = useState(false);
  const [filterTags, setFilterTags] = useState<string[]>([]);

  const reload = () => {
    if (!projectId) return;
    setLoading(true);
    plansApi.list(projectId).then(setPlans).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(reload, [projectId]);

  useEffect(() => {
    if (projectId) releasesApi.list(projectId).then(setReleases).catch(() => {});
  }, [projectId]);

  // Build a map: planId → release (using plan.release_id from API)
  const releaseMap = useMemo(() => {
    const m = new Map<string, Release | undefined>();
    for (const plan of plans) {
      m.set(plan.id, plan.release_id ? releases.find((r) => r.id === plan.release_id) : undefined);
    }
    return m;
  }, [plans, releases]);

  const allPlanTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of plans) loadPlanTags(p.id).forEach((t) => set.add(t));
    return Array.from(set).sort();
  }, [plans]);

  const filtered = useMemo(() => plans.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus.length > 0 && !filterStatus.includes(p.status)) return false;
    if (filterHasRelease && !p.release_id) return false;
    if (filterRelease && p.release_id !== filterRelease) return false;
    if (filterTags.length > 0) {
      const pTags = loadPlanTags(p.id);
      if (!filterTags.some((t) => pTags.includes(t))) return false;
    }
    return true;
  }), [plans, search, filterStatus, filterHasRelease, filterRelease, filterTags]);

  const activeFilters = filterStatus.length + (filterHasRelease ? 1 : 0) + (filterRelease ? 1 : 0) + filterTags.length;
  const clearFilters = () => { setFilterStatus([]); setFilterHasRelease(false); setFilterRelease(""); setFilterTags([]); };

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (planSort.col === "id") {
        const na = parseInt(a.display_id.replace(/\D/g, ""), 10) || 0;
        const nb = parseInt(b.display_id.replace(/\D/g, ""), 10) || 0;
        cmp = na - nb;
      } else {
        cmp = (a.created_at ?? "").localeCompare(b.created_at ?? "");
      }
      return planSort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, planSort]);

  const exportPlan = async (p: TestPlan) => {
    try { await exportPlanBundle(p.id, `${p.display_id}_${p.name}`); toast.success(`План ${toPlanId(p.display_id)} выгружен`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Export failed"); }
  };

  const remove = async (p: TestPlan) => {
    if (!confirm(`Удалить план «${p.name}»?`)) return;
    try { await plansApi.delete(p.id); toast.success(`План ${toPlanId(p.display_id)} удалён`); setSelectedPlanIds(new Set()); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Delete failed"); }
  };

  const bulkRemove = async () => {
    if (selectedPlanIds.size === 0) return;
    if (!confirm(`Удалить ${selectedPlanIds.size} тест-план(ов)?`)) return;
    const ids = Array.from(selectedPlanIds);
    let errors = 0;
    for (const id of ids) {
      try { await plansApi.delete(id); }
      catch { errors++; }
    }
    setSelectedPlanIds(new Set());
    if (errors > 0) toast.error(`${errors} ошибок при удалении`);
    else toast.success(`Удалено ${ids.length} тест-план(ов)`);
    reload();
  };

  return (
    <div className="tp-page">
      <div className="tp-sticky-top">
      {selectedPlanIds.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 24px", background: "var(--color-accent-soft)", borderBottom: "1px solid var(--color-accent)" }}>
          <span style={{ fontSize: 13, color: "var(--color-accent)", fontWeight: 600 }}>
            Выбрано: {selectedPlanIds.size}
          </span>
          <button className="btn" style={{ fontSize: 12, color: "#dc2626", borderColor: "#dc2626" }} onClick={bulkRemove}>
            🗑 Удалить выбранные
          </button>
          <button className="btn" style={{ fontSize: 12 }} onClick={() => setSelectedPlanIds(new Set())}>
            Снять выделение
          </button>
        </div>
      )}
      <div className="tp-toolbar">
        <h1 className="tp-heading">Test plans</h1>
        <div className="tp-toolbar-right">
          <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>Create plan</button>
          <input className="input tp-search" placeholder="Search for test plans"
            value={search} onChange={(e) => setSearch(e.target.value)} />

          {/* Filter */}
          <button
            className={`btn btn-secondary${activeFilters > 0 ? " tp-filter-active" : ""}`}
            onClick={() => setFilterOpen((v) => !v)}
          >
            Filter{activeFilters > 0 ? ` (${activeFilters})` : ""}
          </button>
          {activeFilters > 0 && (
            <button className="btn-link" style={{ fontSize: 12 }} onClick={clearFilters}>Clear</button>
          )}

          {/* Export */}
          <div className="tp-export-wrap" onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-secondary" onClick={() => setExportOpen((v) => !v)}>Export ▾</button>
            {exportOpen && (
              <div className="tp-export-menu">
                <button className="tp-export-item" onClick={() => { exportPDF(sorted, releaseMap); setExportOpen(false); }}>
                  🖨 Export PDF
                </button>
                <button className="tp-export-item" onClick={() => { exportXLS(sorted, releaseMap); setExportOpen(false); }}>
                  📊 Export CSV/Excel
                </button>
              </div>
            )}
          </div>
          <button className="btn btn-secondary" title="Импорт тест-плана из файла переноса TMS4QA" onClick={() => setImportOpen(true)}>
            ⬆ Import
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {filterOpen && (
        <div className="tp-filter-panel">
          <div className="tp-fp-group">
            <div className="tp-fp-label">Status</div>
            {(PLAN_STATUS as readonly string[]).map((s) => (
              <label key={s} className="tp-fp-item">
                <input type="checkbox" checked={filterStatus.includes(s)}
                  onChange={() => setFilterStatus((p) => p.includes(s) ? p.filter((v) => v !== s) : [...p, s])} />
                <span style={{ textTransform: "capitalize" }}>{s}</span>
              </label>
            ))}
          </div>
          <div className="tp-fp-group">
            <div className="tp-fp-label">Release</div>
            <label className="tp-fp-item" style={{ marginBottom: 6 }}>
              <input type="checkbox" checked={filterHasRelease}
                onChange={(e) => { setFilterHasRelease(e.target.checked); if (!e.target.checked) setFilterRelease(""); }} />
              <span>Has release</span>
            </label>
            {releases.length > 0 && (
              <select className="input" style={{ width: 180, fontSize: 12 }}
                value={filterRelease} onChange={(e) => setFilterRelease(e.target.value)}>
                <option value="">Any release</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} v{r.version} ({r.environment})</option>
                ))}
              </select>
            )}
          </div>
          {allPlanTags.length > 0 && (
            <div className="tp-fp-group">
              <div className="tp-fp-label">Tags</div>
              {allPlanTags.map((t) => (
                <label key={t} className="tp-fp-item">
                  <input type="checkbox" checked={filterTags.includes(t)}
                    onChange={() => setFilterTags((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      </div>{/* end tp-sticky-top */}

      <div className="tp-table-scroll">
      <div className="tp-table-wrap">
        <table className="tp-table">
          <thead>
            <tr className="tp-thead-row">
              <th className="tp-th" style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={sorted.length > 0 && sorted.every((p) => selectedPlanIds.has(p.id))}
                  onChange={(e) => setSelectedPlanIds(e.target.checked ? new Set(sorted.map((p) => p.id)) : new Set())}
                  title="Выбрать все"
                />
              </th>
              <th
                className="tp-th tp-th-id"
                style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                onClick={() => togglePlanSort("id")}
              >
                ID{planSortIcon("id")}
              </th>
              <th className="tp-th tp-th-title">Title</th>
              <th className="tp-th tp-th-status">Status</th>
              <th className="tp-th tp-th-desc">Description</th>
              <th className="tp-th tp-th-release">Release</th>
              <th className="tp-th tp-th-author">Author</th>
              <th className="tp-th tp-th-review">Review</th>
              <th className="tp-th tp-th-count">Cases</th>
              <th className="tp-th tp-th-dates">Start / End</th>
              <th className="tp-th tp-th-runs">Runs</th>
              <th
                className="tp-th tp-th-created"
                style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", width: 130 }}
                onClick={() => togglePlanSort("created_at")}
              >
                Created At{planSortIcon("created_at")}
              </th>
              <th className="tp-th tp-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className="tp-td-center">Загружаем…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={13} className="tp-td-center">Планов пока нет — нажми «Create plan».</td></tr>
            ) : (
              sorted.map((p) => {
                const sm = STATUS_META[p.status] ?? STATUS_META.active;
                const rel = releaseMap.get(p.id);
                const em = rel ? (ENV_META[rel.environment] ?? null) : null;
                return (
                  <tr key={p.id} className="tp-tr">
                    <td className="tp-td" style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={selectedPlanIds.has(p.id)}
                        onChange={(e) => {
                          setSelectedPlanIds((prev) => {
                            const next = new Set(prev);
                            e.target.checked ? next.add(p.id) : next.delete(p.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="tp-td tp-td-id">
                      <span className="tp-id-badge">{toPlanId(p.display_id)}</span>
                    </td>
                    <td className="tp-td tp-td-title">
                      <Link to={`/project/${projectId}/plan/${p.id}`} className="tp-plan-link">{p.name}</Link>
                    </td>
                    <td className="tp-td tp-td-status">
                      <span className={`tp-status-pill tp-status-${p.status}`}>
                        {sm.label}
                      </span>
                    </td>
                    <td className="tp-td tp-td-desc">
                      {p.description
                        ? <span className="tp-desc-text">{p.description.length > 70 ? p.description.slice(0, 70) + "…" : p.description}</span>
                        : <span className="tp-muted">—</span>}
                      {(() => { const t = loadPlanTags(p.id); return t.length > 0 ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 3 }}>
                          {t.map((tag) => (
                            <span key={tag} style={{ fontSize: 10, background: "var(--color-accent-soft)", color: "var(--color-accent)", borderRadius: 3, padding: "1px 5px" }}>{tag}</span>
                          ))}
                        </div>
                      ) : null; })()}
                    </td>
                    <td className="tp-td tp-td-release">
                      {rel ? (
                        <div className="tp-release-cell">
                          <span className="tp-rel-name">{rel.name}</span>
                          <span className="tp-rel-version">v{rel.version}</span>
                          {em && <span className="tp-rel-env" style={{ background: em.bg, color: em.color }}>{em.label}</span>}
                        </div>
                      ) : (
                        <ReleaseSelector releases={releases}
                          onSet={async (rid) => {
                            await plansApi.update(p.id, { release_id: rid });
                            setPlans((prev) => prev.map((x) => x.id === p.id ? { ...x, release_id: rid } : x));
                          }} />
                      )}
                    </td>
                    <td className="tp-td tp-td-author"><span className="tp-author">Demo User</span></td>
                    <td className="tp-td tp-td-review">
                      {getPlanCustomStatus(p.id) === "review"
                        ? <span className="tp-review-badge">In Review</span>
                        : <span className="tp-muted">—</span>}
                    </td>
                    <td className="tp-td tp-td-count">{p.case_count}</td>
                    <td className="tp-td tp-td-dates">
                      {p.start_date || p.end_date
                        ? <span className="tp-dates-text">{p.start_date ?? "?"} → {p.end_date ?? "?"}</span>
                        : <span className="tp-muted">—</span>}
                    </td>
                    <td className="tp-td tp-td-runs">{p.run_count || <span className="tp-muted">—</span>}</td>
                    <td className="tp-td tp-td-created">
                      <span style={{ fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                        {p.created_at
                          ? new Date(p.created_at).toLocaleDateString("ru-RU") + " " +
                            new Date(p.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </span>
                    </td>
                    <td className="tp-td tp-td-actions">
                      <button
                        className="btn-icon"
                        title="Create Run"
                        onClick={(e) => { e.stopPropagation(); setRunModalPlanId(p.id); setRunModalOpen(true); }}
                      >▶</button>
                      <button className="btn-icon" title="Edit" onClick={() => { setEditing(p); setFormOpen(true); }}>✎</button>
                      <button className="btn-icon" title="Экспорт для переноса в другую TMS4QA (JSON)" onClick={() => exportPlan(p)}>⬇</button>
                      <button className="btn-icon" title="Delete" onClick={() => remove(p)}>🗑</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      </div>{/* end tp-table-scroll */}

      {projectId && (
        <TestPlanFormModal
          open={formOpen}
          projectId={projectId}
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={(p) => {
            toast.success(editing ? `План ${toPlanId(p.display_id)} обновлён` : `Successfully added the new test plan.`);
            reload();
          }}
        />
      )}

      {projectId && (
        <TestRunFormModal
          open={runModalOpen}
          projectId={projectId}
          defaultPlanId={runModalPlanId}
          onClose={() => setRunModalOpen(false)}
          onSaved={() => { setRunModalOpen(false); toast.success("Прогон создан"); }}
        />
      )}

      {projectId && (
        <TransferImportModal
          open={importOpen}
          kind="test_plan"
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onImported={(id) => { setImportOpen(false); navigate(`/project/${projectId}/plan/${id}`); }}
        />
      )}
    </div>
  );
}

// ── Inline release selector ───────────────────────────────────────────────────

function ReleaseSelector({ releases, onSet }: {
  releases: Release[];
  onSet: (releaseId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  if (releases.length === 0) return <span className="tp-muted">—</span>;
  return (
    <div style={{ position: "relative" }}>
      <button className="tp-assign-rel-btn" onClick={() => setOpen((v) => !v)}>+ Link release</button>
      {open && (
        <div className="tp-rel-dropdown" onClick={(e) => e.stopPropagation()}>
          {releases.map((r) => (
            <button key={r.id} className="tp-rel-opt" onClick={() => { onSet(r.id); setOpen(false); }}>
              {r.name} <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>v{r.version} ({r.environment})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
