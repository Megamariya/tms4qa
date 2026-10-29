import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  casesApi, runsApi, defectsApi,
  getStepExpectedResults,
  SEVERITY, PRIORITY, CASE_STATUS, CASE_TYPE, BEHAVIOR, LAYER, AUTOMATION_STATUS,
  type TestCase, type Step, type TestResult, type TestRun, type Defect,
} from "../api/client";
import { useToast } from "./Toast";
import { CaseStatusIcon } from "./CaseStatusIcon";
import "./TestCaseDrawer.css";

interface Props {
  testCase: TestCase;
  projectId?: string;
  suiteName?: string;
  suitePath?: string[];
  displayIdx?: number;
  displayPrefix?: string;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onUpdated?: (tc: TestCase) => void;
}

const labelize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

type TcTab = "General" | "Run History" | "Change History" | "Defects" | "Comments" | "API check";

const DOCK_KEY  = "tc_drawer_docked";
const WIDTH_KEY = "tc_drawer_width";

function storePrev(tc: TestCase) {
  try {
    localStorage.setItem(`tc_prev_${tc.id}`, JSON.stringify({
      title: tc.name, description: tc.description,
      pre_conditions: tc.pre_conditions, post_conditions: tc.post_conditions,
      steps: tc.steps, severity: tc.severity, priority: tc.priority,
      status: tc.status, type: tc.type,
      behavior: tc.behavior, layer: tc.layer,
      automation_status: tc.automation_status, is_flaky: tc.is_flaky,
      tags: tc.tags,
      savedAt: new Date().toISOString(),
    }));
  } catch { /* noop */ }
}
function loadPrev(id: string) {
  try { const r = localStorage.getItem(`tc_prev_${id}`); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const IEdit  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const ICopy  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>;
const ITrash = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>;
const IPlay  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
const IUndock = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="1" y="5" width="8" height="8" rx="1"/><path d="M8 1h7v7"/><path d="M9 8L15 2"/></svg>;
const IDock   = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="1" y="1" width="14" height="14" rx="1"/><line x1="9" y1="1" x2="9" y2="15"/></svg>;
const IClose  = () => <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="1" y1="1" x2="10" y2="10"/><line x1="11" y1="1" x2="1" y2="10"/></svg>;
const IExport = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;

// ── API step constants ────────────────────────────────────────────────────────
const API_STEP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const API_STEP_COLORS: Record<string, string> = {
  GET: "#16a34a", POST: "#1d4ed8", PUT: "#ca8a04", PATCH: "#7c3aed", DELETE: "#dc2626",
};

// ── Field height persistence (manual resize + autogrow survive save/reopen) ───
function readFieldHeight(key: string): number | null {
  try { const v = localStorage.getItem(`tc_field_h_${key}`); return v ? Number(v) : null; } catch { return null; }
}
function writeFieldHeight(key: string, h: number) {
  try { localStorage.setItem(`tc_field_h_${key}`, String(h)); } catch { /* noop */ }
}

// Wraps long text, lets the user manually drag-resize, and auto-grows as you
// type/press Enter — without ever shrinking below a manually-set height.
function AutoGrowTextarea({
  value, onChange, placeholder, className, heightKey, minHeight = 30,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  heightKey: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    const saved = readFieldHeight(heightKey);
    ta.style.height = "auto";
    const natural = ta.scrollHeight;
    ta.style.height = Math.max(saved ?? minHeight, natural, minHeight) + "px";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    const ro = new ResizeObserver(() => {
      // Right before unmount, browsers can report one last resize with a
      // collapsed (0) size — ignore it so it doesn't clobber the saved height.
      if (ta.offsetHeight > 0) writeFieldHeight(heightKey, ta.offsetHeight);
    });
    ro.observe(ta);
    return () => ro.disconnect();
  }, [heightKey]);

  return (
    <textarea
      ref={ref}
      className={className}
      placeholder={placeholder}
      value={value}
      style={{ resize: "vertical", overflow: "hidden", minHeight, lineHeight: "1.4", wordBreak: "break-word" }}
      onChange={(e) => onChange(e.target.value)}
      onInput={(e) => {
        const ta = e.currentTarget;
        if (ta.scrollHeight > ta.clientHeight) ta.style.height = ta.scrollHeight + "px";
      }}
    />
  );
}

// ── Stable top-level component for step inline editor ────────────────────────
interface StepRowProps {
  step: Step; idx: number;
  caseId: string;
  isApiLayer?: boolean;
  onUpdate: (i: number, f: keyof Step, v: string | number | null) => void;
  onUpdateMulti: (i: number, patch: Partial<Step>) => void;
  onDelete: (i: number) => void;
  onDuplicate: (i: number) => void;
  onImg: (i: number, e: React.ChangeEvent<HTMLInputElement>) => void;
  fileRef: (el: HTMLInputElement | null) => void;
  onAddExpected: (stepIdx: number) => void;
  onUpdateExpected: (stepIdx: number, expIdx: number, v: string) => void;
  onDeleteExpected: (stepIdx: number, expIdx: number) => void;
}
function StepEditorRow({ step, idx, caseId, isApiLayer, onUpdate, onUpdateMulti, onDelete, onDuplicate, onImg, fileRef, onAddExpected, onUpdateExpected, onDeleteExpected }: StepRowProps) {
  const expectedList = step.expected_results && step.expected_results.length > 0
    ? step.expected_results
    : step.expected ? [step.expected] : [""];
  return (
    <div className="ise-row">
      <div className="ise-num">{idx + 1}</div>
      <div className="ise-fields">
        <AutoGrowTextarea className="ise-input" placeholder="Action" value={step.action}
          heightKey={`${caseId}_${idx}_action`}
          onChange={(v) => onUpdate(idx, "action", v)} />
        <AutoGrowTextarea className="ise-input ise-input--sm" placeholder="Data (optional)" value={step.data ?? ""}
          heightKey={`${caseId}_${idx}_data`}
          onChange={(v) => onUpdate(idx, "data", v)} />
        <div className="ise-expected-section">
          <div className="ise-expected-label">Expected results</div>
          {expectedList.map((ex, ei) => (
            <div key={ei} className="ise-exp-row">
              <textarea
                className="ise-input ise-input--sm ise-exp-input"
                placeholder={`Expected result ${ei + 1}`}
                value={ex}
                rows={1}
                style={{ resize: "none", overflow: "hidden", minHeight: 30, lineHeight: "1.4" }}
                onInput={(e) => {
                  const ta = e.currentTarget;
                  ta.style.height = "auto";
                  ta.style.height = ta.scrollHeight + "px";
                }}
                onChange={(e) => onUpdateExpected(idx, ei, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const ta = e.currentTarget;
                    const pos = ta.selectionStart ?? ta.value.length;
                    const before = ta.value.slice(0, pos);
                    const after = ta.value.slice(ta.selectionEnd ?? pos);
                    const newVal = before + "\n• " + after;
                    onUpdateExpected(idx, ei, newVal);
                    requestAnimationFrame(() => {
                      ta.style.height = "auto";
                      ta.style.height = ta.scrollHeight + "px";
                      ta.selectionStart = ta.selectionEnd = pos + 3;
                    });
                  }
                }}
              />
              {expectedList.length > 1 && (
                <button className="ise-exp-del" title="Remove" onClick={() => onDeleteExpected(idx, ei)}>✕</button>
              )}
            </div>
          ))}
          <button className="ise-exp-add" onClick={() => onAddExpected(idx)}>+ Add expected</button>
        </div>
        {isApiLayer && (
          <div style={{ marginTop: 6 }}>
            <div className="ise-expected-label">Метод и URL запроса</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <select
                className="ise-input ise-input--sm"
                style={{ flex: "0 0 105px", color: API_STEP_COLORS[step.api_method ?? "GET"] ?? "#6b7280", fontWeight: 700 }}
                value={step.api_method ?? "GET"}
                onChange={(e) => {
                  const m = e.target.value;
                  const url = step.api_url ?? "";
                  onUpdateMulti(idx, { api_method: m, action: `Отправить запрос методом ${m} на ${url}` });
                }}>
                {API_STEP_METHODS.map((m) => (
                  <option key={m} value={m} style={{ color: API_STEP_COLORS[m] }}>{m}</option>
                ))}
              </select>
              <input
                className="ise-input ise-input--sm"
                style={{ flex: 1 }}
                placeholder="https://api.example.com/endpoint"
                value={step.api_url ?? ""}
                onChange={(e) => {
                  const url = e.target.value;
                  const m = step.api_method ?? "GET";
                  onUpdateMulti(idx, { api_url: url, action: `Отправить запрос методом ${m} на ${url}` });
                }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: "0 0 140px" }}>
                <div className="ise-expected-label">Ожидаемый статус</div>
                <input className="ise-input ise-input--sm" type="number" placeholder="200"
                  value={step.api_expected_status ?? ""}
                  onChange={(e) => onUpdate(idx, "api_expected_status", e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="ise-expected-label">Contract (JSON schema)</div>
                <input className="ise-input ise-input--sm" placeholder='{"id":"number","name":"string"}'
                  value={step.api_contract ?? ""}
                  onChange={(e) => onUpdate(idx, "api_contract", e.target.value)} />
              </div>
            </div>
          </div>
        )}
        {(step.attachments ?? []).length > 0 && (
          <div className="ise-attach-row">
            {(step.attachments ?? []).map((u, ai) => <img key={ai} src={u} alt="" className="tc-step-thumb" />)}
          </div>
        )}
      </div>
      <div className="ise-actions">
        <label className="ise-img-btn" title="Add image">🖼
          <input type="file" accept="image/*" style={{ display: "none" }}
            ref={fileRef} onChange={(e) => onImg(idx, e)} />
        </label>
        <button className="ise-dup-btn" title="Дублировать шаг" onClick={() => onDuplicate(idx)}>⧉</button>
        <button className="ise-del-btn" onClick={() => onDelete(idx)}>✕</button>
      </div>
    </div>
  );
}

// ── Test case HTML export ─────────────────────────────────────────────────────
function generateTestCaseHTML(tc: TestCase, suitePath?: string[]): string {
  const pathStr = suitePath?.length ? suitePath.join(" / ") : "";
  const expHtml = (step: Step) => {
    const list = step.expected_results?.length ? step.expected_results : step.expected ? [step.expected] : [];
    if (!list.length) return "—";
    if (list.length === 1) return list[0];
    return `<ul style="margin:0;padding-left:16px">${list.map((e) => `<li>${e}</li>`).join("")}</ul>`;
  };
  const stepsRows = tc.steps.length > 0
    ? tc.steps.map((s, i) => `
      <tr>
        <td style="text-align:center;border:1px solid #ccc;padding:6px 8px;font-weight:700">${i + 1}</td>
        <td style="border:1px solid #ccc;padding:6px 8px">${s.action ?? "—"}${s.data ? `<br><em style="color:#666;font-size:11px">Data: ${s.data}</em>` : ""}</td>
        <td style="border:1px solid #ccc;padding:6px 8px">${expHtml(s)}</td>
      </tr>`).join("")
    : `<tr><td colspan="3" style="border:1px solid #ccc;padding:8px;color:#888;text-align:center">No steps</td></tr>`;

  const badge = (label: string, val?: string | null) =>
    val ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;border:1px solid #e0e0e0;font-size:11px;margin:0 4px 4px 0;background:#f7f8fa">${label}: <strong>${val}</strong></span>` : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>Тест-кейс: ${tc.name}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:0;background:#d4d4d4}
  .page{background:#fff;max-width:794px;margin:20px auto;padding:40px 52px 56px;box-shadow:0 4px 24px rgba(0,0,0,.18);box-sizing:border-box}
  h1{font-size:18px;font-weight:700;margin:0 0 8px}
  h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px;border-bottom:2px solid #222;padding-bottom:3px}
  .path{font-size:12px;color:#666;margin-bottom:12px}
  .props{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
  th{background:#efefef;border:1px solid #ccc;padding:6px 8px;text-align:left;font-weight:600}
  .field{border-bottom:1px solid #eee;padding:7px 0}
  .field-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:2px}
  .field-value{font-size:13px;white-space:pre-wrap}
  .footer{text-align:center;color:#b0b0b0;font-size:10px;margin-top:36px;border-top:1px solid #eee;padding-top:10px}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:15mm 20mm}@page{size:A4;margin:12mm}}
</style></head>
<body><div class="page">
  <h1>${tc.name}</h1>
  ${pathStr ? `<div class="path">📁 ${pathStr}</div>` : ""}
  <div class="props">
    ${badge("Severity", tc.severity)}${badge("Priority", tc.priority)}${badge("Type", tc.type)}${badge("Layer", tc.layer)}${badge("Status", tc.status)}${badge("Automation", tc.automation_status)}
  </div>

  ${tc.description ? `<h2>Description</h2><div class="field-value">${tc.description}</div>` : ""}
  ${tc.pre_conditions ? `<h2>Pre-conditions</h2><div class="field-value">${tc.pre_conditions}</div>` : ""}

  <h2>Steps</h2>
  <table>
    <thead><tr><th style="width:32px">№</th><th style="width:40%">Action</th><th>Expected result</th></tr></thead>
    <tbody>${stepsRows}</tbody>
  </table>

  ${tc.post_conditions ? `<h2>Post-conditions</h2><div class="field-value">${tc.post_conditions}</div>` : ""}

  <div class="footer">4QA TMS · ${new Date().toLocaleDateString("ru-RU")}</div>
</div></body></html>`;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TestCaseDrawer({
  testCase: tc, projectId, suiteName, suitePath, displayIdx, displayPrefix = "#", onClose, onEdit, onDelete, onUpdated,
}: Props) {
  const navigate = useNavigate();
  const toast    = useToast();

  const [docked, setDocked]     = useState(() => localStorage.getItem(DOCK_KEY) !== "false");
  const [width, setWidth]       = useState(() => Math.max(340, Number(localStorage.getItem(WIDTH_KEY)) || 400));
  const [activeTab, setActiveTab] = useState<TcTab>("General");
  const [stepsView, setStepsView] = useState<"table" | "list">("list");

  const [editingSteps, setEditingSteps] = useState(false);
  const [draftSteps, setDraftSteps]     = useState<Step[]>([]);
  const [saving, setSaving]             = useState(false);
  const [launching, setLaunching]       = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [lightbox, setLightbox]         = useState<{ src: string; title: string } | null>(null);
  const [qrOpen, setQrOpen]             = useState(false);
  const [qrName, setQrName]             = useState("");
  const [qrEnv, setQrEnv]               = useState("");
  const [qrDesc, setQrDesc]             = useState("");
  const [qrDeviceType, setQrDeviceType] = useState("");
  const [qrOs, setQrOs]                 = useState("");
  const [qrOsVersion, setQrOsVersion]   = useState("");
  const [inlineField, setInlineField]   = useState<string | null>(null);
  const [inlineValue, setInlineValue]   = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal]         = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const resizing     = useRef(false);
  const resizeStart  = useRef({ mx: 0, w: 400 });
  const stepFileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => { localStorage.setItem(DOCK_KEY,  String(docked)); }, [docked]);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(width)); },  [width]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !editingSteps) onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose, editingSteps]);
  useEffect(() => { setExpandedSteps(new Set()); setEditingSteps(false); }, [tc.id]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    resizeStart.current = { mx: e.clientX, w: width };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      setWidth(Math.max(300, Math.min(window.innerWidth - 400, resizeStart.current.w + (resizeStart.current.mx - ev.clientX))));
    };
    const onUp = () => { resizing.current = false; document.removeEventListener("mousemove", onMove); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp, { once: true });
  }, [width]);

  const openQuickRun = () => {
    if (!projectId) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    setQrName(`Quick run: ${tc.name.slice(0, 40)} — ${now.toLocaleDateString("ru-RU")} ${hh}:${mm}:${ss}`);
    setQrEnv(""); setQrDesc("");
    setQrDeviceType(""); setQrOs(""); setQrOsVersion("");
    setQrOpen(true);
  };

  const launchQuickRun = async () => {
    if (!projectId || !qrName.trim()) return;
    setLaunching(true);
    try {
      const run = await runsApi.create({
        project_id: projectId,
        name: qrName.trim(),
        description: qrDesc.trim() || undefined,
        environment: qrEnv.trim() || undefined,
        device_type: qrDeviceType || null,
        os: qrOs.trim() || null,
        os_version: qrOsVersion.trim() || null,
        test_case_ids: [tc.id],
      });
      toast.success("Прогон создан"); setQrOpen(false); onClose();
      navigate(`/project/${projectId}/run/${run.id}`);
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
    finally { setLaunching(false); }
  };

  const startEdit = useCallback(() => {
    setDraftSteps(tc.steps.map((s) => ({ ...s, attachments: [...(s.attachments ?? [])] })));
    setEditingSteps(true);
  }, [tc.steps]);

  const duplicateStep = useCallback((i: number) =>
    setDraftSteps((p) => {
      const next = [...p];
      next.splice(i + 1, 0, { ...p[i], expected_results: [...(p[i].expected_results ?? [])], attachments: [] });
      return next;
    }), []);

  const saveSteps = async () => {
    setSaving(true);
    try {
      storePrev(tc);
      const updated = await casesApi.update(tc.id, { steps: draftSteps } as any);
      toast.success("Steps saved"); setEditingSteps(false); onUpdated?.(updated);
    } catch (e: any) { toast.error(e.message ?? "Save failed"); }
    finally { setSaving(false); }
  };

  const updateStep = useCallback((i: number, f: keyof Step, v: string | number | null) =>
    setDraftSteps((p) => p.map((s, j) => j === i ? { ...s, [f]: v } : s)), []);

  const updateStepMulti = useCallback((i: number, patch: Partial<Step>) =>
    setDraftSteps((p) => p.map((s, j) => j === i ? { ...s, ...patch } : s)), []);

  const deleteStep = useCallback((i: number) =>
    setDraftSteps((p) => p.filter((_, j) => j !== i)), []);

  const addExpected = useCallback((stepIdx: number) =>
    setDraftSteps((p) => p.map((s, j) => {
      if (j !== stepIdx) return s;
      const cur = s.expected_results?.length ? s.expected_results : (s.expected ? [s.expected] : [""]);
      return { ...s, expected_results: [...cur, ""], expected: null };
    })), []);

  const updateExpected = useCallback((stepIdx: number, expIdx: number, v: string) =>
    setDraftSteps((p) => p.map((s, j) => {
      if (j !== stepIdx) return s;
      const cur = [...(s.expected_results?.length ? s.expected_results : (s.expected ? [s.expected] : [""]))];
      while (cur.length <= expIdx) cur.push("");
      cur[expIdx] = v;
      return { ...s, expected_results: cur, expected: null };
    })), []);

  const deleteExpected = useCallback((stepIdx: number, expIdx: number) =>
    setDraftSteps((p) => p.map((s, j) => {
      if (j !== stepIdx) return s;
      const cur = s.expected_results?.length ? s.expected_results : (s.expected ? [s.expected] : []);
      return { ...s, expected_results: cur.filter((_, ei) => ei !== expIdx), expected: null };
    })), []);

  const handleStepImg = useCallback((i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) =>
      setDraftSteps((p) => p.map((s, j) => j === i ? { ...s, attachments: [...(s.attachments ?? []), ev.target?.result as string] } : s));
    reader.readAsDataURL(file); e.target.value = "";
  }, []);

  const toggleStep = useCallback((i: number) =>
    setExpandedSteps((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; }), []);

  const startInline = (field: string, val: string) => { setInlineField(field); setInlineValue(val ?? ""); };

  const saveInline = async (field: string, val: string) => {
    setInlineField(null);
    if (!onUpdated) return;
    try { const upd = await casesApi.update(tc.id, { [field]: val } as any); onUpdated(upd); }
    catch (e: any) { toast.error(e.message ?? "Save failed"); }
  };

  const saveInlineProp = async (field: string, val: any) => {
    if (!onUpdated) return;
    try { const upd = await casesApi.update(tc.id, { [field]: val } as any); onUpdated(upd); }
    catch (e: any) { toast.error(e.message ?? "Save failed"); }
  };

  const deleteViewAttachment = useCallback(async (stepIdx: number, attachIdx: number) => {
    const newSteps = tc.steps.map((s, i) => {
      if (i !== stepIdx) return s;
      return { ...s, attachments: (s.attachments ?? []).filter((_, j) => j !== attachIdx) };
    });
    try { const upd = await casesApi.update(tc.id, { steps: newSteps } as any); onUpdated?.(upd); }
    catch (e: any) { toast.error(e.message ?? "Failed"); }
  }, [tc, onUpdated]);

  const caseId = displayIdx != null
    ? (displayPrefix && displayPrefix !== "#" ? `${displayPrefix}-${displayIdx}` : `#${displayIdx}`)
    : `CASE-${tc.id.slice(0, 6).toUpperCase()}`;

  const exportHtml = () => {
    const html = generateTestCaseHTML(tc, suitePath ?? (suiteName ? [suiteName] : []));
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${tc.name.replace(/[^a-zA-Zа-яА-Я0-9\s]/g, "").trim().replace(/\s+/g, "_").slice(0, 40)}.html`;
    a.click(); URL.revokeObjectURL(url);
  };

  const printTc = () => {
    const html = generateTestCaseHTML(tc, suitePath ?? (suiteName ? [suiteName] : []));
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderActionsBar = () => (
    <div className="tc-action-bar">
      {onEdit && <button className="tc-act-btn" title="Редактировать" onClick={() => { storePrev(tc); onEdit(); }}><IEdit /></button>}
      {!docked && (
        <div style={{ position: "relative" }}>
          <button
            className="tc-act-btn"
            title="Экспорт"
            onClick={() => setExportMenuOpen((v) => !v)}
          >
            <IExport />
          </button>
          {exportMenuOpen && (
            <div style={{ position: "absolute", left: 0, top: "calc(100% + 4px)", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,.12)", zIndex: 50, minWidth: 140 }}
              onMouseLeave={() => setExportMenuOpen(false)}>
              <button className="tc-export-menu-item" onClick={() => { exportHtml(); setExportMenuOpen(false); }}>
                ⬇ PDF / HTML
              </button>
              <button className="tc-export-menu-item" onClick={() => { printTc(); setExportMenuOpen(false); }}>
                🖨 Напечатать
              </button>
            </div>
          )}
        </div>
      )}
      <button className="tc-act-btn" title="Copy (coming soon)" disabled><ICopy /></button>
      {onDelete && <button className="tc-act-btn tc-act-btn--danger" title="Delete" onClick={onDelete}><ITrash /></button>}
      {projectId && (
        <button className="tc-run-btn" onClick={openQuickRun} disabled={launching} title="Запустить проверку">
          <IPlay /> {launching ? "Создание…" : "Запустить проверку"}
        </button>
      )}
    </div>
  );

  const renderBreadcrumbs = () => {
    const path = suitePath && suitePath.length > 0 ? suitePath : suiteName ? [suiteName] : null;
    if (!path) return null;
    return (
      <div className="tc-breadcrumbs">
        {path.map((seg, i) => (
          <span key={i} className="tc-breadcrumb-seg">
            {i > 0 && <span className="tc-breadcrumb-sep"> / </span>}
            {seg}
          </span>
        ))}
      </div>
    );
  };

  const startTitleEdit = () => {
    setTitleVal(tc.name);
    setEditingTitle(true);
  };
  const commitTitle = async () => {
    setEditingTitle(false);
    const trimmed = titleVal.trim();
    if (trimmed && trimmed !== tc.name) await saveInline("name", trimmed);
  };

  const renderTitleBlock = () => (
    <div className="tc-title-area">
      {renderBreadcrumbs()}
      <div style={{ marginBottom: 4 }}><CaseStatusIcon status={tc.status} withLabel /></div>
      {editingTitle ? (
        <input
          className="tc-title-input"
          value={titleVal}
          autoFocus
          onChange={(e) => setTitleVal(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === "Enter") commitTitle(); if (e.key === "Escape") setEditingTitle(false); }}
        />
      ) : (
        <h2 className="tc-title tc-title--editable" onClick={startTitleEdit} title="Нажмите для редактирования названия">
          {tc.name}
        </h2>
      )}
      {renderActionsBar()}
    </div>
  );

  const renderStepsSection = () => (
    <div className="tc-section">
      <div className="tc-steps-header">
        <span className="tc-section-label" style={{ marginBottom: 0 }}>Steps</span>
        {!editingSteps && (
          <div className="tc-steps-controls">
            <span className="tc-toggle-label">{stepsView === "table" ? "Shown as table" : "Shown as list"}</span>
            <button className={`tc-toggle-switch${stepsView === "table" ? " is-on" : ""}`}
              onClick={() => setStepsView((v) => v === "table" ? "list" : "table")}
              role="switch" aria-checked={stepsView === "table"} />
            <button className="tc-edit-steps-btn" onClick={startEdit}>✎ Edit</button>
          </div>
        )}
      </div>

      {editingSteps ? (
        <div className="ise-container">
          {draftSteps.map((s, i) => (
            <StepEditorRow key={i} step={s} idx={i} caseId={tc.id}
              isApiLayer={tc.layer === "api"}
              onUpdate={updateStep} onUpdateMulti={updateStepMulti}
              onDelete={deleteStep} onDuplicate={duplicateStep} onImg={handleStepImg}
              fileRef={(el) => { stepFileRefs.current[i] = el; }}
              onAddExpected={addExpected}
              onUpdateExpected={updateExpected}
              onDeleteExpected={deleteExpected} />
          ))}
          <div className="ise-add-row">
            <button className="ise-add-btn"
              onClick={() => setDraftSteps((p) => [...p, { action: "", data: "", expected_results: [], attachments: [] }])}>
              + New step
            </button>
          </div>
          <div className="ise-footer">
            <button className="tc-btn-cancel" onClick={() => setEditingSteps(false)} disabled={saving}>Cancel</button>
            <button className="tc-btn-save" onClick={saveSteps} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : stepsView === "table" ? (
        <div className="tc-steps-table-wrap">
          <table className="tc-steps-table">
            <thead>
              <tr>
                <th className="tc-sth tc-sth-num">#</th>
                <th className="tc-sth">Action</th>
                <th className="tc-sth">Data</th>
                <th className="tc-sth">Expected result</th>
                <th className="tc-sth">Attachments</th>
              </tr>
            </thead>
            <tbody>
              {tc.steps.map((s, i) => {
                const expResults = getStepExpectedResults(s);
                return (
                  <tr key={i} className="tc-str">
                    <td className="tc-std tc-std-num">{i + 1}</td>
                    <td className="tc-std">{s.action}</td>
                    <td className="tc-std tc-std-mono">{s.data ?? "—"}</td>
                    <td className="tc-std">
                      {expResults.length > 0
                        ? <ul className="tc-table-expected-list">{expResults.map((exp, ei) => <li key={ei}>{exp}</li>)}</ul>
                        : "—"}
                    </td>
                    <td className="tc-std tc-std-attach">
                      {(s.attachments ?? []).length > 0
                        ? <div className="tc-step-attach-thumbs">
                            {(s.attachments ?? []).map((u, ai) => (
                              <div key={ai} className="tc-attach-wrap">
                                <img src={u} alt="" className="tc-step-thumb tc-step-thumb--clickable"
                                  onClick={() => setLightbox({ src: u, title: `Шаг ${i + 1}${s.action ? `: ${s.action}` : ""} — изображение ${ai + 1}` })} />
                                {onUpdated && (
                                  <button className="tc-attach-del" onClick={() => deleteViewAttachment(i, ai)}>×</button>
                                )}
                              </div>
                            ))}
                          </div>
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="tc-steps-collapsible">
          {tc.steps.map((s, i) => {
            const exp = expandedSteps.has(i);
            const hasExtra = !!(s.data || getStepExpectedResults(s).length > 0 || (s.attachments ?? []).length > 0);
            return (
              <div key={i} className="tc-step-block">
                <div className={`tc-step-row${hasExtra ? " tc-step-row--exp" : ""}`}
                  onClick={() => hasExtra && toggleStep(i)}>
                  <span className="tc-step-caret">{hasExtra ? (exp ? "▼" : "▶") : " "}</span>
                  <span className="tc-step-num">{i + 1}</span>
                  <span className="tc-step-action">{s.action}</span>
                </div>
                {exp && (
                  <div className="tc-step-extra">
                    {s.data && (
                      <div className="tc-step-extra-item">
                        <div className="tc-step-extra-label">Input data</div>
                        <div className="tc-step-extra-val tc-mono">{s.data}</div>
                      </div>
                    )}
                    {getStepExpectedResults(s).length > 0 && (
                      <div className="tc-step-extra-item">
                        <div className="tc-step-extra-label">Expected results</div>
                        {getStepExpectedResults(s).map((exp, ei) => (
                          <div key={ei} className="tc-step-extra-val">{ei + 1}. {exp}</div>
                        ))}
                      </div>
                    )}
                    {(s.attachments ?? []).length > 0 && (
                      <div className="tc-step-attach-thumbs">
                        {(s.attachments ?? []).map((u, ai) => (
                          <div key={ai} className="tc-attach-wrap">
                            <img src={u} alt="" className="tc-step-thumb tc-step-thumb--clickable"
                              onClick={() => setLightbox({ src: u, title: `Шаг ${i + 1}${s.action ? `: ${s.action}` : ""} — изображение ${ai + 1}` })} />
                            {onUpdated && (
                              <button className="tc-attach-del" onClick={() => deleteViewAttachment(i, ai)}>×</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {tc.steps.length === 0 && <div className="tc-empty-steps">No steps yet</div>}
        </div>
      )}
    </div>
  );

  const renderInlineText = (field: string, label: string, value: string | null | undefined) => (
    <div className="tc-section">
      <div className="tc-section-label">{label}</div>
      {inlineField === field ? (
        <textarea className="input tc-inline-textarea" rows={3} value={inlineValue}
          autoFocus
          onChange={(e) => setInlineValue(e.target.value)}
          onBlur={() => saveInline(field, inlineValue)}
          onKeyDown={(e) => { if (e.key === "Escape") setInlineField(null); }} />
      ) : (
        <p className={`tc-section-text tc-click-edit${!value ? " tc-not-set" : ""}`}
          title="Click to edit"
          onClick={() => startInline(field, value ?? "")}>
          {value || "Not set — click to edit"}
        </p>
      )}
    </div>
  );

  const renderGeneral = () => (
    <div className="tc-general">
      {renderInlineText("description", "Description", tc.description)}
      {renderInlineText("pre_conditions", "Pre-conditions", tc.pre_conditions)}
      {renderStepsSection()}
      {localStorage.getItem(`cfg_case_show_post_conditions_${projectId ?? ""}`) !== "false" &&
        renderInlineText("post_conditions", "Post-conditions", tc.post_conditions)}
      {tc.tags?.length > 0 && (
        <div className="tc-section">
          <div className="tc-section-label">Tags</div>
          <div className="tc-tags">{tc.tags.map((t) => <span key={t} className="badge badge-untested">{t}</span>)}</div>
        </div>
      )}
    </div>
  );

  const renderPropertiesList = (sidebar?: boolean) => (
    <div className={sidebar ? "tc-props-sidebar" : "tc-props-compact"}>
      {sidebar && (
        <div className="tc-props-meta">
          <div className="tc-props-avatar">D</div>
          <div>
            <div className="tc-props-created-lbl">Created by</div>
            <div className="tc-props-created-val">Demo User</div>
          </div>
        </div>
      )}
      {sidebar && suiteName && (
        <div className="tc-props-row">
          <div className="tc-props-label">TEST SUITE</div>
          <div className="tc-props-val tc-props-suite">{suiteName}</div>
        </div>
      )}
      {([
        { label: "SEVERITY",   field: "severity",         options: SEVERITY },
        { label: "STATUS",     field: "status",           options: CASE_STATUS },
        { label: "PRIORITY",   field: "priority",         options: PRIORITY },
        { label: "TYPE",       field: "type",             options: CASE_TYPE },
        { label: "BEHAVIOR",   field: "behavior",         options: BEHAVIOR },
        { label: "LAYER",      field: "layer",            options: LAYER },
        { label: "AUTOMATION", field: "automation_status",options: AUTOMATION_STATUS },
      ] as const).map(({ label, field, options }) => (
        <div key={field} className="tc-props-row">
          <div className="tc-props-label">{label}</div>
          <div className="tc-props-val">
            <select className="tc-inline-select" value={(tc as any)[field]}
              onChange={(e) => saveInlineProp(field, e.target.value)}>
              {(options as readonly string[]).map((o) => (
                <option key={o} value={o}>{labelize(o)}</option>
              ))}
            </select>
          </div>
        </div>
      ))}
      <div className="tc-props-row">
        <div className="tc-props-label">IS FLAKY</div>
        <div className="tc-props-val">
          <select className="tc-inline-select" value={tc.is_flaky ? "Yes" : "No"}
            onChange={(e) => saveInlineProp("is_flaky", e.target.value === "Yes")}>
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
        </div>
      </div>
    </div>
  );

  const tabs: TcTab[] = [
    "General", "Run History", "Change History", "Defects", "Comments",
    ...(tc.layer === "api" ? ["API check" as const] : []),
  ];

  const renderTabContent = () => {
    if (activeTab === "General")        return renderGeneral();
    if (activeTab === "Change History") return <ChangeHistoryTab tc={tc} />;
    if (activeTab === "Run History")    return <TcRunHistoryTab projectId={projectId} testCaseId={tc.id} />;
    if (activeTab === "Defects")        return <TcDefectsTab projectId={projectId} testCaseId={tc.id} />;
    if (activeTab === "Comments")       return <TcCommentsTab testCaseId={tc.id} />;
    if (activeTab === "API check")      return <TcApiCheckTab tc={tc} />;
    return null;
  };

  const renderTabBar = () => (
    <div className="tc-tabs">
      {tabs.map((t) => (
        <span key={t} className={`tc-tab${activeTab === t ? " is-active" : ""}`} onClick={() => setActiveTab(t)}>{t}</span>
      ))}
    </div>
  );

  // ── DOCKED ────────────────────────────────────────────────────────────────
  const dockedUI = (
    <div className="tc-drawer tc-drawer--docked" style={{ width }}>
      <div className="tc-resize-handle" onMouseDown={onResizeMouseDown} />
      <div className="tc-sticky-header">
        <div className="tc-topbar">
          <span className="tc-case-id">{caseId}</span>
          <div className="tc-topbar-btns">
            <button className="tc-top-btn" title="Экспортировать как HTML" onClick={() => {
              const html = generateTestCaseHTML(tc, suitePath ?? (suiteName ? [suiteName] : []));
              const blob = new Blob([html], { type: "text/html;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `${tc.name.replace(/[^a-zA-Zа-яА-Я0-9\s]/g, "").trim().replace(/\s+/g, "_").slice(0, 40)}.html`;
              a.click(); URL.revokeObjectURL(url);
            }}>⬇</button>
            <button className="tc-top-btn" title="Напечатать тест-кейс" onClick={() => {
              const html = generateTestCaseHTML(tc, suitePath ?? (suiteName ? [suiteName] : []));
              const w = window.open("", "_blank");
              if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
            }}>🖨</button>
            <button className="tc-top-btn" title="Undock" onClick={() => setDocked(false)}><IUndock /></button>
            <button className="tc-top-btn" title="Close" onClick={onClose}><IClose /></button>
          </div>
        </div>
        {renderTitleBlock()}
        {renderTabBar()}
      </div>
      <div className="tc-drawer-body">
        <div className="tc-drawer-main">
          <div className="tc-scroll-body">
            {renderTabContent()}
          </div>
        </div>
        <div className="tc-drawer-sidebar">
          {renderPropertiesList(true)}
        </div>
      </div>
    </div>
  );

  // ── UNDOCKED ──────────────────────────────────────────────────────────────
  const floatUI = (
    <div className="tc-float-overlay" onClick={onClose}>
      <div className="tc-dialog" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <div className="tc-dialog-inner">
          <div className="tc-dialog-main">
            <div className="tc-dialog-sticky-header">
              <div className="tc-topbar">
                <span className="tc-case-id">{caseId}</span>
                <div className="tc-topbar-btns">
                  <button className="tc-top-btn" title="Dock" onClick={() => setDocked(true)}><IDock /></button>
                  <button className="tc-top-btn" title="Close" onClick={onClose}><IClose /></button>
                </div>
              </div>
              {renderTitleBlock()}
              {renderTabBar()}
            </div>
            <div className="tc-scroll-body">
              {renderTabContent()}
            </div>
          </div>
          <div className="tc-dialog-sidebar">
            {renderPropertiesList(true)}
          </div>
        </div>
      </div>
    </div>
  );

  const quickRunModal = qrOpen ? createPortal(
    <div className="tc-float-overlay" style={{ zIndex: 500 }} onClick={() => setQrOpen(false)}>
      <div style={{ background: "var(--color-bg)", borderRadius: 10, width: 460, maxWidth: "calc(100vw - 40px)", boxShadow: "0 8px 40px rgba(0,0,0,.2)" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px 10px", borderBottom: "1px solid var(--color-border)" }}>
          <strong style={{ fontSize: 15 }}>▶ Запустить проверку</strong>
          <button className="tc-top-btn" onClick={() => setQrOpen(false)}><IClose /></button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>Название прогона *</div>
            <input className="input" style={{ width: "100%" }} value={qrName} onChange={(e) => setQrName(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>Среда (Environment)</div>
              <input className="input" style={{ width: "100%" }} placeholder="staging / production" value={qrEnv} onChange={(e) => setQrEnv(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>Device Type</div>
              <select className="input" style={{ width: "100%" }} value={qrDeviceType} onChange={(e) => { setQrDeviceType(e.target.value); setQrOs(""); }}>
                <option value="">— Not set —</option>
                {[["mobile","Mobile"],["pc","PC"],["tablet","Tablet"],["other","Other"]].map(([v,l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          {qrDeviceType && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>OS</div>
                <select className="input" style={{ width: "100%" }} value={qrOs} onChange={(e) => setQrOs(e.target.value)}>
                  <option value="">— Not set —</option>
                  {({ mobile: ["Android","iOS","HarmonyOS","Other"], pc: ["Windows","macOS","Linux","Other"], tablet: ["Android","iOS / iPadOS","Windows","Other"], other: ["Other"] }[qrDeviceType as "mobile"|"pc"|"tablet"|"other"] ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>OS Version</div>
                <input className="input" style={{ width: "100%" }} placeholder="e.g. Android 14" value={qrOsVersion} onChange={(e) => setQrOsVersion(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>Описание</div>
            <textarea className="input" rows={2} style={{ width: "100%", resize: "vertical" }} value={qrDesc} onChange={(e) => setQrDesc(e.target.value)} />
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", background: "var(--color-bg-soft)", borderRadius: 6, padding: "8px 12px" }}>
            Будет создан прогон с 1 тест-кейсом: <em>{tc.name}</em>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 20px 16px", justifyContent: "flex-end" }}>
          <button className="tc-run-btn" onClick={launchQuickRun} disabled={launching || !qrName.trim()}>
            <IPlay /> {launching ? "Создание…" : "Запустить"}
          </button>
          <button style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 6, padding: "4px 14px", cursor: "pointer", fontSize: 13 }} onClick={() => setQrOpen(false)}>Отмена</button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const lightboxUI = lightbox ? createPortal(
    <div className="tc-lightbox" onClick={() => setLightbox(null)}>
      <div className="tc-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <div className="tc-lightbox-title">{lightbox.title}</div>
        <img src={lightbox.src} alt={lightbox.title} className="tc-lightbox-img" />
      </div>
      <button className="tc-lightbox-close" onClick={() => setLightbox(null)}>✕</button>
    </div>,
    document.body
  ) : null;

  if (!docked) return <>{createPortal(floatUI, document.body)}{lightboxUI}{quickRunModal}</>;
  return <>{dockedUI}{lightboxUI}{quickRunModal}</>;
}

// ── Change history ─────────────────────────────────────────────────────────────
function ChangeHistoryTab({ tc }: { tc: TestCase }) {
  const prev = loadPrev(tc.id);
  const diffs = prev ? [
    ["Title",          prev.title,              tc.name],
    ["Description",    prev.description,        tc.description],
    ["Pre-conditions", prev.pre_conditions,     tc.pre_conditions],
    ["Post-conditions",prev.post_conditions,    tc.post_conditions],
    ["Status",         prev.status,             tc.status],
    ["Severity",       prev.severity,           tc.severity],
    ["Priority",       prev.priority,           tc.priority],
    ["Type",           prev.type,               tc.type],
    ["Behavior",       prev.behavior,           tc.behavior],
    ["Layer",          prev.layer,              tc.layer],
    ["Automation",     prev.automation_status,  tc.automation_status],
    ["Is Flaky",       prev.is_flaky ? "Yes" : "No", tc.is_flaky ? "Yes" : "No"],
    ["Tags",           (prev.tags || []).join(", ") || "—", (tc.tags || []).join(", ") || "—"],
  ].filter(([, o, n]) => (o || "—") !== (n || "—")).map(([l, o, n]) => ({ label: l as string, old: o || "—", new: n || "—" })) : [];
  const stepsChanged = prev && JSON.stringify(prev.steps) !== JSON.stringify(tc.steps);
  return (
    <div className="ch-container">
      {!prev && <div className="ch-info"><span className="ch-rev-badge">Rev. {tc.revision}</span> Edit the test case to start tracking changes.</div>}
      {prev && (
        <>
          <div className="ch-info">
            <span className="ch-rev-badge">Rev. {tc.revision}</span>
            <span>Last saved: {new Date(prev.savedAt).toLocaleString("ru-RU")} · {diffs.length + (stepsChanged ? 1 : 0)} field(s) changed</span>
          </div>
          {diffs.map((d) => (
            <div key={d.label} className="ch-diff-row">
              <div className="ch-diff-field-name">{d.label}</div>
              <div className="ch-diff-values">
                <div className="ch-diff-old">{d.old}</div>
                <div className="ch-diff-arrow">→</div>
                <div className="ch-diff-new">{d.new}</div>
              </div>
            </div>
          ))}
          {stepsChanged && (
            <div className="ch-diff-row">
              <div className="ch-diff-field-name">Steps</div>
              <div className="ch-diff-values">
                <div className="ch-diff-old">{(prev.steps || []).map((s: Step, i: number) => <div key={i}>{i + 1}. {s.action}</div>)}</div>
                <div className="ch-diff-arrow">→</div>
                <div className="ch-diff-new">{tc.steps.map((s, i) => <div key={i}>{i + 1}. {s.action}</div>)}</div>
              </div>
            </div>
          )}
          {diffs.length === 0 && !stepsChanged && <div className="ch-no-changes">No changes since last save.</div>}
        </>
      )}
      <div className="ch-timeline">
        <div className="ch-event">
          <div className="ch-icon" style={{ background: "#5a4cf0" }}>✎</div>
          <div className="ch-event-body">
            <div className="ch-event-title">Revision {tc.revision} — current</div>
            <div className="ch-event-sub">Current saved state</div>
          </div>
        </div>
        {tc.revision > 1 && (
          <div className="ch-event">
            <div className="ch-icon" style={{ background: "#16a34a" }}>◉</div>
            <div className="ch-event-body">
              <div className="ch-event-title">Revision 1 — created</div>
              <div className="ch-event-sub">{tc.revision - 1} revision(s) made since.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Run History Tab ───────────────────────────────────────────────────────────
const TC_RH_STATUS: Record<string, { color: string; bg: string }> = {
  passed:      { color: "#15803d", bg: "#dcfce7" },
  failed:      { color: "#dc2626", bg: "#fee2e2" },
  blocked:     { color: "#ca8a04", bg: "#fef3c7" },
  untested:    { color: "#6b7280", bg: "#f3f4f6" },
  in_progress: { color: "#1d4ed8", bg: "#dbeafe" },
  skipped:     { color: "#9ca3af", bg: "#f9fafb" },
};

function TcRunHistoryTab({ projectId, testCaseId }: { projectId?: string; testCaseId: string }) {
  const [rows, setRows] = useState<Array<{ run: TestRun; result: TestResult }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    runsApi.list(projectId).then(async (runs) => {
      const all = await Promise.all(
        runs.slice(0, 25).map(async (run) => {
          try {
            const res = await runsApi.results(run.id);
            const found = res.find((r) => r.test_case_id === testCaseId);
            return found ? { run, result: found } : null;
          } catch { return null; }
        })
      );
      setRows(all.filter(Boolean) as Array<{ run: TestRun; result: TestResult }>);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [projectId, testCaseId]);

  if (!projectId) return <div className="tc-stub-tab"><p>No project context.</p></div>;
  if (loading) return <div className="tc-stub-tab"><div className="tc-stub-icon">⏳</div><p>Loading…</p></div>;
  if (rows.length === 0) return <div className="tc-stub-tab"><div className="tc-stub-icon">▷</div><p>No runs yet for this test case.</p></div>;

  const fmtDateTime = (iso?: string | null) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    } catch { return "—"; }
  };

  return (
    <div style={{ padding: "12px 0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--color-bg-soft)" }}>
            {["Run", "Date", "Executor", "Env", "Status"].map((h) => (
              <th key={h} style={{ padding: "6px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ run, result }) => {
            const m = TC_RH_STATUS[result.status] ?? TC_RH_STATUS.untested;
            const dateVal = result.executed_at ?? run.started_at;
            return (
              <tr key={run.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td style={{ padding: "8px 12px", fontWeight: 500 }}>{run.name}</td>
                <td style={{ padding: "8px 12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" as const }}>{fmtDateTime(dateVal)}</td>
                <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>{run.started_by_name ?? <span style={{ color: "var(--color-text-subtle)" }}>—</span>}</td>
                <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>{run.environment ?? "—"}</td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: m.bg, color: m.color }}>{result.status}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Defects Tab ───────────────────────────────────────────────────────────────
const SEV_COLORS: Record<string, { bg: string; color: string }> = {
  blocker:  { bg: "#fee2e2", color: "#b91c1c" },
  critical: { bg: "#ffedd5", color: "#c2410c" },
  major:    { bg: "#fef3c7", color: "#b45309" },
  normal:   { bg: "#e5e7eb", color: "#4b5563" },
  minor:    { bg: "#dbeafe", color: "#1e40af" },
  trivial:  { bg: "#f3f4f6", color: "#6b7280" },
};

type DefectWithRun = Defect & { runName?: string; runId?: string; executor?: string };

function TcDefectsTab({ projectId, testCaseId }: { projectId?: string; testCaseId: string }) {
  const [items, setItems] = useState<DefectWithRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    Promise.all([defectsApi.list(projectId), runsApi.list(projectId)])
      .then(async ([allDefects, allRuns]) => {
        const runMap = new Map(allRuns.map((r) => [r.id, r]));
        const runIds = new Set(allDefects.map((d) => d.test_run_id).filter(Boolean) as string[]);
        const resultsCache = new Map<string, string[]>();
        await Promise.all(Array.from(runIds).map(async (rid) => {
          try {
            const res = await runsApi.results(rid);
            resultsCache.set(rid, res.map((r) => r.test_case_id));
          } catch { resultsCache.set(rid, []); }
        }));
        const matched: DefectWithRun[] = [];
        for (const d of allDefects) {
          const rid = d.test_run_id;
          if (!rid) continue;
          const caseIds = resultsCache.get(rid) ?? [];
          if (!caseIds.includes(testCaseId)) continue;
          const run = runMap.get(rid);
          matched.push({ ...d, runId: rid, runName: run?.name, executor: run?.started_by_name ?? undefined });
        }
        setItems(matched);
      }).catch(() => {}).finally(() => setLoading(false));
  }, [projectId, testCaseId]);

  if (!projectId) return <div className="tc-stub-tab"><p>No project context.</p></div>;
  if (loading) return <div className="tc-stub-tab"><div className="tc-stub-icon">⏳</div><p>Loading…</p></div>;
  if (items.length === 0) return (
    <div className="tc-stub-tab">
      <div className="tc-stub-icon">🐛</div>
      <p>Дефектов для этого тест-кейса не найдено.</p>
      <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Дефекты появятся здесь, если они привязаны к прогону, содержащему этот тест-кейс.</p>
    </div>
  );

  return (
    <div style={{ padding: "12px 0" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8, padding: "0 4px" }}>Дефекты этого тест-кейса ({items.length})</div>
      {items.map((d) => {
        const sc = SEV_COLORS[d.severity] ?? SEV_COLORS.normal;
        return (
          <div key={d.id} className="tc-defect-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "10px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: sc.bg, color: sc.color, flexShrink: 0 }}>{d.severity}</span>
              <span className="tc-defect-title" style={{ flex: 1 }}>{d.display_id} {d.title}</span>
              <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 99, background: "var(--color-bg-soft)", color: "var(--color-text-muted)", flexShrink: 0 }}>{d.status}</span>
            </div>
            {d.runName && (
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", display: "flex", gap: 10, flexWrap: "wrap", paddingLeft: 4 }}>
                <span>🔁 {d.runName}</span>
                {d.executor && <span>👤 {d.executor}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── API Check Tab ─────────────────────────────────────────────────────────────
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "#16a34a", POST: "#1d4ed8", PUT: "#ca8a04", PATCH: "#7c3aed", DELETE: "#dc2626",
};

function parseStepAction(action: string): { method: HttpMethod; url: string } {
  const m = action.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
  if (m) return { method: m[1].toUpperCase() as HttpMethod, url: m[2].trim() };
  return { method: "GET", url: action.startsWith("http") ? action.trim() : "" };
}

type ApiStepState = { method: HttpMethod; url: string; headers: { key: string; value: string }[]; body: string; contract: string; };
type ApiResp = { status: number; statusText: string; body: string; timeMs: number; ok: boolean; contractErrors: string[] };

function validateContract(body: string, contract: string): string[] {
  if (!contract.trim()) return [];
  try {
    const parsed = JSON.parse(body);
    const schema = JSON.parse(contract);
    const errors: string[] = [];
    for (const [key, expectedType] of Object.entries(schema)) {
      if (!(key in parsed)) { errors.push(`Missing field: ${key}`); continue; }
      const actual = typeof parsed[key];
      if (actual !== expectedType) errors.push(`${key}: expected ${expectedType}, got ${actual}`);
    }
    return errors;
  } catch { return []; }
}

function ApiStepRunner({ step, idx }: { step: Step; idx: number }) {
  const parsed = parseStepAction(step.action ?? "");
  const [state, setState] = useState<ApiStepState>({
    method: ((step.api_method as HttpMethod) ?? parsed.method),
    url: (step.api_url ?? parsed.url),
    headers: [{ key: "Content-Type", value: "application/json" }],
    body: step.data ?? "",
    contract: step.api_contract ?? "",
  });
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"params" | "response" | "contract">("params");
  const [error, setError] = useState<string | null>(null);
  const expected = getStepExpectedResults(step);

  const send = async () => {
    if (!state.url.trim()) return;
    setSending(true); setError(null);
    const t0 = Date.now();
    try {
      const hdrs: Record<string, string> = {};
      for (const h of state.headers) if (h.key.trim()) hdrs[h.key] = h.value;
      const opts: RequestInit = { method: state.method, headers: hdrs };
      if (state.body && !["GET", "DELETE"].includes(state.method)) opts.body = state.body;
      const r = await fetch(state.url, opts);
      const timeMs = Date.now() - t0;
      const ct = r.headers.get("content-type") ?? "";
      let body = "";
      try { body = ct.includes("json") ? JSON.stringify(await r.json(), null, 2) : await r.text(); } catch { body = ""; }
      setResp({ status: r.status, statusText: r.statusText, body, timeMs, ok: r.ok, contractErrors: validateContract(body, state.contract) });
      setTab("response");
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setSending(false); }
  };

  const sc = resp ? (resp.ok ? "#16a34a" : "#dc2626") : "#9ca3af";

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, marginBottom: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--color-bg-soft)", fontSize: 12 }}>
        <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "var(--color-text-muted)", flexShrink: 0 }}>{idx + 1}</span>
        <span style={{ color: "var(--color-text-muted)", flex: 1, fontFamily: "monospace" }}>{step.action}</span>
      </div>
      <div style={{ display: "flex", gap: 6, padding: "8px 10px", alignItems: "center" }}>
        <select style={{ width: 86, height: 30, padding: "0 6px", border: "1px solid var(--color-border)", borderRadius: 4, fontWeight: 700, fontSize: 12, background: "var(--color-bg)", color: METHOD_COLORS[state.method], cursor: "pointer" }}
          value={state.method} onChange={(e) => setState({ ...state, method: e.target.value as HttpMethod })}>
          {HTTP_METHODS.map((m) => <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>{m}</option>)}
        </select>
        <input className="input" style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
          placeholder="https://api.example.com/endpoint" value={state.url}
          onChange={(e) => setState({ ...state, url: e.target.value })} />
        <button className="btn btn-primary" style={{ fontSize: 12, padding: "4px 10px", whiteSpace: "nowrap" }}
          onClick={send} disabled={sending || !state.url.trim()}>
          {sending ? "…" : "▶ Send"}
        </button>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", padding: "0 10px" }}>
        {(["params", "contract", ...(resp ? ["response"] : [])] as const).map((t) => (
          <button key={t} style={{ padding: "5px 12px", border: "none", background: "none", fontSize: 11, cursor: "pointer", color: tab === t ? "var(--color-accent)" : "var(--color-text-muted)", borderBottom: tab === t ? "2px solid var(--color-accent)" : "2px solid transparent", fontWeight: tab === t ? 700 : 400, marginBottom: -1 }}
            onClick={() => setTab(t as any)}>
            {t === "params" ? "Headers / Body" : t === "contract" ? "Contract" : (
              <>Response <span style={{ fontWeight: 700, color: sc }}>{resp?.status}</span> <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{resp?.timeMs}ms</span></>
            )}
          </button>
        ))}
      </div>
      {tab === "params" && (
        <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: "0.05em" }}>Headers</div>
          {state.headers.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 4 }}>
              <input className="input" style={{ width: 140, fontSize: 11, fontFamily: "monospace" }} placeholder="Key" value={h.key}
                onChange={(e) => setState({ ...state, headers: state.headers.map((x, j) => j === i ? { ...x, key: e.target.value } : x) })} />
              <input className="input" style={{ flex: 1, fontSize: 11, fontFamily: "monospace" }} placeholder="Value" value={h.value}
                onChange={(e) => setState({ ...state, headers: state.headers.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
              <button className="btn-icon" onClick={() => setState({ ...state, headers: state.headers.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button className="btn-link" style={{ fontSize: 11, alignSelf: "flex-start" }}
            onClick={() => setState({ ...state, headers: [...state.headers, { key: "", value: "" }] })}>+ Add header</button>
          {!["GET", "DELETE"].includes(state.method) && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: "0.05em", marginTop: 4 }}>Body (JSON)</div>
              <textarea className="input" style={{ fontFamily: "monospace", fontSize: 11, resize: "vertical" }} rows={4}
                placeholder='{"key": "value"}' value={state.body}
                onChange={(e) => setState({ ...state, body: e.target.value })} />
            </>
          )}
          {expected.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: "0.05em", marginTop: 4 }}>Expected</div>
              {expected.map((ex, i) => <div key={i} style={{ fontSize: 11, color: "#15803d", background: "var(--color-passed-bg)", padding: "4px 8px", borderRadius: 4 }}>✓ {ex}</div>)}
            </>
          )}
        </div>
      )}
      {tab === "contract" && (
        <div style={{ padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 6 }}>
            JSON Schema (field → type). Пример: <code style={{ fontSize: 10 }}>{`{"id":"number","name":"string"}`}</code>
          </div>
          <textarea className="input" style={{ fontFamily: "monospace", fontSize: 11, resize: "vertical", width: "100%", boxSizing: "border-box" }} rows={5}
            placeholder='{"id": "number", "name": "string", "active": "boolean"}'
            value={state.contract} onChange={(e) => setState({ ...state, contract: e.target.value })} />
        </div>
      )}
      {tab === "response" && resp && (
        <div style={{ padding: "8px 10px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: sc }}>{resp.status}</span>
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{resp.statusText}</span>
            <span style={{ fontSize: 11, color: "var(--color-text-subtle)" }}>{resp.timeMs}ms</span>
            {resp.contractErrors.length > 0 && <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, marginLeft: "auto" }}>⚠ {resp.contractErrors.length} contract error{resp.contractErrors.length > 1 ? "s" : ""}</span>}
          </div>
          {resp.contractErrors.length > 0 && (
            <div style={{ background: "var(--color-failed-bg)", border: "1px solid #fca5a5", borderRadius: 4, padding: "6px 8px", marginBottom: 8 }}>
              {resp.contractErrors.map((e, i) => <div key={i} style={{ fontSize: 11, color: "#dc2626" }}>• {e}</div>)}
            </div>
          )}
          <pre style={{ background: "var(--color-bg-soft)", border: "1px solid var(--color-border)", borderRadius: 4, padding: "8px 10px", fontSize: 11, fontFamily: "monospace", overflow: "auto", maxHeight: 200, whiteSpace: "pre", color: "var(--color-text)", margin: 0 }}>
            {resp.body || "(empty)"}
          </pre>
        </div>
      )}
      {error && <div style={{ margin: "4px 10px 8px", padding: "6px 10px", background: "var(--color-failed-bg)", color: "var(--color-failed)", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}
    </div>
  );
}

function TcApiCheckTab({ tc }: { tc: TestCase }) {
  if (tc.steps.length === 0) {
    return (
      <div className="tc-stub-tab">
        <div className="tc-stub-icon">🌐</div>
        <p>Нет шагов для API проверки.</p>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Добавьте шаги с форматом: <code>METHOD https://url</code></p>
      </div>
    );
  }
  return (
    <div style={{ padding: "12px 0" }}>
      <div style={{ fontSize: 12, color: "var(--color-text-muted)", padding: "0 4px 8px", lineHeight: 1.5 }}>
        🌐 API Test Runner — отправляйте запросы прямо из тест-кейса.
      </div>
      {tc.steps.map((step, i) => <ApiStepRunner key={i} step={step} idx={i} />)}
    </div>
  );
}

// ── Comments Tab ──────────────────────────────────────────────────────────────
type TcComment = { id: string; text: string; author: string; createdAt: string; };

function loadComments(tcId: string): TcComment[] {
  try { return JSON.parse(localStorage.getItem(`tc_comments_${tcId}`) ?? "[]"); } catch { return []; }
}
function saveComments(tcId: string, data: TcComment[]) {
  try { localStorage.setItem(`tc_comments_${tcId}`, JSON.stringify(data)); } catch { /* noop */ }
}

function TcCommentsTab({ testCaseId }: { testCaseId: string }) {
  const [comments, setComments] = useState<TcComment[]>(() => loadComments(testCaseId));
  const [text, setText] = useState("");

  const addComment = () => {
    const t = text.trim();
    if (!t) return;
    const next = [...comments, { id: crypto.randomUUID(), text: t, author: "Demo User", createdAt: new Date().toISOString() }];
    setComments(next);
    saveComments(testCaseId, next);
    setText("");
  };

  const deleteComment = (id: string) => {
    const next = comments.filter((c) => c.id !== id);
    setComments(next);
    saveComments(testCaseId, next);
  };

  return (
    <div style={{ padding: "12px 0" }}>
      <div className="tc-comment-list">
        {comments.length === 0 && <div style={{ fontSize: 13, color: "var(--color-text-muted)", padding: "8px 4px" }}>Нет комментариев. Будьте первым!</div>}
        {comments.map((c) => (
          <div key={c.id} className="tc-comment-item">
            <div className="tc-comment-header">
              <span className="tc-comment-author">{c.author}</span>
              <span className="tc-comment-date">{new Date(c.createdAt).toLocaleString("ru-RU")}</span>
              <button className="tc-comment-del" onClick={() => deleteComment(c.id)}>✕</button>
            </div>
            <div className="tc-comment-text">{c.text}</div>
          </div>
        ))}
      </div>
      <div className="tc-comment-form">
        <textarea className="input tc-comment-input" rows={2} placeholder="Add a comment…"
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addComment(); }} />
        <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 14px" }}
          onClick={addComment} disabled={!text.trim()}>Send</button>
      </div>
    </div>
  );
}
