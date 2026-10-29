import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { defectsApi, type Defect, type DefectStatus, DEFECT_STATUS } from "../api/client";
import { useToast } from "../components/Toast";
import { downloadDefectReport, downloadDefectReportDoc, printHTML, generateDefectReportHTML } from "../utils/testProtocol";
import MediaThumb from "../components/MediaThumb";
import { MEDIA_ACCEPT, absolutizeMedia, inlineMedia, uploadMedia } from "../utils/media";
import "./DefectDetailPage.css";

const STATUS_LABEL: Record<DefectStatus, string> = {
  open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed", reopened: "Reopened",
};
const STATUS_CLS: Record<DefectStatus, string> = {
  open: "dd-status-open", in_progress: "dd-status-inprogress", resolved: "dd-status-resolved",
  closed: "dd-status-closed", reopened: "dd-status-reopened",
};
const SEV_CLS: Record<string, string> = {
  blocker: "sev-blocker", critical: "sev-critical", major: "sev-major",
  normal: "sev-normal", minor: "sev-minor", trivial: "sev-trivial",
};
const IMPACT_META: Record<string, { label: string; color: string; bg: string }> = {
  none:     { label: "None",     color: "#6b7280", bg: "#f3f4f6" },
  low:      { label: "Low",      color: "#16a34a", bg: "#dcfce7" },
  medium:   { label: "Medium",   color: "#ca8a04", bg: "#fef3c7" },
  high:     { label: "High",     color: "#ea580c", bg: "#ffedd5" },
  critical: { label: "Critical", color: "#dc2626", bg: "#fee2e2" },
};

type HistoryEntry = { ts: string; action: string; by: string };
const HIST_KEY = (id: string) => `defect_history_${id}`;
function loadHistory(id: string): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HIST_KEY(id)) ?? "[]"); } catch { return []; }
}
function addHistoryEntry(id: string, action: string) {
  const hist = loadHistory(id);
  hist.unshift({ ts: new Date().toISOString(), action, by: "Demo User" });
  localStorage.setItem(HIST_KEY(id), JSON.stringify(hist.slice(0, 50)));
}

