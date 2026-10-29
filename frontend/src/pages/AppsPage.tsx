import React, { useEffect, useMemo, useState, useCallback } from "react";
import { projectsApi, casesApi, suitesApi, type Project, type TestCase, type Step } from "../api/client";
import {
  type ReportTemplateCfg, type RtSectionCfg,
  loadReportTemplateCfg, saveReportTemplateCfg, isReportTemplateEnabled,
  defaultReportTemplateCfg,
} from "../utils/testProtocol";
import "./AppsPage.css";

// ── Constants ─────────────────────────────────────────────────────────────────

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "#16a34a", POST: "#1d4ed8", PUT: "#ca8a04", PATCH: "#7c3aed", DELETE: "#dc2626",
};

// ── Run Monitor Storage ───────────────────────────────────────────────────────

type ApiStepResult = {
  idx: number; action: string; method: string; url: string;
  status: number; statusText: string; ok: boolean; timeMs: number;
  body: string; contractErrors: string[];
};
type ApiRunRecord = {
  id: string; projectId: string; projectName: string;
  caseId: string; caseName: string;
  startedAt: string; duration: number;
  steps: ApiStepResult[];
  passed: number; failed: number; total: number;
};

const HISTORY_KEY = "api_run_history";
function loadHistory(): ApiRunRecord[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
}
function saveHistory(h: ApiRunRecord[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 200))); } catch {} // keep last 200
}
function addRun(record: ApiRunRecord) {
  saveHistory([record, ...loadHistory()]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAction(action: string): { method: HttpMethod; url: string } {
  const m = action.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
  if (m) return { method: m[1].toUpperCase() as HttpMethod, url: m[2].trim() };
  return { method: "GET", url: action.startsWith("http") ? action.trim() : "" };
}

function validateContract(body: string, contract: string): string[] {
  if (!contract.trim()) return [];
  try {
    const parsed = JSON.parse(body);
    const schema = JSON.parse(contract);
    const errors: string[] = [];
    for (const [key, expectedType] of Object.entries(schema as Record<string, string>)) {
      if (!(key in parsed)) { errors.push(`Missing: ${key}`); continue; }
      if (typeof parsed[key] !== expectedType) errors.push(`${key}: expected ${expectedType}, got ${typeof parsed[key]}`);
    }
    return errors;
  } catch { return []; }
}

// ── cURL parser ──────────────────────────────────────────────────────────────

function parseCurl(raw: string): { method: HttpMethod; url: string; headers: { key: string; value: string }[]; body: string } | null {
  try {
    const s = raw.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
    const methodMatch = s.match(/-X\s+([A-Z]+)/i);
    const method = (methodMatch?.[1]?.toUpperCase() as HttpMethod) ?? "GET";
    const urlMatch = s.match(/curl\s+(?:-[^\s]+\s+)*['"]?([^'" ]+)['"]?/) ??
                     s.match(/['"]([^'"]+)['"]/);
    if (!urlMatch) return null;
    const url = urlMatch[1];
    const headers: { key: string; value: string }[] = [];
    const hRegex = /-H\s+['"]([^:'"]+):\s*([^'"]+)['"]/g;
    let hm: RegExpExecArray | null;
    while ((hm = hRegex.exec(s))) headers.push({ key: hm[1].trim(), value: hm[2].trim() });
    const bodyMatch = s.match(/-d\s+['"](.+?)['"](?:\s|$)/) ?? s.match(/--data\s+['"](.+?)['"](?:\s|$)/);
    const body = bodyMatch?.[1] ?? "";
    return { method, url, headers: headers.length ? headers : [{ key: "Content-Type", value: "application/json" }], body };
  } catch { return null; }
}

function toCurl(method: string, url: string, headers: { key: string; value: string }[], body: string): string {
  const hdrs = headers.filter((h) => h.key.trim()).map((h) => `-H "${h.key}: ${h.value}"`).join(" \\\n  ");
  const bd = body ? `-d '${body.replace(/'/g, "'\\''")}'` : "";
  return `curl -X ${method} "${url}" \\\n  ${hdrs}${bd ? " \\\n  " + bd : ""}`;
}

async function executeRequest(
  method: HttpMethod, url: string, headers: { key: string; value: string }[], body: string
): Promise<{ status: number; statusText: string; body: string; timeMs: number; ok: boolean }> {
  const t0 = Date.now();
  const hdrs: Record<string, string> = {};
  for (const h of headers) if (h.key.trim()) hdrs[h.key] = h.value;
  const opts: RequestInit = { method, headers: hdrs };
  if (body && !["GET", "DELETE"].includes(method)) opts.body = body;
  const r = await fetch(url, opts);
  const timeMs = Date.now() - t0;
  const ct = r.headers.get("content-type") ?? "";
  let respBody = "";
  try { respBody = ct.includes("json") ? JSON.stringify(await r.json(), null, 2) : await r.text(); } catch {}
  return { status: r.status, statusText: r.statusText, body: respBody, timeMs, ok: r.ok };
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

// ── Step Request Panel ────────────────────────────────────────────────────────

type StepState = {
  method: HttpMethod; url: string;
  headers: { key: string; value: string }[];
  body: string; contract: string;
};

type StepPanelProps = {
  step: Step; idx: number;
  batchResult?: ApiStepResult | null;
  onResult?: (idx: number, r: ApiStepResult) => void;
};

function StepPanel({ step, idx, batchResult, onResult }: StepPanelProps) {
  const parsed = parseAction(step.action ?? "");
  const [state, setState] = useState<StepState>({
    method: ((step.api_method as HttpMethod) ?? parsed.method),
    url: (step.api_url ?? parsed.url),
    headers: [{ key: "Content-Type", value: "application/json" }],
    body: step.data ?? "",
    contract: step.api_contract ?? "",
  });
  const [resp, setResp] = useState<{ status: number; statusText: string; body: string; timeMs: number; ok: boolean; contractErrors: string[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"params" | "curl" | "response">("params");
  const [error, setError] = useState<string | null>(null);
  const [curlImport, setCurlImport] = useState("");
  const [curlOpen, setCurlOpen] = useState(false);

  const applyCurl = () => {
    const parsed = parseCurl(curlImport);
    if (!parsed) { alert("Не удалось распарсить cURL. Проверьте формат."); return; }
    setState({ ...state, method: parsed.method, url: parsed.url, headers: parsed.headers, body: parsed.body });
    setCurlOpen(false); setCurlImport("");
  };

  const expected = useMemo(() => {
    if (step.expected_results?.length) return step.expected_results;
    if (step.expected) return [step.expected];
    return [];
  }, [step]);

  const send = useCallback(async () => {
    if (!state.url.trim()) return;
    setSending(true); setError(null);
    try {
      const r = await executeRequest(state.method, state.url, state.headers, state.body);
      const contractErrors = validateContract(r.body, state.contract);
      const full = { ...r, contractErrors };
      setResp(full);
      setTab("response");
      onResult?.(idx, {
        idx, action: step.action ?? "", method: state.method, url: state.url,
        status: r.status, statusText: r.statusText, ok: r.ok, timeMs: r.timeMs,
        body: r.body, contractErrors,
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setSending(false); }
  }, [state, idx, step.action, onResult]);

  const displayResp = batchResult
    ? { status: batchResult.status, statusText: batchResult.statusText, body: batchResult.body, timeMs: batchResult.timeMs, ok: batchResult.ok, contractErrors: batchResult.contractErrors }
    : resp;

  const sc = displayResp ? (displayResp.ok ? "#16a34a" : "#dc2626") : "#9ca3af";

  return (
    <div className="api-step">
      <div className="api-step-header">
        {batchResult && (
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: batchResult.ok ? "#16a34a" : "#dc2626", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
            {batchResult.ok ? "✓" : "✕"}
          </span>
        )}
        {!batchResult && <span className="api-step-num">{idx + 1}</span>}
        <span className="api-step-action">{step.action}</span>
      </div>

      <div className="api-req-line">
        <select className="api-method-select" style={{ color: METHOD_COLORS[state.method] }}
          value={state.method} onChange={(e) => setState({ ...state, method: e.target.value as HttpMethod })}>
          {HTTP_METHODS.map((m) => <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>{m}</option>)}
        </select>
        <input className="input api-url-input" placeholder="https://api.example.com/endpoint"
          value={state.url} onChange={(e) => setState({ ...state, url: e.target.value })} />
        <button className="btn btn-secondary api-send-btn" style={{ fontSize: 11, padding: "4px 8px" }}
          onClick={() => setCurlOpen((v) => !v)} title="Import cURL">
          cURL ↓
        </button>
        <button className="btn btn-primary api-send-btn" onClick={send} disabled={sending || !state.url.trim()}>
          {sending ? "…" : "▶ Send"}
        </button>
      </div>

      {curlOpen && (
        <div style={{ padding: "8px 10px", background: "var(--color-bg-soft)", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Вставьте cURL команду:</div>
          <textarea className="input" style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            rows={3} placeholder="curl -X POST https://api.example.com -H 'Content-Type: application/json' -d '{...}'"
            value={curlImport} onChange={(e) => setCurlImport(e.target.value)} />
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button className="btn btn-primary" style={{ fontSize: 11, padding: "3px 10px" }} onClick={applyCurl} disabled={!curlImport.trim()}>Применить</button>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => { setCurlOpen(false); setCurlImport(""); }}>Отмена</button>
          </div>
        </div>
      )}

      <div className="api-tabs">
        {(["params", "curl"] as const).map((t) => (
          <button key={t} className={`api-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "params" ? "Headers & Body" : "cURL"}
          </button>
        ))}
        {displayResp && (
          <button className={`api-tab${tab === "response" ? " active" : ""}`} onClick={() => setTab("response")}>
            Response <span style={{ fontWeight: 700, color: sc }}>{displayResp.status}</span>
            <span style={{ marginLeft: 4, fontSize: 10, color: "var(--color-text-muted)" }}>{displayResp.timeMs}ms</span>
            {displayResp.contractErrors.length > 0 && <span style={{ marginLeft: 6, color: "#dc2626", fontSize: 10 }}>⚠{displayResp.contractErrors.length}</span>}
          </button>
        )}
      </div>

      {tab === "params" && (
        <div className="api-params-panel">
          <div className="api-params-section">
            <div className="api-params-label">Headers</div>
            {state.headers.map((h, i) => (
              <div key={i} className="api-header-row">
                <input className="input api-hdr-key" placeholder="Key" value={h.key} onChange={(e) => setState({ ...state, headers: state.headers.map((x, j) => j === i ? { ...x, key: e.target.value } : x) })} />
                <input className="input api-hdr-val" placeholder="Value" value={h.value} onChange={(e) => setState({ ...state, headers: state.headers.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
                <button className="btn-icon" onClick={() => setState({ ...state, headers: state.headers.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button className="btn-link api-add-hdr" onClick={() => setState({ ...state, headers: [...state.headers, { key: "", value: "" }] })}>+ Add header</button>
          </div>
          {!["GET", "DELETE"].includes(state.method) && (
            <div className="api-params-section">
              <div className="api-params-label">Body (JSON)</div>
              <textarea className="input api-body-input" placeholder='{"key": "value"}' value={state.body}
                onChange={(e) => setState({ ...state, body: e.target.value })} rows={4} spellCheck={false} />
            </div>
          )}
          <div className="api-params-section">
            <div className="api-params-label">Contract (JSON Schema для валидации)</div>
            <textarea className="input api-body-input" placeholder='{"id": "number", "name": "string"}'
              value={state.contract} onChange={(e) => setState({ ...state, contract: e.target.value })} rows={2} spellCheck={false} />
          </div>
          {expected.length > 0 && (
            <div className="api-params-section">
              <div className="api-params-label">Expected result</div>
              {expected.map((ex, i) => <div key={i} className="api-expected">{ex}</div>)}
            </div>
          )}
        </div>
      )}
      {tab === "curl" && (
        <div className="api-curl-panel">
          <pre className="api-curl-code">{toCurl(state.method, state.url, state.headers, state.body)}</pre>
          <button className="btn btn-secondary api-copy-btn"
            onClick={() => navigator.clipboard.writeText(toCurl(state.method, state.url, state.headers, state.body)).catch(() => {})}>
            📋 Copy cURL
          </button>
        </div>
      )}
      {tab === "response" && displayResp && (
        <div className="api-resp-panel">
          <div className="api-resp-status">
            <span style={{ fontWeight: 700, fontSize: 16, color: sc }}>{displayResp.status}</span>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)", marginLeft: 8 }}>{displayResp.statusText}</span>
            <span style={{ fontSize: 11, color: "var(--color-text-subtle)", marginLeft: 12 }}>{displayResp.timeMs}ms</span>
          </div>
          {displayResp.contractErrors.length > 0 && (
            <div style={{ background: "var(--color-failed-bg)", border: "1px solid #fca5a5", borderRadius: 4, padding: "6px 10px", marginBottom: 8 }}>
              {displayResp.contractErrors.map((e, i) => <div key={i} style={{ fontSize: 11, color: "#dc2626" }}>• {e}</div>)}
            </div>
          )}
          <pre className="api-resp-body">{displayResp.body || "(empty)"}</pre>
        </div>
      )}
      {error && <div className="api-error">⚠ {error}</div>}
    </div>
  );
}

// ── Endpoint Checker ──────────────────────────────────────────────────────────

type CheckResult = { name: string; passed: boolean | null; detail: string };
type NegScenarioResult = { label: string; body: string; status: number; statusText: string; timeMs: number; passed: boolean };

function checkBodyContains(actualBody: string, expectedBody: string): { ok: boolean; detail: string } {
  if (!expectedBody.trim()) return { ok: true, detail: "" };
  try {
    const actual = JSON.parse(actualBody) as Record<string, unknown>;
    const expected = JSON.parse(expectedBody) as Record<string, unknown>;
    for (const [k, v] of Object.entries(expected)) {
      if (!(k in actual)) return { ok: false, detail: `Поле "${k}" отсутствует в ответе` };
      if (JSON.stringify(actual[k]) !== JSON.stringify(v))
        return { ok: false, detail: `"${k}": ожидалось ${JSON.stringify(v)}, получено ${JSON.stringify(actual[k])}` };
    }
    return { ok: true, detail: "Тело ответа совпадает" };
  } catch {
    return actualBody.includes(expectedBody.trim())
      ? { ok: true, detail: "Строка найдена в ответе" }
      : { ok: false, detail: "Ожидаемая строка не найдена в ответе" };
  }
}

function generateNegScenarios(baseBody: string, types: string[]): { key: string; label: string; body: string }[] {
  const scenarios: { key: string; label: string; body: string }[] = [];
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(baseBody) as Record<string, unknown>; } catch {}
  if (types.includes("empty_object"))
    scenarios.push({ key: "empty_object", label: "Пустое тело {}", body: "{}" });
  if (types.includes("empty_values") && parsed) {
    const emp: Record<string, unknown> = {};
    for (const k of Object.keys(parsed)) emp[k] = "";
    scenarios.push({ key: "empty_values", label: "Пустые строки во всех полях", body: JSON.stringify(emp) });
  }
  if (types.includes("whitespace_values") && parsed) {
    const ws: Record<string, unknown> = {};
    for (const k of Object.keys(parsed)) ws[k] = "   ";
    scenarios.push({ key: "whitespace_values", label: "Значения с пробелами", body: JSON.stringify(ws) });
  }
  if (types.includes("missing_fields") && parsed) {
    const keys = Object.keys(parsed);
    for (const omit of keys) {
      const partial: Record<string, unknown> = {};
      for (const k of keys) if (k !== omit) partial[k] = parsed[k];
      scenarios.push({ key: `missing_${omit}`, label: `Без поля "${omit}"`, body: JSON.stringify(partial) });
    }
  }
  return scenarios;
}

const NEG_SCENARIO_TYPES = [
  { key: "empty_object",      label: "Пустое тело {}" },
  { key: "empty_values",      label: "Пустые значения в полях" },
  { key: "whitespace_values", label: "Пробелы в полях" },
  { key: "missing_fields",    label: "Отсутствующие поля (по одному)" },
];

function EndpointCheckerView() {
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");

  const [c1Enabled, setC1Enabled] = useState(true);
  const [c1Open, setC1Open] = useState(true);
  const [c1Status, setC1Status] = useState(200);
  const [c1ExpBody, setC1ExpBody] = useState("");

  const [c2Enabled, setC2Enabled] = useState(true);
  const [c2Open, setC2Open] = useState(true);
  const [c2ExpStatus, setC2ExpStatus] = useState(200);
  const [c2ExpBody, setC2ExpBody] = useState("");

  const [c3Enabled, setC3Enabled] = useState(true);
  const [c3Open, setC3Open] = useState(true);
  const [c3WrongMethods, setC3WrongMethods] = useState<HttpMethod[]>(["POST", "DELETE"]);
  const [c3ExpStatus, setC3ExpStatus] = useState(405);

  const [c4Enabled, setC4Enabled] = useState(false);
  const [c4Open, setC4Open] = useState(true);
  const [c4BaseBody, setC4BaseBody] = useState("");
  const [c4Types, setC4Types] = useState<string[]>(["empty_object", "empty_values", "missing_fields"]);
  const [c4ExpStatus, setC4ExpStatus] = useState(422);
  const [c4Results, setC4Results] = useState<Record<string, NegScenarioResult | "running">>({});
  const [runAt, setRunAt] = useState<string | null>(null);

  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const hdrs = [{ key: "Content-Type", value: "application/json" }];

  const runAll = async () => {
    if (!url.trim()) return;
    setRunning(true);
    setC4Results({});
    setRunAt(new Date().toLocaleString("ru-RU"));
    const res: CheckResult[] = [];

    if (c1Enabled) {
      try {
        const r = await executeRequest(method, url, hdrs, body);
        const statusOk = r.status === c1Status;
        const bodyCheck = checkBodyContains(r.body, c1ExpBody);
        const passed = statusOk && bodyCheck.ok;
        const parts = [`Статус: ${r.status}${statusOk ? "✓" : `✕(ожид.${c1Status})`}`, `${r.timeMs}ms`];
        if (c1ExpBody.trim()) parts.push(bodyCheck.ok ? "Тело ✓" : `Тело ✕ ${bodyCheck.detail}`);
        res.push({ name: "Критерий 1: Доступность", passed, detail: parts.join(" · ") });
      } catch (e) {
        res.push({ name: "Критерий 1: Доступность", passed: false, detail: `Ошибка: ${e instanceof Error ? e.message : "unknown"}` });
      }
    }

    if (c2Enabled) {
      try {
        const r1 = await executeRequest(method, url, hdrs, body);
        const r2 = await executeRequest(method, url, hdrs, body);
        const idempOk = r1.body === r2.body && r1.status === r2.status;
        const statusOk = r1.status === c2ExpStatus;
        const bodyCheck = checkBodyContains(r1.body, c2ExpBody);
        const passed = idempOk && statusOk && bodyCheck.ok;
        const parts = [
          idempOk ? "Ответы совпадают ✓" : `Ответы различаются ✕ (${r1.status}/${r2.status})`,
          statusOk ? `Статус ${c2ExpStatus} ✓` : `Статус: ожид.${c2ExpStatus}, факт ${r1.status} ✕`,
        ];
        if (c2ExpBody.trim()) parts.push(bodyCheck.ok ? "Тело ✓" : `Тело ✕ ${bodyCheck.detail}`);
        res.push({ name: "Критерий 2: Идемпотентность", passed, detail: parts.join(" · ") });
      } catch (e) {
        res.push({ name: "Критерий 2: Идемпотентность", passed: false, detail: `Ошибка: ${e instanceof Error ? e.message : "unknown"}` });
      }
    }

    if (c3Enabled && c3WrongMethods.length > 0) {
      const parts: string[] = [];
      let allOk = true;
      for (const m of c3WrongMethods) {
        if (m === method) continue;
        try {
          const r = await executeRequest(m, url, hdrs, "");
          const ok = r.status === c3ExpStatus;
          if (!ok) allOk = false;
          parts.push(`${m}→${r.status}${ok ? "✓" : `✕(ожид.${c3ExpStatus})`}`);
        } catch { allOk = false; parts.push(`${m}→ошибка`); }
      }
      res.push({ name: "Критерий 3: Защита от неверных методов", passed: allOk && parts.length > 0, detail: parts.join(" | ") || "Нет методов" });
    }

    if (c4Enabled) {
      const scenarios = generateNegScenarios(c4BaseBody, c4Types);
      const negMap: Record<string, NegScenarioResult | "running"> = {};
      let allNegOk = scenarios.length > 0;
      for (const sc of scenarios) {
        negMap[sc.key] = "running";
        setC4Results({ ...negMap });
        try {
          const r = await executeRequest(method, url, hdrs, sc.body);
          const passed = r.status === c4ExpStatus;
          if (!passed) allNegOk = false;
          negMap[sc.key] = { label: sc.label, body: sc.body, status: r.status, statusText: r.statusText, timeMs: r.timeMs, passed };
        } catch (e) {
          allNegOk = false;
          negMap[sc.key] = { label: sc.label, body: sc.body, status: 0, statusText: String(e), timeMs: 0, passed: false };
        }
        setC4Results({ ...negMap });
      }
      const passedCount = Object.values(negMap).filter((v) => v !== "running" && v.passed).length;
      res.push({ name: "Критерий 4: Негативные сценарии", passed: allNegOk, detail: `${passedCount}/${scenarios.length} → ожид. ${c4ExpStatus}` });
    }

    setResults(res);
    setRunning(false);
  };

  const allPassed = results?.length ? results.every((r) => r.passed) : null;
  const lbl = { fontSize: 12, color: "var(--color-text-muted)" } as const;

  const CriterionBadge = ({ name }: { name: string }) => {
    const r = results?.find((x) => x.name.startsWith(name));
    if (!r) return null;
    return <span style={{ width: 20, height: 20, borderRadius: "50%", background: r.passed ? "#16a34a" : "#dc2626", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{r.passed ? "✓" : "✕"}</span>;
  };

  const cfgPad: React.CSSProperties = { padding: "10px 14px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, borderTop: "1px solid var(--color-border)" };

  const ExpBodyField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div style={{ width: "100%", marginTop: 4 }}>
      <div style={{ ...lbl, marginBottom: 3 }}>Ожидаемое тело ответа (JSON contains, опционально):</div>
      <textarea className="input api-body-input" rows={2} placeholder='{"status": "ok"}' value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </div>
  );

  // Collapsible criterion head - click on title area toggles open, checkbox toggles enabled independently
  const CriterionHead = ({
    enabled, setEnabled, open, setOpen, title, subtitle,
  }: {
    enabled: boolean; setEnabled: (v: boolean) => void;
    open: boolean; setOpen: (v: boolean) => void;
    title: string; subtitle: string;
  }) => (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--color-bg-soft)", cursor: "pointer", userSelect: "none" }}
      onClick={() => setOpen(!open)}
    >
      <input type="checkbox" checked={enabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setEnabled(e.target.checked); }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{subtitle}</div>
      </div>
      <CriterionBadge name={title.split(":")[0]} />
      <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: 4 }}>{open ? "▼" : "▶"}</span>
    </div>
  );

  const exportReport = () => {
    if (!results) return;
    const c4rows = Object.entries(c4Results).filter(([, r]) => r !== "running").map(([, r]) => r as NegScenarioResult);
    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Endpoint Check Report</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h2{font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f3f4f6;font-weight:600}.pass{color:#15803d;font-weight:700}.fail{color:#dc2626;font-weight:700}@media print{@page{margin:10mm}}</style>
</head><body>
<h2>🔍 Endpoint Checker — Отчёт</h2>
<p style="font-size:11px;color:#666">Эндпоинт: <b>${method} ${url}</b> · ${runAt ?? new Date().toLocaleString("ru-RU")}</p>
<p style="font-size:11px;color:#666">Итог: <b class="${allPassed ? "pass" : "fail"}">${allPassed ? "Все критерии пройдены ✅" : "Есть нарушения ❌"}</b> (${results.filter((r) => r.passed).length}/${results.length})</p>
<table><thead><tr><th>Критерий</th><th>Результат</th><th>Детали</th></tr></thead><tbody>
${results.map((r) => `<tr><td>${r.name}</td><td class="${r.passed ? "pass" : "fail"}">${r.passed ? "✓ Пройден" : "✕ Не пройден"}</td><td>${r.detail}</td></tr>`).join("")}
</tbody></table>
${c4rows.length > 0 ? `<h3 style="font-size:13px;margin-top:16px">Критерий 4: Негативные сценарии</h3>
<table><thead><tr><th>Сценарий</th><th>Статус</th><th>Результат</th><th>Время</th></tr></thead><tbody>
${c4rows.map((r) => `<tr><td>${r.label}</td><td>${r.status} ${r.statusText}</td><td class="${r.passed ? "pass" : "fail"}">${r.passed ? "✓" : "✕"}</td><td>${r.timeMs}ms</td></tr>`).join("")}
</tbody></table>` : ""}
<script>window.onload=()=>window.print()</script></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* ── Left: endpoint config + criteria ── */}
      <div style={{ flex: "0 0 55%", overflowY: "auto", padding: "16px 20px", borderRight: "1px solid var(--color-border)" }}>
        {/* Endpoint config */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Конфигурация эндпоинта</div>
          <div className="api-req-line">
            <select className="api-method-select" style={{ color: METHOD_COLORS[method] }}
              value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
              {HTTP_METHODS.map((m) => <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>{m}</option>)}
            </select>
            <input className="input api-url-input" placeholder="https://api.example.com/endpoint"
              value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-primary" style={{ fontSize: 12, padding: "5px 14px" }}
              onClick={runAll} disabled={running || !url.trim()}>
              {running ? "⏳ Проверяем…" : "▶ Запустить все"}
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ ...lbl, marginBottom: 3 }}>Тело запроса (для критериев 1, 2, 4):</div>
            <textarea className="input api-body-input" placeholder='{"key": "value"}' value={body}
              onChange={(e) => setBody(e.target.value)} rows={2} spellCheck={false} />
          </div>
        </div>

        {/* Criteria */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Criterion 1 */}
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            <CriterionHead enabled={c1Enabled} setEnabled={setC1Enabled} open={c1Open} setOpen={setC1Open}
              title="Критерий 1: Доступность"
              subtitle="Запрос с корректными данными → ожидается указанный статус" />
            {c1Open && c1Enabled && (
              <div style={cfgPad}>
                <span style={lbl}>Ожидаемый статус:</span>
                <input type="number" className="input" style={{ width: 80 }} value={c1Status}
                  onChange={(e) => setC1Status(Number(e.target.value) || 200)} />
                <ExpBodyField value={c1ExpBody} onChange={setC1ExpBody} />
              </div>
            )}
          </div>

          {/* Criterion 2 */}
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            <CriterionHead enabled={c2Enabled} setEnabled={setC2Enabled} open={c2Open} setOpen={setC2Open}
              title="Критерий 2: Идемпотентность"
              subtitle="Два одинаковых запроса → ответы должны совпадать" />
            {c2Open && c2Enabled && (
              <div style={cfgPad}>
                <span style={lbl}>Ожидаемый статус:</span>
                <input type="number" className="input" style={{ width: 80 }} value={c2ExpStatus}
                  onChange={(e) => setC2ExpStatus(Number(e.target.value) || 200)} />
                <ExpBodyField value={c2ExpBody} onChange={setC2ExpBody} />
              </div>
            )}
          </div>

          {/* Criterion 3 */}
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            <CriterionHead enabled={c3Enabled} setEnabled={setC3Enabled} open={c3Open} setOpen={setC3Open}
              title="Критерий 3: Защита от неверных методов"
              subtitle="Неправильные HTTP-методы → должны вернуть ошибку (обычно 405)" />
            {c3Open && c3Enabled && (
              <div style={cfgPad}>
                <span style={lbl}>Проверить методы:</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {HTTP_METHODS.filter((m) => m !== method).map((m) => (
                    <label key={m} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}
                      onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={c3WrongMethods.includes(m)}
                        onChange={(e) => { e.stopPropagation(); setC3WrongMethods((prev) => e.target.checked ? [...prev, m] : prev.filter((x) => x !== m)); }} />
                      <span style={{ color: METHOD_COLORS[m], fontWeight: 700 }}>{m}</span>
                    </label>
                  ))}
                </div>
                <span style={lbl}>→ ожидается:</span>
                <input type="number" className="input" style={{ width: 70 }} value={c3ExpStatus}
                  onChange={(e) => setC3ExpStatus(Number(e.target.value) || 405)} />
              </div>
            )}
          </div>

          {/* Criterion 4 */}
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            <CriterionHead enabled={c4Enabled} setEnabled={setC4Enabled} open={c4Open} setOpen={setC4Open}
              title="Критерий 4: Негативные сценарии"
              subtitle="Невалидные тела запроса → ожидается ошибка (400/422)" />
            {c4Open && c4Enabled && (
              <div style={{ ...cfgPad, flexDirection: "column", alignItems: "flex-start" }}>
                <div style={{ width: "100%" }}>
                  <div style={{ ...lbl, marginBottom: 3 }}>Шаблон тела (валидный JSON):</div>
                  <textarea className="input api-body-input" rows={2}
                    placeholder='{"email": "test@test.com", "password": "123456"}'
                    value={c4BaseBody} onChange={(e) => setC4BaseBody(e.target.value)} spellCheck={false} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span style={lbl}>Типы сценариев:</span>
                  {NEG_SCENARIO_TYPES.map((t) => (
                    <label key={t.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}
                      onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={c4Types.includes(t.key)}
                        onChange={(e) => { e.stopPropagation(); setC4Types((prev) => e.target.checked ? [...prev, t.key] : prev.filter((x) => x !== t.key)); }} />
                      {t.label}
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={lbl}>Ожидаемый статус ошибки:</span>
                  <input type="number" className="input" style={{ width: 80 }} value={c4ExpStatus}
                    onChange={(e) => setC4ExpStatus(Number(e.target.value) || 422)} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Right: detailed report ── */}
      <div style={{ flex: "0 0 45%", overflowY: "auto", padding: "16px 20px", background: "var(--color-bg-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Детальный отчёт</span>
          {results && (
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: "3px 10px" }} onClick={exportReport}>
              🖨 Экспорт / Печать
            </button>
          )}
        </div>

        {!results ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--color-text-muted)", fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
            <div>Нажмите «▶ Запустить все» чтобы получить отчёт</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Summary */}
            <div style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${allPassed ? "#86efac" : "#fca5a5"}`, background: allPassed ? "#f0fdf4" : "#fef2f2", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>{allPassed ? "✅" : "❌"}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: allPassed ? "#15803d" : "#dc2626" }}>
                  {allPassed ? "Все критерии пройдены" : "Есть нарушения"}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  {results.filter((r) => r.passed).length}/{results.length} · {method} {url.length > 40 ? url.slice(0, 40) + "…" : url}
                </div>
                {runAt && <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{runAt}</div>}
              </div>
            </div>

            {/* Per-criterion results */}
            {results.map((r) => (
              <div key={r.name} style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden", background: "var(--color-bg)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: r.passed ? "#f0fdf4" : "#fef2f2", borderBottom: "1px solid var(--color-border)" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: r.passed ? "#15803d" : "#dc2626" }}>{r.passed ? "✓" : "✕"}</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{r.name}</span>
                </div>
                <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                  {r.detail}
                </div>
                {/* Criterion 4 negative scenarios */}
                {r.name.startsWith("Критерий 4") && Object.keys(c4Results).length > 0 && (
                  <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {Object.entries(c4Results).map(([key, neg]) => {
                      if (neg === "running") return (
                        <div key={key} style={{ fontSize: 11, color: "var(--color-text-muted)", padding: "3px 6px", background: "var(--color-bg-soft)", borderRadius: 3 }}>⏳ {key}…</div>
                      );
                      return (
                        <div key={key} style={{ fontSize: 11, padding: "5px 8px", borderRadius: 4, background: neg.passed ? "#f0fdf4" : "#fef2f2", border: `1px solid ${neg.passed ? "#86efac" : "#fca5a5"}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, color: neg.passed ? "#15803d" : "#dc2626" }}>{neg.passed ? "✓" : "✕"}</span>
                          <span style={{ flex: 1 }}>{neg.label}</span>
                          <span style={{ fontWeight: 700, color: neg.passed ? "#15803d" : "#dc2626" }}>{neg.status} {neg.statusText}</span>
                          <span style={{ color: "var(--color-text-muted)" }}>{neg.timeMs}ms</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Monitor view ──────────────────────────────────────────────────────────────

function MonitorView({ projectId }: { projectId?: string }) {
  const [history, setHistory] = useState<ApiRunRecord[]>([]);
  const [selected, setSelected] = useState<ApiRunRecord | null>(null);

  const reload = () => {
    const all = loadHistory();
    setHistory(projectId ? all.filter((r) => r.projectId === projectId) : all);
  };

  useEffect(() => { reload(); }, [projectId]);

  const clearHistory = () => {
    if (!confirm("Очистить историю API запусков?")) return;
    saveHistory([]);
    setHistory([]); setSelected(null);
  };

  if (history.length === 0) {
    return (
      <div className="api-runner-select-hint">
        <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Нет запусков</div>
        <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
          Запустите API тест-кейс чтобы здесь появились результаты.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* List */}
      <div style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--color-border)", overflow: "auto" }}>
        <div style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-soft)" }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{history.length} запусков</span>
          <button className="btn-link" style={{ fontSize: 11, color: "#dc2626" }} onClick={clearHistory}>Очистить</button>
        </div>
        {history.map((r) => {
          const allOk = r.failed === 0;
          return (
            <div key={r.id}
              className={`api-runner-case-item${selected?.id === r.id ? " active" : ""}`}
              onClick={() => setSelected(r)}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: allOk ? "#16a34a" : "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                  {allOk ? "✓" : "✕"}
                </span>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.caseName}</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--color-text-muted)", paddingLeft: 22 }}>
                {r.projectName} · {r.total} шагов · {r.passed}✓ {r.failed}✕ · {Math.round(r.duration)}ms
              </div>
              <div style={{ fontSize: 10, color: "var(--color-text-subtle)", paddingLeft: 22 }}>
                {fmtTime(r.startedAt)}
              </div>
            </div>
          );
        })}
      </div>
      {/* Detail */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        {!selected ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 40, textAlign: "center" }}>Выберите запуск</div>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{selected.caseName}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>📁 {selected.projectName}</span>
                <span>🕐 {fmtTime(selected.startedAt)}</span>
                <span>⏱ {selected.duration}ms</span>
                <span style={{ color: "#16a34a" }}>✓ {selected.passed} passed</span>
                {selected.failed > 0 && <span style={{ color: "#dc2626" }}>✕ {selected.failed} failed</span>}
              </div>
            </div>
            {selected.steps.map((s, i) => {
              const sc2 = s.ok ? "#16a34a" : "#dc2626";
              return (
                <div key={i} style={{ border: "1px solid var(--color-border)", borderRadius: 6, marginBottom: 10, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--color-bg-soft)", fontSize: 12 }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", background: sc2, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{s.ok ? "✓" : "✕"}</span>
                    <span style={{ fontWeight: 700, color: METHOD_COLORS[s.method as HttpMethod] ?? "#6b7280", flexShrink: 0 }}>{s.method}</span>
                    <span style={{ flex: 1, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text)" }}>{s.url}</span>
                    <span style={{ fontWeight: 700, color: sc2, flexShrink: 0 }}>{s.status}</span>
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)", flexShrink: 0 }}>{s.timeMs}ms</span>
                  </div>
                  {(s.contractErrors.length > 0 || s.body) && (
                    <div style={{ padding: "8px 12px" }}>
                      {s.contractErrors.length > 0 && (
                        <div style={{ background: "var(--color-failed-bg)", borderRadius: 4, padding: "4px 8px", marginBottom: 6 }}>
                          {s.contractErrors.map((e, ci) => <div key={ci} style={{ fontSize: 11, color: "#dc2626" }}>• {e}</div>)}
                        </div>
                      )}
                      {s.body && <pre style={{ fontFamily: "monospace", fontSize: 11, background: "var(--color-bg-soft)", borderRadius: 4, padding: "6px 8px", overflow: "auto", maxHeight: 120, whiteSpace: "pre", color: "var(--color-text)", margin: 0 }}>{s.body}</pre>}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ── 4QA API Check runner ──────────────────────────────────────────────────────

function ApiCheckRunner({ projects }: { projects: Project[] }) {
  const [selectedProject, setSelectedProject] = useState("");
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const [selectedCase, setSelectedCase] = useState<TestCase | null>(null);
  const [searchCase, setSearchCase] = useState("");
  const [runTab, setRunTab] = useState<"runner" | "monitor" | "settings" | "checker">("runner");
  const [batchResults, setBatchResults] = useState<Record<number, ApiStepResult>>({});
  const [running, setRunning] = useState(false);

  const [inRunsEnabled, setInRunsEnabled] = useState(() => localStorage.getItem("api_check_in_runs_enabled") === "true");
  const [validateFields, setValidateFields] = useState(() => localStorage.getItem("api_check_validate_fields") === "true");
  const [validateStatus, setValidateStatus] = useState(() => localStorage.getItem("api_check_validate_status") === "true");

  const toggleSetting = (key: string, val: boolean, setter: (v: boolean) => void) => {
    setter(val);
    localStorage.setItem(key, String(val));
  };

  useEffect(() => {
    if (!selectedProject) { setCases([]); setSelectedCase(null); return; }
    setLoadingCases(true);
    casesApi.list(selectedProject)
      .then((all) => setCases(all.filter((c) => c.layer === "api")))
      .catch(() => setCases([]))
      .finally(() => setLoadingCases(false));
  }, [selectedProject]);

  const filteredCases = useMemo(() =>
    cases.filter((c) => !searchCase || c.name.toLowerCase().includes(searchCase.toLowerCase())),
    [cases, searchCase]);

  const handleStepResult = useCallback((idx: number, r: ApiStepResult) => {
    setBatchResults((prev) => ({ ...prev, [idx]: r }));
  }, []);

  const runAll = useCallback(async () => {
    if (!selectedCase || running) return;
    setRunning(true);
    setBatchResults({});
    const proj = projects.find((p) => p.id === selectedProject);
    const t0 = Date.now();
    const stepResults: ApiStepResult[] = [];

    for (let i = 0; i < selectedCase.steps.length; i++) {
      const s = selectedCase.steps[i];
      const parsed = parseAction(s.action ?? "");
      const method = ((s.api_method as HttpMethod) ?? parsed.method) as HttpMethod;
      const url = s.api_url ?? parsed.url;
      if (!url) {
        const r: ApiStepResult = { idx: i, action: s.action ?? "", method, url, status: 0, statusText: "Skipped (no URL)", ok: false, timeMs: 0, body: "", contractErrors: [] };
        setBatchResults((prev) => ({ ...prev, [i]: r }));
        stepResults.push(r);
        continue;
      }
      try {
        const res = await executeRequest(method, url, [{ key: "Content-Type", value: "application/json" }], s.data ?? "");
        const r: ApiStepResult = { idx: i, action: s.action ?? "", method, url, ...res, contractErrors: [] };
        setBatchResults((prev) => ({ ...prev, [i]: r }));
        stepResults.push(r);
      } catch (e) {
        const r: ApiStepResult = { idx: i, action: s.action ?? "", method, url, status: 0, statusText: e instanceof Error ? e.message : "Error", ok: false, timeMs: 0, body: "", contractErrors: [] };
        setBatchResults((prev) => ({ ...prev, [i]: r }));
        stepResults.push(r);
      }
    }

    const duration = Date.now() - t0;
    const passed = stepResults.filter((r) => r.ok).length;
    const failed = stepResults.filter((r) => !r.ok).length;

    addRun({
      id: crypto.randomUUID(),
      projectId: selectedProject,
      projectName: proj?.name ?? "Unknown",
      caseId: selectedCase.id,
      caseName: selectedCase.name,
      startedAt: new Date().toISOString(),
      duration, steps: stepResults, passed, failed, total: stepResults.length,
    });
    setRunning(false);
  }, [selectedCase, selectedProject, projects, running]);

  const batchPassed = Object.values(batchResults).filter((r) => r.ok).length;
  const batchFailed = Object.values(batchResults).filter((r) => !r.ok).length;
  const batchDone = Object.keys(batchResults).length;

  return (
    <div className="api-runner">
      {/* Top tabs */}
      <div className="api-runner-topbar">
        <h2 className="api-runner-title">🌐 4QA API Check</h2>
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
          {(["runner", "monitor", "checker", "settings"] as const).map((t) => (
            <button key={t} style={{ padding: "5px 14px", border: "none", background: runTab === t ? "var(--color-accent)" : "var(--color-bg)", color: runTab === t ? "#fff" : "var(--color-text-muted)", fontWeight: 600, fontSize: 12, cursor: "pointer", borderLeft: t !== "runner" ? "1px solid var(--color-border)" : undefined }}
              onClick={() => setRunTab(t)}>
              {t === "runner" ? "▶ Runner" : t === "monitor" ? "📊 Monitor" : t === "checker" ? "🔍 Endpoint Checker" : "⚙ Настройки"}
            </button>
          ))}
        </div>
      </div>

      {runTab === "monitor" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", border: "1px solid var(--color-border)", borderRadius: 8 }}>
          <MonitorView projectId={selectedProject || undefined} />
        </div>
      )}

      {runTab === "checker" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", border: "1px solid var(--color-border)", borderRadius: 8, display: "flex", flexDirection: "column" }}>
          <EndpointCheckerView />
        </div>
      )}

      {runTab === "settings" && (
        <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8, padding: "24px 28px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Настройки 4QA API Check</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 600 }}>
            {/* Enable in test runs */}
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "14px 16px", background: "var(--color-bg)" }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={inRunsEnabled}
                  onChange={(e) => toggleSetting("api_check_in_runs_enabled", e.target.checked, setInRunsEnabled)}
                  style={{ marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Включить API Check в тестовых прогонах</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 3 }}>
                    При включении для тест-кейсов с Layer = API в прогоне появится кнопка «▶ API» для автоматического выполнения HTTP-запросов из шагов
                  </div>
                </div>
              </label>
            </div>

            {inRunsEnabled && (
              <>
                <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "14px 16px", background: "var(--color-bg)" }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={validateStatus}
                      onChange={(e) => toggleSetting("api_check_validate_status", e.target.checked, setValidateStatus)}
                      style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Валидация статус-кодов</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 3 }}>
                        Проверять HTTP статус-код шага. Если в шаге задано поле «Ожидаемый статус» — сравнивать с ним; иначе проверяется 2xx (ok)
                      </div>
                    </div>
                  </label>
                </div>

                <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "14px 16px", background: "var(--color-bg)" }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={validateFields}
                      onChange={(e) => toggleSetting("api_check_validate_fields", e.target.checked, setValidateFields)}
                      style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Валидация полей ответа (Contract)</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 3 }}>
                        Проверять поля JSON-ответа по схеме, указанной в поле «Contract» каждого шага тест-кейса. Формат: {"{"}"field": "type"{"}"} (например {"{"}"id": "number", "name": "string"{"}"})
                      </div>
                    </div>
                  </label>
                </div>
              </>
            )}

            <div style={{ fontSize: 11, color: "var(--color-text-muted)", padding: "8px 12px", background: "var(--color-bg-soft)", borderRadius: 6, border: "1px solid var(--color-border)" }}>
              <strong>Формат шага API тест-кейса:</strong><br />
              Поле «Action»: <code>GET https://api.example.com/users</code><br />
              Поле «Data»: тело запроса (JSON для POST/PUT)<br />
              Поле «Ожидаемый статус»: числовой код (200, 201, 404…)<br />
              Поле «Contract»: JSON-схема полей ответа для валидации
            </div>
          </div>
        </div>
      )}

      {runTab === "runner" && (
        <div className="api-runner-layout">
          {/* Sidebar */}
          <div className="api-runner-sidebar">
            <div className="api-runner-sidebar-head">
              <select className="input" style={{ width: "100%", fontSize: 12, marginBottom: 8 }}
                value={selectedProject} onChange={(e) => { setSelectedProject(e.target.value); setSelectedCase(null); setBatchResults({}); }}>
                <option value="">— Выберите проект —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {selectedProject && (
                <input className="input" style={{ width: "100%", fontSize: 12 }} placeholder="Поиск…"
                  value={searchCase} onChange={(e) => setSearchCase(e.target.value)} />
              )}
            </div>
            <div className="api-runner-case-list">
              {!selectedProject && <div className="api-runner-empty">Выберите проект</div>}
              {selectedProject && loadingCases && <div className="api-runner-empty">Загружаем…</div>}
              {selectedProject && !loadingCases && filteredCases.length === 0 && (
                <div className="api-runner-empty">Нет API тест-кейсов.<br /><span style={{ fontSize: 11 }}>Layer = API в тест-кейсе.</span></div>
              )}
              {filteredCases.map((c) => (
                <div key={c.id} className={`api-runner-case-item${selectedCase?.id === c.id ? " active" : ""}`}
                  onClick={() => { setSelectedCase(c); setBatchResults({}); }}>
                  <span className="case-api-badge" style={{ marginRight: 4 }}>API</span>
                  <span className="api-runner-case-name">{c.name}</span>
                  <span className="api-runner-case-steps">{c.steps.length}s</span>
                </div>
              ))}
            </div>
          </div>

          {/* Main */}
          <div className="api-runner-main">
            {!selectedCase ? (
              <div className="api-runner-select-hint">
                <div style={{ fontSize: 32, marginBottom: 12 }}>🌐</div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Выберите API тест-кейс</div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Каждый шаг = HTTP запрос. Формат: <code>METHOD https://url</code></div>
              </div>
            ) : (
              <div className="api-runner-steps">
                <div className="api-runner-case-header">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="case-api-badge">API</span>
                    <strong style={{ fontSize: 15 }}>{selectedCase.name}</strong>
                    <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{selectedCase.steps.length} шагов</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {batchDone > 0 && (
                      <span style={{ fontSize: 12 }}>
                        <span style={{ color: "#16a34a", fontWeight: 700 }}>✓{batchPassed}</span>
                        {batchFailed > 0 && <span style={{ color: "#dc2626", fontWeight: 700, marginLeft: 6 }}>✕{batchFailed}</span>}
                      </span>
                    )}
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: "5px 14px" }}
                      onClick={runAll} disabled={running || selectedCase.steps.length === 0}>
                      {running ? "⏳ Running…" : "▶▶ Run All Steps"}
                    </button>
                  </div>
                </div>
                {selectedCase.steps.map((step, i) => (
                  <StepPanel key={i} step={step} idx={i}
                    batchResult={batchResults[i] ?? null}
                    onResult={handleStepResult} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// ── Report Template Constructor ───────────────────────────────────────────────

const RT_ENABLED_KEY = "report_template_app_enabled";

const TAB_LABELS: Record<string, string> = {
  protocol: "Протокол", act: "Акт тестирования", completion: "Акт выполненных работ", defect: "Отчёт о дефекте",
};

function SuitePathSettingsRow({
  cfg, setCfg,
}: {
  cfg: ReportTemplateCfg;
  setCfg: React.Dispatch<React.SetStateAction<ReportTemplateCfg>>;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const showPath = (cfg.protocol as any).showSuitePath ?? false;
  const pathLabel = (cfg.protocol as any).suitePathLabel ?? "Путь: ";

  const setShowPath = (v: boolean) =>
    setCfg((p) => ({ ...p, protocol: { ...p.protocol, showSuitePath: v } as any }));
  const setPathLabel = (v: string) =>
    setCfg((p) => ({ ...p, protocol: { ...p.protocol, suitePathLabel: v } as any }));

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-bg)", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <input type="checkbox" checked={showPath} onChange={(e) => setShowPath(e.target.checked)} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Показывать путь до сьюта (хлебные крошки)</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            Под названием тест-кейса в разделе 3 отображается путь через сьюты: Suite A / Suite B
          </div>
        </div>
        <button
          title="Настройки хлебных крошек"
          style={{
            background: settingsOpen ? "var(--color-accent-soft)" : "none",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: "3px 10px",
            cursor: "pointer",
            fontSize: 12,
            color: settingsOpen ? "var(--color-accent)" : "var(--color-text-muted)",
          }}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          ⚙ Настройки
        </button>
      </div>
      {settingsOpen && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)", background: "var(--color-bg-soft)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: 4 }}>
              Метка / префикс
            </label>
            <input
              className="input"
              style={{ width: "100%", maxWidth: 320, fontSize: 13 }}
              placeholder="Путь: "
              value={pathLabel}
              onChange={(e) => setPathLabel(e.target.value)}
            />
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
              Пример: <code style={{ background: "var(--color-bg)", padding: "1px 4px", borderRadius: 3 }}>
                {pathLabel || ""}Suite A / Suite B
              </code>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontStyle: "italic" }}>
            Настройки сохраняются вместе с шаблоном. Включите чекбокс выше, чтобы отображать путь в отчёте.
          </div>
        </div>
      )}
    </div>
  );
}

function ReportTemplateConstructor({ onBack }: { onBack: () => void }) {
  const [cfg, setCfg] = useState<ReportTemplateCfg>(loadReportTemplateCfg);
  const [tab, setTab] = useState<keyof ReportTemplateCfg>("protocol");
  const [saved, setSaved] = useState(false);

  const save = () => {
    saveReportTemplateCfg(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const resetToDefault = () => {
    if (!confirm("Сбросить настройки шаблонов к стандартным?")) return;
    const d = defaultReportTemplateCfg();
    setCfg(d);
    saveReportTemplateCfg(d);
  };

  const updateDocTitle = (template: keyof ReportTemplateCfg, val: string) =>
    setCfg((p) => ({ ...p, [template]: { ...(p[template] as any), docTitle: val } }));

  const updateSection = (template: keyof ReportTemplateCfg, sectionKey: string, field: keyof RtSectionCfg, value: string | boolean) =>
    setCfg((prev) => {
      const tmpl = { ...(prev[template] as any) };
      tmpl.sections = { ...tmpl.sections, [sectionKey]: { ...tmpl.sections[sectionKey], [field]: value } };
      return { ...prev, [template]: tmpl };
    });

  const renderSections = (template: keyof ReportTemplateCfg) => {
    const tmpl = cfg[template] as any;
    if (!tmpl?.sections) return null;
    const entries = Object.entries(tmpl.sections) as [string, RtSectionCfg][];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {entries.map(([key, sec]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--color-border)", borderRadius: 6, background: sec.enabled ? "var(--color-bg)" : "var(--color-bg-soft)" }}>
            <input type="checkbox" checked={sec.enabled} onChange={(e) => updateSection(template, key, "enabled", e.target.checked)} />
            <input
              className="input"
              style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}
              value={sec.title}
              disabled={!sec.enabled}
              onChange={(e) => updateSection(template, key, "title", e.target.value)}
            />
            <span style={{ fontSize: 10, color: sec.enabled ? "var(--color-passed)" : "var(--color-text-subtle)", flexShrink: 0, fontWeight: 600 }}>
              {sec.enabled ? "✓ включён" : "✕ скрыт"}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const tmpl = cfg[tab] as any;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="btn-link" style={{ fontSize: 13 }} onClick={onBack}>← Все приложения</button>
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden", marginLeft: "auto" }}>
          {(Object.keys(TAB_LABELS) as (keyof ReportTemplateCfg)[]).map((t) => (
            <button key={t} style={{ padding: "5px 14px", border: "none", background: tab === t ? "var(--color-accent)" : "var(--color-bg)", color: tab === t ? "#fff" : "var(--color-text-muted)", fontWeight: 600, fontSize: 12, cursor: "pointer", borderLeft: t !== "protocol" ? "1px solid var(--color-border)" : undefined }}
              onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <button className="btn" style={{ fontSize: 11 }} onClick={resetToDefault}>↺ Сброс</button>
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={save}>{saved ? "✓ Сохранено" : "Сохранить"}</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label className="pf-label">Заголовок документа</label>
            <input className="input" style={{ width: "100%", maxWidth: 520, marginTop: 4 }} value={tmpl?.docTitle ?? ""}
              onChange={(e) => updateDocTitle(tab, e.target.value)} />
          </div>
        </div>

        {tab === "protocol" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {/* Description toggle */}
            <div style={{ padding: "10px 14px", border: "1px solid var(--color-border)", borderRadius: 6, display: "flex", alignItems: "center", gap: 10, background: "var(--color-bg)" }}>
              <input type="checkbox"
                checked={(cfg.protocol as any).showCaseDescription ?? true}
                onChange={(e) => setCfg((p) => ({ ...p, protocol: { ...p.protocol, showCaseDescription: e.target.checked } as any }))} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Показывать Description тест-кейса</div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Отображать поле Description в разделе 3 «Результаты тестирования»</div>
              </div>
            </div>
            {/* Suite path (breadcrumbs) toggle + settings */}
            <SuitePathSettingsRow cfg={cfg} setCfg={setCfg} />
          </div>
        )}

        {tab === "completion" && (
          <div className="pf-field">
            <label className="pf-label">Стандартный текст — объём работ</label>
            <textarea className="input" style={{ width: "100%", resize: "vertical" }} rows={3}
              placeholder="Описание выполненных работ и условий..."
              value={(cfg.completion as any).scopeOfWork ?? ""}
              onChange={(e) => setCfg((p) => ({ ...p, completion: { ...p.completion, scopeOfWork: e.target.value } }))} />
          </div>
        )}

        <label className="pf-label" style={{ marginTop: 8, display: "block" }}>Разделы документа</label>
        <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "2px 0 8px" }}>
          Включайте / выключайте разделы и редактируйте их заголовки.
          При включённом шаблоне скрытые разделы не попадают в документ.
        </p>
        {renderSections(tab)}
      </div>
    </div>
  );
}

// ── Bulk Importer ─────────────────────────────────────────────────────────────

type ImportSuite = {
  name: string;
  description?: string;
  cases?: ImportCase[];
  children?: ImportSuite[];
};
type ImportCase = {
  name: string;
  description?: string;
  pre_conditions?: string;
  post_conditions?: string;
  severity?: string;
  priority?: string;
  type?: string;
  layer?: string;
  automation_status?: string;
  steps?: { action: string; expected?: string; expected_results?: string[]; data?: string }[];
};
type ImportPayload = { suites?: ImportSuite[] };

const EXAMPLE_JSON = `{
  "suites": [
    {
      "name": "Авторизация",
      "description": "Тесты авторизации",
      "cases": [
        {
          "name": "Вход с валидными данными",
          "severity": "critical",
          "priority": "high",
          "layer": "ui",
          "automation_status": "manual",
          "steps": [
            { "action": "Открыть страницу /login", "expected": "Страница загружена" },
            { "action": "Ввести email и пароль", "expected": "Данные введены" },
            { "action": "Нажать Войти", "expected": "Пользователь авторизован" }
          ]
        }
      ],
      "children": [
        {
          "name": "Двухфакторная аутентификация",
          "cases": []
        }
      ]
    }
  ]
}`;

type ImportStatus = { total: number; done: number; errors: string[]; phase: string };

function countItemsFn(suites: ImportSuite[]): { suites: number; cases: number } {
  let s = 0, c = 0;
  const walk = (list: ImportSuite[]) => {
    for (const suite of list) { s++; c += suite.cases?.length ?? 0; if (suite.children) walk(suite.children); }
  };
  walk(suites);
  return { suites: s, cases: c };
}

function BulkImporter({ projects, onBack }: { projects: Project[]; onBack: () => void }) {
  const [projectId, setProjectId] = useState("");
  const [json, setJson] = useState(EXAMPLE_JSON);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPayload | null>(() => {
    try { return JSON.parse(EXAMPLE_JSON); } catch { return null; }
  });
  const [validationMsg, setValidationMsg] = useState<string | null>(() => {
    try {
      const p = JSON.parse(EXAMPLE_JSON);
      const counts = countItemsFn(p.suites ?? []);
      return `✅ JSON корректен: ${counts.suites} сьют(а/ов), ${counts.cases} тест-кейс(а/ов)`;
    } catch { return null; }
  });
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [running, setRunning] = useState(false);

  const validateJson = (val: string) => {
    setJson(val);
    setStatus(null);
    setValidationMsg(null);
    try {
      const p = JSON.parse(val);
      if (!p || typeof p !== "object") {
        setParseError("JSON должен быть объектом");
        setPreview(null);
        return;
      }
      if (!Array.isArray(p.suites)) {
        setParseError('Обязательное поле "suites" должно быть массивом');
        setPreview(null);
        return;
      }
      setParseError(null);
      setPreview(p);
      const counts = countItemsFn(p.suites);
      setValidationMsg(`✅ JSON корректен: ${counts.suites} сьют(а/ов), ${counts.cases} тест-кейс(а/ов)`);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "JSON error");
      setPreview(null);
    }
  };

  const countItems = countItemsFn;

  const importSuites = async (
    suites: ImportSuite[],
    pid: string,
    parentId: string | null,
    st: ImportStatus,
    existingSuitesMap: Map<string, string>, // key: `${parentId ?? "root"}::${name}` → suite id
    existingCasesMap: Map<string, string>,  // key: `${suiteId}::${name}` → case id
  ) => {
    for (const s of suites) {
      st.phase = `Сьют: ${s.name}`;
      setStatus({ ...st });
      let suiteId: string;
      const suiteKey = `${parentId ?? "root"}::${s.name.trim().toLowerCase()}`;
      const existingSuiteId = existingSuitesMap.get(suiteKey);
      if (existingSuiteId) {
        suiteId = existingSuiteId;
        st.done++;
      } else {
        try {
          const created = await suitesApi.create({ name: s.name, project_id: pid, description: s.description, parent_id: parentId });
          suiteId = created.id;
          existingSuitesMap.set(suiteKey, suiteId);
          st.done++;
        } catch (e) {
          st.errors.push(`Сьют «${s.name}»: ${e instanceof Error ? e.message : "error"}`);
          setStatus({ ...st });
          continue;
        }
      }
      for (const c of s.cases ?? []) {
        st.phase = `Кейс: ${c.name}`;
        setStatus({ ...st });
        const caseKey = `${suiteId}::${c.name.trim().toLowerCase()}`;
        const existingCaseId = existingCasesMap.get(caseKey);
        const caseData = {
          name: c.name, project_id: pid, test_suite_id: suiteId,
          description: c.description,
          pre_conditions: c.pre_conditions,
          post_conditions: c.post_conditions,
          severity: (c.severity as any) ?? "normal",
          priority: (c.priority as any) ?? "medium",
          type: (c.type as any) ?? "functional",
          layer: (c.layer as any) ?? "not_set",
          automation_status: (c.automation_status as any) ?? "manual",
          steps: (c.steps ?? []).map((step) => ({
            action: step.action,
            expected: step.expected ?? "",
            expected_results: step.expected_results,
            data: step.data ?? "",
          })) as any,
        };
        try {
          if (existingCaseId) {
            await casesApi.update(existingCaseId, caseData as any);
          } else {
            await casesApi.create(caseData);
          }
          st.done++;
        } catch (e) {
          st.errors.push(`Кейс «${c.name}»: ${e instanceof Error ? e.message : "error"}`);
        }
        setStatus({ ...st });
      }
      if (s.children?.length) await importSuites(s.children, pid, suiteId, st, existingSuitesMap, existingCasesMap);
    }
  };

  const runImport = async () => {
    if (!projectId || !preview?.suites?.length) return;
    const counts = countItems(preview.suites);
    const st: ImportStatus = { total: counts.suites + counts.cases, done: 0, errors: [], phase: "Загрузка существующих данных..." };
    setStatus({ ...st });
    setRunning(true);
    try {
      // Build maps of existing suites and cases for deduplication
      const [existingSuites, existingCases] = await Promise.all([
        suitesApi.list(projectId),
        casesApi.list(projectId),
      ]);
      // Suite map: parentId::name → id
      const suitesMap = new Map<string, string>();
      for (const s of existingSuites) {
        const key = `${s.parent_id ?? "root"}::${s.name.trim().toLowerCase()}`;
        suitesMap.set(key, s.id);
      }
      // Cases map: suiteId::name → id
      const casesMap = new Map<string, string>();
      for (const c of existingCases) {
        if (c.test_suite_id) {
          const key = `${c.test_suite_id}::${c.name.trim().toLowerCase()}`;
          casesMap.set(key, c.id);
        }
      }
      st.phase = "Начало...";
      await importSuites(preview.suites, projectId, null, st, suitesMap, casesMap);
      st.phase = "Готово!";
      setStatus({ ...st });
    } finally {
      setRunning(false);
    }
  };

  const counts = preview?.suites ? countItems(preview.suites) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn-link" style={{ fontSize: 13 }} onClick={onBack}>← Все приложения</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>📥 Bulk Import</h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        {/* Left: JSON editor */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="pf-field" style={{ marginBottom: 0 }}>
            <label className="pf-label">Проект</label>
            <select className="input" style={{ width: "100%" }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Выберите проект —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <label className="pf-label">JSON для импорта</label>
            <textarea
              className="input"
              style={{ flex: 1, fontFamily: "monospace", fontSize: 12, resize: "none", minHeight: 200 }}
              value={json}
              onChange={(e) => validateJson(e.target.value)}
              spellCheck={false}
            />
            {parseError && <div className="api-error">⚠ {parseError}</div>}
            {!parseError && validationMsg && <div style={{ fontSize: 11, color: "var(--color-passed)", fontWeight: 600, marginTop: 2 }}>{validationMsg}</div>}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            Формат: {"{ suites: [{ name, cases: [{name, steps}], children }] }"}
          </div>
          <button
            className="btn btn-primary"
            style={{ alignSelf: "flex-start" }}
            disabled={!projectId || !preview?.suites?.length || running || !!parseError}
            onClick={runImport}
          >
            {running ? "Импортируем…" : `▶ Импортировать (${counts ? `${counts.suites} сьютов, ${counts.cases} кейсов` : "нет данных"})`}
          </button>
        </div>

        {/* Right: preview + status */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "auto", padding: "14px 16px" }}>
          {status ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                {status.phase} — {status.done}/{status.total}
              </div>
              <div style={{ height: 6, background: "var(--color-border)", borderRadius: 3, marginBottom: 12, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "var(--color-accent)", borderRadius: 3, width: `${status.total > 0 ? Math.round((status.done / status.total) * 100) : 0}%`, transition: "width 0.2s" }} />
              </div>
              {status.errors.length > 0 && (
                <div style={{ fontSize: 11, color: "#dc2626" }}>
                  {status.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                </div>
              )}
              {!running && <div style={{ fontSize: 12, color: "var(--color-passed)", fontWeight: 600, marginTop: 8 }}>✓ Импорт завершён</div>}
            </div>
          ) : preview?.suites?.length ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Предварительный просмотр ({counts?.suites} сьютов, {counts?.cases} кейсов):
              </div>
              <BulkPreviewTree suites={preview.suites} depth={0} />
            </div>
          ) : (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, textAlign: "center", marginTop: 40 }}>
              Введите корректный JSON — здесь появится предпросмотр импорта
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BulkPreviewTree({ suites, depth }: { suites: ImportSuite[]; depth: number }) {
  return (
    <div style={{ paddingLeft: depth * 14 }}>
      {suites.map((s, i) => (
        <div key={i}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12 }}>
            <span style={{ color: "var(--color-accent)" }}>📁</span>
            <strong>{s.name}</strong>
            {(s.cases?.length ?? 0) > 0 && <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>({s.cases!.length} кейсов)</span>}
          </div>
          {s.cases?.map((c, j) => (
            <div key={j} style={{ paddingLeft: 16, fontSize: 11, color: "var(--color-text-muted)", padding: "1px 0 1px 20px" }}>
              📋 {c.name}
            </div>
          ))}
          {s.children?.length ? <BulkPreviewTree suites={s.children} depth={depth + 1} /> : null}
        </div>
      ))}
    </div>
  );
}

// ── System Customization ──────────────────────────────────────────────────────

const CUSTOM_KEY = "tms_customization";

type TmsCustomization = {
  logoText: string;
  logoImageBase64: string;
  primaryColor: string;
  sidebarBg: string;
  topbarBg: string;
  fontScale: number; // 0.85 | 1 | 1.1 | 1.2
  borderRadius: "sharp" | "medium" | "round";
};

export function loadCustomization(): TmsCustomization {
  try { const r = localStorage.getItem(CUSTOM_KEY); return r ? { ...defaultCustomization(), ...JSON.parse(r) } : defaultCustomization(); }
  catch { return defaultCustomization(); }
}

function defaultCustomization(): TmsCustomization {
  return { logoText: "4QA", logoImageBase64: "", primaryColor: "#5a4cf0", sidebarBg: "", topbarBg: "", fontScale: 1, borderRadius: "medium" };
}

export function applyCustomization(cfg: TmsCustomization) {
  const root = document.documentElement;
  if (cfg.primaryColor) {
    root.style.setProperty("--color-accent", cfg.primaryColor);
    // Derive hover as slightly darker
    root.style.setProperty("--color-accent-hover", cfg.primaryColor + "dd");
  } else {
    root.style.removeProperty("--color-accent");
    root.style.removeProperty("--color-accent-hover");
  }
  if (cfg.sidebarBg) root.style.setProperty("--color-bg-sidebar", cfg.sidebarBg);
  else root.style.removeProperty("--color-bg-sidebar");
  if (cfg.topbarBg) root.style.setProperty("--topbar-bg-override", cfg.topbarBg);
  else root.style.removeProperty("--topbar-bg-override");
  const radiusMap = { sharp: "2px", medium: "6px", round: "12px" };
  root.style.setProperty("--radius-md", radiusMap[cfg.borderRadius ?? "medium"]);
  root.style.setProperty("font-size", cfg.fontScale !== 1 ? `${cfg.fontScale * 14}px` : "");
  // Logo: store for TopBar to read
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(cfg));
}

function SystemCustomizer({ onBack }: { onBack: () => void }) {
  const [cfg, setCfg] = useState<TmsCustomization>(loadCustomization);
  const [saved, setSaved] = useState(false);
  const [logoPreviewErr, setLogoPreviewErr] = useState(false);

  const save = () => {
    applyCustomization(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const reset = () => {
    const d = defaultCustomization();
    setCfg(d);
    applyCustomization(d);
  };

  const handleLogoImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCfg((p) => ({ ...p, logoImageBase64: ev.target?.result as string })); setLogoPreviewErr(false); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const PRESETS = [
    { name: "Indigo",      primary: "#5a4cf0" },
    { name: "Ocean Blue",  primary: "#1d4ed8" },
    { name: "Forest Green", primary: "#15803d" },
    { name: "Sunset Orange", primary: "#ea580c" },
    { name: "Rose",        primary: "#e11d48" },
    { name: "Slate",       primary: "#475569" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn-link" style={{ fontSize: 13 }} onClick={onBack}>← Все приложения</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🎨 Кастомизация системы</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn" style={{ fontSize: 12 }} onClick={reset}>↺ Сброс</button>
          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={save}>{saved ? "✓ Применено" : "Применить"}</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignContent: "start" }}>
        {/* Logo */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "18px 20px" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Логотип</h3>
          <label className="form-label" style={{ display: "block", marginBottom: 10 }}>
            Текст логотипа
            <input className="input" style={{ width: "100%", marginTop: 4, fontWeight: 700, fontSize: 14 }} value={cfg.logoText} maxLength={8}
              onChange={(e) => setCfg((p) => ({ ...p, logoText: e.target.value }))} placeholder="4QA" />
          </label>
          <label className="form-label" style={{ display: "block", marginBottom: 8 }}>Изображение логотипа (PNG/SVG, до 200×60px)</label>
          <label style={{ display: "inline-block", padding: "6px 12px", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12, cursor: "pointer", background: "var(--color-bg-soft)" }}>
            📁 Загрузить файл
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogoImage} />
          </label>
          {cfg.logoImageBase64 && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              {!logoPreviewErr
                ? <img src={cfg.logoImageBase64} alt="logo" style={{ height: 36, maxWidth: 120, objectFit: "contain", border: "1px solid var(--color-border)", borderRadius: 4 }} onError={() => setLogoPreviewErr(true)} />
                : <span style={{ fontSize: 11, color: "#dc2626" }}>Ошибка загрузки</span>}
              <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setCfg((p) => ({ ...p, logoImageBase64: "" }))}>Удалить</button>
            </div>
          )}
          <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--color-bg-soft)", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", marginRight: 4 }}>Превью:</span>
            {cfg.logoImageBase64 && !logoPreviewErr
              ? <img src={cfg.logoImageBase64} alt="" style={{ height: 24, maxWidth: 80, objectFit: "contain" }} />
              : <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: ".04em", color: cfg.primaryColor || "var(--color-accent)" }}>{cfg.logoText || "4QA"}</span>}
          </div>
        </div>

        {/* Primary color */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "18px 20px" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Цветовая тема</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {PRESETS.map((p) => (
              <button key={p.primary} title={p.name}
                style={{ width: 28, height: 28, borderRadius: "50%", background: p.primary, border: cfg.primaryColor === p.primary ? "3px solid #fff" : "2px solid transparent", boxShadow: cfg.primaryColor === p.primary ? `0 0 0 2px ${p.primary}` : "none", cursor: "pointer" }}
                onClick={() => setCfg((prev) => ({ ...prev, primaryColor: p.primary }))} />
            ))}
          </div>
          <label className="form-label">Произвольный цвет акцента (HEX)
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <input type="color" value={cfg.primaryColor} onChange={(e) => setCfg((p) => ({ ...p, primaryColor: e.target.value }))} style={{ width: 40, height: 32, border: "none", borderRadius: 4, cursor: "pointer" }} />
              <input className="input" style={{ flex: 1 }} value={cfg.primaryColor} onChange={(e) => setCfg((p) => ({ ...p, primaryColor: e.target.value }))} placeholder="#5a4cf0" />
            </div>
          </label>
        </div>

        {/* Sidebar / Topbar colors */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "18px 20px" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Фоновые цвета</h3>
          <label className="form-label" style={{ display: "block", marginBottom: 10 }}>Цвет фона сайдбара
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <input type="color" value={cfg.sidebarBg || "#ffffff"} onChange={(e) => setCfg((p) => ({ ...p, sidebarBg: e.target.value }))} style={{ width: 40, height: 32, border: "none", borderRadius: 4, cursor: "pointer" }} />
              <input className="input" style={{ flex: 1 }} value={cfg.sidebarBg} onChange={(e) => setCfg((p) => ({ ...p, sidebarBg: e.target.value }))} placeholder="По умолчанию" />
              {cfg.sidebarBg && <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setCfg((p) => ({ ...p, sidebarBg: "" }))}>✕</button>}
            </div>
          </label>
          <label className="form-label" style={{ display: "block" }}>Цвет фона топбара
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <input type="color" value={cfg.topbarBg || "#ffffff"} onChange={(e) => setCfg((p) => ({ ...p, topbarBg: e.target.value }))} style={{ width: 40, height: 32, border: "none", borderRadius: 4, cursor: "pointer" }} />
              <input className="input" style={{ flex: 1 }} value={cfg.topbarBg} onChange={(e) => setCfg((p) => ({ ...p, topbarBg: e.target.value }))} placeholder="По умолчанию" />
              {cfg.topbarBg && <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setCfg((p) => ({ ...p, topbarBg: "" }))}>✕</button>}
            </div>
          </label>
        </div>

        {/* Typography & Shape */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "18px 20px" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Типографика и форма</h3>
          <label className="form-label" style={{ display: "block", marginBottom: 12 }}>Масштаб шрифта
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {([0.9, 1, 1.1, 1.15] as const).map((s) => (
                <button key={s} style={{ padding: "4px 12px", border: `1px solid ${cfg.fontScale === s ? "var(--color-accent)" : "var(--color-border)"}`, borderRadius: 6, fontSize: 12, cursor: "pointer", background: cfg.fontScale === s ? "var(--color-accent-soft)" : "var(--color-bg)", color: cfg.fontScale === s ? "var(--color-accent)" : "var(--color-text-muted)", fontWeight: cfg.fontScale === s ? 700 : 400 }}
                  onClick={() => setCfg((p) => ({ ...p, fontScale: s }))}>
                  {s === 0.9 ? "S" : s === 1 ? "M" : s === 1.1 ? "L" : "XL"}
                </button>
              ))}
            </div>
          </label>
          <label className="form-label">Скруглённость углов
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {(["sharp", "medium", "round"] as const).map((r) => (
                <button key={r} style={{ padding: "4px 12px", border: `1px solid ${cfg.borderRadius === r ? "var(--color-accent)" : "var(--color-border)"}`, borderRadius: r === "sharp" ? 2 : r === "medium" ? 6 : 12, fontSize: 12, cursor: "pointer", background: cfg.borderRadius === r ? "var(--color-accent-soft)" : "var(--color-bg)", color: cfg.borderRadius === r ? "var(--color-accent)" : "var(--color-text-muted)", fontWeight: cfg.borderRadius === r ? 700 : 400 }}
                  onClick={() => setCfg((p) => ({ ...p, borderRadius: r }))}>
                  {r === "sharp" ? "Острые" : r === "medium" ? "Средние" : "Круглые"}
                </button>
              ))}
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const APPS_VIEW_KEY = "apps_view_mode";

export default function AppsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeApp, setActiveApp] = useState<"api-check" | "report-template" | "bulk-import" | "customizer" | "none">("none");
  const [rtEnabled, setRtEnabled] = useState(() => isReportTemplateEnabled());
  const [viewMode, setViewMode] = useState<"card" | "list">(() =>
    (localStorage.getItem(APPS_VIEW_KEY) as "card" | "list") ?? "card"
  );

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(() => {});
  }, []);

  const toggleRt = () => {
    const next = !rtEnabled;
    localStorage.setItem(RT_ENABLED_KEY, String(next));
    setRtEnabled(next);
  };

  const toggleView = () => {
    const next = viewMode === "card" ? "list" : "card";
    setViewMode(next);
    localStorage.setItem(APPS_VIEW_KEY, next);
  };

  return (
    <div className="apps-page">
      <div className="apps-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 className="apps-title">Apps</h1>
          <p className="apps-subtitle">Integrations, tools and built-in runners</p>
        </div>
        {activeApp === "none" && (
          <div style={{ display: "flex", gap: 4, border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden", height: 32, flexShrink: 0 }}>
            <button
              title="Карточки"
              onClick={() => viewMode !== "card" && toggleView()}
              style={{ padding: "4px 10px", background: viewMode === "card" ? "var(--color-accent)" : "none", border: "none", cursor: "pointer", color: viewMode === "card" ? "#fff" : "var(--color-text-muted)", fontSize: 14 }}
            >⊞</button>
            <button
              title="Список"
              onClick={() => viewMode !== "list" && toggleView()}
              style={{ padding: "4px 10px", background: viewMode === "list" ? "var(--color-accent)" : "none", border: "none", cursor: "pointer", color: viewMode === "list" ? "#fff" : "var(--color-text-muted)", fontSize: 14 }}
            >≡</button>
          </div>
        )}
      </div>

      {activeApp === "none" && (
        <div className={viewMode === "card" ? "apps-catalog apps-catalog--grid" : "apps-catalog apps-catalog--list"}>
          <div className="apps-card" onClick={() => setActiveApp("api-check")}>
            <div className="apps-card-icon">🌐</div>
            <div className="apps-card-body">
              <div className="apps-card-name">4QA API Check</div>
              <div className="apps-card-desc">
                Запускайте API тест-кейсы напрямую — HTTP запросы, contract validation, история запусков и монитор результатов.
              </div>
            </div>
            <div className="apps-card-badge">Built-in</div>
          </div>

          <div className={"apps-card" + (rtEnabled ? "" : " apps-card--inactive")} onClick={() => setActiveApp("report-template")}>
            <div className="apps-card-icon">📄</div>
            <div className="apps-card-body">
              <div className="apps-card-name">Report Template Builder</div>
              <div className="apps-card-desc">
                Настройте шаблоны протокола тестирования, акта тестирования и акта выполненных работ. При активации отчёты генерируются по этим шаблонам.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
              <span className={rtEnabled ? "apps-card-badge apps-badge-active" : "apps-card-badge"}>
                {rtEnabled ? "Активен" : "Неактивен"}
              </span>
              <button
                className={"apps-toggle-btn" + (rtEnabled ? " apps-toggle-btn--on" : "")}
                onClick={(e) => { e.stopPropagation(); toggleRt(); }}
                title={rtEnabled ? "Деактивировать плагин" : "Активировать плагин"}
              >
                {rtEnabled ? "Выключить" : "Включить"}
              </button>
            </div>
          </div>

          <div className="apps-card" onClick={() => setActiveApp("bulk-import")}>
            <div className="apps-card-icon">📥</div>
            <div className="apps-card-body">
              <div className="apps-card-name">Bulk Import</div>
              <div className="apps-card-desc">
                Массовый импорт тест-сьютов и тест-кейсов из JSON. Поддерживает вложенные сьюты, шаги, поля severity/priority/layer.
              </div>
            </div>
            <div className="apps-card-badge">Built-in</div>
          </div>

          <div className="apps-card" onClick={() => setActiveApp("customizer")}>
            <div className="apps-card-icon">🎨</div>
            <div className="apps-card-body">
              <div className="apps-card-name">Кастомизация системы</div>
              <div className="apps-card-desc">
                Настройте логотип, цветовую тему, фоны сайдбара и топбара, масштаб шрифта и скруглённость элементов.
              </div>
            </div>
            <div className="apps-card-badge">Built-in</div>
          </div>

        </div>
      )}

      {activeApp === "api-check" && (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
          <div style={{ marginBottom: 12 }}>
            <button className="btn-link" style={{ fontSize: 13 }} onClick={() => setActiveApp("none")}>
              ← Все приложения
            </button>
          </div>
          <ApiCheckRunner projects={projects} />
        </div>
      )}

      {activeApp === "report-template" && (
        <ReportTemplateConstructor onBack={() => setActiveApp("none")} />
      )}

      {activeApp === "bulk-import" && (
        <BulkImporter projects={projects} onBack={() => setActiveApp("none")} />
      )}

      {activeApp === "customizer" && (
        <SystemCustomizer onBack={() => setActiveApp("none")} />
      )}
    </div>
  );
}
