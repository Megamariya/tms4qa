import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { runsApi, releasesApi, casesApi, suitesApi, type TestRun, type TestRunStats, type TestCase, type TestSuite, type Release } from "../api/client";
const ENV_META_RUN: Record<string, { color: string; bg: string }> = {
  dev:  { color: "#1d4ed8", bg: "#dbeafe" },
  test: { color: "#92400e", bg: "#fef3c7" },
  prod: { color: "#15803d", bg: "#dcfce7" },
};
import TestRunFormModal from "../components/TestRunFormModal";
import EditTestRunModal from "../components/EditTestRunModal";
import { useToast } from "../components/Toast";
import TransferImportModal from "../components/TransferImportModal";
import { exportRunBundle } from "../utils/transfer";
import { downloadProtocol, downloadAct } from "../utils/testProtocol";
import "./TestRunsPage.css";
import "./DefectsPage.css";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function fmtDuration(startedAt: string, completedAt?: string | null): string {
  if (!completedAt) return "—";
  try {
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 0) return "—";
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}с`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}м ${secs % 60}с`;
    return `${Math.floor(mins / 60)}ч ${mins % 60}м`;
  } catch { return "—"; }
}

function exportPDF(runs: TestRun[], statsMap: Record<string, TestRunStats>) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test Runs</title>
  <style>body{font-family:Arial,sans-serif;font-size:10px;margin:15px}h2{font-size:14px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}
  th{background:#f3f4f6;font-weight:600}@media print{@page{margin:10mm}}</style></head><body>
  <h2>Test Runs</h2><p style="font-size:11px;color:#666">Exported: ${new Date().toLocaleString()}</p>
  <table><thead><tr><th>Run</th><th>Status</th><th>Executor</th><th>Environment</th><th>Started At</th><th>Total</th><th>Passed</th><th>Failed</th></tr></thead>
  <tbody>${runs.map((r) => {
    const s = statsMap[r.id];
    return `<tr><td>${r.name}</td><td>${r.status}</td><td>${r.started_by_name ?? "—"}</td><td>${r.environment ?? "—"}</td>
    <td>${fmtDate(r.started_at)}</td><td>${s?.total ?? "—"}</td><td>${s?.passed ?? "—"}</td><td>${s?.failed ?? "—"}</td></tr>`;
  }).join("")}</tbody></table>
  <script>window.onload=()=>{window.print();}</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return; w.document.write(html); w.document.close();
}

