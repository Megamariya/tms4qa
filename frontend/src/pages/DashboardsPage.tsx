import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from "chart.js";
import { dashboardApi, requirementsApi, defectsApi, releasesApi, casesApi, runsApi, projectsApi, type DashboardData, type Project, type Release, type TestCase, type Requirement } from "../api/client";
import { calcRRS, loadRRSWeights, loadRRSThresholds, type RRSResult } from "../utils/releaseReadinessScore";
import "./DashboardsPage.css";

Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

// ── Widget config ─────────────────────────────────────────────────────────────
const WIDGET_KEYS = ["execution_summary", "failing_tests", "latest_run", "defect_density", "exec_quality", "defect_profile", "release_readiness", "case_by_req"] as const;
type WidgetKey = (typeof WIDGET_KEYS)[number];
type WidgetSize = "compact" | "normal" | "large";
const WIDGET_LABELS: Record<WidgetKey, string> = {
  execution_summary:  "Test Execution Summary",
  failing_tests:      "Failing Tests / Broken Areas",
  latest_run:         "Latest Run",
  defect_density:     "Defect Density",
  exec_quality:       "Executive Quality Board",
  defect_profile:     "Release Defect Profile",
  release_readiness:  "Release Readiness Score",
  case_by_req:        "Cases by Requirement",
};

const DEFAULT_VISIBILITY: Record<WidgetKey, boolean> = {
  execution_summary: true, failing_tests: true, latest_run: true,
  defect_density: true, exec_quality: true, defect_profile: true,
  release_readiness: true, case_by_req: true,
};

function loadVisibility(): Record<WidgetKey, boolean> {
  try { const v = localStorage.getItem("dash_widgets"); if (v) return { ...DEFAULT_VISIBILITY, ...JSON.parse(v) }; }
  catch { /* noop */ }
  return { ...DEFAULT_VISIBILITY };
}
function loadSize(): WidgetSize {
  return (localStorage.getItem("dash_size") as WidgetSize) ?? "normal";
}

const SIZE_COL: Record<WidgetSize, string> = {
  compact: "repeat(auto-fill, minmax(280px, 1fr))",
  normal:  "repeat(auto-fill, minmax(360px, 1fr))",
  large:   "1fr",
};

