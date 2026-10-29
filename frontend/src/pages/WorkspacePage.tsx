import { useEffect, useMemo, useRef, useState } from "react";
import { authApi, orgsApi, orgStore, type OrgOut, type UserFull } from "../api/client";
import "./WorkspacePage.css";
import { useToast } from "../components/Toast";
import { ROLE_META, NON_SA_ROLES, roleMeta } from "../constants/roles";
import { auditApi, type AuditLogEntry } from "../api/client";

const ALL_ROLES = NON_SA_ROLES;

function userInitials(u: UserFull) {
  if (u.first_name && u.last_name) return (u.first_name[0] + u.last_name[0]).toUpperCase();
  if (u.name?.trim()) {
    const p = u.name.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : p[0].slice(0, 2).toUpperCase();
  }
  return (u.email || "??").slice(0, 2).toUpperCase();
}

function userDisplayName(u: UserFull) {
  if (u.first_name || u.last_name) return [u.first_name, u.last_name].filter(Boolean).join(" ");
  return u.name || u.username || u.email;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
type WsTab = "organization" | "organizations" | "users" | "groups" | "roles" | "security" | "billing";

// ── Main ──────────────────────────────────────────────────────────────────────
export default function WorkspacePage() {
  const currentUser = authApi.getCachedUser();
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";
  const isOwner = currentUser?.role === "OWNER";
  const canManageUsers = isSuperAdmin || isOwner;
  const toast = useToast();

  const defaultTab: WsTab = isSuperAdmin ? "organizations" : isOwner ? "organization" : "users";
  const [tab, setTab] = useState<WsTab>(defaultTab);
  const [search, setSearch] = useState("");

  // ── Orgs state (SUPER_ADMIN) ──
  const [orgs, setOrgs] = useState<OrgOut[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(
    () => orgStore.get()?.id ?? currentUser?.organization_id ?? null
  );

  // ── Users state ──
  const [users, setUsers] = useState<UserFull[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  // ── Invite modal ──
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", first_name: "", last_name: "", role: "TESTER", password: "" });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // ── Change role inline ──
  const [editRoleUserId, setEditRoleUserId] = useState<string | null>(null);
  const editRoleRef = useRef<HTMLDivElement>(null);

  // ── Edit contact modal ──
  const [editContactUser, setEditContactUser] = useState<UserFull | null>(null);
  const [editContactForm, setEditContactForm] = useState({ email: "", phone: "", telegram: "" });
  const [editContactSaving, setEditContactSaving] = useState(false);
  const [editContactError, setEditContactError] = useState<string | null>(null);

  // ── Rename org (SUPER_ADMIN) ──
  const [editOrgId, setEditOrgId] = useState<string | null>(null);
  const [editOrgName, setEditOrgName] = useState("");
  const [editOrgSaving, setEditOrgSaving] = useState(false);

  // ── New org modal (SUPER_ADMIN) ──
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const [newOrgForm, setNewOrgForm] = useState({ name: "", owner_email: "", owner_password: "", owner_first_name: "", owner_last_name: "" });
  const [newOrgSaving, setNewOrgSaving] = useState(false);
  const [newOrgError, setNewOrgError] = useState<string | null>(null);

  // ── Audit log (SUPER_ADMIN) ──
  const [auditOrgId, setAuditOrgId] = useState<string>("");
  const [auditLimit, setAuditLimit] = useState<number>(50);
  const [auditAction, setAuditAction] = useState<string>("");
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);

  // ── Organization settings (OWNER) ──
  const [ownerOrg, setOwnerOrg] = useState<OrgOut | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [orgSettingsSaving, setOrgSettingsSaving] = useState(false);

  // Load all orgs for SUPER_ADMIN
  useEffect(() => {
    if (!isSuperAdmin) return;
    setOrgsLoading(true);
    orgsApi.listAll().then((data) => { setOrgs(data); setOrgsLoading(false); }).catch(() => setOrgsLoading(false));
  }, [isSuperAdmin]);

  // Load org for OWNER
  useEffect(() => {
    if (!isOwner) return;
    const orgId = currentUser?.organization_id;
    if (!orgId) return;
    orgsApi.getOrg(orgId).then((o) => {
      setOwnerOrg(o);
      setWebsiteUrl(o.website_url ?? "");
    }).catch(() => {});
  }, [isOwner, currentUser?.organization_id]);

  // Sync when orgStore changes from TopBar
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; name: string } | null;
      setSelectedOrgId(detail?.id ?? null);
    };
    window.addEventListener("tms:orgchange", handler);
    return () => window.removeEventListener("tms:orgchange", handler);
  }, []);

  // Load users when org selected
  useEffect(() => {
    if (!selectedOrgId) { setUsers([]); return; }
    setUsersLoading(true);
    setUsersError(null);
    orgsApi.listUsers(selectedOrgId)
      .then((data) => { setUsers(data); setUsersLoading(false); })
      .catch((e) => { setUsersError(String(e)); setUsersLoading(false); });
  }, [selectedOrgId]);

  // Close role dropdown on outside click
  useEffect(() => {
    if (!editRoleUserId) return;
    const close = (e: MouseEvent) => {
      if (editRoleRef.current && !editRoleRef.current.contains(e.target as Node)) setEditRoleUserId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [editRoleUserId]);

  const filtered = useMemo(() =>
    users.filter((u) => !search ||
      userDisplayName(u).toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    ), [users, search]);

  const selectOrg = (id: string, name: string) => {
    orgStore.set(id, name);
    setSelectedOrgId(id);
  };

  const handleInvite = async () => {
    if (!inviteForm.email || !inviteForm.password) return;
    setInviteSaving(true);
    setInviteError(null);
    try {
      const newUser = await orgsApi.inviteUser(inviteForm);
      setUsers((prev) => [...prev, newUser]);
      setInviteOpen(false);
      setInviteForm({ email: "", first_name: "", last_name: "", role: "TESTER", password: "" });
    } catch (e) {
      setInviteError(String(e));
    } finally {
      setInviteSaving(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    setEditRoleUserId(null);
    try {
      const updated = await orgsApi.changeRole(userId, role);
      setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u));
    } catch (e) {
      alert("Ошибка смены роли: " + e);
    }
  };

  const openEditContact = (u: UserFull) => {
    setEditContactUser(u);
    setEditContactForm({ email: u.email, phone: u.phone ?? "", telegram: u.telegram ?? "" });
    setEditContactError(null);
  };

  const handleEditContact = async () => {
    if (!editContactUser) return;
    setEditContactSaving(true);
    setEditContactError(null);
    try {
      const updated = await orgsApi.updateContact(editContactUser.id, {
        email: editContactForm.email || undefined,
        phone: editContactForm.phone || undefined,
        telegram: editContactForm.telegram || undefined,
      });
      setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u));
      setEditContactUser(null);
    } catch (e) {
      setEditContactError(String(e));
    } finally {
      setEditContactSaving(false);
    }
  };

  const handleDeactivate = async (userId: string) => {
    if (!confirm("Деактивировать пользователя?")) return;
    try {
      const updated = await orgsApi.deactivate(userId);
      setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u));
    } catch (e) {
      alert("Ошибка: " + e);
    }
  };

  const handleSaveOrgSettings = async () => {
    if (!ownerOrg) return;
    setOrgSettingsSaving(true);
    try {
      const updated = await orgsApi.updateOrgSettings(ownerOrg.id, { website_url: websiteUrl || null });
      setOwnerOrg(updated);
      setWebsiteUrl(updated.website_url ?? "");
      toast.success("Настройки сохранены");
    } catch (e) {
      toast.error("Ошибка сохранения: " + e);
    } finally {
      setOrgSettingsSaving(false);
    }
  };

  const handleRenameOrg = async () => {
    if (!editOrgId || !editOrgName.trim()) return;
    setEditOrgSaving(true);
    try {
      const updated = await orgsApi.renameOrg(editOrgId, editOrgName.trim());
      setOrgs((prev) => prev.map((o) => o.id === updated.id ? updated : o));
      setEditOrgId(null);
      toast.success("Организация переименована");
    } catch (e) {
      toast.error("Ошибка: " + e);
    } finally {
      setEditOrgSaving(false);
    }
  };

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    setAuditLoaded(false);
    try {
      const data = await auditApi.list({
        limit: auditLimit,
        org_id: auditOrgId || undefined,
        action: auditAction.trim() || undefined,
      });
      setAuditLogs(data);
      setAuditLoaded(true);
    } catch (e) {
      toast.error("Ошибка загрузки логов: " + e);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleNewOrg = async () => {
    if (!newOrgForm.name || !newOrgForm.owner_email || !newOrgForm.owner_password) return;
    setNewOrgSaving(true);
    setNewOrgError(null);
    try {
      const org = await orgsApi.createWithOwner(newOrgForm);
      setOrgs((prev) => [...prev, org]);
      setNewOrgOpen(false);
      setNewOrgForm({ name: "", owner_email: "", owner_password: "", owner_first_name: "", owner_last_name: "" });
    } catch (e) {
      setNewOrgError(String(e));
    } finally {
      setNewOrgSaving(false);
    }
  };

  const WS_ICONS: Record<WsTab, JSX.Element> = {
    organizations: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M9 21V7l6-4v18"/><path d="M3 21V11l6-4"/><path d="M15 21V3l6 4v14"/></svg>,
    organization:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
    users:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75"/><path d="M21 21v-2a4 4 0 00-3-3.87"/></svg>,
    groups:   <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
    roles:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
    security: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    billing:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  };

  type NavItem = { id: WsTab; label: string; superAdminOnly?: boolean; ownerOnly?: boolean };
  const NAV: NavItem[] = ([
    { id: "organizations", label: "Organizations", superAdminOnly: true },
    { id: "organization",  label: "Organization",  ownerOnly: true },
    { id: "users",    label: "Users" },
    { id: "groups",   label: "Groups" },
    { id: "roles",    label: "Roles" },
    { id: "security", label: "Security" },
    { id: "billing",  label: "Plan & Billing" },
  ] as NavItem[]).filter((item) => {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    if (item.ownerOnly && !isOwner) return false;
    return true;
  });

  return (
    <div className="ws-page">
      {/* Left nav */}
      <aside className="ws-sidebar">
        <div className="ws-nav-group">WORKSPACE</div>
        {NAV.map((item) => (
          <button key={item.id} className={"ws-nav-item" + (tab === item.id ? " is-active" : "")} onClick={() => setTab(item.id)}>
            <span className="ws-nav-icon">{WS_ICONS[item.id]}</span>
            {item.label}
          </button>
        ))}
      </aside>

      {/* Content */}
      <div className="ws-content">

        {/* ── Organizations (SUPER_ADMIN) ── */}
        {tab === "organizations" && (
          <>
            <div className="ws-content-header">
              <div className="ws-search-row">
                <h2 className="ws-content-title" style={{ margin: 0 }}>Организации</h2>
                <button className="btn btn-primary" onClick={() => setNewOrgOpen(true)}>+ New Organization</button>
              </div>
            </div>
            {orgsLoading ? (
              <div className="ws-empty">Загрузка…</div>
            ) : orgs.length === 0 ? (
              <div className="ws-empty">Нет организаций. Создайте первую.</div>
            ) : (
              <table className="ws-table">
                <thead>
                  <tr><th>НАЗВАНИЕ</th><th>ID</th><th></th></tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id} className="ws-table-row">
                      <td style={{ fontWeight: 600 }}>
                        {editOrgId === o.id ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              className="input"
                              style={{ fontSize: 13, padding: "2px 8px", width: 220 }}
                              value={editOrgName}
                              autoFocus
                              onChange={(e) => setEditOrgName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRenameOrg();
                                if (e.key === "Escape") setEditOrgId(null);
                              }}
                            />
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                              onClick={handleRenameOrg}
                              disabled={editOrgSaving || !editOrgName.trim()}
                            >
                              {editOrgSaving ? "…" : "✓"}
                            </button>
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                              onClick={() => setEditOrgId(null)}
                            >
                              ✕
                            </button>
                          </div>
                        ) : o.name}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "monospace" }}>{o.id}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            className="btn"
                            style={{ fontSize: 11, padding: "3px 10px" }}
                            onClick={() => { setEditOrgId(o.id); setEditOrgName(o.name); }}
                          >
                            ✏ Переименовать
                          </button>
                          <button
                            className="btn"
                            style={{ fontSize: 11, padding: "3px 10px" }}
                            onClick={() => { selectOrg(o.id, o.name); setTab("users"); }}
                          >
                            Управление →
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="ws-table-footer">{orgs.length} организаций</div>
          </>
        )}

        {/* ── Organization (OWNER) ── */}
        {tab === "organization" && (
          <>
            <div className="ws-content-header">
              <h2 className="ws-content-title">Организация</h2>
            </div>
            <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Read-only org name */}
              <div style={{ padding: "16px 20px", border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-bg)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--color-text-muted)", marginBottom: 8 }}>
                  Название организации
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)" }}>
                  {ownerOrg?.name ?? "—"}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                  Для изменения названия обратитесь к Super Admin.
                </div>
              </div>

              {/* Website URL */}
              <div style={{ padding: "16px 20px", border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-bg)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--color-text-muted)", marginBottom: 12 }}>
                  Настройки
                </div>
                <label className="form-label" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Адрес сайта</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      type="url"
                      placeholder="https://example.com"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                    />
                  </div>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    Публичный сайт организации. Отображается в профиле.
                  </span>
                </label>
                <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveOrgSettings}
                    disabled={orgSettingsSaving}
                  >
                    {orgSettingsSaving ? "Сохранение…" : "Сохранить"}
                  </button>
                  <button
                    className="btn"
                    onClick={() => setWebsiteUrl(ownerOrg?.website_url ?? "")}
                    disabled={orgSettingsSaving}
                  >
                    Отмена
                  </button>
                </div>
              </div>

              {/* Org ID (read-only for reference) */}
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", padding: "0 4px" }}>
                ID организации: <code style={{ fontFamily: "monospace", fontSize: 11 }}>{ownerOrg?.id}</code>
              </div>
            </div>
          </>
        )}

        {/* ── Users ── */}
        {tab === "users" && (
          <>
            <div className="ws-content-header">
              {/* Org selector for SUPER_ADMIN */}
              {isSuperAdmin && (
                <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Организация:</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {orgs.map((o) => (
                      <button
                        key={o.id}
                        className={"btn" + (selectedOrgId === o.id ? " btn-primary" : "")}
                        style={{ fontSize: 12, padding: "3px 10px" }}
                        onClick={() => selectOrg(o.id, o.name)}
                      >
                        {o.name}
                      </button>
                    ))}
                    {orgs.length === 0 && (
                      <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                        Нет организаций — <button className="btn" style={{ fontSize: 12 }} onClick={() => setTab("organizations")}>создать</button>
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="ws-search-row">
                <input
                  className="input"
                  placeholder="Поиск по имени или email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: 260 }}
                />
                <button
                  className="btn btn-primary"
                  disabled={!selectedOrgId}
                  onClick={() => setInviteOpen(true)}
                >
                  + Добавить пользователя
                </button>
              </div>
            </div>

            {!selectedOrgId ? (
              <div className="ws-empty">
                {isSuperAdmin ? "Выберите организацию выше, чтобы увидеть пользователей." : "Организация не настроена."}
              </div>
            ) : usersLoading ? (
              <div className="ws-empty">Загрузка…</div>
            ) : usersError ? (
              <div className="ws-empty" style={{ color: "var(--color-danger, #dc2626)" }}>{usersError}</div>
            ) : filtered.length === 0 ? (
              <div className="ws-empty">{search ? "Не найдено." : "Нет пользователей."}</div>
            ) : (
              <table className="ws-table">
                <thead>
                  <tr>
                    <th>ПОЛЬЗОВАТЕЛЬ</th>
                    <th>РОЛЬ</th>
                    <th>СТАТУС</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const rm = roleMeta(u.role);
                    const isMe = u.id === currentUser?.id;
                    return (
                      <tr key={u.id} className="ws-table-row">
                        <td>
                          <div className="ws-member-cell">
                            <div className="ws-avatar" style={{ background: rm.bg, color: rm.color }}>
                              {userInitials(u)}
                            </div>
                            <div>
                              <div className="ws-member-name">
                                {userDisplayName(u)}
                                {isMe && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--color-text-muted)" }}>(вы)</span>}
                              </div>
                              <div className="ws-member-email">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {/* Inline role selector */}
                          <div style={{ position: "relative", display: "inline-block" }} ref={editRoleUserId === u.id ? editRoleRef : undefined}>
                            <span
                              className="ws-role-badge"
                              style={{ background: rm.bg, color: rm.color, cursor: isMe ? "default" : "pointer" }}
                              title={isMe ? "" : "Нажмите для смены роли"}
                              onClick={() => !isMe && setEditRoleUserId(editRoleUserId === u.id ? null : u.id)}
                            >
                              {rm.label} {!isMe && <span style={{ opacity: .5, fontSize: 10 }}>▾</span>}
                            </span>
                            {editRoleUserId === u.id && (
                              <div style={{
                                position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 300,
                                background: "var(--color-surface)", border: "1px solid var(--color-border)",
                                borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.12)", minWidth: 140, overflow: "hidden",
                              }}>
                                {(isSuperAdmin ? Object.keys(ROLE_META) : ALL_ROLES).map((r) => (
                                  <button
                                    key={r}
                                    style={{
                                      display: "block", width: "100%", padding: "7px 12px",
                                      textAlign: "left", fontSize: 13, background: u.role === r ? "var(--color-accent-soft)" : "none",
                                      border: "none", cursor: "pointer", color: "var(--color-text)",
                                    }}
                                    onClick={() => handleRoleChange(u.id, r)}
                                  >
                                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: ROLE_META[r]?.color ?? "#999", marginRight: 6 }} />
                                    {ROLE_META[r]?.label ?? r}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          <span style={{
                            fontSize: 12, padding: "2px 8px", borderRadius: 99, fontWeight: 600,
                            background: u.is_active ? "#dcfce7" : "#fee2e2",
                            color: u.is_active ? "#15803d" : "#dc2626",
                          }}>
                            {u.is_active ? "Активен" : "Деактивирован"}
                          </span>
                        </td>
                        <td>
                          {canManageUsers && (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <button
                                className="btn"
                                style={{ fontSize: 11, padding: "3px 8px" }}
                                onClick={() => openEditContact(u)}
                                title="Редактировать контакт"
                              >
                                ✏ Редактировать
                              </button>
                              {!isMe && u.is_active && (
                                <button
                                  className="btn"
                                  style={{ fontSize: 11, padding: "3px 8px", color: "#dc2626" }}
                                  onClick={() => handleDeactivate(u.id)}
                                >
                                  Деактивировать
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="ws-table-footer">{filtered.length} пользователей</div>
          </>
        )}

        {/* ── Groups ── */}
        {tab === "groups" && (
          <div className="ws-stub">
            <div className="ws-stub-icon">🗂</div>
            <h2>Groups</h2>
            <p>Группируйте участников для удобного управления правами доступа.</p>
            <span className="ws-stub-badge">В разработке</span>
          </div>
        )}

        {/* ── Roles ── */}
        {tab === "roles" && (
          <>
            <div className="ws-content-header">
              <h2 className="ws-content-title">Роли</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
              {Object.entries(ROLE_META).filter(([role]) => isSuperAdmin || role !== "SUPER_ADMIN").map(([role, meta]) => (
                <div key={role} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-bg)" }}>
                  <span className="ws-role-badge" style={{ background: meta.bg, color: meta.color, fontSize: 12, padding: "3px 10px" }}>{meta.label}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                      {role === "SUPER_ADMIN" ? "Системный администратор. Управление организациями и пользователями." :
                       role === "OWNER"       ? "Владелец организации. Полный доступ ко всем проектам и настройкам." :
                       role === "PM"          ? "Менеджер проектов. Управление планами, релизами и командой." :
                       role === "QA_LEAD"     ? "Ведущий QA. Полный доступ к тест-кейсам, прогонам и дефектам." :
                       role === "TESTER"      ? "Тестировщик. Выполнение тест-прогонов и создание дефектов." :
                       role === "ANALYST"     ? "Аналитик. Управление требованиями и traceability-матрицей." :
                       role === "DEVELOPER"   ? "Разработчик. Просмотр тест-кейсов, работа с дефектами." :
                                               "Технический директор. Полный доступ только для чтения + отчёты."}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    {users.filter((u) => u.role === role).length > 0 ? `${users.filter((u) => u.role === role).length} чел.` : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Security ── */}
        {tab === "security" && (
          <>
            <div className="ws-content-header">
              <h2 className="ws-content-title">Security</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 780 }}>

              {/* SSO */}
              <div style={{ padding: "14px 18px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-bg)" }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>🔑 Single Sign-On (SSO)</div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Интеграция с Keycloak. Управление токенами и SAML/OIDC.</div>
                <div style={{ marginTop: 10 }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>В разработке</span></div>
              </div>

              {/* Audit Log */}
              <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-bg)", overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>📋 Audit Log</span>
                  {!isSuperAdmin && (
                    <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>— доступен только SUPER_ADMIN</span>
                  )}
                </div>

                {isSuperAdmin && (
                  <div style={{ padding: "14px 18px" }}>
                    {/* Filters */}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, alignItems: "flex-end" }}>
                      <label className="form-label" style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: ".05em" }}>Организация</span>
                        <select className="input" style={{ fontSize: 12 }} value={auditOrgId} onChange={(e) => setAuditOrgId(e.target.value)}>
                          <option value="">Все организации</option>
                          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </label>
                      <label className="form-label" style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: ".05em" }}>Действие</span>
                        <input className="input" style={{ fontSize: 12 }} placeholder="login, create_user…" value={auditAction} onChange={(e) => setAuditAction(e.target.value)} />
                      </label>
                      <label className="form-label" style={{ display: "flex", flexDirection: "column", gap: 4, width: 110 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: ".05em" }}>Кол-во записей</span>
                        <select className="input" style={{ fontSize: 12 }} value={auditLimit} onChange={(e) => setAuditLimit(Number(e.target.value))}>
                          {[10, 25, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                      <button className="btn btn-primary" style={{ fontSize: 12, alignSelf: "flex-end" }} onClick={loadAuditLogs} disabled={auditLoading}>
                        {auditLoading ? "Загрузка…" : "Загрузить логи"}
                      </button>
                    </div>

                    {/* Table */}
                    {auditLoaded && (
                      <>
                        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>
                          Показано: {auditLogs.length} записей
                        </div>
                        {auditLogs.length === 0 ? (
                          <div style={{ padding: "20px 0", textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>Нет записей</div>
                        ) : (
                          <div style={{ overflowX: "auto" }}>
                            <table className="ws-table" style={{ fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th style={{ whiteSpace: "nowrap" }}>Дата</th>
                                  <th>Пользователь</th>
                                  <th>Действие</th>
                                  <th>Тип объекта</th>
                                  <th>ID объекта</th>
                                  <th>IP</th>
                                </tr>
                              </thead>
                              <tbody>
                                {auditLogs.map((log) => (
                                  <tr key={log.id} className="ws-table-row">
                                    <td style={{ whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 11 }}>
                                      {new Date(log.created_at).toLocaleString("ru-RU")}
                                    </td>
                                    <td>
                                      {log.actor_email ? (
                                        <div>
                                          <div style={{ fontWeight: 600 }}>{log.actor_name || log.actor_email}</div>
                                          {log.actor_name && <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{log.actor_email}</div>}
                                        </div>
                                      ) : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                                    </td>
                                    <td>
                                      <span style={{ fontFamily: "monospace", fontSize: 11, background: "var(--color-bg-soft)", padding: "1px 6px", borderRadius: 3 }}>
                                        {log.action}
                                      </span>
                                    </td>
                                    <td style={{ color: "var(--color-text-muted)" }}>{log.entity_type || "—"}</td>
                                    <td style={{ fontFamily: "monospace", fontSize: 10, color: "var(--color-text-muted)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {log.entity_id || "—"}
                                    </td>
                                    <td style={{ fontFamily: "monospace", fontSize: 11, color: "var(--color-text-muted)" }}>
                                      {log.ip_address || "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Billing ── */}
        {tab === "billing" && (
          <>
            <div className="ws-content-header">
              <h2 className="ws-content-title">План и оплата</h2>
            </div>
            <div style={{ maxWidth: 600 }}>
              <div style={{ padding: "20px 24px", border: "2px solid var(--color-accent)", borderRadius: 12, background: "var(--color-accent-soft)", marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--color-accent)" }}>Текущий план</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>Business</div>
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Управление подпиской — в разработке.</div>
            </div>
          </>
        )}
      </div>

      {/* ── Invite modal ── */}
      {inviteOpen && (
        <div className="modal-backdrop" onClick={() => setInviteOpen(false)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Добавить пользователя</h2>
              <button className="btn-icon" onClick={() => setInviteOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="form-label">Имя
                  <input className="input" style={{ width: "100%", marginTop: 4 }} value={inviteForm.first_name} onChange={(e) => setInviteForm({ ...inviteForm, first_name: e.target.value })} placeholder="Иван" />
                </label>
                <label className="form-label">Фамилия
                  <input className="input" style={{ width: "100%", marginTop: 4 }} value={inviteForm.last_name} onChange={(e) => setInviteForm({ ...inviteForm, last_name: e.target.value })} placeholder="Петров" />
                </label>
              </div>
              <label className="form-label">Email *
                <input className="input" style={{ width: "100%", marginTop: 4 }} type="email" autoFocus value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="user@company.com" />
              </label>
              <label className="form-label">Пароль *
                <input className="input" style={{ width: "100%", marginTop: 4 }} type="password" value={inviteForm.password} onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })} placeholder="••••••••" />
              </label>
              <label className="form-label">Роль
                <select className="input" style={{ width: "100%", marginTop: 4 }} value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
                  {(isSuperAdmin ? Object.keys(ROLE_META) : ALL_ROLES).map((r) => (
                    <option key={r} value={r}>{ROLE_META[r]?.label ?? r}</option>
                  ))}
                </select>
              </label>
              {inviteError && <div className="login-error">{inviteError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleInvite} disabled={inviteSaving || !inviteForm.email || !inviteForm.password}>
                {inviteSaving ? "Создание…" : "Создать"}
              </button>
              <button className="btn" onClick={() => setInviteOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit contact modal ── */}
      {editContactUser && (
        <div className="modal-backdrop" onClick={() => setEditContactUser(null)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Редактировать контакт</h2>
              <button className="btn-icon" onClick={() => setEditContactUser(null)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 4 }}>
                {userDisplayName(editContactUser)}
              </div>
              <label className="form-label">Email
                <input
                  className="input"
                  style={{ width: "100%", marginTop: 4 }}
                  type="email"
                  autoFocus
                  value={editContactForm.email}
                  onChange={(e) => setEditContactForm({ ...editContactForm, email: e.target.value })}
                  placeholder="user@company.com"
                />
              </label>
              <label className="form-label">Телефон
                <input
                  className="input"
                  style={{ width: "100%", marginTop: 4 }}
                  type="tel"
                  value={editContactForm.phone}
                  onChange={(e) => setEditContactForm({ ...editContactForm, phone: e.target.value })}
                  placeholder="+7 999 000 00 00"
                />
              </label>
              <label className="form-label">Telegram
                <input
                  className="input"
                  style={{ width: "100%", marginTop: 4 }}
                  value={editContactForm.telegram}
                  onChange={(e) => setEditContactForm({ ...editContactForm, telegram: e.target.value })}
                  placeholder="@username"
                />
              </label>
              {editContactError && <div className="login-error">{editContactError}</div>}
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={handleEditContact}
                disabled={editContactSaving || !editContactForm.email}
              >
                {editContactSaving ? "Сохранение…" : "Сохранить"}
              </button>
              <button className="btn" onClick={() => setEditContactUser(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* ── New org modal (SUPER_ADMIN) ── */}
      {newOrgOpen && (
        <div className="modal-backdrop" onClick={() => setNewOrgOpen(false)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Новая организация</h2>
              <button className="btn-icon" onClick={() => setNewOrgOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="form-label">Название организации *
                <input className="input" style={{ width: "100%", marginTop: 4 }} autoFocus value={newOrgForm.name} onChange={(e) => setNewOrgForm({ ...newOrgForm, name: e.target.value })} placeholder="Acme Corp" />
              </label>
              <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--color-text-muted)" }}>OWNER аккаунт</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="form-label">Имя
                  <input className="input" style={{ width: "100%", marginTop: 4 }} value={newOrgForm.owner_first_name} onChange={(e) => setNewOrgForm({ ...newOrgForm, owner_first_name: e.target.value })} placeholder="Иван" />
                </label>
                <label className="form-label">Фамилия
                  <input className="input" style={{ width: "100%", marginTop: 4 }} value={newOrgForm.owner_last_name} onChange={(e) => setNewOrgForm({ ...newOrgForm, owner_last_name: e.target.value })} placeholder="Петров" />
                </label>
              </div>
              <label className="form-label">Email OWNER *
                <input className="input" style={{ width: "100%", marginTop: 4 }} type="email" value={newOrgForm.owner_email} onChange={(e) => setNewOrgForm({ ...newOrgForm, owner_email: e.target.value })} placeholder="owner@company.com" />
              </label>
              <label className="form-label">Пароль OWNER *
                <input className="input" style={{ width: "100%", marginTop: 4 }} type="password" value={newOrgForm.owner_password} onChange={(e) => setNewOrgForm({ ...newOrgForm, owner_password: e.target.value })} placeholder="••••••••" />
              </label>
              {newOrgError && <div className="login-error">{newOrgError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleNewOrg} disabled={newOrgSaving || !newOrgForm.name || !newOrgForm.owner_email || !newOrgForm.owner_password}>
                {newOrgSaving ? "Создание…" : "Создать"}
              </button>
              <button className="btn" onClick={() => setNewOrgOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