function exportXLS(runs: TestRun[], statsMap: Record<string, TestRunStats>) {
  const rows = [
    ["Run", "Status", "Executor", "Environment", "Started At", "Total", "Passed", "Failed", "Blocked", "Not Executed"],
    ...runs.map((r) => {
      const s = statsMap[r.id];
      return [r.name, r.status, r.started_by_name ?? "", r.environment ?? "", fmtDate(r.started_at),
        s?.total ?? "", s?.passed ?? "", s?.failed ?? "", s?.blocked ?? "", s?.untested ?? ""];
    }),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `test_runs_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

const RUN_STATUSES = ["ready_to_start", "in_progress", "on_hold", "completed", "aborted"] as const;
const STATUS_LABELS: Record<string, string> = {
  ready_to_start: "Ready to Start",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  aborted: "Aborted",
};

const ALL_COLS = [
  { id: "id",        label: "ID" },
  { id: "title",     label: "Title" },
  { id: "status",    label: "Status" },
  { id: "started",   label: "Начало" },
  { id: "completed", label: "Завершение" },
  { id: "duration",  label: "Длительность" },
  { id: "executor",  label: "Исполнитель" },
  { id: "env",       label: "Environment" },
  { id: "device",    label: "Device / OS" },
  { id: "release",   label: "Release" },
  { id: "stats",     label: "Test run stats" },
] as const;
type ColId = (typeof ALL_COLS)[number]["id"];

type FilterSummary = { search?: string; statuses?: string[]; env?: string; release?: string; executor?: string; dateFrom?: string; dateTo?: string; hasFailures?: boolean; releaseName?: string };

function buildFilterSummaryHtml(f: FilterSummary): string {
  const parts: string[] = [];
  if (f.search) parts.push(`Search: "${f.search}"`);
  if (f.statuses?.length) parts.push(`Status: ${f.statuses.join(", ")}`);
  if (f.env) parts.push(`Environment: ${f.env}`);
  if (f.releaseName) parts.push(`Release: ${f.releaseName}`);
  if (f.executor) parts.push(`Executor: ${f.executor}`);
  if (f.dateFrom) parts.push(`From: ${f.dateFrom}`);
  if (f.dateTo) parts.push(`To: ${f.dateTo}`);
  if (f.hasFailures) parts.push(`Has failures: Yes`);
  if (!parts.length) return "";
  return `<p style="font-size:10px;color:#555;margin:6px 0 10px;padding:6px 8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px"><b>Active filters:</b> ${parts.join(" · ")}</p>`;
}

function buildFilterSummaryLines(f: FilterSummary): string[] {
  const parts: string[] = [];
  if (f.search) parts.push(`Search: "${f.search}"`);
  if (f.statuses?.length) parts.push(`Status: ${f.statuses.join(", ")}`);
  if (f.env) parts.push(`Environment: ${f.env}`);
  if (f.releaseName) parts.push(`Release: ${f.releaseName}`);
  if (f.executor) parts.push(`Executor: ${f.executor}`);
  if (f.dateFrom) parts.push(`Date from: ${f.dateFrom}`);
  if (f.dateTo) parts.push(`Date to: ${f.dateTo}`);
  if (f.hasFailures) parts.push(`Has failures: Yes`);
  return parts;
}

function exportPDFCols(runs: TestRun[], statsMap: Record<string, TestRunStats>, relMap: Map<string, Release | undefined>, cols: Set<ColId>, seqMap: Map<string, number>, filterInfo?: FilterSummary) {
  const headers: string[] = [];
  const colOrder: ColId[] = ALL_COLS.map(c => c.id) as ColId[];
  colOrder.filter(c => cols.has(c)).forEach(c => headers.push(ALL_COLS.find(x => x.id === c)!.label));
  const rows = runs.map((r) => {
    const s = statsMap[r.id];
    const rel = relMap.get(r.id);
    const cells: Record<ColId, string> = {
      id: `TR-${seqMap.get(r.id) ?? "?"}`, title: r.name, status: r.status,
      started: fmtDate(r.started_at), completed: fmtDate(r.completed_at),
      duration: fmtDuration(r.started_at, r.completed_at),
      executor: r.started_by_name ?? "—", env: r.environment ?? "—",
      device: [r.device_type, r.os, r.os_version].filter(Boolean).join(" · ") || "—",
      release: rel ? `${rel.name} v${rel.version}` : "—",
      stats: s ? `P:${s.passed} F:${s.failed} B:${s.blocked} U:${s.untested}` : "—",
    };
    return colOrder.filter(c => cols.has(c)).map(c => cells[c]);
  });
  const filterHtml = filterInfo ? buildFilterSummaryHtml(filterInfo) : "";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test Runs</title>
  <style>body{font-family:Arial,sans-serif;font-size:10px;margin:15px}table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f3f4f6;font-weight:600}
  @media print{@page{margin:10mm}}</style></head><body>
  <h2>Test Runs</h2><p style="font-size:11px;color:#666">Exported: ${new Date().toLocaleString()} · ${runs.length} run(s)</p>
  ${filterHtml}
  <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
  </table><script>window.onload=()=>{window.print();}</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return; w.document.write(html); w.document.close();
}

function exportXLSCols(runs: TestRun[], statsMap: Record<string, TestRunStats>, relMap: Map<string, Release | undefined>, cols: Set<ColId>, seqMap: Map<string, number>, filterInfo?: FilterSummary) {
  const colOrder: ColId[] = ALL_COLS.map(c => c.id) as ColId[];
  const visColDefs = ALL_COLS.filter(c => cols.has(c.id as ColId));
  const filterLines = filterInfo ? buildFilterSummaryLines(filterInfo) : [];
  const rows = [
    ...(filterLines.length ? [["Exported:", new Date().toLocaleString()], ["Filters:", filterLines.join(" · ")], []] : []),
    visColDefs.map(c => c.label),
    ...runs.map((r) => {
      const s = statsMap[r.id];
      const rel = relMap.get(r.id);
      const cells: Record<ColId, string> = {
        id: `TR-${seqMap.get(r.id) ?? "?"}`, title: r.name, status: r.status,
        started: fmtDate(r.started_at), completed: fmtDate(r.completed_at),
        duration: fmtDuration(r.started_at, r.completed_at),
        executor: r.started_by_name ?? "", env: r.environment ?? "",
        device: [r.device_type, r.os, r.os_version].filter(Boolean).join(" · "),
        release: rel ? `${rel.name} v${rel.version} (${rel.environment})` : "",
        stats: s ? `Total:${s.total} P:${s.passed} F:${s.failed} B:${s.blocked} U:${s.untested}` : "",
      };
      return colOrder.filter(c => cols.has(c)).map(c => cells[c]);
    }),
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `test_runs_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TestRunsPage() {
  const { projectId } = useParams();
  const toast = useToast();
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, TestRunStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuRunId, setMenuRunId] = useState<string | null>(null);
  const [editRun, setEditRun] = useState<TestRun | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const navigate = useNavigate();
  const [releases, setReleases] = useState<Release[]>([]);
  const [relMenuId, setRelMenuId] = useState<string | null>(null);
  const [colsOpen, setColsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<ColId>>(new Set(ALL_COLS.map(c => c.id as ColId)));

  // Bulk selection
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());

  // Sort
  type RunSortCol = "id" | "started";
  const [runSort, setRunSort] = useState<{ col: RunSortCol; dir: "asc" | "desc" }>({ col: "started", dir: "desc" });

  const toggleRunSort = (col: RunSortCol) => {
    setRunSort((prev) => prev.col === col
      ? { col, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { col, dir: "asc" });
  };

  const runSortIcon = (col: RunSortCol) => {
    if (runSort.col !== col) return " ⇅";
    return runSort.dir === "asc" ? " ↑" : " ↓";
  };

  // Filter state
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterEnv, setFilterEnv] = useState("");
  const [filterRelease, setFilterRelease] = useState("");
  const [filterExecutor, setFilterExecutor] = useState("");
  const [filterHasFailures, setFilterHasFailures] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const reload = async () => {
    if (!projectId) return;
    setSelectedRunIds(new Set());
    setLoading(true); setError(null);
    try {
      const list = await runsApi.list(projectId);
      setRuns(list);
      const entries = await Promise.all(
        list.map(async (r) => {
          try { return [r.id, await runsApi.stats(r.id)] as const; }
          catch { return [r.id, null] as const; }
        })
      );
      const m: Record<string, TestRunStats> = {};
      for (const [id, s] of entries) if (s) m[id] = s;
      setStatsMap(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [projectId]);

  useEffect(() => {
    if (projectId) releasesApi.list(projectId).then(setReleases).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!menuRunId && !exportOpen && !relMenuId && !colsOpen) return;
    const close = () => { setMenuRunId(null); setExportOpen(false); setRelMenuId(null); setColsOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuRunId, exportOpen, relMenuId, colsOpen]);

  // Build map: runId → release (using run.release_id from API)
  const runReleaseMap = useMemo(() => {
    const m = new Map<string, Release | undefined>();
    for (const r of runs) {
      m.set(r.id, r.release_id ? releases.find((rel) => rel.id === r.release_id) : undefined);
    }
    return m;
  }, [runs, releases]);

  // Config: allow editing/deleting non-completed runs
  const allowEditActive = localStorage.getItem("cfg_run_allow_edit_active") === "true";
  const canModifyRun = (r: TestRun) => {
    if (r.status === "in_progress") return false; // always locked while running
    return r.status === "completed" || allowEditActive;
  };

  const remove = async (r: TestRun) => {
    if (!canModifyRun(r)) {
      toast.error("Нельзя удалить незавершённый прогон. Разрешите это в Configurations → Test Runs.");
      return;
    }
    if (!confirm(`Удалить прогон «${r.name}»?`)) return;
    try { await runsApi.delete(r.id); toast.success("Прогон удалён"); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Delete failed"); }
  };

  const environments = useMemo(() => {
    const set = new Set(runs.map((r) => r.environment).filter(Boolean) as string[]);
    return Array.from(set);
  }, [runs]);

  const filtered = useMemo(() => runs.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus.length > 0 && !filterStatus.includes(r.status)) return false;
    if (filterEnv && r.environment !== filterEnv) return false;
    if (filterRelease && r.release_id !== filterRelease) return false;
    if (filterExecutor && !(r.started_by_name ?? "").toLowerCase().includes(filterExecutor.toLowerCase())) return false;
    if (filterHasFailures) {
      const s = statsMap[r.id];
      if (!s || s.failed === 0) return false;
    }
    if (dateFrom && r.started_at < dateFrom) return false;
    if (dateTo && r.started_at.slice(0, 10) > dateTo) return false;
    return true;
  }), [runs, search, filterStatus, filterEnv, filterRelease, filterExecutor, filterHasFailures, dateFrom, dateTo, statsMap]);

  const activeFilters = filterStatus.length + (filterEnv ? 1 : 0) + (filterRelease ? 1 : 0) + (filterExecutor ? 1 : 0) + (filterHasFailures ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);
  const clearFilters = () => { setFilterStatus([]); setFilterEnv(""); setFilterRelease(""); setFilterExecutor(""); setFilterHasFailures(false); setDateFrom(""); setDateTo(""); };

  // Stable sequential numbers sorted by started_at ascending → TR-1, TR-2 …
  const runSeqMap = useMemo(() => {
    const s = [...runs].sort((a, b) => a.started_at.localeCompare(b.started_at));
    const m = new Map<string, number>();
    s.forEach((r, i) => m.set(r.id, i + 1));
    return m;
  }, [runs]);

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (runSort.col === "id") {
        cmp = (runSeqMap.get(a.id) ?? 0) - (runSeqMap.get(b.id) ?? 0);
      } else {
        cmp = (a.started_at ?? "").localeCompare(b.started_at ?? "");
      }
      return runSort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, runSort, runSeqMap]);

  const bulkRemove = async () => {
    if (selectedRunIds.size === 0) return;
    const nonDeletable = filtered.filter((r) => selectedRunIds.has(r.id) && !canModifyRun(r));
    if (nonDeletable.length > 0) {
      toast.error(`${nonDeletable.length} прогон(ов) нельзя удалить — незавершены. Разрешите в Configurations.`);
      return;
    }
    if (!confirm(`Удалить ${selectedRunIds.size} прогон(ов)?`)) return;
    const ids = Array.from(selectedRunIds);
    let errors = 0;
    for (const id of ids) {
      try { await runsApi.delete(id); }
      catch { errors++; }
    }
    if (errors > 0) toast.error(`${errors} ошибок при удалении`);
    else toast.success(`Удалено ${ids.length} прогон(ов)`);
    reload();
  };

  const fetchRunData = async (r: TestRun) => {
    const [results, cases, suites] = await Promise.all([
      runsApi.results(r.id),
      casesApi.list(r.project_id),
      suitesApi.list(r.project_id),
    ]);
    const casesMap: Record<string, TestCase> = {};
    for (const c of cases) casesMap[c.id] = c;
    return { results, casesMap, suites: suites as TestSuite[] };
  };

  const handleDownloadProtocol = async (r: TestRun) => {
    try {
      const { results, casesMap, suites } = await fetchRunData(r);
      downloadProtocol(r, results, casesMap, suites);
    } catch { toast.error("Ошибка генерации протокола"); }
  };

  const exportRun = async (r: TestRun) => {
    try { await exportRunBundle(r.id, r.name); toast.success(`Прогон «${r.name}» выгружен`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Export failed"); }
  };

  const handleDownloadAct = async (r: TestRun) => {
    try {
      const { results, casesMap, suites } = await fetchRunData(r);
      downloadAct(r, results, casesMap, suites);
    } catch { toast.error("Ошибка генерации акта"); }
  };

  const toggleStatus = (s: string) =>
    setFilterStatus((p) => p.includes(s) ? p.filter((v) => v !== s) : [...p, s]);

  const filterInfo: FilterSummary = {
    search: search || undefined,
    statuses: filterStatus.length ? filterStatus : undefined,
    env: filterEnv || undefined,
    release: filterRelease || undefined,
    releaseName: filterRelease ? releases.find(r => r.id === filterRelease)?.name : undefined,
    executor: filterExecutor || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    hasFailures: filterHasFailures || undefined,
  };

  return (
    <div className="page tr-page">
      {/* ── Sticky top ── */}
      <div className="tr-page-sticky">
      {/* ── Page Header ── */}
      <div className="tr-page-header">
        <div className="tr-page-title-col">
          <h1 className="page-title">Test Runs</h1>
          <span className="tr-count-badge">{runs.length} прогон{runs.length % 10 === 1 && runs.length % 100 !== 11 ? "" : runs.length % 10 >= 2 && runs.length % 10 <= 4 && (runs.length % 100 < 10 || runs.length % 100 >= 20) ? "а" : "ов"}</span>
        </div>
        <div className="tr-toolbar">
          <input
            className="input tr-search"
            placeholder="Поиск прогонов…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="tr-filter-wrap" onClick={(e) => e.stopPropagation()}>
            <button
              className={`btn${activeFilters > 0 ? " tr-filter-active" : ""}`}
              onClick={() => setFilterOpen((v) => !v)}
            >
              🔍 Фильтр{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </button>
          </div>
          {activeFilters > 0 && (
            <button className="btn-link" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={clearFilters}>Сбросить</button>
          )}

          <div className="tr-cols-wrap" onClick={(e) => e.stopPropagation()}>
            <button className="btn" onClick={() => setColsOpen((v) => !v)}>
              ⚙ Столбцы ({visibleCols.size}/{ALL_COLS.length})
            </button>
            {colsOpen && (
              <div className="tr-cols-menu">
                <div className="tr-cols-title">Видимые столбцы</div>
                {ALL_COLS.map((col) => (
                  <label key={col.id} className="tr-cols-item">
                    <input type="checkbox"
                      checked={visibleCols.has(col.id as ColId)}
                      onChange={() => {
                        setVisibleCols((p) => {
                          const n = new Set(p);
                          n.has(col.id as ColId) ? n.delete(col.id as ColId) : n.add(col.id as ColId);
                          return n;
                        });
                      }}
                    />
                    <span>{col.label}</span>
                  </label>
                ))}
                <button className="tr-cols-reset" onClick={() => setVisibleCols(new Set(ALL_COLS.map(c => c.id as ColId)))}>
                  Сбросить
                </button>
              </div>
            )}
          </div>

          <div className="tr-export-wrap" onClick={(e) => e.stopPropagation()}>
            <button className="btn" onClick={() => setExportOpen((v) => !v)}>Экспорт ▾</button>
            {exportOpen && (
              <div className="tr-export-menu">
                <button className="tr-export-item" onClick={() => { exportPDFCols(sortedFiltered, statsMap, runReleaseMap, visibleCols, runSeqMap, filterInfo); setExportOpen(false); }}>🖨 Экспорт PDF</button>
                <button className="tr-export-item" onClick={() => { exportXLSCols(sortedFiltered, statsMap, runReleaseMap, visibleCols, runSeqMap, filterInfo); setExportOpen(false); }}>📊 Экспорт CSV/Excel</button>
              </div>
            )}
          </div>

          <button className="btn" title="Импорт прогона из файла переноса TMS4QA" onClick={() => setImportOpen(true)}>⬆ Импорт</button>
          <button className="btn btn-primary" onClick={() => setFormOpen(true)}>+ Новый прогон</button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      {filterOpen && (
        <div className="tr-filter-panel">
          <div className="tr-fp-section">
            <div className="tr-fp-label">Статус</div>
            <div className="tr-fp-checks">
              {RUN_STATUSES.map((s) => (
                <label key={s} className="tr-fp-item">
                  <input type="checkbox" checked={filterStatus.includes(s)} onChange={() => toggleStatus(s)} />
                  <span>{STATUS_LABELS[s] ?? s}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="tr-fp-section">
            <div className="tr-fp-label">Среда</div>
            <select className="input" style={{ width: 160, fontSize: 12 }}
              value={filterEnv} onChange={(e) => setFilterEnv(e.target.value)}>
              <option value="">Все среды</option>
              {environments.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div className="tr-fp-section">
            <div className="tr-fp-label">Начало от</div>
            <input className="input" type="date" style={{ width: 140, fontSize: 12 }}
              value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="tr-fp-section">
            <div className="tr-fp-label">Начало до</div>
            <input className="input" type="date" style={{ width: 140, fontSize: 12 }}
              value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="tr-fp-section">
            <div className="tr-fp-label">Релиз</div>
            <select className="input" style={{ width: 180, fontSize: 12 }}
              value={filterRelease} onChange={(e) => setFilterRelease(e.target.value)}>
              <option value="">Все релизы</option>
              {releases.map((r) => <option key={r.id} value={r.id}>{r.name} v{r.version}</option>)}
            </select>
          </div>
          <div className="tr-fp-section">
            <div className="tr-fp-label">Исполнитель</div>
            <input className="input" style={{ width: 160, fontSize: 12 }}
              placeholder="Имя исполнителя…"
              value={filterExecutor} onChange={(e) => setFilterExecutor(e.target.value)} />
          </div>
          <div className="tr-fp-section">
            <div className="tr-fp-label">Результат</div>
            <label className="tr-fp-item">
              <input type="checkbox" checked={filterHasFailures} onChange={(e) => setFilterHasFailures(e.target.checked)} />
              <span>Есть Failed</span>
            </label>
          </div>
          <button className="tr-fp-close" onClick={() => setFilterOpen(false)}>✕</button>
        </div>
      )}

      {selectedRunIds.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 24px", background: "var(--color-accent-soft)", borderBottom: "1px solid var(--color-accent)" }}>
          <span style={{ fontSize: 13, color: "var(--color-accent)", fontWeight: 600 }}>
            Выбрано: {selectedRunIds.size}
          </span>
          <button
            className="btn"
            style={{ fontSize: 12, color: "#dc2626", borderColor: "#dc2626" }}
            onClick={bulkRemove}
          >
            🗑 Удалить выбранные тест-раны
          </button>
          <button
            className="btn"
            style={{ fontSize: 12 }}
            onClick={() => setSelectedRunIds(new Set())}
          >
            Снять выделение
          </button>
        </div>
      )}

      {error && <div className="page-banner">⚠ {error}</div>}
      </div>
      {/* ── End sticky top ── */}

      {/* ── Scrollable table ── */}
      <div className="tr-table-scroll">
      {/* computed colSpan for empty rows */}
      {(() => {
        const vc = visibleCols;
        const colSpan = 2 + vc.size; // checkbox + visible cols + menu
        return (
      <table className="table runs-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                checked={sortedFiltered.length > 0 && sortedFiltered.every((r) => selectedRunIds.has(r.id))}
                onChange={(e) => setSelectedRunIds(e.target.checked ? new Set(sortedFiltered.map((r) => r.id)) : new Set())}
                title="Выбрать все"
              />
            </th>
            {vc.has("id")        && <th style={{ width: 80, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }} onClick={() => toggleRunSort("id")}>ID{runSortIcon("id")}</th>}
            {vc.has("title")     && <th>Title</th>}
            {vc.has("status")    && <th style={{ width: 110 }}>Status</th>}
            {vc.has("started")   && <th style={{ width: 130, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }} onClick={() => toggleRunSort("started")}>Начало{runSortIcon("started")}</th>}
            {vc.has("completed") && <th style={{ width: 130 }}>Завершение</th>}
            {vc.has("duration")  && <th style={{ width: 90 }}>Длительность</th>}
            {vc.has("executor")  && <th style={{ width: 130 }}>Исполнитель</th>}
            {vc.has("env")       && <th style={{ width: 120 }}>Environment</th>}
            {vc.has("device")    && <th style={{ width: 150 }}>Device / OS</th>}
            {vc.has("release")   && <th style={{ width: 140 }}>Release</th>}
            {vc.has("stats")     && <th style={{ width: 220 }}>Test run stats</th>}
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={colSpan} style={{ textAlign: "center", padding: 40 }}>Загружаем…</td></tr>
          ) : sortedFiltered.length === 0 ? (
            <tr><td colSpan={colSpan} style={{ textAlign: "center", padding: 40 }}>
              {runs.length === 0 ? "Прогонов пока нет — нажми «Start new test run»." : "Ничего не найдено."}
            </td></tr>
          ) : (
            sortedFiltered.map((r) => {
              const stats = statsMap[r.id];
              const seq = runSeqMap.get(r.id);
              return (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedRunIds.has(r.id)}
                      onChange={(e) => {
                        setSelectedRunIds((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(r.id) : next.delete(r.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  {vc.has("id")     && <td><span className="run-id-badge">TR-{seq ?? "?"}</span></td>}
                  {vc.has("title")  && <td><Link to={`/project/${projectId}/run/${r.id}`}><strong>{r.name}</strong></Link></td>}
                  {vc.has("status") && <td><RunStatusBadge status={r.status} /></td>}
                  {vc.has("started")   && <td style={{ whiteSpace: "nowrap", fontSize: 12, color: "var(--color-text-muted)" }}>{fmtDate(r.started_at)}</td>}
                  {vc.has("completed") && <td style={{ whiteSpace: "nowrap", fontSize: 12, color: "var(--color-text-muted)" }}>{fmtDate(r.completed_at)}</td>}
                  {vc.has("duration")  && <td style={{ fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{fmtDuration(r.started_at, r.completed_at)}</td>}
                  {vc.has("executor")  && <td><UserCell name={r.started_by_name} /></td>}
                  {vc.has("env")    && <td style={{ fontSize: 12 }}>{r.environment || <span style={{ color: "var(--color-text-subtle)" }}>—</span>}</td>}
                  {vc.has("device") && (
                    <td style={{ fontSize: 12 }}>
                      {r.device_type ? (
                        <div>
                          <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{r.device_type}</span>
                          {r.os && <span style={{ color: "var(--color-text-muted)" }}> · {r.os}</span>}
                          {r.os_version && <div style={{ color: "var(--color-text-subtle)", fontSize: 11 }}>{r.os_version}</div>}
                        </div>
                      ) : <span style={{ color: "var(--color-text-subtle)" }}>—</span>}
                    </td>
                  )}
                  {vc.has("release") && (
                  <td style={{ position: "relative", overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const rel = runReleaseMap.get(r.id);
                      const em = rel ? (ENV_META_RUN[rel.environment] ?? null) : null;
                      if (rel) {
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, fontSize: 12 }}>{rel.name}</span>
                            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>v{rel.version}</span>
                            {em && <span style={{ background: em.bg, color: em.color, padding: "1px 6px", borderRadius: 99, fontSize: 10, fontWeight: 700 }}>{rel.environment.toUpperCase()}</span>}
                            <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-subtle)", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                              onClick={async () => {
                                await runsApi.update(r.id, { release_id: null });
                                setRuns((prev) => prev.map((x) => x.id === r.id ? { ...x, release_id: null } : x));
                              }}>×</button>
                          </div>
                        );
                      }
                      if (releases.length === 0) return <span style={{ color: "var(--color-text-subtle)" }}>—</span>;
                      return (
                        <div style={{ position: "relative" }}>
                          <button className="df-assign-rel-btn"
                            onClick={() => setRelMenuId((p) => p === r.id ? null : r.id)}>
                            + Link release
                          </button>
                          {relMenuId === r.id && (
                            <div className="df-rel-dropdown">
                              {releases.map((rel) => (
                                <button key={rel.id} className="df-rel-opt"
                                  onClick={async () => {
                                    await runsApi.update(r.id, { release_id: rel.id });
                                    setRuns((prev) => prev.map((x) => x.id === r.id ? { ...x, release_id: rel.id } : x));
                                    setRelMenuId(null);
                                  }}>
                                  {rel.name} <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>v{rel.version} ({rel.environment})</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  )}
                  {vc.has("stats") && <td>{stats ? <StatsBar stats={stats} /> : <span style={{ color: "var(--color-text-subtle)" }}>—</span>}</td>}
                  <td>
                    <div className="run-menu-wrap">
                      <button className="btn-icon"
                        onClick={(e) => { e.stopPropagation(); setMenuRunId(menuRunId === r.id ? null : r.id); }}
                        title="More">⋯</button>
                      {menuRunId === r.id && (
                        <div className="run-menu-dropdown">
                          <button
                            className={"run-menu-item" + (!canModifyRun(r) ? " run-menu-item--disabled" : "")}
                            disabled={!canModifyRun(r)}
                            title={!canModifyRun(r) ? "Прогон не завершён. Разрешите редактирование в Configurations." : undefined}
                            onClick={() => { if (canModifyRun(r)) { setEditRun(r); setMenuRunId(null); } }}
                          >Edit run</button>
                          <button
                            className={"run-menu-item run-menu-delete" + (!canModifyRun(r) ? " run-menu-item--disabled" : "")}
                            disabled={!canModifyRun(r)}
                            title={!canModifyRun(r) ? "Прогон не завершён. Разрешите удаление в Configurations." : undefined}
                            onClick={() => { remove(r); setMenuRunId(null); }}
                          >Delete</button>
                          <div className="run-menu-divider" />
                          <button className="run-menu-item" onClick={() => { handleDownloadProtocol(r); setMenuRunId(null); }}>📄 Скачать протокол тестирования</button>
                          <button className="run-menu-item" onClick={() => { handleDownloadAct(r); setMenuRunId(null); }}>📋 Выгрузить акт тестирования</button>
                          <div className="run-menu-divider" />
                          <button className="run-menu-item" title="JSON для импорта в TMS4QA на другом компьютере"
                            onClick={() => { exportRun(r); setMenuRunId(null); }}>⬇ Экспорт для переноса (JSON)</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
        );
      })()}

      </div>
      {/* ── End scrollable table ── */}

      {projectId && (
        <TestRunFormModal open={formOpen} projectId={projectId} onClose={() => setFormOpen(false)}
          onSaved={(r) => { toast.success(`Запущен: ${r.name}`); setFormOpen(false); reload(); }} />
      )}
      {projectId && editRun && (
        <EditTestRunModal open={!!editRun} run={editRun} projectId={projectId} onClose={() => setEditRun(null)}
          onSaved={() => { toast.success("Прогон обновлён"); setEditRun(null); reload(); }} />
      )}
      {projectId && (
        <TransferImportModal
          open={importOpen}
          kind="test_run"
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onImported={(id) => { setImportOpen(false); navigate(`/project/${projectId}/run/${id}`); }}
        />
      )}
    </div>
  );
}

function UserCell({ name }: { name?: string | null }) {
  if (!name) return <span style={{ color: "var(--color-text-subtle)" }}>—</span>;
  return (
    <span className="run-author">
      <span className="run-author-avatar">{name[0].toUpperCase()}</span>
      {name}
    </span>
  );
}

function RunStatusBadge({ status }: { status: TestRun["status"] }) {
  const map: Record<string, { cls: string; label: string }> = {
    ready_to_start: { cls: "badge-skipped",  label: "Ready to Start" },
    in_progress:    { cls: "badge-untested", label: "In Progress"    },
    on_hold:        { cls: "badge-blocked",  label: "On Hold"        },
    completed:      { cls: "badge-passed",   label: "Completed"      },
    aborted:        { cls: "badge-failed",   label: "Aborted"        },
  };
  const m = map[status] ?? { cls: "badge-untested", label: status };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function StatsBar({ stats }: { stats: TestRunStats }) {
  const { total, passed, failed, blocked, skipped, invalid, untested } = stats;
  const hasAny = total > 0;

  return (
    <div className="stats-bar">
      <div className="stats-bar-track">
        {!hasAny && <div className="stats-seg stats-seg-empty" style={{ flex: 1 }} />}
        {passed  > 0 && <div className="stats-seg stats-seg-passed"   style={{ flex: passed   }} title={`Passed: ${passed}`}   />}
        {failed  > 0 && <div className="stats-seg stats-seg-failed"   style={{ flex: failed   }} title={`Failed: ${failed}`}   />}
        {blocked > 0 && <div className="stats-seg stats-seg-blocked"  style={{ flex: blocked  }} title={`Blocked: ${blocked}`} />}
        {skipped > 0 && <div className="stats-seg stats-seg-skipped"  style={{ flex: skipped  }} title={`Skipped: ${skipped}`} />}
        {invalid > 0 && <div className="stats-seg stats-seg-invalid"  style={{ flex: invalid  }} title={`Invalid: ${invalid}`} />}
        {untested> 0 && <div className="stats-seg stats-seg-untested" style={{ flex: untested }} title={`Not run: ${untested}`}/>}
      </div>
      <div className="stats-pills">
        {passed  > 0 && <span className="stats-pill stats-pill-passed" title="Passed">✓{passed}</span>}
        {failed  > 0 && <span className="stats-pill stats-pill-failed" title="Failed">✗{failed}</span>}
        {blocked > 0 && <span className="stats-pill stats-pill-blocked" title="Blocked">⊘{blocked}</span>}
        {untested> 0 && <span className="stats-pill stats-pill-untested" title="Not run">○{untested}</span>}
        {!hasAny    && <span className="stats-pill stats-pill-untested">No results</span>}
      </div>
    </div>
  );
}
