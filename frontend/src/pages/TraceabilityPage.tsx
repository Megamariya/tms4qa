import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Modal from "../components/Modal";
import SelectCasesModal from "../components/SelectCasesModal";
import {
  requirementsApi, REQ_TYPES, REQ_STATUSES, PRIORITY,
  type ReqTrace, type CaseTrace, type ReqType, type RequirementInput,
} from "../api/client";
import "./TraceabilityPage.css";

// ── Metadata ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  epic:         { label: "Epic",         color: "#c2410c", bg: "#ffedd5", icon: "E" },
  feature:      { label: "Feature",      color: "#1d4ed8", bg: "#dbeafe", icon: "F" },
  story:        { label: "Story",        color: "#15803d", bg: "#dcfce7", icon: "S" },
  requirement:  { label: "Requirement",  color: "#6d28d9", bg: "#ede9fe", icon: "R" },
  release_note: { label: "Release Note", color: "#0e7490", bg: "#cffafe", icon: "N" },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft:        { label: "Draft",        color: "#6b7280", bg: "#f3f4f6" },
  approved:     { label: "Approved",     color: "#15803d", bg: "#dcfce7" },
  in_progress:  { label: "In Progress",  color: "#1d4ed8", bg: "#dbeafe" },
  ready_for_qa: { label: "Ready for QA", color: "#7c3aed", bg: "#ede9fe" },
  tested:       { label: "Tested",       color: "#0e7490", bg: "#cffafe" },
  rejected:     { label: "Rejected",     color: "#dc2626", bg: "#fee2e2" },
  // legacy fallbacks
  new:          { label: "New",          color: "#6b7280", bg: "#f3f4f6" },
  completed:    { label: "Completed",    color: "#15803d", bg: "#dcfce7" },
  reviewed:     { label: "Reviewed",     color: "#0e7490", bg: "#cffafe" },
  deprecated:   { label: "Deprecated",  color: "#9ca3af", bg: "#f9fafb" },
};

const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  high:    { label: "High",   color: "#dc2626", bg: "#fee2e2" },
  medium:  { label: "Medium", color: "#ca8a04", bg: "#fef3c7" },
  low:     { label: "Low",    color: "#6b7280", bg: "#f3f4f6" },
  not_set: { label: "—",      color: "#9ca3af", bg: "#f9fafb" },
};

const RESULT_STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  passed:      { color: "#15803d", bg: "#dcfce7" },
  failed:      { color: "#dc2626", bg: "#fee2e2" },
  blocked:     { color: "#ca8a04", bg: "#fef3c7" },
  untested:    { color: "#6b7280", bg: "#f3f4f6" },
  in_progress: { color: "#1d4ed8", bg: "#dbeafe" },
  skipped:     { color: "#9ca3af", bg: "#f9fafb" },
};

// ── Tree helpers ──────────────────────────────────────────────────────────────

interface ReqNode extends ReqTrace { children: ReqNode[]; depth: number; }

function buildReqTree(items: ReqTrace[]): ReqNode[] {
  const map = new Map<string, ReqNode>();
  for (const item of items) map.set(item.id, { ...item, children: [], depth: 0 });
  const roots: ReqNode[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) map.get(node.parent_id)!.children.push(node);
    else roots.push(node);
  }
  const setDepth = (nodes: ReqNode[], d: number) => {
    for (const n of nodes) { n.depth = d; setDepth(n.children, d + 1); }
  };
  setDepth(roots, 0);
  return roots;
}

function flattenTree(nodes: ReqNode[], collapsed: Set<string>): ReqNode[] {
  const result: ReqNode[] = [];
  for (const n of nodes) {
    result.push(n);
    if (!collapsed.has(n.id) && n.children.length > 0)
      result.push(...flattenTree(n.children, collapsed));
  }
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function CoverageBar({ passed, failed, blocked, untested, total }: {
  passed: number; failed: number; blocked: number; untested: number; total: number;
}) {
  if (total === 0) return <span className="trc-no-cases">—</span>;
  // Coverage = % of test cases actually executed (not untested)
  const executed = passed + failed + blocked;
  const coveragePct = Math.round((executed / total) * 100);
  return (
    <div className="trc-bar-wrap" title={`Executed: ${executed}/${total} | P:${passed} F:${failed} B:${blocked} U:${untested}`}>
      <div className="trc-bar">
        {passed  > 0 && <div className="trc-bar-seg trc-seg-passed"  style={{ width: `${(passed / total) * 100}%` }} />}
        {failed  > 0 && <div className="trc-bar-seg trc-seg-failed"  style={{ width: `${(failed / total) * 100}%` }} />}
        {blocked > 0 && <div className="trc-bar-seg trc-seg-blocked" style={{ width: `${(blocked / total) * 100}%` }} />}
        {untested> 0 && <div className="trc-bar-seg trc-seg-untested"style={{ width: `${(untested / total) * 100}%` }} />}
      </div>
      <span className="trc-bar-pct">{coveragePct}%</span>
    </div>
  );
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  } catch { return "—"; }
}

// ── Export helpers ────────────────────────────────────────────────────────────

function uniqueDefectCount(req: ReqNode) {
  const all = req.test_cases.flatMap((c) => c.defects);
  return new Map(all.map((d) => [d.id, d])).size;
}

