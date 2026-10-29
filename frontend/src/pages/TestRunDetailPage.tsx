import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  casesApi,
  checklistsApi,
  defectsApi,
  plansApi,
  projectsApi,
  runChecklistsApi,
  runsApi,
  suitesApi,
  type Checklist,
  type Defect,
  type ResultStatus,
  type RunChecklist,
  type TestCase,
  type TestPlan,
  type TestResult,
  type TestRun,
  type TestSuite,
} from "../api/client";
import ExecutionDrawer from "../components/ExecutionDrawer";
import { useBackToClose } from "../hooks/useBackToClose";
import { useDragReorder } from "../hooks/useDragReorder";
import TestRunFormModal from "../components/TestRunFormModal";
import { useToast } from "../components/Toast";
import { exportRunBundle } from "../utils/transfer";
import {
  downloadProtocol,
  downloadAct,
  downloadProtocolDoc,
  downloadActDoc,
  generateProtocolHTML,
  generateActHTML,
  printHTML,
} from "../utils/testProtocol";

// Ссылки абсолютные: протокол показывается в iframe с blob:-URL, где относительный путь не резолвится
function loadAllAttachments(results: TestResult[]): Record<string, Record<number, string[]>> {
  const map: Record<string, Record<number, string[]>> = {};
  for (const r of results) {
    if (r.attachments && Object.keys(r.attachments).length > 0) {
      const numeric: Record<number, string[]> = {};
      for (const [k, v] of Object.entries(r.attachments)) numeric[Number(k)] = v;
      map[r.id] = absolutizeMedia(numeric);
    }
  }
  return map;
}
import { absolutizeMedia, inlineMedia } from "../utils/media";
import "./TestRunDetailPage.css";

const TABS = ["Test cases", "Checklists", "Defects", "Team stats", "Timeline", "Test report"] as const;
type Tab = (typeof TABS)[number];

