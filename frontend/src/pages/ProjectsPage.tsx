import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { projectsApi, releasesApi, orgsApi, authApi, orgStore, type Project, type Release, type OrgOut, type UserFull } from "../api/client";
import ProjectFormModal from "../components/ProjectFormModal";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { buildFullProjectExport, downloadJSON, fullProjectExportFilename } from "../utils/exportFormats";
import "./ProjectsPage.css";

// ── Palette ─────────────────────────────────────────────────────────────────
const SWATCHES = [
  { bg: "#f5ddb3", fg: "#92400e" }, // amber
  { bg: "#dbeafe", fg: "#1e40af" }, // blue
  { bg: "#c7e5cd", fg: "#166534" }, // green
  { bg: "#fce7f3", fg: "#9d174d" }, // pink
  { bg: "#ede9fe", fg: "#5b21b6" }, // violet
  { bg: "#ffedd5", fg: "#9a3412" }, // orange
  { bg: "#cffafe", fg: "#155e75" }, // cyan
  { bg: "#fee2e2", fg: "#991b1b" }, // red
];
function swatchFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

function relativeTime(iso?: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} mins ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} days ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB").replace(/\//g, "/");
}

type ViewMode = "table" | "cards";

export default function ProjectsPage() {
  const currentUser = authApi.getCachedUser();
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("projects_view") as ViewMode) ?? "table"
  );

  // SUPER_ADMIN org selector
  const [orgs, setOrgs] = useState<OrgOut[]>([]);
  const [activeOrg, setActiveOrg] = useState<{ id: string; name: string } | null>(() => orgStore.get());
  const [orgUsers, setOrgUsers] = useState<UserFull[]>([]);
  const reloadRef = useRef<() => void>(() => {});

  const reload = () => {
    if (isSuperAdmin && !orgStore.get()) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    projectsApi
      .list()
      .then(setProjects)
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  };
  reloadRef.current = reload;

  // Load orgs for SUPER_ADMIN
  useEffect(() => {
    if (!isSuperAdmin) return;
    orgsApi.listAll().then(setOrgs).catch(() => {});
  }, [isSuperAdmin]);

  // Load org users (for team column)
  useEffect(() => {
    const orgId = isSuperAdmin ? activeOrg?.id : currentUser?.organization_id;
    if (!orgId) { setOrgUsers([]); return; }
    orgsApi.listUsers(orgId).then(setOrgUsers).catch(() => setOrgUsers([]));
  }, [activeOrg?.id, isSuperAdmin, currentUser?.organization_id]);

  // Reload projects when org context changes
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; name: string } | null;
      setActiveOrg(detail);
      reloadRef.current();
    };
    window.addEventListener("tms:orgchange", handler);
    return () => window.removeEventListener("tms:orgchange", handler);
  }, []);

  useEffect(reload, []);

  const setView = (v: ViewMode) => {
    setViewMode(v);
    localStorage.setItem("projects_view", v);
  };

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (p: Project) => { setEditing(p); setFormOpen(true); };
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const remove = (p: Project) => setDeleteTarget(p);

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="prj-page">
      {/* ── SUPER_ADMIN org selector ── */}
      {isSuperAdmin && (
        <div className="prj-org-selector">
          <span className="prj-org-label">🏢 Организация:</span>
          <div className="prj-org-btns">
            {orgs.map((o) => (
              <button
                key={o.id}
                className={"btn" + (activeOrg?.id === o.id ? " btn-primary" : "")}
                style={{ fontSize: 12, padding: "3px 12px" }}
                onClick={() => { orgStore.set(o.id, o.name); }}
              >
                {o.name}
              </button>
            ))}
            {orgs.length === 0 && (
              <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Нет организаций</span>
            )}
          </div>
          {activeOrg && (
            <button
              className="btn"
              style={{ fontSize: 11, color: "var(--color-text-muted)", padding: "2px 8px" }}
              onClick={() => orgStore.clear()}
            >
              ✕ сбросить
            </button>
          )}
        </div>
      )}

      {/* ── Title row ── */}
      <div className="prj-title-row">
        <h1 className="prj-title">Projects</h1>
        <div className="prj-view-toggle">
          <button
            className={`prj-vbtn${viewMode === "table" ? " active" : ""}`}
            title="List view"
            onClick={() => setView("table")}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <rect x="1" y="2" width="13" height="2" rx=".5" fill="currentColor"/>
              <rect x="1" y="6.5" width="13" height="2" rx=".5" fill="currentColor"/>
              <rect x="1" y="11" width="13" height="2" rx=".5" fill="currentColor"/>
            </svg>
          </button>
          <button
            className={`prj-vbtn${viewMode === "cards" ? " active" : ""}`}
            title="Card view"
            onClick={() => setView("cards")}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <rect x="1" y="1" width="5.5" height="5.5" rx=".5" fill="currentColor"/>
              <rect x="8.5" y="1" width="5.5" height="5.5" rx=".5" fill="currentColor"/>
              <rect x="1" y="8.5" width="5.5" height="5.5" rx=".5" fill="currentColor"/>
              <rect x="8.5" y="8.5" width="5.5" height="5.5" rx=".5" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="prj-toolbar">
        <button className="btn btn-primary" onClick={openCreate}>
          + Create new project
        </button>
        <input
          className="input prj-search"
          placeholder="Search for projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="badge badge-untested">Status: Active</span>
        <span className="filter-link">Add filter</span>
      </div>

      {error && <div className="page-banner">⚠ {error}</div>}

      {isSuperAdmin && !activeOrg ? (
        <div className="prj-empty">
          Выберите организацию выше, чтобы видеть и создавать её проекты.
        </div>
      ) : loading ? (
        <div className="prj-empty">Загружаем…</div>
      ) : filtered.length === 0 ? (
        <div className="prj-empty">
          {projects.length === 0
            ? "Проектов пока нет — нажми «+ Create new project»."
            : "Ничего не найдено."}
        </div>
      ) : viewMode === "table" ? (
        <ListView
          projects={filtered}
          onEdit={openEdit}
          onDelete={remove}
          orgUsers={orgUsers}
          orgs={orgs}
          isSuperAdmin={isSuperAdmin}
        />
      ) : (
        <CardsView
          projects={filtered}
          onEdit={openEdit}
          onDelete={remove}
          orgUsers={orgUsers}
          orgs={orgs}
          isSuperAdmin={isSuperAdmin}
        />
      )}

      <ProjectFormModal
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
        isSuperAdmin={isSuperAdmin}
        orgs={orgs}
        activeOrgId={activeOrg?.id ?? null}
      />

      <DeleteProjectModal
        project={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={reload}
      />
    </div>
  );
}