function exportCSV(rows: ReqNode[]) {
  const headers = ["Requirement", "Type", "Priority", "Status", "Source", "Coverage%", "Total", "Passed", "Failed", "Blocked", "Not Exec", "Defects", "Last Run", "Responsible"];
  const data = rows.map((r) => [
    r.title,
    r.req_type ?? "",
    r.priority ?? "",
    r.status ?? "",
    r.external_url ?? r.external_id ?? r.source ?? "",
    `${Math.round(r.coverage_pct)}%`,
    r.total_cases, r.passed, r.failed, r.blocked, r.untested,
    uniqueDefectCount(r),
    fmtDate(r.last_run_date),
    "Demo User",
  ]);
  const csv = [headers, ...data]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `traceability_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function exportPDF(rows: ReqNode[]) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Traceability Report</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:10px;margin:15px}
    h2{font-size:14px;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:10px}
    th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
    th{background:#f3f4f6;font-weight:600}
    tr:nth-child(even){background:#fafafa}
    @media print{@page{margin:10mm}}
  </style></head><body>
  <h2>Traceability Report</h2>
  <p style="font-size:11px;color:#666">Exported: ${new Date().toLocaleString()}</p>
  <table><thead><tr>
    <th>Requirement</th><th>Type</th><th>Priority</th><th>Status</th>
    <th>Coverage</th><th>T</th><th>P</th><th>F</th><th>B</th><th>Not Exec</th><th>Defects</th><th>Last Run</th>
  </tr></thead><tbody>
  ${rows.map((r) => `<tr>
    <td style="padding-left:${r.depth * 14 + 4}px">${r.title}${r.display_seq ? ` (REQ-${r.display_seq})` : ""}</td>
    <td>${r.req_type ?? ""}</td><td>${r.priority ?? ""}</td><td>${r.status ?? ""}</td>
    <td>${Math.round(r.coverage_pct)}%</td>
    <td>${r.total_cases}</td><td>${r.passed}</td><td>${r.failed}</td><td>${r.blocked}</td><td>${r.untested}</td>
    <td>${uniqueDefectCount(r)}</td><td>${fmtDate(r.last_run_date)}</td>
  </tr>`).join("")}
  </tbody></table>
  <script>window.onload=()=>{window.print();}</script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

// ── Column definitions ────────────────────────────────────────────────────────

type ColId = "type" | "priority" | "status" | "release" | "source" | "coverage" | "cases" | "passed" | "failed" | "blocked" | "notexec" | "defects" | "lastrun" | "responsible" | "details";

const ALL_COLUMNS: { id: ColId; label: string }[] = [
  { id: "type",        label: "Type" },
  { id: "priority",    label: "Priority" },
  { id: "status",      label: "Status" },
  { id: "release",     label: "Release" },
  { id: "source",      label: "Source" },
  { id: "coverage",    label: "Coverage" },
  { id: "cases",       label: "Cases" },
  { id: "passed",      label: "✅ Passed" },
  { id: "failed",      label: "❌ Failed" },
  { id: "blocked",     label: "🔒 Blocked" },
  { id: "notexec",     label: "💤 Not Exec" },
  { id: "defects",     label: "Defects" },
  { id: "lastrun",     label: "Last Run" },
  { id: "responsible", label: "Responsible" },
  { id: "details",     label: "Details" },
];

// ── Empty form ────────────────────────────────────────────────────────────────

const emptyForm = (projectId: string, parentId?: string | null): RequirementInput => ({
  title: "", project_id: projectId, description: null,
  req_type: "requirement", parent_id: parentId ?? null, status: "draft",
  priority: "medium", external_id: null, external_url: null, source: null,
});

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Release brief type (localStorage) ────────────────────────────────────────
type ReleaseBrief = { id: string; name: string; version: string; requirement_ids: string[] };

function loadReleasesLS(pid: string): ReleaseBrief[] {
  try { return JSON.parse(localStorage.getItem(`releases_${pid}`) ?? "[]"); } catch { return []; }
}
function saveReleasesLS(pid: string, rels: ReleaseBrief[]) {
  localStorage.setItem(`releases_${pid}`, JSON.stringify(rels));
}

export default function TraceabilityPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeTab, setActiveTab] = useState<"requirements" | "release-notes" | "sources">("requirements");
  const [data, setData] = useState<ReqTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Releases (from localStorage)
  const [releases, setReleases] = useState<ReleaseBrief[]>([]);
  useEffect(() => {
    if (!projectId) return;
    setReleases(loadReleasesLS(projectId));
  }, [projectId]);
  const reqToRelease = useMemo(() => {
    const m = new Map<string, ReleaseBrief>();
    for (const rel of releases) {
      for (const rid of rel.requirement_ids ?? []) {
        if (!m.has(rid)) m.set(rid, rel);
      }
    }
    return m;
  }, [releases]);

  // Hierarchy collapse/expand
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Test-cases expand per row
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // CRUD form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ReqTrace | null>(null);
  const [form, setForm] = useState<RequirementInput>(emptyForm(projectId ?? ""));
  const [formReleaseId, setFormReleaseId] = useState("");
  const [saving, setSaving] = useState(false);

  // Link cases
  const [linkTarget, setLinkTarget] = useState<ReqTrace | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkedCaseIds, setLinkedCaseIds] = useState<string[]>([]);

  // Filter state
  const [filterOpen, setFilterOpen] = useState(false);
  const [fReq, setFReq] = useState("");
  const [fTypes, setFTypes] = useState<string[]>([]);
  const [fPriorities, setFPriorities] = useState<string[]>([]);
  const [fStatuses, setFStatuses] = useState<string[]>([]);
  const [fCoverage, setFCoverage] = useState<"all" | "covered" | "uncovered">("all");
  const [fHasDefects, setFHasDefects] = useState(false);
  const [fMinLinked, setFMinLinked] = useState("");

  // Export dropdown
  const [exportOpen, setExportOpen] = useState(false);
  // Details sidebar for requirements tab
  const [reqDetails, setReqDetails] = useState<ReqNode | null>(null);

  // Summary strip minimization on scroll
  const [summaryMinimized, setSummaryMinimized] = useState(false);
  const [tableWrapEl, setTableWrapEl] = useState<HTMLDivElement | null>(null);
  const tableWrapRef = useCallback((el: HTMLDivElement | null) => setTableWrapEl(el), []);
  useEffect(() => {
    if (!tableWrapEl) return;
    const onScroll = () => setSummaryMinimized(tableWrapEl.scrollTop > 40);
    tableWrapEl.addEventListener("scroll", onScroll, { passive: true });
    return () => tableWrapEl.removeEventListener("scroll", onScroll);
  }, [tableWrapEl]);

  // Column visibility
  const [hiddenCols, setHiddenCols] = useState<Set<ColId>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("trc_hidden_cols") ?? "[]")); } catch { return new Set(); }
  });
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!colPickerOpen) return;
    const h = (e: MouseEvent) => { if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setColPickerOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [colPickerOpen]);

  const toggleCol = (id: ColId) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("trc_hidden_cols", JSON.stringify([...next]));
      return next;
    });
  };
  const showCol = (id: ColId) => !hiddenCols.has(id);
  const visibleColCount = 2 + ALL_COLUMNS.filter((c) => !hiddenCols.has(c.id)).length; // +req +actions

  // Coverage display config
  const coverageDisplay = localStorage.getItem("cfg_traceability_coverage_display") ?? "bar_pct";

  const reload = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    requirementsApi.traceability(projectId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  // Build tree & flatten
  const tree = useMemo(() => buildReqTree(data), [data]);
  const flat = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  // Filters on flat list — при text-поиске включаем потомков найденных узлов
  const filteredFlat = useMemo(() => {
    // Pre-compute which IDs are visible w.r.t. text search:
    // a node is visible if its title matches, OR if its parent is visible (propagates down)
    let searchVisibleIds: Set<string> | null = null;
    if (fReq) {
      const lower = fReq.toLowerCase();
      searchVisibleIds = new Set<string>();
      for (const n of flat) {
        if (n.title.toLowerCase().includes(lower)) {
          searchVisibleIds.add(n.id);
        } else if (n.parent_id && searchVisibleIds.has(n.parent_id)) {
          searchVisibleIds.add(n.id); // parent matched → show child too
        }
      }
    }
    return flat.filter((r) => {
      if (searchVisibleIds !== null && !searchVisibleIds.has(r.id)) return false;
      if (fTypes.length > 0 && !fTypes.includes(r.req_type ?? "")) return false;
      if (fPriorities.length > 0 && !fPriorities.includes(r.priority ?? "")) return false;
      if (fStatuses.length > 0 && !fStatuses.includes(r.status ?? "")) return false;
      if (fCoverage === "covered" && r.total_cases === 0) return false;
      if (fCoverage === "uncovered" && r.total_cases > 0) return false;
      if (fHasDefects && !r.test_cases.some((tc) => tc.defects.length > 0)) return false;
      if (fMinLinked && r.total_cases < parseInt(fMinLinked)) return false;
      return true;
    });
  }, [flat, fReq, fTypes, fPriorities, fStatuses, fCoverage, fHasDefects, fMinLinked]);

  const activeFilters =
    (fReq ? 1 : 0) + (fTypes.length > 0 ? 1 : 0) + (fPriorities.length > 0 ? 1 : 0) +
    (fStatuses.length > 0 ? 1 : 0) + (fCoverage !== "all" ? 1 : 0) +
    (fHasDefects ? 1 : 0) + (fMinLinked ? 1 : 0);

  const clearFilters = () => {
    setFReq(""); setFTypes([]); setFPriorities([]); setFStatuses([]);
    setFCoverage("all"); setFHasDefects(false); setFMinLinked("");
  };

  // Summary (from all data, not filtered)
  const totalCases    = data.reduce((s, r) => s + r.total_cases, 0);
  const totalPassed   = data.reduce((s, r) => s + r.passed, 0);
  const totalFailed   = data.reduce((s, r) => s + r.failed, 0);
  const totalBlocked  = data.reduce((s, r) => s + r.blocked, 0);
  const totalUntested = data.reduce((s, r) => s + r.untested, 0);

  // Hierarchy helpers
  const toggleCollapse = (id: string) =>
    setCollapsed((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleExpand = (id: string) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => {
    setExpanded(new Set(data.map((r) => r.id)));
    setCollapsed(new Set()); // also unfold hierarchy
  };
  const collapseAll = () => {
    setExpanded(new Set()); // hide all test cases
    // collapse all parent nodes
    const parents = new Set<string>();
    const collect = (nodes: ReqNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) { parents.add(n.id); collect(n.children); }
      }
    };
    collect(tree);
    setCollapsed(parents);
  };

  // CRUD
  const openCreate = (parentId?: string, childReqType?: string) => {
    setEditing(null);
    setFormReleaseId("");
    setForm({ ...emptyForm(projectId!, parentId ?? null), req_type: (childReqType as ReqType) ?? "requirement" });
    setFormOpen(true);
  };

  const openEdit = (req: ReqTrace) => {
    setEditing(req);
    setFormReleaseId(reqToRelease.get(req.id)?.id ?? "");
    setForm({
      title: req.title, project_id: projectId!,
      description: req.description ?? null,
      req_type: (req.req_type as ReqType) ?? "requirement",
      parent_id: req.parent_id ?? null,
      status: (req.status ?? "draft") as any,
      priority: (req.priority as any) ?? "medium",
      external_id: req.external_id ?? null,
      external_url: req.external_url ?? null,
      source: req.source ?? null,
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, description: form.description || null, external_id: form.external_id || null, external_url: form.external_url || null };
      let savedId: string;
      if (editing) {
        await requirementsApi.update(editing.id, payload);
        savedId = editing.id;
      } else {
        const created = await requirementsApi.create(payload);
        savedId = created.id;
      }
      // Update release linkage in localStorage
      if (projectId) {
        const rels = loadReleasesLS(projectId);
        const updated = rels.map((rel) => {
          const ids = rel.requirement_ids ?? [];
          if (rel.id === formReleaseId) {
            return { ...rel, requirement_ids: ids.includes(savedId) ? ids : [...ids, savedId] };
          } else {
            return { ...rel, requirement_ids: ids.filter((id) => id !== savedId) };
          }
        });
        saveReleasesLS(projectId, updated);
        setReleases(updated);
      }
      setFormOpen(false);
      reload();
    } finally { setSaving(false); }
  };

  const remove = async (req: ReqTrace) => {
    if (!confirm(`Удалить «${req.title}»?`)) return;
    await requirementsApi.delete(req.id);
    reload();
  };

  // Link cases
  const openLink = async (req: ReqTrace) => {
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

  // Child type
  const childType = (pt: string | null | undefined): ReqType => {
    if (!pt || pt === "requirement") return "requirement";
    const order: ReqType[] = ["epic", "feature", "story", "requirement"];
    const idx = order.indexOf(pt as ReqType);
    return order[Math.min(idx + 1, 3)];
  };

  return (
    <div className="trc-page">
      {/* ── Sticky top section ─────────────────────────────── */}
      <div className="trc-page-sticky">
        {/* Header */}
        <div className="trc-header">
          <div>
            <h1 className="trc-title">Requirements Traceability</h1>
            <p className="trc-subtitle">Requirements ↔ Test Cases coverage</p>
          </div>
          {activeTab === "requirements" && (
            <div className="trc-header-actions">
              <button className="btn btn-primary" onClick={() => openCreate()}>+ Add Requirement</button>

              {/* Export dropdown */}
              <div className="trc-export-wrap" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-secondary" onClick={() => setExportOpen((v) => !v)}>
                  Export ▾
                </button>
                {exportOpen && (
                  <div className="trc-export-menu">
                    <button className="trc-export-item" onClick={() => { exportCSV(filteredFlat); setExportOpen(false); }}>
                      📊 Export CSV
                    </button>
                    <button className="trc-export-item" onClick={() => { exportPDF(filteredFlat); setExportOpen(false); }}>
                      🖨 Export PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="trc-tabs">
          <button className={`trc-tab${activeTab === "requirements" ? " trc-tab-active" : ""}`} onClick={() => setActiveTab("requirements")}>
            Requirements
          </button>
          <button className={`trc-tab${activeTab === "release-notes" ? " trc-tab-active" : ""}`} onClick={() => setActiveTab("release-notes")}>
            Release notes
          </button>
          <button className={`trc-tab${activeTab === "sources" ? " trc-tab-active" : ""}`} onClick={() => setActiveTab("sources")}>
            Jira / Sources
          </button>
        </div>

        {activeTab === "requirements" && <>
          {/* Summary strip */}
          {!loading && data.length > 0 && (
            <div className={"trc-summary" + (summaryMinimized ? " trc-summary--minimized" : "")}>
              <div className="trc-sum-item">
                <span className="trc-sum-val">{data.length}</span>
                <span className="trc-sum-lbl">Requirements</span>
              </div>
              <div className="trc-sum-item">
                <span className="trc-sum-val">{totalCases}</span>
                <span className="trc-sum-lbl">Test Cases</span>
              </div>
              <div className="trc-sum-item trc-sum-passed">
                <span className="trc-sum-val">{totalPassed}</span>
                <span className="trc-sum-lbl">Passed</span>
              </div>
              <div className="trc-sum-item trc-sum-failed">
                <span className="trc-sum-val">{totalFailed}</span>
                <span className="trc-sum-lbl">Failed</span>
              </div>
              <div className="trc-sum-item">
                <span className="trc-sum-val">{totalBlocked}</span>
                <span className="trc-sum-lbl">Blocked</span>
              </div>
              <div className="trc-sum-item">
                <span className="trc-sum-val">{totalUntested}</span>
                <span className="trc-sum-lbl">Not Executed</span>
              </div>
            </div>
          )}

          {/* Toolbar — inline filters */}
          <div className="trc-toolbar">
            <input
              className="input trc-search-inline"
              placeholder="Поиск требований…"
              value={fReq}
              onChange={(e) => setFReq(e.target.value)}
            />
            <select className="input trc-filter-select" value={fTypes[0] ?? ""}
              onChange={(e) => setFTypes(e.target.value ? [e.target.value] : [])}>
              <option value="">Все типы</option>
              {([...(REQ_TYPES as readonly string[]), "release_note"]).map((t) => (
                <option key={t} value={t}>{TYPE_META[t]?.label ?? t}</option>
              ))}
            </select>
            <select className="input trc-filter-select" value={fPriorities[0] ?? ""}
              onChange={(e) => setFPriorities(e.target.value ? [e.target.value] : [])}>
              <option value="">Все приоритеты</option>
              {(PRIORITY as readonly string[]).map((p) => (
                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
              ))}
            </select>
            <select className="input trc-filter-select" value={fStatuses[0] ?? ""}
              onChange={(e) => setFStatuses(e.target.value ? [e.target.value] : [])}>
              <option value="">Все статусы</option>
              {(REQ_STATUSES as readonly string[]).map((s) => (
                <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>
              ))}
            </select>
            <select className="input trc-filter-select" value={fCoverage}
              onChange={(e) => setFCoverage(e.target.value as any)}>
              <option value="all">Любое покрытие</option>
              <option value="covered">Покрытые</option>
              <option value="uncovered">Без кейсов</option>
            </select>
            {activeFilters > 0 && (
              <button className="btn-link" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={clearFilters}>
                Сбросить ({activeFilters})
              </button>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              {/* Column visibility picker */}
              <div style={{ position: "relative" }} ref={colPickerRef}>
                <button className="btn btn-secondary" onClick={() => setColPickerOpen((v) => !v)}
                  style={{ fontSize: 12 }}>
                  ⊞ Столбцы{hiddenCols.size > 0 ? ` (${hiddenCols.size})` : ""}
                </button>
                {colPickerOpen && (
                  <div className="trc-col-picker">
                    {ALL_COLUMNS.map((col) => (
                      <label key={col.id} className="trc-col-picker-item">
                        <input type="checkbox" checked={!hiddenCols.has(col.id)} onChange={() => toggleCol(col.id)} />
                        <span>{col.label}</span>
                      </label>
                    ))}
                    {hiddenCols.size > 0 && (
                      <button className="trc-col-picker-reset" onClick={() => {
                        setHiddenCols(new Set());
                        localStorage.removeItem("trc_hidden_cols");
                      }}>Показать все</button>
                    )}
                  </div>
                )}
              </div>
              <button className="btn btn-secondary" onClick={expandAll}>Expand all</button>
              <button className="btn btn-secondary" onClick={collapseAll}>Collapse all</button>
            </div>
          </div>
        </>}
      </div>
      {/* ── End sticky top ─────────────────────────────────── */}

      {activeTab === "requirements" && <>

      {error && <div className="page-banner" style={{ margin: "8px 28px 0" }}>⚠ {error}</div>}
      {loading && <div className="trc-loading">Загружаем…</div>}

      {!loading && data.length === 0 && (
        <div className="trc-empty">
          <div className="trc-empty-icon">🧭</div>
          <p>Нет требований. Нажмите «+ Add Requirement».</p>
        </div>
      )}

      {!loading && filteredFlat.length === 0 && data.length > 0 && (
        <div className="trc-empty">
          <div className="trc-empty-icon">🔍</div>
          <p>Нет требований по фильтру.</p>
        </div>
      )}

      {/* Wide table */}
      {!loading && filteredFlat.length > 0 && (
        <div className="trc-table-wrap" ref={tableWrapRef}>
          <table className="trc-table2">
            <thead>
              <tr className="trc2-head-row">
                <th className="trc2-th trc2-col-req">Requirement</th>
                {showCol("type")        && <th className="trc2-th trc2-col-type">Type</th>}
                {showCol("priority")    && <th className="trc2-th trc2-col-pri">Priority</th>}
                {showCol("status")      && <th className="trc2-th trc2-col-status">Status</th>}
                {showCol("release")     && <th className="trc2-th trc2-col-release">Release</th>}
                {showCol("source")      && <th className="trc2-th trc2-col-source">Source</th>}
                {showCol("coverage")    && <th className="trc2-th trc2-col-cov">Coverage</th>}
                {showCol("cases")       && <th className="trc2-th trc2-col-cases" title="Link Test Cases">Cases</th>}
                {showCol("passed")      && <th className="trc2-th trc2-col-num trc2-pass" title="Passed">✅</th>}
                {showCol("failed")      && <th className="trc2-th trc2-col-num trc2-fail" title="Failed">❌</th>}
                {showCol("blocked")     && <th className="trc2-th trc2-col-num trc2-block" title="Blocked">🔒</th>}
                {showCol("notexec")     && <th className="trc2-th trc2-col-notexec" title="Not Executed">💤</th>}
                {showCol("defects")     && <th className="trc2-th trc2-col-defects">Defects</th>}
                {showCol("lastrun")     && <th className="trc2-th trc2-col-lastrun">Last Run</th>}
                {showCol("responsible") && <th className="trc2-th trc2-col-resp">Responsible</th>}
                {showCol("details")     && <th className="trc2-th">Details</th>}
                <th className="trc2-th trc2-col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {filteredFlat.map((node) => {
                const isOpen = expanded.has(node.id);
                const tm = TYPE_META[node.req_type ?? "requirement"] ?? TYPE_META.requirement;
                const pm = PRIORITY_META[node.priority ?? "not_set"] ?? PRIORITY_META.not_set;
                const sm = STATUS_META[node.status ?? "draft"] ?? STATUS_META.draft;
                const allDefects = node.test_cases.flatMap((c) => c.defects);
                const defectCount = new Map(allDefects.map((d) => [d.id, d])).size;
                const hasChildren = node.children.length > 0;
                const isChildCollapsed = collapsed.has(node.id);

                return (
                  <Fragment key={node.id}>
                    <tr className={`trc2-row${isOpen ? " trc2-row-open" : ""}`}>
                      <td
                        className="trc2-td-req"
                        style={{ paddingLeft: `${node.depth * 20 + 8}px` }}
                        onClick={() => toggleExpand(node.id)}
                      >
                        <span
                          className="trc2-hier-toggle"
                          style={{ visibility: hasChildren ? "visible" : "hidden" }}
                          onClick={(e) => { e.stopPropagation(); toggleCollapse(node.id); }}
                        >
                          {isChildCollapsed ? "▶" : "▼"}
                        </span>
                        <span className="trc-toggle trc2-tc-toggle">{isOpen ? "▾" : "›"}</span>
                        <span className="trc-type-chip" style={{ background: tm.bg, color: tm.color }}>{tm.icon}</span>
                        <span className="trc2-req-title">{node.title}</span>
                        {node.display_seq && <span className="trc-req-id">REQ-{node.display_seq}</span>}
                      </td>

                      {showCol("type")     && <td><span className="trc2-type-lbl" style={{ color: tm.color }}>{tm.label}</span></td>}

                      {showCol("priority") && <td>
                        <span className="trc2-pri-badge" style={{ background: pm.bg, color: pm.color }}>
                          {pm.label}
                        </span>
                      </td>}

                      {showCol("status") && <td>
                        <span className="trc-status-pill" style={{ background: sm.bg, color: sm.color }}>
                          {sm.label}
                        </span>
                      </td>}

                      {showCol("release") && <td onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const rel = reqToRelease.get(node.id);
                          return rel ? (
                            <span className="trc2-release-chip" title={`${rel.name} v${rel.version}`}>
                              🚀 {rel.name.length > 14 ? rel.name.slice(0, 14) + "…" : rel.name}
                            </span>
                          ) : <span className="trc-muted">—</span>;
                        })()}
                      </td>}

                      {showCol("source") && <td className="trc2-muted">
                        {node.external_url ? (
                          <a href={node.external_url} target="_blank" rel="noopener noreferrer"
                            className="trc2-source-link" onClick={(e) => e.stopPropagation()}
                            title={node.external_url}>
                            {node.external_id ?? node.source ?? "Link"}
                          </a>
                        ) : node.external_id ? (
                          <span>{node.external_id}</span>
                        ) : node.source ? (
                          <span>{node.source}</span>
                        ) : (
                          <span className="trc-muted">—</span>
                        )}
                      </td>}

                      {showCol("coverage") && <td className="trc2-td-cov" onClick={() => toggleExpand(node.id)}>
                        {coverageDisplay === "pct" ? (
                          <span className="trc-cov-pct-only">
                            {node.total_cases === 0 ? <span className="trc-no-cases">—</span>
                              : `${Math.round(((node.passed + node.failed + node.blocked) / node.total_cases) * 100)}%`}
                          </span>
                        ) : (
                          <CoverageBar
                            passed={node.passed} failed={node.failed}
                            blocked={node.blocked} untested={node.untested}
                            total={node.total_cases}
                          />
                        )}
                      </td>}

                      {showCol("cases") && <td className="trc2-center">
                        <button
                          className="trc2-cases-btn"
                          onClick={(e) => { e.stopPropagation(); openLink(node); }}
                          title="Manage linked test cases"
                        >
                          🔗 {node.total_cases}
                        </button>
                      </td>}

                      {showCol("passed") && <td className="trc2-center trc2-num-val trc2-pass" onClick={() => toggleExpand(node.id)}>
                        {node.passed > 0 ? node.passed : <span className="trc-muted">0</span>}
                      </td>}
                      {showCol("failed") && <td className="trc2-center trc2-num-val trc2-fail" onClick={() => toggleExpand(node.id)}>
                        {node.failed > 0 ? node.failed : <span className="trc-muted">0</span>}
                      </td>}
                      {showCol("blocked") && <td className="trc2-center trc2-num-val trc2-block" onClick={() => toggleExpand(node.id)}>
                        {node.blocked > 0 ? node.blocked : <span className="trc-muted">0</span>}
                      </td>}
                      {showCol("notexec") && <td className="trc2-center trc2-num-val" onClick={() => toggleExpand(node.id)}>
                        {node.untested}
                      </td>}
                      {showCol("defects") && <td className="trc2-center" onClick={() => toggleExpand(node.id)}>
                        {defectCount > 0
                          ? <span className="trc2-defect-badge">🐞 {defectCount}</span>
                          : <span className="trc-muted">—</span>}
                      </td>}
                      {showCol("lastrun") && <td className="trc2-muted" onClick={() => toggleExpand(node.id)}>
                        {fmtDate(node.last_run_date)}
                      </td>}
                      {showCol("responsible") && <td className="trc2-muted" onClick={() => toggleExpand(node.id)}>Demo User</td>}

                      {showCol("details") && <td onClick={(e) => e.stopPropagation()}>
                        <button className="trc-details-btn" onClick={() => setReqDetails((p) => p?.id === node.id ? null : node)}>Details</button>
                      </td>}
                      <td className="trc2-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="trc2-act-btn" title="Add child requirement"
                          onClick={() => openCreate(node.id, childType(node.req_type))}
                        >+</button>
                        <button className="trc2-act-btn" title="Edit" onClick={() => openEdit(node)}>✎</button>
                        <button className="trc2-act-btn trc2-act-del" title="Delete" onClick={() => remove(node)}>🗑</button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={visibleColCount} className="trc2-exp-cell">
                          <div className="trc2-cases-wrap">
                            {node.test_cases.length === 0 ? (
                              <div className="trc-no-linked">No test cases linked. Click 🔗 Cases to add.</div>
                            ) : (
                              node.test_cases.map((tc) => <TcRow key={tc.id} tc={tc} />)
                            )}
                          </div>
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

      {reqDetails && (
        <ReqDetailSidebar req={reqDetails as any} onClose={() => setReqDetails(null)} />
      )}

      </>}

      {activeTab === "release-notes" && (
        <div className="trc-tab-scroll">
          <ReleaseNotesTab projectId={projectId!} data={data} />
        </div>
      )}

      {activeTab === "sources" && (
        <div className="trc-tab-scroll">
          <SourcesTab data={data} />
        </div>
      )}

      {/* Requirement Form Modal */}
      <Modal
        open={formOpen}
        title={editing ? "Edit Requirement" : "Create Requirement"}
        onClose={() => setFormOpen(false)}
      >
        <div className="trc-form">
          <label className="trc-form-label">
            Title *
            <input
              className="input" autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Requirement title"
            />
          </label>

          <div className="trc-form-row">
            <label className="trc-form-label">
              Type
              <select className="input" value={form.req_type ?? "requirement"}
                onChange={(e) => setForm({ ...form, req_type: e.target.value as any })}>
                {REQ_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_META[t]?.label ?? t}</option>
                ))}
                <option value="release_note">{TYPE_META.release_note.label}</option>
              </select>
            </label>

            <label className="trc-form-label">
              Status
              <select className="input" value={form.status ?? "draft"}
                onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                {REQ_STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>
                ))}
              </select>
            </label>

            <label className="trc-form-label">
              Priority
              <select className="input" value={form.priority ?? "medium"}
                onChange={(e) => setForm({ ...form, priority: e.target.value as any })}>
                {(PRIORITY as readonly string[]).map((p) => (
                  <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="trc-form-label">
            Parent
            <select className="input" value={form.parent_id ?? ""}
              onChange={(e) => setForm({ ...form, parent_id: e.target.value || null })}>
              <option value="">— No parent —</option>
              {data
                .filter((r) => !editing || r.id !== editing.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    [{TYPE_META[r.req_type ?? "requirement"]?.icon ?? "R"}] {r.title}
                  </option>
                ))}
            </select>
          </label>

          <label className="trc-form-label">
            Description
            <textarea className="input" rows={3} placeholder="Description"
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>

          <div className="trc-form-row">
            <label className="trc-form-label">
              Source ID
              <input className="input" placeholder="e.g. PROJ-123"
                value={form.external_id ?? ""}
                onChange={(e) => setForm({ ...form, external_id: e.target.value })} />
            </label>
            <label className="trc-form-label" style={{ flex: 2 }}>
              Source URL
              <input className="input" placeholder="https://..."
                value={form.external_url ?? ""}
                onChange={(e) => setForm({ ...form, external_url: e.target.value })} />
            </label>
          </div>

          {releases.length > 0 && (
            <label className="trc-form-label">
              Release
              <select className="input" value={formReleaseId}
                onChange={(e) => setFormReleaseId(e.target.value)}>
                <option value="">— Не привязано —</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} v{r.version}</option>
                ))}
              </select>
            </label>
          )}

          <div className="trc-form-footer">
            <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveForm} disabled={!form.title.trim() || saving}>
              {saving ? "Saving…" : editing ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Link Cases Modal */}
      <SelectCasesModal
        open={linkOpen}
        projectId={projectId!}
        preSelectedIds={linkedCaseIds}
        onClose={() => setLinkOpen(false)}
        onDone={saveLink}
      />
    </div>
  );
}

// ── TcRow ─────────────────────────────────────────────────────────────────────
function TcRow({ tc }: { tc: CaseTrace }) {
  const [open, setOpen] = useState(false);
  const hasDefects = tc.defects.length > 0;
  const m = RESULT_STATUS_COLORS[tc.latest_status] ?? RESULT_STATUS_COLORS.untested;
  return (
    <div className="trc-tc-block">
      <div className="trc-tc-row" onClick={() => hasDefects && setOpen((v) => !v)}>
        <span className="trc-tc-toggle" style={{ visibility: hasDefects ? "visible" : "hidden" }}>
          {open ? "▼" : "▶"}
        </span>
        <span className="trc-status-badge" style={{ background: m.bg, color: m.color }}>
          {tc.latest_status.replace(/_/g, " ")}
        </span>
        <span className="trc-tc-name">{tc.name}</span>
        {tc.suite_name && <span className="trc-tc-suite">{tc.suite_name}</span>}
        {tc.defects.length > 0 && <span className="trc-tc-defects">🐞 {tc.defects.length}</span>}
      </div>
      {open && tc.defects.map((d) => (
        <div key={d.id} className="trc-defect-row">
          <span className="trc-defect-id">D-{d.display_seq}</span>
          <span className="trc-defect-title">{d.title}</span>
          <span className={`trc-defect-status trc-ds-${d.status}`}>{d.status}</span>
          <span className={`trc-defect-sev trc-sev-${d.severity}`}>{d.severity}</span>
        </div>
      ))}
    </div>
  );
}

// ── Filter panel ──────────────────────────────────────────────────────────────
type FPProps = {
  fReq: string; setFReq: (v: string) => void;
  fTypes: string[]; setFTypes: (v: string[]) => void;
  fPriorities: string[]; setFPriorities: (v: string[]) => void;
  fStatuses: string[]; setFStatuses: (v: string[]) => void;
  fCoverage: "all" | "covered" | "uncovered"; setFCoverage: (v: "all" | "covered" | "uncovered") => void;
  fHasDefects: boolean; setFHasDefects: (v: boolean) => void;
  fMinLinked: string; setFMinLinked: (v: string) => void;
};

function TrcFilterPanel({ fReq, setFReq, fTypes, setFTypes, fPriorities, setFPriorities,
  fStatuses, setFStatuses, fCoverage, setFCoverage, fHasDefects, setFHasDefects, fMinLinked, setFMinLinked }: FPProps) {
  const toggleArr = (list: string[], setList: (v: string[]) => void, val: string) =>
    setList(list.includes(val) ? list.filter((v) => v !== val) : [...list, val]);

  return (
    <div className="trc-fp">
      <div className="trc-fp-row">
        <div className="trc-fp-group">
          <div className="trc-fp-label">Requirement</div>
          <input className="input" style={{ width: 180, fontSize: 12 }} placeholder="Filter by name…"
            value={fReq} onChange={(e) => setFReq(e.target.value)} />
        </div>
        <div className="trc-fp-group">
          <div className="trc-fp-label">Type</div>
          <div className="trc-fp-checks">
            {([...(REQ_TYPES as readonly string[]), "release_note"]).map((t) => (
              <label key={t} className="trc-fp-item">
                <input type="checkbox" checked={fTypes.includes(t)} onChange={() => toggleArr(fTypes, setFTypes, t)} />
                <span>{TYPE_META[t]?.label ?? t}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="trc-fp-group">
          <div className="trc-fp-label">Priority</div>
          <div className="trc-fp-checks">
            {(PRIORITY as readonly string[]).map((p) => (
              <label key={p} className="trc-fp-item">
                <input type="checkbox" checked={fPriorities.includes(p)} onChange={() => toggleArr(fPriorities, setFPriorities, p)} />
                <span>{p.replace(/_/g, " ")}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="trc-fp-group">
          <div className="trc-fp-label">Status</div>
          <div className="trc-fp-checks">
            {(REQ_STATUSES as readonly string[]).map((s) => (
              <label key={s} className="trc-fp-item">
                <input type="checkbox" checked={fStatuses.includes(s)} onChange={() => toggleArr(fStatuses, setFStatuses, s)} />
                <span>{STATUS_META[s]?.label ?? s}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="trc-fp-group">
          <div className="trc-fp-label">Coverage</div>
          <div className="trc-fp-checks">
            {(["all", "covered", "uncovered"] as const).map((v) => (
              <label key={v} className="trc-fp-item">
                <input type="radio" name="trc-cov" checked={fCoverage === v} onChange={() => setFCoverage(v)} />
                <span>{v === "all" ? "All" : v === "covered" ? "Covered" : "Uncovered"}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="trc-fp-group">
          <div className="trc-fp-label">Min Cases ≥</div>
          <input className="input" style={{ width: 70, fontSize: 12 }} type="number" min="0"
            value={fMinLinked} onChange={(e) => setFMinLinked(e.target.value)} />
          <div className="trc-fp-label" style={{ marginTop: 10 }}>Other</div>
          <label className="trc-fp-item">
            <input type="checkbox" checked={fHasDefects} onChange={(e) => setFHasDefects(e.target.checked)} />
            <span>Has defects</span>
          </label>
        </div>
      </div>
    </div>
  );
}

// ── ReleaseNotesTab ───────────────────────────────────────────────────────────

type ReleaseFullTrc = {
  id: string; name: string; version: string; environment: string;
  status?: string; planned_date?: string; requirement_ids?: string[];
};

function loadReleasesForTrc(pid: string): ReleaseFullTrc[] {
  try { return JSON.parse(localStorage.getItem(`releases_${pid}`) ?? "[]"); } catch { return []; }
}

function saveRelease(pid: string, release: ReleaseFullTrc) {
  const all = loadReleasesForTrc(pid);
  const updated = all.map((r) => r.id === release.id ? release : r);
  localStorage.setItem(`releases_${pid}`, JSON.stringify(updated));
}

const ENV_TRC: Record<string, { color: string; bg: string }> = {
  dev:  { color: "#1d4ed8", bg: "#dbeafe" },
  test: { color: "#92400e", bg: "#fef3c7" },
  prod: { color: "#15803d", bg: "#dcfce7" },
};

function ReleaseNotesTab({ projectId, data }: { projectId: string; data: ReqTrace[] }) {
  const [releases, setReleases] = useState<ReleaseFullTrc[]>([]);
  const [linkingRelId, setLinkingRelId] = useState<string | null>(null);
  const [selectedReqIds, setSelectedReqIds] = useState<string[]>([]);
  const [collapsedRels, setCollapsedRels] = useState<Set<string>>(new Set());
  const [detailsReq, setDetailsReq] = useState<ReqTrace | null>(null);
  const [rnSearch, setRnSearch] = useState("");
  const [rnEnv, setRnEnv] = useState("");
  const [rnVersion, setRnVersion] = useState("");
  // Expand/collapse test cases per requirement in this tab
  const [expandedReqIds, setExpandedReqIds] = useState<Set<string>>(new Set());
  const toggleReqExpand = (id: string) =>
    setExpandedReqIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleRelCollapse = (id: string) =>
    setCollapsedRels((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  useEffect(() => {
    setReleases(loadReleasesForTrc(projectId));
  }, [projectId]);

  const openLink = (rel: ReleaseFullTrc) => {
    setLinkingRelId(rel.id);
    setSelectedReqIds(rel.requirement_ids ?? []);
  };

  const saveLink = () => {
    if (!linkingRelId) return;
    const rel = releases.find((r) => r.id === linkingRelId);
    if (!rel) return;
    const updated = { ...rel, requirement_ids: selectedReqIds };
    saveRelease(projectId, updated);
    setReleases(loadReleasesForTrc(projectId));
    setLinkingRelId(null);
  };

  const toggleReq = (id: string) =>
    setSelectedReqIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const allVersions = useMemo(() => Array.from(new Set(releases.map((r) => r.version).filter(Boolean))), [releases]);
  const allEnvs = useMemo(() => Array.from(new Set(releases.map((r) => r.environment?.toLowerCase()).filter(Boolean) as string[])), [releases]);

  const filteredReleases = useMemo(() => releases.filter((r) => {
    if (rnSearch && !r.name.toLowerCase().includes(rnSearch.toLowerCase()) && !r.version.toLowerCase().includes(rnSearch.toLowerCase())) return false;
    if (rnEnv && r.environment?.toLowerCase() !== rnEnv) return false;
    if (rnVersion && r.version !== rnVersion) return false;
    return true;
  }), [releases, rnSearch, rnEnv, rnVersion]);

  if (releases.length === 0) {
    return (
      <div className="trc-empty" style={{ marginTop: 40 }}>
        <div className="trc-empty-icon">🚀</div>
        <p>Нет релизов. Создайте релиз в разделе Releases.</p>
      </div>
    );
  }

  return (
    <div className="trc-rn-tab">
      {/* Search + filter toolbar */}
      <div className="trc-rn-toolbar">
        <input
          className="input" style={{ width: 220, fontSize: 12 }}
          placeholder="Поиск по названию / версии…"
          value={rnSearch} onChange={(e) => setRnSearch(e.target.value)}
        />
        {allVersions.length > 1 && (
          <select className="input" style={{ width: 120, fontSize: 12 }}
            value={rnVersion} onChange={(e) => setRnVersion(e.target.value)}>
            <option value="">Все версии</option>
            {allVersions.map((v) => <option key={v} value={v}>v{v}</option>)}
          </select>
        )}
        {allEnvs.length > 1 && (
          <select className="input" style={{ width: 110, fontSize: 12 }}
            value={rnEnv} onChange={(e) => setRnEnv(e.target.value)}>
            <option value="">Все среды</option>
            {allEnvs.map((e) => <option key={e} value={e}>{e.toUpperCase()}</option>)}
          </select>
        )}
        {(rnSearch || rnEnv || rnVersion) && (
          <button className="btn-link" style={{ fontSize: 12 }}
            onClick={() => { setRnSearch(""); setRnEnv(""); setRnVersion(""); }}>
            Сбросить
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--color-text-muted)", marginLeft: "auto" }}>
          {filteredReleases.length} из {releases.length} релизов
        </span>
      </div>

      {filteredReleases.length === 0 && (
        <div className="trc-empty" style={{ marginTop: 20 }}>
          <div className="trc-empty-icon">🔍</div>
          <p>Нет релизов по фильтру.</p>
        </div>
      )}

      {filteredReleases.map((rel) => {
        const em = ENV_TRC[rel.environment?.toLowerCase()] ?? null;
        const linkedIds = rel.requirement_ids ?? [];
        const linkedReqs = data.filter((r) => linkedIds.includes(r.id));
        const totalCases = linkedReqs.reduce((s, r) => s + r.total_cases, 0);
        const passed = linkedReqs.reduce((s, r) => s + r.passed, 0);
        const failed = linkedReqs.reduce((s, r) => s + r.failed, 0);
        const covPct = totalCases > 0 ? Math.round((passed / totalCases) * 100) : 0;

        const isCollapsed = collapsedRels.has(rel.id);
        return (
          <div key={rel.id} className="trc-rn-release">
            <div className="trc-rn-rel-header" style={{ cursor: "pointer" }} onClick={() => toggleRelCollapse(rel.id)}>
              <div className="trc-rn-rel-title">
                <span className="trc-rn-collapse-btn">{isCollapsed ? "▶" : "▾"}</span>
                <span className="trc-rn-rel-name">{rel.name}</span>
                <span className="trc-rn-rel-ver">v{rel.version}</span>
                {em && <span className="trc-rn-rel-env" style={{ background: em.bg, color: em.color }}>{rel.environment.toUpperCase()}</span>}
              </div>
              <div className="trc-rn-rel-stats" onClick={(e) => e.stopPropagation()}>
                <span className="trc-rn-stat"><b>{linkedReqs.length}</b> требований</span>
                <span className="trc-rn-stat"><b>{totalCases}</b> кейсов</span>
                {totalCases > 0 && <span className="trc-rn-stat trc-rn-cov">{covPct}% покрыто</span>}
                <button className="trc-rn-link-btn" onClick={(e) => { e.stopPropagation(); openLink(rel); }}>
                  🔗 Link requirements
                </button>
              </div>
            </div>

            {!isCollapsed && <>

            {/* Inline link panel */}
            {linkingRelId === rel.id && (
              <div className="trc-rn-link-panel">
                <div className="trc-rn-link-title">Выберите требования для {rel.name}:</div>
                <div className="trc-rn-req-list">
                  {data.map((req) => {
                    const tm = TYPE_META[req.req_type ?? "requirement"] ?? TYPE_META.requirement;
                    return (
                      <label key={req.id} className="trc-rn-req-item">
                        <input type="checkbox"
                          checked={selectedReqIds.includes(req.id)}
                          onChange={() => toggleReq(req.id)} />
                        <span className="trc-type-chip" style={{ background: tm.bg, color: tm.color }}>{tm.icon}</span>
                        <span className="trc-rn-req-name">{req.title}</span>
                        {req.display_seq && <span className="trc-req-id">REQ-{req.display_seq}</span>}
                      </label>
                    );
                  })}
                </div>
                <div className="trc-rn-link-footer">
                  <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    {selectedReqIds.length} выбрано
                  </span>
                  <button className="btn btn-secondary" onClick={() => setLinkingRelId(null)}>Отмена</button>
                  <button className="btn btn-primary" onClick={saveLink}>Сохранить</button>
                </div>
              </div>
            )}

            {linkedReqs.length > 0 ? (
              <table className="trc-rn-table">
                <thead>
                  <tr>
                    <th style={{ width: 24 }}></th>
                    <th>Requirement</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Coverage</th>
                    <th>Cases</th>
                    <th>✅</th><th>❌</th><th>💤</th>
                    <th>Details</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {linkedReqs.map((req) => {
                    const tm = TYPE_META[req.req_type ?? "requirement"] ?? TYPE_META.requirement;
                    const sm = STATUS_META[req.status ?? "draft"] ?? STATUS_META.draft;
                    const isReqExpanded = expandedReqIds.has(req.id);
                    return (
                      <Fragment key={req.id}>
                        <tr
                          style={{ cursor: req.total_cases > 0 ? "pointer" : "default", background: isReqExpanded ? "var(--color-bg-soft)" : undefined }}
                          onClick={() => req.total_cases > 0 && toggleReqExpand(req.id)}
                        >
                          <td style={{ textAlign: "center", width: 24, color: "var(--color-text-muted)" }}>
                            {req.total_cases > 0 ? (isReqExpanded ? "▾" : "›") : ""}
                          </td>
                          <td>
                            <span className="trc-type-chip" style={{ background: tm.bg, color: tm.color }}>{tm.icon}</span>
                            {" "}{req.title}
                          </td>
                          <td><span className="trc2-type-lbl" style={{ color: tm.color }}>{tm.label}</span></td>
                          <td><span className="trc-status-pill" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span></td>
                          <td onClick={(e) => e.stopPropagation()}><CoverageBar passed={req.passed} failed={req.failed} blocked={req.blocked} untested={req.untested} total={req.total_cases} /></td>
                          <td style={{ textAlign: "center" }}>{req.total_cases}</td>
                          <td style={{ textAlign: "center", color: "#16a34a" }}>{req.passed || <span style={{ color: "#9ca3af" }}>0</span>}</td>
                          <td style={{ textAlign: "center", color: "#dc2626" }}>{req.failed || <span style={{ color: "#9ca3af" }}>0</span>}</td>
                          <td style={{ textAlign: "center", color: "#6b7280" }}>{req.untested}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button className="trc-details-btn" onClick={() => setDetailsReq((p) => p?.id === req.id ? null : req)}>Details</button>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button className="btn-icon" title="Unlink"
                              onClick={() => {
                                const updated = { ...rel, requirement_ids: linkedIds.filter((x) => x !== req.id) };
                                saveRelease(projectId, updated);
                                setReleases(loadReleasesForTrc(projectId));
                              }}>×</button>
                          </td>
                        </tr>
                        {isReqExpanded && (
                          <tr>
                            <td colSpan={11} style={{ padding: 0, background: "var(--color-bg-soft)" }}>
                              <div style={{ padding: "6px 12px 10px 40px", display: "flex", flexDirection: "column", gap: 4 }}>
                                {req.test_cases.length === 0 ? (
                                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", fontStyle: "italic" }}>Нет привязанных тест-кейсов</div>
                                ) : req.test_cases.map((tc) => {
                                  const m = RESULT_STATUS_COLORS[tc.latest_status] ?? RESULT_STATUS_COLORS.untested;
                                  return (
                                    <div key={tc.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 6, background: "var(--color-bg)", border: "1px solid var(--color-border)", fontSize: 12 }}>
                                      <span style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: m.bg, color: m.color, flexShrink: 0 }}>
                                        {tc.latest_status.replace(/_/g, " ")}
                                      </span>
                                      <span style={{ color: "var(--color-text)", fontWeight: 500 }}>{tc.name}</span>
                                      {tc.suite_name && <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>— {tc.suite_name}</span>}
                                      {tc.defects.length > 0 && (
                                        <span style={{ marginLeft: "auto", color: "#dc2626", fontSize: 11, fontWeight: 600 }}>🐞 {tc.defects.length}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : linkingRelId !== rel.id ? (
              <div className="trc-rn-empty-rel">
                Нет привязанных требований.{" "}
                <button className="btn-link" onClick={() => openLink(rel)}>Привязать →</button>
              </div>
            ) : null}

            </>}
          </div>
        );
      })}
      {detailsReq && (
        <ReqDetailSidebar req={detailsReq} onClose={() => setDetailsReq(null)} />
      )}
    </div>
  );
}

// ── ReqDetailSidebar ──────────────────────────────────────────────────────────

function ReqDetailSidebar({ req, onClose }: { req: ReqTrace; onClose: () => void }) {
  const tm = TYPE_META[req.req_type ?? "requirement"] ?? TYPE_META.requirement;
  const sm = STATUS_META[req.status ?? "draft"] ?? STATUS_META.draft;
  const pm = { high: { color: "#dc2626", label: "High" }, medium: { color: "#ca8a04", label: "Medium" }, low: { color: "#6b7280", label: "Low" }, not_set: { color: "#9ca3af", label: "—" } };
  const pri = pm[req.priority as keyof typeof pm] ?? pm.not_set;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 600 }} onClick={onClose}>
      <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 460, background: "var(--color-bg)", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
          <div>
            {req.display_seq && <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>REQ-{req.display_seq}</div>}
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text)", lineHeight: 1.3, marginBottom: 8 }}>{req.title}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: tm.bg, color: tm.color }}>{tm.label}</span>
              <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: sm.bg, color: sm.color }}>{sm.label}</span>
              <span style={{ fontSize: 12, color: pri.color, fontWeight: 600 }}>Priority: {pri.label}</span>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18, marginLeft: 12, flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {req.description && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--color-text-muted)", letterSpacing: "0.05em", marginBottom: 6 }}>Description</div>
              <div style={{ fontSize: 13, color: "var(--color-text)", whiteSpace: "pre-wrap" }}>{req.description}</div>
            </div>
          )}
          {req.external_url && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--color-text-muted)", letterSpacing: "0.05em", marginBottom: 4 }}>Source / Jira</div>
              <a href={req.external_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "var(--color-accent)" }}>
                {req.external_id ?? req.external_url}
              </a>
            </div>
          )}
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--color-text-muted)", letterSpacing: "0.05em", marginBottom: 8 }}>Coverage</div>
            <div style={{ display: "flex", gap: 16 }}>
              {[{ l: "Cases", v: req.total_cases, c: "var(--color-text)" }, { l: "Passed", v: req.passed, c: "#16a34a" }, { l: "Failed", v: req.failed, c: "#dc2626" }, { l: "Untested", v: req.untested, c: "#9ca3af" }]
                .map(({ l, v, c }) => (
                  <div key={l} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{l}</div>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--color-text-muted)", letterSpacing: "0.05em", marginBottom: 8 }}>Author</div>
            <div style={{ fontSize: 13, color: "var(--color-text)" }}>Demo User</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SourcesTab ────────────────────────────────────────────────────────────────

function SourcesTab({ data }: { data: ReqTrace[] }) {
  const withSource = data.filter((r) => r.external_url || r.external_id || r.source);
  const withoutSource = data.filter((r) => !r.external_url && !r.external_id && !r.source);

  const grouped = useMemo(() => {
    const m = new Map<string, ReqTrace[]>();
    for (const r of withSource) {
      const key = r.external_url
        ? (() => { try { return new URL(r.external_url).hostname; } catch { return r.external_url; } })()
        : r.source ?? "Other";
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  }, [withSource]);

  if (withSource.length === 0) {
    return (
      <div className="trc-empty" style={{ marginTop: 40 }}>
        <div className="trc-empty-icon">🔗</div>
        <p>Нет требований с привязанным внешним источником (Jira, Confluence и т.д.).<br/>
          Добавьте Source URL при создании или редактировании требования.</p>
      </div>
    );
  }

  return (
    <div className="trc-src-tab">
      {Array.from(grouped.entries()).map(([source, reqs]) => (
        <div key={source} className="trc-src-group">
          <div className="trc-src-group-header">
            <span className="trc-src-domain">🔗 {source}</span>
            <span className="trc-src-count">{reqs.length} требований</span>
          </div>
          <table className="trc-rn-table">
            <thead>
              <tr>
                <th>Ticket / ID</th>
                <th>Requirement</th>
                <th>Type</th>
                <th>Status</th>
                <th>Coverage</th>
                <th>Cases</th>
              </tr>
            </thead>
            <tbody>
              {reqs.map((req) => {
                const tm = TYPE_META[req.req_type ?? "requirement"] ?? TYPE_META.requirement;
                const sm = STATUS_META[req.status ?? "draft"] ?? STATUS_META.draft;
                return (
                  <tr key={req.id}>
                    <td>
                      {req.external_url ? (
                        <a href={req.external_url} target="_blank" rel="noopener noreferrer" className="trc2-source-link">
                          {req.external_id ?? "Link ↗"}
                        </a>
                      ) : (
                        <span className="trc-muted">{req.external_id ?? "—"}</span>
                      )}
                    </td>
                    <td>
                      <span className="trc-type-chip" style={{ background: tm.bg, color: tm.color }}>{tm.icon}</span>
                      {" "}{req.title}
                    </td>
                    <td><span className="trc2-type-lbl" style={{ color: tm.color }}>{tm.label}</span></td>
                    <td><span className="trc-status-pill" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span></td>
                    <td>
                      <CoverageBar passed={req.passed} failed={req.failed} blocked={req.blocked} untested={req.untested} total={req.total_cases} />
                    </td>
                    <td style={{ textAlign: "center" }}>{req.total_cases}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {withoutSource.length > 0 && (
        <div className="trc-src-group">
          <div className="trc-src-group-header">
            <span className="trc-src-domain">📋 Without source</span>
            <span className="trc-src-count">{withoutSource.length} требований</span>
          </div>
          <div className="trc-rn-empty-rel" style={{ padding: "10px 16px", fontStyle: "italic" }}>
            {withoutSource.map((r) => r.title).join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
