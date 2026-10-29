import { useEffect, useState } from "react";
import Modal from "./Modal";
import { plansApi, releasesApi, type TestPlan, type Release } from "../api/client";
import SelectCasesModal from "./SelectCasesModal";

// ── Plan status (local, supports Draft) ──────────────────────────────────────

const PLAN_STATUS_UI = ["draft", "active", "review"] as const;
type PlanStatusUI = (typeof PLAN_STATUS_UI)[number];

const STATUS_LABELS: Record<PlanStatusUI, string> = {
  draft:  "Draft",
  active: "Active",
  review: "Review",
};

function getPlanCustomStatus(planId: string): PlanStatusUI {
  const v = localStorage.getItem(`planCustomStatus_${planId}`);
  return (PLAN_STATUS_UI as readonly string[]).includes(v ?? "") ? (v as PlanStatusUI) : "active";
}
function setPlanCustomStatus(planId: string, status: PlanStatusUI) {
  localStorage.setItem(`planCustomStatus_${planId}`, status);
}

// ── Tags helpers ─────────────────────────────────────────────────────────────

export function loadPlanTags(planId: string): string[] {
  try { return JSON.parse(localStorage.getItem(`planTags_${planId}`) ?? "[]"); } catch { return []; }
}
export function savePlanTags(planId: string, tags: string[]) {
  localStorage.setItem(`planTags_${planId}`, JSON.stringify(tags));
}

// ── Modal ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  projectId: string;
  initial?: TestPlan | null;
  onClose: () => void;
  onSaved: (plan: TestPlan) => void;
}

export default function TestPlanFormModal({ open, projectId, initial, onClose, onSaved }: Props) {
  const isEdit = !!initial;
  const [name, setName] = useState("");
  const [references, setReferences] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [status, setStatus] = useState<PlanStatusUI>("draft");
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [selectCasesOpen, setSelectCasesOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(initial?.name ?? "");
    setReferences(initial?.references ?? "");
    setDescription(initial?.description ?? "");
    setStartDate(initial?.start_date ?? "");
    setEndDate(initial?.end_date ?? "");
    setStatus(initial ? getPlanCustomStatus(initial.id) : "draft");
    setReleaseId(initial?.release_id ?? null);
    setTags(initial ? loadPlanTags(initial.id) : []);
    setTagInput("");
    releasesApi.list(projectId).then(setReleases).catch(() => setReleases([]));
    if (initial) {
      plansApi.cases(initial.id).then((c) => setCaseIds(c.map((x) => x.id))).catch(() => setCaseIds([]));
    } else {
      setCaseIds([]);
    }
  }, [open, initial, projectId]);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const backendStatus = status === "draft" ? "active" : status;
      const payload = {
        project_id: projectId,
        name: name.trim(),
        references: references.trim() || null,
        description: description.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        status: backendStatus as "active" | "review" | "archived",
      };
      const fullPayload = { ...payload, release_id: releaseId || null };
      const saved = isEdit
        ? await plansApi.update(initial!.id, fullPayload)
        : await plansApi.create(fullPayload);
      await plansApi.setCases(saved.id, caseIds);
      setPlanCustomStatus(saved.id, status);
      savePlanTags(saved.id, tags);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        title={isEdit ? "Edit Test Plan" : "Add Test Plan"}
        onClose={onClose}
        width={640}
        footer={
          <>
            <button className="btn" onClick={onClose} disabled={submitting}>✕ Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={submitting || !name.trim()}>
              ✓ {isEdit ? "Save" : "Add Test Plan"}
            </button>
          </>
        }
      >
        {error && <div className="pf-error">{error}</div>}

        <div className="pf-field">
          <label className="pf-label">Name <span className="tc-required">*</span></label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            autoFocus style={{ width: "100%" }}
            placeholder="Ex: All supported browsers or OS/database combinations." />
        </div>

        {/* Status + Release row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14, marginBottom: 18 }}>
          <div className="pf-field" style={{ marginBottom: 0 }}>
            <label className="pf-label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as PlanStatusUI)} style={{ width: "100%" }}>
              {PLAN_STATUS_UI.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div className="pf-field" style={{ marginBottom: 0 }}>
            <label className="pf-label">Release</label>
            <select className="input" value={releaseId ?? ""} onChange={(e) => setReleaseId(e.target.value || null)} style={{ width: "100%" }}>
              <option value="">— No release —</option>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.version ? ` v${r.version}` : ""}{r.environment ? ` (${r.environment.toUpperCase()})` : ""}
                </option>
              ))}
            </select>
            {releases.length === 0 && (
              <div className="pf-md-hint">No releases yet. Create them in the Releases section.</div>
            )}
          </div>
        </div>

        <div className="pf-field">
          <label className="pf-label">References</label>
          <textarea className="input" rows={2} value={references} onChange={(e) => setReferences(e.target.value)} style={{ width: "100%" }} />
          <div className="pf-md-hint">Add reference IDs to external tickets here. Поддерживается Markdown.</div>
        </div>

        <div className="pf-field">
          <label className="pf-label">Description</label>
          <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: "100%" }}
            placeholder="Describe the purpose of this test plan." />
          <div className="pf-md-hint">Поддерживается Markdown: **жирный**, *курсив*, списки, заголовки, ссылки.</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="pf-field" style={{ marginBottom: 0 }}>
            <label className="pf-label">Start Date</label>
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div className="pf-field" style={{ marginBottom: 0 }}>
            <label className="pf-label">End Date</label>
            <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>

        <div className="pf-field">
          <label className="pf-label">Tags</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {tags.map((t) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--color-accent-soft)", color: "var(--color-accent)", borderRadius: 4, padding: "2px 8px", fontSize: 12 }}>
                {t}
                <button type="button" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit", lineHeight: 1 }}
                  onClick={() => setTags(tags.filter((x) => x !== t))}>×</button>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Добавить тег…" value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                  e.preventDefault();
                  const t = tagInput.trim().replace(/,$/, "");
                  if (t && !tags.includes(t)) setTags([...tags, t]);
                  setTagInput("");
                }
              }} />
            <button type="button" className="btn" onClick={() => {
              const t = tagInput.trim();
              if (t && !tags.includes(t)) setTags([...tags, t]);
              setTagInput("");
            }}>+ Add</button>
          </div>
          <div className="pf-md-hint">Enter или «,» для добавления тега.</div>
        </div>

        <div className="pf-field" style={{ marginTop: 18 }}>
          <label className="pf-label">Test cases</label>
          {caseIds.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 13, color: "var(--color-text-muted)" }}>
              {caseIds.length} test case{caseIds.length === 1 ? "" : "s"} selected
            </div>
          )}
          <button type="button" className="btn" onClick={() => setSelectCasesOpen(true)}>
            {caseIds.length > 0 ? "Change cases" : "Add cases"}
          </button>
        </div>
      </Modal>

      <SelectCasesModal
        open={selectCasesOpen}
        projectId={projectId}
        preSelectedIds={caseIds}
        onClose={() => setSelectCasesOpen(false)}
        onDone={(ids) => { setCaseIds(ids); setSelectCasesOpen(false); }}
      />
    </>
  );
}
