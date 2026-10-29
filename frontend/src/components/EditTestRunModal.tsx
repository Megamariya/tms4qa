import { useEffect, useState } from "react";
import Modal from "./Modal";
import { runsApi, releasesApi, type TestRun, type Release, DEFECT_ENVIRONMENTS } from "../api/client";
import SelectCasesModal from "./SelectCasesModal";
import "./EditTestRunModal.css";

const DEVICE_TYPES = [
  { value: "mobile",  label: "Mobile"  },
  { value: "pc",      label: "PC"      },
  { value: "tablet",  label: "Tablet"  },
  { value: "other",   label: "Other"   },
] as const;

const DEVICE_OS: Record<string, string[]> = {
  mobile:  ["Android", "iOS", "HarmonyOS", "Other"],
  pc:      ["Windows", "macOS", "Linux", "Other"],
  tablet:  ["Android", "iOS / iPadOS", "Windows", "Other"],
  other:   ["Other"],
};

interface Props {
  open: boolean;
  run: TestRun | null;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditTestRunModal({ open, run, projectId, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState("");
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [selectOpen, setSelectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState<string>("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [deviceType, setDeviceType] = useState<string>("");
  const [os, setOs] = useState<string>("");
  const [osVersion, setOsVersion] = useState<string>("");

  useEffect(() => {
    if (!open || !run) return;
    setName(run.name);
    setDescription(run.description ?? "");
    setEnvironment(run.environment ?? "");
    setError(null);
    setReleaseId(run.release_id ?? "");
    setDeviceType(run.device_type ?? "");
    setOs(run.os ?? "");
    setOsVersion(run.os_version ?? "");
    releasesApi.list(run.project_id).then(setReleases).catch(() => setReleases([]));
    // Fetch current case IDs from results
    runsApi.results(run.id).then((results) => {
      setCaseIds(results.map((r) => r.test_case_id));
    }).catch(() => setCaseIds([]));
  }, [open, run]);

  const submit = async () => {
    if (!run || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await runsApi.update(run.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        environment: environment.trim() || undefined,
        device_type: deviceType || null,
        os: os.trim() || null,
        os_version: osVersion.trim() || null,
      });
      await runsApi.setCases(run.id, caseIds);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!run) return null;

  return (
    <>
      <Modal
        open={open}
        title="Edit test run"
        onClose={onClose}
        width={560}
        footer={
          <>
            <button className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={submitting || !name.trim()}
            >
              Update run
            </button>
          </>
        }
      >
        {error && <div className="pf-error">{error}</div>}

        <div className="pf-field">
          <label className="pf-label">Title</label>
          <input
            className="input"
            style={{ width: "100%" }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="pf-field">
          <label className="pf-label">Description</label>
          <textarea
            className="input"
            style={{ width: "100%" }}
            rows={3}
            placeholder="For example: we can authorize on page https://example.com"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="pf-field" style={{ marginBottom: 0 }}>
            <label className="pf-label">Environment</label>
            <select
              className="input"
              style={{ width: "100%" }}
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            >
              <option value="">— Not set —</option>
              {DEFECT_ENVIRONMENTS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
          <div className="pf-field" style={{ marginBottom: 0 }}>
            <label className="pf-label">Milestone</label>
            <select className="input" style={{ width: "100%" }} disabled>
              <option>Not set</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <div className="pf-field" style={{ marginBottom: 0 }}>
            <label className="pf-label">Device Type</label>
            <select
              className="input"
              style={{ width: "100%" }}
              value={deviceType}
              onChange={(e) => { setDeviceType(e.target.value); setOs(""); }}
            >
              <option value="">— Not set —</option>
              {DEVICE_TYPES.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className="pf-field" style={{ marginBottom: 0 }}>
            <label className="pf-label">OS</label>
            {deviceType ? (
              <select
                className="input"
                style={{ width: "100%" }}
                value={os}
                onChange={(e) => setOs(e.target.value)}
              >
                <option value="">— Not set —</option>
                {(DEVICE_OS[deviceType] ?? []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input className="input" style={{ width: "100%" }} placeholder="Select device type first" disabled />
            )}
          </div>
        </div>

        {deviceType && (
          <div className="pf-field" style={{ marginTop: 14 }}>
            <label className="pf-label">OS Version</label>
            <input
              className="input"
              style={{ width: "100%" }}
              placeholder={deviceType === "mobile" ? "e.g. Android 14 / iOS 17.4" : "e.g. Windows 11 / macOS Sonoma"}
              value={osVersion}
              onChange={(e) => setOsVersion(e.target.value)}
            />
          </div>
        )}

        {releases.length > 0 && (
          <div className="pf-field" style={{ marginTop: 14 }}>
            <label className="pf-label">Release</label>
            <select className="input" style={{ width: "100%" }} value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>
              <option value="">— Not set —</option>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>{r.name} v{r.version} ({r.environment})</option>
              ))}
            </select>
          </div>
        )}

        <div className="pf-field" style={{ marginTop: 18 }}>
          <label className="pf-label">Test cases</label>
          <div className="etr-cases-row">
            <button
              type="button"
              className="btn"
              onClick={() => setSelectOpen(true)}
            >
              Select cases
            </button>
            <span className="etr-cases-count">
              {caseIds.length > 0
                ? `${caseIds.length} case${caseIds.length === 1 ? "" : "s"} selected`
                : "No cases selected"}
            </span>
          </div>
        </div>
      </Modal>

      <SelectCasesModal
        open={selectOpen}
        projectId={projectId}
        preSelectedIds={caseIds}
        onClose={() => setSelectOpen(false)}
        onDone={(ids) => {
          setCaseIds(ids);
          setSelectOpen(false);
        }}
      />
    </>
  );
}