export default function TestRunDetailPage() {
  const { projectId, runId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [run, setRun] = useState<TestRun | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [cases, setCases] = useState<Record<string, TestCase>>({});
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [projectName, setProjectName] = useState<string>("");
  const [planName, setPlanName] = useState<string | null>(null);
  const apiCheckEnabled = localStorage.getItem("api_check_in_runs_enabled") === "true";
  const [tab, setTab] = useState<Tab>("Test cases");
  const [search, setSearch] = useState("");
  const [activeResult, setActiveResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerDocked, setDrawerDocked] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState(640);
  const [runSeq, setRunSeq] = useState<number | null>(null);

  useBackToClose(activeResult !== null, () => setActiveResult(null));

  // Порядок результатов хранится на бэкенде (TestResult.sequence) — та же схема,
  // что testplan_cases.position для тест-плана, так порядок переживает reload и
  // одинаково виден всем, кто открывает этот прогон.
  const persistResultOrder = useCallback(
    async (newOrder: string[]) => {
      if (!runId) return;
      const byId = new Map(results.map((r) => [r.id, r]));
      const prevResults = results;
      setResults(newOrder.map((id) => byId.get(id)).filter((r): r is TestResult => !!r));
      try {
        await runsApi.reorderResults(runId, newOrder);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to reorder");
        setResults(prevResults);
      }
    },
    [runId, results, toast]
  );

  const resultIds = useMemo(() => results.map((r) => r.id), [results]);
  const reorderDisabled = run?.status === "completed";
  const {
    containerRef: resultsDragRef,
    order: dragResultOrder,
    draggingId: draggingResultId,
    getHandleProps: getResultHandleProps,
  } = useDragReorder(resultIds, persistResultOrder, reorderDisabled);

  // Кнопки ▲/▼: пошаговое перемещение с "перепрыгиванием" через соседний suite-блок,
  // если результат — единственный в своём suite (иначе он не мог бы никуда сдвинуться).
  const moveResult = (resultId: string, dir: -1 | 1) => {
    const baseOrder = results.map((r) => r.id);
    const idx = baseOrder.indexOf(resultId);
    if (idx < 0) return;

    const suiteLookup = (id: string) => cases[results.find((r) => r.id === id)?.test_case_id ?? ""]?.test_suite_id ?? "__none__";
    const currentSuite = suiteLookup(resultId);
    const suiteItems = baseOrder.filter((id) => suiteLookup(id) === currentSuite);
    const isOnlyInSuite = suiteItems.length === 1;

    let targetIdx = idx + dir;
    if (isOnlyInSuite) {
      if (dir === -1 && idx > 0) {
        const prevSuite = suiteLookup(baseOrder[idx - 1]);
        let start = idx - 1;
        while (start > 0 && suiteLookup(baseOrder[start - 1]) === prevSuite) start--;
        targetIdx = start;
      } else if (dir === 1 && idx < baseOrder.length - 1) {
        const nextSuite = suiteLookup(baseOrder[idx + 1]);
        let end = idx + 1;
        while (end < baseOrder.length - 1 && suiteLookup(baseOrder[end + 1]) === nextSuite) end++;
        targetIdx = end;
      }
    }

    if (targetIdx < 0 || targetIdx >= baseOrder.length) return;
    const next = [...baseOrder];
    next.splice(idx, 1);
    next.splice(targetIdx, 0, resultId);
    persistResultOrder(next);
  };

  const reload = async () => {
    if (!runId || !projectId) return;
    try {
      const [r, res, allCases, sList] = await Promise.all([
        runsApi.get(runId),
        runsApi.results(runId),
        casesApi.list(projectId),
        suitesApi.list(projectId),
      ]);
      setRun(r);
      setResults(res);
      const map: Record<string, TestCase> = {};
      for (const c of allCases) map[c.id] = c;
      setCases(map);
      setSuites(sList);
      projectsApi.get(projectId).then((p) => setProjectName(p.name)).catch(() => {});
      if (r.test_plan_id) {
        plansApi.get(r.test_plan_id).then((pl) => setPlanName(pl.name)).catch(() => {});
      } else {
        setPlanName(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  };

  useEffect(() => {
    reload();
  }, [runId, projectId]);

  // Compute TR-N sequential number
  useEffect(() => {
    if (!projectId || !runId) return;
    runsApi.list(projectId).then((all) => {
      const sorted = [...all].sort((a, b) => a.started_at.localeCompare(b.started_at));
      const idx = sorted.findIndex((r) => r.id === runId);
      if (idx >= 0) setRunSeq(idx + 1);
    }).catch(() => {});
  }, [projectId, runId]);

  const onResultUpdated = (updated: TestResult) => {
    setResults((arr) => arr.map((r) => (r.id === updated.id ? updated : r)));
    setActiveResult(updated);
  };

  const handleNextCase = () => {
    if (!activeResult) return;
    const allResults = orderedResults;
    const currentIdx = allResults.findIndex((r) => r.id === activeResult.id);
    // Find next untested after current
    const nextFromCurrent = allResults.slice(currentIdx + 1).find((r) => r.status === "untested");
    if (nextFromCurrent) { setActiveResult(nextFromCurrent); return; }
    // Try from start
    const firstUntested = allResults.find((r) => r.status === "untested");
    if (firstUntested && firstUntested.id !== activeResult.id) { setActiveResult(firstUntested); return; }
    // All done
    setActiveResult(null);
    toast.success("Все тест-кейсы выполнены! 🎉");
  };

  const startRun = async () => {
    if (!run) return;
    try { setRun(await runsApi.start(run.id)); toast.success("Прогон запущен"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const holdRun = async () => {
    if (!run) return;
    try {
      setRun(await runsApi.hold(run.id, holdReason));
      setHoldOpen(false); setHoldReason("");
      toast.success("Прогон приостановлен");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const resumeRun = async () => {
    if (!run) return;
    try { setRun(await runsApi.resume(run.id)); toast.success("Прогон возобновлён"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const complete = async () => {
    if (!run) return;
    try {
      const updated = await runsApi.complete(run.id);
      setRun(updated);
      toast.success("Run completed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const remove = async () => {
    if (!run || !confirm(`Удалить прогон «${run.name}»?`)) return;
    try {
      await runsApi.delete(run.id);
      toast.success("Удалён");
      navigate(`/project/${projectId}/runs`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const [editOpen, setEditOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsedGroups((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // ── Completion reminder ──────────────────────────────────────────────────────
  const [completePromptOpen, setCompletePromptOpen] = useState(false);
  const reminderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const allDoneRef = useRef(false);
  const runStatusRef = useRef<string | undefined>(undefined);
  const prevAllDoneRef = useRef(false);

  const allResultsDone = useMemo(
    () => results.length > 0 && results.every((r) => r.status !== "untested"),
    [results]
  );

  // Keep refs in sync for use inside setInterval
  useEffect(() => {
    allDoneRef.current = allResultsDone;
    runStatusRef.current = run?.status;
  });

  // Detect transition to all-done → show prompt once
  useEffect(() => {
    if (run?.status !== "in_progress") {
      prevAllDoneRef.current = false;
      setCompletePromptOpen(false);
      if (reminderTimerRef.current) { clearInterval(reminderTimerRef.current); reminderTimerRef.current = null; }
      return;
    }
    if (allResultsDone && !prevAllDoneRef.current) {
      prevAllDoneRef.current = true;
      setCompletePromptOpen(true);
    } else if (!allResultsDone) {
      prevAllDoneRef.current = false;
    }
  }, [allResultsDone, run?.status]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (reminderTimerRef.current) clearInterval(reminderTimerRef.current); }, []);

  const handleCompletePromptDismiss = () => {
    setCompletePromptOpen(false);
    const minStr = localStorage.getItem("cfg_run_complete_reminder_min") ?? "1";
    const min = Math.max(1, parseInt(minStr, 10) || 1);
    if (reminderTimerRef.current) clearInterval(reminderTimerRef.current);
    reminderTimerRef.current = setInterval(() => {
      if (allDoneRef.current && runStatusRef.current === "in_progress") {
        setCompletePromptOpen(true);
      }
    }, min * 60 * 1000);
  };

  const handleCompleteFromPrompt = async () => {
    setCompletePromptOpen(false);
    if (reminderTimerRef.current) { clearInterval(reminderTimerRef.current); reminderTimerRef.current = null; }
    await complete();
  };
  // ────────────────────────────────────────────────────────────────────────────

  const isLastUntested = useMemo(() => {
    if (!activeResult) return false;
    return results.filter((r) => r.status === "untested" && r.id !== activeResult.id).length === 0;
  }, [results, activeResult]);

  // Живой порядок (учитывает drag в процессе перетаскивания, иначе совпадает с results)
  const orderedResults = useMemo(() => {
    const byId = new Map(results.map((r) => [r.id, r]));
    return dragResultOrder.map((id) => byId.get(id)).filter((r): r is TestResult => !!r);
  }, [dragResultOrder, results]);

  const grouped = useMemo(() => {
    const byId = new Map(suites.map((s) => [s.id, s.name]));
    const groups = new Map<string, { name: string; items: TestResult[] }>();
    const filtered = search
      ? orderedResults.filter((r) => {
          const c = cases[r.test_case_id];
          return c?.name.toLowerCase().includes(search.toLowerCase());
        })
      : orderedResults;
    for (const r of filtered) {
      const c = cases[r.test_case_id];
      const sid = c?.test_suite_id ?? "__none__";
      const name = c?.test_suite_id
        ? byId.get(c.test_suite_id) ?? "(deleted suite)"
        : "Without suite";
      const g = groups.get(sid) ?? { name, items: [] };
      g.items.push(r);
      groups.set(sid, g);
    }
    return Array.from(groups.values());
  }, [orderedResults, cases, suites, search]);

  // Global sequential numbers across all suite groups
  const globalIdxMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const g of grouped) {
      for (const r of g.items) map.set(r.id, idx++);
    }
    return map;
  }, [grouped]);

  // API runner in-run state
  const [apiRunning, setApiRunning] = useState<Record<string, boolean>>({});
  const [apiResults, setApiResults] = useState<Record<string, { passed: number; failed: number; total: number }>>({});

  const executeApiCase = useCallback(async (result: TestResult, tc: TestCase) => {
    if (!tc.steps.length) return;
    setApiRunning((p) => ({ ...p, [result.id]: true }));
    const validateStatus = localStorage.getItem("api_check_validate_status") === "true";
    let passed = 0; let failed = 0;
    for (const step of tc.steps) {
      const action = step.action ?? "";
      const m = action.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
      if (!m) { failed++; continue; }
      const [, method, url] = m;
      try {
        const hdrs: Record<string, string> = { "Content-Type": "application/json" };
        const opts: RequestInit = { method: method.toUpperCase(), headers: hdrs };
        if (step.data && !["GET", "DELETE"].includes(method.toUpperCase())) opts.body = step.data;
        const r = await fetch(url.trim(), opts);
        const statusOk = validateStatus && (step as any).api_expected_status
          ? r.status === (step as any).api_expected_status
          : r.ok;
        if (statusOk) passed++; else failed++;
      } catch { failed++; }
    }
    const total = tc.steps.length;
    setApiResults((p) => ({ ...p, [result.id]: { passed, failed, total } }));
    setApiRunning((p) => ({ ...p, [result.id]: false }));
    // Auto-update result status
    const newStatus: ResultStatus = failed === 0 ? "passed" : "failed";
    try {
      const updated = await runsApi.setResult(result.id, { status: newStatus, comment: `API Check: ${passed}/${total} passed` });
      onResultUpdated(updated);
    } catch { /* ignore update errors */ }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="page-banner" style={{ margin: 24 }}>⚠ {error}</div>;
  if (!run) return <div className="page" style={{ padding: 40 }}>Загружаем…</div>;

  const counts = {
    total: results.length,
    suites: new Set(
      results.map((r) => cases[r.test_case_id]?.test_suite_id).filter(Boolean)
    ).size,
  };

  const paddingRight = activeResult && drawerDocked ? drawerWidth : 0;

  return (
    <div className="run-detail" style={{ paddingRight, transition: "padding-right 0.15s" }}>
      {/* ── Sticky header: title + tabs + toolbar ── */}
      <div className="run-sticky-header">
        <header className="run-header">
          <h1 className="run-title">
            {runSeq !== null && <span className="run-seq-id">[TR-{runSeq}]</span>} {run.name}
          </h1>
          <div className="run-header-row">
            <button className="plan-back" onClick={() => navigate(`/project/${projectId}/runs`)}>
              ←
            </button>
            <span className="run-icon">▶</span>
            <RunStatusBadge status={run.status} />
            <div className="plan-actions">
              {run.status === "in_progress" && (
                <RunTimer startedAt={run.started_at} />
              )}
              {run.status === "ready_to_start" && (
                <button className="btn btn-primary run-start-btn" onClick={startRun}>
                  ▶ Начать выполнение
                </button>
              )}
              {run.status === "in_progress" && (
                <>
                  <button className="btn" onClick={() => setHoldOpen(true)}>
                    ⏸ Hold
                  </button>
                  <button className="btn btn-primary" onClick={complete}>
                    ✓ Завершить
                  </button>
                </>
              )}
              {run.status === "on_hold" && (
                <>
                  <button className="btn" onClick={resumeRun}>
                    ▶ Возобновить
                  </button>
                  <button className="btn btn-primary" onClick={complete}>
                    ✓ Завершить
                  </button>
                </>
              )}
              <button className="btn-icon" title="Экспорт для переноса в другую TMS4QA (JSON)"
                onClick={() => exportRunBundle(run.id, run.name)
                  .then(() => toast.success("Прогон выгружен"))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Export failed"))}>
                ⬇
              </button>
              <button className="btn-icon" onClick={() => setEditOpen(true)} title="Edit">
                ✎
              </button>
              <button className="btn-icon" onClick={remove} title="Delete">
                🗑
              </button>
            </div>
          </div>
        </header>

        <nav className="plan-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={"plan-tab" + (tab === t ? " is-active" : "")}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>

        {tab === "Test cases" && (
          <div className="run-cases-controls">
            <div className="plan-toolbar">
              <input
                className="input"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 220 }}
              />
              <select className="input plan-desktop-only" style={{ width: 140 }}>
                <option>By all fields</option>
              </select>
              <a className="filter-link plan-desktop-only">Add filter</a>
              <span className="run-bulk-counts">
                {counts.total} cases | {counts.suites} suites
              </span>
            </div>

            <div className="plan-bulk">
              <label className="plan-bulk-all">
                <input type="checkbox" /> Select all
              </label>
              <button className="btn plan-desktop-only" disabled>👤 Assign</button>
              <button className="btn plan-desktop-only" disabled>🙋 Assign to me</button>
              <button className="btn plan-desktop-only" disabled>⤺ Unassign</button>
              <select className="input plan-mobile-only plan-assign-select" disabled defaultValue="">
                <option value="" disabled>👤 Assign</option>
                <option value="me">🙋 Assign to me</option>
                <option value="unassign">⤺ Unassign</option>
              </select>
              <button className="btn-icon plan-mobile-only" title="Filters" aria-label="Filters">⚙</button>
            </div>
          </div>
        )}
      </div>
      {/* ── Scrollable body ── */}
      <div className="run-scroll-body">

      {tab === "Test cases" && (
        <div ref={resultsDragRef}>
          {grouped.map((g, gi) => {
            const gKey = String(gi);
            const isCollapsed = collapsedGroups.has(gKey);
            return (
              <div key={gi} className="plan-group">
                {/* Suite header — full row clickable */}
                <div className="plan-group-head run-group-head"
                  onClick={() => toggleGroup(gKey)}
                  style={{ cursor: "pointer" }}>
                  <span className="plan-group-caret">{isCollapsed ? "▶" : "▾"}</span>
                  <input type="checkbox" onClick={(e) => e.stopPropagation()} onChange={() => {}} />
                  <strong className="run-group-name">{g.name}</strong>
                  <span className="run-group-counter">{g.items.length}</span>
                </div>
                {!isCollapsed && (
                  <div className="run-cases-table">
                    <div className="run-cases-th">
                      <span className="run-th-drag"></span>
                      <span className="run-th-check"></span>
                      <span className="run-th-link"></span>
                      <span className="run-th-id">ID</span>
                      <span className="run-th-title">Title</span>
                      <span className="run-th-time">Time</span>
                      <span className="run-th-member">Member</span>
                      <span className="run-th-status">Status</span>
                      <span style={{ width: 44, flexShrink: 0 }}></span>
                    </div>
                    {g.items.map((r, idx) => {
                      const c = cases[r.test_case_id];
                      const timeSec = r.time_spent_ms ? Math.round(r.time_spent_ms / 1000) : null;
                      const globalIdx = orderedResults.findIndex((x) => x.id === r.id);
                      return (
                        <div
                          key={r.id}
                          data-drag-id={r.id}
                          className={"run-cases-row" + (draggingResultId === r.id ? " is-dragging" : "")}
                          onClick={() => setActiveResult(r)}
                        >
                          <span
                            className="run-td-drag"
                            title="Перетащить"
                            onClick={(e) => e.stopPropagation()}
                            {...getResultHandleProps(r.id)}
                          >⠿</span>
                          <span className="run-td-check">
                            <input
                              type="checkbox"
                              onClick={(e) => e.stopPropagation()}
                              onChange={async (e) => {
                                if (!e.target.checked) return;
                                if (run?.status === "ready_to_start") {
                                  try { setRun(await runsApi.start(run.id)); } catch { /* ignore */ }
                                }
                                setActiveResult(r);
                              }}
                            />
                          </span>
                          <span className="run-td-link">🔗</span>
                          <span className="run-td-id">{(globalIdxMap.get(r.id) ?? 0) + 1}</span>
                          <span className="run-td-title">{c?.name ?? "—"}</span>
                          <span className="run-td-time">
                            {timeSec !== null ? `${timeSec}s` : <span style={{ color: "var(--color-text-subtle)" }}>—</span>}
                          </span>
                          <span className="run-td-member">
                            <span className="assignee-empty">👤</span> Unassigned
                          </span>
                          <span className="run-td-status">
                            <ResultStatusBadge status={r.status} />
                          </span>
                          {apiCheckEnabled && c?.layer === "api" && (
                            <span className="run-td-api" onClick={(e) => e.stopPropagation()}>
                              {apiRunning[r.id] ? (
                                <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>…</span>
                              ) : apiResults[r.id] ? (
                                <span style={{ fontSize: 10, fontWeight: 700, color: apiResults[r.id].failed === 0 ? "#16a34a" : "#dc2626" }}>
                                  {apiResults[r.id].passed}/{apiResults[r.id].total}
                                </span>
                              ) : (
                                <button
                                  className="run-order-btn"
                                  title="Запустить API тест"
                                  style={{ color: "var(--color-accent)", fontWeight: 700, padding: "0 4px" }}
                                  onClick={() => executeApiCase(r, c)}
                                >▶ API</button>
                              )}
                            </span>
                          )}
                          <span className="run-td-order" onClick={(e) => e.stopPropagation()}>
                            <button className="run-order-btn" title={run?.status === "completed" ? "Прогон завершён — изменение порядка недоступно" : "Вверх"}
                              disabled={globalIdx === 0 || run?.status === "completed"} onClick={() => moveResult(r.id, -1)}>▲</button>
                            <button className="run-order-btn" title={run?.status === "completed" ? "Прогон завершён — изменение порядка недоступно" : "Вниз"}
                              disabled={globalIdx === orderedResults.length - 1 || run?.status === "completed"} onClick={() => moveResult(r.id, 1)}>▼</button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {grouped.length === 0 && (
            <div className="plan-empty">В прогоне нет кейсов.</div>
          )}
        </div>
      )}

      {tab === "Checklists" && run && (
        <RunChecklistsTab runId={run.id} projectId={projectId!} />
      )}

      {tab === "Defects" && run && (
        <RunDefectsTab run={run} projectId={projectId!} results={results} cases={cases} />
      )}

      {tab !== "Test cases" && tab !== "Test report" && tab !== "Defects" && tab !== "Checklists" && (
        <div className="plan-stub">
          <div className="plan-stub-icon">🚧</div>
          <h2>{tab}</h2>
          <p>Раздел в разработке.</p>
        </div>
      )}

      {tab === "Test report" && (
        <ProtocolTab run={run} results={orderedResults} cases={cases} suites={suites} projectName={projectName} planName={planName} />
      )}

      </div>{/* /run-scroll-body */}

      {activeResult && (
        <ExecutionDrawer
          result={activeResult}
          testCase={cases[activeResult.test_case_id]}
          projectId={projectId!}
          runCompleted={run?.status === "completed"}
          runStatus={run?.status}
          isLastUntested={isLastUntested}
          totalCases={results.length}
          currentCaseIdx={results.findIndex((r) => r.id === activeResult.id) + 1}
          untestedCount={results.filter((r) => r.status === "untested").length}
          runStartedAt={run?.started_at}
          runCompletedAt={run?.completed_at ?? undefined}
          onNext={handleNextCase}
          onClose={() => setActiveResult(null)}
          onUpdated={onResultUpdated}
          onDockChange={(d, w) => { setDrawerDocked(d); setDrawerWidth(w); }}
          onAutoStart={startRun}
        />
      )}

      {projectId && (
        <TestRunFormModal
          open={editOpen}
          projectId={projectId}
          initial={run}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setRun(updated);
            toast.success("Прогон обновлён");
          }}
        />
      )}

      {holdOpen && (
        <div className="modal-backdrop" onClick={() => setHoldOpen(false)}>
          <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">⏸ Hold — приостановить прогон</h2>
              <button className="btn-icon" onClick={() => setHoldOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>
                Причина приостановки
              </label>
              <textarea
                className="input"
                rows={3}
                placeholder="Укажите причину (необязательно)"
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={holdRun}>Приостановить</button>
              <button className="btn" onClick={() => setHoldOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Complete run prompt ── */}
      {completePromptOpen && (
        <div className="modal-backdrop" onClick={handleCompletePromptDismiss}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">🎉 Все тесты выполнены!</h2>
              <button className="btn-icon" onClick={handleCompletePromptDismiss}>✕</button>
            </div>
            <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--color-text-muted)" }}>
              Все тест-кейсы прогона получили статусы. Завершить прогон?
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleCompleteFromPrompt}>
                ✓ Завершить прогон
              </button>
              <button className="btn" onClick={handleCompletePromptDismiss}>
                Не сейчас
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RunTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const upd = () => setElapsed(Math.max(0, Date.now() - start));
    upd();
    const id = setInterval(upd, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const s = Math.floor(elapsed / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const fmt = h > 0
    ? `${h}ч ${m % 60}м ${s % 60}с`
    : m > 0 ? `${m}м ${s % 60}с` : `${s}с`;
  return <span className="run-timer">⏱ {fmt}</span>;
}

function ProtocolTab({
  run,
  results,
  cases,
  suites,
  projectName,
  planName,
}: {
  run: TestRun;
  results: TestResult[];
  cases: Record<string, TestCase>;
  suites: TestSuite[];
  projectName?: string;
  planName?: string | null;
}) {
  const [docType, setDocType] = useState<"protocol" | "act">("protocol");
  const { projectId } = useParams();

  const attachmentsMap = useMemo(() => loadAllAttachments(results), [results]);

  const protocolHTML = useMemo(
    () => generateProtocolHTML(run, results, cases, suites, attachmentsMap, projectName),
    [run, results, cases, suites, attachmentsMap, projectName],
  );
  const actHTML = useMemo(
    () => generateActHTML(run, results, cases, suites, planName),
    [run, results, cases, suites, planName],
  );

  const currentHTML = docType === "protocol" ? protocolHTML : actHTML;

  const [blobUrl, setBlobUrl] = useState("");
  useEffect(() => {
    const blob = new Blob([currentHTML], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [currentHTML]);

  if (run.status !== "completed") {
    return (
      <div className="protocol-tab">
        <div className="plan-stub">
          <div className="plan-stub-icon">📋</div>
          <h2>Test Report</h2>
          <p>Завершите выполнение тестов</p>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 6 }}>
            Отчёт будет сформирован автоматически после завершения прогона.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="protocol-tab">
      <div className="protocol-doc-selector">
        <button
          className={"protocol-doc-btn" + (docType === "protocol" ? " is-active" : "")}
          onClick={() => setDocType("protocol")}
        >
          📄 Протокол тестирования
        </button>
        <button
          className={"protocol-doc-btn" + (docType === "act" ? " is-active" : "")}
          onClick={() => setDocType("act")}
        >
          📋 Акт тестирования
        </button>
      </div>
      <div className="protocol-toolbar">
        <button
          className="btn btn-primary"
          onClick={async () => docType === "protocol"
            // скачанный файл открывается без сервера — картинки/видео встраиваем
            ? downloadProtocol(run, results, cases, suites, await inlineMedia(attachmentsMap))
            : downloadAct(run, results, cases, suites, planName)}
        >
          ⬇ HTML
        </button>
        <button
          className="btn"
          title="Скачать в формате Word (.doc) для ручного редактирования"
          onClick={async () => docType === "protocol"
            ? downloadProtocolDoc(run, results, cases, suites, await inlineMedia(attachmentsMap), projectName)
            : downloadActDoc(run, results, cases, suites, planName)}
        >
          📝 DOCX
        </button>
        <button className="btn" onClick={() => printHTML(currentHTML)}>
          🖨 Печать / PDF
        </button>
        {projectId && (
          <a
            href={`/project/${projectId}/configurations`}
            style={{ fontSize: 12, color: "var(--color-text-muted)", marginLeft: "auto", textDecoration: "none" }}
            title="Настроить статические блоки отчётов"
          >
            ⚙ Настроить шаблоны
          </a>
        )}
      </div>
      <div className="protocol-frame-wrap">
        {blobUrl && (
          <iframe
            src={blobUrl}
            className="protocol-frame"
            title={docType === "protocol" ? "Протокол тестирования" : "Акт тестирования"}
          />
        )}
      </div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    ready_to_start: { cls: "badge-skipped",  label: "Ready to start" },
    in_progress:    { cls: "badge-untested", label: "In progress"    },
    on_hold:        { cls: "badge-blocked",  label: "On hold"        },
    completed:      { cls: "badge-passed",   label: "Completed"      },
    aborted:        { cls: "badge-failed",   label: "Aborted"        },
  };
  const m = map[status] ?? { cls: "badge-untested", label: status };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function ResultStatusBadge({ status }: { status: ResultStatus }) {
  const map: Record<ResultStatus, { cls: string; label: string }> = {
    untested: { cls: "badge-untested", label: "Untested" },
    passed: { cls: "badge-passed", label: "Passed" },
    failed: { cls: "badge-failed", label: "Failed" },
    blocked: { cls: "badge-blocked", label: "Blocked" },
    skipped: { cls: "badge-skipped", label: "Skipped" },
    invalid: { cls: "badge-invalid", label: "Invalid" },
    retest: { cls: "badge-blocked", label: "Retest" },
    in_progress: { cls: "badge-untested", label: "In Progress" },
  };
  const m = map[status] ?? map.untested;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

// ── DefectDetailSidebar ───────────────────────────────────────────────────────

function DefectDetailSidebar({ defect, onClose }: { defect: Defect; onClose: () => void }) {
  const SEV_S: Record<string, { bg: string; color: string }> = {
    blocker: { bg: "#fee2e2", color: "#b91c1c" }, critical: { bg: "#ffedd5", color: "#c2410c" },
    major: { bg: "#fef3c7", color: "#b45309" }, normal: { bg: "#e5e7eb", color: "#4b5563" },
    minor: { bg: "#dbeafe", color: "#1e40af" }, trivial: { bg: "#f3f4f6", color: "#6b7280" },
  };
  const sev = SEV_S[defect.severity] ?? SEV_S.normal;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 600 }} onClick={onClose}>
      <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 480, background: "var(--color-bg)", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{defect.display_id ?? `D-${defect.display_seq}`}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text)", lineHeight: 1.3 }}>{defect.title}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: sev.bg, color: sev.color }}>{defect.severity}</span>
              {defect.environment && <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, background: "var(--color-bg-soft)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>{defect.environment}</span>}
              {defect.impact && <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, background: "var(--color-bg-soft)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>impact: {defect.impact}</span>}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18, flexShrink: 0, marginLeft: 12 }}>✕</button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {defect.steps_to_reproduce && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--color-text-muted)", letterSpacing: "0.05em", marginBottom: 6 }}>Steps to Reproduce</div>
              <div style={{ fontSize: 13, color: "var(--color-text)", whiteSpace: "pre-wrap", background: "var(--color-bg-soft)", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)" }}>
                {defect.steps_to_reproduce}
              </div>
            </div>
          )}
          {defect.expected_result && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--color-text-muted)", letterSpacing: "0.05em", marginBottom: 6 }}>Expected Result</div>
              <div style={{ fontSize: 13, color: "var(--color-text)", whiteSpace: "pre-wrap", background: "#f0fdf4", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid #bbf7d0" }}>
                {defect.expected_result}
              </div>
            </div>
          )}
          {defect.actual_result && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--color-text-muted)", letterSpacing: "0.05em", marginBottom: 6 }}>Actual Result</div>
              <div style={{ fontSize: 13, color: "var(--color-text)", whiteSpace: "pre-wrap", background: "#fff1f2", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid #fecdd3" }}>
                {defect.actual_result}
              </div>
            </div>
          )}
          {defect.description && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--color-text-muted)", letterSpacing: "0.05em", marginBottom: 6 }}>Description</div>
              <div style={{ fontSize: 13, color: "var(--color-text)", whiteSpace: "pre-wrap" }}>{defect.description}</div>
            </div>
          )}
          {defect.tags && defect.tags.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--color-text-muted)", letterSpacing: "0.05em", marginBottom: 6 }}>Tags</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {defect.tags.map((t) => <span key={t} style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, background: "var(--color-bg-soft)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>{t}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RunChecklistsTab ──────────────────────────────────────────────────────────

function RunChecklistsTab({ runId, projectId }: { runId: string; projectId: string }) {
  const toast = useToast();
  const [attached, setAttached] = useState<RunChecklist[]>([]);
  const [allChecklists, setAllChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [attachOpen, setAttachOpen] = useState(false);

  const reload = () =>
    Promise.all([runChecklistsApi.list(runId), checklistsApi.list(projectId)])
      .then(([run, all]) => { setAttached(run); setAllChecklists(all); })
      .catch(() => toast.error("Ошибка загрузки чек-листов"))
      .finally(() => setLoading(false));

  useEffect(() => { reload(); }, [runId, projectId]);

  const notAttached = allChecklists.filter((c) => !attached.some((a) => a.checklist_id === c.id));

  const attach = async (checklistId: string) => {
    try {
      await runChecklistsApi.attach(runId, checklistId);
      setAttachOpen(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to attach");
    }
  };

  const detach = async (checklistId: string) => {
    if (!confirm("Открепить чек-лист от прогона?")) return;
    try {
      await runChecklistsApi.detach(runId, checklistId);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to detach");
    }
  };

  const toggleItem = async (rc: RunChecklist, itemId: string) => {
    const checked = rc.checked_items.includes(itemId)
      ? rc.checked_items.filter((id) => id !== itemId)
      : [...rc.checked_items, itemId];
    setAttached((prev) => prev.map((a) => (a.checklist_id === rc.checklist_id ? { ...a, checked_items: checked } : a)));
    try {
      await runChecklistsApi.updateChecked(runId, rc.checklist_id, checked);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
      await reload();
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-muted)" }}>Загружаем…</div>;

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {attached.length} чек-лист{attached.length !== 1 ? "а" : ""} в прогоне
        </span>
        <div style={{ position: "relative" }}>
          <button className="btn btn-primary" onClick={() => setAttachOpen((v) => !v)}>+ Attach checklist</button>
          {attachOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20,
              background: "var(--color-bg)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)", boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
              width: 260, maxHeight: 320, overflowY: "auto",
            }}>
              {notAttached.length === 0 ? (
                <div style={{ padding: 12, fontSize: 13, color: "var(--color-text-muted)" }}>
                  {allChecklists.length === 0 ? "В проекте нет чек-листов" : "Все чек-листы уже прикреплены"}
                </div>
              ) : (
                notAttached.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => attach(c.id)}
                    style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid var(--color-border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-soft)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {c.title} <span style={{ color: "var(--color-text-muted)" }}>({c.items.length})</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {attached.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--color-text-muted)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>☑️</div>
          <div style={{ fontSize: 14 }}>К этому прогону не прикреплено ни одного чек-листа</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {attached.map((rc) => {
            const doneCount = rc.checked_items.length;
            return (
              <div key={rc.checklist_id} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
                  <span style={{ fontWeight: 600, flex: 1 }}>{rc.title}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{doneCount}/{rc.items.length}</span>
                  <button className="btn-icon" title="Detach" style={{ color: "var(--color-failed)" }} onClick={() => detach(rc.checklist_id)}>🗑</button>
                </div>
                {rc.items.length === 0 ? (
                  <div style={{ padding: "10px 14px", fontSize: 13, color: "var(--color-text-muted)", fontStyle: "italic" }}>No items</div>
                ) : (
                  <div style={{ padding: "6px 14px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {rc.items.map((item) => {
                      const checked = rc.checked_items.includes(item.id);
                      return (
                        <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0", cursor: "pointer" }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleItem(rc, item.id)} />
                          <span style={{ textDecoration: checked ? "line-through" : "none", color: checked ? "var(--color-text-muted)" : "var(--color-text)" }}>
                            {item.text}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── RunDefectsTab ──────────────────────────────────────────────────────────────

const SEV_STYLE: Record<string, { bg: string; color: string }> = {
  blocker:  { bg: "#fee2e2", color: "#b91c1c" },
  critical: { bg: "#ffedd5", color: "#c2410c" },
  major:    { bg: "#fef3c7", color: "#b45309" },
  normal:   { bg: "#e5e7eb", color: "#4b5563" },
  minor:    { bg: "#dbeafe", color: "#1e40af" },
  trivial:  { bg: "#f3f4f6", color: "#6b7280" },
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  open:        { bg: "#fee2e2", color: "#dc2626" },
  in_progress: { bg: "#dbeafe", color: "#1d4ed8" },
  resolved:    { bg: "#dcfce7", color: "#16a34a" },
  closed:      { bg: "#f3f4f6", color: "#6b7280" },
  reopened:    { bg: "#fce7f3", color: "#db2777" },
};

function RunDefectsTab({ run, projectId, results, cases }: {
  run: TestRun; projectId: string;
  results: TestResult[]; cases: Record<string, TestCase>;
}) {
  const [allDefects, setAllDefects] = useState<Defect[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDefect, setActiveDefect] = useState<Defect | null>(null);

  useEffect(() => {
    defectsApi.list(projectId).then(setAllDefects).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  // Дефекты, привязанные к прогону напрямую (test_run_id), плюс — как раньше —
  // дефекты того же релиза, ещё не привязанные ни к одному прогону
  const runDefects = useMemo(() => allDefects.filter((d) =>
    d.test_run_id === run.id || (!d.test_run_id && !!run.release_id && d.release_id === run.release_id)
  ), [allDefects, run]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-muted)" }}>Загружаем…</div>;

  const openCount = runDefects.filter((d) => d.status === "open" || d.status === "in_progress" || d.status === "reopened").length;

  return (
    <div style={{ padding: "16px 0" }}>
      {runDefects.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--color-text-muted)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🐞</div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>Нет дефектов, привязанных к этому прогону</div>
          <div style={{ fontSize: 12 }}>
            Дефекты, заведённые при выполнении этого прогона (или привязанные к нему на странице Defects), появятся здесь.
          </div>
        </div>
      ) : (
        <>
          <div style={{ padding: "0 16px 12px", display: "flex", gap: 16, alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
              {runDefects.length} дефект{runDefects.length !== 1 ? "а" : ""}
            </span>
            {openCount > 0 && (
              <span style={{ fontSize: 12, background: "#fee2e2", color: "#dc2626", padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>
                {openCount} открыто
              </span>
            )}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--color-bg-soft)", borderBottom: "2px solid var(--color-border)" }}>
                {["ID", "Дефект", "Severity", "Impact", "Environment", "Статус"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.04em", color: "var(--color-text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runDefects.map((d) => {
                const sev = SEV_STYLE[d.severity] ?? SEV_STYLE.normal;
                const st = STATUS_STYLE[d.status] ?? STATUS_STYLE.closed;
                const isActive = activeDefect?.id === d.id;
                return (
                  <tr key={d.id}
                    onClick={() => setActiveDefect((p) => p?.id === d.id ? null : d)}
                    style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer", background: isActive ? "var(--color-accent-soft)" : "transparent" }}>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600 }}>
                      {d.display_id ?? `D-${d.display_seq}`}
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 500, maxWidth: 360 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-accent)" }}>{d.title}</div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: sev.bg, color: sev.color }}>{d.severity}</span>
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--color-text-muted)" }}>{d.impact ?? "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--color-text-muted)" }}>{d.environment ?? "—"}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
                        {d.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {activeDefect && <DefectDetailSidebar defect={activeDefect} onClose={() => setActiveDefect(null)} />}
        </>
      )}
    </div>
  );
}
