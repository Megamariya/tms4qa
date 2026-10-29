import { useEffect, useRef, useState } from "react";
import {
  AUTOMATION_STATUS,
  BEHAVIOR,
  CASE_STATUS,
  CASE_TYPE,
  LAYER,
  PRIORITY,
  SEVERITY,
  casesApi,
  suitesApi,
  getStepExpectedResults,
  type Step,
  type TestCase,
  type TestSuite,
} from "../api/client";
import "./TestCaseForm.css";

interface Props {
  projectId: string;
  caseId?: string;          // если задан → edit
  initialSuiteId?: string;
  onSaved: (tc: TestCase) => void;
  onCancel: () => void;
}

const EMPTY: Partial<TestCase> = {
  name: "",
  description: "",
  pre_conditions: "",
  post_conditions: "",
  steps: [],
  severity: "normal",
  priority: "not_set",
  status: "actual",
  type: "other",
  behavior: "not_set",
  layer: "not_set",
  automation_status: "manual",
  is_flaky: false,
  muted: false,
  tags: [],
  labels: {},
};

const labelize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const TC_API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const TC_API_COLORS: Record<string, string> = {
  GET: "#16a34a", POST: "#1d4ed8", PUT: "#ca8a04", PATCH: "#7c3aed", DELETE: "#dc2626",
};

type SharedStepEntry = { id: string; name: string; steps: Step[] };
function loadSharedSteps(pid: string): SharedStepEntry[] {
  try { return JSON.parse(localStorage.getItem(`ss_steps_${pid}`) ?? "[]"); } catch { return []; }
}

