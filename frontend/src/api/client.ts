const API_BASE = "/api/v1";

// ── Token storage ──────────────────────────────────────────────────────────
export const tokenStore = {
  getAccess: (): string | null => localStorage.getItem("tms_access_token"),
  getRefresh: (): string | null => localStorage.getItem("tms_refresh_token"),
  set: (access: string, refresh: string) => {
    localStorage.setItem("tms_access_token", access);
    localStorage.setItem("tms_refresh_token", refresh);
  },
  clear: () => {
    localStorage.removeItem("tms_access_token");
    localStorage.removeItem("tms_refresh_token");
    localStorage.removeItem("tms_user");
    localStorage.removeItem("tms_active_org");
  },
};

// ── Active org context (SUPER_ADMIN org switching) ─────────────────────────
export const orgStore = {
  get: (): { id: string; name: string } | null => {
    try { const s = localStorage.getItem("tms_active_org"); return s ? JSON.parse(s) : null; } catch { return null; }
  },
  set: (id: string, name: string) => {
    localStorage.setItem("tms_active_org", JSON.stringify({ id, name }));
    window.dispatchEvent(new CustomEvent("tms:orgchange", { detail: { id, name } }));
  },
  clear: () => {
    localStorage.removeItem("tms_active_org");
    window.dispatchEvent(new CustomEvent("tms:orgchange", { detail: null }));
  },
};

let _refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    const rt = tokenStore.getRefresh();
    if (!rt) return false;
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) { tokenStore.clear(); return false; }
      const data = await res.json();
      tokenStore.set(data.access_token, data.refresh_token);
      if (data.user) localStorage.setItem("tms_user", JSON.stringify(data.user));
      return true;
    } catch { tokenStore.clear(); return false; }
  })();
  _refreshing.finally(() => { _refreshing = null; });
  return _refreshing;
}

async function request<T>(path: string, init?: RequestInit, _retry = false): Promise<T> {
  const token = tokenStore.getAccess();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // SUPER_ADMIN: attach active org context
  try {
    const u = localStorage.getItem("tms_user");
    if (u && JSON.parse(u)?.role === "SUPER_ADMIN") {
      const org = orgStore.get();
      if (org?.id) headers["X-Org-Id"] = org.id;
    }
  } catch { /* ignore */ }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    ...init,
  });

  if (res.status === 401 && !_retry) {
    const ok = await tryRefresh();
    if (ok) return request<T>(path, init, true);
    // Redirect to login (skip if already there)
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} on ${path}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: "DELETE" }),
};

// ── Enums (зеркалят backend/app/models/enums.py) ──

export const SEVERITY = [
  "blocker",
  "critical",
  "major",
  "normal",
  "minor",
  "trivial",
] as const;
export const PRIORITY = ["high", "medium", "low", "not_set"] as const;
export const CASE_STATUS = ["actual", "draft", "deprecated", "review"] as const;
export const CASE_TYPE = [
  "functional",
  "smoke",
  "regression",
  "security",
  "performance",
  "usability",
  "acceptance",
  "other",
] as const;
export const BEHAVIOR = ["positive", "negative", "destructive", "not_set"] as const;
export const LAYER = ["unit", "integration", "e2e", "api", "ui", "not_set"] as const;
export const AUTOMATION_STATUS = ["manual", "to_be_automated", "automated"] as const;

export type Severity = (typeof SEVERITY)[number];
export type Priority = (typeof PRIORITY)[number];
export type CaseStatus = (typeof CASE_STATUS)[number];
export type CaseType = (typeof CASE_TYPE)[number];
export type Behavior = (typeof BEHAVIOR)[number];
export type Layer = (typeof LAYER)[number];
export type AutomationStatus = (typeof AUTOMATION_STATUS)[number];

// ── Domain types ──

