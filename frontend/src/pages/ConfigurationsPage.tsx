import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { suitesApi, suiteOrderApi, type TestSuite, type SuiteOrderData } from "../api/client";
import { loadReportStaticCfg, saveReportStaticCfg, type ReportStaticCfg } from "../utils/testProtocol";
import { loadRRSWeights, saveRRSWeights, loadRRSThresholds, saveRRSThresholds, DEFAULT_RRS_WEIGHTS, DEFAULT_RRS_THRESHOLDS } from "../utils/releaseReadinessScore";
import "./ConfigurationsPage.css";

// ── Team types ────────────────────────────────────────────────────────────────

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
};

const TEAM_ROLES = [
  "QA Lead", "QA Engineer", "Developer", "Analyst",
  "Project Manager", "DevOps", "Tech Writer",
] as const;

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  "QA Lead":        { bg: "#dbeafe", color: "#1d4ed8" },
  "QA Engineer":    { bg: "#dcfce7", color: "#15803d" },
  "Developer":      { bg: "#fef3c7", color: "#92400e" },
  "Analyst":        { bg: "#ede9fe", color: "#6d28d9" },
  "Project Manager":{ bg: "#fee2e2", color: "#dc2626" },
  "DevOps":         { bg: "#f0fdf4", color: "#065f46" },
  "Tech Writer":    { bg: "#f3f4f6", color: "#6b7280" },
};

export function loadTeam(projectId: string): TeamMember[] {
  try { return JSON.parse(localStorage.getItem(`team_${projectId}`) ?? "[]"); } catch { return []; }
}
export function saveTeam(projectId: string, team: TeamMember[]) {
  localStorage.setItem(`team_${projectId}`, JSON.stringify(team));
}

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ── Suite order — persisted in DB via /api/v1/suite-orders ──────────────────

const CFG_KEY = "cfg_defect_release_required";

function loadCfg(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem("project_configurations") ?? "{}"); } catch { return {}; }
}
function saveCfg(cfg: Record<string, boolean>) {
  localStorage.setItem("project_configurations", JSON.stringify(cfg));
}

function loadStrCfg(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("project_configurations_str") ?? "{}"); } catch { return {}; }
}
function saveStrCfg(cfg: Record<string, string>) {
  localStorage.setItem("project_configurations_str", JSON.stringify(cfg));
}

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void;
  label: string; hint?: string;
}) {
  return (
    <label className="cfg-toggle-row">
      <div className="cfg-toggle-text">
        <div className="cfg-toggle-label">{label}</div>
        {hint && <div className="cfg-toggle-hint">{hint}</div>}
      </div>
      <div
        className={"cfg-toggle-switch" + (checked ? " cfg-toggle-on" : "")}
        onClick={() => onChange(!checked)}
      >
        <div className="cfg-toggle-thumb" />
      </div>
    </label>
  );
}

const emptyMember = (): Omit<TeamMember, "id" | "initials"> => ({ name: "", email: "", role: "QA Engineer" });

// ── Release Readiness Score settings ─────────────────────────────────────────

function WeightRow({ label, hint, wKey, value, onChange }: {
  label: string; hint: string; wKey: string;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="cfg-toggle-row" style={{ cursor: "default" }}>
      <div className="cfg-toggle-text">
        <div className="cfg-toggle-label">{label}</div>
        <div className="cfg-toggle-hint">{hint}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="range" min={0} max={50} step={1}
          value={Math.round(value * 100)}
          onChange={(e) => onChange(parseInt(e.target.value, 10) / 100)}
          style={{ width: 100 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, width: 32, textAlign: "right", color: "var(--color-accent)" }}>
          {Math.round(value * 100)}%
        </span>
      </div>
    </label>
  );
}

function ThresholdRow({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="cfg-toggle-row" style={{ cursor: "default" }}>
      <div className="cfg-toggle-text">
        <div className="cfg-toggle-label">{label}</div>
        <div className="cfg-toggle-hint">{hint}</div>
      </div>
      <input
        type="number" className="input" min={0} max={100}
        style={{ width: 60, fontSize: 13, textAlign: "center" }}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
      />
    </label>
  );
}

