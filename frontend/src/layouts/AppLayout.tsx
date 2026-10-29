import { useEffect, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import TopBar from "../components/TopBar";
import Sidebar from "../components/Sidebar";
import { migrateLegacyLocalAttachments } from "../utils/media";
import "./AppLayout.css";

export default function AppLayout() {
  const { projectId } = useParams();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // вложения старых версий из localStorage → на бэкенд (MinIO), ключи удаляются
  useEffect(() => { migrateLegacyLocalAttachments().catch(() => {}); }, []);

  return (
    <div className="app-layout">
      <TopBar
        showBurger={!!projectId}
        onBurgerClick={() => setMobileMenuOpen((v) => !v)}
      />
      <div className="app-body">
        {projectId && (
          <Sidebar
            projectId={projectId}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((v) => !v)}
            mobileOpen={mobileMenuOpen}
            onMobileClose={() => setMobileMenuOpen(false)}
          />
        )}
        {mobileMenuOpen && projectId && (
          <div
            className="mobile-overlay"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
