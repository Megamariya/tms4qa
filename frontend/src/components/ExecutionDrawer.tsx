import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  casesApi, runsApi, defectsApi, attachmentsApi,
  getStepExpectedResults,
  SEVERITY, PRIORITY,
  type ResultStatus, type TestCase, type TestResult, type TestRun,
  type Severity, type Priority,
} from "../api/client";
import { useToast } from "./Toast";
import MediaThumb from "./MediaThumb";
import { MEDIA_ACCEPT } from "../utils/media";
import "./ExecutionDrawer.css";

interface Props {
  result: TestResult;
  testCase?: TestCase;
  projectId: string;
  runCompleted?: boolean;
  runStatus?: string;
  isLastUntested?: boolean;
  totalCases?: number;
  currentCaseIdx?: number;
  untestedCount?: number;
  runStartedAt?: string;
  runCompletedAt?: string;
  onNext?: () => void;
  onClose: () => void;
  onUpdated: (r: TestResult) => void;
  onDockChange?: (docked: boolean, width: number) => void;
  onAutoStart?: () => void;
}

const STATUS_BUTTONS: { status: ResultStatus; label: string; icon: string; cls: string }[] = [
  { status: "passed",  label: "Passed",  icon: "✓", cls: "exec-btn-passed"  },
  { status: "failed",  label: "Failed",  icon: "✕", cls: "exec-btn-failed"  },
  { status: "blocked", label: "Blocked", icon: "⊘", cls: "exec-btn-blocked" },
  { status: "skipped", label: "Skipped", icon: "→", cls: "exec-btn-skipped" },
  { status: "invalid", label: "Invalid", icon: "♡", cls: "exec-btn-invalid" },
];

const STEP_STATUS_BTNS: { status: ResultStatus; label: string; cls: string }[] = [
  { status: "passed",  label: "✓ Passed",  cls: "step-s-passed"  },
  { status: "failed",  label: "✕ Failed",  cls: "step-s-failed"  },
  { status: "blocked", label: "⊘ Blocked", cls: "step-s-blocked" },
  { status: "skipped", label: "→ Skipped", cls: "step-s-skipped" },
];

const DOCK_KEY = "exec_drawer_docked";
const WIDTH_KEY = "exec_drawer_width";

const EXEC_API_COLORS: Record<string, string> = {
  GET: "#16a34a", POST: "#1d4ed8", PUT: "#ca8a04", PATCH: "#7c3aed", DELETE: "#dc2626",
};
type ExecApiResult = { status: number; statusText: string; body: string; timeMs: number; ok: boolean };

function stepStateKey(id: string) { return `exec_step_${id}`; }
function expChecksKey(id: string) { return `exec_expchecks_${id}`; }
function expTextsKey(id: string) { return `exec_exptexts_${id}`; }