// ── Relative time ─────────────────────────────────────────────────────────────
function relTime(iso?: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DashboardsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<Record<WidgetKey, boolean>>(loadVisibility);
  const [widgetSize, setWidgetSize] = useState<WidgetSize>(loadSize);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Load projects list
  useEffect(() => {
    projectsApi.list().then((ps) => {
      setProjects(ps);
      if (ps.length > 0 && !projectId) setProjectId(ps[0].id);
    }).catch(() => {});
  }, []);

  // Load dashboard data when project changes
  useEffect(() => {
    if (!projectId) return;
    setLoading(true); setError(null); setData(null);
    dashboardApi.get(projectId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const toggleWidget = (k: WidgetKey) => {
    setWidgets((p) => {
      const next = { ...p, [k]: !p[k] };
      localStorage.setItem("dash_widgets", JSON.stringify(next));
      return next;
    });
  };

  const changeSize = (s: WidgetSize) => {
    setWidgetSize(s);
    localStorage.setItem("dash_size", s);
    setSettingsOpen(false);
  };

  const curProject = projects.find((p) => p.id === projectId);

  return (
    <div className="dash-page">
      <div className="dash-header">
        <div className="dash-header-left">
          <h1 className="dash-title">Dashboard</h1>
          {/* Project selector */}
          <div className="dash-project-select">
            <select className="input dash-project-dropdown" value={projectId}
              onChange={(e) => setProjectId(e.target.value)}>
              {projects.length === 0 && <option value="">— No projects —</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="dash-header-actions">
          {/* Widget size */}
          <div className="dash-size-btns">
            {(["compact", "normal", "large"] as WidgetSize[]).map((s) => (
              <button key={s} className={`dash-size-btn${widgetSize === s ? " active" : ""}`}
                title={`${s} widgets`} onClick={() => changeSize(s)}>
                {s === "compact" ? "▣▣▣" : s === "normal" ? "▣▣" : "▣"}
              </button>
            ))}
          </div>

          {/* Widget visibility */}
          <div className="dash-settings-wrap">
            <button className="btn btn-secondary" onClick={() => setSettingsOpen((v) => !v)}>
              ⚙ Configure widgets
            </button>
            {settingsOpen && (
              <div className="dash-settings-popup">
                <div className="dash-settings-title">Widgets</div>
                {WIDGET_KEYS.map((k) => (
                  <label key={k} className="dash-widget-toggle">
                    <input type="checkbox" checked={widgets[k]} onChange={() => toggleWidget(k)} />
                    <span>{WIDGET_LABELS[k]}</span>
                  </label>
                ))}
                <div className="dash-settings-title" style={{ marginTop: 8 }}>Size</div>
                {(["compact", "normal", "large"] as WidgetSize[]).map((s) => (
                  <label key={s} className="dash-widget-toggle">
                    <input type="radio" name="dash-size" checked={widgetSize === s} onChange={() => changeSize(s)} />
                    <span style={{ textTransform: "capitalize" }}>{s}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div className="page-banner">⚠ {error}</div>}
      {loading && <div className="dash-loading">Загружаем данные…</div>}
      {!projectId && !loading && <div className="dash-empty">Выберите проект для отображения дашборда.</div>}

      {!loading && data && projectId && (
        <div className="dash-grid" style={{ gridTemplateColumns: SIZE_COL[widgetSize] }}>
          {widgets.execution_summary && <ExecutionSummaryWidget data={data} projectId={projectId} />}
          {widgets.failing_tests     && <FailingTestsWidget     data={data} projectId={projectId} />}
          {widgets.latest_run        && <LatestRunWidget        data={data} projectId={projectId} />}
          {widgets.defect_density    && <DefectDensityWidget       projectId={projectId} />}
          {widgets.exec_quality      && <ExecQualityWidget         projectId={projectId} />}
          {widgets.defect_profile    && <ReleaseDefectProfileWidget projectId={projectId} />}
          {widgets.release_readiness && localStorage.getItem("cfg_rrs_enabled") !== "false" && (
            <ReleaseReadinessScoreWidget projectId={projectId} />
          )}
          {widgets.case_by_req && <CasesByRequirementWidget projectId={projectId} />}
        </div>
      )}

      {!loading && !data && !error && projectId && (
        <div className="dash-empty">Нет данных для отображения.</div>
      )}
    </div>
  );
}

// ── Widget action buttons (print / export) ────────────────────────────────────

function collectPageStyles(): string {
  const styles: string[] = [];
  document.querySelectorAll("style").forEach((s) => { if (s.textContent) styles.push(s.textContent); });
  return styles.join("\n");
}

function widgetToHtml(widgetEl: HTMLElement, title: string): string {
  const clone = widgetEl.cloneNode(true) as HTMLElement;
  // Replace canvas elements with their PNG snapshot
  const srcCanvases = widgetEl.querySelectorAll("canvas");
  const dstCanvases = clone.querySelectorAll("canvas");
  srcCanvases.forEach((canvas, i) => {
    try {
      const img = document.createElement("img");
      img.src = (canvas as HTMLCanvasElement).toDataURL("image/png");
      img.width = canvas.width; img.height = canvas.height;
      img.style.cssText = (canvas as HTMLElement).style.cssText;
      dstCanvases[i]?.parentNode?.replaceChild(img, dstCanvases[i]);
    } catch { /* ignore cross-origin issues */ }
  });
  // Remove action buttons from the cloned widget
  clone.querySelectorAll("[data-widget-actions]").forEach((el) => el.remove());
  const allStyles = collectPageStyles();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${allStyles}</style>
<style>body{background:#fff;padding:20px;margin:0}.dash-widget{max-width:700px;margin:0 auto;box-shadow:none!important;border:1px solid #e5e7eb;border-radius:8px;padding:16px}@media print{@page{margin:10mm}body{padding:0}}</style>
</head><body>${clone.outerHTML}</body></html>`;
}

function WidgetActions({ getHtml, widgetRef }: { getHtml: () => { html: string; title: string }; widgetRef?: React.RefObject<HTMLDivElement> }) {
  const openWindow = (autoprint: boolean) => {
    const { html, title } = getHtml();
    let pageHtml: string;
    if (widgetRef?.current) {
      pageHtml = widgetToHtml(widgetRef.current, title);
    } else {
      const allStyles = collectPageStyles();
      pageHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${allStyles}</style>
<style>body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e7eb;padding:5px 9px}th{background:#f9fafb}@media print{@page{margin:10mm}}</style>
</head><body>${html}</body></html>`;
    }
    if (autoprint) {
      pageHtml = pageHtml.replace("</body>", "<script>window.onload=()=>{window.focus();window.print();}<\/script></body>");
    }
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(pageHtml);
    w.document.close();
  };
  return (
    <div data-widget-actions style={{ display: "flex", gap: 2, alignItems: "center", marginLeft: 6 }}>
      <button
        title="Печать виджета"
        onClick={() => openWindow(true)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 5px", color: "var(--color-text-muted)", fontSize: 14, borderRadius: 4, lineHeight: 1 }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-soft)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >⎙</button>
      <button
        title="Экспорт в PDF"
        onClick={() => openWindow(false)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 5px", color: "var(--color-text-muted)", fontSize: 13, borderRadius: 4, lineHeight: 1 }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-soft)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >⬇</button>
    </div>
  );
}

// ── Widget 1: Execution Summary ───────────────────────────────────────────────
function ExecutionSummaryWidget({ data, projectId }: { data: DashboardData; projectId: string }) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const s = data.execution_summary;

  useEffect(() => {
    if (!chartRef.current) return;
    chartInst.current?.destroy();
    const counts = [s.passed, s.failed, s.blocked, s.skipped, s.untested];
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) return;
    chartInst.current = new Chart(chartRef.current, {
      type: "doughnut",
      data: {
        labels: ["Passed", "Failed", "Blocked", "Skipped", "Untested"],
        datasets: [{
          data: counts,
          backgroundColor: ["#16a34a", "#dc2626", "#ca8a04", "#6b7280", "#d1d5db"],
          borderWidth: 2, borderColor: "#fff",
        }],
      },
      options: {
        cutout: "68%",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.raw}` } },
        },
      },
    });
    return () => { chartInst.current?.destroy(); };
  }, [s]);

  const total = s.total;
  const pctPassed = total > 0 ? Math.round((s.passed / total) * 100) : 0;

  return (
    <div className="dash-widget" ref={widgetRef}>
      <div className="dash-widget-head">
        <span className="dash-widget-title">Test Execution Summary</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link to={`/project/${projectId}/runs`} className="dash-widget-link">View runs →</Link>
          <WidgetActions widgetRef={widgetRef} getHtml={() => ({
            title: "Test Execution Summary",
            html: `<h2>Test Execution Summary</h2>
<p class="meta">Pass Rate: <strong>${pctPassed}%</strong> · Total: ${total}</p>
<table><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>
<tr><td>✅ Passed</td><td>${s.passed}</td></tr>
<tr><td>❌ Failed</td><td>${s.failed}</td></tr>
<tr><td>⊘ Blocked</td><td>${s.blocked}</td></tr>
<tr><td>→ Skipped</td><td>${s.skipped}</td></tr>
<tr><td>○ Untested</td><td>${s.untested}</td></tr>
</tbody></table>`,
          })} />
        </div>
      </div>
      <div className="dash-exec-body">
        {total === 0 ? (
          <div className="dash-empty-widget">No test results yet</div>
        ) : (
          <>
            <div className="dash-donut-wrap">
              <canvas ref={chartRef} width={140} height={140} />
              <div className="dash-donut-center">
                <span className="dash-donut-pct">{pctPassed}%</span>
                <span className="dash-donut-lbl">passed</span>
              </div>
            </div>
            <div className="dash-legend">
              {[
                { label: "Passed",   count: s.passed,   color: "#16a34a" },
                { label: "Failed",   count: s.failed,   color: "#dc2626" },
                { label: "Blocked",  count: s.blocked,  color: "#ca8a04" },
                { label: "Skipped",  count: s.skipped,  color: "#6b7280" },
                { label: "Untested", count: s.untested, color: "#d1d5db" },
              ].map((item) => (
                <div key={item.label} className="dash-legend-item">
                  <span className="dash-legend-dot" style={{ background: item.color }} />
                  <span className="dash-legend-label">{item.label}</span>
                  <span className="dash-legend-count">{item.count}</span>
                </div>
              ))}
              <div className="dash-legend-item dash-legend-total">
                <span className="dash-legend-label">Total</span>
                <span className="dash-legend-count">{total}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Widget 2: Failing Tests ───────────────────────────────────────────────────
function FailingTestsWidget({ data, projectId }: { data: DashboardData; projectId: string }) {
  const failing = data.failing_tests;
  const widgetRef = useRef<HTMLDivElement>(null);

  // Group by suite
  const grouped: Record<string, typeof failing> = {};
  for (const t of failing) {
    const key = t.suite_name ?? "Without suite";
    (grouped[key] ||= []).push(t);
  }

  return (
    <div className="dash-widget" ref={widgetRef}>
      <div className="dash-widget-head">
        <span className="dash-widget-title">Failing Tests / Broken Areas</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="dash-failing-count">{failing.length} cases</span>
          <WidgetActions widgetRef={widgetRef} getHtml={() => ({
            title: "Failing Tests",
            html: `<h2>Failing Tests / Broken Areas</h2><p class="meta">${failing.length} failed cases</p>
<table><thead><tr><th>Test Case</th><th>Suite</th><th>Run</th></tr></thead><tbody>
${failing.map(f => `<tr><td>${f.case_name}</td><td>${f.suite_name ?? "—"}</td><td>${f.run_name}</td></tr>`).join("")}
</tbody></table>`,
          })} />
        </div>
      </div>
      {failing.length === 0 ? (
        <div className="dash-empty-widget">✅ No failing tests</div>
      ) : (
        <div className="dash-failing-body">
          {Object.entries(grouped).map(([suite, items]) => (
            <div key={suite} className="dash-group">
              <div className="dash-group-head">
                <span className="dash-group-name">📁 {suite}</span>
                <span className="dash-group-count">{items.length}</span>
              </div>
              {items.map((t) => (
                <div key={t.case_id} className="dash-fail-row">
                  <span className="dash-fail-status">✗</span>
                  <span className="dash-fail-name">{t.case_name}</span>
                  <span className="dash-fail-run">{t.run_name}</span>
                  <span className="dash-fail-time">{relTime(t.executed_at)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Widget 3: Latest Run ──────────────────────────────────────────────────────
function LatestRunWidget({ data, projectId }: { data: DashboardData; projectId: string }) {
  const run = data.latest_run;
  const widgetRef = useRef<HTMLDivElement>(null);

  return (
    <div className="dash-widget" ref={widgetRef}>
      <div className="dash-widget-head">
        <span className="dash-widget-title">Latest Run</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link to={`/project/${projectId}/runs`} className="dash-widget-link">All runs →</Link>
          <WidgetActions widgetRef={widgetRef} getHtml={() => ({
            title: "Latest Run",
            html: run ? `<h2>Latest Run</h2><p class="meta">${run.name} · ${run.status}</p>
<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
<tr><td>✅ Passed</td><td>${run.stats.passed}</td></tr>
<tr><td>❌ Failed</td><td>${run.stats.failed}</td></tr>
<tr><td>⊘ Blocked</td><td>${run.stats.blocked}</td></tr>
<tr><td>○ Untested</td><td>${run.stats.untested}</td></tr>
<tr><td>Total</td><td>${run.stats.total}</td></tr>
</tbody></table>` : "<h2>Latest Run</h2><p>No runs yet</p>",
          })} />
        </div>
      </div>
      {!run ? (
        <div className="dash-empty-widget">No runs yet</div>
      ) : (
        <div className="dash-latest-body">
          <div className="dash-latest-name">
            <Link to={`/project/${projectId}/run/${run.id}`} className="dash-run-link">{run.name}</Link>
            <span className={`dash-run-status dash-run-status-${run.status}`}>{run.status.replace(/_/g, " ")}</span>
          </div>
          <div className="dash-latest-meta">
            <span>👤 {run.started_by_name ?? "Unknown"}</span>
            <span>🕐 {relTime(run.started_at)}</span>
            <span>{new Date(run.started_at).toLocaleDateString("ru-RU")}</span>
          </div>
          <div className="dash-latest-stats">
            {[
              { label: "Total",   count: run.stats.total,   color: "#374151" },
              { label: "Passed",  count: run.stats.passed,  color: "#16a34a" },
              { label: "Failed",  count: run.stats.failed,  color: "#dc2626" },
              { label: "Blocked", count: run.stats.blocked, color: "#ca8a04" },
              { label: "Untested",count: run.stats.untested,color: "#9ca3af" },
            ].map((s) => (
              <div key={s.label} className="dash-stat-pill" style={{ borderColor: s.color + "40" }}>
                <span className="dash-stat-val" style={{ color: s.color }}>{s.count}</span>
                <span className="dash-stat-lbl">{s.label}</span>
              </div>
            ))}
          </div>
          {run.stats.total > 0 && (
            <div className="dash-latest-bar">
              <div className="dash-bar">
                {run.stats.passed  > 0 && <div className="dash-bar-seg passed"  style={{ width: `${(run.stats.passed/run.stats.total)*100}%` }} />}
                {run.stats.failed  > 0 && <div className="dash-bar-seg failed"  style={{ width: `${(run.stats.failed/run.stats.total)*100}%` }} />}
                {run.stats.blocked > 0 && <div className="dash-bar-seg blocked" style={{ width: `${(run.stats.blocked/run.stats.total)*100}%` }} />}
                {run.stats.untested> 0 && <div className="dash-bar-seg untested"style={{ width: `${(run.stats.untested/run.stats.total)*100}%` }} />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Widget 4: Defect Density ──────────────────────────────────────────────────
function DefectDensityWidget({ projectId }: { projectId: string }) {
  const [reqCount, setReqCount] = useState<number | null>(null);
  const [defectCount, setDefectCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      requirementsApi.list(projectId).catch(() => []),
      defectsApi.list(projectId).catch(() => []),
    ]).then(([reqs, defects]) => {
      setReqCount(reqs.length);
      setDefectCount(defects.length);
    }).finally(() => setLoading(false));
  }, [projectId]);

  const density = reqCount != null && reqCount > 0 && defectCount != null
    ? (defectCount / reqCount).toFixed(2)
    : null;
  const pct = reqCount && defectCount != null && reqCount > 0
    ? Math.min((defectCount / reqCount) * 25, 100) : 0;

  return (
    <div className="dash-widget" ref={widgetRef}>
      <div className="dash-widget-head">
        <span className="dash-widget-title">Defect Density</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Bugs per Requirement</span>
          <WidgetActions widgetRef={widgetRef} getHtml={() => ({
            title: "Defect Density",
            html: `<h2>Defect Density</h2>
<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
<tr><td>Total Defects</td><td>${defectCount ?? "—"}</td></tr>
<tr><td>Total Requirements</td><td>${reqCount ?? "—"}</td></tr>
<tr><td>Density (bugs/req)</td><td>${density ?? "N/A"}</td></tr>
</tbody></table>`,
          })} />
        </div>
      </div>
      {loading ? (
        <div className="dash-empty-widget">Загружаем…</div>
      ) : (
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 44, fontWeight: 700, color: (density && parseFloat(density) > 1) ? "#dc2626" : "#374151" }}>
              {density ?? "—"}
            </span>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>bugs / req</span>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>0</span>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>≥4</span>
            </div>
            <div style={{ height: 8, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 4, width: `${pct}%`,
                background: pct > 75 ? "#dc2626" : pct > 50 ? "#ca8a04" : "#16a34a",
                transition: "width 0.4s",
              }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1, padding: "8px 12px", background: "var(--color-bg-soft)", borderRadius: 6, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{defectCount ?? "—"}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>Total Defects</div>
            </div>
            <div style={{ flex: 1, padding: "8px 12px", background: "var(--color-bg-soft)", borderRadius: 6, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{reqCount ?? "—"}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>Requirements</div>
            </div>
          </div>
          {density !== null && (
            <div style={{ fontSize: 12, color: parseFloat(density) > 1 ? "#dc2626" : "#15803d", fontWeight: 500 }}>
              {parseFloat(density) === 0 ? "✅ No defects" :
               parseFloat(density) <= 0.5 ? "✅ Low density — good quality" :
               parseFloat(density) <= 1 ? "⚠ Moderate density" : "🔴 High density — review needed"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Widget 5: Executive Quality Dashboard ─────────────────────────────────────

type ReleaseLS = Release;

const RISK_META: Record<string, { label: string; color: string; bg: string }> = {
  low:      { label: "Low Risk",      color: "#15803d", bg: "#dcfce7" },
  medium:   { label: "Medium Risk",   color: "#ca8a04", bg: "#fef3c7" },
  high:     { label: "High Risk",     color: "#dc2626", bg: "#fee2e2" },
  critical: { label: "Critical Risk", color: "#7c3aed", bg: "#ede9fe" },
};

function ExecQualityWidget({ projectId }: { projectId: string }) {
  const [releases, setReleases] = useState<ReleaseLS[]>([]);
  const [selectedReleaseId, setSelectedReleaseId] = useState<string>("");
  const [traceData, setTraceData] = useState<import("../api/client").ReqTrace[]>([]);
  const [loading, setLoading] = useState(true);

  const [allDefects, setAllDefects] = useState<import("../api/client").Defect[]>([]);
  const [allCases, setAllCases] = useState<import("../api/client").TestCase[]>([]);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId) return;
    releasesApi.list(projectId).then(setReleases).catch(() => {});
    if (releases.length > 0) setSelectedReleaseId(releases[0].id);

    Promise.all([
      defectsApi.list(projectId),
      casesApi.list(projectId),
      requirementsApi.traceability(projectId),
    ]).then(([defs, cases, trace]) => {
      setAllDefects(defs);
      setAllCases(cases);
      setTraceData(trace);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  const selectedRelease = releases.find((r) => r.id === selectedReleaseId);

  const releaseTrace = selectedRelease
    ? traceData.filter((t) => selectedRelease.requirement_ids.includes(t.id))
    : [];

  // Case IDs linked to this release via requirements
  const releaseCaseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const req of releaseTrace) for (const tc of req.test_cases) ids.add(tc.id);
    return ids;
  }, [releaseTrace]);

  // Defects linked to this release via localStorage
  const releaseDefects = useMemo(() => {
    if (!selectedReleaseId) return allDefects;
    return allDefects.filter((d) => d.release_id === selectedReleaseId);
  }, [allDefects, selectedReleaseId]);

  // ── Derived metrics (all must be declared before use) ────────────────────

  const tcStats = {
    total:    releaseTrace.reduce((s, r) => s + r.total_cases, 0),
    passed:   releaseTrace.reduce((s, r) => s + r.passed, 0),
    failed:   releaseTrace.reduce((s, r) => s + r.failed, 0),
    untested: releaseTrace.reduce((s, r) => s + r.untested, 0),
  };

  // Requirements coverage
  const reqTotal   = releaseTrace.length;
  const reqCovered = releaseTrace.filter((r) => r.total_cases > 0).length;
  const reqCovPct  = reqTotal > 0 ? Math.round(reqCovered / reqTotal * 100) : 0;

  // Tests executed (non-untested)
  const testsExecuted = tcStats.total - tcStats.untested;
  const execPct = tcStats.total > 0 ? Math.round(testsExecuted / tcStats.total * 100) : 0;

  // Automation % for release cases (fallback to all cases)
  const releaseCases = allCases.filter((c) => releaseCaseIds.has(c.id));
  const automationPct = releaseCases.length > 0
    ? Math.round(releaseCases.filter((c) => c.automation_status === "automated").length / releaseCases.length * 100)
    : (allCases.length > 0 ? Math.round(allCases.filter((c) => c.automation_status === "automated").length / allCases.length * 100) : 0);

  // Open defects & bug breakdown
  const openDefects  = releaseDefects.filter((d) => d.status === "open" || d.status === "in_progress" || d.status === "reopened");
  const blockerBugs  = openDefects.filter((d) => d.severity === "blocker").length;
  const criticalBugs = openDefects.filter((d) => d.severity === "critical").length;
  const majorBugs    = openDefects.filter((d) => d.severity === "major").length;
  const critBugs     = blockerBugs + criticalBugs;
  const prodIncidents = openDefects.filter((d) => d.environment === "PROD" || d.tags?.includes("prod")).length;

  const riskLevel = (() => {
    if (critBugs >= 3 || prodIncidents >= 2) return "critical";
    if (critBugs >= 1 || prodIncidents >= 1) return "high";
    if (automationPct < 30) return "medium";
    return "low";
  })();
  const risk = RISK_META[riskLevel];

  const REL_STATUS: Record<string, { color: string; bg: string }> = {
    planned:     { color: "#6b7280", bg: "#f3f4f6" },
    in_progress: { color: "#1d4ed8", bg: "#dbeafe" },
    released:    { color: "#15803d", bg: "#dcfce7" },
    archived:    { color: "#9ca3af", bg: "#f9fafb" },
  };

  return (
    <div className="dash-widget" ref={widgetRef}>
      <div className="dash-widget-head">
        <span className="dash-widget-title">📊 Executive Quality Board</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {releases.length > 0 && (
            <select className="input" style={{ fontSize: 11, height: 26, padding: "2px 6px", maxWidth: 160 }}
              value={selectedReleaseId} onChange={(e) => setSelectedReleaseId(e.target.value)}>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>{r.name} {r.version} ({r.environment})</option>
              ))}
            </select>
          )}
          <WidgetActions widgetRef={widgetRef} getHtml={() => ({
            title: "Executive Quality Board",
            html: `<h2>📊 Executive Quality Board</h2>
<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
<tr><td>Critical Bugs (open)</td><td>${critBugs}</td></tr>
<tr><td>Prod Incidents</td><td>${prodIncidents}</td></tr>
<tr><td>Automation %</td><td>${automationPct}%</td></tr>
<tr><td>Release Risk</td><td>${risk.label}</td></tr>
</tbody></table>`,
          })} />
        </div>
      </div>
      {loading ? (
        <div className="dash-loading" style={{ fontSize: 13 }}>Загружаем…</div>
      ) : (
        <div className="eqd-grid" style={{ margin: "12px 16px" }}>
          {/* Release Status — wide */}
          <div className="eqd-card eqd-card--wide">
            <div className="eqd-card-label">🚀 Release Status</div>
            {selectedRelease ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{selectedRelease.name} {selectedRelease.version}</span>
                {selectedRelease.environment && (
                  <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 99, background: "#f3f4f6", color: "#374151" }}>
                    {selectedRelease.environment.toUpperCase()}
                  </span>
                )}
                {(() => { const m = REL_STATUS[selectedRelease.status] ?? REL_STATUS.planned;
                  return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: m.bg, color: m.color }}>{selectedRelease.status.replace(/_/g, " ")}</span>;
                })()}
                {selectedRelease.release_date && (
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>📅 {selectedRelease.release_date}</span>
                )}
              </div>
            ) : <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 4 }}>No releases</div>}
          </div>

          {/* Open Bugs — breakdown */}
          <div className="eqd-card">
            <div className="eqd-card-label">🐛 Open Bugs</div>
            <div className="eqd-bugs-breakdown">
              <div className="eqd-bug-row" style={{ color: blockerBugs > 0 ? "#b91c1c" : "var(--color-text-muted)" }}>
                <span className="eqd-bug-dot" style={{ background: "#dc2626" }} />
                <span className="eqd-bug-label">Blocker</span>
                <span className="eqd-bug-val">{blockerBugs}</span>
              </div>
              <div className="eqd-bug-row" style={{ color: criticalBugs > 0 ? "#c2410c" : "var(--color-text-muted)" }}>
                <span className="eqd-bug-dot" style={{ background: "#ea580c" }} />
                <span className="eqd-bug-label">Critical</span>
                <span className="eqd-bug-val">{criticalBugs}</span>
              </div>
              <div className="eqd-bug-row" style={{ color: majorBugs > 0 ? "#92400e" : "var(--color-text-muted)" }}>
                <span className="eqd-bug-dot" style={{ background: "#ca8a04" }} />
                <span className="eqd-bug-label">Major</span>
                <span className="eqd-bug-val">{majorBugs}</span>
              </div>
            </div>
            <div className="eqd-card-sub" style={{ marginTop: 6 }}>
              {critBugs === 0 ? "✅ No critical blockers" : `${critBugs} blocker/critical open`}
            </div>
          </div>

          {/* Prod Incidents */}
          <div className="eqd-card">
            <div className="eqd-card-label">🔴 Prod Incidents</div>
            <div className="eqd-card-num" style={{ color: prodIncidents > 0 ? "#dc2626" : "#16a34a" }}>{prodIncidents}</div>
            <div className="eqd-card-sub">{prodIncidents === 0 ? "No prod defects" : "Tagged PROD"}</div>
          </div>

          {/* Coverage: Requirements + Tests */}
          <div className="eqd-card">
            <div className="eqd-card-label">📊 Coverage</div>
            <div className="eqd-coverage-rows">
              <div className="eqd-cov-row">
                <span className="eqd-cov-icon">📋</span>
                <span className="eqd-cov-label">Requirements</span>
                <span className="eqd-cov-val">{reqCovered}/{reqTotal}</span>
                <span className="eqd-cov-pct" style={{ color: reqCovPct >= 80 ? "#16a34a" : reqCovPct >= 50 ? "#ca8a04" : "#dc2626" }}>
                  {reqCovPct}%
                </span>
              </div>
              <div className="eqd-cov-row">
                <span className="eqd-cov-icon">▶</span>
                <span className="eqd-cov-label">Tests executed</span>
                <span className="eqd-cov-val">{testsExecuted}/{tcStats.total}</span>
                <span className="eqd-cov-pct" style={{ color: execPct >= 80 ? "#16a34a" : execPct >= 50 ? "#ca8a04" : "#dc2626" }}>
                  {execPct}%
                </span>
              </div>
              <div className="eqd-cov-row">
                <span className="eqd-cov-icon">⚡</span>
                <span className="eqd-cov-label">Automated</span>
                <span className="eqd-cov-val" />
                <span className="eqd-cov-pct" style={{ color: automationPct >= 50 ? "#16a34a" : "#ca8a04" }}>
                  {automationPct}%
                </span>
              </div>
            </div>
          </div>

          {/* Test Cases Coverage — wide */}
          <div className="eqd-card eqd-card--wide">
            <div className="eqd-card-label">📋 Test Cases (release)</div>
            <div style={{ display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
              {[
                { label: "Total",    val: tcStats.total,    color: "var(--color-text)" },
                { label: "Passed",   val: tcStats.passed,   color: "#16a34a" },
                { label: "Failed",   val: tcStats.failed,   color: "#dc2626" },
                { label: "Untested", val: tcStats.untested, color: "#9ca3af" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>{val}</div>
                  <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{label}</div>
                </div>
              ))}
            </div>
            {tcStats.total > 0 && (
              <div style={{ marginTop: 8, height: 4, background: "var(--color-bg-soft)", borderRadius: 2, overflow: "hidden", display: "flex" }}>
                <div style={{ height: "100%", width: `${tcStats.passed / tcStats.total * 100}%`, background: "#16a34a" }} />
                <div style={{ height: "100%", width: `${tcStats.failed / tcStats.total * 100}%`, background: "#dc2626" }} />
                <div style={{ height: "100%", width: `${(tcStats.total - tcStats.passed - tcStats.failed - tcStats.untested) / tcStats.total * 100}%`, background: "#ca8a04" }} />
              </div>
            )}
          </div>

          {/* Release Risk */}
          <div className="eqd-card eqd-card--wide" style={{ background: risk.bg, borderColor: risk.color }}>
            <div className="eqd-card-label">⚠ Release Risk</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: risk.color, marginTop: 4 }}>{risk.label}</div>
            <div style={{ fontSize: 11, color: risk.color, marginTop: 3, opacity: 0.8 }}>
              {riskLevel === "low" ? "Ready for release" : riskLevel === "medium" ? "Monitor automation coverage" :
               riskLevel === "high" ? "Fix critical bugs before release" : "Release blocked — critical issues"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Widget 6: Release Defect Profile ─────────────────────────────────────────

const SEV_META: Record<string, { label: string; color: string; bg: string }> = {
  blocker:  { label: "Blocker",  color: "#b91c1c", bg: "#fee2e2" },
  critical: { label: "Critical", color: "#c2410c", bg: "#ffedd5" },
  major:    { label: "Major",    color: "#b45309", bg: "#fef3c7" },
  normal:   { label: "Normal",   color: "#4b5563", bg: "#f3f4f6" },
  minor:    { label: "Minor",    color: "#1e40af", bg: "#dbeafe" },
  trivial:  { label: "Trivial",  color: "#6b7280", bg: "#f9fafb" },
};
const SEV_ORDER = ["blocker", "critical", "major", "normal", "minor", "trivial"] as const;

function ReleaseDefectProfileWidget({ projectId }: { projectId: string }) {
  const [releases, setReleases] = useState<import("../api/client").Release[]>([]);
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const widgetRef = useRef<HTMLDivElement>(null);
  const [allDefects, setAllDefects] = useState<import("../api/client").Defect[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      releasesApi.list(projectId),
      defectsApi.list(projectId),
    ]).then(([rels, defs]) => {
      setReleases(rels);
      if (rels.length > 0) setSelectedReleaseId(rels[0].id);
      setAllDefects(defs);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  const releaseDefects = useMemo(() => {
    if (!selectedReleaseId) return allDefects;
    return allDefects.filter((d) => d.release_id === selectedReleaseId);
  }, [allDefects, selectedReleaseId]);

  const openDefs   = releaseDefects.filter((d) => d.status === "open" || d.status === "in_progress" || d.status === "reopened");
  const closedDefs = releaseDefects.filter((d) => d.status === "closed" || d.status === "resolved");
  const prodInc    = openDefs.filter((d) => d.environment === "PROD" || d.tags?.includes("prod")).length;
  const critBlock  = openDefs.filter((d) => d.severity === "blocker" || d.severity === "critical").length;
  const total      = releaseDefects.length;

  const sevCounts: Record<string, number> = {};
  for (const d of releaseDefects) sevCounts[d.severity] = (sevCounts[d.severity] ?? 0) + 1;
  const maxSev = Math.max(...Object.values(sevCounts), 1);

  return (
    <div className="dash-widget" ref={widgetRef}>
      <div className="dash-widget-head">
        <span className="dash-widget-title">🔍 Release Defect Profile</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {releases.length > 0 && (
            <select className="input" style={{ fontSize: 11, height: 26, padding: "2px 6px", maxWidth: 160 }}
              value={selectedReleaseId} onChange={(e) => setSelectedReleaseId(e.target.value)}>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>{r.name} v{r.version}</option>
              ))}
            </select>
          )}
          <WidgetActions widgetRef={widgetRef} getHtml={() => ({
            title: "Release Defect Profile",
            html: `<h2>🔍 Release Defect Profile</h2>
<p class="meta">Total: ${total} · Open: ${openDefs.length} · Closed: ${closedDefs.length}</p>
<table><thead><tr><th>Severity</th><th>Count</th></tr></thead><tbody>
${SEV_ORDER.map(sev => sevCounts[sev] ? `<tr><td>${sev}</td><td>${sevCounts[sev]}</td></tr>` : "").join("")}
</tbody></table>`,
          })} />
        </div>
      </div>
      {loading ? (
        <div className="dash-empty-widget">Загружаем…</div>
      ) : total === 0 ? (
        <div className="dash-empty-widget">✅ No defects for this release</div>
      ) : (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Open vs Closed */}
          <div className="rdp-summary">
            <div className="rdp-oc-card rdp-open">
              <div className="rdp-oc-num">{openDefs.length}</div>
              <div className="rdp-oc-lbl">Open</div>
            </div>
            <div className="rdp-oc-card rdp-closed">
              <div className="rdp-oc-num">{closedDefs.length}</div>
              <div className="rdp-oc-lbl">Closed</div>
            </div>
            <div className="rdp-oc-card rdp-prod">
              <div className="rdp-oc-num" style={{ color: prodInc > 0 ? "#dc2626" : "#16a34a" }}>{prodInc}</div>
              <div className="rdp-oc-lbl">Prod Incidents</div>
            </div>
            <div className="rdp-oc-card rdp-crit">
              <div className="rdp-oc-num" style={{ color: critBlock > 0 ? "#dc2626" : "#16a34a" }}>{critBlock}</div>
              <div className="rdp-oc-lbl">Critical Blockers</div>
            </div>
          </div>

          {/* Open/Closed bar */}
          {total > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4 }}>
                <span>Open {openDefs.length > 0 ? Math.round(openDefs.length / total * 100) : 0}%</span>
                <span>Closed {closedDefs.length > 0 ? Math.round(closedDefs.length / total * 100) : 0}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--color-bg-soft)", overflow: "hidden", display: "flex" }}>
                <div style={{ width: `${openDefs.length / total * 100}%`, background: "#dc2626", borderRadius: "4px 0 0 4px" }} />
                <div style={{ width: `${closedDefs.length / total * 100}%`, background: "#16a34a", borderRadius: "0 4px 4px 0" }} />
              </div>
            </div>
          )}

          {/* Severity distribution */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", marginBottom: 8 }}>
              Severity Distribution
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {SEV_ORDER.filter((s) => (sevCounts[s] ?? 0) > 0).map((sev) => {
                const count = sevCounts[sev] ?? 0;
                const meta = SEV_META[sev];
                return (
                  <div key={sev} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, width: 54, color: meta.color, flexShrink: 0 }}>{meta.label}</span>
                    <div style={{ flex: 1, height: 14, background: "var(--color-bg-soft)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${count / maxSev * 100}%`, background: meta.bg, border: `1px solid ${meta.color}30`, borderRadius: 3, transition: "width 0.4s", minWidth: count > 0 ? 4 : 0 }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, width: 20, textAlign: "right", flexShrink: 0 }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Widget 7: Release Readiness Score (Speedometer) ─────────────────────────

function Speedometer({ score, color }: { score: number; color: string }) {
  const r = 80, cx = 110, cy = 108;
  const halfCirc = Math.PI * r;
  const filled = halfCirc * score / 100;
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const theta = Math.PI * (1 - score / 100);
  const needleTipX = cx + (r - 8) * Math.cos(theta);
  const needleTipY = cy - (r - 8) * Math.sin(theta);
  return (
    <svg width="220" height="116" viewBox="0 0 220 116" style={{ overflow: "visible" }}>
      {/* Graduation ticks */}
      {[0, 25, 50, 75, 100].map((pct) => {
        const ang = Math.PI * (1 - pct / 100);
        const ox = cx + (r + 4) * Math.cos(ang), oy = cy - (r + 4) * Math.sin(ang);
        const ix = cx + (r - 2) * Math.cos(ang), iy = cy - (r - 2) * Math.sin(ang);
        const tx = cx + (r + 14) * Math.cos(ang), ty = cy - (r + 14) * Math.sin(ang);
        return (
          <g key={pct}>
            <line x1={ix} y1={iy} x2={ox} y2={oy} stroke="#cbd5e1" strokeWidth="2" />
            <text x={tx} y={ty} textAnchor="middle" fontSize="8" fill="#9ca3af" dominantBaseline="middle">{pct}</text>
          </g>
        );
      })}
      {/* Background arc */}
      <path d={arcPath} fill="none" stroke="#e2e8f0" strokeWidth="16" strokeLinecap="round" />
      {/* Colored zones */}
      {[
        { from: 0, to: 50, color: "#fee2e2" },
        { from: 50, to: 75, color: "#fef3c7" },
        { from: 75, to: 90, color: "#dcfce7" },
        { from: 90, to: 100, color: "#bbf7d0" },
      ].map((z) => {
        const f = halfCirc * z.from / 100, t = halfCirc * z.to / 100;
        return (
          <path key={z.from} d={arcPath} fill="none" stroke={z.color} strokeWidth="16" strokeLinecap="butt"
            strokeDasharray={`${t - f} ${halfCirc}`} strokeDashoffset={-f} />
        );
      })}
      {/* Score fill */}
      <path d={arcPath} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${filled} ${halfCirc}`} />
      {/* Needle */}
      <line x1={cx} y1={cy} x2={needleTipX} y2={needleTipY}
        stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill={color} />
      {/* Score text */}
      <text x={cx} y={cy - 22} textAnchor="middle" fontSize="26" fontWeight="800" fill={color}>{score}</text>
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">из 100</text>
    </svg>
  );
}

function ReleaseReadinessScoreWidget({ projectId }: { projectId: string }) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [rrsResult, setRrsResult] = useState<RRSResult | null>(null);
  const [loading, setLoading] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    releasesApi.list(projectId).then((rs) => {
      setReleases(rs);
      if (rs.length > 0) setSelectedId(rs[0].id);
    }).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    Promise.all([
      requirementsApi.traceability(projectId),
      defectsApi.list(projectId),
      casesApi.list(projectId),
    ]).then(([trace, defs, allCases]) => {
      const rel = releases.find((r) => r.id === selectedId);
      if (!rel) return;
      const relTrace = trace.filter((t) => rel.requirement_ids.includes(t.id));
      const total = relTrace.length;
      const totalCases = relTrace.reduce((s, r) => s + r.total_cases, 0);
      const passed = relTrace.reduce((s, r) => s + r.passed, 0);
      const failed = relTrace.reduce((s, r) => s + r.failed, 0);
      const blocked = relTrace.reduce((s, r) => s + r.blocked, 0);
      const executed = passed + failed + blocked;
      const reqsWithCases = relTrace.filter((r) => r.total_cases > 0).length;
      const openBlockers = defs.filter((d) =>
        d.release_id === selectedId &&
        (d.severity === "blocker" || d.severity === "critical") &&
        (d.status === "open" || d.status === "in_progress" || d.status === "reopened")
      ).length;
      const relCaseIds = new Set(relTrace.flatMap((r) => r.test_cases.map((tc) => tc.id)));
      const flakyTests = (allCases as TestCase[]).filter((c) => c.is_flaky && relCaseIds.has(c.id)).length;
      const result = calcRRS(
        {
          coverage: total > 0 ? (reqsWithCases / total) * 100 : 0,
          executionRate: totalCases > 0 ? (executed / totalCases) * 100 : 0,
          passRate: executed > 0 ? (passed / executed) * 100 : 0,
          openBlockers, flakyTests,
          untestedAreas: total - reqsWithCases,
          totalCases,
        },
        loadRRSWeights(),
        loadRRSThresholds(),
      );
      setRrsResult(result);
    }).catch(() => {}).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, releases]);

  return (
    <div className="dash-widget" ref={widgetRef}>
      <div className="dash-widget-head">
        <span className="dash-widget-title">🎯 Release Readiness Score</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {releases.length > 0 && (
            <select className="input" style={{ fontSize: 11, padding: "2px 6px", height: 26 }}
              value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {releases.map((r) => <option key={r.id} value={r.id}>{r.name} {r.version}</option>)}
            </select>
          )}
          <WidgetActions widgetRef={widgetRef} getHtml={() => ({
            title: "Release Readiness Score",
            html: rrsResult ? `<h2>🎯 Release Readiness Score</h2>
<p class="meta">Score: <strong>${rrsResult.score}/100</strong> — ${rrsResult.verdictMeta.emoji} ${rrsResult.verdictMeta.label}</p>
<table><thead><tr><th>Параметр</th><th>Значение</th><th>Вклад</th></tr></thead><tbody>
${rrsResult.factors.map(f => `<tr><td>${f.name}</td><td>${f.value}${f.unit}</td><td style="color:${f.contribution>=0?"#16a34a":"#dc2626"}">${f.contribution>=0?"+":""}${f.contribution}pts</td></tr>`).join("")}
</tbody></table>` : "<h2>Release Readiness Score</h2><p>Нет данных</p>",
          })} />
        </div>
      </div>
      {loading && <div style={{ padding: "20px 0", textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>Загружаем…</div>}
      {!loading && releases.length === 0 && (
        <div style={{ padding: "20px 0", textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>Нет релизов</div>
      )}
      {!loading && rrsResult && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "12px 14px" }}>
          <Speedometer score={rrsResult.score} color={rrsResult.verdictMeta.color} />
          <div style={{ fontSize: 13, fontWeight: 700, color: rrsResult.verdictMeta.color, textAlign: "center" }}>
            {rrsResult.verdictMeta.emoji} {rrsResult.verdictMeta.label}
          </div>
          {/* Factor breakdown */}
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5, marginTop: 8, borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
              Параметры расчёта
            </div>
            {rrsResult.factors.map((f) => (
              <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span style={{ fontSize: 10, flexShrink: 0 }}>{f.status === "ok" ? "✅" : f.status === "warn" ? "⚠️" : "❌"}</span>
                <span style={{ flex: 1, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span style={{ fontWeight: 700, color: "var(--color-text)", minWidth: 36, textAlign: "right", flexShrink: 0 }}>
                  {f.value}{f.unit}
                </span>
                <span style={{ fontWeight: 600, fontSize: 10, color: f.contribution >= 0 ? "#16a34a" : "#dc2626", minWidth: 34, textAlign: "right", flexShrink: 0 }}>
                  {f.contribution >= 0 ? "+" : ""}{f.contribution}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Widget 8: Cases by Requirement ───────────────────────────────────────────
const REQ_TYPE_ICONS_DASH: Record<string, string> = { epic: "🗺", feature: "✨", story: "📖", requirement: "📋" };

function CasesByRequirementWidget({ projectId }: { projectId: string }) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [cases, setCases] = useState<TestCase[]>([]);
  const [resultMap, setResultMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);

  useEffect(() => {
    requirementsApi.list(projectId).then(setReqs).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!selectedId) { setCases([]); setResultMap(new Map()); return; }
    setLoading(true);
    Promise.all([
      requirementsApi.getTestCases(selectedId),
      runsApi.list(projectId).then(async (runs) => {
        if (runs.length === 0) return new Map<string, string>();
        const latest = [...runs].sort((a, b) =>
          new Date(b.created_at ?? "").getTime() - new Date(a.created_at ?? "").getTime()
        )[0];
        const results = await runsApi.results(latest.id);
        return new Map(results.map((r) => [r.test_case_id, r.status]));
      }),
    ])
      .then(([cs, map]) => { setCases(cs); setResultMap(map); setListExpanded(false); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedId, projectId]);

  const filteredReqs = useMemo(() => {
    if (!search) return reqs;
    const q = search.toLowerCase();
    return reqs.filter((r) => r.title.toLowerCase().includes(q) || (r.req_type ?? "").includes(q));
  }, [reqs, search]);

  const stats = useMemo(() => {
    const s = { total: cases.length, passed: 0, failed: 0, blocked: 0, untested: 0, skipped: 0 };
    for (const c of cases) {
      const st = resultMap.get(c.id) ?? "untested";
      if (st === "passed") s.passed++;
      else if (st === "failed") s.failed++;
      else if (st === "blocked") s.blocked++;
      else if (st === "skipped") s.skipped++;
      else s.untested++;
    }
    return s;
  }, [cases, resultMap]);

  const selectedReq = reqs.find((r) => r.id === selectedId);
  const passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;

  const selectReq = (r: Requirement) => {
    setSelectedId(r.id);
    setSearch(r.title);
    setShowDropdown(false);
  };

  return (
    <div className="dash-widget" ref={widgetRef}>
      <div className="dash-widget-head">
        <span className="dash-widget-title">📊 Cases by Requirement</span>
        <WidgetActions widgetRef={widgetRef} getHtml={() => ({
          title: "Cases by Requirement",
          html: selectedReq ? `<h2>Cases by Requirement</h2>
<p><strong>${selectedReq.title}</strong> (${selectedReq.req_type ?? "requirement"})</p>
<table><thead><tr><th>Статус</th><th>Кол-во</th><th>%</th></tr></thead><tbody>
<tr><td>Passed</td><td>${stats.passed}</td><td>${stats.total > 0 ? Math.round(stats.passed / stats.total * 100) : 0}%</td></tr>
<tr><td>Failed</td><td>${stats.failed}</td><td>${stats.total > 0 ? Math.round(stats.failed / stats.total * 100) : 0}%</td></tr>
<tr><td>Blocked</td><td>${stats.blocked}</td><td>${stats.total > 0 ? Math.round(stats.blocked / stats.total * 100) : 0}%</td></tr>
<tr><td>Untested</td><td>${stats.untested + stats.skipped}</td><td>${stats.total > 0 ? Math.round((stats.untested + stats.skipped) / stats.total * 100) : 0}%</td></tr>
<tr><td><strong>Total</strong></td><td><strong>${stats.total}</strong></td><td>100%</td></tr>
</tbody></table>` : "<h2>Cases by Requirement</h2><p>Не выбрано требование</p>",
        })} />
      </div>

      {/* Search + dropdown */}
      <div style={{ padding: "8px 14px 4px", position: "relative" }}>
        <input
          className="input"
          style={{ width: "100%", fontSize: 12 }}
          placeholder="Поиск по названию требования…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); if (!e.target.value) setSelectedId(""); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
        />
        {showDropdown && filteredReqs.length > 0 && (
          <div style={{
            position: "absolute", top: "calc(100% - 4px)", left: 14, right: 14, zIndex: 20,
            background: "var(--color-bg)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)", maxHeight: 200, overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,.14)",
          }}>
            {filteredReqs.slice(0, 25).map((r) => (
              <div
                key={r.id}
                style={{
                  padding: "6px 10px", cursor: "pointer", fontSize: 12,
                  borderBottom: "1px solid var(--color-border)",
                  background: r.id === selectedId ? "var(--color-bg-soft)" : "transparent",
                  display: "flex", alignItems: "center", gap: 6,
                }}
                onMouseDown={() => selectReq(r)}
              >
                <span style={{ flexShrink: 0 }}>{REQ_TYPE_ICONS_DASH[r.req_type ?? "requirement"] ?? "📋"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: r.id === selectedId ? 600 : 400 }}>
                  {r.title}
                </span>
                {r.req_type && (
                  <span style={{ fontSize: 10, color: "var(--color-text-muted)", flexShrink: 0 }}>{r.req_type}</span>
                )}
                {r.case_count > 0 && (
                  <span style={{ fontSize: 10, color: "var(--color-accent)", flexShrink: 0 }}>{r.case_count}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {reqs.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>Нет требований в проекте</div>
        )}
      </div>

      {loading && (
        <div style={{ padding: "12px 14px", color: "var(--color-text-muted)", fontSize: 12 }}>Загружаем…</div>
      )}
      {!loading && selectedId && cases.length === 0 && (
        <div style={{ padding: "12px 14px", color: "var(--color-text-muted)", fontSize: 12 }}>Нет привязанных тест-кейсов</div>
      )}
      {!loading && selectedId && cases.length > 0 && (
        <div style={{ padding: "6px 14px 12px" }}>
          {selectedReq && (
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {REQ_TYPE_ICONS_DASH[selectedReq.req_type ?? "requirement"]} {selectedReq.title}
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 3 }}>
              <span>Pass Rate</span>
              <span style={{ fontWeight: 700, color: passRate >= 80 ? "#16a34a" : passRate >= 50 ? "#ca8a04" : "#dc2626" }}>{passRate}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--color-border)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${passRate}%`, background: passRate >= 80 ? "#16a34a" : passRate >= 50 ? "#ca8a04" : "#dc2626", transition: "width 0.3s" }} />
            </div>
          </div>
          {[
            { label: "Total", value: stats.total, color: "var(--color-text)" },
            { label: "Passed", value: stats.passed, color: "#16a34a" },
            { label: "Failed", value: stats.failed, color: "#dc2626" },
            { label: "Blocked", value: stats.blocked, color: "#ca8a04" },
            { label: "Untested", value: stats.untested + stats.skipped, color: "var(--color-text-muted)" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--color-border)", fontSize: 12 }}>
              <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
              <span style={{ fontWeight: 700, color }}>{value}</span>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8, fontSize: 11, width: "100%" }}
            onClick={() => setListExpanded((v) => !v)}>
            {listExpanded ? "▲ Скрыть кейсы" : `▼ Показать кейсы (${cases.length})`}
          </button>
          {listExpanded && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
              {cases.map((c) => {
                const status = resultMap.get(c.id) ?? "untested";
                const COL: Record<string, string> = { passed: "#16a34a", failed: "#dc2626", blocked: "#ca8a04", skipped: "#6b7280", untested: "var(--color-text-muted)" };
                const ICO: Record<string, string> = { passed: "✓", failed: "✕", blocked: "⊗", skipped: "⊘", untested: "○" };
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    <span style={{ color: COL[status] ?? COL.untested, flexShrink: 0, fontWeight: 700 }}>{ICO[status] ?? "○"}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
