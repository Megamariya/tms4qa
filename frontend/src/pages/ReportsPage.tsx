import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  casesApi, defectsApi, requirementsApi, runsApi, releasesApi, suitesApi,
  getStepExpectedResults,
  type Defect, type ReqTrace, type TestCase, type TestRun, type TestResult, type TestSuite, type Release as ApiRelease,
} from "../api/client";
import { downloadProtocol, downloadAct, generateProtocolHTML, generateActHTML, printHTML } from "../utils/testProtocol";
import { calcRRS, loadRRSWeights, loadRRSThresholds, type RRSResult } from "../utils/releaseReadinessScore";
import { useToast } from "../components/Toast";
import "./ReportsPage.css";

// ── Types ────────────────────────────────────────────────────────────────────

type ReportTab = "protocols" | "acts" | "release_readiness" | "feature_quality" | "test_cases";
type Release = ApiRelease;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("ru-RU"); } catch { return "—"; }
}


const STATUS_BADGE: Record<string, string> = {
  ready_to_start: "badge-skipped", in_progress: "badge-untested",
  on_hold: "badge-blocked", completed: "badge-passed", aborted: "badge-failed",
};

const SEVER_COLOR: Record<string, string> = {
  blocker: "#dc2626", critical: "#ea580c", major: "#ca8a04",
  normal: "#6b7280", minor: "#9ca3af",
};

// ── Document viewer (shared) ──────────────────────────────────────────────────