export default function TestCaseForm({
  projectId,
  caseId,
  initialSuiteId,
  onSaved,
  onCancel,
}: Props) {
  const [form, setForm] = useState<Partial<TestCase>>({
    ...EMPTY,
    test_suite_id: initialSuiteId ?? null,
  });
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [allCases, setAllCases] = useState<TestCase[]>([]);
  const [tagsInput, setTagsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insertSharedOpen, setInsertSharedOpen] = useState(false);
  const [sharedSteps, setSharedSteps] = useState<SharedStepEntry[]>([]);
  const [insertPreCondOpen, setInsertPreCondOpen] = useState(false);
  const [preCondSharedSteps, setPreCondSharedSteps] = useState<SharedStepEntry[]>([]);

  useEffect(() => {
    suitesApi.list(projectId).then(setSuites).catch(() => setSuites([]));
    casesApi.list(projectId).then(setAllCases).catch(() => setAllCases([]));
  }, [projectId]);

  useEffect(() => {
    if (!caseId) return;
    casesApi.get(caseId).then((tc) => {
      setForm(tc);
      setTagsInput((tc.tags ?? []).join(", "));
    });
  }, [caseId]);

  const set = <K extends keyof TestCase>(key: K, value: TestCase[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addStep = () =>
    set("steps", [...(form.steps ?? []), { action: "", data: "", expected: "" }]);

  const updateStep = (i: number, patch: Partial<Step>) => {
    const next = [...(form.steps ?? [])];
    next[i] = { ...next[i], ...patch };
    set("steps", next);
  };

  const removeStep = (i: number) => {
    const next = [...(form.steps ?? [])];
    next.splice(i, 1);
    set("steps", next);
  };

  const handleStepImg = (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      const next = [...(form.steps ?? [])];
      next[i] = { ...next[i], attachments: [...(next[i].attachments ?? []), url] };
      set("steps", next);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const deleteStepAttachment = (i: number, attachIdx: number) => {
    const next = [...(form.steps ?? [])];
    next[i] = { ...next[i], attachments: (next[i].attachments ?? []).filter((_, j) => j !== attachIdx) };
    set("steps", next);
  };

  const duplicateStep = (i: number) => {
    const next = [...(form.steps ?? [])];
    next.splice(i + 1, 0, { ...next[i] });
    set("steps", next);
  };

  const submit = async (createAnother = false) => {
    setError(null);

    // Validate: name must be non-empty
    const trimmedName = (form.name ?? "").trim();
    if (!trimmedName) { setError("Название тест-кейса не может быть пустым."); return; }

    // Validate: name must be unique within the project
    const duplicate = allCases.find((c) =>
      c.name.trim().toLowerCase() === trimmedName.toLowerCase() &&
      c.id !== caseId  // allow same name when editing the same case
    );
    if (duplicate) {
      setError(
        `Тест-кейс с названием «${trimmedName}» уже существует в этом проекте` +
        (duplicate.test_suite_id
          ? ` (в сьюте "${suites.find((s) => s.id === duplicate.test_suite_id)?.name ?? duplicate.test_suite_id}")`
          : " (без сьюта)") +
        `. Пожалуйста, придумайте другое название.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        name: trimmedName,
        project_id: projectId,
        tags: tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        test_suite_id: form.test_suite_id || null,
      };
      const saved = caseId
        ? await casesApi.update(caseId, payload)
        : await casesApi.create(payload as never);
      onSaved(saved);
      if (createAnother) {
        setForm({ ...EMPTY, test_suite_id: form.test_suite_id });
        setTagsInput("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="tc-form">
      <header className="tc-form-header">
        <button className="btn-icon" onClick={onCancel}>←</button>
        <h1>{caseId ? "Edit test case" : "Create test case"}</h1>
        <button className="btn">⚙ Configure fields</button>
      </header>

      {error && <div className="tc-form-error">{error}</div>}

      <section className="tc-section">
        <h2 className="tc-section-title">Basic</h2>

        <div className="tc-grid">
          <Field label="Title" required full>
            <AutoSizeTextarea
              placeholder="For example: Authorization"
              value={form.name ?? ""}
              onChange={(v) => set("name", v)}
            />
          </Field>
          <Field label="Status" required>
            <Select
              value={form.status!}
              options={CASE_STATUS}
              onChange={(v) => set("status", v as never)}
            />
          </Field>

          <Field label="Description" full>
            <AutoSizeTextarea
              value={form.description ?? ""}
              onChange={(v) => set("description", v)}
            />
          </Field>

          <Field label="Suite">
            <select
              className="input"
              value={form.test_suite_id ?? ""}
              onChange={(e) => set("test_suite_id", e.target.value || null)}
            >
              <option value="">— No suite —</option>
              {suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Severity" required>
            <Select
              value={form.severity!}
              options={SEVERITY}
              onChange={(v) => set("severity", v as never)}
            />
          </Field>
          <Field label="Priority" required>
            <Select
              value={form.priority!}
              options={PRIORITY}
              onChange={(v) => set("priority", v as never)}
            />
          </Field>

          <Field label="Type" required>
            <Select
              value={form.type!}
              options={CASE_TYPE}
              onChange={(v) => set("type", v as never)}
            />
          </Field>
          <Field label="Layer" required>
            <Select
              value={form.layer!}
              options={LAYER}
              onChange={(v) => set("layer", v as never)}
            />
          </Field>
          <Field label="Is flaky" required>
            <Select
              value={form.is_flaky ? "Yes" : "No"}
              options={["No", "Yes"] as const}
              onChange={(v) => set("is_flaky", v === "Yes")}
            />
          </Field>

          <Field label="Milestone">
            <input className="input" placeholder="Not set" disabled />
          </Field>
          <Field label="Behavior" required>
            <Select
              value={form.behavior!}
              options={BEHAVIOR}
              onChange={(v) => set("behavior", v as never)}
            />
          </Field>
          <Field label="Automation status" required>
            <Select
              value={form.automation_status!}
              options={AUTOMATION_STATUS}
              onChange={(v) => set("automation_status", v as never)}
            />
          </Field>
        </div>

        <div className="tc-checks">
          <label>
            <input
              type="checkbox"
              checked={!!form.muted}
              onChange={(e) => set("muted", e.target.checked)}
            />{" "}
            Muted case
          </label>
        </div>
      </section>

      <section className="tc-section">
        <h2 className="tc-section-title">Conditions</h2>
        <Field label="Pre-conditions" full>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <textarea
              className="input"
              rows={3}
              placeholder="Empty value"
              value={form.pre_conditions ?? ""}
              onChange={(e) => set("pre_conditions", e.target.value)}
            />
            <button
              type="button"
              className="btn"
              style={{ alignSelf: "flex-start", fontSize: 12 }}
              onClick={() => { setPreCondSharedSteps(loadSharedSteps(projectId)); setInsertPreCondOpen(true); }}
            >
              ↩ Insert shared step text
            </button>
          </div>
        </Field>
      </section>

      <section className="tc-section">
        <h2 className="tc-section-title">Tags</h2>
        <input
          className="input tc-tags-input"
          placeholder="comma, separated, tags"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
        />
      </section>

      <section className="tc-section">
        <div className="tc-section-row">
          <h2 className="tc-section-title">Steps</h2>
          <button className="btn" onClick={addStep}>+ Add step</button>
          <button className="btn" onClick={() => { setSharedSteps(loadSharedSteps(projectId)); setInsertSharedOpen(true); }}>
            ↩ From shared steps
          </button>
        </div>
        {(form.steps ?? []).length === 0 && (
          <div className="tc-empty">No steps yet</div>
        )}
        <ol className="tc-steps">
          {(form.steps ?? []).map((s, i) => {
            const expResults = getStepExpectedResults(s).length > 0
              ? getStepExpectedResults(s)
              : [""];
            return (
              <li key={i} className="tc-step">
                <div className="tc-step-num">{i + 1}</div>
                <div className="tc-step-fields tc-step-fields-v2">
                  {form.layer === "api" && (
                    <div className="tc-step-row-inputs" style={{ marginBottom: 6 }}>
                      <select
                        className="input"
                        style={{ width: 105, color: TC_API_COLORS[s.api_method ?? "GET"] ?? "#6b7280", fontWeight: 700 }}
                        value={s.api_method ?? "GET"}
                        onChange={(e) => {
                          const m = e.target.value;
                          updateStep(i, { api_method: m, action: `Отправить запрос методом ${m} на ${s.api_url ?? ""}` });
                        }}>
                        {TC_API_METHODS.map((m) => (
                          <option key={m} value={m} style={{ color: TC_API_COLORS[m] }}>{m}</option>
                        ))}
                      </select>
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        placeholder="https://api.example.com/path"
                        value={s.api_url ?? ""}
                        onChange={(e) => {
                          updateStep(i, { api_url: e.target.value, action: `Отправить запрос методом ${s.api_method ?? "GET"} на ${e.target.value}` });
                        }}
                      />
                    </div>
                  )}
                  <div className="tc-step-stack-inputs">
                    <AutoSizeTextarea
                      placeholder="Action"
                      value={s.action}
                      onChange={(v) => updateStep(i, { action: v })}
                    />
                    {form.layer !== "api" && (
                      <input
                        className="input"
                        placeholder="Data (optional)"
                        value={s.data ?? ""}
                        onChange={(e) => updateStep(i, { data: e.target.value })}
                      />
                    )}
                  </div>
                  {form.layer === "api" && (
                    <div className="tc-step-api-fields">
                      <div className="tc-step-api-field">
                        <div className="tc-step-api-label">Request Body</div>
                        <textarea
                          className="input tc-step-api-textarea"
                          placeholder='{"key": "value"}'
                          rows={2}
                          value={s.data ?? ""}
                          onChange={(e) => updateStep(i, { data: e.target.value })}
                        />
                      </div>
                      <div className="tc-step-api-row">
                        <div className="tc-step-api-field" style={{ width: 160, flexShrink: 0 }}>
                          <div className="tc-step-api-label">Expected Status</div>
                          <input
                            className="input"
                            type="number"
                            placeholder="200"
                            min={100}
                            max={599}
                            value={s.api_expected_status ?? ""}
                            onChange={(e) =>
                              updateStep(i, { api_expected_status: e.target.value ? parseInt(e.target.value, 10) : undefined })
                            }
                          />
                        </div>
                        <div className="tc-step-api-field" style={{ flex: 1 }}>
                          <div className="tc-step-api-label">Expected Response Body</div>
                          <textarea
                            className="input tc-step-api-textarea"
                            placeholder='{"status": "ok"}'
                            rows={2}
                            value={s.api_contract ?? ""}
                            onChange={(e) => updateStep(i, { api_contract: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="tc-step-expected-section">
                    <div className="tc-step-expected-label">Expected results</div>
                    {expResults.map((exp, ei) => (
                      <div key={ei} className="tc-step-expected-row">
                        <textarea
                          className="input tc-step-expected-input"
                          placeholder={`Expected result ${ei + 1}`}
                          value={exp}
                          rows={1}
                          style={{ resize: "none", overflow: "hidden", minHeight: 34, lineHeight: "1.4" }}
                          onInput={(e) => {
                            const ta = e.currentTarget;
                            ta.style.height = "auto";
                            ta.style.height = ta.scrollHeight + "px";
                          }}
                          onChange={(e) => {
                            const arr = [...expResults];
                            arr[ei] = e.target.value;
                            updateStep(i, { expected_results: arr, expected: arr[0] ?? "" });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const ta = e.currentTarget;
                              const pos = ta.selectionStart ?? ta.value.length;
                              const before = ta.value.slice(0, pos);
                              const after = ta.value.slice(ta.selectionEnd ?? pos);
                              const newVal = before + "\n• " + after;
                              const arr = [...expResults];
                              arr[ei] = newVal;
                              updateStep(i, { expected_results: arr, expected: arr[0] ?? "" });
                              requestAnimationFrame(() => {
                                ta.style.height = "auto";
                                ta.style.height = ta.scrollHeight + "px";
                                ta.selectionStart = ta.selectionEnd = pos + 3;
                              });
                            }
                          }}
                        />
                        {expResults.length > 1 && (
                          <button
                            type="button"
                            className="tc-step-expected-del"
                            onClick={() => {
                              const arr = expResults.filter((_, j) => j !== ei);
                              updateStep(i, { expected_results: arr, expected: arr[0] ?? "" });
                            }}
                          >×</button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="tc-step-expected-add"
                      onClick={() => {
                        const arr = [...expResults, ""];
                        updateStep(i, { expected_results: arr });
                      }}
                    >+ Add expected result</button>
                  </div>
                  {(s.attachments ?? []).length > 0 && (
                    <div className="tc-step-attach-row">
                      {(s.attachments ?? []).map((u, ai) => (
                        <div key={ai} className="tc-step-attach-wrap">
                          <img src={u} alt="" className="tc-step-thumb" />
                          <button type="button" className="tc-step-attach-del" onClick={() => deleteStepAttachment(i, ai)}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label className="btn-icon" title="Прикрепить скриншот" style={{ cursor: "pointer" }}>
                    🖼
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleStepImg(i, e)} />
                  </label>
                  <button className="btn-icon" title="Дублировать шаг" onClick={() => duplicateStep(i)}>⧉</button>
                  <button className="btn-icon" title="Удалить шаг" onClick={() => removeStep(i)}>🗑</button>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Post-conditions after Steps — shown only if enabled in Configurations */}
      {localStorage.getItem(`cfg_case_show_post_conditions_${projectId}`) !== "false" && (
        <section className="tc-section">
          <Field label="Post-conditions" full>
            <textarea
              className="input"
              rows={3}
              placeholder="Empty value"
              value={form.post_conditions ?? ""}
              onChange={(e) => set("post_conditions", e.target.value)}
            />
          </Field>
        </section>
      )}

      {/* Pre-conditions: insert from shared steps modal */}
      {insertPreCondOpen && (
        <div className="modal-backdrop" onClick={() => setInsertPreCondOpen(false)}>
          <div className="modal" style={{ width: 480, maxHeight: "70vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Insert Shared Step into Pre-conditions</h2>
              <button className="btn-icon" onClick={() => setInsertPreCondOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
              {preCondSharedSteps.length === 0 ? (
                <p style={{ color: "var(--color-text-muted)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                  No shared steps yet. Create them in the Shared Steps section.
                </p>
              ) : preCondSharedSteps.map((ss) => (
                <div key={ss.id}
                  style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "10px 14px", cursor: "pointer", transition: "background 0.1s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-soft)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  onClick={() => {
                    const stepText = ss.steps.map((s, i) => `${i + 1}. ${s.action}`).join("\n");
                    const current = form.pre_conditions ?? "";
                    set("pre_conditions", current ? `${current}\n${stepText}` : stepText);
                    setInsertPreCondOpen(false);
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{ss.name}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                    {ss.steps.length} step{ss.steps.length !== 1 ? "s" : ""}
                    {ss.steps.length > 0 && <span> · {ss.steps[0].action.slice(0, 40)}{ss.steps[0].action.length > 40 ? "…" : ""}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setInsertPreCondOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {insertSharedOpen && (
        <div className="modal-backdrop" onClick={() => setInsertSharedOpen(false)}>
          <div className="modal" style={{ width: 480, maxHeight: "70vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Insert Shared Step</h2>
              <button className="btn-icon" onClick={() => setInsertSharedOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
              {sharedSteps.length === 0 ? (
                <p style={{ color: "var(--color-text-muted)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                  No shared steps yet. Create them in the Shared Steps section.
                </p>
              ) : sharedSteps.map((ss) => (
                <div
                  key={ss.id}
                  style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "10px 14px", cursor: "pointer", transition: "background 0.1s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-soft)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  onClick={() => {
                    set("steps", [...(form.steps ?? []), ...ss.steps]);
                    setInsertSharedOpen(false);
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{ss.name}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                    {ss.steps.length} step{ss.steps.length !== 1 ? "s" : ""}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setInsertSharedOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <footer className="tc-form-footer">
        <button
          className="btn btn-primary"
          onClick={() => submit(false)}
          disabled={submitting || !form.name}
        >
          Save
        </button>
        {!caseId && (
          <button
            className="btn"
            onClick={() => submit(true)}
            disabled={submitting || !form.name}
          >
            Save and create another
          </button>
        )}
        <button className="btn-link" onClick={onCancel}>
          Cancel
        </button>
      </footer>
    </div>
  );
}

// ── Helpers ──

function Field({
  label,
  required,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={"tc-field" + (full ? " tc-field-full" : "")}>
      <div className="tc-field-label">
        {label}
        {required && <span className="tc-required">*</span>}
      </div>
      {children}
    </div>
  );
}

// Wraps long text onto new lines and grows to fit content — including when
// the value is set programmatically (e.g. loading an existing case to edit).
// Resize handle lets the user drag it taller manually; growth never shrinks
// below whatever height (auto-fit or manual) is already applied.
function AutoSizeTextarea({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    const current = ta.offsetHeight;
    ta.style.height = "auto";
    const natural = ta.scrollHeight;
    ta.style.height = Math.max(current, natural) + "px";
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="input"
      rows={1}
      placeholder={placeholder}
      value={value}
      style={{ resize: "vertical", overflow: "hidden", minHeight: 36, lineHeight: "1.4", wordBreak: "break-word" }}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labelize(o)}
        </option>
      ))}
    </select>
  );
}
