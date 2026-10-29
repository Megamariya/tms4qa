import {
  getStepExpectedResults, SEVERITY, CASE_TYPE,
  suitesApi, casesApi, plansApi, runsApi, requirementsApi, releasesApi,
  type TestSuite, type TestCase, type Project,
} from "../api/client";
import { inlineMedia } from "./media";

// ── Qase format mapping (export direction: 4QA → Qase) ───────────────────────

export const PRIORITY_TO_QASE: Record<string, string> = { high: "high", medium: "medium", low: "low", not_set: "undefined" };
export const BEHAVIOR_TO_QASE: Record<string, string> = { positive: "positive", negative: "negative", destructive: "destructive", not_set: "undefined" };
export const AUTOMATION_TO_QASE: Record<string, string> = { manual: "is-not-automated", to_be_automated: "to-be-automated", automated: "automated" };
export const LAYER_TO_QASE: Record<string, string> = { e2e: "e2e", api: "api", unit: "unit", integration: "unknown", ui: "unknown", not_set: "unknown" };
export const QASE_STATUS = new Set(["actual", "draft", "deprecated"]);

function groupCasesBySuite(cases: TestCase[]): Record<string, TestCase[]> {
  const map: Record<string, TestCase[]> = {};
  for (const c of cases) {
    const key = c.test_suite_id ?? "__none__";
    (map[key] ||= []).push(c);
  }
  return map;
}

function buildQaseCase(c: TestCase, nextId: { v: number }) {
  return {
    id: nextId.v++,
    title: c.name,
    description: c.description ?? "",
    preconditions: c.pre_conditions ?? "",
    postconditions: c.post_conditions ?? "",
    priority: PRIORITY_TO_QASE[c.priority] ?? "undefined",
    severity: (SEVERITY as readonly string[]).includes(c.severity) ? c.severity : "normal",
    type: (CASE_TYPE as readonly string[]).includes(c.type) ? c.type : "other",
    behavior: BEHAVIOR_TO_QASE[c.behavior] ?? "undefined",
    automation: AUTOMATION_TO_QASE[c.automation_status] ?? "is-not-automated",
    status: QASE_STATUS.has(c.status) ? c.status : "draft",
    is_flaky: c.is_flaky ? "yes" : "no",
    layer: LAYER_TO_QASE[c.layer] ?? "unknown",
    milestone: null,
    custom_fields: [],
    steps_type: "classic",
    steps: (c.steps ?? []).map((s, i) => ({
      position: i + 1,
      action: s.action ?? "",
      expected_result: getStepExpectedResults(s).join("\n"),
      data: s.data ?? "",
      steps: [],
    })),
    tags: c.tags ?? [],
    params: [],
    is_muted: c.muted ? "yes" : "no",
  };
}

function buildQaseSuiteNode(suite: TestSuite, allSuites: TestSuite[], casesBySuite: Record<string, TestCase[]>, nextId: { v: number }): Record<string, unknown> {
  return {
    id: nextId.v++,
    title: suite.name,
    description: suite.description ?? "",
    preconditions: "",
    suites: allSuites.filter((s) => s.parent_id === suite.id).map((s) => buildQaseSuiteNode(s, allSuites, casesBySuite, nextId)),
    cases: (casesBySuite[suite.id] ?? []).map((c) => buildQaseCase(c, nextId)),
  };
}

// Build the qase_sample.json-shaped tree from 4QA suites + cases (whole project)
export function buildQaseExport(suites: TestSuite[], cases: TestCase[]) {
  const nextId = { v: 1 };
  const casesBySuite = groupCasesBySuite(cases);
  const roots = suites.filter((s) => !s.parent_id).map((s) => buildQaseSuiteNode(s, suites, casesBySuite, nextId));
  const orphanCases = casesBySuite["__none__"] ?? [];
  if (orphanCases.length > 0) {
    roots.push({
      id: nextId.v++,
      title: "Без сьюта",
      description: "",
      preconditions: "",
      suites: [],
      cases: orphanCases.map((c) => buildQaseCase(c, nextId)),
    });
  }
  return roots;
}

// Build the qase_sample.json-shaped tree for a single suite (+ its descendants)
export function buildQaseExportForSuite(suite: TestSuite, allSuites: TestSuite[], allCases: TestCase[]) {
  const nextId = { v: 1 };
  const casesBySuite = groupCasesBySuite(allCases);
  return [buildQaseSuiteNode(suite, allSuites, casesBySuite, nextId)];
}

// ── 4QA backup format (export direction: 4QA → 4QA, for re-import) ───────────

// Build a 4QA backup payload containing a suite and all its descendant suites + cases
export function build4qaExportForSuite(suite: TestSuite, allSuites: TestSuite[], allCases: TestCase[], projectId: string, projectName: string) {
  const subtreeIds = new Set<string>([suite.id]);
  const queue: string[] = [suite.id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const s of allSuites) {
      if (s.parent_id === current && !subtreeIds.has(s.id)) {
        subtreeIds.add(s.id);
        queue.push(s.id);
      }
    }
  }
  const subtreeSuites = allSuites
    .filter((s) => subtreeIds.has(s.id))
    .map((s) => (s.id === suite.id ? { ...s, parent_id: null } : s));
  const subtreeCases = allCases.filter((c) => c.test_suite_id && subtreeIds.has(c.test_suite_id));

  return {
    version: "1.0",
    exported_at: new Date().toISOString(),
    project_id: projectId,
    project_name: projectName,
    includes: { suites_cases: true, plans: false, runs: false },
    suites: subtreeSuites,
    cases: subtreeCases,
    plans: [],
    runs: [],
  };
}

// ── Full project export (4QA → 4QA, version 2.0, для бэкапа/импорта в новую систему) ──

// Собирает полный бэкап проекта: сьюты, кейсы, требования, релизы, планы, прогоны с результатами
export async function buildFullProjectExport(project: Project) {
  const [suites, cases, plans, runs, requirements, releases] = await Promise.all([
    suitesApi.list(project.id),
    casesApi.list(project.id),
    plansApi.list(project.id),
    runsApi.list(project.id),
    requirementsApi.list(project.id),
    releasesApi.list(project.id),
  ]);
  const plansWithCases = await Promise.all(plans.map(async (p) => {
    const cl = await plansApi.cases(p.id).catch(() => []);
    return { ...p, case_ids: cl.map((c) => c.id) };
  }));
  const runsWithResults = await Promise.all(runs.map(async (r) => {
    const results = await runsApi.results(r.id).catch(() => []);
    return { ...r, results };
  }));
  const reqsWithCases = await Promise.all(requirements.map(async (req) => {
    const tc = await requirementsApi.getTestCases(req.id).catch(() => []);
    return { ...req, case_ids: tc.map((c) => c.id) };
  }));
  // Картинки/видео (шаги кейсов, результаты прогонов) встраиваются как data-URL:
  // бэкап самодостаточен, при импорте бэкенд сам выгрузит их в MinIO
  return inlineMedia({
    version: "2.0",
    exported_at: new Date().toISOString(),
    project: {
      id: project.id, name: project.name, description: project.description,
      abbreviation: project.abbreviation, is_private: project.is_private,
    },
    suites, cases,
    requirements: reqsWithCases,
    releases,
    plans: plansWithCases,
    runs: runsWithResults,
  });
}

export function fullProjectExportFilename(project: Project): string {
  const dt = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
  return `4qa_full_${project.name.replace(/\s+/g, "_")}_${dt}.json`;
}

// ── Download helper ────────────────────────────────────────────────────────

export function downloadJSON(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
