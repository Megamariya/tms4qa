import { Fragment, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { requirementsApi, casesApi, runsApi, releasesApi, type Requirement, type TestCase, type TestResult, type Release, getStepExpectedResults } from "../api/client";
import TestRunFormModal from "../components/TestRunFormModal";
import { useToast } from "../components/Toast";
import "./ReleasesPage.css";

// ── Types ─────────────────────────────────────────────────────────────────────

type Environment = "dev" | "test" | "preprod" | "prod";
type ReleaseStatus = "planned" | "in_progress" | "released" | "archived";

// ── Metadata ──────────────────────────────────────────────────────────────────

const ENV_META: Record<string, { label: string; color: string; bg: string }> = {
  dev:     { label: "DEV",     color: "#1d4ed8", bg: "#dbeafe" },
  test:    { label: "TEST",    color: "#92400e", bg: "#fef3c7" },
  preprod: { label: "PREPROD", color: "#6d28d9", bg: "#ede9fe" },
  prod:    { label: "PROD",    color: "#15803d", bg: "#dcfce7" },
};
const STATUS_META: Record<ReleaseStatus, { label: string; color: string; bg: string }> = {
  planned:     { label: "Planned",     color: "#6b7280", bg: "#f3f4f6" },
  in_progress: { label: "In Progress", color: "#1d4ed8", bg: "#dbeafe" },
  released:    { label: "Released",    color: "#15803d", bg: "#dcfce7" },
  archived:    { label: "Archived",    color: "#9ca3af", bg: "#f9fafb" },
};
const ENVIRONMENTS: Environment[] = ["dev", "test", "preprod", "prod"];
const STATUSES: ReleaseStatus[] = ["planned", "in_progress", "released", "archived"];
const REQ_TYPE_ICON: Record<string, string> = {
  epic: "E", feature: "F", story: "S", requirement: "R", release_note: "N",
};
function reqTypeIcon(t?: string | null): string {
  return REQ_TYPE_ICON[t ?? ""] ?? (t?.[0]?.toUpperCase() ?? "R");
}

type ReleaseForm = {
  name: string; version: string; environment: string; status: string;
  description: string; release_date: string; requirement_ids: string[];
};

const emptyForm = (): ReleaseForm => ({
  name: "", version: "", environment: "dev", status: "planned",
  description: "", release_date: "", requirement_ids: [],
});

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReleasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId!;
  const toast = useToast();

  const [releases, setReleases] = useState<Release[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [runModalRelease, setRunModalRelease] = useState<Release | null>(null);
  const [runModalCaseIds, setRunModalCaseIds] = useState<string[]>([]);
  const [runModalLoading, setRunModalLoading] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [reqCasesCache, setReqCasesCache] = useState<Map<string, TestCase[]>>(new Map());
  const [expandedReleases, setExpandedReleases] = useState<Set<string>>(new Set());
  const [envFilter, setEnvFilter] = useState<"all" | Environment>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ReleaseStatus>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Release | null>(null);
  const [form, setForm] = useState<ReleaseForm>(emptyForm());
  const backdropMouseDown = useRef(false);

  const reload = useCallback(() => {
    setLoadingReleases(true);
    releasesApi.list(pid)
      .then(setReleases)
      .catch(() => {})
      .finally(() => setLoadingReleases(false));
  }, [pid]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    requirementsApi.list(pid).then(setRequirements).catch(() => {});
  }, [pid]);

  const filtered = useMemo(() => releases.filter((r) => {
    if (envFilter !== "all" && r.environment !== envFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase()) &&
        !r.version.toLowerCase().includes(search.toLowerCase())) return false;
    if (dateFrom && r.release_date && r.release_date < dateFrom) return false;
    if (dateTo && r.release_date && r.release_date > dateTo) return false;
    return true;
  }), [releases, envFilter, statusFilter, search, dateFrom, dateTo]);

  const expandRelease = async (releaseId: string) => {
    const isOpen = expandedReleases.has(releaseId);
    setExpandedReleases((prev) => {
      const n = new Set(prev); isOpen ? n.delete(releaseId) : n.add(releaseId); return n;
    });
    if (isOpen) return;
    const release = releases.find((r) => r.id === releaseId);
    if (!release) return;
    for (const reqId of release.requirement_ids) {
      if (!reqCasesCache.has(reqId)) {
        requirementsApi.getTestCases(reqId)
          .then((linked) => setReqCasesCache((prev) => new Map([...prev, [reqId, linked]])))
          .catch(() => setReqCasesCache((prev) => new Map([...prev, [reqId, []]])));
      }
    }
  };

  const openNew = () => { setEditing(null); setForm(emptyForm()); setFormOpen(true); };
  const openEdit = (r: Release) => {
    setEditing(r);
    setForm({
      name: r.name, version: r.version, environment: r.environment ?? "dev",
      status: r.status, description: r.description ?? "",
      release_date: r.release_date ?? "", requirement_ids: r.requirement_ids,
    });
    setFormOpen(true);
  };
  const remove = async (id: string) => {
    if (!confirm("Удалить релиз?")) return;
    try {
      await releasesApi.delete(id);
      setReleases((prev) => prev.filter((r) => r.id !== id));
      toast.success("Релиз удалён");
    } catch { toast.error("Delete failed"); }
  };
  const save = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      if (editing) {
        const updated = await releasesApi.update(editing.id, {
          name: form.name, version: form.version, environment: form.environment,
          status: form.status, description: form.description || null,
          release_date: form.release_date || null, requirement_ids: form.requirement_ids,
        });
        setReleases((prev) => prev.map((r) => r.id === editing.id ? updated : r));
        toast.success("Релиз обновлён");
      } else {
        const created = await releasesApi.create({
          project_id: pid, name: form.name, version: form.version,
          environment: form.environment, status: form.status,
          description: form.description || null, release_date: form.release_date || null,
          requirement_ids: form.requirement_ids,
        });
        setReleases((prev) => [created, ...prev]);
        toast.success("Релиз создан");
      }
      setFormOpen(false);
    } catch { toast.error("Save failed"); }
    finally { setSaving(false); }
  };
  const toggleReq = (reqId: string) => {
    const ids = form.requirement_ids;
    setForm({ ...form, requirement_ids: ids.includes(reqId) ? ids.filter((i) => i !== reqId) : [...ids, reqId] });
  };
  const openRunModal = async (release: Release) => {
    setRunModalLoading(true);
    setRunModalRelease(release);
    try {
      const caseIdSets = await Promise.all(
        release.requirement_ids.map((rid) =>
          requirementsApi.getTestCases(rid)
            .then((cases) => cases.map((c) => c.id))
            .catch(() => [] as string[])
        )
      );
      const unique = Array.from(new Set(caseIdSets.flat()));
      setRunModalCaseIds(unique);
    } catch {
      setRunModalCaseIds([]);
    } finally {
      setRunModalLoading(false);
    }
  };

  const envCount = (env: Environment) => releases.filter((r) => r.environment === env).length;

  return (
    <div className="rel-page">
      <div className="rel-header">
        <div>
          <h1 className="rel-title">Releases</h1>
          <p className="rel-subtitle">Manage releases by environment</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Release</button>
      </div>

      {/* Toolbar */}
      <div className="rel-toolbar">
        <div className="rel-env-tabs">
          <button className={`rel-env-tab${envFilter === "all" ? " active" : ""}`} onClick={() => setEnvFilter("all")}>
            All <span className="rel-env-count">{releases.length}</span>
          </button>
          {ENVIRONMENTS.map((e) => (
            <button key={e} className={`rel-env-tab rel-env-${e}${envFilter === e ? " active" : ""}`} onClick={() => setEnvFilter(e)}>
              {ENV_META[e].label} <span className="rel-env-count">{envCount(e)}</span>
            </button>
          ))}
        </div>
        <div className="rel-toolbar-right">
          <select className="input" style={{ width: 130, fontSize: 12 }}
            value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <input className="input" type="date" style={{ width: 130, fontSize: 12 }}
            title="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>→</span>
          <input className="input" type="date" style={{ width: 130, fontSize: 12 }}
            title="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          {(dateFrom || dateTo) && (
            <button className="btn-link" style={{ fontSize: 12 }}
              onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear dates</button>
          )}
          <input className="input rel-search" placeholder="Search releases…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loadingReleases ? (
        <div className="rel-empty"><p>Загружаем…</p></div>
      ) : filtered.length === 0 ? (
        <div className="rel-empty">
          <div className="rel-empty-icon">🚀</div>
          <p>{releases.length === 0 ? "Нет релизов. Нажмите «+ New Release»." : "Нет релизов по фильтру."}</p>
        </div>
      ) : (
        <div className="rel-table-wrap">
          <table className="rel-table">
            <thead>
              <tr className="rel-thead">
                <th className="rel-th" style={{ width: 28 }}></th>
                <th className="rel-th">Name / Version</th>
                <th className="rel-th rel-th-env">Environment</th>
                <th className="rel-th rel-th-status">Status</th>
                <th className="rel-th rel-th-date">Release Date</th>
                <th className="rel-th rel-th-created">Created at</th>
                <th className="rel-th rel-th-reqs">Requirements</th>
                <th className="rel-th rel-th-desc">Description</th>
                <th className="rel-th rel-th-actions"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const em = ENV_META[r.environment ?? "dev"] ?? ENV_META["dev"];
                const sm = STATUS_META[r.status as ReleaseStatus] ?? STATUS_META["planned"];
                const linkedReqs = requirements.filter((req) => r.requirement_ids.includes(req.id));
                const isExpanded = expandedReleases.has(r.id);

                return (
                  <Fragment key={r.id}>
                    <tr className={`rel-tr${isExpanded ? " rel-tr-expanded" : ""}`}>
                      <td className="rel-td rel-td-toggle" onClick={() => expandRelease(r.id)}>
                        <span className="rel-expand-toggle">{isExpanded ? "▼" : "▶"}</span>
                      </td>
                      <td className="rel-td" onClick={() => expandRelease(r.id)} style={{ cursor: "pointer" }}>
                        <div className="rel-name">{r.name}</div>
                        {r.version && <div className="rel-version">v{r.version}</div>}
                      </td>
                      <td className="rel-td">
                        <span className={`rel-env-badge rel-env-${r.environment}`}>{em.label}</span>
                      </td>
                      <td className="rel-td">
                        <span className={`rel-status-badge rel-st-${r.status}`}>{sm.label}</span>
                      </td>
                      <td className="rel-td rel-td-muted">{r.release_date || "—"}</td>
                      <td className="rel-td rel-td-muted" style={{ fontSize: 12 }}>
                        {r.created_at ? new Date(r.created_at).toLocaleDateString("ru-RU") : "—"}
                      </td>
                      <td className="rel-td">
                        {linkedReqs.length > 0 ? (
                          <div className="rel-reqs-list">
                            {linkedReqs.slice(0, 3).map((req) => (
                              <span key={req.id} className="rel-req-chip" title={req.title}>
                                {req.title.length > 20 ? req.title.slice(0, 20) + "…" : req.title}
                              </span>
                            ))}
                            {linkedReqs.length > 3 && <span className="rel-req-more">+{linkedReqs.length - 3}</span>}
                          </div>
                        ) : <span className="rel-muted">—</span>}
                      </td>
                      <td className="rel-td rel-td-desc rel-td-muted">
                        {r.description ? (r.description.length > 60 ? r.description.slice(0, 60) + "…" : r.description) : "—"}
                      </td>
                      <td className="rel-td rel-td-actions">
                        <button className="btn-icon rel-run-btn" title="Запустить тестовый прогон" onClick={() => openRunModal(r)} disabled={runModalLoading}>
                          {runModalLoading && runModalRelease?.id === r.id ? "…" : "▶"}
                        </button>
                        <button className="btn-icon" title="Edit" onClick={() => openEdit(r)}>✎</button>
                        <button className="btn-icon" title="Delete" onClick={() => remove(r.id)}>🗑</button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="rel-expand-row">
                          <ExpandedReleaseContent
                            release={r}
                            requirements={requirements}
                            reqCasesCache={reqCasesCache}
                            projectId={pid}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Test run modal */}
      {runModalRelease && !runModalLoading && (
        <TestRunFormModal
          open={!!runModalRelease}
          projectId={pid}
          defaultName={`Quick run — ${runModalRelease.name} v${runModalRelease.version}`}
          defaultReleaseId={runModalRelease.id}
          defaultTestCaseIds={runModalCaseIds}
          onClose={() => { setRunModalRelease(null); setRunModalCaseIds([]); }}
          onSaved={(run) => {
            toast.success(`Прогон «${run.name}» создан`);
            setRunModalRelease(null); setRunModalCaseIds([]);
          }}
        />
      )}

      {/* Form modal */}
      {formOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
          onClick={() => { if (backdropMouseDown.current) setFormOpen(false); }}
        >
          <div
            className="modal"
            style={{ width: 620, maxHeight: "90vh", overflow: "auto" }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">{editing ? "Edit Release" : "New Release"}</h2>
              <button className="btn-icon" onClick={() => setFormOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 2 }}>
                  <label className="form-label">Name *</label>
                  <input className="input" style={{ width: "100%" }} placeholder="e.g. Sprint 12 Release"
                    value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Version</label>
                  <input className="input" style={{ width: "100%" }} placeholder="1.2.0"
                    value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Environment</label>
                  <select className="input" style={{ width: "100%" }}
                    value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value as Environment })}>
                    {ENVIRONMENTS.map((e) => <option key={e} value={e}>{ENV_META[e].label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Status</label>
                  <select className="input" style={{ width: "100%" }}
                    value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ReleaseStatus })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Release Date</label>
                  <input className="input" style={{ width: "100%" }} type="date"
                    value={form.release_date ?? ""} onChange={(e) => setForm({ ...form, release_date: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="form-label">Description</label>
                <textarea className="input" style={{ width: "100%", height: 60, resize: "vertical" }}
                  placeholder="Release notes, scope, goals…"
                  value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              {requirements.length > 0 && (
                <div>
                  <label className="form-label">Link Requirements ({form.requirement_ids.length} selected)</label>
                  <div className="rel-req-picker">
                    {requirements.map((req) => (
                      <label key={req.id} className="rel-req-pick-item">
                        <input type="checkbox" checked={form.requirement_ids.includes(req.id)} onChange={() => toggleReq(req.id)} />
                        <span className="rel-req-pick-type">{reqTypeIcon(req.req_type)}</span>
                        <span>{req.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.name.trim() || saving}>
                {saving ? "Сохраняем…" : editing ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Expanded release content ──────────────────────────────────────────────────

const TC_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  passed:      { bg: "#dcfce7", color: "#15803d" },
  failed:      { bg: "#fee2e2", color: "#dc2626" },
  blocked:     { bg: "#fef3c7", color: "#ca8a04" },
  untested:    { bg: "#f3f4f6", color: "#6b7280" },
  in_progress: { bg: "#dbeafe", color: "#1d4ed8" },
  skipped:     { bg: "#f9fafb", color: "#9ca3af" },
};

function ExpandedReleaseContent({ release, requirements, reqCasesCache, projectId }: {
  release: Release;
  requirements: Requirement[];
  reqCasesCache: Map<string, TestCase[]>;
  projectId: string;
}) {
  const toast = useToast();
  const [expandedReqs, setExpandedReqs] = useState<Set<string>>(new Set());
  const [expandedCases, setExpandedCases] = useState<Set<string>>(new Set());
  const [runData, setRunData] = useState<Map<string, { name: string; results: TestResult[] }>>(new Map());
  const [runsLoaded, setRunsLoaded] = useState(false);
  // Quick-run single case
  const [quickRunTc, setQuickRunTc] = useState<TestCase | null>(null);
  // View case modal — fetches full case (with steps) on open
  const [viewTc, setViewTc] = useState<TestCase | null>(null);
  const [viewTcLoading, setViewTcLoading] = useState(false);

  const openViewCase = useCallback(async (tc: TestCase) => {
    setViewTc(tc); // show immediately with basic data
    setViewTcLoading(true);
    try {
      const full = await casesApi.get(tc.id);
      setViewTc(full);
    } catch { /* keep basic version */ }
    finally { setViewTcLoading(false); }
  }, []);

  const linkedReqs = requirements.filter((req) => release.requirement_ids.includes(req.id));

  // Load all runs for this release upfront
  useEffect(() => {
    runsApi.list(projectId).then(async (allRuns) => {
      const relRuns = allRuns.filter((r) => r.release_id === release.id);
      const entries = await Promise.all(
        relRuns.map(async (run) => {
          const results = await runsApi.results(run.id).catch(() => [] as TestResult[]);
          return [run.id, { name: run.name, results }] as const;
        })
      );
      setRunData(new Map(entries));
      setRunsLoaded(true);
    }).catch(() => setRunsLoaded(true));
  }, [projectId, release.id]);

  const toggleReq = useCallback((id: string) => {
    setExpandedReqs((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const toggleCase = useCallback((id: string) => {
    setExpandedCases((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  if (linkedReqs.length === 0) {
    return (
      <div className="rel-exp-empty">
        No requirements linked to this release. Edit the release to link requirements.
      </div>
    );
  }

  return (
    <div className="rel-exp-wrap">
      <div className="rel-exp-header">
        Requirements & Test Cases <span className="rel-exp-count">({linkedReqs.length} requirements)</span>
        <span className="rel-exp-hint">— нажмите на требование, чтобы увидеть тест-кейсы</span>
      </div>
      <div className="rel-exp-list">
        {linkedReqs.map((req) => {
          const cases = reqCasesCache.get(req.id);
          const isOpen = expandedReqs.has(req.id);
          return (
            <div key={req.id} className={`rel-exp-req${isOpen ? " rel-exp-req-open" : ""}`}>
              <div className="rel-exp-req-head" onClick={() => toggleReq(req.id)}>
                <span className="rel-exp-req-toggle">{isOpen ? "▼" : "▶"}</span>
                <span className="rel-exp-req-type">{reqTypeIcon(req.req_type)}</span>
                <span className="rel-exp-req-title">{req.title}</span>
                {req.display_seq && <span className="rel-exp-req-id">REQ-{req.display_seq}</span>}
                <span className="rel-exp-cases-count">{cases ? `${cases.length} cases` : "…"}</span>
              </div>
              {isOpen && cases && cases.length > 0 && (
                <div className="rel-exp-cases">
                  {cases.map((tc) => {
                    const isCaseOpen = expandedCases.has(tc.id);
                    const hasSteps = tc.steps && tc.steps.length > 0;
                    // Gather run results for this test case
                    const tcRunResults: { runName: string; status: string; comment?: string | null; executedAt?: string | null }[] = [];
                    for (const [, rd] of runData) {
                      const res = rd.results.find((r) => r.test_case_id === tc.id);
                      if (res) tcRunResults.push({ runName: rd.name, status: res.status, comment: res.comment, executedAt: res.executed_at });
                    }
                    const hasRunData = tcRunResults.length > 0;
                    const canExpand = hasSteps || hasRunData;
                    const latestResult = tcRunResults[tcRunResults.length - 1];
                    const latestStatusMeta = latestResult ? (TC_STATUS_COLORS[latestResult.status] ?? TC_STATUS_COLORS.untested) : null;

                    return (
                      <div key={tc.id} className={`rel-exp-case-wrap${isCaseOpen ? " rel-exp-case-wrap-open" : ""}`}>
                        <div
                          className="rel-exp-case"
                          style={{ cursor: canExpand ? "pointer" : "default" }}
                          onClick={() => canExpand && toggleCase(tc.id)}
                        >
                          <span style={{ fontSize: 10, color: "var(--color-text-muted)", visibility: canExpand ? "visible" : "hidden" }}>
                            {isCaseOpen ? "▼" : "▶"}
                          </span>
                          <span className="rel-exp-case-icon">📋</span>
                          <span className="rel-exp-case-name">{tc.name}</span>
                          {latestStatusMeta && (
                            <span style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: latestStatusMeta.bg, color: latestStatusMeta.color, marginLeft: 4 }}>
                              {latestResult!.status.replace(/_/g, " ")}
                            </span>
                          )}
                          <span className={`rel-exp-case-status rel-case-${tc.status}`}>{tc.status}</span>
                          {/* Action buttons */}
                          <div className="rel-exp-case-btns" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="rel-tc-action-btn"
                              title="Просмотреть тест-кейс"
                              onClick={() => openViewCase(tc)}
                            >
                              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3C5 3 1 10 1 10s4 7 9 7 9-7 9-7-4-7-9-7zm0 12a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/></svg>
                            </button>
                            <button
                              className="rel-tc-action-btn rel-tc-action-run"
                              title="Запустить прогон по этому тест-кейсу"
                              onClick={() => setQuickRunTc(tc)}
                            >
                              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path d="M4 4l12 6-12 6V4z"/></svg>
                            </button>
                          </div>
                        </div>

                        {isCaseOpen && (
                          <div className="rel-exp-case-detail">
                            {/* Steps */}
                            {hasSteps && (
                              <div className="rel-exp-steps-section">
                                <div className="rel-exp-section-title">📋 Шаги</div>
                                {tc.steps.map((step, idx) => {
                                  const expected = getStepExpectedResults(step);
                                  return (
                                    <div key={idx} className="rel-exp-step">
                                      <div className="rel-exp-step-num">{idx + 1}</div>
                                      <div className="rel-exp-step-body">
                                        <div className="rel-exp-step-action">{step.action}</div>
                                        {step.data && <div className="rel-exp-step-data">Данные: {step.data}</div>}
                                        {expected.map((ex, j) => (
                                          <div key={j} className="rel-exp-step-expected">✓ {ex}</div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Run results */}
                            <div className="rel-exp-runs-section">
                              <div className="rel-exp-section-title">▶ Прогоны в релизе</div>
                              {!runsLoaded ? (
                                <div className="rel-exp-runs-empty">Загружаем…</div>
                              ) : tcRunResults.length === 0 ? (
                                <div className="rel-exp-runs-empty">Нет прогонов для этого тест-кейса в данном релизе</div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  {tcRunResults.map((rr, i) => {
                                    const m = TC_STATUS_COLORS[rr.status] ?? TC_STATUS_COLORS.untested;
                                    return (
                                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 5, background: "var(--color-bg)", border: "1px solid var(--color-border)", fontSize: 12 }}>
                                        <span style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: m.bg, color: m.color }}>
                                          {rr.status.replace(/_/g, " ")}
                                        </span>
                                        <span style={{ color: "var(--color-text)", fontWeight: 500 }}>{rr.runName}</span>
                                        {rr.executedAt && (
                                          <span style={{ color: "var(--color-text-muted)", fontSize: 10, marginLeft: "auto" }}>
                                            {new Date(rr.executedAt).toLocaleDateString("ru-RU")}
                                          </span>
                                        )}
                                        {rr.comment && (
                                          <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>💬 {rr.comment}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {isOpen && cases && cases.length === 0 && (
                <div className="rel-exp-no-cases">No test cases linked to this requirement</div>
              )}
              {isOpen && !cases && (
                <div className="rel-exp-no-cases">Loading test cases…</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Quick-run modal ── */}
      {quickRunTc && (
        <TestRunFormModal
          open={!!quickRunTc}
          projectId={projectId}
          defaultName={`Quick run — ${quickRunTc.name}`}
          defaultReleaseId={release.id}
          defaultTestCaseIds={[quickRunTc.id]}
          onClose={() => setQuickRunTc(null)}
          onSaved={(run) => {
            toast.success(`Прогон «${run.name}» создан`);
            setQuickRunTc(null);
          }}
        />
      )}

      {/* ── View case modal ── */}
      {viewTc && (
        <div className="modal-backdrop" onClick={() => setViewTc(null)}>
          <div className="modal rel-tc-view-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">📋 {viewTc.name}</h2>
              {viewTcLoading && <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: 8 }}>Загружаем…</span>}
              <button className="btn-icon" onClick={() => setViewTc(null)} style={{ marginLeft: "auto" }}>✕</button>
            </div>
            <div className="rel-tc-view-body">
              {viewTc.description && (
                <div className="rel-tc-view-section">
                  <div className="rel-tc-view-label">Description</div>
                  <div className="rel-tc-view-text">{viewTc.description}</div>
                </div>
              )}
              {viewTc.pre_conditions && (
                <div className="rel-tc-view-section">
                  <div className="rel-tc-view-label">Pre-conditions</div>
                  <div className="rel-tc-view-text" style={{ whiteSpace: "pre-wrap" }}>{viewTc.pre_conditions}</div>
                </div>
              )}
              {viewTc.steps && viewTc.steps.length > 0 && (
                <div className="rel-tc-view-section">
                  <div className="rel-tc-view-label">Steps ({viewTc.steps.length})</div>
                  <div className="rel-tc-steps-table">
                    <div className="rel-tc-step-head">
                      <span>#</span><span>Action</span><span>Expected result</span>
                    </div>
                    {viewTc.steps.map((step, i) => {
                      const expected = getStepExpectedResults(step);
                      return (
                        <div key={i} className="rel-tc-step-row">
                          <span className="rel-tc-step-num">{i + 1}</span>
                          <span className="rel-tc-step-action">
                            {step.action}
                            {step.data && <div style={{ color: "var(--color-text-muted)", fontSize: 11, marginTop: 2 }}>Data: {step.data}</div>}
                          </span>
                          <span className="rel-tc-step-expected">
                            {expected.map((ex, j) => <div key={j}>✓ {ex}</div>)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {!viewTc.steps?.length && !viewTc.description && (
                <div style={{ padding: "20px 0", textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
                  Тест-кейс не содержит шагов или описания.
                </div>
              )}
              {viewTc.post_conditions && (
                <div className="rel-tc-view-section">
                  <div className="rel-tc-view-label">Post-conditions</div>
                  <div className="rel-tc-view-text" style={{ whiteSpace: "pre-wrap" }}>{viewTc.post_conditions}</div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {[
                  { label: "Priority", value: viewTc.priority },
                  { label: "Severity", value: viewTc.severity },
                  { label: "Type", value: viewTc.type },
                  { label: "Layer", value: viewTc.layer },
                  { label: "Automation", value: viewTc.automation_status?.replace(/_/g, " ") },
                ].map(({ label, value }) => value && (
                  <span key={label} style={{ fontSize: 11, background: "var(--color-bg-soft)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "2px 8px", color: "var(--color-text-muted)" }}>
                    {label}: <strong style={{ color: "var(--color-text)" }}>{value}</strong>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
