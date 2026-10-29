import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { projectsApi, orgsApi, type Project } from "../api/client";
import "./Sidebar.css";

interface Props {
  projectId: string;
  collapsed?: boolean;
  onToggle?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// ── Thin-line SVG icons (stroke="currentColor", fill="none") ─────────────────

function IconTestCases() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 10h16M4 14h8M4 18h6"/></svg>;
}
function IconSharedSteps() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>;
}
function IconPlans() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}
function IconRuns() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>;
}
function IconConfigs() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
}
function IconEnvs() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg>;
}
function IconDefects() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2h6l1 4H8L9 2z"/><path d="M8 6c0 5.333-4 7-4 10a8 8 0 0016 0c0-3-4-4.667-4-10"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg>;
}
function IconReleases() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>;
}
function IconMilestones() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>;
}
function IconTodo() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>;
}
function IconReports() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>;
}
function IconRequirements() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>;
}
function IconChecklist() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="8 12 11 15 16 9"/></svg>;
}
function IconReview() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
}
function IconSettings() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
}

// ── Icons (new) ───────────────────────────────────────────────────────────────

function IconDashboard() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>;
}

// ── Menu groups ───────────────────────────────────────────────────────────────

const groups = [
  {
    title: "ANALYTICS",
    items: [
      { to: "dashboard",    label: "My Dashboard",  Icon: IconDashboard },
      { to: "traceability", label: "Requirements",  Icon: IconRequirements },
      { to: "reports",      label: "Reports",       Icon: IconReports },
    ],
  },
  {
    title: "TEST DESIGN",
    items: [
      { to: "repository",   label: "Test Cases",   Icon: IconTestCases },
      { to: "shared-steps", label: "Shared Steps", Icon: IconSharedSteps },
      { to: "checklists",   label: "Checklists",   Icon: IconChecklist },
      { to: "review",       label: "Review",       Icon: IconReview },
    ],
  },
  {
    title: "TEST EXECUTION",
    items: [
      { to: "plans",   label: "Test Plans",     Icon: IconPlans },
      { to: "runs",    label: "Test Runs",      Icon: IconRuns },
      { to: "configs", label: "Configurations", Icon: IconConfigs },
      { to: "envs",    label: "Environments",   Icon: IconEnvs },
    ],
  },
  {
    title: "DEFECT MANAGEMENT",
    items: [
      { to: "defects", label: "Defects", Icon: IconDefects },
    ],
  },
  {
    title: "PROJECT MANAGEMENT",
    items: [
      { to: "releases",   label: "Releases",   Icon: IconReleases },
      { to: "milestones", label: "Milestones", Icon: IconMilestones },
      { to: "todo",       label: "Todo",        Icon: IconTodo },
    ],
  },
];

export default function Sidebar({ projectId, collapsed = false, onToggle, mobileOpen, onMobileClose }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!projectId) return;
    projectsApi.get(projectId).then((p) => {
      setProject(p);
      if (p.organization_id) {
        orgsApi.getOrg(p.organization_id).then((o) => setOrgName(o.name)).catch(() => {});
      }
    }).catch(() => {});
  }, [projectId]);

  const abbr = (project?.abbreviation?.toUpperCase() || project?.name?.slice(0, 4).toUpperCase() || "??").slice(0, 4);
  const name = project?.name || "…";

  const isItemActive = (to: string) =>
    location.pathname.includes(`/${to}`) ||
    (to === "runs"      && location.pathname.includes("/run/")) ||
    (to === "plans"     && location.pathname.includes("/plan/")) ||
    (to === "dashboard" && location.pathname.endsWith("/dashboard"));

  const allItems = groups.flatMap((g) => g.items);
  const seenTos = new Set<string>();
  const uniqueItems = allItems.filter((item) => {
    if (seenTos.has(item.to)) return false;
    seenTos.add(item.to);
    return true;
  });

  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}${mobileOpen ? " sidebar--mobile-open" : ""}`}>
      {mobileOpen && (
        <button className="sidebar-mobile-close" onClick={onMobileClose} aria-label="Закрыть меню">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
      <div className="sidebar-project">
        <span className="sidebar-project-mark" title={collapsed ? name : undefined}>{abbr}</span>
        {!collapsed && (
          <div className="sidebar-project-info">
            <span className="sidebar-project-name">{name}</span>
            {orgName && (
              <span className="sidebar-project-org">{orgName}</span>
            )}
          </div>
        )}
      </div>

      {collapsed ? (
        <>
          {uniqueItems.map((item) => (
            <NavLink
              key={item.to}
              to={`/project/${projectId}/${item.to}`}
              className={() => "sidebar-item" + (isItemActive(item.to) ? " is-active" : "")}
              title={item.label}
            >
              <span className="sidebar-item-icon"><item.Icon /></span>
            </NavLink>
          ))}
          <div style={{ flex: 1 }} />
          <button className="sidebar-item sidebar-settings-btn" title="Settings" onClick={() => navigate("/settings")}
            style={{ borderTop: "1px solid var(--color-border)" }}>
            <span className="sidebar-item-icon"><IconSettings /></span>
          </button>
        </>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.title} className="sidebar-group">
              <div className="sidebar-group-title">{g.title}</div>
              {g.items.map((item) => (
                <NavLink
                  key={`${g.title}-${item.to}`}
                  to={`/project/${projectId}/${item.to}`}
                  className={() => "sidebar-item" + (isItemActive(item.to) ? " is-active" : "")}
                >
                  <span className="sidebar-item-icon"><item.Icon /></span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}

          <div style={{ flex: 1 }} />

          <div className="sidebar-group sidebar-admin">
            <div className="sidebar-group-title">ADMIN</div>
            <button className="sidebar-item sidebar-settings-btn" onClick={() => navigate("/settings")}>
              <span className="sidebar-item-icon"><IconSettings /></span>
              <span>Settings</span>
            </button>
          </div>
        </>
      )}

      <button className="sidebar-collapse-btn" onClick={onToggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        <span className="sidebar-collapse-icon">{collapsed ? "›" : "‹"}</span>
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