export type Project = {
  id: string;
  name: string;
  abbreviation?: string | null;
  description?: string | null;
  is_private: boolean;
  organization_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProjectInput = {
  name: string;
  abbreviation?: string | null;
  description?: string | null;
  is_private?: boolean;
};

export type TestSuite = {
  id: string;
  name: string;
  description?: string | null;
  project_id: string;
  parent_id?: string | null;
};

export type Step = {
  action: string;
  data?: string | null;
  expected?: string | null;
  expected_results?: string[];
  attachments?: string[];
  api_expected_status?: number | null;
  api_contract?: string | null;
  api_method?: string | null;
  api_url?: string | null;
};

export function getStepExpectedResults(step: Step): string[] {
  if (step.expected_results && step.expected_results.length > 0) return step.expected_results;
  if (step.expected) return [step.expected];
  return [];
}

export type TestCase = {
  id: string;
  project_id: string;
  test_suite_id?: string | null;
  name: string;
  full_name?: string | null;
  description?: string | null;
  pre_conditions?: string | null;
  post_conditions?: string | null;
  steps: Step[];
  severity: Severity;
  priority: Priority;
  status: CaseStatus;
  type: CaseType;
  behavior: Behavior;
  layer: Layer;
  automation_status: AutomationStatus;
  is_flaky: boolean;
  muted: boolean;
  framework?: string | null;
  tags: string[];
  labels: Record<string, unknown>;
  revision: number;
  display_seq?: number | null;
  display_order?: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TestCaseInput = Omit<TestCase, "id" | "revision">;

// ── API methods ──

export const projectsApi = {
  list: () => api.get<Project[]>("/projects/"),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (data: ProjectInput) => api.post<Project>("/projects/", data),
  update: (id: string, data: Partial<ProjectInput>) =>
    api.patch<Project>(`/projects/${id}`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
};

export const suitesApi = {
  list: (projectId: string) =>
    api.get<TestSuite[]>(`/testsuites?project_id=${projectId}`),
  create: (data: {
    name: string;
    project_id: string;
    description?: string;
    parent_id?: string | null;
  }) => api.post<TestSuite>("/testsuites", data),
  update: (id: string, data: { name?: string; description?: string | null; parent_id?: string | null }) =>
    api.patch<TestSuite>(`/testsuites/${id}`, data),
  delete: (id: string, keepCases = false) => api.delete(`/testsuites/${id}?keep_cases=${keepCases}`),
};

// ── Suite order (per-user, per-project, stored in DB) ──

export type SuiteOrderData = {
  root: string[];
  children: Record<string, string[]>;
};

export const suiteOrderApi = {
  get: (projectId: string) =>
    api.get<SuiteOrderData>(`/suite-orders/${projectId}`),
  put: (projectId: string, data: SuiteOrderData) =>
    api.put<SuiteOrderData>(`/suite-orders/${projectId}`, data),
};

// ── TestPlans ──

export const PLAN_STATUS = ["active", "review", "archived"] as const;
export type PlanStatus = (typeof PLAN_STATUS)[number];

export type TestPlan = {
  id: string;
  display_id: string;
  name: string;
  description?: string | null;
  references?: string | null;
  project_id: string;
  milestone_id?: string | null;
  release_id?: string | null;
  status: PlanStatus;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  updated_at?: string | null;
  case_count: number;
  run_count: number;
};

export type TestPlanInput = {
  name: string;
  description?: string | null;
  references?: string | null;
  project_id: string;
  milestone_id?: string | null;
  release_id?: string | null;
  status?: PlanStatus;
  start_date?: string | null;
  end_date?: string | null;
};

export type TestPlanHistoryEntry = {
  id: string;
  action: string;
  actor_name?: string | null;
  actor_email?: string | null;
  details?: Record<string, { old: unknown; new: unknown }> | Record<string, unknown> | null;
  created_at: string;
};

export type TestPlanStats = {
  total_cases: number;
  untested: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  automation_passed: number;
  automation_failed: number;
  automation_error: number;
  passed_rate: number;
  completion_rate: number;
};

export const plansApi = {
  list: (projectId: string) =>
    api.get<TestPlan[]>(`/testplans?project_id=${projectId}`),
  get: (id: string) => api.get<TestPlan>(`/testplans/${id}`),
  stats: (id: string) => api.get<TestPlanStats>(`/testplans/${id}/stats`),
  history: (id: string) => api.get<TestPlanHistoryEntry[]>(`/testplans/${id}/history`),
  create: (data: TestPlanInput) => api.post<TestPlan>("/testplans", data),
  update: (id: string, data: Partial<TestPlanInput>) =>
    api.patch<TestPlan>(`/testplans/${id}`, data),
  delete: (id: string) => api.delete(`/testplans/${id}`),
  /** Самодостаточный JSON-бандл (план + кейсы + пути сьютов) для переноса в другую инсталляцию */
  exportBundle: (id: string) => api.get<TransferBundle>(`/testplans/${id}/export`),
  importBundle: (projectId: string, bundle: unknown, reuseExisting = true) =>
    api.post<PlanImportResult>(`/testplans/import?project_id=${projectId}&reuse_existing=${reuseExisting}`, bundle),
  addSuite: (planId: string, suiteId: string) =>
    api.post(`/testplans/${planId}/suites`, { suite_id: suiteId }),
  cases: (planId: string) =>
    api.get<TestCase[]>(`/testplans/${planId}/cases`),
  setCases: (planId: string, caseIds: string[]) =>
    api.post<void>(`/testplans/${planId}/cases/batch`, { case_ids: caseIds }),
  addCases: async (planId: string, newCaseIds: string[]) => {
    const current = await api.get<TestCase[]>(`/testplans/${planId}/cases`);
    const merged = Array.from(new Set([...current.map((c) => c.id), ...newCaseIds]));
    return api.post<void>(`/testplans/${planId}/cases/batch`, { case_ids: merged });
  },
};

// ── TestRuns ──

export const RESULT_STATUS = [
  "untested",
  "passed",
  "failed",
  "blocked",
  "skipped",
  "invalid",
  "retest",
  "in_progress",
] as const;
export type ResultStatus = (typeof RESULT_STATUS)[number];

export type RunStatus = "ready_to_start" | "in_progress" | "on_hold" | "completed" | "aborted";

export type TestRun = {
  id: string;
  name: string;
  description?: string | null;
  project_id: string;
  test_plan_id?: string | null;
  release_id?: string | null;
  status: RunStatus;
  hold_reason?: string | null;
  environment?: string | null;
  configuration?: string | null;
  device_type?: string | null;
  os?: string | null;
  os_version?: string | null;
  started_by?: string | null;
  started_by_name?: string | null;
  started_at: string;
  completed_at?: string | null;
};

export type TestResult = {
  id: string;
  run_id: string;
  test_case_id: string;
  sequence?: number | null;
  status: ResultStatus;
  executor_id?: string | null;
  time_spent_ms: number;
  comment?: string | null;
  actual_result?: string | null;
  executed_at?: string | null;
  attachments?: Record<string, string[]> | null;
};

export type TestRunStats = {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  invalid: number;
  untested: number;
};

// ── Transfer (перенос плана/прогона между инсталляциями TMS4QA) ──

export type TransferBundle = {
  format: "tms4qa-transfer";
  version: number;
  kind: "test_plan" | "test_run";
  exported_at: string;
  source_project?: string | null;
  [key: string]: unknown;
};

export type ImportStats = { suites_created: number; cases_created: number; cases_reused: number };
export type PlanImportResult = ImportStats & { plan_id: string; display_id: string };
export type RunImportResult = ImportStats & {
  run_id: string; plan_id: string | null;
  results_created: number; defects_created: number; checklists_added: number;
};

export const runsApi = {
  exportBundle: (id: string, includeAttachments = true) =>
    api.get<TransferBundle>(`/testruns/${id}/export?include_attachments=${includeAttachments}`),
  importBundle: (projectId: string, bundle: unknown, opts: { reuseExisting?: boolean; includePlan?: boolean } = {}) =>
    api.post<RunImportResult>(
      `/testruns/import?project_id=${projectId}&reuse_existing=${opts.reuseExisting ?? true}&include_plan=${opts.includePlan ?? true}`,
      bundle,
    ),
  list: (projectId: string, testPlanId?: string) => {
    const qs = new URLSearchParams({ project_id: projectId });
    if (testPlanId) qs.set("test_plan_id", testPlanId);
    return api.get<TestRun[]>(`/testruns?${qs.toString()}`);
  },
  get: (id: string) => api.get<TestRun>(`/testruns/${id}`),
  stats: (id: string) => api.get<TestRunStats>(`/testruns/${id}/stats`),
  results: (id: string) => api.get<TestResult[]>(`/testruns/${id}/results`),
  create: (data: {
    project_id: string;
    name: string;
    description?: string;
    environment?: string;
    release_id?: string | null;
    test_plan_id?: string | null;
    test_case_ids?: string[];
    device_type?: string | null;
    os?: string | null;
    os_version?: string | null;
  }) => api.post<TestRun>("/testruns", data),
  update: (id: string, data: {
    name?: string;
    description?: string;
    environment?: string;
    release_id?: string | null;
    device_type?: string | null;
    os?: string | null;
    os_version?: string | null;
  }) => api.patch<TestRun>(`/testruns/${id}`, data),
  start: (id: string) => api.post<TestRun>(`/testruns/${id}/start`, {}),
  hold: (id: string, reason: string) => api.post<TestRun>(`/testruns/${id}/hold`, { reason }),
  resume: (id: string) => api.post<TestRun>(`/testruns/${id}/resume`, {}),
  complete: (id: string) => api.post<TestRun>(`/testruns/${id}/complete`, {}),
  delete: (id: string) => api.delete(`/testruns/${id}`),
  setResult: (resultId: string, data: {
    status?: ResultStatus;
    comment?: string;
    actual_result?: string;
    attachments?: Record<string, string[]>;
  }) => api.patch<TestResult>(`/testruns/results/${resultId}`, data),
  setCases: (runId: string, caseIds: string[]) =>
    api.put<void>(`/testruns/${runId}/cases`, { case_ids: caseIds }),
  reorderResults: (runId: string, resultIds: string[]) =>
    api.post<void>(`/testruns/${runId}/results/reorder`, { result_ids: resultIds }),
};

export const casesApi = {
  list: (projectId: string) =>
    api.get<TestCase[]>(`/testcases?project_id=${projectId}`),
  get: (id: string) => api.get<TestCase>(`/testcases/${id}`),
  create: (data: Partial<TestCaseInput> & { name: string; project_id: string }) =>
    api.post<TestCase>("/testcases", data),
  update: (id: string, data: Partial<TestCaseInput>) =>
    api.patch<TestCase>(`/testcases/${id}`, data),
  delete: (id: string) => api.delete(`/testcases/${id}`),
  bulkMoveToSuite: (caseIds: string[], targetSuiteId: string | null) =>
    api.post<{ moved: number }>("/testcases/bulk-move-suite", { case_ids: caseIds, target_suite_id: targetSuiteId }),
  batchReorder: (orderedIds: string[]) =>
    api.post<void>("/testcases/batch-reorder", { ordered_ids: orderedIds }),
};

// ── Defects ──

export const DEFECT_STATUS = ["open", "in_progress", "resolved", "closed", "reopened"] as const;
export type DefectStatus = (typeof DEFECT_STATUS)[number];

export const DEFECT_ENVIRONMENTS = ["DEV", "TEST", "PREPROD", "PROD"] as const;
export type DefectEnvironment = (typeof DEFECT_ENVIRONMENTS)[number];

export const IMPACT_LEVELS = ["none", "low", "medium", "high", "critical"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export type Defect = {
  id: string;
  display_seq: number;
  display_id: string;
  title: string;
  impact?: string | null;
  pre_conditions?: string | null;
  steps_to_reproduce?: string | null;
  expected_result?: string | null;
  actual_result?: string | null;
  description?: string | null;
  environment?: string | null;
  severity: Severity;
  priority: Priority;
  status: DefectStatus;
  tags: string[];
  project_id: string;
  reporter_id?: string | null;
  assignee_id?: string | null;
  release_id?: string | null;
  test_run_id?: string | null;
  test_run_name?: string | null;
  external_id?: string | null;
  external_url?: string | null;
  /** ссылки на файлы в MinIO (/api/v1/attachments/{id}/file/...) */
  attachments?: string[];
  created_at: string;
  updated_at?: string | null;
};

export type DefectInput = {
  title: string;
  impact?: string | null;
  pre_conditions?: string | null;
  steps_to_reproduce?: string | null;
  expected_result?: string | null;
  actual_result?: string | null;
  description?: string | null;
  environment?: string | null;
  severity?: Severity;
  priority?: Priority;
  tags?: string[];
  project_id: string;
  test_run_id?: string | null;
  /** результат прогона, из которого заведён дефект (связь defect_results) */
  test_result_id?: string | null;
  attachments?: string[];
};

export type DefectUpdate = {
  title?: string;
  pre_conditions?: string | null;
  steps_to_reproduce?: string | null;
  expected_result?: string | null;
  actual_result?: string | null;
  description?: string | null;
  environment?: string | null;
  severity?: Severity;
  priority?: Priority;
  status?: DefectStatus;
  tags?: string[];
  assignee_id?: string | null;
  release_id?: string | null;
  test_run_id?: string | null;
  attachments?: string[];
};

export const defectsApi = {
  /** testRunId: UUID прогона или "none" — дефекты без прогона */
  list: (projectId: string, status?: string, testRunId?: string) => {
    const qs = new URLSearchParams({ project_id: projectId });
    if (status) qs.set("status", status);
    if (testRunId) qs.set("test_run_id", testRunId);
    return api.get<Defect[]>(`/defects?${qs}`);
  },
  get: (id: string) => api.get<Defect>(`/defects/${id}`),
  create: (data: DefectInput) => api.post<Defect>("/defects", data),
  update: (id: string, data: DefectUpdate) => api.patch<Defect>(`/defects/${id}`, data),
  delete: (id: string) => api.delete(`/defects/${id}`),
};

// ── Checklists ──

export type ChecklistItem = {
  id: string;
  text: string;
};

export type Checklist = {
  id: string;
  project_id: string;
  title: string;
  items: ChecklistItem[];
  created_at: string;
  updated_at?: string | null;
};

export type ChecklistInput = {
  project_id: string;
  title: string;
  items: ChecklistItem[];
};

export type ChecklistUpdate = {
  title?: string;
  items?: ChecklistItem[];
};

export type RunChecklist = {
  checklist_id: string;
  title: string;
  items: ChecklistItem[];
  checked_items: string[];
};

export const checklistsApi = {
  list: (projectId: string) => api.get<Checklist[]>(`/checklists?project_id=${projectId}`),
  get: (id: string) => api.get<Checklist>(`/checklists/${id}`),
  create: (data: ChecklistInput) => api.post<Checklist>("/checklists", data),
  update: (id: string, data: ChecklistUpdate) => api.patch<Checklist>(`/checklists/${id}`, data),
  delete: (id: string) => api.delete(`/checklists/${id}`),
};

export const runChecklistsApi = {
  list: (runId: string) => api.get<RunChecklist[]>(`/testruns/${runId}/checklists`),
  attach: (runId: string, checklistId: string) =>
    api.post<RunChecklist>(`/testruns/${runId}/checklists`, { checklist_id: checklistId }),
  updateChecked: (runId: string, checklistId: string, checkedItems: string[]) =>
    api.patch<RunChecklist>(`/testruns/${runId}/checklists/${checklistId}`, { checked_items: checkedItems }),
  detach: (runId: string, checklistId: string) =>
    api.delete(`/testruns/${runId}/checklists/${checklistId}`),
};

// ── Todos ──

export type TodoItem = {
  id: string;
  project_id: string;
  type: "task" | "note" | "plan";
  title: string;
  body?: string | null;
  status: "todo" | "in_progress" | "done";
  priority: "high" | "medium" | "low";
  due_date?: string | null;
  tags: string[];
  jira_url?: string | null;
  requirement_id?: string | null;
  requirement_title?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type TodoInput = {
  project_id: string;
  type: "task" | "note" | "plan";
  title: string;
  body?: string | null;
  status?: "todo" | "in_progress" | "done";
  priority?: "high" | "medium" | "low";
  due_date?: string | null;
  tags?: string[];
  jira_url?: string | null;
  requirement_id?: string | null;
};

export type TodoUpdate = {
  type?: "task" | "note" | "plan";
  title?: string;
  body?: string | null;
  status?: "todo" | "in_progress" | "done";
  priority?: "high" | "medium" | "low";
  due_date?: string | null;
  tags?: string[];
  jira_url?: string | null;
  requirement_id?: string | null;
};

export const todosApi = {
  list: (projectId: string) => api.get<TodoItem[]>(`/todos?project_id=${projectId}`),
  get: (id: string) => api.get<TodoItem>(`/todos/${id}`),
  create: (data: TodoInput) => api.post<TodoItem>("/todos", data),
  update: (id: string, data: TodoUpdate) => api.patch<TodoItem>(`/todos/${id}`, data),
  delete: (id: string) => api.delete(`/todos/${id}`),
};

// ── Requirements ──

export const REQ_TYPES = ["epic", "feature", "story", "requirement"] as const;
export const REQ_STATUSES = ["draft", "approved", "in_progress", "ready_for_qa", "tested", "rejected"] as const;
export type ReqType = (typeof REQ_TYPES)[number];
export type ReqStatus = (typeof REQ_STATUSES)[number];

export type Requirement = {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  req_type?: ReqType | null;
  parent_id?: string | null;
  status?: ReqStatus | null;
  priority?: Priority | null;
  external_id?: string | null;
  source?: string | null;
  external_url?: string | null;
  display_seq?: number | null;
  case_count: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type RequirementInput = {
  title: string;
  project_id: string;
  description?: string | null;
  req_type?: ReqType | null;
  parent_id?: string | null;
  status?: ReqStatus;
  priority?: Priority;
  external_id?: string | null;
  external_url?: string | null;
  source?: string | null;
};

export const requirementsApi = {
  list: (projectId: string) =>
    api.get<Requirement[]>(`/requirements?project_id=${projectId}`),
  get: (id: string) => api.get<Requirement>(`/requirements/${id}`),
  create: (data: RequirementInput) => api.post<Requirement>("/requirements", data),
  update: (id: string, data: Partial<RequirementInput>) =>
    api.patch<Requirement>(`/requirements/${id}`, data),
  delete: (id: string) => api.delete(`/requirements/${id}`),
  getTestCases: (id: string) => api.get<TestCase[]>(`/requirements/${id}/testcases`),
  setTestCases: (id: string, caseIds: string[]) =>
    api.post<void>(`/requirements/${id}/testcases`, { case_ids: caseIds }),
  traceability: (projectId: string) =>
    api.get<ReqTrace[]>(`/requirements/traceability?project_id=${projectId}`),
};

// ── Traceability types ──
export type DefectBrief = {
  id: string; display_seq: number; title: string; status: string; severity: string;
};
export type CaseTrace = {
  id: string; name: string; automation_status: string;
  latest_status: string; suite_name?: string | null; defects: DefectBrief[];
};
export type ReqTrace = {
  id: string; title: string; req_type?: string | null; status?: string | null;
  priority?: string | null; display_seq?: number | null;
  parent_id?: string | null;
  source?: string | null;
  external_id?: string | null;
  external_url?: string | null;
  description?: string | null;
  test_cases: CaseTrace[];
  total_cases: number; passed: number; failed: number; blocked: number; untested: number;
  coverage_pct: number;
  last_run_date?: string | null;
};

// ── Dashboard types ──
export type DashStats = {
  total: number; passed: number; failed: number;
  blocked: number; skipped: number; untested: number;
};
export type FailingTest = {
  case_id: string; case_name: string;
  suite_id?: string | null; suite_name?: string | null;
  run_id: string; run_name: string; executed_at?: string | null;
};
export type LatestRunInfo = {
  id: string; name: string; started_by_name?: string | null;
  started_at: string; status: string; stats: DashStats;
};
export type DashboardData = {
  execution_summary: DashStats;
  failing_tests: FailingTest[];
  latest_run?: LatestRunInfo | null;
};

export const dashboardApi = {
  get: (projectId: string) =>
    api.get<DashboardData>(`/testruns/dashboard?project_id=${projectId}`),
};

// ── Releases ──

export type ReleaseEnv = "dev" | "test" | "preprod" | "prod";
export type ReleaseStatus = "planned" | "in_progress" | "released" | "archived";

export const RELEASE_ENVIRONMENTS: ReleaseEnv[] = ["dev", "test", "preprod", "prod"];
export const RELEASE_STATUSES: ReleaseStatus[] = ["planned", "in_progress", "released", "archived"];

export type Release = {
  id: string;
  project_id: string;
  name: string;
  version: string;
  description?: string | null;
  environment?: string | null;
  status: string;
  release_date?: string | null;
  requirement_ids: string[];
  created_at: string;
  updated_at?: string | null;
};

export type ReleaseInput = {
  project_id: string;
  name: string;
  version?: string;
  description?: string | null;
  environment?: string | null;
  status?: string;
  release_date?: string | null;
  requirement_ids?: string[];
};

export type ReleaseUpdate = {
  name?: string;
  version?: string;
  description?: string | null;
  environment?: string | null;
  status?: string;
  release_date?: string | null;
  requirement_ids?: string[];
};

export const releasesApi = {
  list: (projectId: string) => api.get<Release[]>(`/releases?project_id=${projectId}`),
  get: (id: string) => api.get<Release>(`/releases/${id}`),
  create: (data: ReleaseInput) => api.post<Release>("/releases", data),
  update: (id: string, data: ReleaseUpdate) => api.patch<Release>(`/releases/${id}`, data),
  delete: (id: string) => api.delete(`/releases/${id}`),
};

// ── Attachments (MinIO) ──

export type Attachment = {
  id: string;
  project_id: string;
  entity_type: string;
  entity_id: string;
  filename: string;
  url: string;
  size: number;
  content_type?: string | null;
  created_at: string;
};

export const attachmentsApi = {
  /** Файл → MinIO. В ответе `url` — относительная ссылка, её и сохраняем в сущности. */
  upload: async (file: File, entityType: string, entityId: string, projectId: string, _retry = false): Promise<Attachment> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("entity_type", entityType);
    formData.append("entity_id", entityId);
    formData.append("project_id", projectId);
    const token = tokenStore.getAccess();
    const res = await fetch(`${API_BASE}/attachments/upload`, {
      method: "POST",
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (res.status === 401 && !_retry && await tryRefresh()) {
      return attachmentsApi.upload(file, entityType, entityId, projectId, true);
    }
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },
  list: (entityType: string, entityId: string) =>
    api.get<Attachment[]>(`/attachments?entity_type=${entityType}&entity_id=${entityId}`),
  delete: (id: string) => api.delete(`/attachments/${id}`),
};

// ── Shared Steps ──

export type SharedStepFolder = {
  id: string;
  project_id: string;
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SharedStep = {
  id: string;
  project_id: string;
  folder_id?: string | null;
  name: string;
  description?: string | null;
  steps: Step[];
  created_at?: string | null;
  updated_at?: string | null;
};

export const sharedStepsApi = {
  listFolders: (projectId: string) => api.get<SharedStepFolder[]>(`/shared-step-folders?project_id=${projectId}`),
  createFolder: (data: { project_id: string; name: string }) => api.post<SharedStepFolder>("/shared-step-folders", data),
  updateFolder: (id: string, data: { name: string }) => api.patch<SharedStepFolder>(`/shared-step-folders/${id}`, data),
  deleteFolder: (id: string) => api.delete(`/shared-step-folders/${id}`),

  list: (projectId: string) => api.get<SharedStep[]>(`/shared-steps?project_id=${projectId}`),
  get: (id: string) => api.get<SharedStep>(`/shared-steps/${id}`),
  create: (data: { project_id: string; name: string; description?: string | null; steps?: Step[]; folder_id?: string | null }) =>
    api.post<SharedStep>("/shared-steps", data),
  update: (id: string, data: Partial<{ name: string; description: string | null; steps: Step[]; folder_id: string | null }>) =>
    api.patch<SharedStep>(`/shared-steps/${id}`, data),
  delete: (id: string) => api.delete(`/shared-steps/${id}`),
};

// ── Auth API (uses /api/auth, not /api/v1) ────────────────────────────────
export type AuthUser = {
  id: string;
  email: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  role?: string | null;
  organization_id?: string | null;
  is_active?: boolean;
};

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Auth error ${res.status}`);
  }
  return res.json();
}

export const authApi = {
  login: async (login: string, password: string): Promise<AuthUser> => {
    const data = await authRequest<{ access_token: string; refresh_token: string; user: AuthUser }>(
      "/auth/login", { login, password }
    );
    tokenStore.set(data.access_token, data.refresh_token);
    localStorage.setItem("tms_user", JSON.stringify(data.user));
    return data.user;
  },
  logout: async () => {
    const rt = tokenStore.getRefresh();
    if (rt) {
      try { await authRequest("/auth/logout", { refresh_token: rt }); } catch { /* ignore */ }
    }
    tokenStore.clear();
  },
  me: async (): Promise<AuthUser> => {
    const token = tokenStore.getAccess();
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Not authenticated");
    return res.json();
  },
  getCachedUser: (): AuthUser | null => {
    const s = localStorage.getItem("tms_user");
    return s ? JSON.parse(s) : null;
  },
  isLoggedIn: (): boolean => !!tokenStore.getAccess(),
};

// ── Organizations & Users admin API ───────────────────────────────────────
export type OrgOut = { id: string; name: string; website_url?: string | null };

export type UserFull = {
  id: string;
  email: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  role?: string | null;
  organization_id?: string | null;
  is_active: boolean;
  phone?: string | null;
  telegram?: string | null;
};

export type InvitePayload = {
  email: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  role: string;
  password: string;
};

export const orgsApi = {
  listAll: () => api.get<OrgOut[]>("/organizations/admin/all"),
  getOrg: (id: string) => api.get<OrgOut>(`/organizations/${id}`),
  createWithOwner: (data: {
    name: string;
    owner_email: string;
    owner_password: string;
    owner_first_name?: string;
    owner_last_name?: string;
  }) => api.post<OrgOut>("/organizations/admin/create", data),
  listUsers: (orgId: string) => api.get<UserFull[]>(`/users/org/${orgId}`),
  inviteUser: (data: InvitePayload) => api.post<UserFull>("/users/invite", data),
  changeRole: (userId: string, role: string) => api.patch<UserFull>(`/users/${userId}/role`, { role }),
  deactivate: (userId: string) => api.patch<UserFull>(`/users/${userId}/deactivate`, {}),
  updateContact: (userId: string, data: { email?: string; phone?: string; telegram?: string }) =>
    api.patch<UserFull>(`/users/${userId}/contact`, data),
  updateOrgSettings: (orgId: string, data: { website_url?: string | null }) =>
    api.patch<OrgOut>(`/organizations/${orgId}/settings`, data),
  renameOrg: (orgId: string, name: string) =>
    api.patch<OrgOut>(`/organizations/admin/${orgId}`, { name }),
};

// ── Audit log (SUPER_ADMIN) ───────────────────────────────────────────────────
export type AuditLogEntry = {
  id: string;
  actor_id?: string | null;
  actor_email?: string | null;
  actor_name?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  details?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at: string;
};

export const auditApi = {
  list: (params: { limit?: number; offset?: number; org_id?: string; action?: string }) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.offset != null) q.set("offset", String(params.offset));
    if (params.org_id) q.set("org_id", params.org_id);
    if (params.action) q.set("action", params.action);
    return api.get<AuditLogEntry[]>(`/audit/?${q.toString()}`);
  },
};
