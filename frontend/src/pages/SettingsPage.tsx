import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  projectsApi, suitesApi, casesApi, plansApi, runsApi,
  requirementsApi, releasesApi,
  authApi, orgsApi, orgStore,
  SEVERITY, CASE_TYPE,
  type Project, type OrgOut, type UserFull, type Step, type TransferBundle,
} from "../api/client";
import "./SettingsPage.css";
import { ROLE_META, ALL_ROLES, NON_SA_ROLES } from "../constants/roles";
import { inlineMedia } from "../utils/media";
import { buildQaseExport, downloadJSON, QASE_STATUS, buildFullProjectExport, fullProjectExportFilename } from "../utils/exportFormats";
import { isTransferBundle, importTransferBundle } from "../utils/transfer";

// ── Role descriptions and permission matrices ─────────────────────────────────
type Perm = { label: string; allowed: boolean };
const ROLE_DETAILS: Record<string, { desc: string; perms: Perm[] }> = {
  SUPER_ADMIN: {
    desc: "Системный администратор. Управление организациями, пользователями и всеми настройками.",
    perms: [
      { label: "Управление организациями", allowed: true },
      { label: "Управление пользователями", allowed: true },
      { label: "Настройки страницы входа", allowed: true },
      { label: "Полный доступ ко всем проектам", allowed: true },
      { label: "Просмотр журнала аудита", allowed: true },
      { label: "Все разрешения ниже", allowed: true },
    ],
  },
  OWNER: {
    desc: "Владелец организации. Полный доступ ко всем проектам и настройкам своей организации.",
    perms: [
      { label: "Управление пользователями орг.", allowed: true },
      { label: "Создание/редактирование тест-кейсов", allowed: true },
      { label: "Запуск тестовых прогонов", allowed: true },
      { label: "Управление требованиями", allowed: true },
      { label: "Настройки проекта", allowed: true },
      { label: "Просмотр отчётов и дашбордов", allowed: true },
    ],
  },
  PM: {
    desc: "Менеджер проектов. Управление планами, релизами, командой и требованиями.",
    perms: [
      { label: "Управление тест-планами и релизами", allowed: true },
      { label: "Управление требованиями", allowed: true },
      { label: "Просмотр отчётов и дашбордов", allowed: true },
      { label: "Создание/редактирование тест-кейсов", allowed: true },
      { label: "Запуск тестовых прогонов", allowed: false },
      { label: "Управление пользователями", allowed: false },
    ],
  },
  QA_LEAD: {
    desc: "Ведущий QA. Полный доступ к тест-кейсам, прогонам, дефектам и требованиям.",
    perms: [
      { label: "Создание/редактирование тест-кейсов", allowed: true },
      { label: "Запуск тестовых прогонов", allowed: true },
      { label: "Управление требованиями", allowed: true },
      { label: "Просмотр отчётов и дашбордов", allowed: true },
      { label: "Управление пользователями", allowed: false },
      { label: "Настройки проекта", allowed: false },
    ],
  },
  TESTER: {
    desc: "Тестировщик. Выполнение тест-прогонов, создание дефектов и тест-кейсов (на ревью).",
    perms: [
      { label: "Запуск тестовых прогонов", allowed: true },
      { label: "Создание тест-кейсов (→ Review)", allowed: true },
      { label: "Создание дефектов", allowed: true },
      { label: "Редактирование/смена статуса кейсов", allowed: false },
      { label: "Управление требованиями", allowed: false },
      { label: "Управление пользователями", allowed: false },
    ],
  },
  ANALYST: {
    desc: "Аналитик. Управление требованиями, traceability-матрица, экспорт отчётов.",
    perms: [
      { label: "Управление требованиями", allowed: true },
      { label: "Просмотр трассировки", allowed: true },
      { label: "Просмотр/экспорт отчётов и дашбордов", allowed: true },
      { label: "Создание/редактирование тест-кейсов", allowed: false },
      { label: "Запуск тестовых прогонов", allowed: false },
      { label: "Управление пользователями", allowed: false },
    ],
  },
  DEVELOPER: {
    desc: "Разработчик. Просмотр тест-кейсов и прогонов, создание и обновление дефектов.",
    perms: [
      { label: "Просмотр тест-кейсов и прогонов", allowed: true },
      { label: "Создание и обновление дефектов", allowed: true },
      { label: "Просмотр требований", allowed: true },
      { label: "Создание/редактирование тест-кейсов", allowed: false },
      { label: "Запуск тестовых прогонов", allowed: false },
      { label: "Управление пользователями", allowed: false },
    ],
  },
  CTO: {
    desc: "Технический директор. Полный доступ для чтения — отчёты, метрики, дашборды.",
    perms: [
      { label: "Просмотр всех дашбордов и отчётов", allowed: true },
      { label: "Просмотр тест-кейсов и прогонов", allowed: true },
      { label: "Просмотр требований и трассировки", allowed: true },
      { label: "Создание/редактирование тест-кейсов", allowed: false },
      { label: "Запуск тестовых прогонов", allowed: false },
      { label: "Управление пользователями", allowed: false },
    ],
  },
};

type RoleInfo = { label: string; color: string; bg: string; desc: string; perms: Perm[] };
const ROLE_INFO = Object.fromEntries(
  Object.entries(ROLE_META).map(([key, meta]) => [
    key,
    { ...meta, ...(ROLE_DETAILS[key] ?? { desc: "", perms: [] as Perm[] }) },
  ])
) as Record<string, RoleInfo>;

// ── Helpers ───────────────────────────────────────────────────────────────────
function getInitials(u: UserFull): string {
  if (u.first_name && u.last_name) return (u.first_name[0] + u.last_name[0]).toUpperCase();
  const n = u.name || u.email || "?";
  const parts = n.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : n.slice(0, 2).toUpperCase();
}

