import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { defectsApi, runsApi, releasesApi, DEFECT_ENVIRONMENTS, SEVERITY, type Defect, type DefectStatus, DEFECT_STATUS, type TestRun, type Release } from "../api/client";
import { generateDefectReportHTML } from "../utils/testProtocol";
import { absolutizeMedia, inlineMedia } from "../utils/media";
import { useToast } from "../components/Toast";
import "./DefectsPage.css";

// ── Test Run: связь хранится в БД (defects.test_run_id). Раньше лежала в
// localStorage `defectRun_<id>` — переносим такие связи на бэкенд один раз.
async function migrateLegacyRunLinks(defects: Defect[]): Promise<Defect[]> {
  const out = [...defects];
  for (let i = 0; i < out.length; i++) {
    const key = `defectRun_${out[i].id}`;
    let legacy: string | null = null;
    try { legacy = localStorage.getItem(key); } catch { /* ignore */ }
    if (!legacy) continue;
    try {
      if (!out[i].test_run_id) out[i] = await defectsApi.update(out[i].id, { test_run_id: legacy });
      localStorage.removeItem(key);
    } catch { /* прогон мог быть удалён — оставляем как есть */ }
  }
  return out;
}

const NO_RUN = "none";
const GROUP_KEY = "defects_group_by_run";
const COLLAPSED_KEY = "defects_collapsed_runs_";

const ENV_META: Record<string, { color: string; bg: string }> = {
  dev:  { color: "#1d4ed8", bg: "#dbeafe" },
  test: { color: "#92400e", bg: "#fef3c7" },
  prod: { color: "#15803d", bg: "#dcfce7" },
};

const STATUS_LABEL: Record<DefectStatus, string> = {
  open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed", reopened: "Reopened",
};