// ── Delete project modal (с предложением бэкапа) ───────────────────────────

function DeleteProjectModal({ project, onClose, onDeleted }: { project: Project | null; onClose: () => void; onDeleted: () => void }) {
  const { success, error } = useToast();
  const [backingUp, setBackingUp] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    if (project) { setBackedUp(false); setBackingUp(false); setDeleting(false); setConfirmName(""); }
  }, [project]);

  if (!project) return null;

  const doBackup = async () => {
    setBackingUp(true);
    try {
      const payload = await buildFullProjectExport(project);
      downloadJSON(payload, fullProjectExportFilename(project));
      setBackedUp(true);
      success("Бэкап проекта скачан");
    } catch (e) {
      error(`Ошибка экспорта: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBackingUp(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await projectsApi.delete(project.id);
      success(`Проект «${project.name}» удалён`);
      onClose();
      onDeleted();
    } catch (e) {
      error(`Ошибка удаления: ${e instanceof Error ? e.message : "unknown"}`);
      setDeleting(false);
    }
  };

  const canDelete = confirmName.trim() === project.name;

  return (
    <Modal
      open={!!project}
      title={`Удалить проект «${project.name}»`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={deleting}>Отмена</button>
          <button
            className="btn btn-primary"
            style={{ background: "#dc2626", borderColor: "#dc2626" }}
            disabled={!canDelete || deleting}
            onClick={doDelete}
          >
            {deleting ? "Удаляем…" : "Удалить проект безвозвратно"}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: "var(--color-text)", lineHeight: 1.6, marginTop: 0 }}>
        Это действие удалит проект <strong>«{project.name}»</strong> и&nbsp;<strong>все</strong> связанные с ним данные:
        тест-сьюты, тест-кейсы, тест-планы, тест-прогоны и результаты, дефекты, требования, релизы.
        Отменить это действие будет невозможно.
      </p>

      <div style={{
        border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 14px",
        background: "var(--color-bg-soft)", marginBottom: 16,
      }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>💾 Рекомендуем сделать бэкап</div>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 10px", lineHeight: 1.6 }}>
          Скачайте полный экспорт проекта в JSON — его можно импортировать в новую систему
          (Настройки → Полный экспорт).
        </p>
        <button className="btn btn-secondary" disabled={backingUp} onClick={doBackup}>
          {backingUp ? "Экспортируем…" : backedUp ? "✓ Бэкап скачан — скачать ещё раз" : "⬇ Скачать бэкап проекта"}
        </button>
      </div>

      <label className="form-label" style={{ display: "block" }}>
        Чтобы подтвердить, введите название проекта: <strong>{project.name}</strong>
        <input
          className="input"
          style={{ width: "100%", marginTop: 6 }}
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={project.name}
          autoFocus
        />
      </label>
    </Modal>
  );
}

// ── List (table) view ───────────────────────────────────────────────────────

interface VP {
  projects: Project[];
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
  orgUsers?: UserFull[];
  orgs?: OrgOut[];
  isSuperAdmin?: boolean;
}

function userDisplayName(u: UserFull): string {
  if (u.first_name || u.last_name) return `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
  return u.name || u.email;
}

function TeamCell({ users }: { users: UserFull[] }) {
  const byRole = (...roles: string[]) => users.find(u => roles.includes(u.role ?? ""));
  const members = [
    { label: "Owner", key: "owner", user: byRole("OWNER") },
    { label: "PM",    key: "pm",    user: byRole("PM") },
    { label: "Dev",   key: "dev",   user: byRole("DEVELOPER", "CTO") },
    { label: "QA",    key: "qa",    user: byRole("QA_LEAD") },
  ].filter((m) => m.user) as Array<{ label: string; key: string; user: UserFull }>;

  if (!members.length) return <span className="prj-muted">—</span>;
  return (
    <div className="prj-team">
      {members.map(({ label, key, user }) => (
        <div key={key} className="prj-team-member">
          <span className={`prj-role-chip prj-role-${key}`}>{label}</span>
          <span className="prj-team-name" title={userDisplayName(user)}>{userDisplayName(user)}</span>
        </div>
      ))}
    </div>
  );
}

function ListView({ projects, onEdit, onDelete, orgUsers = [], orgs = [], isSuperAdmin }: VP) {
  const orgsMap = Object.fromEntries(orgs.map((o) => [o.id, o.name]));

  return (
    <table className="prj-table">
      <thead>
        <tr>
          <th style={{ width: 40 }}></th>
          <th>Project Name</th>
          <th>Description</th>
          <th style={{ width: 90 }}>Status</th>
          <th style={{ width: 160 }}>Team</th>
          <th style={{ width: 100 }}>Start Date</th>
          <th style={{ width: 110 }}>Last Activity</th>
          <th style={{ width: 200 }}>Progress</th>
          <th style={{ width: 90 }}>Visibility</th>
          <th style={{ width: 44 }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => {
          const sw = swatchFor(p.id);
          const initials = p.abbreviation || p.name.slice(0, 4).toUpperCase();
          const caseCount = (p as any).case_count ?? 0;
          const orgName = isSuperAdmin && p.organization_id ? orgsMap[p.organization_id] : null;
          return (
            <tr key={p.id} className="prj-row">
              <td>
                <span className="prj-badge" style={{ background: sw.bg, color: sw.fg }}>
                  {initials}
                </span>
              </td>
              <td>
                <div className="prj-name-cell">
                  <Link to={`/project/${p.id}/dashboard`} className="prj-name-link">
                    {p.name}
                  </Link>
                  {orgName && <span className="prj-org-badge">{orgName}</span>}
                </div>
              </td>
              <td className="prj-desc-cell">
                <span className="prj-desc">{p.description || "—"}</span>
              </td>
              <td>
                <span className="prj-status prj-status-active">Active</span>
              </td>
              <td>
                <TeamCell users={orgUsers} />
              </td>
              <td className="prj-muted">{formatDate((p as any).created_at)}</td>
              <td className="prj-muted">{relativeTime((p as any).updated_at)}</td>
              <td>
                <CoverageCell total={caseCount} />
              </td>
              <td>
                {p.is_private ? (
                  <span className="prj-vis prj-vis-private">🔒 Private</span>
                ) : (
                  <span className="prj-vis prj-vis-public">🌐 Public</span>
                )}
              </td>
              <td>
                <div className="prj-actions">
                  <button className="prj-act-btn" title="Settings" onClick={() => onEdit(p)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                    </svg>
                  </button>
                  <button className="prj-act-btn prj-act-del" title="Delete" onClick={() => onDelete(p)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Cards view ──────────────────────────────────────────────────────────────

function CardsView({ projects, onEdit, onDelete, orgUsers = [], orgs = [], isSuperAdmin }: VP) {
  const orgsMap = Object.fromEntries(orgs.map((o) => [o.id, o.name]));
  const owner = orgUsers.find((u) => u.role === "OWNER");
  const [releasesMap, setReleasesMap] = useState<Record<string, Release[]>>({});

  useEffect(() => {
    if (projects.length === 0) return;
    Promise.all(
      projects.map((p) =>
        releasesApi.list(p.id).then((rels) => ({ id: p.id, rels })).catch(() => ({ id: p.id, rels: [] as Release[] }))
      )
    ).then((results) => {
      const map: Record<string, Release[]> = {};
      for (const { id, rels } of results) map[id] = rels;
      setReleasesMap(map);
    });
  }, [projects]);

  return (
    <div className="prj-cards">
      {projects.map((p) => {
        const sw = swatchFor(p.id);
        const initials = p.abbreviation || p.name.slice(0, 4).toUpperCase();
        const caseCount = (p as any).case_count ?? 0;
        const rels = releasesMap[p.id] ?? [];
        const upcoming = rels.find((r) => r.status === "in_progress") ?? rels.find((r) => r.status === "planned");
        const lastReleased = [...rels].filter((r) => r.status === "released").sort((a, b) =>
          (b.release_date ?? b.created_at).localeCompare(a.release_date ?? a.created_at)
        )[0];
        return (
          <div key={p.id} className="prj-card">
            <div className="prj-card-top">
              <span className="prj-badge prj-badge-lg" style={{ background: sw.bg, color: sw.fg }}>
                {initials}
              </span>
              {owner && (
                <span className="prj-card-role" title={userDisplayName(owner)}>
                  {userDisplayName(owner).split(" ")[0]}
                </span>
              )}
            </div>

            <div className="prj-name-cell">
              <Link to={`/project/${p.id}/dashboard`} className="prj-card-name">
                {p.name}
              </Link>
              {isSuperAdmin && p.organization_id && orgsMap[p.organization_id] && (
                <span className="prj-org-badge">{orgsMap[p.organization_id]}</span>
              )}
            </div>

            <p className="prj-card-desc">
              {p.description || <span style={{ color: "var(--color-text-subtle)" }}>No description</span>}
            </p>

            <div className="prj-card-stats">
              <div className="prj-stat">
                <div className="prj-stat-val">{caseCount}</div>
                <div className="prj-stat-lbl">CASES</div>
              </div>
            </div>

            {(upcoming || lastReleased) && (
              <div className="prj-card-releases">
                {upcoming && (
                  <div className={`prj-release-badge prj-release-${upcoming.status}`}>
                    <span className="prj-release-icon">{upcoming.status === "in_progress" ? "🚀" : "📅"}</span>
                    <span className="prj-release-name">{upcoming.name}</span>
                    {upcoming.release_date && (
                      <span className="prj-release-date">{formatDate(upcoming.release_date)}</span>
                    )}
                  </div>
                )}
                {lastReleased && (
                  <div className="prj-release-badge prj-release-released">
                    <span className="prj-release-icon">✅</span>
                    <span className="prj-release-name">{lastReleased.name}</span>
                    {lastReleased.release_date && (
                      <span className="prj-release-date">{formatDate(lastReleased.release_date)}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="prj-card-footer">
              <span className="prj-no-failed">No failed cases</span>
              {p.is_private ? (
                <span className="prj-vis prj-vis-private prj-vis-sm">🔒 Private</span>
              ) : (
                <span className="prj-vis prj-vis-public prj-vis-sm">🌐 Public</span>
              )}
            </div>

            <div className="prj-card-hover-actions">
              <button className="prj-act-btn" title="Edit" onClick={() => onEdit(p)}>✎</button>
              <button className="prj-act-btn prj-act-del" title="Delete" onClick={() => onDelete(p)}>🗑</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Coverage cell ────────────────────────────────────────────────────────────

function CoverageCell({ total }: { total: number }) {
  if (total === 0) return <span className="prj-muted" style={{ fontSize: 12 }}>No cases</span>;
  return (
    <div className="prj-coverage">
      <span className="prj-cov-total">📋 Total: {total} cases</span>
      <span className="prj-cov-passed">✅ Passed: 0%</span>
      <span className="prj-cov-failed">🔴 Failed: 0 cases</span>
    </div>
  );
}