function DocViewer({ run, docType, onClose }: {
  run: TestRun; docType: "protocol" | "act"; onClose: () => void;
}) {
  const { projectId } = useParams();
  const toast = useToast();
  const [results, setResults] = useState<TestResult[]>([]);
  const [cases, setCases]   = useState<Record<string, TestCase>>({});
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<"protocol" | "act">(docType);
  const [blobUrl, setBlobUrl] = useState("");

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([runsApi.results(run.id), casesApi.list(projectId), suitesApi.list(projectId)])
      .then(([res, allCases, allSuites]) => {
        const map: Record<string, TestCase> = {};
        for (const c of allCases) map[c.id] = c;
        setResults(res); setCases(map); setSuites(allSuites);
      })
      .catch(() => toast.error("Ошибка загрузки данных"))
      .finally(() => setLoading(false));
  }, [run.id, projectId]);

  useEffect(() => {
    if (loading || results.length === 0) return;
    const html = type === "protocol"
      ? generateProtocolHTML(run, results, cases, suites)
      : generateActHTML(run, results, cases, suites);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [loading, results, cases, suites, type]);

  const download = () => {
    if (loading) return;
    const html = type === "protocol"
      ? generateProtocolHTML(run, results, cases, suites)
      : generateActHTML(run, results, cases, suites);
    if (type === "protocol") downloadProtocol(run, results, cases, suites);
    else downloadAct(run, results, cases, suites);
  };

  const doPrint = () => {
    if (loading) return;
    const html = type === "protocol"
      ? generateProtocolHTML(run, results, cases, suites)
      : generateActHTML(run, results, cases, suites);
    printHTML(html);
  };

  return (
    <div className="reports-viewer-overlay" onClick={onClose}>
      <div className="reports-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="reports-viewer-header">
          <strong style={{ fontSize: 14, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.name}</strong>
          <div className="reports-viewer-doc-tabs">
            <button className={"protocol-doc-btn" + (type === "protocol" ? " is-active" : "")} onClick={() => setType("protocol")}>📄 Протокол</button>
            <button className={"protocol-doc-btn" + (type === "act" ? " is-active" : "")} onClick={() => setType("act")}>📋 Акт</button>
          </div>
          <div className="reports-viewer-btns">
            <button className="btn btn-primary" onClick={download} disabled={loading}>⬇ Скачать</button>
            <button className="btn" onClick={doPrint} disabled={loading}>🖨 Печать</button>
            <button className="btn-icon" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="reports-viewer-body">
          {loading && <div className="page-banner">Загружаем данные прогона…</div>}
          {!loading && blobUrl && <iframe src={blobUrl} className="reports-viewer-frame" title="Report" />}
        </div>
      </div>
    </div>
  );
}

// ── RunResultsSidebar ─────────────────────────────────────────────────────────

const RRS_STATUS: Record<string, { bg: string; color: string }> = {
  passed:      { bg: "#dcfce7", color: "#15803d" },
  failed:      { bg: "#fee2e2", color: "#dc2626" },
  blocked:     { bg: "#fef3c7", color: "#ca8a04" },
  untested:    { bg: "#f3f4f6", color: "#6b7280" },
  in_progress: { bg: "#dbeafe", color: "#1d4ed8" },
  skipped:     { bg: "#f9fafb", color: "#9ca3af" },
  invalid:     { bg: "#fce7f3", color: "#db2777" },
  retest:      { bg: "#fef3c7", color: "#ca8a04" },
};

function RunResultsSidebar({ run, onClose }: { run: TestRun; onClose: () => void }) {
  const { projectId } = useParams();
  const toast = useToast();
  const [results, setResults] = useState<TestResult[]>([]);
  const [cases, setCases] = useState<Record<string, TestCase>>({});
  const [loading, setLoading] = useState(true);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      runsApi.results(run.id),
      casesApi.list(projectId),
    ]).then(([res, allCases]) => {
      setResults(res);
      const m: Record<string, TestCase> = {};
      for (const c of allCases) m[c.id] = c;
      setCases(m);
    }).catch(() => toast.error("Ошибка загрузки")).finally(() => setLoading(false));
  }, [run.id, projectId]);

  const byStatus = (s: string) => results.filter((r) => r.status === s).length;

  const toggleResult = (id: string) => {
    setExpandedResults((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const expandAll = () => setExpandedResults(new Set(results.map((r) => r.id)));
  const collapseAll = () => setExpandedResults(new Set());

  return (
    <div className="rrr-run-sidebar-backdrop" onClick={onClose}>
      <div className="rrr-run-sidebar" onClick={(e) => e.stopPropagation()}>
        <div className="rrr-run-sidebar-header">
          <div>
            <div className="rrr-run-sidebar-title">{run.name}</div>
            <div className="rrr-run-sidebar-meta">
              {run.environment && <span className="rrr-run-meta-chip">{run.environment}</span>}
              <span className="rrr-run-meta-chip">{run.status}</span>
              {run.started_by_name && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>👤 {run.started_by_name}</span>}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>
        <div className="rrr-run-sidebar-stats">
          {["passed","failed","blocked","untested","skipped"].map((s) => {
            const n = byStatus(s);
            if (n === 0) return null;
            const m = RRS_STATUS[s];
            return <span key={s} style={{ padding: "3px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600, background: m.bg, color: m.color }}>{s}: {n}</span>;
          })}
        </div>
        {!loading && results.length > 0 && (
          <div style={{ padding: "4px 12px", display: "flex", gap: 8, borderBottom: "1px solid var(--color-border)" }}>
            <button className="btn-link" style={{ fontSize: 11 }} onClick={expandAll}>Развернуть все</button>
            <button className="btn-link" style={{ fontSize: 11 }} onClick={collapseAll}>Свернуть все</button>
          </div>
        )}
        <div className="rrr-run-sidebar-body">
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-muted)" }}>Загружаем…</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-muted)" }}>Нет результатов</div>
          ) : (
            <div className="rrr-results-list">
              {results.map((r) => {
                const tc = cases[r.test_case_id];
                const m = RRS_STATUS[r.status] ?? RRS_STATUS.untested;
                const isExpanded = expandedResults.has(r.id);
                const steps = tc?.steps ?? [];
                const hasSteps = steps.length > 0;

                return (
                  <div key={r.id} className={`rrr-result-item${isExpanded ? " rrr-result-open" : ""}`}>
                    <div
                      className="rrr-result-head"
                      onClick={() => toggleResult(r.id)}
                    >
                      <span className="rrr-result-toggle" style={{ visibility: hasSteps ? "visible" : "hidden" }}>
                        {isExpanded ? "▼" : "▶"}
                      </span>
                      <span className="rrr-result-name">{tc?.name ?? `Case ${r.test_case_id.slice(0, 8)}`}</span>
                      <span style={{ padding: "2px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: m.bg, color: m.color, flexShrink: 0 }}>
                        {r.status}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="rrr-result-body">
                        {r.comment && (
                          <div className="rrr-result-comment">💬 {r.comment}</div>
                        )}
                        {r.actual_result && (
                          <div className="rrr-result-actual">⚠ Actual: {r.actual_result}</div>
                        )}
                        {hasSteps ? (
                          <div className="rrr-steps">
                            {steps.map((step, idx) => {
                              const expected = getStepExpectedResults(step);
                              return (
                                <div key={idx} className="rrr-step">
                                  <div className="rrr-step-num">{idx + 1}</div>
                                  <div className="rrr-step-content">
                                    <div className="rrr-step-action">{step.action}</div>
                                    {step.data && <div className="rrr-step-data">Data: {step.data}</div>}
                                    {expected.map((ex, j) => (
                                      <div key={j} className="rrr-step-expected">✓ {ex}</div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--color-text-subtle)", fontStyle: "italic" }}>
                            Нет шагов в тест-кейсе
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Run list (shared Protocols + Acts) ─────────────────────────────────────

function RunListTab({ docType }: { docType: "protocol" | "act" }) {
  const { projectId } = useParams();
  const toast = useToast();
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewRun, setViewRun] = useState<TestRun | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!projectId) return;
    runsApi.list(projectId)
      .then((r) => setRuns(r.filter((x) => x.status === "completed")))
      .catch(() => toast.error("Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const filtered = useMemo(() =>
    search ? runs.filter((r) => r.name.toLowerCase().includes(search.toLowerCase())) : runs,
    [runs, search]
  );

  if (loading) return <div className="page-banner">Загружаем…</div>;

  return (
    <div>
      <div className="reports-list-toolbar">
        <input className="input" placeholder="Поиск по названию…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
        <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
          {filtered.length} прогон{filtered.length !== 1 ? "ов" : ""}
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="reports-empty">
          <div className="reports-empty-icon">{docType === "protocol" ? "📄" : "📋"}</div>
          <p>Нет завершённых прогонов.</p>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Завершите тестовый прогон — {docType === "protocol" ? "протокол" : "акт"} появится здесь.</p>
        </div>
      )}

      <div className="reports-list">
        {filtered.map((run) => (
          <div key={run.id} className="reports-card">
            <div className="reports-card-left">
              <div className="reports-card-name">{run.name}</div>
              <div className="reports-card-meta">
                {run.environment && <span className="reports-meta-env">Env: {run.environment}</span>}
                <span className="reports-meta-date">Завершён: {fmtDate(run.completed_at)}</span>
                {run.started_by_name && <span className="reports-meta-date">Исполнитель: {run.started_by_name}</span>}
              </div>
            </div>
            <div className="reports-card-actions">
              <button className="btn btn-primary" onClick={() => setViewRun(run)}>👁 Просмотр</button>
              <button className="btn" onClick={() => setViewRun(run)}>⬇ Скачать</button>
            </div>
          </div>
        ))}
      </div>

      {viewRun && (
        <DocViewer run={viewRun} docType={docType} onClose={() => setViewRun(null)} />
      )}
    </div>
  );
}

// ── Readiness Gauge ───────────────────────────────────────────────────────────

function ReadinessGauge({ pct }: { pct: number }) {
  const r = 54, cx = 80, cy = 80;
  const fullArc = Math.PI * 1.4;
  const startAngle = Math.PI / 2 + (Math.PI - fullArc) / 2 + Math.PI;
  const endAngle = startAngle + fullArc;
  const toPoint = (angle: number) => ({
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  });
  const arcPath = (from: number, to: number, radius: number) => {
    const s = toPoint.call(null, from);
    const e = { x: cx + radius * Math.cos(to), y: cy + radius * Math.sin(to) };
    const large = to - from > Math.PI ? 1 : 0;
    return `M ${cx + radius * Math.cos(from)} ${cy + radius * Math.sin(from)} A ${radius} ${radius} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const fillAngle = startAngle + fullArc * (pct / 100);
  const color = pct >= 80 ? "#16a34a" : pct >= 50 ? "#ca8a04" : "#dc2626";
  const label = pct >= 80 ? "Ready" : pct >= 50 ? "In Progress" : "At Risk";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width="160" height="100" viewBox="0 0 160 100">
        {/* Background arc */}
        <path d={arcPath(startAngle, endAngle, r)} stroke="var(--color-bg-soft)" strokeWidth="12" fill="none" strokeLinecap="round" />
        {/* Fill arc */}
        {pct > 0 && <path d={arcPath(startAngle, fillAngle, r)} stroke={color} strokeWidth="12" fill="none" strokeLinecap="round" />}
        {/* Center text */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="800" fill={color}>{pct}%</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="var(--color-text-muted)">{label}</text>
        {/* Min/Max labels */}
        <text x={cx - r - 8} y={cy + 16} textAnchor="middle" fontSize="9" fill="var(--color-text-muted)">0%</text>
        <text x={cx + r + 8} y={cy + 16} textAnchor="middle" fontSize="9" fill="var(--color-text-muted)">100%</text>
      </svg>
    </div>
  );
}

// ── Release Readiness ─────────────────────────────────────────────────────────

function ReleaseReadinessTab() {
  const { projectId } = useParams();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string>("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [traceability, setTraceability] = useState<ReqTrace[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [allCases, setAllCases] = useState<TestCase[]>([]);
  const [allRuns, setAllRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [runSidebarRun, setRunSidebarRun] = useState<TestRun | null>(null);
  const rrsEnabled = localStorage.getItem("cfg_rrs_enabled") !== "false";

  useEffect(() => {
    if (!projectId) return;
    releasesApi.list(projectId).then(setReleases).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      requirementsApi.traceability(projectId),
      defectsApi.list(projectId),
      runsApi.list(projectId),
    ])
      .then(([trace, defs, runs]) => {
        setTraceability(trace); setDefects(defs); setAllRuns(runs);
        if (projectId) casesApi.list(projectId).then(setAllCases).catch(() => {});
      })
      .catch(() => toast.error("Ошибка загрузки данных"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const release = useMemo(() => releases.find((r) => r.id === selectedId), [releases, selectedId]);

  const releaseTrace = useMemo(() => {
    if (!release) return [];
    return traceability.filter((t) => release.requirement_ids.includes(t.id));
  }, [release, traceability]);

  const stats = useMemo(() => {
    const total     = releaseTrace.length;
    const totalCases = releaseTrace.reduce((s, r) => s + r.total_cases, 0);
    const passed    = releaseTrace.reduce((s, r) => s + r.passed, 0);
    const failed    = releaseTrace.reduce((s, r) => s + r.failed, 0);
    const blocked   = releaseTrace.reduce((s, r) => s + r.blocked, 0);
    const untested  = releaseTrace.reduce((s, r) => s + r.untested, 0);

    // Requirements that have ≥1 test case linked
    const reqsWithCases = releaseTrace.filter((r) => r.total_cases > 0).length;
    // Requirements that have ≥1 executed (non-untested) result
    const testedReqs = releaseTrace.filter((r) => r.passed + r.failed + r.blocked > 0).length;

    // % of requirements covered by test cases
    const reqCoveragePct = total > 0 ? Math.round(reqsWithCases / total * 100) : 0;

    // % of test cases executed (not untested)
    const executed = passed + failed + blocked;
    const execRatePct = totalCases > 0 ? Math.round(executed / totalCases * 100) : 0;

    // % of executed cases that passed
    const passRatePct = executed > 0 ? Math.round(passed / executed * 100) : 0;

    // Composite readiness: req coverage 40% + execution rate 30% + pass rate 30%
    let readinessPct = 0;
    if (total === 0) {
      readinessPct = 0;
    } else if (totalCases === 0) {
      readinessPct = 5; // requirements exist but no test cases
    } else if (executed === 0) {
      readinessPct = Math.round(reqCoveragePct * 0.15); // have test cases but none run
    } else {
      readinessPct = Math.round(reqCoveragePct * 0.40 + execRatePct * 0.30 + passRatePct * 0.30);
    }

    return {
      total, totalCases, passed, failed, blocked, untested,
      reqsWithCases, testedReqs,
      reqCoveragePct, execRatePct, passRatePct, readinessPct,
    };
  }, [releaseTrace]);

  // ── Release Readiness Score ───────────────────────────────────────────────
  const rrsResult = useMemo((): RRSResult | null => {
    if (!rrsEnabled || !selectedId || stats.total === 0) return null;
    const relCases = allCases.filter((c) => {
      const req = releaseTrace.find((r) => r.test_cases.some((tc) => tc.id === c.id));
      return !!req;
    });
    const flakyCount = relCases.filter((c) => c.is_flaky).length;
    const blockerCount = defects.filter((d) =>
      d.release_id === selectedId &&
      (d.severity === "blocker" || d.severity === "critical") &&
      (d.status === "open" || d.status === "in_progress" || d.status === "reopened")
    ).length;
    return calcRRS(
      {
        coverage: stats.reqCoveragePct,
        executionRate: stats.execRatePct,
        passRate: stats.passRatePct,
        openBlockers: blockerCount,
        flakyTests: flakyCount,
        untestedAreas: stats.total - stats.reqsWithCases,
        totalCases: stats.totalCases,
      },
      loadRRSWeights(),
      loadRRSThresholds(),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rrsEnabled, selectedId, stats, allCases, releaseTrace, defects]);

  // Defects linked to this release via release_id
  const releaseDefects = useMemo(() => {
    if (!selectedId) return [];
    return defects.filter((d) => d.release_id === selectedId);
  }, [defects, selectedId]);

  const openCritical = useMemo(() => {
    return releaseDefects.filter((d) =>
      (d.severity === "blocker" || d.severity === "critical" || d.severity === "major") &&
      (d.status === "open" || d.status === "in_progress" || d.status === "reopened")
    );
  }, [releaseDefects]);

  // Last 3 runs linked to this release
  const releaseRuns = useMemo(() => {
    if (!selectedId) return [];
    return allRuns
      .filter((r) => r.release_id === selectedId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 3);
  }, [allRuns, selectedId]);

  const risks: string[] = useMemo(() => {
    const r: string[] = [];
    if (stats.untested > 0) r.push(`${stats.untested} тест-кейсов не выполнено`);
    const blockers = openCritical.filter((d) => d.severity === "blocker").length;
    const criticals = openCritical.filter((d) => d.severity === "critical").length;
    if (blockers > 0) r.push(`${blockers} blocker-дефектов не закрыто`);
    if (criticals > 0) r.push(`${criticals} critical-дефектов не закрыто`);
    const uncoveredReqs = stats.total - stats.reqsWithCases;
    if (uncoveredReqs > 0) r.push(`${uncoveredReqs} требований без тест-кейсов`);
    if (stats.reqCoveragePct < 100 && stats.reqsWithCases > 0 && stats.testedReqs < stats.reqsWithCases) {
      r.push(`${stats.reqsWithCases - stats.testedReqs} требований с непройденными тестами`);
    }
    return r;
  }, [stats, openCritical]);

  if (releases.length === 0) return (
    <div className="reports-empty">
      <div className="reports-empty-icon">🚀</div>
      <p>Нет релизов.</p>
      <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Создайте релизы в разделе Releases.</p>
    </div>
  );

  return (
    <div className="rrr-root">
      <div className="rrr-selector">
        <label className="rrr-selector-label">Выберите релиз:</label>
        <select className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ width: 320 }}>
          <option value="">— Выберите релиз —</option>
          {releases.map((r) => (
            <option key={r.id} value={r.id}>{r.name} {r.version ?? ""}{r.environment ? ` (${r.environment.toUpperCase()})` : ""}</option>
          ))}
        </select>
      </div>

      {!selectedId && (
        <div className="reports-empty" style={{ marginTop: 32 }}>
          <div className="reports-empty-icon">📊</div>
          <p>Выберите релиз для просмотра отчёта о готовности.</p>
        </div>
      )}

      {selectedId && loading && <div className="page-banner">Загружаем данные…</div>}

      {selectedId && !loading && release && (
        <div className="rrr-report">

          {/* ── Release Readiness Score Dashboard ── */}
          {rrsEnabled && rrsResult && (
            <div className="rrs-dashboard">
              {/* Score + Verdict row */}
              <div className="rrs-top-row">
                <div className="rrs-score-card" style={{ borderColor: rrsResult.verdictMeta.color }}>
                  <svg width="120" height="120" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--color-bg-soft)" strokeWidth="12" />
                    <circle cx="60" cy="60" r="50" fill="none" stroke={rrsResult.verdictMeta.color} strokeWidth="12"
                      strokeDasharray={`${2 * Math.PI * 50 * rrsResult.score / 100} ${2 * Math.PI * 50 * (1 - rrsResult.score / 100)}`}
                      strokeLinecap="round"
                      transform="rotate(-90 60 60)" />
                    <text x="60" y="56" textAnchor="middle" fontSize="26" fontWeight="800" fill={rrsResult.verdictMeta.color}>{rrsResult.score}</text>
                    <text x="60" y="72" textAnchor="middle" fontSize="11" fill="var(--color-text-muted)">/ 100</text>
                  </svg>
                  <div className="rrs-score-label">Release Readiness Score</div>
                </div>
                <div className="rrs-verdict-card" style={{ background: rrsResult.verdictMeta.bg, borderColor: rrsResult.verdictMeta.color }}>
                  <div className="rrs-verdict-emoji">{rrsResult.verdictMeta.emoji}</div>
                  <div className="rrs-verdict-label" style={{ color: rrsResult.verdictMeta.color }}>{rrsResult.verdictMeta.label}</div>
                  <div className="rrs-verdict-desc">{rrsResult.verdictMeta.description}</div>
                </div>
                <div className="rrs-factors-grid">
                  {rrsResult.factors.map((f) => (
                    <div key={f.key} className={`rrs-factor rrs-factor--${f.status}`}>
                      <div className="rrs-factor-icon">
                        {f.status === "ok" ? "✅" : f.status === "warn" ? "⚠️" : "❌"}
                      </div>
                      <div className="rrs-factor-body">
                        <div className="rrs-factor-name">{f.name}</div>
                        <div className="rrs-factor-val">
                          {f.value}{f.unit}
                          <span className="rrs-factor-contrib" style={{ color: f.contribution >= 0 ? "#16a34a" : "#dc2626" }}>
                            {f.contribution >= 0 ? "+" : ""}{f.contribution}pts
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Recommendations */}
              {rrsResult.recommendations.length > 0 && (
                <div className="rrs-recommendations">
                  <div className="rrs-rec-title">💡 Рекомендации</div>
                  <ul className="rrs-rec-list">
                    {rrsResult.recommendations.map((r, i) => (
                      <li key={i} className="rrs-rec-item">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Release header ── */}
          <div className="rrr-title">
            <div className="rrr-title-left">
              <h2 className="rrr-name">{release.name} <span className="rrr-version">{release.version}</span></h2>
              <div className="rrr-meta">
                {release.environment && <span className="badge badge-untested">{release.environment.toUpperCase()}</span>}
                <span className="badge badge-skipped">{release.status}</span>
                {release.release_date && <span className="rrr-date">📅 {fmtDate(release.release_date)}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-start" }}>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => window.print()}>
                🖨 Печать
              </button>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12 }}
                onClick={() => {
                  const scoreStr = rrsResult ? `${rrsResult.score}% — ${rrsResult.verdictMeta.label}` : `${stats.readinessPct}% — ${stats.readinessPct >= 80 ? "Ready" : stats.readinessPct >= 50 ? "In Progress" : "At Risk"}`;
                  const factorRows = rrsResult ? rrsResult.factors.map(f =>
                    `<tr><td>${f.name}</td><td>${f.value}${f.unit}</td><td style="color:${f.contribution>=0?"#16a34a":"#dc2626"};font-weight:600">${f.contribution>=0?"+":""}${f.contribution}pts</td></tr>`
                  ).join("") : "";
                  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Release Readiness — ${release.name} ${release.version}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}
  h1{font-size:18px;margin-bottom:4px}h2{font-size:14px;margin:20px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
  .meta{color:#6b7280;margin-bottom:14px;font-size:12px}
  .score{font-size:36px;font-weight:800;margin:10px 0 4px}
  table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}
  th,td{border:1px solid #e5e7eb;padding:5px 8px;text-align:left}th{background:#f9fafb;font-weight:600}
  .risk-list{margin:6px 0;padding-left:18px}.risk-list li{margin-bottom:3px;color:#ca8a04}
  .ok{color:#16a34a;font-size:12px;margin:6px 0}
  @media print{@page{margin:12mm}}
</style></head><body>
<h1>Release Readiness Report</h1>
<div class="meta">${release.name}${release.version ? " v" + release.version : ""}${release.environment ? " · " + release.environment.toUpperCase() : ""} · ${release.status}${release.release_date ? " · " + fmtDate(release.release_date) : ""} · ${new Date().toLocaleString("ru-RU")}</div>
${rrsResult ? `<div class="score" style="color:${rrsResult.verdictMeta.color}">${rrsResult.score} / 100 — ${rrsResult.verdictMeta.emoji} ${rrsResult.verdictMeta.label}</div>
<p style="color:#6b7280;font-size:11px;margin-bottom:12px">${rrsResult.verdictMeta.description}</p>
<h2>🎯 Параметры расчёта</h2>
<table><thead><tr><th>Параметр</th><th>Значение</th><th>Вклад</th></tr></thead><tbody>${factorRows}</tbody></table>` : `<div class="score" style="color:${stats.readinessPct>=80?"#16a34a":stats.readinessPct>=50?"#ca8a04":"#dc2626"}">${stats.readinessPct}%</div>`}
<h2>📊 Прогресс выполнения</h2>
<p>Passed: ${stats.passed} · Failed: ${stats.failed} · Blocked: ${stats.blocked} · Untested: ${stats.untested} · Total: ${stats.totalCases}</p>
<p>Execution Rate: ${stats.execRatePct}% · Pass Rate: ${stats.passRatePct}%</p>
<h2>🐛 Дефекты (${releaseDefects.length})</h2>
${releaseDefects.length===0?'<p class="ok">✅ Нет дефектов</p>':`<table><thead><tr><th>ID</th><th>Дефект</th><th>Severity</th><th>Impact</th><th>Статус</th></tr></thead><tbody>${releaseDefects.map(d=>`<tr><td>D-${d.display_seq}</td><td>${d.title}</td><td style="color:${SEVER_COLOR[d.severity]??'#6b7280'};font-weight:600">${d.severity}</td><td>${d.impact??'—'}</td><td>${d.status}</td></tr>`).join('')}</tbody></table>`}
<h2>⚠️ Риски (${risks.length})</h2>
${risks.length===0?'<p class="ok">✅ Рисков не выявлено</p>':`<ul class="risk-list">${risks.map(r=>`<li>${r}</li>`).join('')}</ul>`}
${rrsResult?.recommendations.length?`<h2>💡 Рекомендации</h2><ul>${rrsResult.recommendations.map(r=>`<li>${r}</li>`).join('')}</ul>`:''}
<script>window.onload=()=>{window.print();}</script>
</body></html>`;
                  const w = window.open("", "_blank");
                  if (w) { w.document.write(html); w.document.close(); }
                }}
              >
                ⬇ Экспорт PDF
              </button>
            </div>
          </div>

          {/* Test execution progress bar */}
          {stats.totalCases > 0 && (
            <div className="rrr-section" style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>Прогресс выполнения</span>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{stats.execRatePct}% выполнено · Pass Rate {stats.passRatePct}%</span>
              </div>
              <div className="rrr-realbar">
                {stats.passed  > 0 && <div className="rrr-rb-passed"  style={{ flex: stats.passed  }} title={`Passed: ${stats.passed}`} />}
                {stats.failed  > 0 && <div className="rrr-rb-failed"  style={{ flex: stats.failed  }} title={`Failed: ${stats.failed}`} />}
                {stats.blocked > 0 && <div className="rrr-rb-blocked" style={{ flex: stats.blocked }} title={`Blocked: ${stats.blocked}`} />}
                {stats.untested> 0 && <div className="rrr-rb-untested" style={{ flex: stats.untested}} title={`Untested: ${stats.untested}`} />}
              </div>
              <div className="rrr-progress-legend">
                <span className="rrr-leg-passed">✓ Passed: {stats.passed}</span>
                <span className="rrr-leg-failed">✗ Failed: {stats.failed}</span>
                <span className="rrr-leg-blocked">⊘ Blocked: {stats.blocked}</span>
                <span className="rrr-leg-untested">○ Untested: {stats.untested}</span>
              </div>
            </div>
          )}

          {/* Open Issues — only defects linked to this release */}
          <section className="rrr-section">
            <h3 className="rrr-section-title">🐛 Дефекты релиза
              {releaseDefects.length > 0 && (
                <span className="rrr-sec-count">{releaseDefects.length}</span>
              )}
            </h3>
            {releaseDefects.length === 0 ? (
              <div className="rrr-ok">✅ Нет дефектов, привязанных к этому релизу.</div>
            ) : (
              <table className="rrr-defects-table">
                <thead><tr><th>ID</th><th>Дефект</th><th>Severity</th><th>Impact</th><th>Статус</th></tr></thead>
                <tbody>
                  {releaseDefects.map((d) => (
                    <tr key={d.id}>
                      <td style={{ color: "var(--color-text-muted)", fontSize: 12 }}>D-{d.display_seq}</td>
                      <td>{d.title}</td>
                      <td><span style={{ color: SEVER_COLOR[d.severity] ?? "#6b7280", fontWeight: 600, fontSize: 12 }}>{d.severity}</span></td>
                      <td><span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{d.impact ?? "—"}</span></td>
                      <td><span style={{ fontSize: 12 }}>{d.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {openCritical.length > 0 && (
              <div className="rrr-crit-warn">
                ⚠ {openCritical.length} критических открытых дефектов ({openCritical.filter(d => d.severity === "blocker").length} blocker)
              </div>
            )}
          </section>

          {/* Recent runs for this release */}
          <section className="rrr-section">
            <h3 className="rrr-section-title">▶ Release Testing Last Run</h3>
            {releaseRuns.length === 0 ? (
              <div className="rrr-ok">Нет прогонов, привязанных к этому релизу.</div>
            ) : (
              <table className="rrr-defects-table">
                <thead><tr><th>Прогон</th><th>Статус</th><th>Environment</th><th>Завершён</th><th>Исполнитель</th></tr></thead>
                <tbody>
                  {releaseRuns.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button className="rrr-run-link" onClick={() => setRunSidebarRun(r)}>{r.name}</button>
                      </td>
                      <td><span className={`badge ${STATUS_BADGE[r.status] ?? "badge-untested"}`}>{r.status}</span></td>
                      <td style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{r.environment ?? "—"}</td>
                      <td style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{fmtDate(r.completed_at)}</td>
                      <td style={{ fontSize: 12 }}>{r.started_by_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {runSidebarRun && (
            <RunResultsSidebar run={runSidebarRun} onClose={() => setRunSidebarRun(null)} />
          )}

          {/* Risks */}
          <section className="rrr-section">
            <h3 className="rrr-section-title">⚠️ Риски</h3>
            {risks.length === 0 ? (
              <div className="rrr-ok">✅ Значимых рисков не выявлено.</div>
            ) : (
              <ul className="rrr-risks">
                {risks.map((r, i) => <li key={i} className="rrr-risk-item">⚠ {r}</li>)}
              </ul>
            )}
          </section>

          {/* Not tested requirements */}
          {releaseTrace.filter((r) => r.untested === r.total_cases && r.total_cases > 0).length > 0 && (
            <section className="rrr-section">
              <h3 className="rrr-section-title">📝 Не протестировано</h3>
              <ul className="rrr-untested">
                {releaseTrace
                  .filter((r) => r.untested === r.total_cases && r.total_cases > 0)
                  .map((r) => <li key={r.id}>{r.title} <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>({r.total_cases} кейсов)</span></li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ── Feature Quality ───────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  epic: "Epic", feature: "Feature", story: "Story", requirement: "Req",
};
const REQ_STATUS_COLORS: Record<string, string> = {
  draft: "#9ca3af", approved: "#16a34a", in_progress: "#1d4ed8",
  ready_for_qa: "#7c3aed", tested: "#15803d", rejected: "#dc2626",
};

function FeatureQualityTab() {
  const { projectId } = useParams();
  const toast = useToast();
  const [traceability, setTraceability] = useState<ReqTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "coverage" | "defects">("coverage");

  useEffect(() => {
    if (!projectId) return;
    requirementsApi.traceability(projectId)
      .then(setTraceability)
      .catch(() => toast.error("Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const filtered = useMemo(() => {
    let r = traceability;
    if (typeFilter !== "all") r = r.filter((t) => t.req_type === typeFilter);
    if (search) r = r.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()));
    return [...r].sort((a, b) => {
      if (sortBy === "coverage") return (b.coverage_pct ?? 0) - (a.coverage_pct ?? 0);
      if (sortBy === "defects") {
        const da = a.test_cases.flatMap((c) => c.defects).length;
        const db = b.test_cases.flatMap((c) => c.defects).length;
        return db - da;
      }
      return a.title.localeCompare(b.title);
    });
  }, [traceability, typeFilter, search, sortBy]);

  const types = useMemo(() => {
    const s = new Set(traceability.map((t) => t.req_type).filter(Boolean) as string[]);
    return Array.from(s);
  }, [traceability]);

  if (loading) return <div className="page-banner">Загружаем требования…</div>;

  if (traceability.length === 0) return (
    <div className="reports-empty">
      <div className="reports-empty-icon">🎯</div>
      <p>Нет требований.</p>
      <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Добавьте требования в разделе Traceability Report.</p>
    </div>
  );

  return (
    <div>
      <div className="reports-list-toolbar" style={{ gap: 10, flexWrap: "wrap" }}>
        <input className="input" placeholder="Поиск по требованию…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
        <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: 140 }}>
          <option value="all">Все типы</option>
          {types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
        </select>
        <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} style={{ width: 160 }}>
          <option value="coverage">↓ По покрытию</option>
          <option value="defects">↓ По дефектам</option>
          <option value="name">А-Я По названию</option>
        </select>
        <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{filtered.length} требований</span>
      </div>

      <div className="fq-table-wrap">
        <table className="fq-table">
          <thead>
            <tr>
              <th>Требование</th>
              <th>Тип</th>
              <th>Статус</th>
              <th>Готовность</th>
              <th>Кейсы</th>
              <th>P</th><th>F</th><th>U</th>
              <th>Дефекты</th>
              <th>Blockers</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((req) => {
              const allDefects = req.test_cases.flatMap((c) => c.defects);
              const blockers = allDefects.filter((d) =>
                (d.severity === "blocker" || d.severity === "critical") &&
                (d.status === "open" || d.status === "in_progress" || d.status === "reopened")
              ).length;
              const openDefects = allDefects.filter((d) =>
                d.status === "open" || d.status === "in_progress" || d.status === "reopened"
              ).length;
              const pct = req.coverage_pct ?? 0;
              const readiness = req.total_cases > 0
                ? Math.round(req.passed / req.total_cases * 100)
                : 0;

              return (
                <tr key={req.id} className="fq-row">
                  <td className="fq-td-name">
                    <div className="fq-req-title">{req.title}</div>
                    {req.display_seq && <div className="fq-req-id">REQ-{req.display_seq}</div>}
                  </td>
                  <td>
                    {req.req_type && (
                      <span className="fq-type-badge">{TYPE_LABELS[req.req_type] ?? req.req_type}</span>
                    )}
                  </td>
                  <td>
                    {req.status && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: REQ_STATUS_COLORS[req.status] ?? "#6b7280" }}>
                        {req.status}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="fq-readiness">
                      <div className="fq-readiness-bar">
                        <div className="fq-readiness-fill" style={{
                          width: `${readiness}%`,
                          background: readiness === 100 ? "#16a34a" : readiness > 50 ? "#ca8a04" : "#dc2626",
                        }} />
                      </div>
                      <span className="fq-readiness-pct">{readiness}%</span>
                    </div>
                  </td>
                  <td className="fq-td-num">{req.total_cases}</td>
                  <td className="fq-td-num fq-passed">{req.passed}</td>
                  <td className="fq-td-num fq-failed">{req.failed}</td>
                  <td className="fq-td-num fq-untested">{req.untested}</td>
                  <td className="fq-td-num">
                    {openDefects > 0
                      ? <span style={{ color: "#dc2626", fontWeight: 600 }}>{openDefects}</span>
                      : <span style={{ color: "var(--color-text-muted)" }}>0</span>}
                  </td>
                  <td className="fq-td-num">
                    {blockers > 0
                      ? <span style={{ background: "#fee2e2", color: "#dc2626", borderRadius: 4, padding: "1px 6px", fontWeight: 700, fontSize: 11 }}>{blockers}</span>
                      : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── TestCases Tab ─────────────────────────────────────────────────────────────

type CaseSortField = "name" | "suite" | "status" | "priority" | "type" | "layer" | "automation";

const TC_STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  actual:     { label: "Actual",     color: "#065f46", bg: "#d1fae5" },
  draft:      { label: "Draft",      color: "#6b7280", bg: "#f3f4f6" },
  deprecated: { label: "Deprecated", color: "#dc2626", bg: "#fee2e2" },
  review:     { label: "Review",     color: "#92400e", bg: "#fef3c7" },
};

const TC_LAYER_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  unit:        { label: "Unit", bg: "#ede9fe", color: "#6d28d9" },
  integration: { label: "Intg", bg: "#dbeafe", color: "#1d4ed8" },
  e2e:         { label: "E2E",  bg: "#d1fae5", color: "#065f46" },
  api:         { label: "API",  bg: "#dbeafe", color: "#1d4ed8" },
  ui:          { label: "UI",   bg: "#fef3c7", color: "#92400e" },
  not_set:     { label: "—",    bg: "transparent", color: "#9ca3af" },
};

const TC_AUTO_BADGE: Record<string, { label: string; color: string }> = {
  manual:          { label: "Manual",    color: "#6b7280" },
  to_be_automated: { label: "Planned",   color: "#ca8a04" },
  automated:       { label: "Automated", color: "#1d4ed8" },
};

const TC_PRIORITY_COLOR: Record<string, string> = { high: "#dc2626", medium: "#ca8a04", low: "#6b7280", not_set: "#9ca3af" };

function buildSuitePath(suiteId: string | null | undefined, suitesMap: Map<string, TestSuite>): string {
  if (!suiteId) return "—";
  const parts: string[] = [];
  let cur: TestSuite | undefined = suitesMap.get(suiteId);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parent_id ? suitesMap.get(cur.parent_id) : undefined;
  }
  return parts.join(" / ") || "—";
}

function exportTestCasesPDF(
  cases: TestCase[], suitesMap: Map<string, TestSuite>,
  filters: { suite: string; status: string[]; priority: string[]; type: string[]; layer: string[]; automation: string[]; search: string }
) {
  const condLines: string[] = [];
  if (filters.search) condLines.push(`Поиск: "${filters.search}"`);
  if (filters.suite) condLines.push(`Сьют: ${suitesMap.get(filters.suite)?.name ?? filters.suite}`);
  if (filters.status.length) condLines.push(`Статус: ${filters.status.join(", ")}`);
  if (filters.priority.length) condLines.push(`Приоритет: ${filters.priority.join(", ")}`);
  if (filters.type.length) condLines.push(`Тип: ${filters.type.join(", ")}`);
  if (filters.layer.length) condLines.push(`Слой: ${filters.layer.join(", ")}`);
  if (filters.automation.length) condLines.push(`Автоматизация: ${filters.automation.join(", ")}`);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test Cases Report</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:9px;margin:12px}
    h2{font-size:13px;margin-bottom:6px}
    .meta{font-size:10px;color:#666;margin-bottom:10px}
    .cond{font-size:10px;background:#f3f4f6;padding:6px 10px;border-radius:4px;margin-bottom:10px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #e5e7eb;padding:3px 6px;text-align:left;vertical-align:top}
    th{background:#f3f4f6;font-weight:600;font-size:9px}
    td{font-size:9px}
    @media print{@page{margin:8mm;size:A4 landscape}}
  </style></head><body>
  <h2>🗂 Отчёт по тест-кейсам</h2>
  <div class="meta">Экспортировано: ${new Date().toLocaleString("ru-RU")} · Всего: ${cases.length} кейсов</div>
  ${condLines.length ? `<div class="cond"><strong>Условия выборки:</strong><br>${condLines.map((l) => `• ${l}`).join("<br>")}</div>` : ""}
  <table><thead><tr>
    <th>#</th><th>Название</th><th>Сьют</th><th>Статус</th><th>Приоритет</th><th>Тип</th><th>Слой</th><th>Автоматизация</th>
  </tr></thead><tbody>
  ${cases.map((c, i) => `<tr>
    <td>${i + 1}</td>
    <td>${c.name}</td>
    <td>${buildSuitePath(c.test_suite_id, suitesMap)}</td>
    <td>${TC_STATUS_BADGE[c.status]?.label ?? c.status}</td>
    <td>${c.priority}</td>
    <td>${c.type}</td>
    <td>${TC_LAYER_BADGE[c.layer]?.label ?? c.layer}</td>
    <td>${TC_AUTO_BADGE[c.automation_status]?.label ?? c.automation_status}</td>
  </tr>`).join("")}
  </tbody></table>
  <script>window.onload=()=>{window.print();}</script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function exportTestCasesCSV(
  cases: TestCase[], suitesMap: Map<string, TestSuite>,
  filters: { suite: string; status: string[]; priority: string[]; type: string[]; layer: string[]; automation: string[]; search: string }
) {
  const condLines: string[] = [];
  if (filters.search) condLines.push(`Поиск: "${filters.search}"`);
  if (filters.suite) condLines.push(`Сьют: ${suitesMap.get(filters.suite)?.name ?? filters.suite}`);
  if (filters.status.length) condLines.push(`Статус: ${filters.status.join(" | ")}`);
  if (filters.priority.length) condLines.push(`Приоритет: ${filters.priority.join(" | ")}`);
  if (filters.layer.length) condLines.push(`Слой: ${filters.layer.join(" | ")}`);
  if (filters.automation.length) condLines.push(`Автоматизация: ${filters.automation.join(" | ")}`);

  const q = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const rows: string[][] = [];
  if (condLines.length) {
    rows.push([`Условия выборки: ${condLines.join("; ")}`, "", "", "", "", "", "", ""]);
    rows.push([]);
  }
  rows.push(["#", "Название", "Сьют", "Статус", "Приоритет", "Тип", "Слой", "Автоматизация"]);
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    rows.push([
      String(i + 1), c.name, buildSuitePath(c.test_suite_id, suitesMap),
      TC_STATUS_BADGE[c.status]?.label ?? c.status, c.priority, c.type,
      TC_LAYER_BADGE[c.layer]?.label ?? c.layer,
      TC_AUTO_BADGE[c.automation_status]?.label ?? c.automation_status,
    ]);
  }
  const csv = rows.map((r) => r.map(q).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `test_cases_report_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function TestCasesTab() {
  const { projectId } = useParams();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterSuite, setFilterSuite] = useState("");
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterPriority, setFilterPriority] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [filterLayer, setFilterLayer] = useState<string[]>([]);
  const [filterAuto, setFilterAuto] = useState<string[]>([]);

  // Sort
  const [sortField, setSortField] = useState<CaseSortField>("name");
  const [sortAsc, setSortAsc] = useState(true);

  // Export
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([casesApi.list(projectId), suitesApi.list(projectId)])
      .then(([c, s]) => { setCases(c); setSuites(s); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const suitesMap = useMemo(() => new Map(suites.map((s) => [s.id, s])), [suites]);
  const rootSuites = useMemo(() => suites.filter((s) => !s.parent_id), [suites]);

  const activeFilters = { suite: filterSuite, status: filterStatus, priority: filterPriority, type: filterType, layer: filterLayer, automation: filterAuto, search };

  const filtered = useMemo(() => {
    let result = cases;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)));
    }
    if (filterSuite) result = result.filter((c) => {
      let cur: TestSuite | undefined = c.test_suite_id ? suitesMap.get(c.test_suite_id) : undefined;
      while (cur) { if (cur.id === filterSuite) return true; cur = cur.parent_id ? suitesMap.get(cur.parent_id) : undefined; }
      return false;
    });
    if (filterStatus.length) result = result.filter((c) => filterStatus.includes(c.status));
    if (filterPriority.length) result = result.filter((c) => filterPriority.includes(c.priority));
    if (filterType.length) result = result.filter((c) => filterType.includes(c.type));
    if (filterLayer.length) result = result.filter((c) => filterLayer.includes(c.layer));
    if (filterAuto.length) result = result.filter((c) => filterAuto.includes(c.automation_status));

    return [...result].sort((a, b) => {
      let va = "", vb = "";
      switch (sortField) {
        case "name":       va = a.name;                                               vb = b.name; break;
        case "suite":      va = buildSuitePath(a.test_suite_id, suitesMap);           vb = buildSuitePath(b.test_suite_id, suitesMap); break;
        case "status":     va = a.status;                                             vb = b.status; break;
        case "priority":   { const o = { high: 0, medium: 1, low: 2, not_set: 3 }; va = String((o as Record<string,number>)[a.priority] ?? 9); vb = String((o as Record<string,number>)[b.priority] ?? 9); break; }
        case "type":       va = a.type;                                               vb = b.type; break;
        case "layer":      va = a.layer;                                              vb = b.layer; break;
        case "automation": va = a.automation_status;                                  vb = b.automation_status; break;
      }
      const cmp = va.localeCompare(vb);
      return sortAsc ? cmp : -cmp;
    });
  }, [cases, suitesMap, search, filterSuite, filterStatus, filterPriority, filterType, filterLayer, filterAuto, sortField, sortAsc]);

  const activeFilterCount = [filterSuite, ...filterStatus, ...filterPriority, ...filterType, ...filterLayer, ...filterAuto, search ? "1" : ""].filter(Boolean).length;
  const clearFilters = () => { setSearch(""); setFilterSuite(""); setFilterStatus([]); setFilterPriority([]); setFilterType([]); setFilterLayer([]); setFilterAuto([]); };

  const toggleSort = (field: CaseSortField) => {
    if (sortField === field) setSortAsc((v) => !v);
    else { setSortField(field); setSortAsc(true); }
  };
  const SortIcon = ({ f }: { f: CaseSortField }) => sortField === f ? <span style={{ marginLeft: 3, fontSize: 9 }}>{sortAsc ? "↑" : "↓"}</span> : null;

  if (loading) return <div className="reports-loading">Загружаем тест-кейсы…</div>;

  return (
    <div className="rptc-page">
      {/* Toolbar */}
      <div className="rptc-toolbar">
        <span className="rptc-count">{filtered.length} / {cases.length} тест-кейсов</span>
        <input className="input rptc-search" placeholder="Поиск по названию, описанию, тегам…" value={search} onChange={(e) => setSearch(e.target.value)} />

        <select className="input" style={{ fontSize: 12 }} value={filterSuite} onChange={(e) => setFilterSuite(e.target.value)}>
          <option value="">Все сьюты</option>
          {suites.map((s) => {
            const depth = (() => { let d = 0; let c: TestSuite | undefined = s; while (c?.parent_id) { d++; c = suitesMap.get(c.parent_id); } return d; })();
            return <option key={s.id} value={s.id}>{"  ".repeat(depth)}{s.name}</option>;
          })}
        </select>

        <select className="input" style={{ fontSize: 12 }} value={filterStatus[0] ?? ""} onChange={(e) => setFilterStatus(e.target.value ? [e.target.value] : [])}>
          <option value="">Любой статус</option>
          {["actual", "draft", "deprecated", "review"].map((s) => <option key={s} value={s}>{TC_STATUS_BADGE[s]?.label ?? s}</option>)}
        </select>

        <select className="input" style={{ fontSize: 12 }} value={filterPriority[0] ?? ""} onChange={(e) => setFilterPriority(e.target.value ? [e.target.value] : [])}>
          <option value="">Любой приоритет</option>
          {["high", "medium", "low", "not_set"].map((p) => <option key={p} value={p} style={{ color: TC_PRIORITY_COLOR[p] }}>{p}</option>)}
        </select>

        <select className="input" style={{ fontSize: 12 }} value={filterLayer[0] ?? ""} onChange={(e) => setFilterLayer(e.target.value ? [e.target.value] : [])}>
          <option value="">Любой слой</option>
          {["unit", "integration", "e2e", "api", "ui", "not_set"].map((l) => <option key={l} value={l}>{TC_LAYER_BADGE[l]?.label ?? l}</option>)}
        </select>

        <select className="input" style={{ fontSize: 12 }} value={filterAuto[0] ?? ""} onChange={(e) => setFilterAuto(e.target.value ? [e.target.value] : [])}>
          <option value="">Любая авт-ция</option>
          {["manual", "to_be_automated", "automated"].map((a) => <option key={a} value={a}>{TC_AUTO_BADGE[a]?.label ?? a}</option>)}
        </select>

        {activeFilterCount > 0 && (
          <button className="btn-link" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={clearFilters}>
            Сбросить ({activeFilterCount})
          </button>
        )}

        <div style={{ position: "relative", marginLeft: "auto" }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setExportOpen((v) => !v)}>Экспорт ▾</button>
          {exportOpen && (
            <div className="tp-export-menu" style={{ right: 0, left: "auto", minWidth: 160 }}>
              <button className="tp-export-item" onClick={() => { exportTestCasesPDF(filtered, suitesMap, activeFilters); setExportOpen(false); }}>🖨 PDF (печать)</button>
              <button className="tp-export-item" onClick={() => { exportTestCasesCSV(filtered, suitesMap, activeFilters); setExportOpen(false); }}>📊 CSV / Excel</button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rptc-table-wrap">
        <table className="rptc-table">
          <thead>
            <tr>
              <th className="rptc-th" style={{ width: 40 }}>#</th>
              <th className="rptc-th rptc-th-sort" onClick={() => toggleSort("name")}>Название <SortIcon f="name" /></th>
              <th className="rptc-th rptc-th-sort" onClick={() => toggleSort("suite")}>Сьют <SortIcon f="suite" /></th>
              <th className="rptc-th rptc-th-sort" onClick={() => toggleSort("status")}>Статус <SortIcon f="status" /></th>
              <th className="rptc-th rptc-th-sort" onClick={() => toggleSort("priority")}>Приоритет <SortIcon f="priority" /></th>
              <th className="rptc-th rptc-th-sort" onClick={() => toggleSort("type")}>Тип <SortIcon f="type" /></th>
              <th className="rptc-th rptc-th-sort" onClick={() => toggleSort("layer")}>Слой <SortIcon f="layer" /></th>
              <th className="rptc-th rptc-th-sort" onClick={() => toggleSort("automation")}>Автоматизация <SortIcon f="automation" /></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: "40px", color: "var(--color-text-muted)" }}>Нет тест-кейсов по текущим фильтрам.</td></tr>
            ) : filtered.map((c, idx) => {
              const sm = TC_STATUS_BADGE[c.status];
              const lm = TC_LAYER_BADGE[c.layer];
              const am = TC_AUTO_BADGE[c.automation_status];
              return (
                <tr key={c.id} className="rptc-tr">
                  <td className="rptc-td rptc-td-idx">{idx + 1}</td>
                  <td className="rptc-td rptc-td-name">
                    <div className="rptc-case-name">{c.name}</div>
                    {c.tags.length > 0 && (
                      <div className="rptc-tags">
                        {c.tags.map((t) => <span key={t} className="rptc-tag">{t}</span>)}
                      </div>
                    )}
                  </td>
                  <td className="rptc-td rptc-td-suite">
                    <span className="rptc-suite-path">{buildSuitePath(c.test_suite_id, suitesMap)}</span>
                  </td>
                  <td className="rptc-td">
                    {sm && <span className="rptc-badge" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>}
                  </td>
                  <td className="rptc-td">
                    <span style={{ fontWeight: 600, fontSize: 12, color: TC_PRIORITY_COLOR[c.priority] }}>{c.priority}</span>
                  </td>
                  <td className="rptc-td">
                    <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{c.type}</span>
                  </td>
                  <td className="rptc-td">
                    {lm && c.layer !== "not_set" && (
                      <span className="rptc-badge" style={{ background: lm.bg, color: lm.color }}>{lm.label}</span>
                    )}
                  </td>
                  <td className="rptc-td">
                    {am && <span style={{ fontSize: 12, color: am.color }}>{am.label}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS: { id: ReportTab; label: string }[] = [
  { id: "protocols",         label: "📄 Протоколы" },
  { id: "acts",              label: "📋 Акты" },
  { id: "release_readiness", label: "🚀 Release Readiness" },
  { id: "feature_quality",   label: "🎯 Качество фич" },
  { id: "test_cases",        label: "🗂 Тест-кейсы" },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>("protocols");

  return (
    <div className="reports-page">
      <div className="reports-sticky">
        <div className="reports-header">
          <h1 className="page-title">Reports</h1>
        </div>
        <nav className="reports-tabs">
          {TABS.map((t) => (
            <button key={t.id}
              className={"reports-tab-btn" + (tab === t.id ? " is-active" : "")}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </nav>
      </div>

      <div className="reports-tab-content">
        {tab === "protocols"         && <RunListTab docType="protocol" />}
        {tab === "acts"              && <RunListTab docType="act" />}
        {tab === "release_readiness" && <ReleaseReadinessTab />}
        {tab === "feature_quality"   && <FeatureQualityTab />}
        {tab === "test_cases"        && <TestCasesTab />}
      </div>
    </div>
  );
}