function RrsSettingsSection() {
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState(() => localStorage.getItem("cfg_rrs_enabled") !== "false");
  const [weights, setWeights] = useState(loadRRSWeights);
  const [thresholds, setThresholds] = useState(loadRRSThresholds);
  const [saved, setSaved] = useState(false);

  const toggleEnabled = (v: boolean) => {
    setEnabled(v);
    localStorage.setItem("cfg_rrs_enabled", v ? "true" : "false");
  };

  const updateWeight = (key: keyof typeof weights, v: number) => {
    setWeights((p) => ({ ...p, [key]: v }));
  };

  const updateThreshold = (key: keyof typeof thresholds, v: number) => {
    setThresholds((p) => ({ ...p, [key]: v }));
  };

  const save = () => {
    saveRRSWeights(weights);
    saveRRSThresholds(thresholds);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const reset = () => {
    setWeights({ ...DEFAULT_RRS_WEIGHTS });
    setThresholds({ ...DEFAULT_RRS_THRESHOLDS });
  };

  return (
    <section className="cfg-section">
      <h2 className="cfg-section-title cfg-section-title--clickable" onClick={() => setExpanded((v) => !v)}>
        <span>🎯 Release Readiness Score</span>
        <span className="cfg-section-toggle">{expanded ? "▼" : "▶"}</span>
      </h2>
      {expanded && (
        <div className="cfg-section-body">
          <Toggle
            checked={enabled}
            onChange={toggleEnabled}
            label="Enable Release Readiness Score"
            hint="Calculates a composite score (0-100) from coverage, execution, pass rate, blockers, flaky tests and untested areas."
          />
          {enabled && (
            <>
              <div style={{ padding: "8px 20px 0", fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Score Weights (positive factors)
              </div>
              <WeightRow label="Coverage weight" hint="Contribution of requirements coverage to total score" wKey="coverage" value={weights.coverage} onChange={(v) => updateWeight("coverage", v)} />
              <WeightRow label="Execution Rate weight" hint="Contribution of test execution rate to total score" wKey="executionRate" value={weights.executionRate} onChange={(v) => updateWeight("executionRate", v)} />
              <WeightRow label="Pass Rate weight" hint="Contribution of pass rate to total score" wKey="passRate" value={weights.passRate} onChange={(v) => updateWeight("passRate", v)} />

              <div style={{ padding: "8px 20px 0", fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Penalty Weights (negative factors)
              </div>
              <WeightRow label="Blocker penalty" hint="Impact of open blocker/critical defects on score" wKey="blockerPenalty" value={weights.blockerPenalty} onChange={(v) => updateWeight("blockerPenalty", v)} />
              <WeightRow label="Flaky tests penalty" hint="Impact of flaky (unstable) test cases on score" wKey="flakyPenalty" value={weights.flakyPenalty} onChange={(v) => updateWeight("flakyPenalty", v)} />
              <WeightRow label="Untested areas penalty" hint="Impact of requirements without test cases on score" wKey="untestedPenalty" value={weights.untestedPenalty} onChange={(v) => updateWeight("untestedPenalty", v)} />

              <div style={{ padding: "8px 20px 0", fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Verdict Thresholds
              </div>
              <ThresholdRow label="Ready to Release" hint="Score ≥ this value → ✅ Ready" value={thresholds.ready} onChange={(v) => updateThreshold("ready", v)} />
              <ThresholdRow label="Conditional Release" hint="Score ≥ this value → ⚠️ Conditional" value={thresholds.conditional} onChange={(v) => updateThreshold("conditional", v)} />
              <ThresholdRow label="Not Ready threshold" hint="Score ≥ this value → 🔶 Not Ready (below → 🚫 Blocked)" value={thresholds.notReady} onChange={(v) => updateThreshold("notReady", v)} />

              <div style={{ padding: "0 20px", display: "flex", gap: 10, marginTop: 8 }}>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={save}>
                  {saved ? "✓ Сохранено" : "💾 Сохранить настройки"}
                </button>
                <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={reset}>
                  ↺ Сбросить по умолчанию
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default function ConfigurationsPage() {
  const { projectId } = useParams();
  const pid = projectId ?? "";
  const [cfg, setCfg] = useState<Record<string, boolean>>({});
  const [strCfg, setStrCfg] = useState<Record<string, string>>({});
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [memberForm, setMemberForm] = useState<Omit<TeamMember, "id" | "initials">>(emptyMember());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // ── Report template config ──
  const [reportCfg, setReportCfg] = useState<ReportStaticCfg>(() => loadReportStaticCfg());
  const [reportExpanded, setReportExpanded] = useState(false);
  const [reportSaved, setReportSaved] = useState(false);
  const [reportCommonExpanded, setReportCommonExpanded] = useState(true);
  const [reportProtocolExpanded, setReportProtocolExpanded] = useState(true);
  const [reportActExpanded, setReportActExpanded] = useState(true);

  const [defectsExpanded, setDefectsExpanded] = useState(true);
  const [runsExpanded, setRunsExpanded] = useState(true);
  const [traceabilityExpanded, setTraceabilityExpanded] = useState(true);
  const [casesExpanded, setCasesExpanded] = useState(true);
  const [teamExpanded, setTeamExpanded] = useState(true);
  const [showPostConditions, setShowPostConditions] = useState<boolean>(true);

  const updateReportCfg = (patch: Partial<ReportStaticCfg>) => {
    setReportCfg((prev) => ({ ...prev, ...patch }));
    setReportSaved(false);
  };
  const saveReportCfg = () => {
    saveReportStaticCfg(reportCfg);
    setReportSaved(true);
    setTimeout(() => setReportSaved(false), 2500);
  };
  const updateSigProtocol = (idx: number, field: "role" | "name", value: string) => {
    const next = reportCfg.signaturesProtocol.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    updateReportCfg({ signaturesProtocol: next });
  };
  const updateSigAct = (idx: number, field: "role" | "name", value: string) => {
    const next = reportCfg.signaturesAct.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    updateReportCfg({ signaturesAct: next });
  };
  const updateSigDefect = (idx: number, field: "role" | "name", value: string) => {
    const sigs = reportCfg.signaturesDefect ?? [
      { role: "QA инженер", name: "" },
      { role: "Руководитель подразделения / PM", name: "" },
      { role: "Разработчик", name: "" },
      { role: "Лид разработки / Tech Lead", name: "" },
    ];
    const next = sigs.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    updateReportCfg({ signaturesDefect: next });
  };

  // ── Test Plan section state ──
  const [tpExpanded, setTpExpanded] = useState(false);
  const [tpSignatories, setTpSignatories] = useState<Array<{ role: string; name: string }>>([]);

  const saveTpSigs = (sigs: Array<{ role: string; name: string }>) => {
    setTpSignatories(sigs);
    if (pid) localStorage.setItem(`tp_signatories_${pid}`, JSON.stringify(sigs));
  };

  // ── Suite ordering state ──
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [orderedRootIds, setOrderedRootIds] = useState<string[]>([]);
  const [childOrderMap, setChildOrderMap] = useState<Record<string, string[]>>({});
  const [collapsedSuiteTree, setCollapsedSuiteTree] = useState<Set<string>>(new Set());
  const [suiteOrderExpanded, setSuiteOrderExpanded] = useState(true);
  const [suiteOrderSaving, setSuiteOrderSaving] = useState(false);
  const [suiteOrderSaved, setSuiteOrderSaved] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const dragIdx = useRef<number | null>(null);
  const childDragIdx = useRef<{ parentId: string; idx: number } | null>(null);

  useEffect(() => {
    setCfg(loadCfg());
    setStrCfg(loadStrCfg());
    if (pid) {
      setTeam(loadTeam(pid));
      try { setTpSignatories(JSON.parse(localStorage.getItem(`tp_signatories_${pid}`) ?? "[]")); } catch { /* noop */ }
      const stored = localStorage.getItem(`cfg_case_show_post_conditions_${pid}`);
      setShowPostConditions(stored !== "false");
    }
  }, [pid]);

  useEffect(() => {
    if (!pid) return;
    Promise.all([suitesApi.list(pid), suiteOrderApi.get(pid).catch(() => null)])
      .then(([all, savedOrder]) => {
        setSuites(all);
        const rootSuites = all.filter((s) => !s.parent_id);
        const savedRoot: string[] = savedOrder?.root ?? [];
        const knownIds = new Set(savedRoot);
        const rootIds = [
          ...savedRoot.filter((id) => rootSuites.some((s) => s.id === id)),
          ...rootSuites.filter((s) => !knownIds.has(s.id)).map((s) => s.id),
        ];
        setOrderedRootIds(rootIds);

        const savedChildren: Record<string, string[]> = savedOrder?.children ?? {};
        const parents = all.filter((s) => all.some((c) => c.parent_id === s.id));
        const childMap: Record<string, string[]> = {};
        for (const p of parents) {
          const children = all.filter((c) => c.parent_id === p.id);
          const savedChild = savedChildren[p.id] ?? [];
          const knownChild = new Set(savedChild);
          childMap[p.id] = [
            ...savedChild.filter((id) => children.some((c) => c.id === id)),
            ...children.filter((c) => !knownChild.has(c.id)).map((c) => c.id),
          ];
        }
        setChildOrderMap(childMap);
      })
      .catch(() => {});
  }, [pid]);

  const persistOrder = (rootIds: string[], childMap: Record<string, string[]>) => {
    if (!pid) return;
    setSuiteOrderSaving(true);
    setSuiteOrderSaved(false);
    suiteOrderApi
      .put(pid, { root: rootIds, children: childMap })
      .then(() => {
        setHasPendingChanges(false);
        setSuiteOrderSaved(true);
        setTimeout(() => setSuiteOrderSaved(false), 2500);
      })
      .finally(() => setSuiteOrderSaving(false));
  };

  const suiteById = new Map(suites.map((s) => [s.id, s]));

  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const next = [...orderedRootIds];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(idx, 0, moved);
    dragIdx.current = idx;
    setOrderedRootIds(next);
  };
  const handleDrop = () => {
    dragIdx.current = null;
    setHasPendingChanges(true);
  };

  const toggleSuiteTree = (id: string) => {
    setCollapsedSuiteTree((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Child drag handlers ──────────────────────────────────────────────────────
  const handleChildDragStart = (parentId: string, idx: number) => {
    childDragIdx.current = { parentId, idx };
  };

  const handleChildDragOver = (e: React.DragEvent, parentId: string, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const d = childDragIdx.current;
    if (!d || d.parentId !== parentId || d.idx === idx) return;
    const cur = childOrderMap[parentId] ?? [];
    const next = [...cur];
    const [moved] = next.splice(d.idx, 1);
    next.splice(idx, 0, moved);
    childDragIdx.current = { parentId, idx };
    setChildOrderMap((m) => ({ ...m, [parentId]: next }));
  };

  const handleChildDrop = (e: React.DragEvent) => {
    e.stopPropagation();
    childDragIdx.current = null;
    setHasPendingChanges(true);
  };

  // ── Recursive tree renderer ──────────────────────────────────────────────────
  // childIdx — позиция данного узла среди его сиблингов (для drag дочерних)
  const renderSuiteNode = (suiteId: string, depth: number, rootIdx: number, childIdx?: number): React.ReactNode => {
    const s = suiteById.get(suiteId);
    if (!s) return null;

    // Дочерние, упорядоченные по сохранённому порядку
    const rawChildren = suites.filter((c) => c.parent_id === suiteId);
    const orderedChildIds = childOrderMap[suiteId];
    const children: TestSuite[] = orderedChildIds
      ? [
          ...orderedChildIds
            .map((id) => rawChildren.find((c) => c.id === id))
            .filter((c): c is TestSuite => c !== undefined),
          ...rawChildren.filter((c) => !orderedChildIds.includes(c.id)),
        ]
      : rawChildren;

    const hasChildren = children.length > 0;
    const isCollapsed = collapsedSuiteTree.has(suiteId);
    const isChild = depth > 0;

    return (
      <div key={suiteId}>
        <div
          className={`cfg-suite-row${isChild ? " cfg-suite-child" : ""}`}
          style={{ paddingLeft: 12 + depth * 20 }}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            if (!isChild) {
              handleDragStart(rootIdx);
            } else if (s.parent_id && childIdx !== undefined) {
              handleChildDragStart(s.parent_id, childIdx);
            }
          }}
          onDragOver={(e) => {
            if (!isChild) {
              if (dragIdx.current !== null) handleDragOver(e, rootIdx);
              else e.preventDefault();
            } else if (s.parent_id && childIdx !== undefined) {
              if (childDragIdx.current !== null) {
                handleChildDragOver(e, s.parent_id, childIdx);
              } else if (dragIdx.current !== null) {
                // root-сьют тащат над дочерним элементом — считаем как наведение на родительский root
                handleDragOver(e, rootIdx);
              } else {
                e.preventDefault();
              }
            } else {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            if (!isChild) {
              e.stopPropagation();
              handleDrop();
            } else {
              if (childDragIdx.current !== null) {
                handleChildDrop(e);
              } else if (dragIdx.current !== null) {
                e.stopPropagation();
                handleDrop();
              } else {
                e.preventDefault();
              }
            }
          }}
          onDragEnd={() => {
            // fires even if dropped outside any droppable target
            if (dragIdx.current !== null) { dragIdx.current = null; setHasPendingChanges(true); }
            if (childDragIdx.current !== null) { childDragIdx.current = null; setHasPendingChanges(true); }
          }}
        >
          <span className="cfg-suite-drag">⠿</span>
          <button
            className="cfg-suite-toggle"
            style={{ visibility: hasChildren ? "visible" : "hidden" }}
            onClick={(e) => { e.stopPropagation(); toggleSuiteTree(suiteId); }}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
          <span className="cfg-suite-name">{s.name}</span>
          {!isChild && <span className="cfg-suite-idx">#{rootIdx + 1}</span>}
        </div>
        {!isCollapsed && children.map((child, idx) =>
          renderSuiteNode(child.id, depth + 1, rootIdx, idx)
        )}
      </div>
    );
  };

  const persistTeam = (next: TeamMember[]) => { setTeam(next); saveTeam(pid, next); };

  const openAdd = () => { setMemberForm(emptyMember()); setEditingId(null); setFormOpen(true); };
  const openEdit = (m: TeamMember) => {
    setMemberForm({ name: m.name, email: m.email, role: m.role });
    setEditingId(m.id); setFormOpen(true);
  };
  const removeMember = (id: string) => persistTeam(team.filter((m) => m.id !== id));
  const saveMember = () => {
    if (!memberForm.name.trim()) return;
    const member: TeamMember = {
      id: editingId ?? crypto.randomUUID(),
      initials: makeInitials(memberForm.name),
      ...memberForm,
    };
    if (editingId) {
      persistTeam(team.map((m) => m.id === editingId ? member : m));
    } else {
      persistTeam([...team, member]);
    }
    setFormOpen(false);
  };

  const set = (key: string, val: boolean) => {
    const next = { ...cfg, [key]: val };
    setCfg(next);
    saveCfg(next);
    localStorage.setItem(key, val ? "true" : "false");
  };

  const setStr = (key: string, val: string) => {
    const next = { ...strCfg, [key]: val };
    setStrCfg(next);
    saveStrCfg(next);
    localStorage.setItem(key, val);
  };

  return (
    <div className="cfg-page">
      <div className="cfg-header">
        <h1 className="cfg-title">Configurations</h1>
        <p className="cfg-subtitle">Project-level settings and validations</p>
      </div>

      <div className="cfg-sections">
        {/* Defects */}
        <section className="cfg-section">
          <h2 className="cfg-section-title cfg-section-title--clickable" onClick={() => setDefectsExpanded((v) => !v)}>
            <span>🐞 Defects</span>
            <span className="cfg-section-toggle">{defectsExpanded ? "▼" : "▶"}</span>
          </h2>
          {defectsExpanded && (
            <div className="cfg-section-body">
              <Toggle
                checked={!!cfg[CFG_KEY]}
                onChange={(v) => set(CFG_KEY, v)}
                label="Release required for defects"
                hint="When enabled, every defect must be linked to a release before it can be saved."
              />
              <Toggle
                checked={!!cfg["cfg_defect_steps_required"]}
                onChange={(v) => set("cfg_defect_steps_required", v)}
                label="Steps to reproduce required"
                hint="When enabled, the 'Steps to Reproduce' field is mandatory when creating a defect."
              />
            </div>
          )}
        </section>

        {/* Test Runs */}
        <section className="cfg-section">
          <h2 className="cfg-section-title cfg-section-title--clickable" onClick={() => setRunsExpanded((v) => !v)}>
            <span>▶ Test Runs</span>
            <span className="cfg-section-toggle">{runsExpanded ? "▼" : "▶"}</span>
          </h2>
          {runsExpanded && (
          <div className="cfg-section-body">
            <Toggle
              checked={!!cfg["cfg_run_environment_required"]}
              onChange={(v) => set("cfg_run_environment_required", v)}
              label="Environment required for test runs"
              hint="When enabled, an environment must be selected before creating a test run."
            />
            <Toggle
              checked={!!cfg["cfg_run_device_required"]}
              onChange={(v) => set("cfg_run_device_required", v)}
              label="Device Type required for test runs"
              hint="When enabled, Device Type (Mobile/PC/Tablet) must be selected when creating a test run."
            />
            <Toggle
              checked={!!cfg["cfg_run_os_required"]}
              onChange={(v) => set("cfg_run_os_required", v)}
              label="OS required for test runs"
              hint="When enabled, OS must be selected (if Device Type is set) when creating a test run."
            />
            <Toggle
              checked={!!cfg["cfg_run_release_required"]}
              onChange={(v) => set("cfg_run_release_required", v)}
              label="Release required for test runs"
              hint="When enabled, a release must be linked to every test run."
            />
            <Toggle
              checked={!!cfg["cfg_run_allow_edit_completed"]}
              onChange={(v) => set("cfg_run_allow_edit_completed", v)}
              label="Allow editing results after run is completed"
              hint="When disabled, test result statuses cannot be changed once the run is marked as Completed."
            />
            <Toggle
              checked={!!cfg["cfg_run_allow_edit_active"]}
              onChange={(v) => set("cfg_run_allow_edit_active", v)}
              label="Allow editing and deleting active (non-completed) runs"
              hint="When disabled, test runs can only be edited or deleted after they are marked as Completed."
            />
            <Toggle
              checked={!!cfg["cfg_run_allow_actual_result_completed"]}
              onChange={(v) => set("cfg_run_allow_actual_result_completed", v)}
              label="Allow editing Actual Result field in completed runs"
              hint="When enabled, testers can fill or edit the Actual Result text in step rows even after a run is marked as Completed."
            />
            <label className="cfg-toggle-row" style={{ cursor: "default" }}>
              <div className="cfg-toggle-text">
                <div className="cfg-toggle-label">Completion reminder interval (min)</div>
                <div className="cfg-toggle-hint">
                  After declining "Complete run?" — повторное напоминание через N минут.
                </div>
              </div>
              <input
                type="number"
                className="input"
                style={{ width: 72, fontSize: 13, textAlign: "center" }}
                min={1}
                max={60}
                value={parseInt(strCfg["cfg_run_complete_reminder_min"] ?? "1", 10) || 1}
                onChange={(e) =>
                  setStr("cfg_run_complete_reminder_min", String(Math.max(1, parseInt(e.target.value, 10) || 1)))
                }
              />
            </label>
          </div>
          )}
        </section>

        {/* Requirements Traceability */}
        <section className="cfg-section">
          <h2 className="cfg-section-title cfg-section-title--clickable" onClick={() => setTraceabilityExpanded((v) => !v)}>
            <span>📊 Requirements Traceability</span>
            <span className="cfg-section-toggle">{traceabilityExpanded ? "▼" : "▶"}</span>
          </h2>
          {traceabilityExpanded && (
            <div className="cfg-section-body">
              <label className="cfg-toggle-row" style={{ cursor: "default" }}>
                <div className="cfg-toggle-text">
                  <div className="cfg-toggle-label">Coverage column display</div>
                  <div className="cfg-toggle-hint">Выберите формат отображения покрытия в таблице требований.</div>
                </div>
                <select
                  className="input"
                  style={{ width: 200, fontSize: 12 }}
                  value={strCfg["cfg_traceability_coverage_display"] ?? "bar_pct"}
                  onChange={(e) => setStr("cfg_traceability_coverage_display", e.target.value)}
                >
                  <option value="bar_pct">Прогресс-бар + %</option>
                  <option value="pct">Только проценты</option>
                </select>
              </label>
            </div>
          )}
        </section>

        {/* Test Cases */}
        <section className="cfg-section">
          <h2 className="cfg-section-title cfg-section-title--clickable" onClick={() => setCasesExpanded((v) => !v)}>
            <span>📋 Test Cases</span>
            <span className="cfg-section-toggle">{casesExpanded ? "▼" : "▶"}</span>
          </h2>
          {casesExpanded && (
            <div className="cfg-section-body">
              <Toggle
                checked={!!cfg["cfg_case_steps_required"]}
                onChange={(v) => set("cfg_case_steps_required", v)}
                label="Steps required for test cases"
                hint="When enabled, at least one step must be added to a test case."
              />
              <Toggle
                checked={!!cfg["cfg_case_suite_required"]}
                onChange={(v) => set("cfg_case_suite_required", v)}
                label="Suite required for test cases"
                hint="When enabled, test cases without a suite cannot be created."
              />
              <Toggle
                checked={showPostConditions}
                onChange={(v) => {
                  setShowPostConditions(v);
                  localStorage.setItem(`cfg_case_show_post_conditions_${pid}`, v ? "true" : "false");
                }}
                label="Show Post-conditions field"
                hint="When disabled, the Post-conditions field is hidden in the test case form and drawer view."
              />
            </div>
          )}
        </section>

        {/* Test Plan print sections */}
        <section className="cfg-section">
          <h2
            className="cfg-section-title cfg-section-title--clickable"
            onClick={() => setTpExpanded((v) => !v)}
          >
            <span>📝 Test Plan</span>
            <span className="cfg-section-toggle">{tpExpanded ? "▼" : "▶"}</span>
          </h2>
          {tpExpanded && (
            <div className="cfg-section-body">
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", padding: "0 20px 8px", margin: 0 }}>
                Выберите разделы печатной формы тест-плана (вкладка «Print form» внутри тест-плана).
              </p>
              {([
                { key: "cfg_tp_s1",  label: "1. Общая информация",         hint: "Название проекта, версия, автор, дата, цель" },
                { key: "cfg_tp_s2",  label: "2. Scope",                     hint: "In Scope / Out of Scope" },
                { key: "cfg_tp_s3",  label: "3. Test Objectives",           hint: "Цели тестирования" },
                { key: "cfg_tp_s4",  label: "4. Test Items",                hint: "Список тест-кейсов плана" },
                { key: "cfg_tp_s5",  label: "5. Типы тестирования",         hint: "Таблица применяемых видов тестирования" },
                { key: "cfg_tp_s6",  label: "6. Test Strategy",             hint: "Подход и методология тестирования" },
                { key: "cfg_tp_s7",  label: "7. Test Environment",          hint: "Окружения, браузеры, устройства, ОС" },
                { key: "cfg_tp_s8",  label: "8. Entry Criteria",            hint: "Критерии начала тестирования" },
                { key: "cfg_tp_s9",  label: "9. Exit Criteria",             hint: "Критерии завершения тестирования" },
                { key: "cfg_tp_s10", label: "10. Test Deliverables",        hint: "Артефакты: протокол, акт, отчёт о дефектах" },
                { key: "cfg_tp_s11", label: "11. Roles & Responsibilities", hint: "Команда из раздела Configurations → Team" },
                { key: "cfg_tp_s12", label: "12. Defect Management",        hint: "Приоритеты, severity, процесс" },
                { key: "cfg_tp_s13", label: "13. Risks & Mitigation",       hint: "Риски и меры по их снижению (таблица)" },
                { key: "cfg_tp_s14", label: "14. Test Schedule",            hint: "График тестирования (таблица)" },
                { key: "cfg_tp_s15", label: "15. Metrics",                  hint: "Метрики качества и критерии успеха" },
                { key: "cfg_tp_s16", label: "16. Approvals",                hint: "Лист согласования с подписями" },
              ] as const).map(({ key, label, hint }) => (
                <Toggle
                  key={key}
                  checked={cfg[key] !== false}
                  onChange={(v) => set(key, v)}
                  label={label}
                  hint={hint}
                />
              ))}

              {/* Signatories for Approvals section */}
              <div style={{ padding: "12px 20px 8px", borderTop: "1px solid var(--color-border)", marginTop: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                  Подписанты (лист согласования тест-плана)
                </div>
                <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "0 0 10px" }}>
                  Заполняются в разделе 16 «Approvals» печатной формы. Если не заданы — используется список команды.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {tpSignatories.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        placeholder="Должность / роль"
                        value={s.role}
                        onChange={(e) => saveTpSigs(tpSignatories.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
                      />
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        placeholder="ФИО"
                        value={s.name}
                        onChange={(e) => saveTpSigs(tpSignatories.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      />
                      <button
                        className="btn"
                        style={{ fontSize: 11, padding: "2px 8px", color: "#dc2626", borderColor: "#dc2626", flexShrink: 0 }}
                        onClick={() => saveTpSigs(tpSignatories.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn"
                    style={{ fontSize: 11, alignSelf: "flex-start", marginTop: 2 }}
                    onClick={() => saveTpSigs([...tpSignatories, { role: "", name: "" }])}
                  >
                    + Добавить подписанта
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Release Readiness Score */}
        <RrsSettingsSection />

        {/* Suites order */}
        {pid && suites.length > 0 && (
          <section className="cfg-section">
            <h2
              className="cfg-section-title cfg-section-title--clickable"
              onClick={() => setSuiteOrderExpanded((v) => !v)}
            >
              <span>📁 Suite Display Options</span>
              <span className="cfg-section-toggle">{suiteOrderExpanded ? "▼" : "▶"}</span>
            </h2>
            {suiteOrderExpanded && (
              <div className="cfg-section-body">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", marginBottom: 12 }}>
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0, flex: 1 }}>
                    Перетащите (⠿) любой сьют для изменения порядка — как корневые, так и дочерние внутри родителя. Нажмите «Сохранить порядок», чтобы изменения применились в разделе Test Cases.
                  </p>
                  <div style={{ display: "flex", gap: 6, marginLeft: 12, flexShrink: 0 }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: "3px 10px" }}
                      onClick={() => setCollapsedSuiteTree(new Set(suites.map((s) => s.id)))}
                      title="Свернуть все сьюты"
                    >
                      ⇑ Свернуть все
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: "3px 10px" }}
                      onClick={() => setCollapsedSuiteTree(new Set())}
                      title="Развернуть все сьюты"
                    >
                      ⇓ Развернуть все
                    </button>
                  </div>
                </div>
                <div className="cfg-suite-list">
                  {orderedRootIds.map((id, idx) => renderSuiteNode(id, 0, idx))}
                </div>
                <div style={{ padding: "0 20px", display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <button
                    className={`btn ${hasPendingChanges ? "btn-primary" : "btn-secondary"}`}
                    style={{ fontSize: 12 }}
                    disabled={suiteOrderSaving || (!hasPendingChanges && !suiteOrderSaved)}
                    onClick={() => persistOrder(orderedRootIds, childOrderMap)}
                  >
                    {suiteOrderSaving ? "Сохраняем…" : suiteOrderSaved ? "✓ Сохранено" : "💾 Сохранить порядок"}
                  </button>
                  {hasPendingChanges && !suiteOrderSaving && (
                    <span style={{ fontSize: 11, color: "#ca8a04", display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ca8a04", display: "inline-block" }} />
                      Есть несохранённые изменения
                    </span>
                  )}
                  {!hasPendingChanges && !suiteOrderSaving && !suiteOrderSaved && (
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                      Порядок сохранён — откройте Test Cases, чтобы увидеть изменения
                    </span>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Report Templates */}
        <section className="cfg-section">
          <h2
            className="cfg-section-title cfg-section-title--clickable"
            onClick={() => setReportExpanded((v) => !v)}
          >
            <span>📄 Report Templates</span>
            <span className="cfg-section-toggle">{reportExpanded ? "▼" : "▶"}</span>
          </h2>
          {reportExpanded && (
            <div className="cfg-section-body" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", padding: "0 20px 12px", margin: 0 }}>
                Статические текстовые блоки для Протокола и Акта тестирования. Динамические данные (статистика, тест-кейсы, скриншоты) подтягиваются автоматически из прогона.
              </p>

              {/* Common fields subsection */}
              <div className="cfg-subsection">
                <h3 className="cfg-subsection-title" onClick={() => setReportCommonExpanded((v) => !v)}>
                  <span>Общие поля</span>
                  <span className="cfg-section-toggle">{reportCommonExpanded ? "▼" : "▶"}</span>
                </h3>
                {reportCommonExpanded && (
                  <div style={{ padding: "0 20px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label className="form-label">Продукт / Наименование системы</label>
                      <input className="input" style={{ width: "100%" }} placeholder="Например: Web-портал для клиентов"
                        value={reportCfg.productName} onChange={(e) => updateReportCfg({ productName: e.target.value })} />
                    </div>
                    <div>
                      <label className="form-label">Версия релиза</label>
                      <input className="input" style={{ width: "100%" }} placeholder="Например: 4.0.1 (10731)"
                        value={reportCfg.releaseVersion} onChange={(e) => updateReportCfg({ releaseVersion: e.target.value })} />
                    </div>
                    <div>
                      <label className="form-label">Объект тестирования</label>
                      <input className="input" style={{ width: "100%" }} placeholder="Например: Оповещение пользователя о новой версии"
                        value={reportCfg.testingObject} onChange={(e) => updateReportCfg({ testingObject: e.target.value })} />
                    </div>
                    <div>
                      <label className="form-label">Тип тестирования</label>
                      <input className="input" style={{ width: "100%" }} placeholder="Функциональное тестирование"
                        value={reportCfg.testType} onChange={(e) => updateReportCfg({ testType: e.target.value })} />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label className="form-label">Основание для тестирования</label>
                      <input className="input" style={{ width: "100%" }} placeholder="Требования безопасности / Требования к ПО"
                        value={reportCfg.basisDescription} onChange={(e) => updateReportCfg({ basisDescription: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>

              {/* Протокол subsection */}
              <div className="cfg-subsection">
                <h3 className="cfg-subsection-title" onClick={() => setReportProtocolExpanded((v) => !v)}>
                  <span>Протокол тестирования</span>
                  <span className="cfg-section-toggle">{reportProtocolExpanded ? "▼" : "▶"}</span>
                </h3>
                {reportProtocolExpanded && (
                  <div style={{ padding: "0 20px 16px" }}>
                    <label className="form-label">Итог (раздел 5) — оставьте пустым для автогенерации</label>
                    <textarea className="input" style={{ width: "100%", height: 72, resize: "vertical" }}
                      placeholder="По результатам проведённого тестирования установлено, что…"
                      value={reportCfg.protocolConclusion}
                      onChange={(e) => updateReportCfg({ protocolConclusion: e.target.value })} />

                    <div style={{ marginTop: 12 }}>
                      <label className="form-label">Подписи (Протокол)</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {reportCfg.signaturesProtocol.map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input className="input" style={{ flex: 1 }} placeholder="Должность"
                              value={s.role} onChange={(e) => updateSigProtocol(i, "role", e.target.value)} />
                            <input className="input" style={{ flex: 1 }} placeholder="ФИО"
                              value={s.name} onChange={(e) => updateSigProtocol(i, "name", e.target.value)} />
                            <button className="btn" style={{ fontSize: 11, padding: "2px 6px", color: "#dc2626" }}
                              onClick={() => updateReportCfg({ signaturesProtocol: reportCfg.signaturesProtocol.filter((_, j) => j !== i) })}>✕</button>
                          </div>
                        ))}
                        <button className="btn" style={{ fontSize: 11, alignSelf: "flex-start" }}
                          onClick={() => updateReportCfg({ signaturesProtocol: [...reportCfg.signaturesProtocol, { role: "", name: "" }] })}>
                          + Добавить строку
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Акт subsection */}
              <div className="cfg-subsection">
                <h3 className="cfg-subsection-title" onClick={() => setReportActExpanded((v) => !v)}>
                  <span>Акт тестирования</span>
                  <span className="cfg-section-toggle">{reportActExpanded ? "▼" : "▶"}</span>
                </h3>
                {reportActExpanded && (
                  <div style={{ padding: "0 20px 16px" }}>
                    <div style={{ marginBottom: 12 }}>
                      <label className="form-label">Риски (раздел 8)</label>
                      <textarea className="input" style={{ width: "100%", height: 60, resize: "vertical" }}
                        placeholder="На момент проведения тестирования риски не обнаружены."
                        value={reportCfg.risks}
                        onChange={(e) => updateReportCfg({ risks: e.target.value })} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label className="form-label">Заключение (раздел 9) — оставьте пустым для автогенерации</label>
                      <textarea className="input" style={{ width: "100%", height: 72, resize: "vertical" }}
                        placeholder="По результатам проведённого тестирования установлено, что…"
                        value={reportCfg.actConclusion}
                        onChange={(e) => updateReportCfg({ actConclusion: e.target.value })} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label className="form-label">Решение комиссии (раздел 10) — по умолчанию авто по Pass Rate</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {[
                          { v: "auto" as const, label: "Авто (Разрешить при 0 ошибок, иначе Запретить)" },
                          { v: "allow" as const, label: "Разрешить релиз" },
                          { v: "allow_with_restrictions" as const, label: "Разрешить релиз с ограничениями" },
                          { v: "deny" as const, label: "Запретить релиз" },
                        ].map(({ v, label }) => (
                          <label key={v} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                            <input type="radio" name="actDecision" value={v}
                              checked={reportCfg.actDecision === v}
                              onChange={() => updateReportCfg({ actDecision: v })} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label className="form-label">Подписи (Акт)</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {reportCfg.signaturesAct.map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input className="input" style={{ flex: 1 }} placeholder="Должность"
                              value={s.role} onChange={(e) => updateSigAct(i, "role", e.target.value)} />
                            <input className="input" style={{ flex: 1 }} placeholder="ФИО"
                              value={s.name} onChange={(e) => updateSigAct(i, "name", e.target.value)} />
                            <button className="btn" style={{ fontSize: 11, padding: "2px 6px", color: "#dc2626" }}
                              onClick={() => updateReportCfg({ signaturesAct: reportCfg.signaturesAct.filter((_, j) => j !== i) })}>✕</button>
                          </div>
                        ))}
                        <button className="btn" style={{ fontSize: 11, alignSelf: "flex-start" }}
                          onClick={() => updateReportCfg({ signaturesAct: [...reportCfg.signaturesAct, { role: "", name: "" }] })}>
                          + Добавить строку
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Подписи (Отчёт о дефекте)</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(reportCfg.signaturesDefect ?? [
                          { role: "QA инженер", name: "" },
                          { role: "Руководитель подразделения / PM", name: "" },
                          { role: "Разработчик", name: "" },
                          { role: "Лид разработки / Tech Lead", name: "" },
                        ]).map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input className="input" style={{ flex: 1 }} placeholder="Должность"
                              value={s.role} onChange={(e) => updateSigDefect(i, "role", e.target.value)} />
                            <input className="input" style={{ flex: 1 }} placeholder="ФИО"
                              value={s.name} onChange={(e) => updateSigDefect(i, "name", e.target.value)} />
                            <button className="btn" style={{ fontSize: 11, padding: "2px 6px", color: "#dc2626" }}
                              onClick={() => {
                                const sigs = reportCfg.signaturesDefect ?? [];
                                updateReportCfg({ signaturesDefect: sigs.filter((_, j) => j !== i) });
                              }}>✕</button>
                          </div>
                        ))}
                        <button className="btn" style={{ fontSize: 11, alignSelf: "flex-start" }}
                          onClick={() => updateReportCfg({ signaturesDefect: [...(reportCfg.signaturesDefect ?? []), { role: "", name: "" }] })}>
                          + Добавить строку
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ padding: "8px 20px 16px", display: "flex", gap: 10, alignItems: "center" }}>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={saveReportCfg}>
                  {reportSaved ? "✓ Сохранено" : "💾 Сохранить настройки"}
                </button>
                {reportSaved && <span style={{ fontSize: 11, color: "#16a34a" }}>Применится к следующему открытому отчёту</span>}
              </div>
            </div>
          )}
        </section>

        {/* Team */}
        {pid && (
          <section className="cfg-section">
            <h2 className="cfg-section-title cfg-section-title--clickable" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }} onClick={() => setTeamExpanded((v) => !v)}>
              <span>👥 Team</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={(e) => { e.stopPropagation(); openAdd(); }}>+ Add member</button>
                <span className="cfg-section-toggle">{teamExpanded ? "▼" : "▶"}</span>
              </div>
            </h2>
            {teamExpanded && (
            <div className="cfg-section-body">
              {team.length === 0 ? (
                <div className="cfg-team-empty">
                  Нет участников команды. Добавьте сотрудников для назначения на прогоны, акты и протоколы тестирования.
                </div>
              ) : (
                <div className="cfg-team-list">
                  {team.map((m) => {
                    const rc = ROLE_COLORS[m.role] ?? { bg: "#f3f4f6", color: "#6b7280" };
                    return (
                      <div key={m.id} className="cfg-team-row">
                        <div className="cfg-team-avatar" style={{ background: rc.bg, color: rc.color }}>
                          {m.initials}
                        </div>
                        <div className="cfg-team-info">
                          <div className="cfg-team-name">{m.name}</div>
                          {m.email && <div className="cfg-team-email">{m.email}</div>}
                        </div>
                        <span className="cfg-team-role" style={{ background: rc.bg, color: rc.color }}>{m.role}</span>
                        <div className="cfg-team-actions">
                          <button className="btn-icon" title="Edit" onClick={() => openEdit(m)}>✎</button>
                          <button className="btn-icon" title="Remove" onClick={() => removeMember(m.id)}>🗑</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )}
          </section>
        )}
      </div>

      {/* Team member form modal */}
      {formOpen && (
        <div className="modal-backdrop" onClick={() => setFormOpen(false)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingId ? "Edit team member" : "Add team member"}</h2>
              <button className="btn-icon" onClick={() => setFormOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="form-label">Full name *</label>
                <input className="input" style={{ width: "100%" }} autoFocus
                  placeholder="Иван Иванов"
                  value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Email</label>
                <input className="input" style={{ width: "100%" }} type="email"
                  placeholder="ivan@example.com"
                  value={memberForm.email} onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Role</label>
                <select className="input" style={{ width: "100%" }}
                  value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}>
                  {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveMember} disabled={!memberForm.name.trim()}>
                {editingId ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
