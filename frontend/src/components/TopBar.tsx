import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { runsApi, authApi, orgsApi, orgStore, type AuthUser, type OrgOut } from "../api/client";
import { loadCustomization } from "../pages/AppsPage";
import { LOGIN_CFG_KEY, LOGIN_IMG_KEY, type LoginPageCfg, defaultLoginCfg, getLoginCfg } from "../pages/LoginPage";
import "./TopBar.css";

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

type ViewMode = "auto" | "mobile" | "desktop";

interface TopBarProps {
  showBurger?: boolean;
  onBurgerClick?: () => void;
}

function getUserInitials(u: AuthUser | null): string {
  if (!u) return "??";
  if (u.first_name && u.last_name) return (u.first_name[0] + u.last_name[0]).toUpperCase();
  if (u.name && u.name.trim()) {
    const parts = u.name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
  }
  return (u.email || "??").slice(0, 2).toUpperCase();
}

function getUserDisplayName(u: AuthUser | null): string {
  if (!u) return "Demo User";
  if (u.first_name || u.last_name) return [u.first_name, u.last_name].filter(Boolean).join(" ");
  return u.name || u.username || u.email || "User";
}

export default function TopBar({ showBurger, onBurgerClick }: TopBarProps) {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  const [profileOpen, setProfileOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => authApi.getCachedUser());
  const [orgs, setOrgs] = useState<OrgOut[]>([]);
  const [activeOrg, setActiveOrg] = useState<{ id: string; name: string } | null>(() => orgStore.get());
  const [orgDropOpen, setOrgDropOpen] = useState(false);
  const orgDropRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("view-mode") as ViewMode) || "auto"
  );
  const [loginSettingsOpen, setLoginSettingsOpen] = useState(false);
  const [loginCfg, setLoginCfg] = useState<LoginPageCfg>(() => getLoginCfg());

  const updateLoginCfg = (patch: Partial<LoginPageCfg>) => {
    setLoginCfg((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(LOGIN_CFG_KEY, JSON.stringify(next));
      return next;
    });
  };

  const location = useLocation();
  const navigate = useNavigate();

  // Extract projectId from current URL path like /project/:projectId/...
  const projectIdMatch = location.pathname.match(/\/project\/([^/]+)\//);
  const currentProjectId = projectIdMatch?.[1] ?? null;

  const [activeRun, setActiveRun] = useState<{ id: string; name: string; startedAt: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [completionFlash, setCompletionFlash] = useState(false);
  const prevRunIdRef = useRef<string | null>(null);

  // Sync user data when profile menu opens
  useEffect(() => {
    if (profileOpen) {
      const cached = authApi.getCachedUser();
      if (cached) setCurrentUser(cached);
    }
  }, [profileOpen]);

  // Load orgs for SUPER_ADMIN
  useEffect(() => {
    if (!isSuperAdmin) return;
    orgsApi.listAll().then(setOrgs).catch(() => {});
  }, [isSuperAdmin]);


  // Listen for org changes (e.g. from WorkspacePage)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setActiveOrg(detail);
    };
    window.addEventListener("tms:orgchange", handler);
    return () => window.removeEventListener("tms:orgchange", handler);
  }, []);

  // Close org dropdown on outside click
  useEffect(() => {
    if (!orgDropOpen) return;
    const close = (e: MouseEvent) => {
      if (orgDropRef.current && !orgDropRef.current.contains(e.target as Node)) setOrgDropOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [orgDropOpen]);

  // Close mobile nav menu on outside click
  useEffect(() => {
    if (!navMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (navMenuRef.current && !navMenuRef.current.contains(e.target as Node)) setNavMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [navMenuOpen]);

  // Close mobile nav menu on route change
  useEffect(() => {
    setNavMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    setProfileOpen(false);
    await authApi.logout();
    navigate("/login");
  };

  // Poll for in_progress runs — every 5s so indicator disappears quickly on completion
  useEffect(() => {
    if (!currentProjectId) { setActiveRun(null); return; }
    let cancelled = false;

    const poll = async () => {
      try {
        const runs = await runsApi.list(currentProjectId);
        if (cancelled) return;
        const inProgress = runs.find((r) => r.status === "in_progress") ?? null;
        const newRunId = inProgress?.id ?? null;

        // Detect transition: was active → now gone → flash briefly
        if (prevRunIdRef.current && !newRunId) {
          setCompletionFlash(true);
          setTimeout(() => setCompletionFlash(false), 2500);
        }
        prevRunIdRef.current = newRunId;

        setActiveRun(inProgress ? { id: inProgress.id, name: inProgress.name, startedAt: inProgress.started_at } : null);
      } catch { /* ignore */ }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [currentProjectId]);

  // Elapsed timer
  useEffect(() => {
    if (!activeRun) { setElapsed(0); return; }
    const start = new Date(activeRun.startedAt).getTime();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeRun]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const apply = (mode: ViewMode) => {
      if (mode === "mobile") {
        document.documentElement.classList.add("is-mobile-view");
      } else if (mode === "desktop") {
        document.documentElement.classList.remove("is-mobile-view");
      } else {
        if (window.innerWidth <= 768) {
          document.documentElement.classList.add("is-mobile-view");
        } else {
          document.documentElement.classList.remove("is-mobile-view");
        }
      }
    };
    localStorage.setItem("view-mode", viewMode);
    apply(viewMode);
    if (viewMode === "auto") {
      const handleResize = () => apply("auto");
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!profileOpen) return;
    const close = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [profileOpen]);

  const viewModeLabel: Record<ViewMode, string> = {
    auto: "Авто",
    mobile: "Mobile",
    desktop: "Desktop",
  };
  const nextViewMode: ViewMode =
    viewMode === "auto" ? "mobile" : viewMode === "mobile" ? "desktop" : "auto";

  const renderNavLinks = () => (
    <>
      <NavLink to="/projects" className={({ isActive }) => isActive ? "topbar-link active" : "topbar-link"}>Projects</NavLink>
      <NavLink to="/workspace" className={({ isActive }) => isActive ? "topbar-link active" : "topbar-link"}>Workspace</NavLink>
      <NavLink to="/dashboards" className={({ isActive }) => isActive ? "topbar-link active" : "topbar-link"}>Dashboards</NavLink>
      <NavLink to="/apps" className={({ isActive }) => isActive ? "topbar-link active" : "topbar-link"}>Apps</NavLink>
    </>
  );

  return (
    <>
    <header className="topbar">
      {/* Mobile-only kebab menu for the Projects/Workspace/Dashboards/Apps nav */}
      <div className="topbar-navmenu-wrap" ref={navMenuRef}>
        <button
          className="topbar-navmenu-btn"
          onClick={() => setNavMenuOpen((v) => !v)}
          aria-label="Меню разделов"
          title="Меню разделов"
        >
          ⋮
        </button>
        {navMenuOpen && (
          <div className="topbar-navmenu">
            {renderNavLinks()}
          </div>
        )}
      </div>
      {showBurger && (
        <button
          className="topbar-burger"
          onClick={onBurgerClick}
          aria-label="Открыть меню"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      )}
      <Link to="/projects" className="topbar-logo">
        {(() => {
          const custom = loadCustomization();
          if (custom.logoImageBase64) {
            return <img src={custom.logoImageBase64} alt={custom.logoText || "4QA"} style={{ height: 26, maxWidth: 90, objectFit: "contain" }} />;
          }
          return <span className="topbar-logo-mark">{custom.logoText || "4QA"}</span>;
        })()}
      </Link>
      <nav className="topbar-nav">
        {renderNavLinks()}
      </nav>
      {/* SUPER_ADMIN org selector */}
      {isSuperAdmin && (
        <div className="topbar-org-wrap" ref={orgDropRef}>
          <button
            className={"topbar-org-btn" + (activeOrg ? "" : " topbar-org-btn--empty")}
            onClick={() => setOrgDropOpen((v) => !v)}
            title="Выбрать организацию"
          >
            <span className="topbar-org-icon">🏢</span>
            <span className="topbar-org-name">{activeOrg ? activeOrg.name : "Org не выбрана"}</span>
            <span className="topbar-org-caret">▾</span>
          </button>
          {orgDropOpen && (
            <div className="topbar-org-menu">
              <div className="topbar-org-menu-header">Организация</div>
              {orgs.length === 0 && (
                <div className="topbar-org-menu-empty">Нет организаций</div>
              )}
              {orgs.map((o) => (
                <button
                  key={o.id}
                  className={"topbar-org-menu-item" + (activeOrg?.id === o.id ? " is-active" : "")}
                  onClick={() => { orgStore.set(o.id, o.name); setOrgDropOpen(false); }}
                >
                  {o.name}
                  {activeOrg?.id === o.id && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
                </button>
              ))}
              {activeOrg && (
                <>
                  <div className="topbar-profile-divider" />
                  <button className="topbar-org-menu-item topbar-org-menu-item--clear" onClick={() => { orgStore.clear(); setOrgDropOpen(false); }}>
                    Сбросить выбор
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="topbar-right">
        {/* Active run indicator */}
        {activeRun && currentProjectId && (
          <button
            className="topbar-active-run"
            title={`Активный прогон: ${activeRun.name}`}
            onClick={() => navigate(`/project/${currentProjectId}/run/${activeRun.id}`)}
          >
            <span className="topbar-run-dot" />
            <span className="topbar-run-name">{activeRun.name.length > 22 ? activeRun.name.slice(0, 22) + "…" : activeRun.name}</span>
            <span className="topbar-run-timer">{fmtElapsed(elapsed)}</span>
          </button>
        )}
        {/* Flash: run completed */}
        {completionFlash && !activeRun && (
          <div className="topbar-run-completed" title="Тестовый прогон завершён">
            ✓ Прогон завершён
          </div>
        )}

        <button className="topbar-icon" aria-label="Notifications">🔔</button>
        <button className="topbar-icon" aria-label="Messages">💬</button>

        <div className="topbar-profile-wrap" ref={profileRef}>
          <button className="topbar-avatar" onClick={() => setProfileOpen((v) => !v)} title="Profile">
            {getUserInitials(currentUser)}
          </button>
          {profileOpen && (
            <div className="topbar-profile-menu">
              <div className="topbar-profile-header">
                <div className="topbar-profile-avatar">{getUserInitials(currentUser)}</div>
                <div>
                  <div className="topbar-profile-name">{getUserDisplayName(currentUser)}</div>
                  <div className="topbar-profile-email">{currentUser?.email || "—"}</div>
                </div>
              </div>
              <div className="topbar-profile-divider" />
              <button className="topbar-profile-item" onClick={() => setDark((v) => !v)}>
                <span>{dark ? "☀️" : "🌙"}</span>
                <span>{dark ? "Светлая тема" : "Тёмная тема"}</span>
                <span className="topbar-theme-badge">{dark ? "Светлая" : "Тёмная"}</span>
              </button>
              <button className="topbar-profile-item" onClick={() => setViewMode(nextViewMode)}>
                <span>{viewMode === "mobile" ? "📱" : viewMode === "desktop" ? "🖥" : "↔"}</span>
                <span>Вид интерфейса</span>
                <span className="topbar-theme-badge">{viewModeLabel[viewMode]}</span>
              </button>
              <div className="topbar-profile-divider" />
              {isSuperAdmin ? (
                <button className="topbar-profile-item" onClick={() => { setLoginSettingsOpen(true); setProfileOpen(false); }}>⚙ Настройки</button>
              ) : (
                <button className="topbar-profile-item topbar-profile-item--muted" disabled>⚙ Настройки</button>
              )}
              <button className="topbar-profile-item topbar-profile-item--danger" onClick={handleLogout}>↪ Выйти</button>
            </div>
          )}
        </div>
      </div>
    </header>

    {/* Login page settings modal (SUPER_ADMIN only) */}
    {loginSettingsOpen && (
      <div className="topbar-modal-overlay" onClick={() => setLoginSettingsOpen(false)}>
        <div className="topbar-modal" onClick={(e) => e.stopPropagation()}>
          <div className="topbar-modal-header">
            <span className="topbar-modal-title">Настройки страницы входа</span>
            <button className="topbar-modal-close" onClick={() => setLoginSettingsOpen(false)}>✕</button>
          </div>
          <div className="topbar-modal-body">

            {/* Show illustration */}
            <div className="topbar-setting-row">
              <div className="topbar-setting-label">
                <span>Иллюстрация</span>
                <span className="topbar-setting-hint">Показывать SVG-картинку рядом с формой входа</span>
              </div>
              <label className="topbar-toggle">
                <input
                  type="checkbox"
                  checked={loginCfg.showImage}
                  onChange={(e) => updateLoginCfg({ showImage: e.target.checked })}
                />
                <span className="topbar-toggle-track" />
              </label>
            </div>

            {/* Image position */}
            {loginCfg.showImage && (
              <div className="topbar-setting-row">
                <div className="topbar-setting-label">
                  <span>Позиция картинки</span>
                  <span className="topbar-setting-hint">С какой стороны отображается иллюстрация</span>
                </div>
                <div className="topbar-setting-segmented">
                  <button
                    className={"topbar-seg-btn" + (loginCfg.imagePosition === "left" ? " active" : "")}
                    onClick={() => updateLoginCfg({ imagePosition: "left" })}
                  >Слева</button>
                  <button
                    className={"topbar-seg-btn" + (loginCfg.imagePosition === "right" ? " active" : "")}
                    onClick={() => updateLoginCfg({ imagePosition: "right" })}
                  >Справа</button>
                </div>
              </div>
            )}

            {/* Custom image upload */}
            {loginCfg.showImage && (
              <div className="topbar-setting-row" style={{ alignItems: "flex-start" }}>
                <div className="topbar-setting-label">
                  <span>Кастомное изображение</span>
                  <span className="topbar-setting-hint">Заменяет SVG-иллюстрацию своей картинкой</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  {loginCfg.customImageBase64 && (
                    <div style={{ position: "relative" }}>
                      <img
                        src={loginCfg.customImageBase64}
                        alt="Preview"
                        style={{ width: 80, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--color-border)", display: "block" }}
                      />
                      <button
                        onClick={() => {
                          updateLoginCfg({ customImageBase64: null });
                          localStorage.removeItem(LOGIN_IMG_KEY);
                        }}
                        style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", border: "none", background: "var(--color-failed)", color: "#fff", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                        title="Удалить изображение"
                      >✕</button>
                    </div>
                  )}
                  <label className="topbar-seg-btn" style={{ cursor: "pointer", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 12px", display: "inline-block" }}>
                    {loginCfg.customImageBase64 ? "Заменить" : "Загрузить…"}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const b64 = ev.target?.result as string;
                          updateLoginCfg({ customImageBase64: b64 });
                        };
                        reader.readAsDataURL(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Show credentials */}
            <div className="topbar-setting-row">
              <div className="topbar-setting-label">
                <span>Показывать учётные данные</span>
                <span className="topbar-setting-hint">Подсказки для входа на странице логина</span>
              </div>
              <div className="topbar-setting-segmented">
                <button
                  className={"topbar-seg-btn" + (loginCfg.showCredentials === "all" ? " active" : "")}
                  onClick={() => updateLoginCfg({ showCredentials: "all" })}
                >Все</button>
                <button
                  className={"topbar-seg-btn" + (loginCfg.showCredentials === "demo" ? " active" : "")}
                  onClick={() => updateLoginCfg({ showCredentials: "demo" })}
                >Demo</button>
                <button
                  className={"topbar-seg-btn" + (loginCfg.showCredentials === "none" ? " active" : "")}
                  onClick={() => updateLoginCfg({ showCredentials: "none" })}
                >Скрыть</button>
              </div>
            </div>

            <div className="topbar-modal-footer">
              <button
                className="topbar-seg-btn"
                onClick={() => {
                  updateLoginCfg(defaultLoginCfg);
                  localStorage.removeItem(LOGIN_IMG_KEY);
                }}
                style={{ marginRight: "auto" }}
              >Сбросить</button>
              <button className="topbar-modal-done" onClick={() => setLoginSettingsOpen(false)}>Готово</button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
