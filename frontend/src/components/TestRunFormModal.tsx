import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "./Modal";
import { plansApi, runsApi, releasesApi, type TestPlan, type TestRun, type Release, DEFECT_ENVIRONMENTS } from "../api/client";

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
  projectId: string;
  defaultPlanId?: string | null;
  defaultName?: string;
  defaultReleaseId?: string;
  defaultTestCaseIds?: string[];
  initial?: TestRun | null;
  onClose: () => void;
  onSaved: (run: TestRun) => void;
}

type Source = "repository" | "plan";

const today = () => {
  const now = new Date();
  const date = now.toLocaleDateString("ru-RU");
  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
};

export default function TestRunFormModal({
  open,
  projectId,
  defaultPlanId,
  defaultName,
  defaultReleaseId,
  defaultTestCaseIds,
  initial,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!initial;
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [existingRuns, setExistingRuns] = useState<TestRun[]>([]);
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState("");
  const [milestone, setMilestone] = useState("");
  const [source, setSource] = useState<Source>(defaultPlanId ? "plan" : "repository");
  const [planId, setPlanId] = useState<string>(defaultPlanId ?? "");
  const [plans, setPlans] = useState<TestPlan[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState<string>("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [deviceType, setDeviceType] = useState<string>("");
  const [os, setOs] = useState<string>("");
  const [osVersion, setOsVersion] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setError(null);
    releasesApi.list(projectId).then(setReleases).catch(() => setReleases([]));
    if (initial) {
      setName(initial.name);
      setDescription(initial.description ?? "");
      setEnvironment(initial.environment ?? "");
      setMilestone("");
      setSource("repository");
      setPlanId(initial.test_plan_id ?? "");
      setReleaseId(initial.release_id ?? "");
      setDeviceType(initial.device_type ?? "");
      setOs(initial.os ?? "");
      setOsVersion(initial.os_version ?? "");
    } else {
      setName(defaultName ?? `Test run ${today()}`);
      setDescription("");
      setEnvironment("");
      setMilestone("");
      setDeviceType("");
      setOs("");
      setOsVersion("");
      setReleaseId(defaultReleaseId ?? "");
      setSource(defaultPlanId ? "plan" : "repository");
      setPlanId(defaultPlanId ?? "");
      plansApi.list(projectId).then(setPlans).catch(() => setPlans([]));
      runsApi.list(projectId).then(setExistingRuns).catch(() => setExistingRuns([]));
    }
  }, [open, projectId, defaultPlanId, defaultName, defaultReleaseId, initial]);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      // Required field validation from Configurations
      const envRequired    = localStorage.getItem("cfg_run_environment_required") === "true";
      const deviceRequired = localStorage.getItem("cfg_run_device_required") === "true";
      const osRequired     = localStorage.getItem("cfg_run_os_required") === "true";
      if (envRequired && !environment) {
        setError("Необходимо выбрать среду (Environment)."); setSubmitting(false); return;
      }
      if (deviceRequired && !deviceType) {
        setError("Необходимо выбрать тип устройства (Device Type)."); setSubmitting(false); return;
      }
      if (osRequired && deviceType && !os) {
        setError("Необходимо выбрать операционную систему (OS)."); setSubmitting(false); return;
      }

      // Validate unique name
      const trimmedName = name.trim();
      const duplicate = existingRuns.find(
        (r) => r.name.trim().toLowerCase() === trimmedName.toLowerCase() && (!isEdit || r.id !== initial?.id)
      );
      if (duplicate) {
        setError(`Прогон с названием «${trimmedName}» уже существует. Добавьте время или измените название.`);
        setSubmitting(false);
        return;
      }
      let run: TestRun;
      if (isEdit && initial) {
        run = await runsApi.update(initial.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          environment: environment.trim() || undefined,
          release_id: releaseId || null,
          device_type: deviceType || null,
          os: os.trim() || null,
          os_version: osVersion.trim() || null,
        });
      } else {
        const payload: Parameters<typeof runsApi.create>[0] = {
          project_id: projectId,
          name: name.trim(),
          description: description.trim() || undefined,
          environment: environment.trim() || undefined,
          release_id: releaseId || null,
          device_type: deviceType || null,
          os: os.trim() || null,
          os_version: osVersion.trim() || null,
        };
        if (source === "plan" && planId) {
          payload.test_plan_id = planId;
          // Порядок кейсов в плане (testplan_cases.position) уже хранится на бэкенде
          // в нужном порядке — просто передаём его в прогон как есть.
          const planCases = await plansApi.cases(planId);
          payload.test_case_ids = planCases.map((c) => c.id);
        }
        if (defaultTestCaseIds && defaultTestCaseIds.length > 0) payload.test_case_ids = defaultTestCaseIds;
        run = await runsApi.create(payload);
      }
      onSaved(run);
      onClose();
      if (!isEdit) {
        navigate(`/project/${projectId}/run/${run.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? "Edit test run" : "New test run"}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || !name.trim() || (!isEdit && source === "plan" && !planId)}
          >
            {isEdit ? "Save" : submitting ? "Creating…" : "Create Run"}
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
          <select
            className="input"
            style={{ width: "100%" }}
            value={milestone}
            onChange={(e) => setMilestone(e.target.value)}
            disabled
          >
            <option value="">— Not set —</option>
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

      {!isEdit && defaultTestCaseIds && defaultTestCaseIds.length > 0 && (
        <div className="pf-field" style={{ marginTop: 14 }}>
          <label className="pf-label">Test cases</label>
          <div style={{ padding: "8px 12px", background: "var(--color-accent-soft)", border: "1px solid var(--color-accent)", borderRadius: 6, fontSize: 13, color: "var(--color-accent)" }}>
            📋 {defaultTestCaseIds.length} тест-кейс{defaultTestCaseIds.length === 1 ? "" : defaultTestCaseIds.length < 5 ? "а" : "ов"} из требований релиза будут включены в прогон.
          </div>
        </div>
      )}

      {!isEdit && !defaultTestCaseIds && (
        <div className="pf-field" style={{ marginTop: 18 }}>
          <label className="pf-label">Test cases</label>
          <div className="run-source-tabs">
            <button
              type="button"
              className={"run-source-tab" + (source === "repository" ? " is-active" : "")}
              onClick={() => setSource("repository")}
            >
              From repository
            </button>
            <button
              type="button"
              className={"run-source-tab" + (source === "plan" ? " is-active" : "")}
              onClick={() => setSource("plan")}
            >
              From a test plan
            </button>
          </div>

          {source === "repository" ? (
            <div className="pf-md-hint" style={{ marginTop: 8 }}>
              Все активные кейсы проекта будут добавлены в прогон со статусом «Untested».
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <select
                className="input"
                style={{ width: "100%" }}
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                <option value="">— Select test plan —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_id} — {p.name}
                  </option>
                ))}
              </select>
              <div className="pf-md-hint" style={{ marginTop: 6 }}>
                В прогон попадут все кейсы привязанных к плану suites.
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

