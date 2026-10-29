import { useEffect, useState } from "react";
import Modal from "./Modal";
import { suitesApi, type TestSuite } from "../api/client";

interface Props {
  open: boolean;
  projectId: string;
  initial?: TestSuite | null;
  parentId?: string | null;
  suites: TestSuite[];
  onClose: () => void;
  onSaved: () => void;
}

export default function CreateSuiteModal({
  open,
  projectId,
  initial,
  parentId,
  suites,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!initial;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedParentId, setSelectedParentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setSelectedParentId(initial?.parent_id ?? parentId ?? "");
    setError(null);
  }, [open, initial, parentId]);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await suitesApi.update(initial!.id, {
          name: name.trim(),
          description: description.trim() || null,
          parent_id: selectedParentId || null,
        });
      } else {
        await suitesApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          project_id: projectId,
          parent_id: selectedParentId || undefined,
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  const parentOptions = isEdit
    ? suites.filter((s) => s.id !== initial!.id)
    : suites;

  return (
    <Modal
      open={open}
      title={isEdit ? "Edit suite" : "Create suite"}
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
            disabled={submitting || !name.trim()}
          >
            {isEdit ? "Save" : "Create"}
          </button>
        </>
      }
    >
      {error && <div className="pf-error">{error}</div>}

      <div className="pf-field">
        <label className="pf-label">
          Suite name <span className="tc-required">*</span>
        </label>
        <input
          className="input"
          style={{ width: "100%" }}
          placeholder="For example: Web Application"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="pf-field">
        <label className="pf-label">Parent suite</label>
        <select
          className="input"
          style={{ width: "100%" }}
          value={selectedParentId}
          onChange={(e) => setSelectedParentId(e.target.value)}
        >
          <option value="">— No parent (root) —</option>
          {parentOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="pf-field">
        <label className="pf-label">Description</label>
        <textarea
          className="input"
          style={{ width: "100%" }}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </Modal>
  );
}