function getDisplayName(u: UserFull): string {
  if (u.first_name || u.last_name) return [u.first_name, u.last_name].filter(Boolean).join(" ");
  return u.name || u.username || u.email;
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────
function RolesTab() {
  const currentUser = authApi.getCachedUser();
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";

  const [orgs, setOrgs] = useState<OrgOut[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(() => {
    if (isSuperAdmin) return orgStore.get()?.id ?? "";
    return currentUser?.organization_id ?? "";
  });
  const [orgName, setOrgName] = useState<string>("");
  const [orgUsers, setOrgUsers] = useState<UserFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [changingRole, setChangingRole] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  // Load orgs list for SUPER_ADMIN
  useEffect(() => {
    if (!isSuperAdmin) return;
    orgsApi.listAll().then(setOrgs).catch(() => {});
  }, [isSuperAdmin]);

  // For OWNER: get org name
  useEffect(() => {
    if (isSuperAdmin || !selectedOrgId) return;
    orgsApi.getOrg(selectedOrgId).then((o) => setOrgName(o.name)).catch(() => {});
  }, [isSuperAdmin, selectedOrgId]);

  // Listen for org change from TopBar (SUPER_ADMIN)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; name: string } | null;
      if (isSuperAdmin && detail?.id) setSelectedOrgId(detail.id);
    };
    window.addEventListener("tms:orgchange", handler);
    return () => window.removeEventListener("tms:orgchange", handler);
  }, [isSuperAdmin]);

  // Load users when org selected
  useEffect(() => {
    if (!selectedOrgId) { setOrgUsers([]); return; }
    setLoading(true);
    orgsApi.listUsers(selectedOrgId)
      .then(setOrgUsers)
      .catch(() => setOrgUsers([]))
      .finally(() => setLoading(false));
  }, [selectedOrgId]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setChangingRole((prev) => ({ ...prev, [userId]: true }));
    try {
      const updated = await orgsApi.changeRole(userId, newRole);
      setOrgUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: updated.role } : u));
      setToast(`Роль обновлена → ${newRole}`);
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast(`Ошибка: ${e instanceof Error ? e.message : "Unknown"}`);
      setTimeout(() => setToast(null), 3000);
    } finally {
      setChangingRole((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const roleOptions = isSuperAdmin ? ALL_ROLES : NON_SA_ROLES;

  return (
    <div>
      {toast && (
        <div style={{ padding: "8px 14px", borderRadius: 6, marginBottom: 14, fontSize: 13,
          background: toast.startsWith("Ошибка") ? "#fee2e2" : "#dcfce7",
          color: toast.startsWith("Ошибка") ? "#dc2626" : "#15803d" }}>
          {toast}
        </div>
      )}

      {/* ── User role management ── */}
      <div className="settings-section-header">
        <div>
          <h2 className="settings-section-title">Управление ролями</h2>
          <p className="settings-section-desc">
            {isSuperAdmin ? "Выберите организацию и назначайте роли пользователям" : "Управление ролями пользователей вашей организации"}
          </p>
        </div>
      </div>

      {/* Org picker for SUPER_ADMIN */}
      {isSuperAdmin && (
        <div className="settings-roles-org-picker">
          <span className="settings-roles-org-label">🏢 Организация:</span>
          <div className="settings-roles-org-btns">
            {orgs.map((o) => (
              <button
                key={o.id}
                className={"btn" + (selectedOrgId === o.id ? " btn-primary" : "")}
                style={{ fontSize: 12, padding: "3px 12px" }}
                onClick={() => { setSelectedOrgId(o.id); orgStore.set(o.id, o.name); }}
              >
                {o.name}
              </button>
            ))}
            {orgs.length === 0 && (
              <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Нет организаций</span>
            )}
          </div>
        </div>
      )}

      {/* Org badge for OWNER */}
      {!isSuperAdmin && orgName && (
        <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 14 }}>
          Организация: <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{orgName}</span>
        </div>
      )}

      {/* Users table */}
      {isSuperAdmin && !selectedOrgId ? (
        <div className="settings-roles-no-org">
          Выберите организацию выше для управления ролями её пользователей
        </div>
      ) : loading ? (
        <div style={{ padding: "20px 0", color: "var(--color-text-muted)", fontSize: 13 }}>Загружаем пользователей…</div>
      ) : (
        <div className="settings-users-table">
          <div className="su-head su-head-roles">
            <span>Пользователь</span>
            <span>Текущая роль</span>
            <span>Изменить роль</span>
            <span>Статус</span>
          </div>
          {orgUsers.length === 0 ? (
            <div className="su-empty">Нет пользователей в организации</div>
          ) : orgUsers.map((u) => {
            const rs = ROLE_META[u.role ?? ""] ?? { bg: "#f3f4f6", color: "#6b7280" };
            return (
              <div key={u.id} className={`su-row${!u.is_active ? " su-row-inactive" : ""}`}>
                <div className="su-user-cell">
                  <div className="su-avatar">{getInitials(u)}</div>
                  <div>
                    <div className="su-name">{getDisplayName(u)}</div>
                    <div className="su-email">{u.email}</div>
                  </div>
                </div>
                <div>
                  <span className="su-role-badge" style={{ background: rs.bg, color: rs.color }}>
                    {u.role ?? "—"}
                  </span>
                </div>
                <div>
                  <select
                    className="input"
                    value={u.role ?? ""}
                    disabled={changingRole[u.id] || !u.is_active}
                    style={{ fontSize: 12, padding: "2px 6px", height: 28, minWidth: 130 }}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                  >
                    {roleOptions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={`su-status-toggle${u.is_active ? " is-active" : ""}`} style={{ fontSize: 11, cursor: "default" }}>
                    {u.is_active ? "✓ Активен" : "✗ Неактивен"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Role descriptions + permissions ── */}
      <div style={{ marginTop: 36 }}>
        <div className="settings-section-header" style={{ marginBottom: 16 }}>
          <div>
            <h3 className="settings-section-title" style={{ fontSize: 16 }}>Роли и разрешения</h3>
            <p className="settings-section-desc">Описание возможностей каждой роли в системе</p>
          </div>
        </div>

        {/* Role list (Workspace-style) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 680, marginBottom: 28 }}>
          {Object.entries(ROLE_INFO).filter(([role]) => isSuperAdmin || role !== "SUPER_ADMIN").map(([role, info]) => {
            const userCount = orgUsers.filter((u) => u.role === role).length;
            return (
              <div key={role} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "12px 16px", border: "1px solid var(--color-border)",
                borderRadius: 8, background: "var(--color-bg)",
              }}>
                <span className="sr-role-label" style={{
                  background: info.bg, color: info.color,
                  fontSize: 12, fontWeight: 700, padding: "3px 10px",
                  borderRadius: 99, flexShrink: 0,
                }}>{info.label}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{info.label}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>{info.desc}</div>
                </div>
                {userCount > 0 && (
                  <span style={{ fontSize: 12, color: "var(--color-text-muted)", flexShrink: 0 }}>{userCount} чел.</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Permission matrix cards */}
        <div className="settings-section-header" style={{ marginBottom: 12 }}>
          <div>
            <h3 className="settings-section-title" style={{ fontSize: 14 }}>Матрица разрешений</h3>
          </div>
        </div>
        <div className="sr-grid">
          {Object.entries(ROLE_INFO).filter(([role]) => isSuperAdmin || role !== "SUPER_ADMIN").map(([role, info]) => (
            <div key={role} className="sr-card">
              <div className="sr-card-head">
                <span className="sr-role-badge" style={{ background: info.bg, color: info.color }}>{info.label}</span>
              </div>
              <p className="sr-desc">{info.desc}</p>
              <div className="sr-perms">
                {info.perms.map((p, i) => (
                  <div key={i} className={`sr-perm${p.allowed ? " sr-perm-yes" : " sr-perm-no"}`}>
                    {p.allowed ? "✓" : "✗"} {p.label}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Qase format mapping (import direction: Qase → 4QA) ───────────────────────

const PRIORITY_FROM_QASE: Record<string, string> = { high: "high", medium: "medium", low: "low" };
const BEHAVIOR_FROM_QASE: Record<string, string> = { positive: "positive", negative: "negative", destructive: "destructive" };
const AUTOMATION_FROM_QASE: Record<string, string> = { "is-not-automated": "manual", "to-be-automated": "to_be_automated", "automated": "automated" };
const LAYER_FROM_QASE: Record<string, string> = { e2e: "e2e", api: "api", unit: "unit" };

// Detect Qase backup format: top-level "suites" array whose items use "title"/"cases" (not our "name")
function isQaseFormat(data: any): boolean {
  return data?.version !== "1.0" && Array.isArray(data?.suites) &&
    data.suites.length > 0 && typeof data.suites[0]?.title === "string";
}

function qaseStepToOurs(s: Record<string, unknown>): Step {
  return {
    action: (s.action as string) ?? "",
    data: (s.data as string) ?? "",
    expected: (s.expected_result as string) ?? "",
  };
}

// ── Backup Tab ────────────────────────────────────────────────────────────────

function BackupTab() {
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [srcProject, setSrcProject] = useState("");
  const [inclSuitesCases, setInclSuitesCases] = useState(true);
  const [inclPlans, setInclPlans] = useState(true);
  const [inclRuns, setInclRuns] = useState(false);
  const [exportFormat, setExportFormat] = useState<"4qa" | "qase">("4qa");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const [importProjectId, setImportProjectId] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  useEffect(() => { projectsApi.list().then(setAllProjects).catch(() => {}); }, []);

  const doExport = async () => {
    if (!srcProject) return;
    setExporting(true); setExportMsg(null);
    try {
      const proj = allProjects.find((p) => p.id === srcProject);
      const dt = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");

      if (exportFormat === "qase") {
        const suites = await suitesApi.list(srcProject);
        const cases = await casesApi.list(srcProject);
        const payload = { suites: buildQaseExport(suites, cases) };
        downloadJSON(payload, `qase_export_${(proj?.name ?? srcProject).replace(/\s+/g, "_")}_${dt}.json`);
        setExportMsg("✓ Экспорт завершён");
        return;
      }

      const payload: Record<string, unknown> = {
        version: "1.0",
        exported_at: new Date().toISOString(),
        project_id: srcProject,
        project_name: proj?.name ?? srcProject,
        includes: { suites_cases: inclSuitesCases, plans: inclPlans, runs: inclRuns },
        suites: [], cases: [], plans: [], runs: [],
      };
      if (inclSuitesCases) {
        payload.suites = await suitesApi.list(srcProject);
        payload.cases = await casesApi.list(srcProject);
      }
      if (inclPlans) {
        const plans = await plansApi.list(srcProject);
        payload.plans = await Promise.all(plans.map(async (p) => {
          const casesList = await plansApi.cases(p.id).catch(() => []);
          return { ...p, case_ids: casesList.map((c) => c.id) };
        }));
      }
      if (inclRuns) {
        const runs = await runsApi.list(srcProject);
        payload.runs = await Promise.all(runs.map(async (r) => {
          const results = await runsApi.results(r.id).catch(() => []);
          return { ...r, case_ids: results.map((res) => res.test_case_id) };
        }));
      }
      downloadJSON(await inlineMedia(payload), `4qa_backup_${(proj?.name ?? srcProject).replace(/\s+/g, "_")}_${dt}.json`);
      setExportMsg("✓ Экспорт завершён");
    } catch (e: unknown) {
      setExportMsg(`⚠ Ошибка: ${e instanceof Error ? e.message : "unknown"}`);
    } finally { setExporting(false); }
  };

  const doImport = async () => {
    if (!importFile || !importProjectId) return;
    setImporting(true); setImportDone(false);
    const log: string[] = [];
    const addLog = (msg: string) => { log.push(msg); setImportLog([...log]); };
    try {
      const text = await importFile.text();
      const data = JSON.parse(text);

      // Файл отдельного тест-плана / тест-прогона (кнопка ⬇ на странице плана/прогона)
      if (isTransferBundle(data)) {
        addLog(`Обнаружен экспорт ${data.kind === "test_run" ? "тест-прогона" : "тест-плана"} (из «${data.source_project ?? "?"}»)…`);
        const res = await importTransferBundle(importProjectId, data);
        res.lines.forEach(addLog);
        addLog("✅ Импорт завершён!");
        setImportDone(true);
        return;
      }

      if (isQaseFormat(data)) {
        addLog(`Обнаружен формат Qase. Создание сьютов и тест-кейсов…`);
        const createQaseSuiteTree = async (suite: Record<string, unknown>, parentId: string | null) => {
          try {
            const created = await suitesApi.create({
              name: suite.title as string,
              project_id: importProjectId,
              description: (suite.description as string) ?? undefined,
              parent_id: parentId,
            });
            addLog(`  ✓ Сьют: ${suite.title}`);
            for (const c of (suite.cases as Record<string, unknown>[]) ?? []) {
              try {
                const stepsType = c.steps_type;
                const steps = ((c.steps as Record<string, unknown>[]) ?? []).map(qaseStepToOurs);
                await casesApi.create({
                  name: c.title as string,
                  project_id: importProjectId,
                  test_suite_id: created.id,
                  description: (c.description as string) ?? undefined,
                  pre_conditions: (c.preconditions as string) ?? undefined,
                  post_conditions: (c.postconditions as string) ?? undefined,
                  priority: (PRIORITY_FROM_QASE[c.priority as string] ?? "not_set") as any,
                  severity: ((SEVERITY as readonly string[]).includes(c.severity as string) ? c.severity : "normal") as any,
                  type: ((CASE_TYPE as readonly string[]).includes(c.type as string) ? c.type : "other") as any,
                  behavior: (BEHAVIOR_FROM_QASE[c.behavior as string] ?? "not_set") as any,
                  automation_status: (AUTOMATION_FROM_QASE[c.automation as string] ?? "manual") as any,
                  status: (QASE_STATUS.has(c.status as string) ? c.status : "draft") as any,
                  layer: (LAYER_FROM_QASE[c.layer as string] ?? "not_set") as any,
                  is_flaky: c.is_flaky === "yes",
                  muted: c.is_muted === "yes",
                  tags: (c.tags as string[]) ?? [],
                  steps: stepsType === "classic" ? steps : [],
                });
                addLog(`    ✓ ${c.title}`);
              } catch (e: unknown) { addLog(`    ⚠ Кейс «${c.title}»: ${e instanceof Error ? e.message : "error"}`); }
            }
            for (const child of (suite.suites as Record<string, unknown>[]) ?? []) await createQaseSuiteTree(child, created.id);
          } catch (e: unknown) { addLog(`  ⚠ Сьют «${suite.title}»: ${e instanceof Error ? e.message : "error"}`); }
        };
        for (const root of data.suites as Record<string, unknown>[]) await createQaseSuiteTree(root, null);
        addLog("✅ Импорт завершён!");
        setImportDone(true);
        return;
      }

      if (data.version !== "1.0") { addLog("⚠ Неизвестная версия файла"); return; }
      const idMap: Record<string, string> = {};

      if (data.includes?.suites_cases && data.suites?.length) {
        addLog(`Создание сьютов (${data.suites.length})…`);
        const createSuiteTree = async (suite: Record<string, unknown>, parentId: string | null) => {
          try {
            const created = await suitesApi.create({
              name: suite.name as string,
              project_id: importProjectId,
              description: (suite.description as string) ?? undefined,
              parent_id: parentId,
            });
            idMap[suite.id as string] = created.id;
            addLog(`  ✓ ${suite.name}`);
            const children = (data.suites as Record<string, unknown>[]).filter((s) => s.parent_id === suite.id);
            for (const child of children) await createSuiteTree(child, created.id);
          } catch (e: unknown) { addLog(`  ⚠ Сьют «${suite.name}»: ${e instanceof Error ? e.message : "error"}`); }
        };
        const roots = (data.suites as Record<string, unknown>[]).filter((s: Record<string, unknown>) => !s.parent_id);
        for (const root of roots) await createSuiteTree(root, null);
      }

      if (data.includes?.suites_cases && data.cases?.length) {
        addLog(`Создание тест-кейсов (${data.cases.length})…`);
        for (const c of data.cases as Record<string, unknown>[]) {
          try {
            const newSuiteId = c.test_suite_id ? idMap[c.test_suite_id as string] : null;
            const created = await casesApi.create({
              ...(c as any),
              id: undefined, revision: undefined,
              project_id: importProjectId,
              test_suite_id: newSuiteId,
            });
            idMap[c.id as string] = created.id;
            addLog(`  ✓ ${c.name}`);
          } catch (e: unknown) { addLog(`  ⚠ Кейс «${c.name}»: ${e instanceof Error ? e.message : "error"}`); }
        }
      }

      if (data.includes?.plans && data.plans?.length) {
        addLog(`Создание тест-планов (${data.plans.length})…`);
        for (const p of data.plans as Record<string, unknown>[]) {
          try {
            const created = await plansApi.create({
              name: p.name as string,
              description: p.description as string ?? null,
              references: p.references as string ?? null,
              project_id: importProjectId,
              status: (p.status as any) ?? "active",
              start_date: p.start_date as string ?? null,
              end_date: p.end_date as string ?? null,
            });
            idMap[p.id as string] = created.id;
            const newIds = ((p.case_ids as string[]) ?? []).map((id) => idMap[id]).filter(Boolean);
            if (newIds.length) await plansApi.setCases(created.id, newIds);
            addLog(`  ✓ ${p.name}`);
          } catch (e: unknown) { addLog(`  ⚠ Тест-план «${p.name}»: ${e instanceof Error ? e.message : "error"}`); }
        }
      }

      if (data.includes?.runs && data.runs?.length) {
        addLog(`Создание тест-прогонов (${data.runs.length})…`);
        for (const r of data.runs as Record<string, unknown>[]) {
          try {
            const newIds = ((r.case_ids as string[]) ?? []).map((id) => idMap[id]).filter(Boolean);
            await runsApi.create({
              name: r.name as string,
              description: (r.description as string) ?? undefined,
              project_id: importProjectId,
              test_plan_id: null,
              test_case_ids: newIds.length ? newIds : undefined,
            });
            addLog(`  ✓ ${r.name}`);
          } catch (e: unknown) { addLog(`  ⚠ Прогон «${r.name}»: ${e instanceof Error ? e.message : "error"}`); }
        }
      }

      addLog("✅ Импорт завершён!");
      setImportDone(true);
    } catch (e: unknown) {
      addLog(`❌ Ошибка: ${e instanceof Error ? e.message : "unknown"}`);
    } finally { setImporting(false); }
  };

  return (
    <div>
      <div className="settings-section-header">
        <div>
          <h2 className="settings-section-title">Экспорт / Импорт</h2>
          <p className="settings-section-desc">Перенос тест-кейсов, планов и прогонов между проектами или серверами</p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Export */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "20px 24px" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>⬇ Экспорт</h3>
          <label className="form-label" style={{ display: "block", marginBottom: 14 }}>
            Проект-источник
            <select className="input" style={{ width: "100%", marginTop: 4 }}
              value={srcProject} onChange={(e) => setSrcProject(e.target.value)}>
              <option value="">— Выберите проект —</option>
              {allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div style={{ marginBottom: 14 }}>
            <div className="form-label" style={{ marginBottom: 8 }}>Формат экспорта</div>
            {([
              { key: "4qa", label: "Стандарт 4QA (полный бэкап: сьюты, кейсы, планы, прогоны)" },
              { key: "qase", label: "Qase JSON (только сьюты + тест-кейсы, для импорта в Qase.io)" },
            ] as const).map((opt) => (
              <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="radio" name="exportFormat" checked={exportFormat === opt.key} onChange={() => setExportFormat(opt.key)} />
                {opt.label}
              </label>
            ))}
          </div>
          {exportFormat === "4qa" && (
            <div style={{ marginBottom: 14 }}>
              <div className="form-label" style={{ marginBottom: 8 }}>Что экспортировать</div>
              {([
                { key: "sc", label: "Сьюты + Тест-кейсы", checked: inclSuitesCases, set: setInclSuitesCases },
                { key: "pl", label: "Тест-планы", checked: inclPlans, set: setInclPlans },
                { key: "ru", label: "Тест-прогоны", checked: inclRuns, set: setInclRuns },
              ] as const).map((opt) => (
                <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={opt.checked} onChange={(e) => opt.set(e.target.checked)} />
                  {opt.label}
                </label>
              ))}
            </div>
          )}
          {exportMsg && (
            <div style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, marginBottom: 10,
              background: exportMsg.startsWith("✓") ? "var(--color-bg-soft)" : "#fee2e2",
              color: exportMsg.startsWith("✓") ? "var(--color-passed)" : "#dc2626" }}>
              {exportMsg}
            </div>
          )}
          <button className="btn btn-primary" disabled={!srcProject || exporting} onClick={doExport}>
            {exporting ? "Экспортируем…" : "⬇ Скачать JSON"}
          </button>
          <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 12, lineHeight: 1.6 }}>
            Файл содержит полную структуру: сьюты, тест-кейсы с шагами, планы с кейсами.
            Подходит для переноса на другой компьютер или резервной копии.
          </p>
        </div>

        {/* Import */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "20px 24px" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>⬆ Импорт</h3>
          <label className="form-label" style={{ display: "block", marginBottom: 14 }}>
            Целевой проект
            <select className="input" style={{ width: "100%", marginTop: 4 }}
              value={importProjectId} onChange={(e) => setImportProjectId(e.target.value)}>
              <option value="">— Выберите проект —</option>
              {allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div style={{ marginBottom: 14 }}>
            <div className="form-label" style={{ marginBottom: 6 }}>JSON файл резервной копии</div>
            <label style={{ display: "inline-block", padding: "6px 12px", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12, cursor: "pointer", background: "var(--color-bg-soft)" }}>
              📁 {importFile ? importFile.name : "Выбрать файл…"}
              <input type="file" accept=".json" style={{ display: "none" }}
                onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setImportLog([]); setImportDone(false); }} />
            </label>
          </div>
          {importLog.length > 0 && (
            <div style={{ marginBottom: 12, padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-bg-soft)", maxHeight: 180, overflowY: "auto", fontSize: 11, fontFamily: "monospace", lineHeight: 1.7 }}>
              {importLog.map((line, idx) => <div key={idx}>{line}</div>)}
            </div>
          )}
          <button className="btn btn-primary" disabled={!importFile || !importProjectId || importing} onClick={doImport}>
            {importing ? "Импортируем…" : "⬆ Импортировать"}
          </button>
          {importDone && <div style={{ fontSize: 12, color: "var(--color-passed)", fontWeight: 600, marginTop: 8 }}>✅ Импорт завершён успешно</div>}
          <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 12, lineHeight: 1.6 }}>
            Загрузите JSON из экспорта. Данные добавятся в выбранный проект.
            Существующие данные не изменяются.
          </p>
        </div>
      </div>

      <PlanRunImportCard projects={allProjects} />
    </div>
  );
}

// ── Импорт отдельного тест-плана / тест-прогона (файлы 4qa_plan_*.json / 4qa_run_*.json) ──

function PlanRunImportCard({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [bundle, setBundle] = useState<TransferBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reuseExisting, setReuseExisting] = useState(true);
  const [includePlan, setIncludePlan] = useState(true);
  const [importing, setImporting] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [resultPath, setResultPath] = useState<string | null>(null);

  const pick = async (f: File | null) => {
    setFile(f); setBundle(null); setError(null); setLog([]); setResultPath(null);
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!isTransferBundle(data)) {
        throw new Error("Это не экспорт тест-плана / тест-прогона. Файл проекта импортируйте в блоке «⬆ Импорт» выше.");
      }
      setBundle(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл");
    }
  };

  const run = async () => {
    if (!bundle || !projectId) return;
    setImporting(true); setError(null); setLog([]); setResultPath(null);
    try {
      const res = await importTransferBundle(projectId, bundle, { reuseExisting, includePlan });
      setLog([...res.lines, "✅ Импорт завершён!"]);
      setResultPath(res.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Импорт не удался");
    } finally { setImporting(false); }
  };

  const meta = (bundle?.kind === "test_run" ? bundle.run : bundle?.plan) as { name?: string; source_display_id?: string } | undefined;
  const count = (k: string) => (Array.isArray(bundle?.[k]) ? (bundle![k] as unknown[]).length : 0);
  const isRun = bundle?.kind === "test_run";

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "20px 24px", marginTop: 24 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700 }}>⬆ Импорт тест-плана / тест-прогона</h3>
      <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 16px", lineHeight: 1.6 }}>
        Файлы <code>4qa_plan_….json</code> и <code>4qa_run_….json</code>, выгруженные кнопкой ⬇ на странице
        тест-плана или тест-прогона в другой инсталляции TMS4QA. Тип определяется автоматически;
        недостающие сьюты и тест-кейсы создаются в выбранном проекте.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <label className="form-label" style={{ display: "block", marginBottom: 14 }}>
            Целевой проект
            <select className="input" style={{ width: "100%", marginTop: 4 }}
              value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Выберите проект —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div style={{ marginBottom: 14 }}>
            <div className="form-label" style={{ marginBottom: 6 }}>JSON файл плана или прогона</div>
            <label style={{ display: "inline-block", padding: "6px 12px", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12, cursor: "pointer", background: "var(--color-bg-soft)" }}>
              📁 {file ? file.name : "Выбрать файл…"}
              <input type="file" accept=".json,application/json" style={{ display: "none" }}
                onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </label>
          </div>
          {bundle && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14, fontSize: 13 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={reuseExisting} onChange={(e) => setReuseExisting(e.target.checked)} />
                Переиспользовать существующие кейсы (то же название в том же сьюте)
              </label>
              {isRun && !!bundle.plan && (
                <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={includePlan} onChange={(e) => setIncludePlan(e.target.checked)} />
                  Создать и тест-план, из которого был создан прогон
                </label>
              )}
            </div>
          )}
          <button className="btn btn-primary" disabled={!bundle || !projectId || importing} onClick={run}>
            {importing ? "Импортируем…" : isRun ? "⬆ Импортировать прогон" : bundle ? "⬆ Импортировать план" : "⬆ Импортировать"}
          </button>
        </div>

        <div>
          {error && (
            <div style={{ fontSize: 12, padding: "8px 10px", borderRadius: 6, marginBottom: 10, background: "#fee2e2", color: "#dc2626", wordBreak: "break-word" }}>
              ⚠ {error}
            </div>
          )}
          {bundle && (
            <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--color-bg-soft)", border: "1px solid var(--color-border)", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12, marginBottom: 10 }}>
              <span style={{ color: "var(--color-text-muted)" }}>Тип</span><b>{isRun ? "Тест-прогон" : "Тест-план"}</b>
              <span style={{ color: "var(--color-text-muted)" }}>Название</span><span>{meta?.name ?? "—"}</span>
              <span style={{ color: "var(--color-text-muted)" }}>Исходный проект</span><span>{bundle.source_project ?? "—"}</span>
              <span style={{ color: "var(--color-text-muted)" }}>Экспортирован</span><span>{new Date(bundle.exported_at).toLocaleString("ru-RU")}</span>
              <span style={{ color: "var(--color-text-muted)" }}>Тест-кейсов</span><span>{count("cases")}</span>
              {isRun && (
                <>
                  <span style={{ color: "var(--color-text-muted)" }}>Результатов</span><span>{count("results")}</span>
                  <span style={{ color: "var(--color-text-muted)" }}>Дефектов</span><span>{count("defects")}</span>
                  <span style={{ color: "var(--color-text-muted)" }}>Чек-листов</span><span>{count("checklists")}</span>
                </>
              )}
            </div>
          )}
          {log.length > 0 && (
            <div style={{ marginBottom: 10, padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-bg-soft)", fontSize: 11, fontFamily: "monospace", lineHeight: 1.7 }}>
              {log.map((line, idx) => <div key={idx}>{line}</div>)}
            </div>
          )}
          {resultPath && (
            <button className="btn" onClick={() => navigate(resultPath)}>
              Открыть {isRun ? "прогон" : "план"} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Full Project Export/Import (SUPER_ADMIN) ──────────────────────────────────

function FullBackupTab() {
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [orgs, setOrgs] = useState<OrgOut[]>([]);
  const [srcProject, setSrcProject] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importProjectName, setImportProjectName] = useState("");
  const [importOrgId, setImportOrgId] = useState("");
  const [importLog, setImportLog] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  useEffect(() => {
    projectsApi.list().then(setAllProjects).catch(() => {});
    orgsApi.listAll().then(setOrgs).catch(() => {});
  }, []);

  const doFullExport = async () => {
    if (!srcProject) return;
    setExporting(true); setExportMsg(null);
    try {
      const proj = allProjects.find((p) => p.id === srcProject);
      if (!proj) return;
      const payload = await buildFullProjectExport(proj);
      downloadJSON(payload, fullProjectExportFilename(proj));
      setExportMsg(`✓ Полный экспорт завершён (${payload.cases.length} кейсов, ${payload.suites.length} сьютов, ${payload.requirements.length} требований)`);
    } catch (e) {
      setExportMsg(`⚠ Ошибка: ${e instanceof Error ? e.message : "unknown"}`);
    } finally { setExporting(false); }
  };

  const doFullImport = async () => {
    if (!importFile || !importOrgId) return;
    setImporting(true); setImportDone(false);
    const log: string[] = [];
    const addLog = (msg: string) => { log.push(msg); setImportLog([...log]); };
    try {
      const text = await importFile.text();
      const data = JSON.parse(text);
      if (data.version !== "2.0") { addLog("⚠ Файл не является полным экспортом (ожидается version 2.0)"); return; }

      const idMap: Record<string, string> = {};
      const projectName = importProjectName.trim() || (data.project?.name ?? "Imported Project");

      // Set org context for SUPER_ADMIN
      const prevOrg = orgStore.get();
      const targetOrg = orgs.find((o) => o.id === importOrgId);
      if (targetOrg) orgStore.set(targetOrg.id, targetOrg.name);

      // 1. Create project
      addLog(`Создание проекта «${projectName}»…`);
      const newProject = await projectsApi.create({
        name: projectName,
        description: data.project?.description ?? null,
        abbreviation: data.project?.abbreviation ?? projectName.slice(0, 4).toUpperCase(),
        is_private: data.project?.is_private ?? false,
      });
      const newPid = newProject.id;
      addLog(`  ✓ Проект создан: ${newProject.name} (${newPid})`);

      // 2. Create suites (tree)
      if (data.suites?.length) {
        addLog(`Создание сьютов (${data.suites.length})…`);
        const createSuiteTree = async (suite: Record<string, unknown>, parentId: string | null) => {
          try {
            const created = await suitesApi.create({ name: suite.name as string, project_id: newPid, description: (suite.description as string) ?? undefined, parent_id: parentId });
            idMap[suite.id as string] = created.id;
            addLog(`  ✓ Сьют: ${suite.name}`);
            const children = (data.suites as Record<string, unknown>[]).filter((s) => s.parent_id === suite.id);
            for (const child of children) await createSuiteTree(child, created.id);
          } catch (e) { addLog(`  ⚠ Сьют «${suite.name}»: ${e instanceof Error ? e.message : "err"}`); }
        };
        const roots = (data.suites as Record<string, unknown>[]).filter((s) => !s.parent_id);
        for (const root of roots) await createSuiteTree(root, null);
      }

      // 3. Create test cases
      if (data.cases?.length) {
        addLog(`Создание тест-кейсов (${data.cases.length})…`);
        for (const c of data.cases as Record<string, unknown>[]) {
          try {
            const created = await casesApi.create({ ...(c as any), id: undefined, revision: undefined, display_seq: undefined, project_id: newPid, test_suite_id: c.test_suite_id ? (idMap[c.test_suite_id as string] ?? null) : null });
            idMap[c.id as string] = created.id;
          } catch (e) { addLog(`  ⚠ Кейс «${c.name}»: ${e instanceof Error ? e.message : "err"}`); }
        }
        addLog(`  ✓ ${data.cases.length} тест-кейсов`);
      }

      // 4. Create requirements (tree)
      if (data.requirements?.length) {
        addLog(`Создание требований (${data.requirements.length})…`);
        const createReqTree = async (req: Record<string, unknown>, parentId: string | null) => {
          try {
            const created = await requirementsApi.create({ title: req.title as string, project_id: newPid, description: (req.description as string) ?? null, req_type: req.req_type as any ?? "requirement", parent_id: parentId, status: req.status as any, priority: req.priority as any, external_url: req.external_url as string ?? null });
            idMap[req.id as string] = created.id;
            if ((req.case_ids as string[])?.length) {
              const newCaseIds = ((req.case_ids as string[]) ?? []).map((id) => idMap[id]).filter(Boolean);
              if (newCaseIds.length) await requirementsApi.setTestCases(created.id, newCaseIds).catch(() => {});
            }
            const children = (data.requirements as Record<string, unknown>[]).filter((r) => r.parent_id === req.id);
            for (const child of children) await createReqTree(child, created.id);
          } catch (e) { addLog(`  ⚠ Требование «${req.title}»: ${e instanceof Error ? e.message : "err"}`); }
        };
        const roots = (data.requirements as Record<string, unknown>[]).filter((r) => !r.parent_id);
        for (const root of roots) await createReqTree(root, null);
        addLog(`  ✓ ${data.requirements.length} требований`);
      }

      // 5. Create releases
      if (data.releases?.length) {
        addLog(`Создание релизов (${data.releases.length})…`);
        for (const r of data.releases as Record<string, unknown>[]) {
          try {
            const newReqIds = ((r.requirement_ids as string[]) ?? []).map((id) => idMap[id]).filter(Boolean);
            const created = await releasesApi.create({ project_id: newPid, name: r.name as string, version: r.version as string ?? "1.0", description: (r.description as string) ?? null, environment: r.environment as string ?? null, status: r.status as string ?? "planned", release_date: r.release_date as string ?? null, requirement_ids: newReqIds });
            idMap[r.id as string] = created.id;
          } catch (e) { addLog(`  ⚠ Релиз «${r.name}»: ${e instanceof Error ? e.message : "err"}`); }
        }
        addLog(`  ✓ ${data.releases.length} релизов`);
      }

      // 6. Create test plans
      if (data.plans?.length) {
        addLog(`Создание тест-планов (${data.plans.length})…`);
        for (const p of data.plans as Record<string, unknown>[]) {
          try {
            const created = await plansApi.create({ name: p.name as string, description: (p.description as string) ?? null, references: (p.references as string) ?? null, project_id: newPid, status: (p.status as any) ?? "active", start_date: (p.start_date as string) ?? null, end_date: (p.end_date as string) ?? null });
            idMap[p.id as string] = created.id;
            const newIds = ((p.case_ids as string[]) ?? []).map((id) => idMap[id]).filter(Boolean);
            if (newIds.length) await plansApi.setCases(created.id, newIds).catch(() => {});
          } catch (e) { addLog(`  ⚠ Тест-план «${p.name}»: ${e instanceof Error ? e.message : "err"}`); }
        }
        addLog(`  ✓ ${data.plans.length} тест-планов`);
      }

      // 7. Create test runs (without restoring results to keep it simple)
      if (data.runs?.length) {
        addLog(`Создание тест-прогонов (${data.runs.length})…`);
        for (const r of data.runs as Record<string, unknown>[]) {
          try {
            const results = (r.results as Record<string, unknown>[]) ?? [];
            const newCaseIds = results.map((res) => idMap[res.test_case_id as string]).filter(Boolean);
            await runsApi.create({ name: r.name as string, description: (r.description as string) ?? undefined, project_id: newPid, test_plan_id: null, test_case_ids: newCaseIds.length ? newCaseIds : undefined });
          } catch (e) { addLog(`  ⚠ Прогон «${r.name}»: ${e instanceof Error ? e.message : "err"}`); }
        }
        addLog(`  ✓ ${data.runs.length} тест-прогонов`);
      }

      // Restore org context
      if (prevOrg) orgStore.set(prevOrg.id, prevOrg.name);
      else orgStore.clear();

      addLog("✅ Полный импорт завершён!");
      setImportDone(true);
    } catch (e) {
      addLog(`❌ Ошибка: ${e instanceof Error ? e.message : "unknown"}`);
    } finally { setImporting(false); }
  };

  return (
    <div>
      <div className="settings-section-header">
        <div>
          <h2 className="settings-section-title">Полный экспорт / Импорт проекта</h2>
          <p className="settings-section-desc">Перенос всего проекта: сьюты, кейсы, требования, релизы, планы, прогоны</p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

        {/* Full Export */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "20px 24px" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>⬇ Полный экспорт</h3>
          <label className="form-label" style={{ display: "block", marginBottom: 14 }}>
            Проект-источник
            <select className="input" style={{ width: "100%", marginTop: 4 }} value={srcProject} onChange={(e) => setSrcProject(e.target.value)}>
              <option value="">— Выберите проект —</option>
              {allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {exportMsg && (
            <div style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, marginBottom: 10, background: exportMsg.startsWith("✓") ? "var(--color-bg-soft)" : "#fee2e2", color: exportMsg.startsWith("✓") ? "var(--color-passed)" : "#dc2626" }}>
              {exportMsg}
            </div>
          )}
          <button className="btn btn-primary" disabled={!srcProject || exporting} onClick={doFullExport}>
            {exporting ? "Экспортируем…" : "⬇ Скачать полный JSON"}
          </button>
          <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 12, lineHeight: 1.6 }}>
            Включает: все сьюты, тест-кейсы (с шагами и API-полями), требования (иерархия + связи с кейсами), релизы, тест-планы, тест-прогоны.
          </p>
        </div>

        {/* Full Import */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "20px 24px" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>⬆ Полный импорт</h3>
          <label className="form-label" style={{ display: "block", marginBottom: 14 }}>
            Организация (целевая)
            <select className="input" style={{ width: "100%", marginTop: 4 }} value={importOrgId} onChange={(e) => setImportOrgId(e.target.value)}>
              <option value="">— Выберите организацию —</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="form-label" style={{ display: "block", marginBottom: 14 }}>
            Название проекта <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>(оставьте пустым для оригинального)</span>
            <input className="input" style={{ width: "100%", marginTop: 4 }} placeholder="Новое название или оставить пустым" value={importProjectName} onChange={(e) => setImportProjectName(e.target.value)} />
          </label>
          <div style={{ marginBottom: 14 }}>
            <div className="form-label" style={{ marginBottom: 6 }}>Файл полного экспорта (version 2.0)</div>
            <label style={{ display: "inline-block", padding: "6px 12px", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12, cursor: "pointer", background: "var(--color-bg-soft)" }}>
              📁 {importFile ? importFile.name : "Выбрать файл…"}
              <input type="file" accept=".json" style={{ display: "none" }} onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setImportLog([]); setImportDone(false); }} />
            </label>
          </div>
          {importLog.length > 0 && (
            <div style={{ marginBottom: 12, padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-bg-soft)", maxHeight: 200, overflowY: "auto", fontSize: 11, fontFamily: "monospace", lineHeight: 1.7 }}>
              {importLog.map((line, idx) => <div key={idx}>{line}</div>)}
            </div>
          )}
          <button className="btn btn-primary" disabled={!importFile || !importOrgId || importing} onClick={doFullImport}>
            {importing ? "Импортируем…" : "⬆ Импортировать проект"}
          </button>
          {importDone && <div style={{ fontSize: 12, color: "var(--color-passed)", fontWeight: 600, marginTop: 8 }}>✅ Импорт завершён успешно</div>}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "roles" | "general" | "backup" | "full-backup";

export default function SettingsPage() {
  const navigate = useNavigate();
  const currentUser = authApi.getCachedUser();
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";
  const [tab, setTab] = useState<Tab>("roles");

  const navItems = [
    { id: "roles",       icon: "🔑", label: "Роли и доступ" },
    { id: "general",     icon: "⚙",  label: "Общие" },
    { id: "backup",      icon: "💾", label: "Экспорт / Импорт" },
    ...(isSuperAdmin ? [{ id: "full-backup", icon: "📦", label: "Полный экспорт" }] : []),
  ] as { id: Tab; icon: string; label: string }[];

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={() => navigate(-1)}
            title="Назад"
          >
            ← Назад
          </button>
          <h1 className="settings-title" style={{ margin: 0 }}>Settings</h1>
        </div>
        <p className="settings-subtitle">Настройки и управление ролями</p>
      </div>

      <div className="settings-layout">
        {/* Sidebar */}
        <nav className="settings-nav">
          {navItems.map((n) => (
            <button key={n.id} className={`settings-nav-item${tab === n.id ? " is-active" : ""}`}
              onClick={() => setTab(n.id)}>
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="settings-content">
          {tab === "roles" && <RolesTab />}

          {tab === "backup" && <BackupTab />}

          {tab === "full-backup" && isSuperAdmin && <FullBackupTab />}

          {tab === "general" && (
            <div className="settings-general">
              <div className="settings-section-header">
                <div>
                  <h2 className="settings-section-title">Общие настройки</h2>
                  <p className="settings-section-desc">Системные параметры приложения</p>
                </div>
              </div>
              <div className="sg-items">
                <div className="sg-item">
                  <div className="sg-item-label">Версия приложения</div>
                  <div className="sg-item-value" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong>4QA TMS v1.3.0</strong>
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", background: "var(--color-bg-soft)", padding: "1px 6px", borderRadius: 4, border: "1px solid var(--color-border)" }}>2026-05-30</span>
                  </div>
                </div>
                <div className="sg-item">
                  <div className="sg-item-label">История версий</div>
                  <div className="sg-item-value" style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                    v1.3.0 — JWT Auth, SUPER_ADMIN multi-org, Team columns in Projects<br/>
                    v1.2.0 — Workspace, Bulk Import, App Customization, Export defects<br/>
                    v1.1.0 — Report templates, Shared Steps, Releases<br/>
                    v1.0.0 — Первый релиз (TestCases, Plans, Runs, Defects, Requirements)
                  </div>
                </div>
                <div className="sg-item">
                  <div className="sg-item-label">Auth provider</div>
                  <div className="sg-item-value">JWT (HS256) — bcrypt passwords</div>
                </div>
                <div className="sg-item">
                  <div className="sg-item-label">Database</div>
                  <div className="sg-item-value">PostgreSQL 15 (localhost:5434)</div>
                </div>
                <div className="sg-item">
                  <div className="sg-item-label">Backend API</div>
                  <div className="sg-item-value">FastAPI /api/v1</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