export default function DefectDetailPage() {
  const { projectId, defectId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [defect, setDefect] = useState<Defect | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusOpen, setStatusOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "history">("details");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!defectId) return;
    defectsApi.get(defectId)
      .then((d) => {
        setDefect(d);
        setAttachments(d.attachments ?? []);
        setHistory(loadHistory(d.id));
      })
      .catch(() => toast.error("Failed to load"))
      .finally(() => setLoading(false));
  }, [defectId]);

  useEffect(() => {
    if (!statusOpen) return;
    const close = () => setStatusOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [statusOpen]);

  const changeStatus = async (s: DefectStatus) => {
    if (!defect) return;
    const updated = await defectsApi.update(defect.id, { status: s }).catch(() => null);
    if (updated) {
      addHistoryEntry(defect.id, `Статус изменён: ${STATUS_LABEL[defect.status]} → ${STATUS_LABEL[s]}`);
      setDefect(updated);
      setHistory(loadHistory(defect.id));
      setStatusOpen(false);
      toast.success(`Status: ${STATUS_LABEL[s]}`);
    }
  };

  const remove = async () => {
    if (!defect || !confirm(`Удалить дефект «${defect.title}»?`)) return;
    await defectsApi.delete(defect.id)
      .then(() => { toast.success("Удалён"); navigate(`/project/${projectId}/defects`); })
      .catch(() => toast.error("Delete failed"));
  };

  const saveAttachments = async (next: string[]) => {
    if (!defect) return;
    const updated = await defectsApi.update(defect.id, { attachments: next });
    setDefect(updated);
    setAttachments(updated.attachments ?? next);
  };

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!defect || !projectId) return;
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      const urls = await uploadMedia(files, "defect", defect.id, projectId);
      await saveAttachments([...attachments, ...urls]);
      files.forEach((f) => addHistoryEntry(defect.id, `Добавлено вложение: ${f.name}`));
      setHistory(loadHistory(defect.id));
    } catch {
      toast.error("Не удалось загрузить вложение в хранилище");
    } finally { setUploading(false); }
  };

  const removeAttachment = (idx: number) => {
    saveAttachments(attachments.filter((_, i) => i !== idx)).catch(() => toast.error("Не удалось удалить вложение"));
  };

  if (loading) return <div className="page" style={{ padding: 40 }}>Загружаем…</div>;
  if (!defect) return <div className="page" style={{ padding: 40 }}>Дефект не найден</div>;

  const impMeta = IMPACT_META[defect.impact ?? "medium"];

  return (
    <div className="dd-page">
      <div className="dd-main">
        {/* Header */}
        <div className="dd-breadcrumb">
          <button className="dd-back" onClick={() => navigate(`/project/${projectId}/defects`)}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span className="dd-id-chip">{defect.display_id}</span>
              {defect.impact && (
                <span className="dd-impact-chip" style={{ background: impMeta.bg, color: impMeta.color }}>
                  {impMeta.label}
                </span>
              )}
            </div>
            <h1 className="dd-title">{defect.title}</h1>
          </div>
        </div>

        <div className="dd-actions">
          <button className="btn" onClick={() => navigate(`/project/${projectId}/defects/${defect.id}/edit`)}>✎ Edit</button>
          <button
            className="btn"
            title="Скачать Defect Report (HTML)"
            onClick={async () => downloadDefectReport(defect, await inlineMedia(attachments))}
          >
            ⬇ HTML
          </button>
          <button
            className="btn"
            title="Скачать Defect Report (Word .doc)"
            onClick={async () => downloadDefectReportDoc({ id: defect.id, display_id: defect.display_id, display_seq: defect.display_seq, title: defect.title, severity: defect.severity, status: defect.status, environment: defect.environment, impact: defect.impact, description: defect.description, steps_to_reproduce: defect.steps_to_reproduce, expected_result: defect.expected_result, actual_result: defect.actual_result, tags: defect.tags, created_at: defect.created_at, updated_at: defect.updated_at }, await inlineMedia(attachments))}
          >
            📝 DOCX
          </button>
          <button
            className="btn"
            title="Печать / PDF Defect Report"
            onClick={() => printHTML(generateDefectReportHTML(defect, absolutizeMedia(attachments)))}
          >
            🖨 Print
          </button>
          <button className="btn dd-btn-danger" onClick={remove}>🗑 Delete</button>
        </div>

        {/* Tabs */}
        <nav className="dd-tabs">
          <button className={"dd-tab" + (activeTab === "details" ? " is-active" : "")} onClick={() => setActiveTab("details")}>Details</button>
          <button className={"dd-tab" + (activeTab === "history" ? " is-active" : "")} onClick={() => setActiveTab("history")}>
            History {history.length > 0 && <span className="dd-tab-cnt">{history.length}</span>}
          </button>
        </nav>

        {activeTab === "details" && (
          <>
            {defect.pre_conditions && (
              <section className="dd-section">
                <h3 className="dd-section-title">Pre-conditions</h3>
                <pre className="dd-section-pre">{defect.pre_conditions}</pre>
              </section>
            )}

            {defect.steps_to_reproduce && (
              <section className="dd-section">
                <h3 className="dd-section-title">Steps to Reproduce</h3>
                <pre className="dd-section-pre">{defect.steps_to_reproduce}</pre>
              </section>
            )}

            {defect.expected_result && (
              <section className="dd-section">
                <h3 className="dd-section-title">Expected Result</h3>
                <p className="dd-section-text">{defect.expected_result}</p>
              </section>
            )}

            {(defect.actual_result || attachments.length > 0) && (
              <section className="dd-section">
                <h3 className="dd-section-title">Actual Result</h3>
                {defect.actual_result && <p className="dd-section-text" style={{ marginBottom: 10 }}>{defect.actual_result}</p>}
                {/* Screenshots */}
                {attachments.length > 0 && (
                  <div className="dd-attach-row">
                    {attachments.map((url, i) => (
                      <div key={i} style={{ position: "relative", display: "inline-block" }}>
                        <MediaThumb url={url} className="dd-attach-thumb" onOpen={setLightbox} />
                        <button className="dd-attach-del" onClick={() => removeAttachment(i)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Add screenshot */}
                <button className="dd-add-attach" onClick={() => fileRef.current?.click()}>
                  {uploading ? "Загрузка…" : "📎 Add screenshot / video"}
                </button>
                <input ref={fileRef} type="file" accept={MEDIA_ACCEPT} multiple style={{ display: "none" }} onChange={handleAttachment} />
              </section>
            )}

            {/* Show actual result section even if empty, just for attachment upload */}
            {!defect.actual_result && attachments.length === 0 && (
              <section className="dd-section">
                <h3 className="dd-section-title">Actual Result</h3>
                <p className="dd-empty-text">Не заполнено</p>
                <button className="dd-add-attach" style={{ marginTop: 6 }} onClick={() => fileRef.current?.click()}>
                  {uploading ? "Загрузка…" : "📎 Add screenshot / video"}
                </button>
                <input ref={fileRef} type="file" accept={MEDIA_ACCEPT} multiple style={{ display: "none" }} onChange={handleAttachment} />
              </section>
            )}

            {defect.description && (
              <section className="dd-section">
                <h3 className="dd-section-title">Description</h3>
                <p className="dd-section-text">{defect.description}</p>
              </section>
            )}

            <section className="dd-section">
              <h3 className="dd-section-title">Comments</h3>
              <div className="dd-comment-row">
                <div className="dd-avatar">D</div>
                <input className="input dd-comment-input" placeholder="Write a comment" value={comment}
                  onChange={(e) => setComment(e.target.value)} />
                <button className="btn dd-send-btn"
                  onClick={() => {
                    if (!comment.trim()) return;
                    addHistoryEntry(defect.id, `Комментарий: ${comment.trim().slice(0, 60)}`);
                    setHistory(loadHistory(defect.id));
                    toast.success("Комментарий добавлен в историю");
                    setComment("");
                  }}>
                  Send
                </button>
              </div>
            </section>
          </>
        )}

        {activeTab === "history" && (
          <div className="dd-history">
            {history.length === 0 ? (
              <div className="dd-empty-text">История изменений пуста</div>
            ) : (
              history.map((h, i) => (
                <div key={i} className="dd-hist-row">
                  <div className="dd-hist-dot" />
                  <div className="dd-hist-body">
                    <div className="dd-hist-action">{h.action}</div>
                    <div className="dd-hist-meta">{h.by} · {new Date(h.ts).toLocaleString("ru-RU")}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <aside className="dd-sidebar">
        <div className="dd-meta-row">
          <div className="dd-meta-label">Status</div>
          <div className="dd-status-wrap" onClick={(e) => e.stopPropagation()}>
            <button className={`dd-status-btn ${STATUS_CLS[defect.status]}`}
              onClick={() => setStatusOpen((v) => !v)}>
              {STATUS_LABEL[defect.status]} ▾
            </button>
            {statusOpen && (
              <div className="dd-status-dropdown">
                {DEFECT_STATUS.map((s) => (
                  <button key={s} className="dd-status-option" onClick={() => changeStatus(s)}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="dd-meta-row">
          <div className="dd-meta-label">Severity</div>
          <span className={`df-sev-badge ${SEV_CLS[defect.severity] ?? ""}`}>
            {defect.severity.charAt(0).toUpperCase() + defect.severity.slice(1)}
          </span>
        </div>
        <div className="dd-meta-row">
          <div className="dd-meta-label">Priority</div>
          <span className="dd-meta-value" style={{ textTransform: "capitalize" }}>{defect.priority.replace("_", " ")}</span>
        </div>
        {defect.impact && (
          <div className="dd-meta-row">
            <div className="dd-meta-label">Impact</div>
            <span className="dd-impact-chip" style={{ background: impMeta.bg, color: impMeta.color, display: "inline-flex" }}>
              {impMeta.label}
            </span>
          </div>
        )}
        {defect.environment && (
          <div className="dd-meta-row">
            <div className="dd-meta-label">Environment</div>
            <span className="dd-meta-value">{defect.environment}</span>
          </div>
        )}
        <div className="dd-meta-row"><div className="dd-meta-label">Reporter</div><span className="dd-meta-value">Demo User</span></div>
        <div className="dd-meta-row"><div className="dd-meta-label">Assignee</div><span className="dd-meta-value">—</span></div>
        <div className="dd-meta-row">
          <div className="dd-meta-label">Created</div>
          <span className="dd-meta-value">{new Date(defect.created_at).toLocaleString("ru-RU")}</span>
        </div>
        {defect.updated_at && (
          <div className="dd-meta-row">
            <div className="dd-meta-label">Updated</div>
            <span className="dd-meta-value">{new Date(defect.updated_at).toLocaleString("ru-RU")}</span>
          </div>
        )}
        {defect.tags?.length > 0 && (
          <div className="dd-meta-row">
            <div className="dd-meta-label">Tags</div>
            <div className="dd-tags">{defect.tags.map((t) => <span key={t} className="dd-tag">{t}</span>)}</div>
          </div>
        )}
      </aside>

      {/* Lightbox */}
      {lightbox && (
        <div className="dd-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="dd-lightbox-img" onClick={(e) => e.stopPropagation()} />
          <button className="dd-lightbox-close" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