const SEV_CLS: Record<string, string> = {
  blocker: "sev-blocker", critical: "sev-critical", major: "sev-major",
  normal: "sev-normal", minor: "sev-minor", trivial: "sev-trivial",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function DefectsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [defects, setDefects] = useState<Defect[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [envFilter, setEnvFilter] = useState<string>("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [relMenuId, setRelMenuId] = useState<string | null>(null);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [runMenuId, setRunMenuId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [runFilter, setRunFilter] = useState<string>("");
  const [groupByRun, setGroupByRun] = useState<boolean>(() => {
    try { return localStorage.getItem(GROUP_KEY) === "1"; } catch { return false; }
  });
  const toggleGroup = () => setGroupByRun((v) => {
    try { localStorage.setItem(GROUP_KEY, v ? "0" : "1"); } catch { /* ignore */ }
    return !v;
  });

  // Свёрнутые группы (ключ = id прогона или NO_RUN), per-project в localStorage
  const [collapsedRuns, setCollapsedRuns] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { setCollapsedRuns(new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY + projectId) || "[]"))); }
    catch { setCollapsedRuns(new Set()); }
  }, [projectId]);
  const toggleRunGroup = (key: string) => setCollapsedRuns((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { localStorage.setItem(COLLAPSED_KEY + projectId, JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });

  const reload = () => {
    if (!projectId) return;
    setLoading(true);
    defectsApi.list(projectId, statusFilter || undefined)
      .then(migrateLegacyRunLinks)
      .then(setDefects)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(reload, [projectId, statusFilter]);

  useEffect(() => {
    if (projectId) releasesApi.list(projectId).then(setReleases).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (projectId) runsApi.list(projectId).then(setRuns).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!menuId && !relMenuId && !runMenuId && !exportMenuOpen) return;
    const close = () => { setMenuId(null); setRelMenuId(null); setRunMenuId(null); setExportMenuOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuId, relMenuId, runMenuId, exportMenuOpen]);

  const linkRun = async (d: Defect, runId: string | null) => {
    try {
      const upd = await defectsApi.update(d.id, { test_run_id: runId });
      setDefects((prev) => prev.map((x) => x.id === d.id ? upd : x));
    } catch { toast.error("Не удалось изменить прогон"); }
    setRunMenuId(null);
  };

  const buildTableRows = () => filtered.map((d) => ({
    id: d.display_id ?? "",
    title: d.title,
    severity: d.severity ?? "—",
    status: STATUS_LABEL[d.status as DefectStatus] ?? d.status,
    env: d.environment ?? "—",
    impact: d.impact ?? "—",
    run: d.test_run_name ?? "—",
    date: new Date(d.created_at).toLocaleDateString("ru-RU"),
    description: (d.description ?? "").replace(/\n/g, " "),
  }));

  const exportPdf = () => {
    const rows = buildTableRows();
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const trs = rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.title)}</td><td>${r.severity}</td><td>${r.status}</td><td>${r.env}</td><td>${r.impact}</td><td>${esc(r.run)}</td><td>${r.date}</td></tr>`).join("");
    const filtersDesc = [
      statusFilter && `Статус: ${STATUS_LABEL[statusFilter as DefectStatus] ?? statusFilter}`,
      runFilter && `Прогон: ${runFilter === NO_RUN ? "без прогона" : runs.find((r) => r.id === runFilter)?.name ?? runFilter}`,
      severityFilter && `Severity: ${severityFilter}`,
      envFilter && `Окружение: ${envFilter}`,
      search && `Поиск: ${search}`,
    ].filter(Boolean).join(" · ");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Дефекты — PDF</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;color:#111}
  h1{font-size:16px;margin:0 0 4px}
  .meta{font-size:11px;color:#666;margin-bottom:14px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #ccc;padding:5px 9px;text-align:left;vertical-align:top}
  th{background:#f0f0f0;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  tr:nth-child(even) td{background:#fafafa}
  @media print{@page{size:A4 landscape;margin:10mm}.no-print{display:none}}
</style></head>
<body>
<button class="no-print" onclick="window.print()" style="margin-bottom:12px;padding:6px 14px;font-size:12px;cursor:pointer">🖨 Сохранить как PDF</button>
<h1>Список дефектов (${rows.length})</h1>
${filtersDesc ? `<div class="meta">Фильтры: ${esc(filtersDesc)}</div>` : ""}
<table><thead><tr><th>ID</th><th>Заголовок</th><th>Severity</th><th>Статус</th><th>Окружение</th><th>Impact</th><th>Прогон</th><th>Создан</th></tr></thead>
<tbody>${trs}</tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    setExportMenuOpen(false);
  };

  const exportXlsx = () => {
    const cols = ["ID", "Заголовок", "Severity", "Статус", "Окружение", "Impact", "Прогон", "Создан", "Описание"];
    const rows = buildTableRows();
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const xmlRows = rows.map((r) =>
      `<Row>${[r.id, r.title, r.severity, r.status, r.env, r.impact, r.run, r.date, r.description]
        .map((v) => `<Cell><Data ss:Type="String">${esc(String(v))}</Data></Cell>`)
        .join("")}</Row>`
    ).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
  <Styles>
    <Style ss:ID="head"><Font ss:Bold="1"/><Interior ss:Color="#F0F0F0" ss:Pattern="Solid"/></Style>
  </Styles>
  <Worksheet ss:Name="Дефекты">
    <Table>
      <Row>${cols.map((h) => `<Cell ss:StyleID="head"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join("")}</Row>
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`;
    const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `defects_${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  };

  const exportCsv = () => {
    const headers = ["ID", "Заголовок", "Severity", "Статус", "Окружение", "Impact", "Прогон", "Создан", "Описание"];
    const rows = buildTableRows().map((r) =>
      [r.id, r.title, r.severity, r.status, r.env, r.impact, r.run, r.date, r.description]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
    );
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `defects_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  };

  const exportDefect = async (d: Defect, mode: "html" | "print") => {
    // скачанный HTML открывается без сервера — встраиваем файлы; для печати хватает абсолютных ссылок
    const attachments = mode === "html" ? await inlineMedia(d.attachments ?? []) : absolutizeMedia(d.attachments ?? []);
    const html = generateDefectReportHTML({
      id: d.id, display_id: d.display_id ?? undefined, display_seq: d.display_seq ?? undefined,
      title: d.title, severity: d.severity, status: d.status,
      environment: d.environment ?? null, impact: d.impact ?? null,
      description: d.description ?? null,
      steps_to_reproduce: d.steps_to_reproduce ?? null,
      expected_result: d.expected_result ?? null,
      actual_result: d.actual_result ?? null,
      tags: d.tags ?? null,
      created_at: d.created_at, updated_at: d.updated_at ?? null,
    }, attachments);
    if (mode === "html") {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `defect_${d.display_id ?? d.id.slice(0, 8)}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
    }
    setMenuId(null);
  };

  const remove = async (d: Defect) => {
    if (!confirm(`Удалить дефект «${d.title}»?`)) return;
    try { await defectsApi.delete(d.id); toast.success("Дефект удалён"); reload(); }
    catch { toast.error("Delete failed"); }
  };

  // Build map: defectId → release (using release_id from API response)
  const releaseMap = useMemo(() => {
    const m = new Map<string, Release | undefined>();
    for (const d of defects) {
      m.set(d.id, d.release_id ? releases.find((r) => r.id === d.release_id) : undefined);
    }
    return m;
  }, [defects, releases]);

  const filtered = useMemo(() => defects.filter((d) => {
    if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (severityFilter && d.severity !== severityFilter) return false;
    if (envFilter && (d.environment ?? "") !== envFilter) return false;
    if (runFilter === NO_RUN && d.test_run_id) return false;
    if (runFilter && runFilter !== NO_RUN && d.test_run_id !== runFilter) return false;
    return true;
  }), [defects, search, severityFilter, envFilter, runFilter]);

  // Прогоны, к которым привязан хотя бы один дефект — для фильтра (со счётчиками)
  const runCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of defects) if (d.test_run_id) m.set(d.test_run_id, (m.get(d.test_run_id) ?? 0) + 1);
    return m;
  }, [defects]);
  const unlinkedCount = defects.length - [...runCounts.values()].reduce((a, b) => a + b, 0);

  // Группы по прогону: порядок как в списке прогонов (свежие сверху), «без прогона» — в конце
  const groups = useMemo(() => {
    if (!groupByRun) return [{ key: "all", run: undefined as TestRun | undefined, title: "", items: filtered }];
    const byRun = new Map<string, Defect[]>();
    for (const d of filtered) {
      const k = d.test_run_id ?? NO_RUN;
      if (!byRun.has(k)) byRun.set(k, []);
      byRun.get(k)!.push(d);
    }
    const order = [...runs.map((r) => r.id), ...[...byRun.keys()].filter((k) => k !== NO_RUN && !runs.some((r) => r.id === k)), NO_RUN];
    return order.filter((k) => byRun.has(k)).map((k) => {
      const run = runs.find((r) => r.id === k);
      const items = byRun.get(k)!;
      return { key: k, run, title: k === NO_RUN ? "Без прогона" : run?.name ?? items[0].test_run_name ?? "Прогон", items };
    });
  }, [filtered, groupByRun, runs]);

  return (
    <div className="df-page">
      <div className="df-sticky-header">
      <div className="df-toolbar">
        <div className="df-toolbar-left">
          <button className="btn btn-primary" onClick={() => navigate(`/project/${projectId}/defects/new`)}>
            Create new defect
          </button>
          <input className="input df-search" placeholder="Search defects…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input df-filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {DEFECT_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="input df-filter-select" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            <option value="">All severities</option>
            {SEVERITY.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select className="input df-filter-select" value={envFilter} onChange={(e) => setEnvFilter(e.target.value)}>
            <option value="">All environments</option>
            {DEFECT_ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select className="input df-filter-select" value={runFilter} onChange={(e) => setRunFilter(e.target.value)} title="Фильтр по тестовому прогону">
            <option value="">All test runs</option>
            <option value={NO_RUN}>— Без прогона ({unlinkedCount})</option>
            {runs.filter((r) => runCounts.has(r.id)).map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({runCounts.get(r.id)})</option>
            ))}
          </select>
          <label className="df-group-toggle" title="Сгруппировать дефекты по тестовому прогону">
            <input type="checkbox" checked={groupByRun} onChange={toggleGroup} />
            Группировать по прогону
          </label>
          {(severityFilter || envFilter || runFilter || (statusFilter !== "")) && (
            <button className="btn-link" style={{ fontSize: 12 }} onClick={() => { setSeverityFilter(""); setEnvFilter(""); setStatusFilter(""); setRunFilter(""); }}>
              Сбросить
            </button>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button className="df-export-btn" onClick={() => setExportMenuOpen((v) => !v)}>
            ⬇ Export {filtered.length > 0 ? `(${filtered.length})` : ""}
          </button>
          {exportMenuOpen && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,.12)", zIndex: 300, minWidth: 160, overflow: "hidden" }}
              onClick={(e) => e.stopPropagation()}>
              {[
                { label: "📄 PDF (печать)", fn: exportPdf },
                { label: "📊 XLSX (Excel)", fn: exportXlsx },
                { label: "📋 CSV", fn: exportCsv },
              ].map(({ label, fn }) => (
                <button key={label}
                  style={{ display: "block", width: "100%", padding: "9px 14px", border: "none", background: "none", textAlign: "left", fontSize: 13, cursor: "pointer", color: "var(--color-text)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-soft)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  onClick={fn}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>{/* /df-sticky-header */}

      <div className="df-table-wrap">
        {loading ? (
          <div className="df-empty">Загружаем…</div>
        ) : filtered.length === 0 ? (
          <div className="df-empty">Дефектов нет. Создайте первый.</div>
        ) : (
          <table className="df-table">
            <thead>
              <tr className="df-thead-row">
                <th className="df-th df-th-id">ID</th>
                <th className="df-th">Defect</th>
                <th className="df-th">Severity</th>
                <th className="df-th">Environment</th>
                <th className="df-th">Impact</th>
                <th className="df-th">Assignee</th>
                <th className="df-th">Release</th>
                <th className="df-th">Test Run</th>
                <th className="df-th">Status</th>
                <th className="df-th df-th-menu"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => [
                groupByRun && (
                  <tr key={`grp-${g.key}`} className="df-group-row"
                    onClick={() => toggleRunGroup(g.key)}
                    title={collapsedRuns.has(g.key) ? "Развернуть" : "Свернуть"}>
                    <td colSpan={10} className="df-group-cell">
                      <span className={`df-group-icon${collapsedRuns.has(g.key) ? "" : " df-group-icon-open"}`}>▶</span>
                      <span className="df-group-title">{g.title}</span>
                      {g.run && (
                        <Link to={`/project/${projectId}/run/${g.run.id}`} className="df-group-link"
                          title="Открыть прогон" onClick={(e) => e.stopPropagation()}>↗</Link>
                      )}
                      <span className="df-group-count">{g.items.length}</span>
                      {g.items.some((d) => d.status === "open" || d.status === "reopened" || d.status === "in_progress") && (
                        <span className="df-group-open">
                          {g.items.filter((d) => d.status === "open" || d.status === "reopened" || d.status === "in_progress").length} open
                        </span>
                      )}
                    </td>
                  </tr>
                ),
                ...(groupByRun && collapsedRuns.has(g.key) ? [] : g.items).map((d) => (
                <tr key={d.id} className="df-tr">
                  <td className="df-td df-td-id">
                    <span className="df-id-badge">{d.display_id}</span>
                  </td>
                  <td className="df-td df-td-main">
                    <div className="df-defect-indicator" />
                    <div className="df-defect-info">
                      <Link to={`/project/${projectId}/defects/${d.id}`} className="df-defect-title">{d.title}</Link>
                      <div className="df-defect-meta">{d.display_id} · created {timeAgo(d.created_at)}</div>
                    </div>
                  </td>
                  <td className="df-td">
                    {d.severity && <span className={`df-sev-badge ${SEV_CLS[d.severity] ?? ""}`}>{d.severity.charAt(0).toUpperCase() + d.severity.slice(1)}</span>}
                  </td>
                  <td className="df-td">
                    {d.environment
                      ? <span className="df-env-badge">{d.environment}</span>
                      : <span style={{ color: "var(--color-text-subtle)" }}>—</span>}
                  </td>
                  <td className="df-td">
                    {d.impact
                      ? <span className={`df-impact-badge df-impact-${d.impact}`}>{d.impact}</span>
                      : <span style={{ color: "var(--color-text-subtle)" }}>—</span>}
                  </td>
                  <td className="df-td">—</td>
                  <td className="df-td df-td-release" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const rel = releaseMap.get(d.id);
                      const em = rel ? (ENV_META[rel.environment] ?? null) : null;
                      if (rel) {
                        return (
                          <div className="df-release-cell">
                            <span className="df-rel-name">{rel.name}</span>
                            <span className="df-rel-version">v{rel.version}</span>
                            {rel.environment && <span className="df-rel-env">{rel.environment.toUpperCase()}</span>}
                            <button className="df-rel-unlink" title="Unlink release"
                              onClick={async () => {
                                await defectsApi.update(d.id, { release_id: null });
                                setDefects((prev) => prev.map((x) => x.id === d.id ? { ...x, release_id: null } : x));
                              }}>×</button>
                          </div>
                        );
                      }
                      if (releases.length === 0) return <span style={{ color: "var(--color-text-subtle)" }}>—</span>;
                      return (
                        <div style={{ position: "relative" }}>
                          <button className="df-assign-rel-btn"
                            onClick={() => setRelMenuId((p) => p === d.id ? null : d.id)}>
                            + Link release
                          </button>
                          {relMenuId === d.id && (
                            <div className="df-rel-dropdown">
                              {releases.map((r) => (
                                <button key={r.id} className="df-rel-opt"
                                  onClick={async () => {
                                    await defectsApi.update(d.id, { release_id: r.id });
                                    setDefects((prev) => prev.map((x) => x.id === d.id ? { ...x, release_id: r.id } : x));
                                    setRelMenuId(null);
                                  }}>
                                  {r.name} <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>v{r.version} ({r.environment})</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  {/* Test Run column */}
                  <td className="df-td df-td-release" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      if (d.test_run_id) {
                        const runName = runs.find((r) => r.id === d.test_run_id)?.name ?? d.test_run_name ?? "Run";
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <Link to={`/project/${projectId}/run/${d.test_run_id}`} title={runName} style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent)", textDecoration: "none", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                              {runName}
                            </Link>
                            <button title="Unlink run" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-subtle)", fontSize: 14, padding: "0 2px" }}
                              onClick={() => linkRun(d, null)}>×</button>
                          </div>
                        );
                      }
                      if (runs.length === 0) return <span style={{ color: "var(--color-text-subtle)" }}>—</span>;
                      return (
                        <div style={{ position: "relative" }}>
                          <button className="df-assign-rel-btn"
                            onClick={() => setRunMenuId((p) => p === d.id ? null : d.id)}>
                            + Link run
                          </button>
                          {runMenuId === d.id && (
                            <div className="df-rel-dropdown">
                              {runs.slice(0, 20).map((r) => (
                                <button key={r.id} className="df-rel-opt"
                                  onClick={() => linkRun(d, r.id)}>
                                  {r.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="df-td">
                    <span className={`df-status-badge df-status-${d.status}`}>{STATUS_LABEL[d.status]}</span>
                  </td>
                  <td className="df-td df-td-menu" onClick={(e) => e.stopPropagation()}>
                    <button className="btn-icon" onClick={() => setMenuId((prev) => (prev === d.id ? null : d.id))}>⋯</button>
                    {menuId === d.id && (
                      <div className="df-dropdown">
                        <button className="df-dropdown-item" onClick={() => { navigate(`/project/${projectId}/defects/${d.id}`); setMenuId(null); }}>View</button>
                        <button className="df-dropdown-item" onClick={() => { navigate(`/project/${projectId}/defects/${d.id}/edit`); setMenuId(null); }}>Edit</button>
                        <div style={{ borderTop: "1px solid var(--color-border)", margin: "2px 0" }} />
                        <button className="df-dropdown-item" onClick={() => exportDefect(d, "html")}>⬇ Export HTML</button>
                        <button className="df-dropdown-item" onClick={() => exportDefect(d, "print")}>🖨 Печать отчёта</button>
                        <div style={{ borderTop: "1px solid var(--color-border)", margin: "2px 0" }} />
                        <button className="df-dropdown-item df-dropdown-item--danger" onClick={() => { remove(d); setMenuId(null); }}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))])}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
