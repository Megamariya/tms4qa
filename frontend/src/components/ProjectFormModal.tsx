import { useEffect, useState } from "react";
import Modal from "./Modal";
import { projectsApi, orgStore, type Project, type OrgOut } from "../api/client";
import "./ProjectFormModal.css";

interface Props {
  open: boolean;
  initial?: Project | null; // если задан → edit, иначе create
  onClose: () => void;
  onSaved: (project: Project) => void;
  isSuperAdmin?: boolean;
  orgs?: OrgOut[];
  activeOrgId?: string | null;
}

const NAME_MAX = 64;
const ABBR_MAX = 4;

function autoAbbr(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, ABBR_MAX).toUpperCase();
  return words
    .slice(0, ABBR_MAX)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function ProjectFormModal({
  open,
  initial,
  onClose,
  onSaved,
  isSuperAdmin,
  orgs = [],
  activeOrgId,
}: Props) {
  const isEdit = !!initial;
  const [name, setName] = useState("");
  const [abbr, setAbbr] = useState("");
  const [abbrTouched, setAbbrTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [modalOrgId, setModalOrgId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Сброс/инициализация при открытии
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(initial?.name ?? "");
    setAbbr(initial?.abbreviation ?? "");
    setAbbrTouched(!!initial?.abbreviation);
    setDescription(initial?.description ?? "");
    setIsPrivate(initial?.is_private ?? true);
    setModalOrgId(activeOrgId ?? "");
  }, [open, initial, activeOrgId]);

  // Автогенерация abbreviation, пока пользователь сам её не ввёл
  useEffect(() => {
    if (!abbrTouched) setAbbr(autoAbbr(name));
  }, [name, abbrTouched]);

  const submit = async () => {
    if (!name.trim()) return;
    if (isSuperAdmin && !isEdit && !modalOrgId) return;
    setSubmitting(true);
    setError(null);
    try {
      // Set org context for SUPER_ADMIN if modal org was selected
      if (isSuperAdmin && modalOrgId) {
        const org = orgs.find((o) => o.id === modalOrgId);
        if (org) orgStore.set(org.id, org.name);
      }
      const payload = {
        name: name.trim(),
        abbreviation: abbr.trim() || null,
        description: description.trim() || null,
        is_private: isPrivate,
      };
      const saved = isEdit
        ? await projectsApi.update(initial!.id, payload)
        : await projectsApi.create(payload);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? "Edit project" : "New project"}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || !name.trim() || (!!isSuperAdmin && !isEdit && !modalOrgId)}
          >
            {isEdit ? "Save" : "Create"}
          </button>
        </>
      }
    >
      {error && <div className="pf-error">{error}</div>}

      {isSuperAdmin && !isEdit && (
        <div className="pf-field">
          <label className="pf-label">Organization</label>
          <select
            className="input pf-org-select"
            value={modalOrgId}
            onChange={(e) => setModalOrgId(e.target.value)}
          >
            <option value="">— Select organization —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {!modalOrgId && (
            <div className="pf-org-hint">Select which organization this project belongs to</div>
          )}
        </div>
      )}

      <div className="pf-field">
        <label className="pf-label">Name &amp; Abbreviation</label>
        <div className="pf-name-row">
          <div className="pf-name-wrap">
            <input
              className="input pf-name-input"
              placeholder="e.g., Testing"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <span className="pf-name-counter">{name.length}/{NAME_MAX}</span>
          </div>
          <input
            className="input pf-abbr-input"
            placeholder="TE"
            value={abbr}
            maxLength={ABBR_MAX}
            onChange={(e) => {
              setAbbr(e.target.value.toUpperCase());
              setAbbrTouched(true);
            }}
          />
        </div>
      </div>

      <div className="pf-field">
        <label className="pf-label">Description</label>
        <div className="pf-md-toolbar">
          <span className="pf-md-tab is-active">👁 Preview</span>
          <span className="pf-md-divider" />
          <button className="pf-md-btn" type="button" disabled><b>B</b></button>
          <button className="pf-md-btn" type="button" disabled><i>I</i></button>
          <button className="pf-md-btn" type="button" disabled><s>S</s></button>
          <button className="pf-md-btn" type="button" disabled>{"</>"}</button>
          <button className="pf-md-btn" type="button" disabled>🔗</button>
          <button className="pf-md-btn" type="button" disabled>•</button>
          <button className="pf-md-btn" type="button" disabled>1.</button>
          <button className="pf-md-btn" type="button" disabled>☑</button>
          <button className="pf-md-btn" type="button" disabled>▦</button>
        </div>
        <textarea
          className="input pf-md-textarea"
          placeholder="Briefly describe what this project is about"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="pf-md-hint">M↓ Markdown supported</div>
      </div>

      <div className="pf-private">
        <div>
          <div className="pf-private-title">Private project</div>
          <div className="pf-private-desc">
            Visible only to invited collaborators, groups, and admins. If
            disabled, the project will be visible to everyone
          </div>
        </div>
        <label className="pf-toggle">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          <span className="pf-toggle-track">
            <span className="pf-toggle-thumb" />
          </span>
        </label>
      </div>
    </Modal>
  );
}
