import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { defectsApi, releasesApi, runsApi, DEFECT_ENVIRONMENTS, IMPACT_LEVELS, SEVERITY, PRIORITY, type Severity, type Priority, type Release, type TestRun } from "../api/client";
import { useToast } from "../components/Toast";
import MediaThumb from "../components/MediaThumb";
import { MEDIA_ACCEPT, uploadMedia } from "../utils/media";
import "./DefectCreatePage.css";
function getDefectReleaseRequired(): boolean {
  return localStorage.getItem("cfg_defect_release_required") === "true";
}

const SEV_LABELS: Record<Severity, string> = {
  blocker: "Blocker", critical: "Critical", major: "Major",
  normal: "Normal", minor: "Minor", trivial: "Trivial",
};
const PRI_LABELS: Record<Priority, string> = {
  high: "High", medium: "Medium", low: "Low", not_set: "Not Set",
};

export default function DefectCreatePage() {
  const { projectId, defectId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isEdit = !!defectId;

  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState("medium");
  const [preConditions, setPreConditions] = useState("");
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [actualResult, setActualResult] = useState("");
  const [environment, setEnvironment] = useState("");
  const [severity, setSeverity] = useState<Severity>("normal");
  const [priority, setPriority] = useState<Priority>("not_set");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [releaseId, setReleaseId] = useState<string>("");
  const [releases, setReleases] = useState<Release[]>([]);
  const releaseRequired = getDefectReleaseRequired();
  const [runId, setRunId] = useState<string>("");
  const [runs, setRuns] = useState<TestRun[]>([]);

  useEffect(() => {
    if (projectId) releasesApi.list(projectId).then(setReleases).catch(() => {});
    if (projectId) runsApi.list(projectId).then(setRuns).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (isEdit && defectId) {
      defectsApi.get(defectId).then((d) => {
        setTitle(d.title);
        setImpact(d.impact ?? "medium");
        setPreConditions(d.pre_conditions ?? "");
        setStepsToReproduce(d.steps_to_reproduce ?? "");
        setExpectedResult(d.expected_result ?? "");
        setActualResult(d.actual_result ?? "");
        setEnvironment(d.environment ?? "");
        setSeverity(d.severity);
        setPriority(d.priority);
        setDescription(d.description ?? "");
        setTags(d.tags ?? []);
        setReleaseId(d.release_id ?? "");
        setRunId(d.test_run_id ?? "");
        setAttachments(d.attachments ?? []);
      });
    }
  }, [defectId, isEdit]);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput("");
  };

  // Файлы сразу уходят в MinIO; в дефект сохраняются ссылки (у нового дефекта id ещё нет — "draft")
  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !projectId) return;
    setUploading(true);
    try {
      const urls = await uploadMedia(files, "defect", defectId ?? "draft", projectId);
      setAttachments((prev) => [...prev, ...urls]);
    } catch {
      toast.error("Не удалось загрузить вложение в хранилище");
    } finally { setUploading(false); }
  };

  const save = async () => {
    if (!title.trim()) { toast.error("Defect title is required"); return; }
    if (releaseRequired && !releaseId) { toast.error("Release is required (see Configurations)"); return; }
    if (!projectId) return;
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        impact: impact || null,
        pre_conditions: preConditions.trim() || null,
        steps_to_reproduce: stepsToReproduce.trim() || null,
        expected_result: expectedResult.trim() || null,
        actual_result: actualResult.trim() || null,
        environment: environment || null,
        severity,
        priority,
        description: description.trim() || null,
        tags,
        attachments,
      };
      const fullPayload = { ...payload, release_id: releaseId || null, test_run_id: runId || null };
      if (isEdit && defectId) {
        await defectsApi.update(defectId, fullPayload);
        toast.success("Defect updated");
      } else {
        await defectsApi.create({ ...fullPayload, project_id: projectId });
        toast.success("Defect created");
      }
      navigate(`/project/${projectId}/defects`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="dcr-page">
      <div className="dcr-header">
        <button className="dcr-back" onClick={() => navigate(`/project/${projectId}/defects`)}>
          ← {isEdit ? "Edit Defect" : "Create Defect"}
        </button>
      </div>

      <div className="dcr-form">
        <h2 className="dcr-form-title">{isEdit ? "Edit Defect" : "Create Defect"}</h2>

        {/* Title */}
        <div className="dcr-field">
          <label className="dcr-label">Defect Title <span className="dcr-required">*</span></label>
          <input className="input dcr-input" placeholder="Short descriptive title…" value={title}
            onChange={(e) => setTitle(e.target.value)} />
        </div>

        {/* Impact */}
        <div className="dcr-field">
          <label className="dcr-label">Impact <span className="dcr-required">*</span></label>
          <div className="dcr-impact-row">
            {IMPACT_LEVELS.map((lvl) => {
              const meta: Record<string, { color: string; bg: string; label: string }> = {
                none:     { color: "#6b7280", bg: "#f3f4f6",   label: "None"     },
                low:      { color: "#16a34a", bg: "#dcfce7",   label: "Low"      },
                medium:   { color: "#ca8a04", bg: "#fef3c7",   label: "Medium"   },
                high:     { color: "#ea580c", bg: "#ffedd5",   label: "High"     },
                critical: { color: "#dc2626", bg: "#fee2e2",   label: "Critical" },
              };
              const m = meta[lvl];
              return (
                <button
                  key={lvl}
                  type="button"
                  className={"dcr-impact-btn" + (impact === lvl ? " is-active" : "")}
                  style={impact === lvl ? { background: m.bg, color: m.color, borderColor: m.color } : {}}
                  onClick={() => setImpact(lvl)}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Pre-conditions */}
        <div className="dcr-field">
          <label className="dcr-label">Pre-conditions</label>
          <textarea className="input dcr-textarea" rows={2}
            placeholder="Предусловия для воспроизведения (состояние системы, данные, настройки…)"
            value={preConditions} onChange={(e) => setPreConditions(e.target.value)} />
        </div>

        {/* Steps To Reproduce */}
        <div className="dcr-field">
          <label className="dcr-label">Steps To Reproduce <span className="dcr-required">*</span></label>
          <textarea className="input dcr-textarea" rows={4}
            placeholder={"1. Navigate to…\n2. Click…\n3. Observe…"}
            value={stepsToReproduce} onChange={(e) => setStepsToReproduce(e.target.value)} />
        </div>

        {/* Expected Result */}
        <div className="dcr-field">
          <label className="dcr-label">Expected Result <span className="dcr-required">*</span></label>
          <textarea className="input dcr-textarea" rows={3}
            placeholder="What should happen?"
            value={expectedResult} onChange={(e) => setExpectedResult(e.target.value)} />
        </div>

        {/* Actual Result + attachment */}
        <div className="dcr-field">
          <label className="dcr-label">Actual Result <span className="dcr-required">*</span></label>
          <textarea className="input dcr-textarea" rows={3}
            placeholder="What actually happens?"
            value={actualResult} onChange={(e) => setActualResult(e.target.value)} />
          {/* Attachments for AR */}
          <div className="dcr-attach-row">
            <button className="dcr-add-attach" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "Загрузка…" : "📎 Add attachment"}
            </button>
            <input ref={fileRef} type="file" accept={MEDIA_ACCEPT} multiple
              style={{ display: "none" }} onChange={handleAttachment} />
            {attachments.map((url, i) => (
              <div key={i} style={{ position: "relative", display: "inline-block" }}>
                <MediaThumb url={url} className="dcr-attach-thumb" onOpen={setLightbox} />
                <button className="dcr-attach-del"
                  onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        </div>

        {/* Row: Severity + Priority + Environment */}
        <div className="dcr-row-3">
          <div className="dcr-field">
            <label className="dcr-label">Severity <span className="dcr-required">*</span></label>
            <select className="input dcr-input" value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}>
              {SEVERITY.map((s) => <option key={s} value={s}>{SEV_LABELS[s]}</option>)}
            </select>
          </div>
          <div className="dcr-field">
            <label className="dcr-label">Priority <span className="dcr-required">*</span></label>
            <select className="input dcr-input" value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITY.map((p) => <option key={p} value={p}>{PRI_LABELS[p]}</option>)}
            </select>
          </div>
          <div className="dcr-field">
            <label className="dcr-label">Environment</label>
            <select className="input dcr-input" value={environment}
              onChange={(e) => setEnvironment(e.target.value)}>
              <option value="">Not specified</option>
              {DEFECT_ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>

        {/* Assignee (placeholder) */}
        <div className="dcr-field">
          <label className="dcr-label">Assignee</label>
          <select className="input dcr-input" disabled><option>Unassigned</option></select>
        </div>

        {/* Tags */}
        <div className="dcr-field">
          <label className="dcr-label">Tags</label>
          <div className="dcr-tags-wrap">
            {tags.map((t) => (
              <span key={t} className="dcr-tag">{t}
                <button className="dcr-tag-remove"
                  onClick={() => setTags((p) => p.filter((x) => x !== t))}>✕</button>
              </span>
            ))}
            <input className="dcr-tag-input" placeholder="Add tag… press Enter"
              value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()} />
          </div>
        </div>

        {/* Release */}
        <div className="dcr-field">
          <label className="dcr-label">
            Release{releaseRequired && <span className="dcr-required"> *</span>}
          </label>
          <select className="input dcr-input" value={releaseId}
            onChange={(e) => setReleaseId(e.target.value)}>
            <option value="">— Not linked —</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>{r.name} v{r.version} ({r.environment})</option>
            ))}
          </select>
          {releaseRequired && !releaseId && (
            <div className="dcr-field-hint dcr-field-hint--warn">
              ⚠ Release is required per project configuration
            </div>
          )}
        </div>

        {/* Test Run */}
        <div className="dcr-field">
          <label className="dcr-label">Test Run</label>
          <select className="input dcr-input" value={runId}
            onChange={(e) => setRunId(e.target.value)}>
            <option value="">— Not linked —</option>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        {/* Milestone (placeholder) */}
        <div className="dcr-field">
          <label className="dcr-label">Milestone</label>
          <select className="input dcr-input" disabled><option>Not set</option></select>
        </div>

        <div className="dcr-footer">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create defect"}
          </button>
          <button className="btn" onClick={() => navigate(`/project/${projectId}/defects`)}>Cancel</button>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="dcr-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="dcr-lightbox-img" onClick={(e) => e.stopPropagation()} />
          <button className="dcr-lightbox-close" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
