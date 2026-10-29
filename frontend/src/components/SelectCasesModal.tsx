import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import { casesApi, requirementsApi, suitesApi, PRIORITY, type Requirement, type TestCase, type TestSuite } from "../api/client";
import "./SelectCasesModal.css";

interface Props {
  open: boolean;
  projectId: string;
  preSelectedIds: string[];
  onClose: () => void;
  onDone: (ids: string[]) => void;
}

const AUTO_ICON: Record<string, string> = {
  manual: "👤",
  to_be_automated: "🔄",
  automated: "⚡",
};

const PRIORITY_ICON: Record<string, string> = { high: "↑", medium: "→", low: "↓", not_set: "—" };
const PRIORITY_COLOR: Record<string, string> = { high: "#dc2626", medium: "#ca8a04", low: "#6b7280", not_set: "#9ca3af" };

const SC_LEFT_KEY = "sc_left_width";

type SelectTab = "suite" | "requirement";

const REQ_TYPE_ICON: Record<string, string> = { epic: "🏆", feature: "⭐", story: "📖", requirement: "📋" };

export default function SelectCasesModal({ open, projectId, preSelectedIds, onClose, onDone }: Props) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [reqCasesMap, setReqCasesMap] = useState<Record<string, TestCase[]>>({});
  const [activeTab, setActiveTab] = useState<SelectTab>("suite");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeSuiteKey, setActiveSuiteKey] = useState<string>("__none__");
  const [activeReqId, setActiveReqId] = useState<string | null>(null);
  const [loadingReqCases, setLoadingReqCases] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // Resizable left panel
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(SC_LEFT_KEY) ?? "260", 10);
    return isNaN(saved) ? 260 : Math.max(160, Math.min(420, saved));
  });
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startW.current = leftWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const next = Math.max(160, Math.min(420, startW.current + (ev.clientX - startX.current)));
      setLeftWidth(next);
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp, { once: true });
  }, [leftWidth]);

  useEffect(() => {
    localStorage.setItem(SC_LEFT_KEY, String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(preSelectedIds));
    setSearch("");
    setActiveSuiteKey("__none__");
    setActiveReqId(null);
    setActiveTab("suite");
    setReqCasesMap({});
    setLoading(true);
    Promise.all([casesApi.list(projectId), suitesApi.list(projectId), requirementsApi.list(projectId)])
      .then(([c, s, r]) => {
        setCases(c);
        setSuites(s);
        setRequirements(r);
        const firstKey = c.find(x => !x.test_suite_id) ? "__none__" : (c[0]?.test_suite_id ?? "__none__");
        setActiveSuiteKey(firstKey);
      })
      .finally(() => setLoading(false));
  }, [open, projectId]);

  const loadReqCases = async (reqId: string) => {
    if (reqCasesMap[reqId] !== undefined) return;
    setLoadingReqCases(true);
    try {
      const c = await requirementsApi.getTestCases(reqId);
      setReqCasesMap((m) => ({ ...m, [reqId]: c }));
    } finally {
      setLoadingReqCases(false);
    }
  };

  const handleSelectReq = (reqId: string) => {
    setActiveReqId(reqId);
    loadReqCases(reqId);
  };

  const groups = useMemo(() => {
    const suiteMap = new Map(suites.map((s) => [s.id, s.name]));
    const map = new Map<string, { name: string; items: TestCase[] }>();
    const filtered = search
      ? cases.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
      : cases;
    for (const c of filtered) {
      const key = c.test_suite_id ?? "__none__";
      const name = c.test_suite_id
        ? suiteMap.get(c.test_suite_id) ?? "(deleted suite)"
        : "Test cases without suite";
      if (!map.has(key)) map.set(key, { name, items: [] });
      map.get(key)!.items.push(c);
    }
    // ensure __none__ group appears first
    const result: { key: string; name: string; items: TestCase[] }[] = [];
    if (map.has("__none__")) result.push({ key: "__none__", ...map.get("__none__")! });
    for (const [k, v] of map.entries()) {
      if (k !== "__none__") result.push({ key: k, ...v });
    }
    return result;
  }, [cases, suites, search]);

  const activeGroup = groups.find((g) => g.key === activeSuiteKey) ?? groups[0];
  const allRefLeft = useRef<HTMLInputElement>(null);

  const totalSelected = selected.size;
  const totalCases = cases.length;
  const allSelected = totalCases > 0 && selected.size === totalCases;
  const someSelected = selected.size > 0 && selected.size < totalCases;

  useEffect(() => {
    if (allRefLeft.current) allRefLeft.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(cases.map((c) => c.id)));
  };

  const toggleGroup = (g: typeof groups[0]) => {
    const ids = g.items.map((c) => c.id);
    const allIn = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    if (allIn) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    setSelected(next);
  };

  const toggleCase = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const reqCasesForActive = activeReqId ? (reqCasesMap[activeReqId] ?? null) : null;

  const renderCaseRow = (c: TestCase, _idx: number) => (
    <div key={c.id} className="sc-case-row">
      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleCase(c.id)} />
      <span className="sc-case-icon">{AUTO_ICON[c.automation_status] ?? "👤"}</span>
      <span className="sc-case-id">TC-{c.display_seq ?? "?"}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: PRIORITY_COLOR[c.priority] ?? "#9ca3af", minWidth: 14, textAlign: "center", flexShrink: 0 }} title={`Priority: ${c.priority}`}>
        {PRIORITY_ICON[c.priority] ?? "—"}
      </span>
      <span className="sc-case-name">{c.name}</span>
      <span className="sc-case-assignee">Unassigned</span>
    </div>
  );

  return (
    <Modal
      open={open}
      title={`Select test cases`}
      onClose={onClose}
      width={1140}
      noPadding
      footer={
        <>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{selected.size} выбрано</span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onDone(Array.from(selected))}>
            Done
          </button>
        </>
      }
    >
      {/* Tabs */}
      <div className="sc-tabs">
        <button className={"sc-tab" + (activeTab === "suite" ? " is-active" : "")} onClick={() => setActiveTab("suite")}>
          🗂 По сьютам
        </button>
        <button className={"sc-tab" + (activeTab === "requirement" ? " is-active" : "")} onClick={() => setActiveTab("requirement")}>
          📋 По требованиям
          {requirements.length > 0 && <span className="sc-tab-cnt">{requirements.length}</span>}
        </button>
      </div>

      {loading ? (
        <div className="sc-loading">Loading…</div>
      ) : activeTab === "suite" ? (
        <div className="sc-layout">
          {/* ── Left panel ── */}
          <div className="sc-left" style={{ width: leftWidth, minWidth: leftWidth, maxWidth: leftWidth }}>
            <input className="input sc-search" placeholder="Search for cases" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="sc-left-row sc-left-all">
              <input ref={allRefLeft} type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span className="sc-left-label">Select all</span>
              <span className="sc-count">{totalSelected}/{totalCases}</span>
            </div>
            {groups.map((g) => {
              const gSel = g.items.filter((c) => selected.has(c.id)).length;
              const gAll = g.items.length > 0 && gSel === g.items.length;
              const gSome = gSel > 0 && gSel < g.items.length;
              return (
                <div key={g.key} className={"sc-left-row sc-left-suite" + (activeSuiteKey === g.key ? " is-active" : "")} onClick={() => setActiveSuiteKey(g.key)}>
                  <IndeterminateCheckbox checked={gAll} indeterminate={gSome} onChange={() => toggleGroup(g)} onClick={(e) => e.stopPropagation()} />
                  <span className="sc-left-label">{g.name}</span>
                  <span className="sc-count">{gSel}/{g.items.length}</span>
                </div>
              );
            })}
          </div>
          <div className="sc-divider" onMouseDown={onDividerMouseDown} title="Потяните для изменения размера" />
          {/* ── Right panel ── */}
          <div className="sc-right">
            {!activeGroup ? (
              <div className="sc-empty">No test cases found.</div>
            ) : (
              <>
                <div className="sc-right-head">{activeGroup.name}</div>
                <div className="sc-right-selall">
                  <IndeterminateCheckbox
                    checked={activeGroup.items.every((c) => selected.has(c.id))}
                    indeterminate={activeGroup.items.some((c) => selected.has(c.id)) && !activeGroup.items.every((c) => selected.has(c.id))}
                    onChange={() => toggleGroup(activeGroup)}
                  />
                  <span>Select all</span>
                  <span className="sc-count" style={{ marginLeft: 8 }}>
                    {activeGroup.items.filter((c) => selected.has(c.id)).length}/{activeGroup.items.length}
                  </span>
                </div>
                {activeGroup.items.map((c, idx) => renderCaseRow(c, idx))}
              </>
            )}
          </div>
        </div>
      ) : (
        /* ── By Requirement tab ── */
        <div className="sc-layout">
          <div className="sc-left" style={{ width: leftWidth, minWidth: leftWidth, maxWidth: leftWidth }}>
            <input className="input sc-search" placeholder="Поиск требований" value={search} onChange={(e) => setSearch(e.target.value)} />
            {requirements.length === 0 ? (
              <div className="sc-empty" style={{ padding: "20px 12px" }}>Нет требований. Добавьте их в разделе Requirements.</div>
            ) : requirements.filter((r) => !search || r.title.toLowerCase().includes(search.toLowerCase())).map((r) => {
              const rCases = reqCasesMap[r.id] ?? [];
              const sel = rCases.filter((c) => selected.has(c.id)).length;
              return (
                <div key={r.id} className={"sc-left-row sc-left-suite" + (activeReqId === r.id ? " is-active" : "")} onClick={() => handleSelectReq(r.id)}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{REQ_TYPE_ICON[r.req_type ?? "requirement"] ?? "📋"}</span>
                  <span className="sc-left-label" style={{ fontSize: 12 }}>{r.title}</span>
                  <span className="sc-count">{reqCasesMap[r.id] !== undefined ? `${sel}/${rCases.length}` : r.case_count}</span>
                </div>
              );
            })}
          </div>
          <div className="sc-divider" onMouseDown={onDividerMouseDown} title="Потяните для изменения размера" />
          <div className="sc-right">
            {!activeReqId ? (
              <div className="sc-empty">Выберите требование слева чтобы увидеть привязанные тест-кейсы.</div>
            ) : loadingReqCases ? (
              <div className="sc-loading">Загружаем…</div>
            ) : !reqCasesForActive || reqCasesForActive.length === 0 ? (
              <div className="sc-empty">К этому требованию не привязано ни одного тест-кейса.</div>
            ) : (
              <>
                <div className="sc-right-head">
                  {requirements.find((r) => r.id === activeReqId)?.title ?? "Требование"}
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: 8 }}>
                    ({reqCasesForActive.filter((c) => selected.has(c.id)).length}/{reqCasesForActive.length} выбрано)
                  </span>
                </div>
                <div className="sc-right-selall">
                  <IndeterminateCheckbox
                    checked={reqCasesForActive.every((c) => selected.has(c.id))}
                    indeterminate={reqCasesForActive.some((c) => selected.has(c.id)) && !reqCasesForActive.every((c) => selected.has(c.id))}
                    onChange={() => {
                      const allIn = reqCasesForActive.every((c) => selected.has(c.id));
                      const next = new Set(selected);
                      if (allIn) reqCasesForActive.forEach((c) => next.delete(c.id));
                      else reqCasesForActive.forEach((c) => next.add(c.id));
                      setSelected(next);
                    }}
                  />
                  <span>Выбрать все</span>
                </div>
                {reqCasesForActive.map((c, idx) => renderCaseRow(c, idx))}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  onClick,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} onClick={onClick} />;
}
