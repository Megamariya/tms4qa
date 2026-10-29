import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  casesApi,
  plansApi,
  runsApi,
  suitesApi,
  type TestCase,
  type TestPlan,
  type TestPlanHistoryEntry,
  type TestResult,
  type TestRun,
  type TestRunStats,
  type TestSuite,
} from "../api/client";
import TestCaseDrawer from "../components/TestCaseDrawer";
import { useBackToClose } from "../hooks/useBackToClose";
import { useDragReorder, type DragHandleProps } from "../hooks/useDragReorder";
import TestPlanFormModal from "../components/TestPlanFormModal";
import { useToast } from "../components/Toast";
import { exportPlanBundle } from "../utils/transfer";
import { renderMarkdown } from "../utils/markdown";
import { downloadAsDoc, printHTML } from "../utils/testProtocol";
import "./TestPlanDetailPage.css";

const TABS = ["Details", "Test Cases", "Test runs", "Change History"] as const;
type Tab = (typeof TABS)[number];

function toPlanId(display_id: string) {
  return display_id.startsWith("R") ? "TP-" + display_id.slice(1) : display_id;
}

// ── Test Plan print form ───────────────────────────────────────────────────────

function generatePlanHtml(plan: TestPlan, cases: TestCase[], projectId: string): string {
  const cfg: Record<string, boolean> = (() => {
    try { return JSON.parse(localStorage.getItem("project_configurations") ?? "{}"); } catch { return {}; }
  })();
  const team: Array<{ name: string; role: string; email: string }> = (() => {
    try { return JSON.parse(localStorage.getItem(`team_${projectId}`) ?? "[]"); } catch { return []; }
  })();
  const repCfg: Record<string, string> = (() => {
    try {
      const s = JSON.parse(localStorage.getItem("reportStaticCfg") ?? "{}");
      return { productName: s.productName ?? "", releaseVersion: s.releaseVersion ?? "" };
    } catch { return {}; }
  })();
  const signatories: Array<{ role: string; name: string }> = (() => {
    try { return JSON.parse(localStorage.getItem(`tp_signatories_${projectId}`) ?? "[]"); } catch { return []; }
  })();

  const show = (key: string) => cfg[key] !== false;
  const planId = toPlanId(plan.display_id);
  const today = new Date().toLocaleDateString("ru-RU");
  const blank = (n = 1) => Array(n).fill('<div class="blank-line"></div>').join("");
  const sec = (num: number, title: string, content: string) =>
    `<div class="section"><h2>${num}. ${title}</h2>${content}</div>`;

  const approvalRows = signatories.length > 0
    ? signatories.map((s) => `<tr><td>${s.role}</td><td>${s.name}</td><td></td><td></td></tr>`).join("")
    : team.length > 0
      ? team.map((m) => `<tr><td>${m.role}</td><td>${m.name}</td><td></td><td></td></tr>`).join("")
      : "<tr><td></td><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td><td></td></tr>";

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>Test Plan — ${planId} ${plan.name}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:15mm;color:#111}
  h1{font-size:16px;margin-bottom:4px}
  h2{font-size:13px;border-bottom:1px solid #bbb;padding-bottom:4px;margin:18px 0 8px;color:#1d4ed8}
  .meta-table{border-collapse:collapse;margin-bottom:16px}
  .meta-table td{padding:2px 12px 2px 0;font-size:11px}
  .meta-table td:first-child{font-weight:600;color:#333;white-space:nowrap}
  .section{margin-bottom:20px}
  p{margin:4px 0;line-height:1.5}
  .blank-line{border-bottom:1px solid #aaa;height:22px;margin:6px 0}
  table{width:100%;border-collapse:collapse;font-size:11px;margin:6px 0}
  th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}
  th{background:#f3f4f6;font-weight:600}
  @page{size:A4 portrait;margin:15mm}
  @media print{body{margin:0}}
</style></head><body>
<h1>${plan.name}</h1>
<table class="meta-table">
  <tr><td>Идентификатор:</td><td>${planId}</td></tr>
  <tr><td>Статус:</td><td>${plan.status}</td></tr>
  ${repCfg.productName ? `<tr><td>Продукт:</td><td>${repCfg.productName}</td></tr>` : ""}
  ${repCfg.releaseVersion ? `<tr><td>Версия:</td><td>${repCfg.releaseVersion}</td></tr>` : ""}
  ${plan.start_date ? `<tr><td>Дата начала:</td><td>${plan.start_date}</td></tr>` : ""}
  ${plan.end_date ? `<tr><td>Дата окончания:</td><td>${plan.end_date}</td></tr>` : ""}
  <tr><td>Дата печати:</td><td>${today}</td></tr>
  <tr><td>Тест-кейсов:</td><td>${cases.length}</td></tr>
</table>

${show("cfg_tp_s1") ? sec(1, "Общая информация", `
<table>
  <tr><th>Параметр</th><th>Значение</th></tr>
  <tr><td>Название проекта</td><td>${repCfg.productName ?? ""}</td></tr>
  <tr><td>Версия</td><td>${repCfg.releaseVersion ?? ""}</td></tr>
  <tr><td>Идентификатор плана</td><td>${planId}</td></tr>
  <tr><td>Название плана</td><td>${plan.name}</td></tr>
  <tr><td>Автор</td><td>${team.find((m) => m.role === "QA Lead")?.name ?? ""}</td></tr>
  <tr><td>Дата составления</td><td>${today}</td></tr>
  <tr><td>Дата начала</td><td>${plan.start_date ?? ""}</td></tr>
  <tr><td>Дата окончания</td><td>${plan.end_date ?? ""}</td></tr>
  <tr><td>Цель</td><td>${plan.description ?? ""}</td></tr>
</table>`) : ""}

${show("cfg_tp_s2") ? sec(2, "Scope", `
<p><strong>In Scope (в рамках тестирования):</strong></p>
${blank(3)}
<p style="margin-top:10px"><strong>Out of Scope (вне рамок тестирования):</strong></p>
${blank(3)}`) : ""}

${show("cfg_tp_s3") ? sec(3, "Test Objectives", `<p>Цели данного тест-плана:</p>${blank(4)}`) : ""}

${show("cfg_tp_s4") ? sec(4, "Test Items", cases.length > 0 ? `
<table>
  <tr><th>#</th><th>Название тест-кейса</th></tr>
  ${cases.map((c, i) => `<tr><td>${i + 1}</td><td>${c.name}</td></tr>`).join("")}
</table>` : blank(4)) : ""}

${show("cfg_tp_s5") ? sec(5, "Типы тестирования", `
<table>
  <tr><th>Тип тестирования</th><th>Применяется</th><th>Описание</th></tr>
  <tr><td>Функциональное</td><td></td><td></td></tr>
  <tr><td>Нагрузочное</td><td></td><td></td></tr>
  <tr><td>Регрессионное</td><td></td><td></td></tr>
  <tr><td>Интеграционное</td><td></td><td></td></tr>
  <tr><td>UI/UX</td><td></td><td></td></tr>
  <tr><td>Безопасности</td><td></td><td></td></tr>
  <tr><td>API</td><td></td><td></td></tr>
</table>`) : ""}

${show("cfg_tp_s6") ? sec(6, "Test Strategy", `<p><strong>Подход к тестированию:</strong></p>${blank(3)}<p style="margin-top:8px"><strong>Методология:</strong></p>${blank(2)}`) : ""}

${show("cfg_tp_s7") ? sec(7, "Test Environment", `
<table>
  <tr><th>Параметр</th><th>Значение</th></tr>
  <tr><td>Окружения</td><td></td></tr>
  <tr><td>Браузеры</td><td></td></tr>
  <tr><td>Устройства</td><td></td></tr>
  <tr><td>Операционные системы</td><td></td></tr>
  <tr><td>База данных</td><td></td></tr>
</table>`) : ""}

${show("cfg_tp_s8") ? sec(8, "Entry Criteria", `<p>Критерии начала тестирования:</p>${blank(3)}`) : ""}

${show("cfg_tp_s9") ? sec(9, "Exit Criteria", `<p>Критерии завершения тестирования:</p>${blank(3)}`) : ""}

${show("cfg_tp_s10") ? sec(10, "Test Deliverables", `
<table>
  <tr><th>Артефакт</th><th>Описание</th><th>Срок</th></tr>
  <tr><td>Тест-план</td><td></td><td></td></tr>
  <tr><td>Протокол тестирования</td><td></td><td></td></tr>
  <tr><td>Акт тестирования</td><td></td><td></td></tr>
  <tr><td>Отчёт о дефектах</td><td></td><td></td></tr>
</table>`) : ""}

${show("cfg_tp_s11") ? sec(11, "Roles & Responsibilities", `
<table>
  <tr><th>Участник</th><th>Роль</th><th>Email</th><th>Ответственность</th></tr>
  ${team.length > 0
    ? team.map((m) => `<tr><td>${m.name}</td><td>${m.role}</td><td>${m.email}</td><td></td></tr>`).join("")
    : "<tr><td></td><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td><td></td></tr>"}
</table>`) : ""}

${show("cfg_tp_s12") ? sec(12, "Defect Management", `
<table>
  <tr><th>Параметр</th><th>Описание</th></tr>
  <tr><td>Инструмент</td><td>TMS4QA Defects</td></tr>
  <tr><td>Приоритеты</td><td>Critical / High / Medium / Low</td></tr>
  <tr><td>Severity</td><td>Blocker / Critical / Major / Normal / Minor / Trivial</td></tr>
  <tr><td>Процесс</td><td></td></tr>
</table>`) : ""}

${show("cfg_tp_s13") ? sec(13, "Risks & Mitigation", `
<table>
  <tr><th>#</th><th>Риск</th><th>Вероятность</th><th>Влияние</th><th>Меры снижения</th></tr>
  <tr><td>1</td><td></td><td></td><td></td><td></td></tr>
  <tr><td>2</td><td></td><td></td><td></td><td></td></tr>
  <tr><td>3</td><td></td><td></td><td></td><td></td></tr>
</table>`) : ""}

${show("cfg_tp_s14") ? sec(14, "Test Schedule", `
<table>
  <tr><th>Этап</th><th>Дата начала</th><th>Дата окончания</th><th>Ответственный</th></tr>
  <tr><td>Подготовка тест-плана</td><td></td><td></td><td></td></tr>
  <tr><td>Проектирование тест-кейсов</td><td></td><td></td><td></td></tr>
  <tr><td>Выполнение тестирования</td><td>${plan.start_date ?? ""}</td><td>${plan.end_date ?? ""}</td><td></td></tr>
  <tr><td>Составление отчёта</td><td></td><td></td><td></td></tr>
</table>`) : ""}

${show("cfg_tp_s15") ? sec(15, "Metrics", `
<table>
  <tr><th>Метрика</th><th>Целевое значение</th><th>Фактическое</th></tr>
  <tr><td>Процент покрытия требований</td><td></td><td></td></tr>
  <tr><td>Pass Rate</td><td></td><td></td></tr>
  <tr><td>Количество тест-кейсов</td><td>${cases.length}</td><td></td></tr>
  <tr><td>Критичных дефектов</td><td>0</td><td></td></tr>
</table>`) : ""}

${show("cfg_tp_s16") ? sec(16, "Approvals", `
<table>
  <tr><th>Роль</th><th>ФИО</th><th>Дата</th><th>Подпись</th></tr>
  ${approvalRows}
</table>`) : ""}

${plan.references ? `<div class="section"><h2>Ссылки / References</h2><p>${plan.references.replace(/\n/g, "<br>")}</p></div>` : ""}

</body></html>`;
}

function printTestPlan(plan: TestPlan, cases: TestCase[], projectId: string) {
  const html = generatePlanHtml(plan, cases, projectId);
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html.replace("</body>", "<script>window.onload=()=>{window.print();}<\/script></body>"));
  w.document.close();
}

export default function TestPlanDetailPage() {
  const { projectId, planId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [plan, setPlan] = useState<TestPlan | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("Details");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeCase, setActiveCase] = useState<TestCase | null>(null);
  useBackToClose(activeCase !== null, () => setActiveCase(null));
  // avg time_spent_ms per test_case_id across completed runs
  const [avgDurations, setAvgDurations] = useState<Map<string, number>>(new Map());

  // ── Start run modal ──
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runName, setRunName] = useState("");
  const [runDesc, setRunDesc] = useState("");
  const [runEnv, setRunEnv] = useState("");

  // ── Add Cases modal ──
  const [addCasesOpen, setAddCasesOpen] = useState(false);
  const [allProjectCases, setAllProjectCases] = useState<TestCase[]>([]);

  const openAddCases = () => {
    if (!projectId) return;
    casesApi.list(projectId).then(setAllProjectCases).catch(() => {});
    setAddCasesOpen(true);
  };

  const handleAddCases = async (newIds: string[]) => {
    if (!planId || !plan) return;
    const existingIds = cases.map((c) => c.id);
    const merged = [...new Set([...existingIds, ...newIds])];
    try {
      await plansApi.setCases(planId, merged);
      toast.success(`Добавлено кейсов: ${newIds.length}`);
      setAddCasesOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add cases");
    }
  };

  const handleRemoveCases = async (removeIds: string[]) => {
    if (!planId) return;
    const remaining = cases.map((c) => c.id).filter((id) => !removeIds.includes(id));
    try {
      await plansApi.setCases(planId, remaining);
      toast.success(`Удалено из плана: ${removeIds.length}`);
      setSelected(new Set());
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    }
  };

  const reload = () => {
    if (!planId || !projectId) return;
    Promise.all([
      plansApi.get(planId),
      plansApi.cases(planId),
      suitesApi.list(projectId),
      runsApi.list(projectId, planId),
    ])
      .then(([p, c, s, r]) => {
        setPlan(p);
        setCases(c);
        setSuites(s);
        setRuns(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  };

  useEffect(reload, [planId, projectId]);

  // Порядок кейсов в плане хранится на бэкенде (testplan_cases.position) — тот же
  // порядок наследуют прогоны (TestResult.sequence) и используется на странице прогона.
  const persistCaseOrder = useCallback(
    async (newOrder: string[]) => {
      if (!planId) return;
      const byId = new Map(cases.map((c) => [c.id, c]));
      const prevCases = cases;
      setCases(newOrder.map((id) => byId.get(id)).filter((c): c is TestCase => !!c));
      try {
        await plansApi.setCases(planId, newOrder);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to reorder");
        setCases(prevCases);
      }
    },
    [planId, cases, toast]
  );

  const caseIds = useMemo(() => cases.map((c) => c.id), [cases]);
  const { containerRef: casesDragRef, order: dragOrder, draggingId: draggingCaseId, getHandleProps: getCaseHandleProps } =
    useDragReorder(caseIds, persistCaseOrder);

  // Кнопки ▲/▼: пошаговое перемещение с "перепрыгиванием" через соседний suite-блок,
  // если кейс — единственный в своём suite (иначе он не мог бы никуда сдвинуться).
  const moveCase = (caseId: string, dir: -1 | 1) => {
    const baseOrder = cases.map((c) => c.id);
    const idx = baseOrder.indexOf(caseId);
    if (idx < 0) return;

    const suiteLookup = (id: string) => cases.find((c) => c.id === id)?.test_suite_id ?? "__none__";
    const currentSuite = suiteLookup(caseId);
    const suiteItems = baseOrder.filter((id) => suiteLookup(id) === currentSuite);
    const isOnlyInSuite = suiteItems.length === 1;

    let targetIdx = idx + dir;
    if (isOnlyInSuite) {
      // Skip over the whole adjacent suite block to move the lone case past it
      if (dir === -1 && idx > 0) {
        const prevSuite = suiteLookup(baseOrder[idx - 1]);
        let start = idx - 1;
        while (start > 0 && suiteLookup(baseOrder[start - 1]) === prevSuite) start--;
        targetIdx = start;
      } else if (dir === 1 && idx < baseOrder.length - 1) {
        const nextSuite = suiteLookup(baseOrder[idx + 1]);
        let end = idx + 1;
        while (end < baseOrder.length - 1 && suiteLookup(baseOrder[end + 1]) === nextSuite) end++;
        targetIdx = end;
      }
    }

    if (targetIdx < 0 || targetIdx >= baseOrder.length) return;
    const next = [...baseOrder];
    next.splice(idx, 1);
    next.splice(targetIdx, 0, caseId);
    persistCaseOrder(next);
  };

  // Load results for all completed runs to compute avg duration per test case
  useEffect(() => {
    const completedRuns = runs.filter((r) => r.status === "completed");
    if (!completedRuns.length) { setAvgDurations(new Map()); return; }
    Promise.all(completedRuns.map((r) => runsApi.results(r.id))).then((allResults) => {
      const totals = new Map<string, { sum: number; count: number }>();
      for (const results of allResults) {
        for (const res of results) {
          if (!res.time_spent_ms || res.time_spent_ms <= 0) continue;
          const prev = totals.get(res.test_case_id) ?? { sum: 0, count: 0 };
          totals.set(res.test_case_id, { sum: prev.sum + res.time_spent_ms, count: prev.count + 1 });
        }
      }
      const avgs = new Map<string, number>();
      totals.forEach(({ sum, count }, id) => avgs.set(id, Math.round(sum / count)));
      setAvgDurations(avgs);
    }).catch(() => {});
  }, [runs]);

  const remove = async () => {
    if (!plan || !confirm(`Удалить план «${plan.name}»?`)) return;
    try {
      await plansApi.delete(plan.id);
      toast.success("План удалён");
      navigate(`/project/${projectId}/plans`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const openRunModal = () => {
    const now = new Date();
    const date = now.toLocaleDateString("ru-RU");
    const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setRunName(`${plan?.name ?? "Test Run"} — ${date} ${time}`);
    setRunDesc("");
    setRunEnv("");
    setRunModalOpen(true);
  };

  const confirmRun = async () => {
    if (!plan || !projectId) return;
    try {
      const run = await runsApi.create({
        project_id: projectId,
        test_plan_id: plan.id,
        name: runName.trim() || `Test Run ${new Date().toLocaleDateString("ru-RU")}`,
        description: runDesc.trim() || undefined,
        environment: runEnv.trim() || undefined,
        test_case_ids: cases.map((c) => c.id),
      });
      toast.success(`Прогон «${run.name}» создан и готов к запуску`);
      setRunModalOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start run");
    }
  };

  const suitesById = useMemo(() => new Map(suites.map((s) => [s.id, s])), [suites]);

  // Живой порядок (учитывает drag в процессе перетаскивания, иначе совпадает с cases)
  const orderedCases = useMemo(() => {
    const byId = new Map(cases.map((c) => [c.id, c]));
    return dragOrder.map((id) => byId.get(id)).filter((c): c is TestCase => !!c);
  }, [dragOrder, cases]);

  const filtered = useMemo(() => {
    if (!search) return orderedCases;
    const q = search.toLowerCase();
    return orderedCases.filter((c) => c.name.toLowerCase().includes(q));
  }, [orderedCases, search]);

  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  };

  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [exportOpen]);

  const handleExport = (action: "docx" | "pdf" | "print") => {
    if (!plan || !projectId) return;
    const html = generatePlanHtml(plan, cases, projectId);
    if (action === "docx") {
      downloadAsDoc(html, `test_plan_${toPlanId(plan.display_id)}.doc`);
    } else {
      printHTML(html);
    }
    setExportOpen(false);
  };

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

  if (error) return <div className="page-banner" style={{ margin: 24 }}>⚠ {error}</div>;
  if (!plan) return <div className="page" style={{ padding: 40 }}>Загружаем…</div>;

  return (
    <div className="plan-detail">
      {/* ── Sticky top: header + tabs + (Test Cases) toolbar + bulk ── */}
      <div className="plan-sticky-top">
        <header className="plan-header">
          <h1 className="plan-title">
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", marginRight: 8, opacity: 0.8 }}>{toPlanId(plan.display_id)}</span>
            {plan.name}
          </h1>
          <div className="plan-header-row">
            <button
              className="plan-back"
              onClick={() => navigate(`/project/${projectId}/plans`)}
              aria-label="Back"
            >
              ←
            </button>
            <div className="plan-actions">
              <button className="btn plan-desktop-only" title="Экспорт для переноса в другую TMS4QA (JSON)"
                onClick={() => exportPlanBundle(plan.id, `${plan.display_id}_${plan.name}`)
                  .then(() => toast.success("План выгружен"))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Export failed"))}>
                ⬇ Export
              </button>
              {tab === "Test runs" && runs.length > 0 && (
                <button className="btn btn-primary" onClick={openRunModal}>
                  Create Run
                </button>
              )}
              {tab === "Test Cases" && (
                <>
                  <button className="btn plan-desktop-only" disabled={selected.size === 0}>
                    👤 Assign
                  </button>
                  <button className="btn plan-desktop-only" disabled={selected.size === 0}>
                    🙋 Assign to me
                  </button>
                  <button className="btn plan-desktop-only" disabled={selected.size === 0}>
                    ⤺ Unassign
                  </button>
                  <select className="input plan-mobile-only plan-assign-select" disabled={selected.size === 0} defaultValue="">
                    <option value="" disabled>👤 Assign</option>
                    <option value="me">🙋 Assign to me</option>
                    <option value="unassign">⤺ Unassign</option>
                  </select>
                  <button className="btn-icon plan-mobile-only" title="Filters" aria-label="Filters">⚙</button>
                  <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={openAddCases}>
                    + Add Cases
                  </button>
                </>
              )}
              <div className="plan-export-toolbar" ref={exportRef}>
                <button className="btn-icon" onClick={() => setExportOpen((o) => !o)} title="Печать / Экспорт">
                  🖨
                </button>
                {exportOpen && (
                  <div className="tp-export-dropdown">
                    <button className="tp-export-item" onClick={() => handleExport("docx")}>📝 Экспортировать в *.docx</button>
                    <button className="tp-export-item" onClick={() => handleExport("pdf")}>📄 Экспортировать в PDF</button>
                    <button className="tp-export-item" onClick={() => handleExport("print")}>🖨 Печать</button>
                  </div>
                )}
              </div>
              <button className="btn-icon" onClick={() => setEditOpen(true)} title="Edit">
                ✎
              </button>
              <button className="btn-icon" onClick={remove} title="Delete">
                🗑
              </button>
            </div>
          </div>
        </header>

        {/* ── Tabs ── */}
        <nav className="plan-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={"plan-tab" + (tab === t ? " is-active" : "")}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Test Cases" && cases.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 11, background: "var(--color-accent-soft)", color: "var(--color-accent)", borderRadius: 10, padding: "1px 7px", fontWeight: 600 }}>
                  {cases.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* ── Test Cases: toolbar ── */}
        {tab === "Test Cases" && (
          <div className="plan-toolbar">
            <label className="plan-bulk-all">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select all
            </label>
            <input
              className="input"
              placeholder="Search for test cases"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 220 }}
            />
            <a className="filter-link plan-desktop-only">Add filter</a>
            {selected.size > 0 && (
              <button
                className="btn"
                style={{ marginLeft: "auto", fontSize: 12, color: "#dc2626", borderColor: "#dc2626" }}
                onClick={() => handleRemoveCases([...selected])}
              >
                🗑 Remove ({selected.size})
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Scrollable content ── */}
      <div className="plan-scroll-body">
        {tab === "Details" && (
          <DetailsTab plan={plan} />
        )}

        {tab === "Test Cases" && (
          <CasesTab
            cases={filtered}
            fullOrderedCases={orderedCases}
            suites={suites}
            selected={selected}
            setSelected={setSelected}
            onCaseClick={setActiveCase}
            onMoveCase={moveCase}
            avgDurations={avgDurations}
            dragContainerRef={casesDragRef}
            draggingId={draggingCaseId}
            getHandleProps={getCaseHandleProps}
          />
        )}

        {tab === "Test runs" && (
          <RunsTab
            runs={runs}
            plan={plan}
            search={search}
            setSearch={setSearch}
            onStart={openRunModal}
            projectId={projectId!}
          />
        )}

        {tab === "Change History" && (
          <ChangeHistoryTab planId={plan.id} />
        )}
      </div>

      {/* ── Test Case Drawer ── */}
      {activeCase && (
        <TestCaseDrawer
          testCase={activeCase}
          projectId={projectId}
          suiteName={suitesById.get(activeCase.test_suite_id ?? "")?.name}
          suitePath={activeCaseSuitePath}
          displayIdx={activeCase.display_seq ?? undefined}
          displayPrefix="TC"
          onClose={() => setActiveCase(null)}
          onUpdated={(u) => { setCases((prev) => prev.map((c) => c.id === u.id ? u : c)); setActiveCase(u); }}
        />
      )}

      {projectId && (
        <TestPlanFormModal
          open={editOpen}
          projectId={projectId}
          initial={plan}
          onClose={() => setEditOpen(false)}
          onSaved={() => { toast.success("Plan saved"); reload(); }}
        />
      )}

      {/* ── Add Cases modal ── */}
      {addCasesOpen && (
        <AddCasesModal
          allCases={allProjectCases}
          suites={suites}
          existingIds={new Set(cases.map((c) => c.id))}
          onClose={() => setAddCasesOpen(false)}
          onAdd={handleAddCases}
        />
      )}

      {/* Start a run modal */}
      {runModalOpen && (
        <div className="modal-backdrop" onClick={() => setRunModalOpen(false)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Create Run</h2>
              <button className="btn-icon" onClick={() => setRunModalOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="form-label">Run Name *</label>
                <input className="input" style={{ width: "100%" }} value={runName}
                  onChange={(e) => setRunName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="form-label">Environment</label>
                <input className="input" style={{ width: "100%" }} placeholder="e.g. staging, production, local"
                  value={runEnv} onChange={(e) => setRunEnv(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Description</label>
                <textarea className="input" style={{ width: "100%", height: 72, resize: "vertical" }}
                  placeholder="Optional notes about this run"
                  value={runDesc} onChange={(e) => setRunDesc(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRunModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmRun} disabled={!runName.trim()}>
                Create Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Details

function DetailsTab({ plan }: { plan: TestPlan }) {
  const meta: { label: string; value: string | null; markdown?: boolean }[] = [
    { label: "Description", value: plan.description ?? null, markdown: true },
    { label: "References", value: plan.references ?? null, markdown: true },
    { label: "Start Date", value: plan.start_date ?? null },
    { label: "End Date", value: plan.end_date ?? null },
  ].filter((m) => m.value);

  return (
    <div className="plan-details">
      {meta.length === 0 ? (
        <div className="plan-empty">No details yet.</div>
      ) : (
        meta.map((m) => (
          <div key={m.label} className="plan-detail-row">
            <div className="plan-detail-label">{m.label}</div>
            {m.markdown ? (
              <div
                className="plan-detail-value md-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.value!) }}
              />
            ) : (
              <div className="plan-detail-value">{m.value}</div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ─────────────────────────── Test Cases

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function CasesTab({
  cases,
  fullOrderedCases,
  suites,
  selected,
  setSelected,
  onCaseClick,
  onMoveCase,
  avgDurations,
  dragContainerRef,
  draggingId,
  getHandleProps,
}: {
  cases: TestCase[];
  fullOrderedCases: TestCase[];
  suites: TestSuite[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onCaseClick: (c: TestCase) => void;
  onMoveCase: (id: string, dir: -1 | 1) => void;
  avgDurations?: Map<string, number>;
  dragContainerRef: RefObject<HTMLDivElement>;
  draggingId: string | null;
  getHandleProps: (id: string) => DragHandleProps;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const byId = new Map(suites.map((s) => [s.id, s.name]));
    const map = new Map<string, { key: string; name: string; items: TestCase[] }>();
    for (const c of cases) {
      const key = c.test_suite_id ?? "__none__";
      const name = c.test_suite_id ? byId.get(c.test_suite_id) ?? "(deleted suite)" : "Without suite";
      const g = map.get(key) ?? { key, name, items: [] };
      g.items.push(c);
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [cases, suites]);

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div ref={dragContainerRef}>
      {cases.length === 0 && <div className="plan-empty">No test cases yet.</div>}

      {grouped.map((group) => {
        const isCollapsed = collapsedGroups.has(group.key);
        return (
          <div key={group.key} className="plan-group">
            <div className="plan-group-head" onClick={() => toggleGroup(group.key)} style={{ cursor: "pointer" }}>
              <span className="plan-group-caret">{isCollapsed ? "▶" : "▾"}</span>
              <input type="checkbox" onClick={(e) => e.stopPropagation()} onChange={() => {}} />
              <strong>{group.name}</strong>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: 6 }}>({group.items.length})</span>
            </div>
            {!isCollapsed && (
              <div className="plan-cases-table">
                <div className="plan-cases-th">
                  <span className="col-drag"></span>
                  <span className="col-check"></span>
                  <span className="col-id">ID</span>
                  <span className="col-title">Title</span>
                  <span className="col-assignee">Assignee</span>
                  <span className="col-duration">Expected duration</span>
                  <span className="col-order"></span>
                </div>
                {group.items.map((c, idx) => {
                  const globalIdx = fullOrderedCases.findIndex((x) => x.id === c.id);
                  return (
                  <div
                    key={c.id}
                    data-drag-id={c.id}
                    className={"plan-cases-row" + (draggingId === c.id ? " is-dragging" : "")}
                    style={{ cursor: "pointer" }}
                    onClick={() => onCaseClick(c)}
                  >
                    <span className="col-drag" title="Перетащить" {...getHandleProps(c.id)} onClick={(e) => e.stopPropagation()}>⠿</span>
                    <span className="col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </span>
                    <span className="col-id">{idx + 1}</span>
                    <span className="col-title" style={{ color: "var(--color-accent)" }}>{c.name}</span>
                    <span className="col-assignee">
                      <span className="assignee-empty">👤</span> Unassigned
                    </span>
                    <span className="col-duration">
                      {(() => {
                        const ms = avgDurations?.get(c.id) ?? 0;
                        return ms > 0 ? `⏱ ${fmtDuration(ms)}` : <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>—</span>;
                      })()}
                    </span>
                    <span className="col-order" onClick={(e) => e.stopPropagation()}>
                      <button className="plan-order-btn" title="Вверх"
                        disabled={globalIdx <= 0} onClick={() => onMoveCase(c.id, -1)}>▲</button>
                      <button className="plan-order-btn" title="Вниз"
                        disabled={globalIdx < 0 || globalIdx === fullOrderedCases.length - 1} onClick={() => onMoveCase(c.id, 1)}>▼</button>
                    </span>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────── Test Runs

function RunsTab({
  runs,
  plan,
  search,
  setSearch,
  onStart,
  projectId,
}: {
  runs: TestRun[];
  plan: TestPlan;
  search: string;
  setSearch: (v: string) => void;
  onStart: () => void;
  projectId: string;
}) {
  const [selectedRun, setSelectedRun] = useState<TestRun | null>(null);

  const filtered = useMemo(() => {
    if (!search) return runs;
    const q = search.toLowerCase();
    return runs.filter((r) => r.name.toLowerCase().includes(q));
  }, [runs, search]);

  return (
    <>
      <div className="plan-toolbar">
        <input
          className="input"
          placeholder="Search for test runs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
        <a className="filter-link">Add filter</a>
      </div>

      {filtered.length === 0 ? (
        <div className="plan-runs-empty">
          <EmptyRunsIllustration />
          <div className="plan-runs-empty-text">
            Looks like you don't have any test runs yet.
          </div>
          <button className="btn btn-primary" onClick={onStart}>
            Create Run
          </button>
        </div>
      ) : (
        <div className={`plan-runs-wrap${selectedRun ? " plan-runs-split" : ""}`}>
          <div className="plan-runs-list-col">
            {filtered.map((r) => (
              <div
                key={r.id}
                className={`plan-run-row plan-run-row--clickable${selectedRun?.id === r.id ? " is-selected" : ""}`}
                onClick={() => setSelectedRun(selectedRun?.id === r.id ? null : r)}
              >
                <div>
                  <strong>{r.name}</strong>
                  <div className="plan-run-sub">
                    Started {new Date(r.started_at).toLocaleString("ru-RU")}
                    {r.environment && ` · ${r.environment}`}
                  </div>
                </div>
                <span className={`badge badge-${runStatusBadge(r.status)}`}>
                  {RUN_STATUS_LABELS[r.status] ?? r.status}
                </span>
              </div>
            ))}
          </div>
          {selectedRun && (
            <RunSidebar
              run={selectedRun}
              plan={plan}
              projectId={projectId}
              onClose={() => setSelectedRun(null)}
            />
          )}
        </div>
      )}
    </>
  );
}

const RUN_STATUS_LABELS: Record<string, string> = {
  in_progress: "In Progress",
  completed: "Completed",
  aborted: "Aborted",
};

function runStatusBadge(s: TestRun["status"]) {
  switch (s) {
    case "completed": return "passed";
    case "in_progress": return "untested";
    case "aborted": return "failed";
  }
}

// ─────────────────────────── Run Sidebar

function RunSidebar({
  run,
  plan,
  projectId,
  onClose,
}: {
  run: TestRun;
  plan: TestPlan;
  projectId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [stats, setStats] = useState<TestRunStats | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    runsApi.stats(run.id).then(setStats).catch(() => {});
  }, [run.id]);

  const exportProtocol = async () => {
    setExporting(true);
    try {
      const [results, allCases, s] = await Promise.all([
        runsApi.results(run.id),
        casesApi.list(projectId),
        stats ?? runsApi.stats(run.id),
      ]);
      const caseMap = new Map(allCases.map((c) => [c.id, c]));
      const html = buildProtocolHtml(run, plan, s, results, caseMap);
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(html);
      w.document.close();
    } finally {
      setExporting(false);
    }
  };

  const pct = (n: number) =>
    stats && stats.total > 0 ? Math.round((n / stats.total) * 100) : 0;

  return (
    <div className="plan-run-sidebar">
      <div className="prs-header">
        <span className="prs-title">{run.name}</span>
        <button className="btn-icon" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="prs-body">
        <div className="prs-meta">
          <div className="prs-meta-row">
            <span className="prs-meta-label">Status</span>
            <span className={`badge badge-${runStatusBadge(run.status)}`}>
              {RUN_STATUS_LABELS[run.status] ?? run.status}
            </span>
          </div>
          {run.environment && (
            <div className="prs-meta-row">
              <span className="prs-meta-label">Environment</span>
              <span className="prs-meta-val">{run.environment}</span>
            </div>
          )}
          <div className="prs-meta-row">
            <span className="prs-meta-label">Started</span>
            <span className="prs-meta-val">
              {new Date(run.started_at).toLocaleString("ru-RU")}
            </span>
          </div>
          {run.started_by_name && (
            <div className="prs-meta-row">
              <span className="prs-meta-label">Executor</span>
              <span className="prs-meta-val">{run.started_by_name}</span>
            </div>
          )}
        </div>

        {stats && (
          <div className="prs-stats">
            <div className="prs-stats-title">Results</div>
            <div className="prs-stats-bar">
              {stats.passed > 0 && <div className="prs-seg prs-seg-passed" style={{ width: `${pct(stats.passed)}%` }} />}
              {stats.failed > 0 && <div className="prs-seg prs-seg-failed" style={{ width: `${pct(stats.failed)}%` }} />}
              {stats.blocked > 0 && <div className="prs-seg prs-seg-blocked" style={{ width: `${pct(stats.blocked)}%` }} />}
              {stats.skipped > 0 && <div className="prs-seg prs-seg-skipped" style={{ width: `${pct(stats.skipped)}%` }} />}
              {stats.untested > 0 && <div className="prs-seg prs-seg-untested" style={{ width: `${pct(stats.untested)}%` }} />}
            </div>
            <div className="prs-stats-pills">
              <span className="prs-pill prs-pill-passed">✓ {stats.passed} passed</span>
              <span className="prs-pill prs-pill-failed">✗ {stats.failed} failed</span>
              {stats.blocked > 0 && <span className="prs-pill prs-pill-blocked">⊘ {stats.blocked} blocked</span>}
              {stats.skipped > 0 && <span className="prs-pill prs-pill-skipped">↷ {stats.skipped} skipped</span>}
              <span className="prs-pill prs-pill-untested">○ {stats.untested} not run</span>
            </div>
            <div className="prs-total">Total: {stats.total} tests</div>
          </div>
        )}

        <div className="prs-actions">
          <button
            className="btn btn-secondary"
            style={{ width: "100%" }}
            onClick={() => navigate(`/project/${projectId}/run/${run.id}`)}
          >
            Open full run →
          </button>
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            onClick={exportProtocol}
            disabled={exporting}
          >
            🖨 Export Test Protocol (PDF)
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Protocol HTML builder

function buildProtocolHtml(
  run: TestRun,
  plan: TestPlan,
  stats: TestRunStats,
  results: TestResult[],
  caseMap: Map<string, TestCase>
): string {
  const STATUS_ICON: Record<string, string> = {
    passed: "✓", failed: "✗", blocked: "⊘", skipped: "↷",
    untested: "○", invalid: "!", in_progress: "▶", retest: "↺",
  };
  const STATUS_COLOR: Record<string, string> = {
    passed: "#16a34a", failed: "#dc2626", blocked: "#ca8a04",
    skipped: "#6b7280", untested: "#9ca3af", invalid: "#7c3aed",
    in_progress: "#2563eb", retest: "#0891b2",
  };

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString("ru-RU"); } catch { return "—"; }
  };

  const escH = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const rows = results.map((res, i) => {
    const tc = caseMap.get(res.test_case_id);
    const icon = STATUS_ICON[res.status] ?? "?";
    const color = STATUS_COLOR[res.status] ?? "#9ca3af";
    return `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${escH(tc?.name ?? res.test_case_id)}</td>
      <td style="color:${color};font-weight:700;text-align:center">${icon} ${escH(res.status)}</td>
      <td>${escH(res.actual_result ?? "—")}</td>
      <td>${escH(res.comment ?? "—")}</td>
      <td style="font-size:10px;color:#6b7280">${res.executed_at ? fmtDate(res.executed_at) : "—"}</td>
    </tr>`;
  }).join("");

  const passedPct = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Протокол тестирования — ${escH(run.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 20mm 15mm; }
  h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 13px; font-weight: 700; margin: 20px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .subtitle { font-size: 13px; color: #555; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 700; font-size: 10px; text-transform: uppercase; }
  .info-table td:first-child { width: 160px; font-weight: 600; background: #f9fafb; }
  .stat-row { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .stat-box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 14px; text-align: center; min-width: 80px; }
  .stat-box .n { font-size: 20px; font-weight: 700; }
  .stat-box .l { font-size: 10px; color: #6b7280; text-transform: uppercase; }
  .stat-passed .n { color: #16a34a; }
  .stat-failed .n { color: #dc2626; }
  .stat-blocked .n { color: #ca8a04; }
  .stat-skipped .n { color: #6b7280; }
  .stat-untested .n { color: #9ca3af; }
  .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; margin-bottom: 16px; display: flex; }
  .pb-passed { background: #16a34a; }
  .pb-failed { background: #dc2626; }
  .pb-blocked { background: #ca8a04; }
  .pb-skipped { background: #6b7280; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 40px; }
  .sig-box { border-top: 1px solid #111; padding-top: 6px; font-size: 10px; color: #555; }
  @media print { @page { margin: 15mm; } body { padding: 0; } }
</style>
</head>
<body>
<h1>Протокол тестирования</h1>
<div class="subtitle">${escH(run.name)}</div>

<h2>1. Общая информация</h2>
<table class="info-table">
  <tr><td>Тест-план</td><td>${escH(plan.name)}</td></tr>
  <tr><td>Тестовый прогон</td><td>${escH(run.name)}</td></tr>
  <tr><td>Статус</td><td>${escH(run.status)}</td></tr>
  <tr><td>Окружение</td><td>${escH(run.environment ?? "—")}</td></tr>
  <tr><td>Исполнитель</td><td>${escH(run.started_by_name ?? "—")}</td></tr>
  <tr><td>Дата начала</td><td>${fmtDate(run.started_at)}</td></tr>
  <tr><td>Дата завершения</td><td>${run.completed_at ? fmtDate(run.completed_at) : "—"}</td></tr>
  <tr><td>Описание</td><td>${escH(run.description ?? "—")}</td></tr>
  ${plan.references ? `<tr><td>References</td><td>${escH(plan.references)}</td></tr>` : ""}
</table>

<h2>2. Результаты тестирования</h2>
<div class="progress-bar">
  ${stats.passed > 0 ? `<div class="pb-passed" style="width:${passedPct}%"></div>` : ""}
  ${stats.failed > 0 ? `<div class="pb-failed" style="width:${Math.round(stats.failed / stats.total * 100)}%"></div>` : ""}
  ${stats.blocked > 0 ? `<div class="pb-blocked" style="width:${Math.round(stats.blocked / stats.total * 100)}%"></div>` : ""}
  ${stats.skipped > 0 ? `<div class="pb-skipped" style="width:${Math.round(stats.skipped / stats.total * 100)}%"></div>` : ""}
</div>
<div class="stat-row">
  <div class="stat-box"><div class="n">${stats.total}</div><div class="l">Total</div></div>
  <div class="stat-box stat-passed"><div class="n">${stats.passed}</div><div class="l">Passed</div></div>
  <div class="stat-box stat-failed"><div class="n">${stats.failed}</div><div class="l">Failed</div></div>
  <div class="stat-box stat-blocked"><div class="n">${stats.blocked}</div><div class="l">Blocked</div></div>
  <div class="stat-box stat-skipped"><div class="n">${stats.skipped}</div><div class="l">Skipped</div></div>
  <div class="stat-box stat-untested"><div class="n">${stats.untested}</div><div class="l">Not run</div></div>
</div>
<p style="font-size:11px;color:#555;margin-bottom:16px">Процент успешных тестов: <strong>${passedPct}%</strong></p>

<h2>3. Детали тестирования</h2>
<table>
  <thead>
    <tr>
      <th style="width:32px">#</th>
      <th>Тест-кейс</th>
      <th style="width:100px">Статус</th>
      <th>Фактический результат</th>
      <th>Комментарий</th>
      <th style="width:120px">Время</th>
    </tr>
  </thead>
  <tbody>${rows || "<tr><td colspan='6' style='text-align:center;color:#9ca3af'>Нет данных</td></tr>"}</tbody>
</table>

<h2>4. Заключение</h2>
<p style="margin-bottom:12px;line-height:1.6">
  По результатам выполнения тестового прогона «${escH(run.name)}» проверено <strong>${stats.total}</strong> тест-кейсов.
  Прошло успешно: <strong>${stats.passed}</strong> (${passedPct}%),
  провалено: <strong>${stats.failed}</strong>,
  заблокировано: <strong>${stats.blocked}</strong>,
  не выполнено: <strong>${stats.untested}</strong>.
</p>

<div class="sig-grid">
  <div class="sig-box">Тестировщик<br><br><br>______________________<br>Подпись / ФИО / Дата</div>
  <div class="sig-box">Ответственный<br><br><br>______________________<br>Подпись / ФИО / Дата</div>
</div>

<script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
}

function EmptyRunsIllustration() {
  return (
    <svg
      viewBox="0 0 200 140"
      width="200"
      height="140"
      fill="none"
      stroke="#9ca3af"
      strokeWidth="1.5"
      aria-hidden
    >
      <rect x="32" y="22" width="120" height="92" rx="6" />
      <line x1="32" y1="38" x2="152" y2="38" />
      <circle cx="42" cy="30" r="2" fill="#9ca3af" />
      <circle cx="50" cy="30" r="2" fill="#9ca3af" />
      <rect x="44" y="50" width="64" height="6" fill="#e5e7eb" stroke="none" />
      <rect x="44" y="62" width="44" height="6" fill="#e5e7eb" stroke="none" />
      <rect x="44" y="80" width="100" height="20" fill="#f3f4f6" stroke="#d1d5db" />
      <polyline points="50,94 60,86 70,90 80,82 90,88 100,80 110,84" stroke="#5a4cf0" />
      <circle cx="120" cy="40" r="14" fill="#dbeafe" stroke="#5a4cf0" />
      <path d="M114 40 l4 4 l8 -8" stroke="#5a4cf0" />
      <path d="M158 24 l6 6 m0 -6 l-6 6" />
      <circle cx="178" cy="56" r="3" />
    </svg>
  );
}

// ─────────────────────────── Change History Tab

const HISTORY_FIELD_LABELS: Record<string, string> = {
  name: "Название",
  description: "Описание",
  references: "References",
  status: "Статус",
  start_date: "Дата начала",
  end_date: "Дата окончания",
  milestone_id: "Milestone",
  release_id: "Release",
};

function fmtHistoryValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function historyActionLabel(action: string): string {
  if (action.endsWith(".create")) return "Создан";
  if (action.endsWith(".delete")) return "Удалён";
  return "Изменён";
}

function ChangeHistoryTab({ planId }: { planId: string }) {
  const [entries, setEntries] = useState<TestPlanHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    plansApi.history(planId)
      .then((data) => { if (!cancelled) setEntries(data); })
      .catch(() => { if (!cancelled) setError("Не удалось загрузить историю изменений"); });
    return () => { cancelled = true; };
  }, [planId]);

  if (error) return <div className="plan-empty">{error}</div>;
  if (entries === null) return <div className="plan-empty">Загрузка…</div>;
  if (entries.length === 0) return <div className="plan-empty">Изменений пока нет.</div>;

  return (
    <div className="tp-history">
      {entries.map((e) => (
        <div key={e.id} className="tp-history-item">
          <div className="tp-history-head">
            <span className="tp-history-action">{historyActionLabel(e.action)}</span>
            <span className="tp-history-actor">{e.actor_name || e.actor_email || "Неизвестный пользователь"}</span>
            <span className="tp-history-date">{new Date(e.created_at).toLocaleString("ru-RU")}</span>
          </div>
          {e.details && e.action.endsWith(".update") && (
            <table className="tp-history-diff">
              <thead><tr><th>Поле</th><th>Было</th><th>Стало</th></tr></thead>
              <tbody>
                {Object.entries(e.details as Record<string, { old: unknown; new: unknown }>).map(([field, ch]) => (
                  <tr key={field}>
                    <td>{HISTORY_FIELD_LABELS[field] ?? field}</td>
                    <td>{fmtHistoryValue(ch?.old)}</td>
                    <td>{fmtHistoryValue(ch?.new)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────── Add Cases Modal

function AddCasesModal({
  allCases,
  suites,
  existingIds,
  onClose,
  onAdd,
}: {
  allCases: TestCase[];
  suites: TestSuite[];
  existingIds: Set<string>;
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const suiteById = useMemo(() => new Map(suites.map((s) => [s.id, s])), [suites]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return allCases.filter((c) => !existingIds.has(c.id));
    // Collect all descendant suite IDs for any suite whose name matches the query
    const getDescendants = (suiteId: string, visited = new Set<string>()): Set<string> => {
      if (visited.has(suiteId)) return visited;
      visited.add(suiteId);
      for (const s of suites) {
        if (s.parent_id === suiteId) getDescendants(s.id, visited);
      }
      return visited;
    };
    const matchingSuiteIds = new Set<string>();
    for (const s of suites) {
      if (s.name.toLowerCase().includes(q)) {
        for (const id of getDescendants(s.id)) matchingSuiteIds.add(id);
      }
    }
    return allCases.filter((c) =>
      !existingIds.has(c.id) && (
        c.name.toLowerCase().includes(q) ||
        (c.test_suite_id != null && matchingSuiteIds.has(c.test_suite_id))
      )
    );
  }, [allCases, existingIds, search, suites]);

  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; name: string; items: TestCase[] }>();
    for (const c of filtered) {
      const key = c.test_suite_id ?? "__none__";
      const name = c.test_suite_id ? suiteById.get(c.test_suite_id)?.name ?? "(deleted suite)" : "Without suite";
      const g = map.get(key) ?? { key, name, items: [] };
      g.items.push(c);
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [filtered, suiteById]);

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleGroup2 = (items: TestCase[]) => {
    const ids = items.map((c) => c.id);
    const allChecked = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    if (allChecked) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    setSelected(next);
  };

  const allChecked = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 680, maxHeight: "80vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Add Test Cases to Plan</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Search test cases…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 140 }}
            autoFocus
          />
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0 }}>
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            Все ({filtered.length})
          </label>
          <button
            className="btn"
            style={{ fontSize: 11, padding: "3px 8px", flexShrink: 0 }}
            onClick={() => setCollapsedGroups(new Set(grouped.map((g) => g.key)))}
          >▶ Свернуть все</button>
          <button
            className="btn"
            style={{ fontSize: 11, padding: "3px 8px", flexShrink: 0 }}
            onClick={() => setCollapsedGroups(new Set())}
          >▾ Развернуть все</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {grouped.length === 0 && (
            <div style={{ padding: "24px 20px", color: "var(--color-text-muted)", fontSize: 13, textAlign: "center" }}>
              {search ? "Ничего не найдено." : "Все тест-кейсы уже добавлены в план."}
            </div>
          )}
          {grouped.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key);
            const groupAllChecked = group.items.every((c) => selected.has(c.id));
            return (
              <div key={group.key}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 20px", background: "var(--color-bg-soft)", borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                  onClick={() => toggleGroup(group.key)}
                >
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)", minWidth: 12 }}>{isCollapsed ? "▶" : "▾"}</span>
                  <input type="checkbox" checked={groupAllChecked} onChange={() => toggleGroup2(group.items)}
                    onClick={(e) => e.stopPropagation()} />
                  <strong style={{ fontSize: 12.5 }}>{group.name}</strong>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: 4 }}>({group.items.length})</span>
                </div>
                {!isCollapsed && group.items.map((c) => (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 20px 7px 44px", cursor: "pointer", borderBottom: "1px solid var(--color-border-light, #f0f0f0)" }}
                    onClick={() => toggleOne(c.id)}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)}
                      onClick={(e) => e.stopPropagation()} />
                    <span style={{ fontSize: 12.5, color: "var(--color-text)" }}>{c.name}</span>
                    {c.priority && (
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: "var(--color-bg-soft)", color: "var(--color-text-muted)", marginLeft: "auto", flexShrink: 0 }}>
                        {c.priority}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            );
          })}
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: 12, color: "var(--color-text-muted)", marginRight: "auto" }}>
            {selected.size > 0 ? `Выбрано: ${selected.size}` : "Выберите тест-кейсы"}
          </span>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
          <button
            className="btn btn-primary"
            onClick={() => onAdd([...selected])}
            disabled={selected.size === 0}
          >
            Добавить в план ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
