import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { casesApi, suitesApi, suiteOrderApi, plansApi, authApi, orgStore, orgsApi, projectsApi, CASE_STATUS, CASE_TYPE, PRIORITY, AUTOMATION_STATUS, LAYER, type TestCase, type TestSuite, type TestPlan } from "../api/client";
import TestCaseDrawer from "../components/TestCaseDrawer";
import { useBackToClose } from "../hooks/useBackToClose";
import CreateSuiteModal from "../components/CreateSuiteModal";
import Modal from "../components/Modal";
import { buildQaseExportForSuite, build4qaExportForSuite, downloadJSON } from "../utils/exportFormats";
import { CaseStatusIcon } from "../components/CaseStatusIcon";
import "./RepositoryPage.css";

type ViewType = "nested" | "folders" | "mindmap";
type SuiteNode = TestSuite & { children: SuiteNode[] };

function toPlanId(display_id: string): string {
  return display_id.startsWith("R") ? "TP-" + display_id.slice(1) : display_id;
}

function buildTree(suites: TestSuite[]): SuiteNode[] {
  const map = new Map<string, SuiteNode>(suites.map((s) => [s.id, { ...s, children: [] }]));
  const roots: SuiteNode[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) map.get(node.parent_id)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function countSuiteCases(node: SuiteNode, casesBySuite: Record<string, TestCase[]>): number {
  return (casesBySuite[node.id] ?? []).length +
    node.children.reduce((sum, c) => sum + countSuiteCases(c, casesBySuite), 0);
}

const AUTO_ICON: Record<string, string> = { manual: "👤", to_be_automated: "🔄", automated: "⚡" };
const PRIORITY_ICON: Record<string, string> = { high: "↑", medium: "→", low: "↓", not_set: "—" };
const PRIORITY_COLOR: Record<string, string> = { high: "#dc2626", medium: "#ca8a04", low: "#6b7280", not_set: "#9ca3af" };
const LAYER_META: Record<string, { label: string }> = {
  unit:        { label: "Unit" },
  integration: { label: "Intg" },
  e2e:         { label: "E2E"  },
  api:         { label: "API"  },
  ui:          { label: "UI"   },
};

// ── Resizable split ──────────────────────────────────────────────────────────
function useResizable(defaultWidth: number, key: string) {
  const [width, setWidth] = useState(() => parseInt(localStorage.getItem(key) ?? String(defaultWidth), 10));
  const drag = useRef(false);
  const sx = useRef(0); const sw = useRef(0);
  useEffect(() => { localStorage.setItem(key, String(width)); }, [width, key]);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); drag.current = true; sx.current = e.clientX; sw.current = width;
    const onMove = (ev: MouseEvent) => { if (!drag.current) return; setWidth(Math.max(180, Math.min(520, sw.current + ev.clientX - sx.current))); };
    const onUp = () => { drag.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [width]);
  return { width, onMouseDown };
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function RepositoryPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const currentUser = authApi.getCachedUser();
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";
  const [activeOrgName, setActiveOrgName] = useState<string | null>(() => orgStore.get()?.name ?? null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const openCaseDone = useRef(false);

  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [activeCase, setActiveCase] = useState<TestCase | null>(null);
  useBackToClose(activeCase !== null, () => setActiveCase(null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [viewType, setViewType] = useState<ViewType>("nested");
  const [viewPopupOpen, setViewPopupOpen] = useState(false);
  const [suiteMenuId, setSuiteMenuId] = useState<string | null>(null);
  const [activeSuiteId, setActiveSuiteId] = useState<string | null>(null);
  const [collapsedSuites, setCollapsedSuites] = useState<Set<string>>(new Set());

  const [suiteModalOpen, setSuiteModalOpen] = useState(false);
  const [suiteModalParentId, setSuiteModalParentId] = useState<string | null>(null);
  const [editSuite, setEditSuite] = useState<TestSuite | null>(null);
  const [suiteSearch, setSuiteSearch] = useState("");

  // ── Mobile: suites panel off-canvas drawer ──
  const [suitesPanelOpen, setSuitesPanelOpen] = useState(false);

  // ── Search & filter ──
  const [searchText, setSearchText] = useState("");
  const [searchField, setSearchField] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterSuiteIds, setFilterSuiteIds] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterPriorities, setFilterPriorities] = useState<string[]>([]);
  const [filterAutoStatus, setFilterAutoStatus] = useState<string[]>([]);

  // ── Bulk selection (tree view) ──
  const [selectedCases, setSelectedCases] = useState<Set<string>>(new Set());
  const [bulkMoveSuiteId, setBulkMoveSuiteId] = useState<string>("");
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);

  // ── Add to plan ──
  const [addToPlanOpen, setAddToPlanOpen] = useState(false);
  const [plans, setPlans] = useState<TestPlan[]>([]);
  const [addToPlanId, setAddToPlanId] = useState<string>("");
  const [newPlanName, setNewPlanName] = useState<string>("");
  const [addToPlanWorking, setAddToPlanWorking] = useState(false);

  const toggleSelectCase = (id: string) => setSelectedCases((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const clearSelection = () => setSelectedCases(new Set());

  const toggleSelectGroup = useCallback((ids: string[], select: boolean) => {
    setSelectedCases((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  }, []);

  const bulkDelete = async () => {
    if (!selectedCases.size || !confirm(`Удалить ${selectedCases.size} тест-кейс(а/ов)?`)) return;
    setBulkWorking(true);
    try {
      await Promise.all([...selectedCases].map((id) => casesApi.delete(id)));
      clearSelection(); reload();
    } finally { setBulkWorking(false); }
  };

  const renameCase = useCallback(async (id: string, newName: string) => {
    try {
      const updated = await casesApi.update(id, { name: newName } as any);
      setCases((p) => p.map((c) => c.id === id ? { ...c, name: updated.name } : c));
    } catch { /* silent */ }
  }, []);

  const duplicateCase = useCallback(async (id: string) => {
    if (!projectId) return;
    const src = cases.find((c) => c.id === id);
    if (!src) return;
    try {
      const { id: _id, display_seq: _seq, display_order: _ord, created_at: _ca, updated_at: _ua, revision: _rev, ...rest } = src as any;
      const created = await casesApi.create({ ...rest, name: `${src.name} copy01`, project_id: projectId });
      setCases((p) => {
        const idx = p.findIndex((c) => c.id === id);
        const next = [...p];
        next.splice(idx + 1, 0, created);
        return next;
      });
    } catch (e) { alert("Не удалось дублировать кейс"); }
  }, [cases, projectId]);

  const bulkMove = async () => {
    if (!selectedCases.size || !bulkMoveSuiteId) return;
    setBulkWorking(true);
    try {
      await Promise.all([...selectedCases].map((id) =>
        casesApi.update(id, { test_suite_id: bulkMoveSuiteId === "__none__" ? null : bulkMoveSuiteId })
      ));
      clearSelection(); setBulkMoveOpen(false); reload();
    } finally { setBulkWorking(false); }
  };
  const [filterLayer, setFilterLayer] = useState<string[]>([]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const { width: leftWidth, onMouseDown: onDividerMouseDown } = useResizable(280, "repo_left_width");
  const rightPanelRef = useRef<HTMLElement>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true); setError(null);
    try {
      const [s, c, savedOrder] = await Promise.all([
        suitesApi.list(projectId),
        casesApi.list(projectId),
        suiteOrderApi.get(projectId).catch(() => null),
      ]);

      const rootOrder: string[] = savedOrder?.root ?? [];
      const childOrders: Record<string, string[]> = savedOrder?.children ?? {};

      // Separate roots and build children-by-parent map
      const rootSuites: TestSuite[] = [];
      const childrenByParent = new Map<string, TestSuite[]>();
      for (const suite of s) {
        if (suite.parent_id) {
          const arr = childrenByParent.get(suite.parent_id) ?? [];
          arr.push(suite);
          childrenByParent.set(suite.parent_id, arr);
        } else {
          rootSuites.push(suite);
        }
      }

      // Sort root suites by saved order
      if (rootOrder.length > 0) {
        const idxMap = new Map(rootOrder.map((id, i) => [id, i]));
        rootSuites.sort((a, b) => (idxMap.get(a.id) ?? 9999) - (idxMap.get(b.id) ?? 9999));
      }

      // Sort children of each parent by saved order
      for (const [parentId, children] of childrenByParent) {
        const childOrder = childOrders[parentId] ?? [];
        if (childOrder.length > 0) {
          const idxMap = new Map(childOrder.map((id, i) => [id, i]));
          children.sort((a, b) => (idxMap.get(a.id) ?? 9999) - (idxMap.get(b.id) ?? 9999));
        }
        childrenByParent.set(parentId, children);
      }

      // Build flat array in DFS order (parent → children → grandchildren)
      const sorted: TestSuite[] = [];
      const dfs = (suites: TestSuite[]) => {
        for (const suite of suites) {
          sorted.push(suite);
          dfs(childrenByParent.get(suite.id) ?? []);
        }
      };
      dfs(rootSuites);
      // Append any orphaned suites (parent was deleted, etc.)
      for (const suite of s) {
        if (!sorted.includes(suite)) sorted.push(suite);
      }

      setSuites(sorted); setCases(c);
    } catch (e) { setError(e instanceof Error ? e.message : "Load failed"); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  // Load project name
  useEffect(() => {
    if (!projectId) return;
    projectsApi.get(projectId).then((p) => setProjectName(p.name)).catch(() => {});
  }, [projectId]);

  // Load org name for current user
  useEffect(() => {
    if (isSuperAdmin) {
      setOrgName(orgStore.get()?.name ?? null);
    } else {
      const orgId = currentUser?.organization_id;
      if (orgId) {
        orgsApi.getOrg(orgId).then((o) => setOrgName(o.name)).catch(() => {});
      }
    }
  }, [isSuperAdmin, currentUser?.organization_id]);

  // SUPER_ADMIN: navigate to /projects when org is changed via TopBar
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; name: string } | null;
      setActiveOrgName(detail?.name ?? null);
      setOrgName(detail?.name ?? null);
      navigate("/projects");
    };
    window.addEventListener("tms:orgchange", handler);
    return () => window.removeEventListener("tms:orgchange", handler);
  }, [navigate]);

  useEffect(() => {
    if (loading || openCaseDone.current) return;
    const caseIdToOpen = searchParams.get("openCase");
    if (!caseIdToOpen) return;
    openCaseDone.current = true;
    const found = cases.find((c) => c.id === caseIdToOpen);
    if (found) setActiveCase(found);
    navigate(`/project/${projectId}/repository`, { replace: true });
  }, [loading, cases, searchParams, navigate, projectId]);

  useEffect(() => {
    if (!suiteMenuId && !viewPopupOpen) return;
    const close = () => { setSuiteMenuId(null); setViewPopupOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [suiteMenuId, viewPopupOpen]);

  const filteredCases = useMemo(() => {
    let result = cases;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter((c) => {
        if (searchField === "all") {
          return c.name.toLowerCase().includes(q) ||
            (c.description?.toLowerCase().includes(q) ?? false) ||
            (c.tags?.some((t) => t.toLowerCase().includes(q)) ?? false);
        }
        if (searchField === "name") return c.name.toLowerCase().includes(q);
        if (searchField === "description") return c.description?.toLowerCase().includes(q) ?? false;
        if (searchField === "tags") return c.tags?.some((t) => t.toLowerCase().includes(q)) ?? false;
        return true;
      });
    }
    if (filterStatus.length > 0) result = result.filter((c) => filterStatus.includes(c.status));
    if (filterSuiteIds.length > 0) result = result.filter((c) =>
      c.test_suite_id ? filterSuiteIds.includes(c.test_suite_id) : filterSuiteIds.includes("__none__")
    );
    if (filterTypes.length > 0) result = result.filter((c) => filterTypes.includes(c.type));
    if (filterPriorities.length > 0) result = result.filter((c) => filterPriorities.includes(c.priority));
    if (filterAutoStatus.length > 0) result = result.filter((c) => filterAutoStatus.includes(c.automation_status));
    if (filterLayer.length > 0) result = result.filter((c) => filterLayer.includes(c.layer));
    return result;
  }, [cases, searchText, searchField, filterStatus, filterSuiteIds, filterTypes, filterPriorities, filterAutoStatus, filterLayer]);

  const casesBySuite = useMemo(() => {
    const map: Record<string, TestCase[]> = {};
    for (const c of filteredCases) { const key = c.test_suite_id ?? "__none__"; (map[key] ||= []).push(c); }
    return map;
  }, [filteredCases]);

  const suiteTree = useMemo(() => buildTree(suites), [suites]);

  // Поиск по сьютам: совпавший сьют показывается со ВСЕМ поддеревом,
  // а у совпавшего дочернего — вся цепочка родителей.
  // keepIds — все видимые при поиске сьюты (для folder view),
  // expandIds — совпавшие сьюты + их предки (раскрываются автоматически).
  const { filteredSuiteTree, suiteSearchKeepIds, suiteSearchExpandIds } = useMemo(() => {
    const q = suiteSearch.trim().toLowerCase();
    if (!q) return { filteredSuiteTree: suiteTree, suiteSearchKeepIds: null, suiteSearchExpandIds: [] as string[] };
    const keep = new Set<string>();
    const expand: string[] = [];
    const keepSubtree = (n: SuiteNode) => { keep.add(n.id); n.children.forEach(keepSubtree); };
    function filterTree(nodes: SuiteNode[]): SuiteNode[] {
      return nodes.reduce<SuiteNode[]>((acc, node) => {
        if (node.name.toLowerCase().includes(q)) {
          keepSubtree(node);
          expand.push(node.id);
          acc.push(node);
        } else {
          const kids = filterTree(node.children);
          if (kids.length > 0) {
            keep.add(node.id);
            expand.push(node.id);
            acc.push({ ...node, children: kids });
          }
        }
        return acc;
      }, []);
    }
    const tree = filterTree(suiteTree);
    return { filteredSuiteTree: tree, suiteSearchKeepIds: keep, suiteSearchExpandIds: expand };
  }, [suiteTree, suiteSearch]);

  // Раскрываем совпадения и путь к ним, чтобы найденное не пряталось в свёрнутых сьютах
  useEffect(() => {
    if (suiteSearchExpandIds.length === 0) return;
    setCollapsedSuites((prev) => {
      if (!suiteSearchExpandIds.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      suiteSearchExpandIds.forEach((id) => next.delete(id));
      return next;
    });
  }, [suiteSearchExpandIds]);
  const orphans = casesBySuite["__none__"] ?? [];

  const suitesById = useMemo(() => new Map(suites.map((s) => [s.id, s])), [suites]);

  // Load plans when addToPlan modal opens
  useEffect(() => {
    if (!addToPlanOpen || !projectId) return;
    plansApi.list(projectId).then(setPlans).catch(() => {});
  }, [addToPlanOpen, projectId]);

  const addToPlan = async () => {
    if (!selectedCases.size) return;
    const ids = Array.from(selectedCases);
    setAddToPlanWorking(true);
    try {
      if (addToPlanId === "__new__") {
        if (!newPlanName.trim()) return;
        const plan = await plansApi.create({ name: newPlanName.trim(), project_id: projectId! });
        await plansApi.setCases(plan.id, ids);
      } else if (addToPlanId) {
        await plansApi.addCases(addToPlanId, ids);
      }
      setAddToPlanOpen(false);
      setAddToPlanId("");
      setNewPlanName("");
      clearSelection();
    } finally {
      setAddToPlanWorking(false);
    }
  };

  const activeFilterCount = filterStatus.length + filterSuiteIds.length + filterTypes.length + filterPriorities.length + filterAutoStatus.length + filterLayer.length;
  const clearFilters = () => { setFilterStatus([]); setFilterSuiteIds([]); setFilterTypes([]); setFilterPriorities([]); setFilterAutoStatus([]); setFilterLayer([]); };

  // When filters/search active: compute which suite IDs should be visible in right panel
  const visibleSuiteIds = useMemo((): Set<string> | null => {
    const hasFilter = searchText.trim() || filterSuiteIds.length > 0 || filterStatus.length > 0 ||
      filterTypes.length > 0 || filterPriorities.length > 0 || filterAutoStatus.length > 0 ||
      filterLayer.length > 0;
    if (!hasFilter) return null; // null = show all

    const relevant = new Set<string>(filteredCases.map((c) => c.test_suite_id).filter(Boolean) as string[]);
    // add parent suites up the hierarchy
    const addParents = (id: string) => {
      const s = suitesById.get(id);
      if (s?.parent_id && !relevant.has(s.parent_id)) {
        relevant.add(s.parent_id);
        addParents(s.parent_id);
      }
    };
    for (const sid of Array.from(relevant)) addParents(sid);
    return relevant;
  }, [filteredCases, filterSuiteIds, filterStatus, filterTypes, filterPriorities, filterAutoStatus, filterLayer, searchText, suitesById]);

  const createNew = () => navigate(`/project/${projectId}/repository/new`);
  const createNewInSuite = (suiteId: string) => navigate(`/project/${projectId}/repository/new?suite=${suiteId}`);
  const editCaseNav = (id: string) => navigate(`/project/${projectId}/repository/case/${id}/edit`);

  const deleteCase = async (id: string) => {
    if (!confirm("Удалить тест-кейс?")) return;
    await casesApi.delete(id); setActiveCase(null); reload();
  };

  // ── Delete suite modal state ──
  const [deleteSuiteId, setDeleteSuiteId] = useState<string | null>(null);
  const [deleteSuiteAction, setDeleteSuiteAction] = useState<"delete_cases" | "no_suite">("no_suite");
  const [deletingSuite, setDeletingSuite] = useState(false);

  const deleteSuite = (id: string) => {
    setDeleteSuiteId(id);
    setDeleteSuiteAction("no_suite");
  };

  // collect all descendant suite IDs (including self) from the already-loaded tree
  const getDescendantIds = useCallback((rootId: string): string[] => {
    const ids: string[] = [rootId];
    const queue = [rootId];
    while (queue.length) {
      const current = queue.shift()!;
      suites.filter((s) => s.parent_id === current).forEach((s) => {
        ids.push(s.id);
        queue.push(s.id);
      });
    }
    return ids;
  }, [suites]);

  const confirmDeleteSuite = async () => {
    if (!deleteSuiteId) return;
    setDeletingSuite(true);
    try {
      const keepCases = deleteSuiteAction === "no_suite";
      await suitesApi.delete(deleteSuiteId, keepCases);
      if (activeSuiteId === deleteSuiteId) setActiveSuiteId(null);
      setDeleteSuiteId(null);
      reload();
    } catch (e) {
      alert("Ошибка при удалении сьюта: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeletingSuite(false);
    }
  };

  // ── Bulk select & delete suites ──
  const [suiteSelectMode, setSuiteSelectMode] = useState(false);
  const [selectedSuiteIds, setSelectedSuiteIds] = useState<Set<string>>(new Set());
  const [bulkDeleteSuitesOpen, setBulkDeleteSuitesOpen] = useState(false);
  const [bulkDeleteSuitesAction, setBulkDeleteSuitesAction] = useState<"delete_cases" | "no_suite">("no_suite");
  const [bulkDeletingSuites, setBulkDeletingSuites] = useState(false);

  const toggleSuiteSelectMode = () => { setSuiteSelectMode((v) => !v); setSelectedSuiteIds(new Set()); };
  const toggleSelectSuite = (id: string) => setSelectedSuiteIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Selected suites whose ancestor isn't also selected (their subtree-delete covers descendants)
  const getRootSelectedSuiteIds = useCallback((ids: Set<string>): string[] => {
    return [...ids].filter((id) => {
      let current = suitesById.get(id);
      while (current?.parent_id) {
        if (ids.has(current.parent_id)) return false;
        current = suitesById.get(current.parent_id);
      }
      return true;
    });
  }, [suitesById]);

  const bulkDeleteAffectedCount = useMemo(() => {
    if (!bulkDeleteSuitesOpen) return 0;
    const rootIds = getRootSelectedSuiteIds(selectedSuiteIds);
    const allDescendantIds = new Set<string>();
    rootIds.forEach((id) => getDescendantIds(id).forEach((d) => allDescendantIds.add(d)));
    return cases.filter((c) => c.test_suite_id && allDescendantIds.has(c.test_suite_id)).length;
  }, [bulkDeleteSuitesOpen, selectedSuiteIds, getRootSelectedSuiteIds, getDescendantIds, cases]);

  const confirmBulkDeleteSuites = async () => {
    setBulkDeletingSuites(true);
    try {
      const rootIds = getRootSelectedSuiteIds(selectedSuiteIds);
      const keepCases = bulkDeleteSuitesAction === "no_suite";
      await Promise.all(rootIds.map((id) => suitesApi.delete(id, keepCases)));
      if (activeSuiteId && selectedSuiteIds.has(activeSuiteId)) setActiveSuiteId(null);
      setSelectedSuiteIds(new Set());
      setSuiteSelectMode(false);
      setBulkDeleteSuitesOpen(false);
      reload();
    } catch (e) {
      alert("Ошибка при удалении сьютов: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBulkDeletingSuites(false);
    }
  };

  // ── Export suite modal state ──
  const [exportSuiteId, setExportSuiteId] = useState<string | null>(null);
  const [exportFmt, setExportFmt] = useState<"4qa" | "qase" | "both">("4qa");
  const [exporting, setExporting] = useState(false);

  const openExportSuite = (id: string) => { setExportSuiteId(id); setExportFmt("4qa"); };

  const doExportSuite = async () => {
    if (!exportSuiteId || !projectId) return;
    const suite = suitesById.get(exportSuiteId);
    if (!suite) return;
    setExporting(true);
    try {
      const dt = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
      const baseName = suite.name.replace(/\s+/g, "_");
      if (exportFmt === "4qa" || exportFmt === "both") {
        const payload = build4qaExportForSuite(suite, suites, cases, projectId, projectName ?? projectId);
        downloadJSON(payload, `4qa_export_${baseName}_${dt}.json`);
      }
      if (exportFmt === "qase" || exportFmt === "both") {
        const payload = { suites: buildQaseExportForSuite(suite, suites, cases) };
        downloadJSON(payload, `qase_export_${baseName}_${dt}.json`);
      }
      setExportSuiteId(null);
    } finally {
      setExporting(false);
    }
  };

  const openCreateSuite = (parentId?: string | null) => { setEditSuite(null); setSuiteModalParentId(parentId ?? null); setSuiteModalOpen(true); };
  const openEditSuite = (s: TestSuite) => { setEditSuite(s); setSuiteModalParentId(null); setSuiteModalOpen(true); };
  const closeSuiteModal = () => { setSuiteModalOpen(false); setEditSuite(null); setSuiteModalParentId(null); };

  const toggleCollapse = (id: string) => setCollapsedSuites((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const collapseAll = () => setCollapsedSuites(new Set(suites.map((s) => s.id)));
  const expandAll = () => setCollapsedSuites(new Set());

  // Scroll right panel to section when left panel suite clicked
  const scrollToSection = useCallback((id: string) => {
    if (viewType !== "nested") return;
    setTimeout(() => {
      const el = document.getElementById(`suite-sec-${id}`);
      if (el && rightPanelRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  }, [viewType]);

  // ── Quick create handler ──
  const quickCreate = useCallback(async (name: string, suiteId?: string | null) => {
    if (!projectId || !name.trim()) return;
    const trimmed = name.trim();
    // Check for duplicate name in the project
    const duplicate = cases.find((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      const suiteName = duplicate.test_suite_id ? (suites.find((s) => s.id === duplicate.test_suite_id)?.name ?? "?") : "без сьюта";
      alert(`Тест-кейс «${trimmed}» уже существует (${suiteName}). Пожалуйста, придумайте другое название.`);
      return;
    }
    await casesApi.create({ name: trimmed, project_id: projectId, test_suite_id: suiteId ?? undefined });
    reload();
  }, [projectId, reload, cases, suites]);

  // ── Case drag-n-drop reorder ──
  const reorderCasesInSuite = useCallback(async (suiteId: string | null, newOrder: TestCase[]) => {
    setCases((prev) => {
      const others = prev.filter((c) => (c.test_suite_id ?? null) !== suiteId);
      return [...others, ...newOrder];
    });
    try {
      await casesApi.batchReorder(newOrder.map((c) => c.id));
    } catch { /* silent, reload on error */ reload(); }
  }, [reload]);

  // ── Suite drag-n-drop reorder (persisted per-user to DB via suite_orders) ──
  const dragSuiteId = useRef<string | null>(null);

  const persistSuiteOrder = useCallback((suitesList: TestSuite[]) => {
    if (!projectId) return;
    const root: string[] = [];
    const children: Record<string, string[]> = {};
    for (const s of suitesList) {
      if (!s.parent_id) root.push(s.id);
      else (children[s.parent_id] ||= []).push(s.id);
    }
    suiteOrderApi.put(projectId, { root, children }).catch(() => {});
  }, [projectId]);

  const handleSuiteDragStart = useCallback((id: string) => { dragSuiteId.current = id; }, []);

  const handleSuiteDrop = useCallback((targetId: string) => {
    const draggedId = dragSuiteId.current;
    dragSuiteId.current = null;
    if (!draggedId || draggedId === targetId) return;
    setSuites((prev) => {
      const dragged = prev.find((s) => s.id === draggedId);
      const target = prev.find((s) => s.id === targetId);
      if (!dragged || !target || (dragged.parent_id ?? null) !== (target.parent_id ?? null)) return prev;
      const next = [...prev];
      const fromIdx = next.findIndex((s) => s.id === draggedId);
      next.splice(fromIdx, 1);
      const toIdx = next.findIndex((s) => s.id === targetId);
      next.splice(toIdx, 0, dragged);
      persistSuiteOrder(next);
      return next;
    });
  }, [persistSuiteOrder]);

  // ── Render suite tree recursively (right panel, nested view) ──
  const renderSuiteTree = (nodes: SuiteNode[]): React.ReactNode =>
    nodes
      .filter((node) => !visibleSuiteIds || visibleSuiteIds.has(node.id))
      .map((node) => (
        <TreeCaseGroup
          key={node.id}
          title={node.name}
          description={node.description}
          cases={casesBySuite[node.id] ?? []}
          suiteId={node.id}
          sectionId={`suite-sec-${node.id}`}
          isCollapsed={collapsedSuites.has(node.id)}
          onToggle={() => toggleCollapse(node.id)}
          onAddCase={() => createNewInSuite(node.id)}
          onAddChildSuite={() => openCreateSuite(node.id)}
          onEditSuite={() => openEditSuite(node)}
          onDeleteSuite={() => deleteSuite(node.id)}
          onCaseClick={setActiveCase}
          onQuickCreate={(n) => quickCreate(n, node.id)}
          totalCount={countSuiteCases(node, casesBySuite)}
          selectedCases={selectedCases}
          onToggleSelect={toggleSelectCase}
          onSelectAll={toggleSelectGroup}
          onRenameCase={renameCase}
          onReorder={(newOrder) => reorderCasesInSuite(node.id, newOrder)}
          onDuplicateCase={duplicateCase}
          onEditCase={editCaseNav}
          onDeleteCase={deleteCase}
        >
          {!collapsedSuites.has(node.id) && node.children.length > 0 && (
            <div className="repo-child-suites">
              {renderSuiteTree(node.children)}
            </div>
          )}
        </TreeCaseGroup>
      ));

  // ── Folder view data ──
  const folderSuiteId = activeSuiteId;
  const folderSuite = useMemo(() => folderSuiteId ? suitesById.get(folderSuiteId) : null, [suitesById, folderSuiteId]);
  const folderSubSuites = useMemo(() => {
    if (!folderSuiteId || folderSuiteId === "__none__") return suites.filter((s) => !s.parent_id);
    return suites.filter((s) => s.parent_id === folderSuiteId);
  }, [suites, folderSuiteId]);
  const folderCases = useMemo(() => {
    if (!folderSuiteId || folderSuiteId === "__none__") return orphans;
    return casesBySuite[folderSuiteId] ?? [];
  }, [casesBySuite, folderSuiteId, orphans]);
  // breadcrumb path for folder view: [{id, name: "Suite A"}, {id, name: "Suite B"}, ...]
  const folderSuitePath = useMemo(() => {
    const path: { id: string; name: string }[] = [];
    let current = folderSuite ?? undefined;
    while (current) {
      path.unshift({ id: current.id, name: current.name });
      current = current.parent_id ? suitesById.get(current.parent_id) : undefined;
    }
    return path;
  }, [folderSuite, suitesById]);

  // active case suite name
  const activeCaseSuiteName = useMemo(() => {
    if (!activeCase?.test_suite_id) return null;
    return suitesById.get(activeCase.test_suite_id)?.name ?? null;
  }, [activeCase, suitesById]);

  // breadcrumb path for active case: ["Suite A", "Suite B", "Suite C"]
  const activeCaseSuitePath = useMemo(() => {
    if (!activeCase?.test_suite_id) return [];
    const path: string[] = [];
    let current = suitesById.get(activeCase.test_suite_id);
    while (current) {
      path.unshift(current.name);
      current = current.parent_id ? suitesById.get(current.parent_id) : undefined;
    }
    return path;
  }, [activeCase, suitesById]);

  return (
    <div className="repo">
      <div className="repo-header">
        <div>
          <h1 className="page-title">
            Test Cases
            <span className="repo-counts"> {cases.length} cases | {suites.length} suites</span>
          </h1>
        </div>
        <button className="btn btn-primary" style={{ flexShrink: 0, marginTop: 2 }} onClick={createNew}>+ Manual test</button>
      </div>

      <div className="repo-toolbar">
        <button className="btn btn-secondary repo-suites-toggle" onClick={() => setSuitesPanelOpen(true)}>
          📁 Suites
        </button>
        <input
          className="input"
          placeholder="Search test cases…"
          style={{ width: 200, fontSize: 13 }}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <div className="repo-toolbar-filters">
          <MultiSelectDrop
            label="Status"
            selected={filterStatus}
            onChange={setFilterStatus}
            options={(CASE_STATUS as readonly string[]).map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
          />
          <MultiSelectDrop
            label="Type"
            selected={filterTypes}
            onChange={setFilterTypes}
            options={(CASE_TYPE as readonly string[]).map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
          />
          <MultiSelectDrop
            label="Priority"
            selected={filterPriorities}
            onChange={setFilterPriorities}
            options={(PRIORITY as readonly string[]).map((p) => ({ value: p, label: p.replace(/_/g, " ") }))}
          />
          <MultiSelectDrop
            label="Automation"
            selected={filterAutoStatus}
            onChange={setFilterAutoStatus}
            options={(AUTOMATION_STATUS as readonly string[]).map((a) => ({ value: a, label: a.replace(/_/g, " ") }))}
          />
          <MultiSelectDrop
            label="Layer"
            selected={filterLayer}
            onChange={setFilterLayer}
            options={(LAYER as readonly string[]).map((l) => ({ value: l, label: l === "not_set" ? "Not set" : l.toUpperCase() }))}
          />
          <MultiSelectDrop
            label="Suite"
            selected={filterSuiteIds}
            onChange={setFilterSuiteIds}
            options={(() => {
              const result: { value: string; label: string; indent: number }[] = [];
              const addNode = (nodes: SuiteNode[], depth: number) => {
                for (const n of nodes) {
                  result.push({ value: n.id, label: n.name, indent: depth });
                  if (n.children.length > 0) addNode(n.children, depth + 1);
                }
              };
              addNode(suiteTree, 0);
              return result;
            })()}
          />
          {activeFilterCount > 0 && (
            <button className="btn-link" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={clearFilters}>
              Сбросить ({activeFilterCount})
            </button>
          )}
        </div>
        <button className="btn btn-secondary repo-mobile-filters-btn" onClick={() => setMobileFiltersOpen(true)}>
          ⚙ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      <Modal
        open={mobileFiltersOpen}
        title="Filters"
        onClose={() => setMobileFiltersOpen(false)}
        width={420}
        footer={
          <>
            {activeFilterCount > 0 && (
              <button className="btn btn-secondary" onClick={clearFilters}>Сбросить ({activeFilterCount})</button>
            )}
            <button className="btn btn-primary" onClick={() => setMobileFiltersOpen(false)}>Готово</button>
          </>
        }
      >
        <RepoFilterPanel
          suites={suites}
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          filterSuiteIds={filterSuiteIds} setFilterSuiteIds={setFilterSuiteIds}
          filterTypes={filterTypes} setFilterTypes={setFilterTypes}
          filterPriorities={filterPriorities} setFilterPriorities={setFilterPriorities}
          filterAutoStatus={filterAutoStatus} setFilterAutoStatus={setFilterAutoStatus}
          filterLayer={filterLayer} setFilterLayer={setFilterLayer}
        />
      </Modal>

      {error && <div className="page-banner">⚠ {error}</div>}
      {loading && <div className="page-banner">Загружаем…</div>}

      {viewType === "mindmap" && (
        <div style={{ position: "relative" }}>
          {/* Floating view switcher — doesn't block mind map content */}
          <div style={{ position: "absolute", top: 10, left: 12, zIndex: 20 }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ position: "relative" }} className="repo-view-wrap">
              <button className="btn btn-secondary"
                style={{ fontSize: 12, padding: "4px 10px", background: "var(--color-bg)", boxShadow: "0 2px 8px rgba(0,0,0,0.14)" }}
                onClick={() => setViewPopupOpen((v) => !v)}>
                ⊞ View ▾
              </button>
              {viewPopupOpen && (
                <div className="repo-view-popup">
                  <div className="repo-view-popup-title">Change view</div>
                  {[
                    { key: "nested",  label: "☰ Tree view",     desc: "Test repository shown as a nested tree" },
                    { key: "folders", label: "📁 Folder view",   desc: "Test repository shown in a folder-like style" },
                    { key: "mindmap", label: "🗺 Mind map view", desc: "Test repository shown as an interactive mind map" },
                  ].map((v) => (
                    <div key={v.key} className={`repo-view-option${viewType === v.key ? " is-active" : ""}`}
                      onClick={() => { setViewType(v.key as ViewType); setViewPopupOpen(false); }}>
                      <div className="repo-view-option-label">{v.label}</div>
                      <div className="repo-view-option-desc">{v.desc}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <MindMapView
            suites={suites}
            cases={cases}
            onCaseClick={setActiveCase}
            activeCase={activeCase}
          />
        </div>
      )}

      <div className={`repo-body${viewType === "mindmap" ? " repo-body--hidden" : ""}`}>
        {/* ── Left panel ── */}
        {suitesPanelOpen && <div className="repo-suites-overlay" onClick={() => setSuitesPanelOpen(false)} />}
        <aside className={`repo-suites${suitesPanelOpen ? " repo-suites--open" : ""}`}
          style={{ width: leftWidth, minWidth: leftWidth }}>
          <div className="repo-suites-head">
            <button className="btn-icon repo-suites-close" onClick={() => setSuitesPanelOpen(false)}>✕</button>
            <div className="repo-view-wrap" onClick={(e) => e.stopPropagation()}>
              <button className="btn-icon repo-view-btn" onClick={() => setViewPopupOpen((v) => !v)}>
                {viewType === "nested"
                  ? <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><rect x="0" y="0" width="16" height="2" rx="1" fill="currentColor"/><rect x="0" y="5" width="16" height="2" rx="1" fill="currentColor"/><rect x="0" y="10" width="16" height="2" rx="1" fill="currentColor"/></svg>
                  : <svg width="16" height="14" viewBox="0 0 16 14" fill="none"><rect x="2" y="1" width="12" height="3" rx="1" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1.5"/><rect x="2" y="6" width="12" height="3" rx="1" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1.5"/><rect x="2" y="11" width="12" height="3" rx="1" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1.5"/></svg>
                }
              </button>
              {viewPopupOpen && (
                <div className="repo-view-popup">
                  <div className="repo-view-popup-title">Change view</div>
                  {[
                    { key: "nested",  label: "Nested tree view", desc: "Test repository shown as a nested tree" },
                    { key: "folders", label: "Folders view",     desc: "Test repository shown in a folder-like style" },
                    { key: "mindmap", label: "Mind map view",    desc: "Test repository shown as an interactive mind map" },
                  ].map((v) => (
                    <div key={v.key} className={`repo-view-option${viewType === v.key ? " is-active" : ""}`}
                      onClick={() => { setViewType(v.key as ViewType); setViewPopupOpen(false); }}>
                      <div className="repo-view-option-label">{v.label}</div>
                      <div className="repo-view-option-desc">{v.desc}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <strong className="repo-suites-label">Suites</strong>
            <input
              className="repo-suite-search"
              placeholder="Search…"
              value={suiteSearch}
              onChange={(e) => setSuiteSearch(e.target.value)}
            />
            <button className="btn-icon" onClick={() => openCreateSuite()}>+</button>
            <button className="btn-icon" title="Collapse all" onClick={collapseAll}>⇑</button>
            <button className="btn-icon" title="Expand all" onClick={expandAll}>⇓</button>
            <button className={`btn-icon${suiteSelectMode ? " is-active" : ""}`} title="Выбрать несколько сьютов" onClick={toggleSuiteSelectMode}>☑</button>
          </div>

          {suiteSelectMode && selectedSuiteIds.size > 0 && (
            <div className="suite-bulk-bar">
              <span className="suite-bulk-count">✓ Выбрано: {selectedSuiteIds.size}</span>
              <button className="btn-icon btn-icon-danger" title="Удалить выбранные сьюты"
                onClick={() => { setBulkDeleteSuitesAction("no_suite"); setBulkDeleteSuitesOpen(true); }}>
                <IconTrash />
              </button>
              <button className="btn-icon" title="Снять выделение" onClick={() => setSelectedSuiteIds(new Set())}>✕</button>
            </div>
          )}

          <ul className="suite-tree">
            <li className={`suite-node${activeSuiteId === "__none__" ? " is-active" : ""}${viewType === "folders" ? " suite-node-folder" : ""}`}
              onClick={() => { setActiveSuiteId("__none__"); scrollToSection("none"); setSuitesPanelOpen(false); }}>
              <span className="suite-drag-handle" />
              {viewType === "folders" ? <span className="suite-folder-icon">📁</span> : <span className="suite-caret suite-caret-leaf" />}
              <span className="suite-name">Test cases without suite</span>
              <span className="suite-count">{orphans.length}</span>
            </li>
            {filteredSuiteTree.map((node) => (
              <SuiteTreeNode key={node.id} node={node} depth={0} viewType={viewType}
                casesBySuite={casesBySuite} activeSuiteId={activeSuiteId} suiteMenuId={suiteMenuId}
                collapsed={collapsedSuites} onToggleCollapse={toggleCollapse}
                onSetActive={(id) => { setActiveSuiteId(id); scrollToSection(id); setSuitesPanelOpen(false); }}
                onOpenMenu={(id, e) => { e.stopPropagation(); setSuiteMenuId((p) => p === id ? null : id); }}
                onCloseMenu={() => setSuiteMenuId(null)} onEdit={openEditSuite} onDelete={deleteSuite}
                onCreateSuite={openCreateSuite} onCreateCase={createNewInSuite}
                onDragStartSuite={handleSuiteDragStart} onDropSuite={handleSuiteDrop}
                onExport={openExportSuite}
                selectMode={suiteSelectMode} selectedIds={selectedSuiteIds} onToggleSelect={toggleSelectSuite} />
            ))}
          </ul>
        </aside>

        {/* ── Divider ── */}
        <div className="repo-divider" onMouseDown={onDividerMouseDown} />

        {/* ── Right panel ── */}
        <section className="repo-cases" ref={rightPanelRef}>
          {viewType === "nested" ? (
            <>
              {/* Bulk action bar */}
              {selectedCases.size > 0 && (
                <div style={{ position: "sticky", top: 0, zIndex: 30, background: "var(--color-accent-soft)", border: "1px solid var(--color-accent)", borderRadius: 8, margin: "0 0 8px", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", flex: 1 }}>
                    ✓ Выбрано: {selectedCases.size}
                  </span>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 12px" }} onClick={() => setAddToPlanOpen(true)}>
                    📋 В тест-план
                  </button>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: "3px 12px" }} onClick={() => setBulkMoveOpen(true)}>
                    ↗ Переместить в сьют
                  </button>
                  <button className="btn" style={{ fontSize: 12, padding: "3px 12px", background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5" }} disabled={bulkWorking} onClick={bulkDelete}>
                    🗑 Удалить
                  </button>
                  <button className="btn-icon" title="Снять выделение" onClick={clearSelection} style={{ fontSize: 16, padding: "2px 6px" }}>✕</button>
                </div>
              )}
              {/* Add to plan modal */}
              {addToPlanOpen && (
                <div className="modal-backdrop" onClick={() => setAddToPlanOpen(false)}>
                  <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h2 className="modal-title">Добавить в тест-план</h2>
                      <button className="btn-icon" onClick={() => setAddToPlanOpen(false)}>✕</button>
                    </div>
                    <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
                        {selectedCases.size} тест-кейс(а/ов) будут добавлены в выбранный план.
                      </p>
                      <select className="input" style={{ width: "100%" }} value={addToPlanId} onChange={(e) => { setAddToPlanId(e.target.value); setNewPlanName(""); }}>
                        <option value="">— Выберите план —</option>
                        <option value="__new__">✚ Создать новый план</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>{toPlanId(p.display_id)} {p.name}</option>
                        ))}
                      </select>
                      {addToPlanId === "__new__" && (
                        <input
                          className="input"
                          placeholder="Название нового тест-плана"
                          value={newPlanName}
                          onChange={(e) => setNewPlanName(e.target.value)}
                          autoFocus
                        />
                      )}
                    </div>
                    <div className="modal-footer">
                      <button className="btn" onClick={() => setAddToPlanOpen(false)}>Отмена</button>
                      <button
                        className="btn btn-primary"
                        disabled={!addToPlanId || (addToPlanId === "__new__" && !newPlanName.trim()) || addToPlanWorking}
                        onClick={addToPlan}
                      >
                        {addToPlanWorking ? "Добавляем…" : "Добавить"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Move suite modal */}
              {bulkMoveOpen && (
                <div className="modal-backdrop" onClick={() => setBulkMoveOpen(false)}>
                  <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h2 className="modal-title">Переместить в сьют</h2>
                      <button className="btn-icon" onClick={() => setBulkMoveOpen(false)}>✕</button>
                    </div>
                    <div style={{ padding: "14px 20px" }}>
                      <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 12 }}>
                        Выберите сьют для {selectedCases.size} тест-кейс(а/ов):
                      </p>
                      <select className="input" style={{ width: "100%" }} value={bulkMoveSuiteId} onChange={(e) => setBulkMoveSuiteId(e.target.value)}>
                        <option value="">— Выберите сьют —</option>
                        <option value="__none__">📁 Без сьюта</option>
                        {suites.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="modal-footer">
                      <button className="btn" onClick={() => setBulkMoveOpen(false)}>Отмена</button>
                      <button className="btn btn-primary" disabled={!bulkMoveSuiteId || bulkWorking} onClick={bulkMove}>
                        {bulkWorking ? "Перемещаем…" : "Переместить"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Orphans — use "__none__" key in collapsedSuites */}
              <TreeCaseGroup title="Test cases without suite" cases={orphans} suiteId={null}
                sectionId="suite-sec-none"
                isCollapsed={collapsedSuites.has("__none__")}
                onToggle={() => toggleCollapse("__none__")}
                onAddCase={createNew} onCaseClick={setActiveCase} onQuickCreate={(n) => quickCreate(n, null)}
                selectedCases={selectedCases} onToggleSelect={toggleSelectCase} onSelectAll={toggleSelectGroup}
                onRenameCase={renameCase}
                onReorder={(newOrder) => reorderCasesInSuite(null, newOrder)}
                onDuplicateCase={duplicateCase}
                onEditCase={editCaseNav}
                onDeleteCase={deleteCase} />
              {/* Render suites as hierarchy — children nested inside parents */}
              {renderSuiteTree(filteredSuiteTree)}
              {!loading && cases.length === 0 && suites.length === 0 && (
                <div className="case-empty" style={{ padding: 40, textAlign: "center" }}>
                  Здесь пока пусто. <a onClick={() => openCreateSuite()}>+ Добавить Suite</a> или <a onClick={createNew}>+ New test</a>.
                </div>
              )}
            </>
          ) : (
            <FolderRightPanel
              suite={folderSuite ?? null}
              breadcrumb={folderSuitePath}
              subSuites={suiteSearchKeepIds
                ? folderSubSuites.filter((s) => suiteSearchKeepIds.has(s.id))
                : folderSubSuites}
              cases={folderCases}
              casesBySuite={casesBySuite}
              activeSuiteId={folderSuiteId}
              onOpenFolder={setActiveSuiteId}
              onCaseClick={setActiveCase}
              onEditSuite={openEditSuite}
              onDeleteSuite={deleteSuite}
              onCreateSuite={openCreateSuite}
              onCreateCase={() => folderSuiteId ? createNewInSuite(folderSuiteId) : createNew()}
              onQuickCreate={(n) => quickCreate(n, folderSuiteId)}
              onDuplicateCase={duplicateCase}
            />
          )}
        </section>

        {activeCase && (
          <TestCaseDrawer testCase={activeCase} projectId={projectId}
            suiteName={activeCaseSuiteName ?? undefined}
            suitePath={activeCaseSuitePath}
            displayIdx={activeCase.display_seq ?? undefined}
            displayPrefix="TC"
            onClose={() => setActiveCase(null)}
            onEdit={() => editCaseNav(activeCase.id)}
            onDelete={() => deleteCase(activeCase.id)}
            onUpdated={(u) => { setCases((p) => p.map((c) => c.id === u.id ? u : c)); setActiveCase(u); }} />
        )}
      </div>

      <CreateSuiteModal open={suiteModalOpen} projectId={projectId!} initial={editSuite}
        parentId={suiteModalParentId} suites={suites} onClose={closeSuiteModal}
        onSaved={() => { closeSuiteModal(); reload(); }} />

      {/* ── Delete suite modal ── */}
      {deleteSuiteId && (() => {
        const suite = suitesById.get(deleteSuiteId);
        const descendantIds = getDescendantIds(deleteSuiteId);
        const affectedCount = cases.filter((c) => c.test_suite_id && descendantIds.includes(c.test_suite_id)).length;
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ width: 500 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Удалить сьют «{suite?.name}»</h2>
                <button className="btn-icon" onClick={() => setDeleteSuiteId(null)}>✕</button>
              </div>
              <div style={{ padding: "16px 20px" }}>
                {affectedCount > 0 && (
                  <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
                    В этом сьюте (включая вложенные) {affectedCount} тест-кейс{affectedCount === 1 ? "" : affectedCount < 5 ? "а" : "ов"}. Выберите, что с ними сделать:
                  </p>
                )}
                {affectedCount === 0 && (
                  <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
                    Тест-кейсов нет. Сьют и все его дочерние подсьюты будут удалены.
                  </p>
                )}
                {affectedCount > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
                      <input type="radio" name="dsAction" value="no_suite" style={{ marginTop: 2 }}
                        checked={deleteSuiteAction === "no_suite"}
                        onChange={() => setDeleteSuiteAction("no_suite")} />
                      <div>
                        <div style={{ fontWeight: 600 }}>Удалить сьют и все дочерние подсьюты, тест-кейсы перенести в «Без сьюта»</div>
                        <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                          Все {affectedCount} тест-кейс{affectedCount === 1 ? "" : affectedCount < 5 ? "а" : "ов"} из этого сьюта и всех дочерних подсьютов останутся в проекте в разделе «Без сьюта». Сам сьют и все подсьюты — удаляются.
                        </div>
                      </div>
                    </label>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
                      <input type="radio" name="dsAction" value="delete_cases" style={{ marginTop: 2 }}
                        checked={deleteSuiteAction === "delete_cases"}
                        onChange={() => setDeleteSuiteAction("delete_cases")} />
                      <div>
                        <div style={{ fontWeight: 600, color: "#dc2626" }}>Удалить сьют, все дочерние подсьюты и все тест-кейсы внутри</div>
                        <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                          Все {affectedCount} тест-кейс{affectedCount === 1 ? "" : affectedCount < 5 ? "а" : "ов"}, сам сьют и все вложенные подсьюты будут удалены безвозвратно.
                        </div>
                      </div>
                    </label>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDeleteSuiteId(null)} disabled={deletingSuite}>Отмена</button>
                <button
                  className="btn btn-primary"
                  style={{ background: "#dc2626", borderColor: "#dc2626" }}
                  disabled={deletingSuite}
                  onClick={confirmDeleteSuite}
                >
                  {deletingSuite ? "Удаляем…" : "Удалить сьют"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Bulk delete suites modal ── */}
      {bulkDeleteSuitesOpen && (() => {
        const rootIds = getRootSelectedSuiteIds(selectedSuiteIds);
        const affectedCount = bulkDeleteAffectedCount;
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ width: 500 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Удалить {rootIds.length} сьют{rootIds.length === 1 ? "" : rootIds.length < 5 ? "а" : "ов"}</h2>
                <button className="btn-icon" onClick={() => setBulkDeleteSuitesOpen(false)}>✕</button>
              </div>
              <div style={{ padding: "16px 20px" }}>
                {affectedCount > 0 ? (
                  <>
                    <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
                      В выбранных сьютах (включая вложенные) {affectedCount} тест-кейс{affectedCount === 1 ? "" : affectedCount < 5 ? "а" : "ов"}. Выберите, что с ними сделать:
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
                        <input type="radio" name="bulkDsAction" value="no_suite" style={{ marginTop: 2 }}
                          checked={bulkDeleteSuitesAction === "no_suite"}
                          onChange={() => setBulkDeleteSuitesAction("no_suite")} />
                        <div>
                          <div style={{ fontWeight: 600 }}>Удалить сьюты и все дочерние подсьюты, тест-кейсы перенести в «Без сьюта»</div>
                          <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                            Все {affectedCount} тест-кейс{affectedCount === 1 ? "" : affectedCount < 5 ? "а" : "ов"} останутся в проекте в разделе «Без сьюта». Сами сьюты и все подсьюты — удаляются.
                          </div>
                        </div>
                      </label>
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
                        <input type="radio" name="bulkDsAction" value="delete_cases" style={{ marginTop: 2 }}
                          checked={bulkDeleteSuitesAction === "delete_cases"}
                          onChange={() => setBulkDeleteSuitesAction("delete_cases")} />
                        <div>
                          <div style={{ fontWeight: 600, color: "#dc2626" }}>Удалить сьюты, все дочерние подсьюты и все тест-кейсы внутри</div>
                          <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                            Все {affectedCount} тест-кейс{affectedCount === 1 ? "" : affectedCount < 5 ? "а" : "ов"}, сами сьюты и все вложенные подсьюты будут удалены безвозвратно.
                          </div>
                        </div>
                      </label>
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 0 }}>
                    Тест-кейсов нет. Выбранные сьюты и все их дочерние подсьюты будут удалены.
                  </p>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setBulkDeleteSuitesOpen(false)} disabled={bulkDeletingSuites}>Отмена</button>
                <button
                  className="btn btn-primary"
                  style={{ background: "#dc2626", borderColor: "#dc2626" }}
                  disabled={bulkDeletingSuites}
                  onClick={confirmBulkDeleteSuites}
                >
                  {bulkDeletingSuites ? "Удаляем…" : "Удалить"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Export suite modal ── */}
      {exportSuiteId && (() => {
        const suite = suitesById.get(exportSuiteId);
        return (
          <div className="modal-backdrop" onClick={() => setExportSuiteId(null)}>
            <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Экспорт сьюта «{suite?.name}»</h2>
                <button className="btn-icon" onClick={() => setExportSuiteId(null)}>✕</button>
              </div>
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
                  Сьют (включая вложенные подсьюты и тест-кейсы) будет экспортирован в файл для последующего импорта.
                </p>
                {[
                  { key: "4qa", label: "4QA", desc: "Формат для импорта обратно в 4QA TMS" },
                  { key: "qase", label: "QASE", desc: "Формат для импорта в Qase.io" },
                  { key: "both", label: "Оба формата", desc: "Скачать оба файла" },
                ].map((opt) => (
                  <label key={opt.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
                    <input type="radio" name="exportFmt" value={opt.key} style={{ marginTop: 2 }}
                      checked={exportFmt === opt.key}
                      onChange={() => setExportFmt(opt.key as "4qa" | "qase" | "both")} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{opt.label}</div>
                      <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setExportSuiteId(null)} disabled={exporting}>Отмена</button>
                <button className="btn btn-primary" disabled={exporting} onClick={doExportSuite}>
                  {exporting ? "Экспортируем…" : "Экспортировать"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Tree view: Case group section ────────────────────────────────────────────

function TreeCaseGroup({ title, description, cases, suiteId, sectionId,
  isCollapsed, onToggle, onAddCase, onAddChildSuite, onEditSuite, onDeleteSuite,
  onCaseClick, onQuickCreate, totalCount, children,
  selectedCases, onToggleSelect, onSelectAll, onRenameCase, onReorder, onDuplicateCase,
  onEditCase, onDeleteCase }: {
  title: string; description?: string | null; cases: TestCase[];
  suiteId: string | null; sectionId?: string;
  isCollapsed: boolean; onToggle: () => void;
  onAddCase: () => void; onAddChildSuite?: () => void;
  onEditSuite?: () => void; onDeleteSuite?: () => void;
  onCaseClick: (c: TestCase) => void;
  onQuickCreate: (name: string) => void;
  totalCount?: number;
  children?: React.ReactNode;
  selectedCases?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelectAll?: (ids: string[], select: boolean) => void;
  onRenameCase?: (id: string, newName: string) => void;
  onReorder?: (newOrder: TestCase[]) => void;
  onDuplicateCase?: (id: string) => void;
  onEditCase?: (id: string) => void;
  onDeleteCase?: (id: string) => void;
}) {
  const [quickCreating, setQuickCreating] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [localCases, setLocalCases] = useState<TestCase[]>(cases);
  const dragIdx = useRef<number | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const allGroupIds = localCases.map((c) => c.id);
  const selectedInGroup = allGroupIds.filter((id) => selectedCases?.has(id)).length;
  const allGroupSelected = allGroupIds.length > 0 && selectedInGroup === allGroupIds.length;
  const someGroupSelected = selectedInGroup > 0 && !allGroupSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someGroupSelected;
  }, [someGroupSelected]);

  // Sync when cases prop changes (reload)
  useEffect(() => { setLocalCases(cases); }, [cases]);

  useEffect(() => { if (quickCreating) inputRef.current?.focus(); }, [quickCreating]);

  const submitQuick = async () => {
    if (!quickTitle.trim()) { setQuickCreating(false); setQuickTitle(""); return; }
    await onQuickCreate(quickTitle.trim());
    setQuickTitle(""); setQuickCreating(false);
  };

  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const next = [...localCases];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(idx, 0, moved);
    dragIdx.current = idx;
    setLocalCases(next);
  };
  const handleDrop = () => {
    if (onReorder) onReorder(localCases);
    dragIdx.current = null;
  };

  return (
    <div id={sectionId} className="case-group">
      <div className="case-group-head" onClick={onToggle}>
        <span className="case-group-toggle">{isCollapsed ? "▶" : "▾"}</span>
        {onToggleSelect && allGroupIds.length > 0 && (
          <span
            className="case-group-select-all"
            onClick={(e) => { e.stopPropagation(); onSelectAll?.(allGroupIds, !allGroupSelected); }}
          >
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allGroupSelected}
              onChange={() => {}}
              style={{ cursor: "pointer", accentColor: "var(--color-accent)" }}
            />
          </span>
        )}
        <span className="case-group-title">{title}</span>
        {(totalCount ?? cases.length) > 0 && <span className="case-group-count">{totalCount ?? cases.length}</span>}
        <div className="case-group-actions" onClick={(e) => e.stopPropagation()}>
          <button className="btn-icon case-group-act-case" title="Добавить тест-кейс в сьют" onClick={onAddCase}>
            <IconPlus />
          </button>
          {onAddChildSuite && (
            <button className="btn-icon case-group-act-suite" title="Добавить дочерний сьют" onClick={onAddChildSuite}>
              <IconFolderPlus />
            </button>
          )}
          {onEditSuite && <button className="btn-icon" title="Edit suite" onClick={onEditSuite}><IconPencil /></button>}
          <button className="btn-icon" disabled title="Duplicate"><IconCopy /></button>
          {onDeleteSuite && <button className="btn-icon btn-icon-danger" title="Delete suite" onClick={onDeleteSuite}><IconTrash /></button>}
        </div>
      </div>
      {description && <div className="case-group-desc">{description}</div>}
      {!isCollapsed && (
        <>
          <ul className="case-list">
            {localCases.map((c, idx) => (
              <TreeCaseRow key={c.id} c={c} onClick={() => onCaseClick(c)}
                selected={selectedCases?.has(c.id) ?? false}
                onToggleSelect={onToggleSelect ? () => onToggleSelect(c.id) : undefined}
                onRename={onRenameCase ? (name) => onRenameCase(c.id, name) : undefined}
                onDuplicate={onDuplicateCase ? () => onDuplicateCase(c.id) : undefined}
                onEdit={onEditCase ? () => onEditCase(c.id) : undefined}
                onDelete={onDeleteCase ? () => onDeleteCase(c.id) : undefined}
                draggable={!!onReorder}
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={handleDrop}
              />
            ))}
          </ul>
          <div className="case-quick-area">
            {quickCreating ? (
              <div className="case-quick-input-wrap">
                <input ref={inputRef} className="case-quick-input" placeholder="Test case title"
                  value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitQuick(); if (e.key === "Escape") { setQuickCreating(false); setQuickTitle(""); } }}
                  onBlur={submitQuick} />
              </div>
            ) : (
              <button className="case-quick-create" onClick={() => setQuickCreating(true)}>
                + Create quick test
              </button>
            )}
          </div>
          {children}
        </>
      )}
    </div>
  );
}

// ── Tree case row ─────────────────────────────────────────────────────────────

function TreeCaseRow({ c, onClick, selected, onToggleSelect, onRename, onDuplicate, onEdit, onDelete,
  draggable, onDragStart, onDragOver, onDrop }: {
  c: TestCase; onClick: () => void;
  selected?: boolean; onToggleSelect?: () => void;
  onRename?: (newName: string) => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(c.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const startEdit = (e: React.MouseEvent) => {
    if (!onRename) return;
    e.stopPropagation();
    setNameVal(c.name);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commit = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== c.name && onRename) onRename(trimmed);
    setEditing(false);
  };

  return (
    <li
      className={"case-row" + (selected ? " case-row--selected" : "")}
      onClick={editing ? undefined : onClick}
      style={selected ? { background: "var(--color-accent-soft)" } : undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {draggable && (
        <span className="case-drag-handle" title="Перетащить для изменения порядка">⠿</span>
      )}
      {onToggleSelect && (
        <span onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          style={{ paddingRight: 4, display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={!!selected} onChange={() => {}} style={{ cursor: "pointer", accentColor: "var(--color-accent)" }} />
        </span>
      )}
      <CaseStatusIcon status={c.status} />
      <span className="case-status-dash" style={{ color: c.priority === "high" ? "#dc2626" : "#9ca3af" }}>
        {PRIORITY_ICON[c.priority] ?? "—"}
      </span>
      <span className="case-auto-icon" title={c.automation_status}>{AUTO_ICON[c.automation_status] ?? "👤"}</span>
      <span className="case-id">TC-{c.display_seq ?? "?"}</span>
      {c.layer !== "not_set" && LAYER_META[c.layer] && (
        <span className="case-layer-badge" data-layer={c.layer}>
          {LAYER_META[c.layer].label}
        </span>
      )}
      {editing ? (
        <input
          ref={inputRef}
          className="case-quick-input"
          style={{ flex: 1, fontSize: 12, minWidth: 80, maxWidth: 320 }}
          value={nameVal}
          autoFocus
          onChange={(e) => setNameVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className={`case-name${c.status === "deprecated" ? " case-name--deprecated" : ""}`} onDoubleClick={startEdit} title={onRename ? "Двойной клик — переименовать" : undefined}>
          {c.name}
        </span>
      )}
      {(onDuplicate || onEdit || onDelete) && (
        <div className="case-row-menu-wrap" ref={menuRef} onClick={(e) => e.stopPropagation()}>
          <button
            className="case-row-menu-btn btn-icon"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            title="Действия"
          >⋯</button>
          {menuOpen && (
            <div className="case-row-dropdown">
              {onEdit && (
                <button className="case-row-dd-item" onClick={() => { onEdit(); setMenuOpen(false); }}>
                  <IconPencil /> Редактировать
                </button>
              )}
              {onDuplicate && (
                <button className="case-row-dd-item" onClick={() => { onDuplicate(); setMenuOpen(false); }}>
                  <IconCopy /> Дублировать
                </button>
              )}
              {onDelete && (
                <>
                  <div className="case-row-dd-sep" />
                  <button className="case-row-dd-item case-row-dd-item--danger" onClick={() => { onDelete(); setMenuOpen(false); }}>
                    <IconTrash /> Удалить
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── Folder right panel ────────────────────────────────────────────────────────

function FolderRightPanel({ suite, breadcrumb, subSuites, cases, casesBySuite, activeSuiteId, onOpenFolder,
  onCaseClick, onEditSuite, onDeleteSuite, onCreateSuite, onCreateCase, onQuickCreate, onDuplicateCase }: {
  suite: TestSuite | null; breadcrumb: { id: string; name: string }[]; subSuites: TestSuite[]; cases: TestCase[];
  casesBySuite: Record<string, TestCase[]>; activeSuiteId: string | null;
  onOpenFolder: (id: string | null) => void; onCaseClick: (c: TestCase) => void;
  onEditSuite: (s: TestSuite) => void; onDeleteSuite: (id: string) => void;
  onCreateSuite: (pid?: string | null) => void; onCreateCase: () => void;
  onQuickCreate: (name: string) => void;
  onDuplicateCase?: (id: string) => void;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quickCreating, setQuickCreating] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isRoot = !activeSuiteId || activeSuiteId === "__none__";

  useEffect(() => { if (quickCreating) inputRef.current?.focus(); }, [quickCreating]);
  useEffect(() => { const close = () => setContextOpen(false); if (contextOpen) document.addEventListener("click", close); return () => document.removeEventListener("click", close); }, [contextOpen]);

  const toggleSelect = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allIds = cases.map((c) => c.id);

  const submitQuick = async () => {
    if (!quickTitle.trim()) { setQuickCreating(false); setQuickTitle(""); return; }
    await onQuickCreate(quickTitle.trim()); setQuickTitle(""); setQuickCreating(false);
  };

  return (
    <div className="folder-panel">
      {/* Header */}
      <div className="folder-panel-head">
        {!isRoot && (
          <button className="folder-head-back" onClick={() => onOpenFolder(suite?.parent_id ?? null)}>←</button>
        )}
        <span className="folder-head-title">{isRoot ? "All cases" : (suite?.name ?? "Folder")}</span>
        {!isRoot && suite && (
          <div className="folder-head-menu-wrap" onClick={(e) => e.stopPropagation()}>
            <button className="btn-icon folder-head-dots" onClick={() => setContextOpen((v) => !v)}>⋯</button>
            {contextOpen && (
              <div className="folder-context-menu">
                <button className="folder-ctx-item" onClick={() => { onCreateCase(); setContextOpen(false); }}>
                  <IconPlus /> Create test case
                </button>
                <button className="folder-ctx-item" onClick={() => { onCreateSuite(activeSuiteId); setContextOpen(false); }}>
                  <IconFolderPlus /> Create suite
                </button>
                <div className="folder-ctx-sep" />
                <button className="folder-ctx-item" onClick={() => { onEditSuite(suite); setContextOpen(false); }}>
                  <IconPencil /> Edit
                </button>
                <button className="folder-ctx-item" disabled>
                  <IconCopy /> Duplicate
                </button>
                <div className="folder-ctx-sep" />
                <button className="folder-ctx-item folder-ctx-del" onClick={() => { onDeleteSuite(suite.id); setContextOpen(false); }}>
                  <IconTrash /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Breadcrumbs */}
      {!isRoot && breadcrumb.length > 0 && (
        <div className="folder-breadcrumb">
          <span className="folder-breadcrumb-item folder-breadcrumb-link" onClick={() => onOpenFolder(null)}>All cases</span>
          {breadcrumb.map((b, idx) => (
            <React.Fragment key={b.id}>
              <span className="folder-breadcrumb-sep">/</span>
              {idx === breadcrumb.length - 1 ? (
                <span className="folder-breadcrumb-item">{b.name}</span>
              ) : (
                <span className="folder-breadcrumb-item folder-breadcrumb-link" onClick={() => onOpenFolder(b.id)}>{b.name}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Suite description */}
      {!isRoot && suite?.description && (
        <div className="folder-desc">{suite.description}</div>
      )}

      {/* Cases */}
      {cases.length > 0 && (
        <>
          <div className="folder-select-all-row">
            <input type="checkbox" className="folder-check"
              checked={selectAll} onChange={(e) => { setSelectAll(e.target.checked); setSelected(e.target.checked ? new Set(allIds) : new Set()); }} />
            <span className="folder-select-all-label">Select all</span>
          </div>
          {cases.map((c) => (
            <div key={c.id} className="folder-row folder-row-case" onClick={() => onCaseClick(c)}>
              <div className="folder-row-dots">⋮</div>
              <input type="checkbox" className="folder-check" checked={selected.has(c.id)}
                onChange={() => toggleSelect(c.id)} onClick={(e) => e.stopPropagation()} />
              <CaseStatusIcon status={c.status} />
              <span className="case-status-dash" style={{ color: c.priority === "high" ? "#dc2626" : "#9ca3af" }}>
                {PRIORITY_ICON[c.priority] ?? "—"}
              </span>
              <span className="case-auto-icon">{AUTO_ICON[c.automation_status] ?? "👤"}</span>
              <span className="folder-case-id">TC-{c.display_seq ?? "?"}</span>
              {c.layer !== "not_set" && LAYER_META[c.layer] && (
                <span className="case-layer-badge" data-layer={c.layer}>
                  {LAYER_META[c.layer].label}
                </span>
              )}
              <span className={`folder-row-name${c.status === "deprecated" ? " case-name--deprecated" : ""}`}>{c.name}</span>
              {onDuplicateCase && (
                <button
                  className="btn-icon folder-case-dup-btn"
                  title="Дублировать кейс"
                  onClick={(e) => { e.stopPropagation(); onDuplicateCase(c.id); }}
                  style={{ marginLeft: "auto", opacity: 0, transition: "opacity 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
                >
                  <IconCopy />
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {/* Quick create */}
      <div className="case-quick-area folder-quick-area">
        {quickCreating ? (
          <div className="case-quick-input-wrap">
            <input ref={inputRef} className="case-quick-input" placeholder="Test case title"
              value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitQuick(); if (e.key === "Escape") { setQuickCreating(false); setQuickTitle(""); } }}
              onBlur={submitQuick} />
          </div>
        ) : (
          <button className="folder-quick-btn" onClick={() => setQuickCreating(true)}>
            + Quick test
          </button>
        )}
      </div>

      {/* Sub-folder rows */}
      {subSuites.map((s) => {
        const count = (casesBySuite[s.id] ?? []).length;
        return (
          <div key={s.id} className="folder-row" onClick={() => onOpenFolder(s.id)}>
            <div className="folder-row-dots">⋮</div>
            <input type="checkbox" className="folder-check" onClick={(e) => e.stopPropagation()} onChange={() => {}} />
            <span className="folder-icon">📁</span>
            <span className="folder-row-name">{s.name}</span>
            {count > 0 && <span className="folder-row-count">{count}</span>}
            <div className="folder-row-actions">
              <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onEditSuite(s); }}>✎</button>
              <button className="btn-icon btn-icon-danger" onClick={(e) => { e.stopPropagation(); onDeleteSuite(s.id); }}>🗑</button>
            </div>
          </div>
        );
      })}

      {isRoot && cases.length === 0 && subSuites.length === 0 && (
        <div className="folder-empty">No cases or suites yet.</div>
      )}
    </div>
  );
}

// ── SuiteTreeNode ─────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: SuiteNode; depth: number; viewType: ViewType;
  casesBySuite: Record<string, TestCase[]>; activeSuiteId: string | null;
  suiteMenuId: string | null; collapsed: Set<string>;
  onToggleCollapse: (id: string) => void; onSetActive: (id: string) => void;
  onOpenMenu: (id: string, e: React.MouseEvent) => void; onCloseMenu: () => void;
  onEdit: (s: TestSuite) => void; onDelete: (id: string) => void;
  onCreateSuite: (pid: string) => void; onCreateCase: (sid: string) => void;
  onDragStartSuite: (id: string) => void; onDropSuite: (id: string) => void;
  onExport: (id: string) => void;
  selectMode?: boolean; selectedIds?: Set<string>; onToggleSelect?: (id: string) => void;
}

function SuiteTreeNode({ node, depth, viewType, casesBySuite, activeSuiteId, suiteMenuId,
  collapsed, onToggleCollapse, onSetActive, onOpenMenu, onCloseMenu, onEdit, onDelete, onCreateSuite, onCreateCase,
  onDragStartSuite, onDropSuite, onExport, selectMode, selectedIds, onToggleSelect }: TreeNodeProps) {
  const count = countSuiteCases(node, casesBySuite);
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;
  const isFolders = viewType === "folders";

  return (
    <>
      <li className={`suite-node${activeSuiteId === node.id ? " is-active" : ""}${isFolders ? " suite-node-folder" : ""}${depth > 0 ? " suite-node-child" : ""}`}
        style={{ paddingLeft: 14 + depth * 16 }} onClick={() => onSetActive(node.id)}
        draggable={!selectMode}
        onDragStart={(e) => { e.stopPropagation(); onDragStartSuite(node.id); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropSuite(node.id); }}>
        {selectMode ? (
          <input type="checkbox" className="suite-select-check" checked={selectedIds?.has(node.id) ?? false}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect?.(node.id)} />
        ) : (
          <span className="suite-drag-handle" title="Перетащить для изменения порядка" onClick={(e) => e.stopPropagation()}>⠿</span>
        )}
        {isFolders ? (
          <>
            {hasChildren
              ? <button className="suite-caret-btn" onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.id); }}>{isCollapsed ? "▶" : "▼"}</button>
              : <span className="suite-caret-leaf" />}
            <span className="suite-folder-icon">📁</span>
          </>
        ) : (
          <span className="suite-caret" onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleCollapse(node.id); }}>
            {hasChildren ? (isCollapsed ? "▶" : "▾") : ""}
          </span>
        )}
        <span className="suite-name">{node.name}</span>
        <span className="suite-count">{count}</span>
        <div className="suite-menu-wrap" onClick={(e) => e.stopPropagation()}>
          <button className="btn-icon suite-more-btn" onClick={(e) => onOpenMenu(node.id, e)}>⋯</button>
          {suiteMenuId === node.id && (
            <div className="suite-dropdown">
              <button className="suite-dropdown-item" onClick={() => { onEdit(node); onCloseMenu(); }}>✎ Edit</button>
              <button className="suite-dropdown-item" disabled>🗗 Clone</button>
              <div className="suite-dropdown-sep" />
              <button className="suite-dropdown-item" onClick={() => { onCreateSuite(node.id); onCloseMenu(); }}>+ Create suite</button>
              <button className="suite-dropdown-item" onClick={() => { onCreateCase(node.id); onCloseMenu(); }}>+ Create case</button>
              <div className="suite-dropdown-sep" />
              <button className="suite-dropdown-item" onClick={() => { onExport(node.id); onCloseMenu(); }}>⬇ Экспортировать</button>
              <div className="suite-dropdown-sep" />
              <button className="suite-dropdown-item suite-dropdown-delete" onClick={() => { onDelete(node.id); onCloseMenu(); }}>🗑 Delete</button>
            </div>
          )}
        </div>
      </li>
      {!isCollapsed && node.children.map((child) => (
        <SuiteTreeNode key={child.id} node={child} depth={depth + 1} viewType={viewType}
          casesBySuite={casesBySuite} activeSuiteId={activeSuiteId} suiteMenuId={suiteMenuId}
          collapsed={collapsed} onToggleCollapse={onToggleCollapse} onSetActive={onSetActive}
          onOpenMenu={onOpenMenu} onCloseMenu={onCloseMenu} onEdit={onEdit} onDelete={onDelete}
          onCreateSuite={onCreateSuite} onCreateCase={onCreateCase}
          onDragStartSuite={onDragStartSuite} onDropSuite={onDropSuite} onExport={onExport}
          selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
      ))}
    </>
  );
}

// ── Tiny SVG icons ────────────────────────────────────────────────────────────
function IconPencil() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconCopy()   { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>; }
function IconTrash()  { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>; }
function IconPlus()   { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IconFolderPlus() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>; }

// ── Multi-select dropdown filter ─────────────────────────────────────────────
function MultiSelectDrop({
  label, options, selected, onChange,
}: {
  label: string;
  options: { value: string; label: string; indent?: number }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const isActive = selected.length > 0;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className={`btn${isActive ? " btn-filter-active" : ""}`}
        style={{ fontSize: 12, padding: "4px 10px", whiteSpace: "nowrap" }}
        onClick={() => setOpen((v) => !v)}
      >
        {label}{isActive ? ` (${selected.length})` : ""} ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "var(--color-bg)", border: "1px solid var(--color-border)",
          borderRadius: 6, minWidth: 160, maxHeight: 260, overflowY: "auto",
          boxShadow: "0 4px 14px rgba(0,0,0,0.1)",
        }}>
          {options.map((opt) => (
            <label key={opt.value} style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: `6px 12px 6px ${12 + (opt.indent ?? 0) * 14}px`,
              cursor: "pointer", fontSize: 12,
              background: selected.includes(opt.value) ? "var(--color-accent-soft)" : "transparent",
              transition: "background 0.1s",
            }}
              onMouseEnter={(e) => { if (!selected.includes(opt.value)) (e.currentTarget as HTMLElement).style.background = "var(--color-bg-soft)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = selected.includes(opt.value) ? "var(--color-accent-soft)" : "transparent"; }}
            >
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} style={{ flexShrink: 0 }} />
              <span style={{ color: "var(--color-text)" }}>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Filter panel (used in mobile "Filters" modal) ──────────────────────────────
function RepoFilterPanel({
  suites, filterStatus, setFilterStatus, filterSuiteIds, setFilterSuiteIds,
  filterTypes, setFilterTypes, filterPriorities, setFilterPriorities,
  filterAutoStatus, setFilterAutoStatus, filterLayer, setFilterLayer,
}: {
  suites: TestSuite[];
  filterStatus: string[]; setFilterStatus: (v: string[]) => void;
  filterSuiteIds: string[]; setFilterSuiteIds: (v: string[]) => void;
  filterTypes: string[]; setFilterTypes: (v: string[]) => void;
  filterPriorities: string[]; setFilterPriorities: (v: string[]) => void;
  filterAutoStatus: string[]; setFilterAutoStatus: (v: string[]) => void;
  filterLayer: string[]; setFilterLayer: (v: string[]) => void;
}) {
  const toggle = (list: string[], setList: (v: string[]) => void, val: string) =>
    setList(list.includes(val) ? list.filter((v) => v !== val) : [...list, val]);

  return (
    <div className="repo-filter-panel">
      <div className="repo-fp-group">
        <div className="repo-fp-title">Status</div>
        {(CASE_STATUS as readonly string[]).map((s) => (
          <label key={s} className="repo-fp-item">
            <input type="checkbox" checked={filterStatus.includes(s)}
              onChange={() => toggle(filterStatus, setFilterStatus, s)} />
            <span>{s.replace(/_/g, " ")}</span>
          </label>
        ))}
      </div>
      <div className="repo-fp-group">
        <div className="repo-fp-title">Type</div>
        {(CASE_TYPE as readonly string[]).map((t) => (
          <label key={t} className="repo-fp-item">
            <input type="checkbox" checked={filterTypes.includes(t)}
              onChange={() => toggle(filterTypes, setFilterTypes, t)} />
            <span>{t.replace(/_/g, " ")}</span>
          </label>
        ))}
      </div>
      <div className="repo-fp-group">
        <div className="repo-fp-title">Priority</div>
        {(PRIORITY as readonly string[]).map((p) => (
          <label key={p} className="repo-fp-item">
            <input type="checkbox" checked={filterPriorities.includes(p)}
              onChange={() => toggle(filterPriorities, setFilterPriorities, p)} />
            <span>{p.replace(/_/g, " ")}</span>
          </label>
        ))}
      </div>
      <div className="repo-fp-group">
        <div className="repo-fp-title">Automation</div>
        {(AUTOMATION_STATUS as readonly string[]).map((a) => (
          <label key={a} className="repo-fp-item">
            <input type="checkbox" checked={filterAutoStatus.includes(a)}
              onChange={() => toggle(filterAutoStatus, setFilterAutoStatus, a)} />
            <span>{a.replace(/_/g, " ")}</span>
          </label>
        ))}
      </div>
      <div className="repo-fp-group">
        <div className="repo-fp-title">Layer</div>
        {(LAYER as readonly string[]).map((l) => (
          <label key={l} className="repo-fp-item">
            <input type="checkbox" checked={filterLayer.includes(l)}
              onChange={() => toggle(filterLayer, setFilterLayer, l)} />
            <span>{l === "not_set" ? "Not set" : l.toUpperCase()}</span>
          </label>
        ))}
      </div>
      <div className="repo-fp-group">
        <div className="repo-fp-title">Suite</div>
        {suites.length === 0 && <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No suites</span>}
        {suites.map((s) => (
          <label key={s.id} className="repo-fp-item">
            <input type="checkbox" checked={filterSuiteIds.includes(s.id)}
              onChange={() => toggle(filterSuiteIds, setFilterSuiteIds, s.id)} />
            <span>{s.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── MindMapView ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  actual: "#16a34a", draft: "#64748b", deprecated: "#be123c", review: "#d97706",
};
const PRIORITY_NODE_COLOR: Record<string, string> = {
  high: "#dc2626", medium: "#ca8a04", low: "#6b7280", not_set: "#94a3b8",
};

function MindMapView({
  suites,
  cases,
  onCaseClick,
  activeCase,
}: {
  suites: TestSuite[];
  cases: TestCase[];
  onCaseClick: (c: TestCase) => void;
  activeCase: TestCase | null;
}) {
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const CX = 700, CY = 400, R1 = 220, R2 = 140;

  // Build hierarchy
  const rootSuites = useMemo(() => suites.filter((s) => !s.parent_id), [suites]);
  const casesBySuite = useMemo(() => {
    const m = new Map<string | null, TestCase[]>();
    for (const c of cases) {
      const key = c.test_suite_id ?? null;
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return m;
  }, [cases]);

  // Compute node positions
  const suiteNodes = useMemo(() => {
    const total = rootSuites.length || 1;
    return rootSuites.map((s, i) => {
      const angle = ((i / total) * 2 * Math.PI) - Math.PI / 2;
      return {
        suite: s,
        x: CX + R1 * Math.cos(angle),
        y: CY + R1 * Math.sin(angle),
        angle,
      };
    });
  }, [rootSuites]);

  const caseNodes = useMemo(() => {
    const nodes: { tc: TestCase; x: number; y: number; suiteX: number; suiteY: number }[] = [];
    for (const { suite, x: sx, y: sy, angle: sa } of suiteNodes) {
      const suiteCases = casesBySuite.get(suite.id) ?? [];
      const total = suiteCases.length;
      suiteCases.forEach((tc, i) => {
        const spread = Math.min(Math.PI * 0.7, Math.max(0.4, total * 0.28));
        const cAngle = total > 1
          ? sa + (i / (total - 1) - 0.5) * spread
          : sa;
        nodes.push({
          tc,
          x: sx + R2 * Math.cos(cAngle),
          y: sy + R2 * Math.sin(cAngle),
          suiteX: sx,
          suiteY: sy,
        });
      });
    }
    const orphans = casesBySuite.get(null) ?? [];
    orphans.forEach((tc, i) => {
      const angle = ((i / Math.max(orphans.length, 1)) * 2 * Math.PI) - Math.PI / 2;
      nodes.push({
        tc,
        x: CX + (R1 + R2 + 30) * Math.cos(angle),
        y: CY + (R1 + R2 + 30) * Math.sin(angle),
        suiteX: CX,
        suiteY: CY,
      });
    });
    return nodes;
  }, [suiteNodes, casesBySuite]);

  // Pan handlers
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest(".mm-node-case, .mm-node-suite")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setTransform((t) => ({
      ...t,
      x: dragStart.current.tx + (e.clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.clientY - dragStart.current.y),
    }));
  };
  const onMouseUp = () => setDragging(false);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((t) => ({ ...t, scale: Math.max(0.3, Math.min(3, t.scale * factor)) }));
  };

  return (
    <div className="mm-container" onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
      <div className="mm-toolbar">
        <button className="mm-ctrl-btn" onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} title="Reset view">⌂ Reset</button>
        <button className="mm-ctrl-btn" onClick={() => setTransform((t) => ({ ...t, scale: Math.min(3, t.scale * 1.2) }))}>＋</button>
        <button className="mm-ctrl-btn" onClick={() => setTransform((t) => ({ ...t, scale: Math.max(0.3, t.scale * 0.8) }))}>－</button>
        <span className="mm-hint">Drag to pan · Scroll to zoom · Click case to open</span>
      </div>
      <svg
        ref={svgRef}
        className="mm-svg"
        viewBox="0 0 1400 800"
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
          {/* Root → Suite edges */}
          {suiteNodes.map(({ suite, x, y }) => (
            <path
              key={`re-${suite.id}`}
              d={`M${CX},${CY} Q${(CX + x) / 2},${CY} ${x},${y}`}
              stroke="var(--color-border-strong)"
              strokeWidth="2"
              fill="none"
              opacity="0.6"
            />
          ))}

          {/* Suite → Case edges */}
          {caseNodes.map(({ tc, x, y, suiteX, suiteY }) => (
            <path
              key={`ce-${tc.id}`}
              d={`M${suiteX},${suiteY} Q${(suiteX + x) / 2},${suiteY} ${x},${y}`}
              stroke="var(--color-border)"
              strokeWidth="1.5"
              fill="none"
              opacity="0.5"
            />
          ))}

          {/* Root node */}
          <g>
            <circle cx={CX} cy={CY} r={38} fill="var(--color-accent)" opacity="0.9" />
            <text x={CX} y={CY - 5} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700">Test</text>
            <text x={CX} y={CY + 10} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700">Cases</text>
          </g>

          {/* Suite nodes */}
          {suiteNodes.map(({ suite, x, y }) => {
            const count = (casesBySuite.get(suite.id) ?? []).length;
            return (
              <g key={suite.id} className="mm-node-suite" style={{ cursor: "default" }}>
                <rect x={x - 50} y={y - 16} width={100} height={32} rx={8}
                  fill="var(--color-accent)" opacity="0.85" />
                <text x={x} y={y - 2} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="600">
                  {suite.name.length > 14 ? suite.name.slice(0, 13) + "…" : suite.name}
                </text>
                <text x={x} y={y + 11} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="9">
                  {count} case{count !== 1 ? "s" : ""}
                </text>
              </g>
            );
          })}

          {/* Case nodes */}
          {caseNodes.map(({ tc, x, y }) => {
            const isActive = activeCase?.id === tc.id;
            const priColor = PRIORITY_NODE_COLOR[tc.priority ?? "not_set"];
            return (
              <g key={tc.id} className="mm-node-case"
                onClick={() => onCaseClick(tc)}
                style={{ cursor: "pointer" }}>
                <rect
                  x={x - 56} y={y - 14} width={112} height={28} rx={6}
                  fill={isActive ? "var(--color-accent)" : "var(--color-bg)"}
                  stroke={isActive ? "var(--color-accent)" : "var(--color-border-strong)"}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                <rect x={x - 56} y={y - 14} width={4} height={28} rx="3 0 0 3"
                  fill={priColor} />
                <text x={x - 44} y={y + 4} fill={isActive ? "#fff" : "var(--color-text)"}
                  fontSize="10" fontWeight="500">
                  {tc.name.length > 16 ? tc.name.slice(0, 15) + "…" : tc.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