function loadExpChecks(resultId: string): Record<number, boolean[]> {
  try { const r = localStorage.getItem(expChecksKey(resultId)); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
function saveExpChecks(resultId: string, data: Record<number, boolean[]>) {
  try { localStorage.setItem(expChecksKey(resultId), JSON.stringify(data)); } catch { /* ignore */ }
}
function loadExpTexts(resultId: string): Record<number, string[]> {
  try { const r = localStorage.getItem(expTextsKey(resultId)); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
function saveExpTexts(resultId: string, data: Record<number, string[]>) {
  try { localStorage.setItem(expTextsKey(resultId), JSON.stringify(data)); } catch { /* ignore */ }
}

function saveStepState(resultId: string, data: { actuals: Record<number, string>; statuses: Record<number, ResultStatus> }) {
  try { localStorage.setItem(stepStateKey(resultId), JSON.stringify(data)); } catch { /* ignore */ }
}
function loadStepState(resultId: string) {
  try { const r = localStorage.getItem(stepStateKey(resultId)); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
// Вложения шагов: файлы в MinIO, ссылки — в test_results.attachments ({step: [url]})
function attachmentsFromResult(r: TestResult): Record<number, string[]> {
  const numeric: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(r.attachments ?? {})) numeric[Number(k)] = v;
  return numeric;
}

export default function ExecutionDrawer({
  result, testCase, projectId, runCompleted, runStatus,
  isLastUntested,
  totalCases, currentCaseIdx, untestedCount, runStartedAt, runCompletedAt,
  onClose, onUpdated, onDockChange, onAutoStart, onNext,
}: Props) {
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"Execution" | "Run History">("Execution");
  const [comment, setComment] = useState(result.comment ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [muting, setMuting] = useState(false);

  const [docked, setDocked] = useState(() => localStorage.getItem(DOCK_KEY) !== "false");
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 640);
  const resizing = useRef(false);
  const resizeStart = useRef({ mx: 0, w: 640 });
  const scrollRef = useRef<HTMLDivElement>(null);

  const [stepStatuses, setStepStatuses] = useState<Record<number, ResultStatus>>(() => loadStepState(result.id)?.statuses ?? {});
  const [stepActual, setStepActual] = useState<Record<number, string>>(() => loadStepState(result.id)?.actuals ?? {});
  const [stepAttachments, setStepAttachments] = useState<Record<number, string[]>>(() => attachmentsFromResult(result));
  const [uploadingStep, setUploadingStep] = useState<number | null>(null);
  const [expectedChecks, setExpectedChecks] = useState<Record<number, boolean[]>>(() => loadExpChecks(result.id));
  const [touchedExpItems, setTouchedExpItems] = useState<Set<string>>(new Set());
  const setExpChecksState = setExpectedChecks;
  const [finalModalOpen, setFinalModalOpen] = useState(false);
  const [finalModalPending, setFinalModalPending] = useState<ResultStatus | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Reason modal state
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<ResultStatus | null>(null);
  const [reasonText, setReasonText] = useState("");

  // Report Bug state
  const [reportBugOpen, setReportBugOpen] = useState(false);
  const [bugTitle, setBugTitle] = useState("");
  const [bugSeverity, setBugSeverity] = useState<Severity>("critical");
  const [bugPriority, setBugPriority] = useState<Priority>("high");
  const [bugDesc, setBugDesc] = useState("");
  const [bugSubmitting, setBugSubmitting] = useState(false);
  // null = bug triggered by case-level failed, number = step index that triggered it
  const [bugForStep, setBugForStep] = useState<number | null>(null);

  // Step-level reason modal (Blocked / Skipped)
  const [stepReasonModalOpen, setStepReasonModalOpen] = useState(false);
  const [stepReasonPending, setStepReasonPending] = useState<{ idx: number; status: ResultStatus } | null>(null);
  const [stepReasonText, setStepReasonText] = useState("");

  // Per-step inline API runner
  const [apiStepResults, setApiStepResults] = useState<Record<number, ExecApiResult | "running">>({});

  // Completed-run lock: config "cfg_run_allow_edit_completed" = "true" means editing statuses is allowed
  const allowEditCompleted = localStorage.getItem("cfg_run_allow_edit_completed") === "true";
  const isLocked = !!runCompleted && !allowEditCompleted;
  // Separate config for Actual Result field in completed runs
  const allowActualResultCompleted = localStorage.getItem("cfg_run_allow_actual_result_completed") === "true";
  const isActualResultLocked = !!runCompleted && !allowActualResultCompleted;

  useEffect(() => {
    localStorage.setItem(DOCK_KEY, String(docked));
    onDockChange?.(docked, width);
  }, [docked]);

  useEffect(() => {
    return () => { saveStepState(result.id, { actuals: stepActual, statuses: stepStatuses }); };
  }, [result.id, stepActual, stepStatuses]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  // Reset per-step state when switching to a different test result
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    const savedState = loadStepState(result.id);
    setStepStatuses(savedState?.statuses ?? {});
    setStepActual(savedState?.actuals ?? {});
    setComment(result.comment ?? "");
    setTouchedExpItems(new Set());
    setStepAttachments(attachmentsFromResult(result));
    setExpChecksState(loadExpChecks(result.id));
    setApiStepResults({});
  }, [result.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    resizeStart.current = { mx: e.clientX, w: width };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const newW = Math.max(360, Math.min(window.innerWidth - 200, resizeStart.current.w + (resizeStart.current.mx - ev.clientX)));
      setWidth(newW);
    };
    const onUp = () => {
      resizing.current = false;
      localStorage.setItem(WIDTH_KEY, String(width));
      onDockChange?.(true, width);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp, { once: true });
  }, [width, onDockChange]);

  const buildActualResult = (overrides?: Record<number, string>) => {
    const map = { ...stepActual, ...overrides };
    const steps = testCase?.steps ?? [];
    if (steps.length === 0) return comment || undefined;
    const parts = steps.map((_, i) => map[i] ? `Step ${i + 1}: ${map[i]}` : null).filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : (comment || undefined);
  };

  const attachmentsAsStringKeys = (a: Record<number, string[]>) => {
    const r: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(a)) r[String(k)] = v;
    return r;
  };

  const setStatus = async (status: ResultStatus, reason?: string) => {
    // Auto-start run if it's in ready_to_start status
    if (runStatus === "ready_to_start") {
      try {
        await runsApi.start(result.run_id);
        onAutoStart?.();
        toast.success("Прогон начат!");
      } catch { /* silent */ }
    }
    setSubmitting(true);
    saveStepState(result.id, { actuals: stepActual, statuses: stepStatuses });
    try {
      const commentWithReason = reason
        ? (comment ? `${reason}\n${comment}` : reason)
        : comment || undefined;
      const updated = await runsApi.setResult(result.id, {
        status,
        comment: commentWithReason,
        actual_result: buildActualResult(),
        attachments: attachmentsAsStringKeys(stepAttachments),
      });
      onUpdated(updated);
      toast.success(`Status: ${status}`);
      if (status === "failed") {
        setBugTitle(`Bug: ${testCase?.name ?? "Test case failed"}`);
        setBugDesc(comment || "");
        setReportBugOpen(true);
        // onNext called after bug modal closes
      } else {
        onNext?.();
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSubmitting(false); }
  };

  const handleStatusClick = (status: ResultStatus) => {
    if (isLocked) {
      toast.error("Редактирование результатов завершённого прогона отключено в настройках");
      return;
    }
    const totalSteps = testCase?.steps?.length ?? 0;
    // Validate all step statuses are set before case-level Passed
    if (status === "passed") {
      if (totalSteps > 0 && Object.keys(stepStatuses).length < totalSteps) {
        toast.error("Проставьте статусы для всех шагов тест-кейса перед установкой итогового статуса Passed");
        return;
      }
      const hasActual = buildActualResult() != null;
      if (!hasActual) {
        toast.error("Заполните поле Actual Result перед установкой статуса Passed");
        return;
      }
    }
    // Failed only allowed when at least one step is Failed
    if (status === "failed" && totalSteps > 0) {
      const hasFailedStep = Object.values(stepStatuses).some((s) => s === "failed");
      if (!hasFailedStep) {
        toast.error("Статус Failed на уровне кейса доступен только если хотя бы один шаг имеет статус Failed");
        return;
      }
    }
    // If this is the last untested case, show final confirmation modal
    if (isLastUntested) {
      setFinalModalPending(status);
      setFinalModalOpen(true);
      return;
    }
    if (["blocked", "skipped", "invalid"].includes(status)) {
      setPendingStatus(status);
      setReasonText("");
      setReasonModalOpen(true);
    } else {
      setStatus(status);
    }
  };

  const confirmFinalStatus = (status: ResultStatus) => {
    setFinalModalOpen(false);
    setFinalModalPending(null);
    if (["blocked", "skipped", "invalid"].includes(status)) {
      setPendingStatus(status);
      setReasonText("");
      setReasonModalOpen(true);
    } else {
      setStatus(status);
    }
  };

  const applyStepStatusAndCheck = async (next: Record<number, ResultStatus>) => {
    // Auto-start run
    if (runStatus === "ready_to_start") {
      try { await runsApi.start(result.run_id); onAutoStart?.(); toast.success("Прогон начат!"); } catch { /* silent */ }
    }
    // Check if all steps done → auto-derive case status
    const totalSteps = testCase?.steps?.length ?? 0;
    if (totalSteps > 0 && Object.keys(next).length >= totalSteps) {
      const vals = Object.values(next);
      let derived: ResultStatus = "passed";
      if (vals.some((s) => s === "failed")) derived = "failed";
      else if (vals.some((s) => s === "blocked")) derived = "blocked";
      else if (vals.some((s) => s === "skipped")) derived = "skipped";
      setTimeout(() => {
        if (["blocked", "skipped", "invalid"].includes(derived)) {
          setPendingStatus(derived);
          setReasonText("");
          setReasonModalOpen(true);
        } else {
          setStatus(derived);
        }
      }, 400);
    }
  };

  const setStepStatus = async (i: number, status: ResultStatus) => {
    const step = testCase?.steps?.[i];
    const expList = step ? getStepExpectedResults(step) : [];

    if (status === "passed") {
      // Block Passed if not all expected result checkboxes are checked
      if (expList.length > 0) {
        const checks = expectedChecks[i] ?? [];
        const allChecked = expList.every((_, ei) => checks[ei] === true);
        if (!allChecked) {
          toast.error("Для статуса Passed все Expected Result должны быть отмечены ✓");
          return;
        }
      }
      // Block Passed if Actual Result is empty
      const actualVal = (stepActual[i] ?? "").trim();
      if (!actualVal) {
        toast.error("Заполните поле Actual Result перед установкой статуса Passed");
        return;
      }
    }

    if (status === "failed" && expList.length > 0) {
      // Mark step failed and require defect creation; skip auto-derive to avoid double modal
      const next = { ...stepStatuses, [i]: status };
      setStepStatuses(next);
      saveStepState(result.id, { actuals: stepActual, statuses: next });
      setBugForStep(i);
      setBugTitle(`Bug: Шаг ${i + 1} — ${testCase?.name ?? "Test case"}`);
      setBugDesc("");
      setReportBugOpen(true);
      return;
    }

    if (["blocked", "skipped"].includes(status)) {
      setStepReasonPending({ idx: i, status });
      setStepReasonText("");
      setStepReasonModalOpen(true);
      return;
    }

    const next = { ...stepStatuses, [i]: status };
    setStepStatuses(next);
    saveStepState(result.id, { actuals: stepActual, statuses: next });
    await applyStepStatusAndCheck(next);
  };

  const updateStepActual = (i: number, v: string) => setStepActual((p) => ({ ...p, [i]: v }));

  const runApiStep = useCallback(async (idx: number) => {
    const step = testCase?.steps?.[idx];
    if (!step) return;
    const method = step.api_method ?? (() => {
      const m = step.action?.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/.+)/i);
      return m ? m[1].toUpperCase() : "GET";
    })();
    const url = step.api_url ?? (() => {
      const m = step.action?.match(/^(?:GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/.+)/i);
      return m ? m[1] : "";
    })();
    if (!url) return;
    setApiStepResults((p) => ({ ...p, [idx]: "running" }));
    const t0 = Date.now();
    try {
      const opts: RequestInit = { method };
      if (step.data && method !== "GET" && method !== "HEAD") {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = step.data;
      }
      const resp = await fetch(url, opts);
      const body = await resp.text().catch(() => "");
      const timeMs = Date.now() - t0;
      const res: ExecApiResult = { status: resp.status, statusText: resp.statusText, body, timeMs, ok: resp.ok };
      setApiStepResults((p) => ({ ...p, [idx]: res }));
      updateStepActual(idx, `HTTP ${resp.status} ${resp.statusText} (${timeMs}ms)`);
    } catch (err) {
      const timeMs = Date.now() - t0;
      setApiStepResults((p) => ({ ...p, [idx]: { status: 0, statusText: String(err), body: "", timeMs, ok: false } }));
      updateStepActual(idx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [testCase]);

  const saveStepActual = async (i: number, v: string) => {
    const next = { ...stepActual, [i]: v };
    saveStepState(result.id, { actuals: next, statuses: stepStatuses });
    try { await runsApi.setResult(result.id, { status: result.status, actual_result: buildActualResult({ [i]: v }) }); }
    catch { /* silent */ }
  };

  const persistAttachments = async (next: Record<number, string[]>) => {
    try {
      const updated = await runsApi.setResult(result.id, {
        status: result.status,
        attachments: attachmentsAsStringKeys(next),
      });
      onUpdated(updated);
    } catch {
      toast.error("Не удалось сохранить вложения");
    }
  };

  const handleStepAttachment = async (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setUploadingStep(i);
    for (const file of files) {
      try {
        const att = await attachmentsApi.upload(file, "test_result", result.id, projectId);
        setStepAttachments((p) => {
          const next = { ...p, [i]: [...(p[i] ?? []), att.url] };
          persistAttachments(next);
          return next;
        });
      } catch {
        toast.error(`Не удалось загрузить «${file.name}» в хранилище`);
      }
    }
    setUploadingStep(null);
  };

  const removeAttachment = (stepIdx: number, attachIdx: number) => {
    setStepAttachments((p) => {
      const next = { ...p, [stepIdx]: (p[stepIdx] ?? []).filter((_, i) => i !== attachIdx) };
      persistAttachments(next);
      return next;
    });
  };

  const handleMute = async () => {
    if (!testCase) return;
    setMuting(true);
    try { await casesApi.update(testCase.id, { muted: !testCase.muted } as any); toast.success(testCase.muted ? "Unmuted" : "Muted"); }
    catch { toast.error("Failed"); }
    finally { setMuting(false); }
  };

  const saveComment = async () => {
    if (comment === (result.comment ?? "")) return;
    try { const u = await runsApi.setResult(result.id, { status: result.status, comment, actual_result: buildActualResult() }); onUpdated(u); }
    catch { /* silent */ }
  };

  const handleClose = () => {
    saveStepState(result.id, { actuals: stepActual, statuses: stepStatuses });
    onClose();
  };

  const drawerContent = (
    <div className={`exec-drawer${docked ? "" : " exec-drawer--float"}`} style={docked ? { width } : undefined}>
      {docked && <div className="exec-resize-handle" onMouseDown={onResizeMouseDown} />}

      {/* ── Run progress band ── */}
      {totalCases != null && totalCases > 0 && (
        <div className="exec-progress-band">
          <div className="exec-progress-stats">
            {runStatus && <span className="exec-progress-status">{RUN_STATUS_LABEL[runStatus] ?? runStatus}</span>}
            <span>Кейс <strong>{currentCaseIdx ?? "—"}</strong> из {totalCases}</span>
            <span>Осталось: <strong>{untestedCount ?? "—"}</strong></span>
            {runStartedAt && (runStatus === "in_progress" || runStatus === "on_hold" || runStatus === "completed") && (
              <DrawerTimer startedAt={runStartedAt} completedAt={runStatus === "completed" ? runCompletedAt : undefined} />
            )}
          </div>
          <div className="exec-progress-track">
            <div className="exec-progress-fill" style={{ width: `${Math.round(((totalCases - (untestedCount ?? totalCases)) / totalCases) * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="exec-drawer-header">
        <div className="exec-drawer-header-info">
          {testCase && <div className="exec-drawer-eyebrow">CASE-{testCase.id.slice(0, 6).toUpperCase()}</div>}
          <h2 className="exec-drawer-title">{testCase?.name ?? "—"}</h2>
        </div>
        <div className="exec-header-controls">
          <button className="tc-icon-btn" title={docked ? "Undock" : "Dock"} onClick={() => setDocked((v) => !v)}>
            {docked ? "⧉" : "▣"}
          </button>
          <button className="exec-close-btn" onClick={handleClose}>✕</button>
        </div>
      </div>

      <div className="exec-drawer-actions">
        <button className="exec-action-btn" onClick={() => { navigate(`/project/${projectId}/repository`); handleClose(); }}>◎ View</button>
        <button className="exec-action-btn" onClick={() => { if (testCase) navigate(`/project/${projectId}/repository/case/${testCase.id}/edit`); handleClose(); }}>✎ Edit case</button>
        <button className={"exec-action-btn" + (testCase?.muted ? " exec-action-btn--active" : "")} onClick={handleMute} disabled={muting}>
          🔇 {testCase?.muted ? "Unmute" : "Mute"}
        </button>
      </div>

      {isLocked && (
        <div className="exec-locked-banner">
          🔒 Прогон завершён — редактирование результатов заблокировано в настройках
        </div>
      )}

      <nav className="exec-tabs">
        {(["Execution", "Run History"] as const).map((t) => (
          <button key={t} className={"exec-tab" + (tab === t ? " is-active" : "")} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {tab === "Execution" && (
        <div className="exec-scroll" ref={scrollRef}>
          <div className="exec-status-row">
            {STATUS_BUTTONS.map((b) => (
              <button key={b.status}
                className={"exec-status-btn " + b.cls + (result.status === b.status ? " is-active" : "") + (isLocked ? " exec-btn-locked" : "")}
                onClick={() => handleStatusClick(b.status)}
                disabled={submitting || isLocked}
                title={isLocked ? "Прогон завершён — редактирование заблокировано" : undefined}
              >
                <span className="exec-status-icon">{b.icon}</span>{b.label}
              </button>
            ))}
          </div>

          {testCase?.description && <Section title="Description"><p>{testCase.description}</p></Section>}
          {testCase?.pre_conditions && (
            <Section title="Pre-conditions">
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6, color: "var(--color-text-muted)" }}>
                {testCase.pre_conditions}
              </div>
            </Section>
          )}

          {testCase?.steps && testCase.steps.length > 0 && (
            <Section title="Steps">
              <ol className="exec-steps">
                {testCase.steps.map((s, i) => {
                  const stepSt = stepStatuses[i];
                  return (
                    <li key={i} className={"exec-step" + (stepSt ? ` exec-step--${stepSt}` : "")}>
                      <div className="exec-step-num">{i + 1}</div>
                      <div className="exec-step-body">
                        <div className="exec-step-action">{s.action}</div>
                        {s.data && <div className="exec-step-block"><div className="exec-step-label">Test data</div><div className="exec-step-text">{s.data}</div></div>}
                        {getStepExpectedResults(s).length > 0 && (
                          <div className="exec-step-block">
                            <div className="exec-step-label">Expected results</div>
                            <div className="exec-expected-list">
                              {getStepExpectedResults(s).map((exp, ei) => {
                                const checked = expectedChecks[i]?.[ei] ?? false;
                                return (
                                  <label key={ei} className={"exec-expected-item" + (checked ? " is-checked" : "")}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={isLocked}
                                      onChange={async (e) => {
                                        const arr = [...(expectedChecks[i] ?? Array(getStepExpectedResults(s).length).fill(false))];
                                        arr[ei] = e.target.checked;
                                        setTouchedExpItems((prev) => new Set([...prev, `${i}-${ei}`]));
                                        const next = { ...expectedChecks, [i]: arr };
                                        setExpectedChecks(next);
                                        saveExpChecks(result.id, next);
                                        if (runStatus === "ready_to_start") {
                                          try { await runsApi.start(result.run_id); onAutoStart?.(); } catch { /* silent */ }
                                        }
                                      }}
                                    />
                                    <span className="exec-expected-text">{exp}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {testCase?.layer === "api" && (() => {
                          const url = s.api_url || s.action?.match(/https?:\/\/[^\s]+/)?.[0];
                          if (!url) return null;
                          const ar = apiStepResults[i];
                          const method = s.api_method ?? (s.action?.match(/^(GET|POST|PUT|PATCH|DELETE)\s+/i)?.[1]?.toUpperCase() ?? "GET");
                          return (
                            <div className="exec-api-runner">
                              <div className="exec-api-endpoint">
                                <span className="exec-api-method" style={{ color: EXEC_API_COLORS[method] ?? "#6b7280" }}>{method}</span>
                                <span className="exec-api-url">{url.length > 60 ? url.slice(0, 60) + "…" : url}</span>
                              </div>
                              <button
                                className="exec-api-run-btn"
                                style={{ color: EXEC_API_COLORS[method] ?? "#6b7280", borderColor: EXEC_API_COLORS[method] ?? "#6b7280" }}
                                disabled={ar === "running"}
                                onClick={() => runApiStep(i)}
                              >
                                {ar === "running" ? "⏳ Отправка…" : "▶ Отправить запрос"}
                              </button>
                              {ar && ar !== "running" && (
                                <div className={"exec-api-result" + (ar.ok ? " exec-api-result--ok" : " exec-api-result--fail")}>
                                  <span className="exec-api-result-status">
                                    {ar.ok ? "✓" : "✕"} {ar.status} {ar.statusText}
                                  </span>
                                  <span className="exec-api-result-time">{ar.timeMs}ms</span>
                                  {ar.body && (
                                    <pre className="exec-api-result-body">{ar.body.length > 500 ? ar.body.slice(0, 500) + "…" : ar.body}</pre>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        <div className="exec-step-btns">
                          {STEP_STATUS_BTNS.map((b) => (
                            <button key={b.status}
                              className={"exec-step-btn " + b.cls + (stepSt === b.status ? " is-active" : "") + (isLocked ? " exec-btn-locked" : "")}
                              disabled={isLocked}
                              title={isLocked ? "Прогон завершён — редактирование заблокировано" : undefined}
                              onClick={() => !isLocked && setStepStatus(i, b.status)}
                            >{b.label}</button>
                          ))}
                        </div>
                        <div className="exec-actual-label">Actual result</div>
                        <input
                          className={"exec-actual-input" + (isActualResultLocked ? " exec-actual-locked" : "")}
                          type="text"
                          value={stepActual[i] ?? ""}
                          disabled={isActualResultLocked}
                          title={isActualResultLocked ? "Прогон завершён — редактирование Actual Result отключено в Configurations → Test Runs" : undefined}
                          onChange={(e) => updateStepActual(i, e.target.value)}
                          onBlur={(e) => saveStepActual(i, e.target.value)}
                        />
                        <div className="exec-step-attach-row">
                          {!runCompleted && (
                            <label className="exec-step-attach-btn">
                              <input type="file" accept={MEDIA_ACCEPT} multiple style={{ display: "none" }} onChange={(e) => handleStepAttachment(i, e)} />
                              {uploadingStep === i ? "Загрузка…" : "+ Add attachment"}
                            </label>
                          )}
                          {(stepAttachments[i] ?? []).map((url, ai) => (
                            <div key={ai} style={{ position: "relative", display: "inline-block" }}>
                              <MediaThumb url={url} className="exec-step-attach-thumb" onOpen={setLightboxSrc} />
                              {!runCompleted && (
                                <button
                                  onClick={() => removeAttachment(i, ai)}
                                  style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "#dc2626", color: "#fff", border: "none", cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                                >✕</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Section>
          )}

          {testCase?.post_conditions && <Section title="Post-conditions"><p>{testCase.post_conditions}</p></Section>}

          <Section title="Comment">
            <textarea className="input exec-comment" rows={3} placeholder="Optional comment" value={comment} onChange={(e) => setComment(e.target.value)} onBlur={saveComment} />
          </Section>
        </div>
      )}

      {tab === "Run History" && (
        <div className="exec-run-history">
          <RunHistoryTab testCaseId={result.test_case_id} projectId={projectId} />
        </div>
      )}
    </div>
  );

  const submitBug = async () => {
    if (!bugTitle.trim()) return;
    setBugSubmitting(true);
    try {
      const preCondText = testCase?.pre_conditions ?? undefined;
      const stepsText = testCase?.steps?.length
        ? testCase.steps.map((s, i) => `${i + 1}. ${s.action}${s.data ? ` [Data: ${s.data}]` : ""}`).join("\n")
        : undefined;
      const expectedText = testCase?.steps?.length
        ? testCase.steps.flatMap((s, i) => {
            const exps = s.expected_results?.length ? s.expected_results : s.expected ? [s.expected] : [];
            return exps.map((e) => `Step ${i + 1}: ${e}`);
          }).join("\n") || undefined
        : undefined;
      await defectsApi.create({
        title: bugTitle.trim(),
        severity: bugSeverity,
        priority: bugPriority,
        pre_conditions: preCondText,
        steps_to_reproduce: stepsText,
        expected_result: expectedText,
        actual_result: buildActualResult() || bugDesc.trim() || undefined,
        description: bugDesc.trim() || undefined,
        project_id: projectId,
        test_run_id: result.run_id,
        test_result_id: result.id,
        // скриншоты/видео шагов — те же файлы MinIO, что и у результата
        attachments: Object.keys(stepAttachments).map(Number).sort((a, b) => a - b)
          .flatMap((k) => stepAttachments[k] ?? []),
      });
      toast.success("Дефект создан");
      setReportBugOpen(false);
      const wasStep = bugForStep !== null;
      setBugForStep(null);
      if (!wasStep) onNext?.();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBugSubmitting(false); }
  };

  const reportBugModal = reportBugOpen ? createPortal(
    <div className="modal-backdrop" onClick={() => { setReportBugOpen(false); setBugForStep(null); }}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ padding: "14px 20px 10px" }}>
          <h2 className="modal-title" style={{ fontSize: 15 }}>
            {bugForStep !== null ? `🐛 Дефект: шаг ${bugForStep + 1}` : "🐛 Создать отчёт о дефекте?"}
          </h2>
          <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-muted)" }} onClick={() => { setReportBugOpen(false); setBugForStep(null); }}>✕</button>
        </div>
        <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div className="form-label">Название дефекта *</div>
            <input className="input" style={{ width: "100%" }} value={bugTitle} onChange={(e) => setBugTitle(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div className="form-label">Severity</div>
              <select className="input" style={{ width: "100%" }} value={bugSeverity} onChange={(e) => setBugSeverity(e.target.value as Severity)}>
                {SEVERITY.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div className="form-label">Priority</div>
              <select className="input" style={{ width: "100%" }} value={bugPriority} onChange={(e) => setBugPriority(e.target.value as Priority)}>
                {PRIORITY.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div className="form-label">Описание</div>
            <textarea className="input" rows={3} style={{ width: "100%", resize: "vertical" }} value={bugDesc} onChange={(e) => setBugDesc(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 20px 16px", justifyContent: "flex-end", borderTop: "1px solid var(--color-border)" }}>
          <button className="btn btn-primary" onClick={submitBug} disabled={bugSubmitting || !bugTitle.trim()}>
            {bugSubmitting ? "Создаём…" : "Создать дефект"}
          </button>
          <button className="btn" onClick={() => { setReportBugOpen(false); const wasStep = bugForStep !== null; setBugForStep(null); if (!wasStep) onNext?.(); }}>Пропустить</button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const finalStatusModal = finalModalOpen ? createPortal(
    <div className="modal-backdrop" onClick={() => setFinalModalOpen(false)}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ padding: "14px 20px 10px" }}>
          <h2 className="modal-title" style={{ fontSize: 15 }}>Какой статус у запуска этого тест-кейса?</h2>
          <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-muted)" }} onClick={() => setFinalModalOpen(false)}>✕</button>
        </div>
        <div style={{ padding: "10px 20px 4px", fontSize: 13, color: "var(--color-text-muted)" }}>
          Это последний тест-кейс в прогоне. Выберите итоговый статус.
        </div>
        <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          {STATUS_BUTTONS.map((b) => (
            <button
              key={b.status}
              className={"exec-status-btn " + b.cls + (finalModalPending === b.status ? " is-active" : "")}
              style={{ justifyContent: "flex-start", padding: "10px 16px", width: "100%" }}
              onClick={() => confirmFinalStatus(b.status)}
            >
              <span className="exec-status-icon">{b.icon}</span>{b.label}
            </button>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={() => setFinalModalOpen(false)}>Отмена</button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const reasonModal = reasonModalOpen ? createPortal(
    <div className="modal-backdrop" onClick={() => setReasonModalOpen(false)}>
      <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ padding: "14px 20px 10px" }}>
          <h2 className="modal-title" style={{ fontSize: 15 }}>
            {pendingStatus === "blocked" ? "⊘ Укажите причину блокировки" :
             pendingStatus === "skipped" ? "→ Укажите причину пропуска" :
             "♡ Укажите причину"}
          </h2>
          <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-muted)" }} onClick={() => setReasonModalOpen(false)}>✕</button>
        </div>
        <div style={{ padding: "12px 20px 16px" }}>
          <div className="form-label">Причина *</div>
          <textarea
            className="input"
            rows={3}
            style={{ width: "100%", resize: "vertical" }}
            placeholder="Опишите причину..."
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ display: "flex", gap: 8, padding: "0 20px 16px", justifyContent: "flex-end", borderTop: "1px solid var(--color-border)" }}>
          <button
            className="btn btn-primary"
            disabled={!reasonText.trim()}
            onClick={async () => {
              if (!pendingStatus || !reasonText.trim()) return;
              setReasonModalOpen(false);
              await setStatus(pendingStatus, reasonText.trim());
              setPendingStatus(null);
              setReasonText("");
            }}
          >
            Сохранить
          </button>
          <button className="btn" onClick={() => { setReasonModalOpen(false); setPendingStatus(null); }}>Отмена</button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const lightbox = lightboxSrc ? createPortal(
    <div className="exec-lightbox" onClick={() => setLightboxSrc(null)}>
      <img src={lightboxSrc} alt="" className="exec-lightbox-img" onClick={(e) => e.stopPropagation()} />
      <button className="exec-lightbox-close" onClick={() => setLightboxSrc(null)}>✕</button>
    </div>,
    document.body
  ) : null;

  const stepReasonModal = stepReasonModalOpen ? createPortal(
    <div className="modal-backdrop" onClick={() => setStepReasonModalOpen(false)}>
      <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ padding: "14px 20px 10px" }}>
          <h2 className="modal-title" style={{ fontSize: 15 }}>
            {stepReasonPending?.status === "blocked"
              ? `⊘ Причина блокировки шага ${(stepReasonPending?.idx ?? 0) + 1}`
              : `→ Причина пропуска шага ${(stepReasonPending?.idx ?? 0) + 1}`}
          </h2>
          <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-muted)" }} onClick={() => { setStepReasonModalOpen(false); setStepReasonPending(null); }}>✕</button>
        </div>
        <div style={{ padding: "12px 20px 16px" }}>
          <div className="form-label">Причина *</div>
          <textarea
            className="input"
            rows={3}
            style={{ width: "100%", resize: "vertical" }}
            placeholder="Опишите причину..."
            value={stepReasonText}
            onChange={(e) => setStepReasonText(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ display: "flex", gap: 8, padding: "0 20px 16px", justifyContent: "flex-end", borderTop: "1px solid var(--color-border)" }}>
          <button
            className="btn btn-primary"
            disabled={!stepReasonText.trim()}
            onClick={async () => {
              if (!stepReasonPending || !stepReasonText.trim()) return;
              const { idx, status } = stepReasonPending;
              setStepReasonModalOpen(false);
              setStepReasonPending(null);
              setStepReasonText("");
              const next = { ...stepStatuses, [idx]: status };
              setStepStatuses(next);
              saveStepState(result.id, { actuals: stepActual, statuses: next });
              await applyStepStatusAndCheck(next);
            }}
          >
            Сохранить
          </button>
          <button className="btn" onClick={() => { setStepReasonModalOpen(false); setStepReasonPending(null); }}>Отмена</button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  if (!docked) {
    return createPortal(
      <>
        <div className="exec-float-backdrop" onClick={(e) => e.target === e.currentTarget && handleClose()}>
          {drawerContent}
        </div>
        {lightbox}
        {reportBugModal}
        {reasonModal}
        {finalStatusModal}
        {stepReasonModal}
      </>,
      document.body
    );
  }
  return <>{drawerContent}{lightbox}{reportBugModal}{reasonModal}{finalStatusModal}{stepReasonModal}</>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="exec-section">
      {title && <h3 className="exec-section-title">{title}</h3>}
      <div>{children}</div>
    </section>
  );
}

const RUN_STATUS_LABEL: Record<string, string> = {
  ready_to_start: "Готов к запуску",
  in_progress: "В процессе",
  on_hold: "На паузе",
  completed: "Завершён",
};

function DrawerTimer({ startedAt, completedAt }: { startedAt: string; completedAt?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    if (completedAt) {
      // Frozen — show final duration
      setElapsed(Math.max(0, new Date(completedAt).getTime() - start));
      return;
    }
    const upd = () => setElapsed(Math.max(0, Date.now() - start));
    upd();
    const id = setInterval(upd, 1000);
    return () => clearInterval(id);
  }, [startedAt, completedAt]);
  const s = Math.floor(elapsed / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const fmt = h > 0 ? `${h}ч ${m % 60}м ${s % 60}с` : m > 0 ? `${m}м ${s % 60}с` : `${s}с`;
  return <span className="exec-drawer-timer">⏱ {fmt}</span>;
}

// ── Run History Tab ───────────────────────────────────────────────────────────

const RH_STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  passed:      { color: "#15803d", bg: "#dcfce7" },
  failed:      { color: "#dc2626", bg: "#fee2e2" },
  blocked:     { color: "#ca8a04", bg: "#fef3c7" },
  untested:    { color: "#6b7280", bg: "#f3f4f6" },
  skipped:     { color: "#9ca3af", bg: "#f9fafb" },
  invalid:     { color: "#7c3aed", bg: "#ede9fe" },
  in_progress: { color: "#1d4ed8", bg: "#dbeafe" },
  retest:      { color: "#0e7490", bg: "#cffafe" },
};

function RunHistoryTab({ testCaseId, projectId }: { testCaseId: string; projectId: string }) {
  const [rows, setRows] = useState<Array<{ run: TestRun; result: TestResult }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    runsApi.list(projectId).then(async (runs) => {
      const all = await Promise.all(
        runs.slice(0, 30).map(async (run) => {
          try {
            const res = await runsApi.results(run.id);
            const found = res.find((r) => r.test_case_id === testCaseId);
            return found ? { run, result: found } : null;
          } catch { return null; }
        })
      );
      setRows(all.filter(Boolean) as Array<{ run: TestRun; result: TestResult }>);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [testCaseId, projectId]);

  if (loading) return <div className="exec-rh-empty">Loading run history…</div>;
  if (rows.length === 0) return <div className="exec-rh-empty">No run history for this test case yet.</div>;

  return (
    <table className="exec-rh-table">
      <thead>
        <tr>
          <th>Test Run</th>
          <th>Date</th>
          <th>Environment</th>
          <th>Status</th>
          <th>Comment</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ run, result }) => {
          const m = RH_STATUS_COLORS[result.status] ?? RH_STATUS_COLORS.untested;
          return (
            <tr key={run.id}>
              <td style={{ fontWeight: 500 }}>{run.name}</td>
              <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                {result.executed_at ? new Date(result.executed_at).toLocaleDateString("ru-RU") : "—"}
              </td>
              <td style={{ color: "var(--color-text-muted)" }}>{run.environment ?? "—"}</td>
              <td>
                <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: m.bg, color: m.color }}>
                  {result.status}
                </span>
              </td>
              <td style={{ color: "var(--color-text-muted)", fontSize: 11 }}>{result.comment ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
