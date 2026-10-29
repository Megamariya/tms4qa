import { type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import LoginPage from "./pages/LoginPage";
import ProjectsPage from "./pages/ProjectsPage";
import RepositoryPage from "./pages/RepositoryPage";
import TestCaseFormPage from "./pages/TestCaseFormPage";
import TestRunsPage from "./pages/TestRunsPage";
import TestRunDetailPage from "./pages/TestRunDetailPage";
import TestPlansPage from "./pages/TestPlansPage";
import TestPlanDetailPage from "./pages/TestPlanDetailPage";
import DefectsPage from "./pages/DefectsPage";
import DefectCreatePage from "./pages/DefectCreatePage";
import DefectDetailPage from "./pages/DefectDetailPage";
import TraceabilityPage from "./pages/TraceabilityPage";
import ReleasesPage from "./pages/ReleasesPage";
import SharedStepsPage from "./pages/SharedStepsPage";
import ChecklistsPage from "./pages/ChecklistsPage";
import ReviewPage from "./pages/ReviewPage";
import ConfigurationsPage from "./pages/ConfigurationsPage";
import EnvironmentsPage from "./pages/EnvironmentsPage";
import MilestonesPage from "./pages/MilestonesPage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import WorkspacePage from "./pages/WorkspacePage";
import DashboardsPage from "./pages/DashboardsPage";
import AppsPage from "./pages/AppsPage";
import TodoPage from "./pages/TodoPage";
import MyDashboardPage from "./pages/MyDashboardPage";
import { authApi } from "./api/client";

function RequireAuth({ children }: { children: ReactNode }) {
  if (!authApi.isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/dashboards" element={<DashboardsPage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/settings" element={<SettingsPage />} />

        <Route path="/project/:projectId/repository" element={<RepositoryPage />} />
        <Route path="/project/:projectId/repository/new" element={<TestCaseFormPage />} />
        <Route path="/project/:projectId/repository/case/:caseId/edit" element={<TestCaseFormPage />} />

        <Route path="/project/:projectId/shared-steps" element={<SharedStepsPage />} />
        <Route path="/project/:projectId/checklists" element={<ChecklistsPage />} />
        <Route path="/project/:projectId/review" element={<ReviewPage />} />
        <Route path="/project/:projectId/traceability" element={<TraceabilityPage />} />

        <Route path="/project/:projectId/plans" element={<TestPlansPage />} />
        <Route path="/project/:projectId/plan/:planId" element={<TestPlanDetailPage />} />
        <Route path="/project/:projectId/runs" element={<TestRunsPage />} />
        <Route path="/project/:projectId/run/:runId" element={<TestRunDetailPage />} />
        <Route path="/project/:projectId/configs" element={<ConfigurationsPage />} />
        <Route path="/project/:projectId/envs" element={<EnvironmentsPage />} />

        <Route path="/project/:projectId/releases" element={<ReleasesPage />} />
        <Route path="/project/:projectId/defects" element={<DefectsPage />} />
        <Route path="/project/:projectId/defects/new" element={<DefectCreatePage />} />
        <Route path="/project/:projectId/defects/:defectId" element={<DefectDetailPage />} />
        <Route path="/project/:projectId/defects/:defectId/edit" element={<DefectCreatePage />} />
        <Route path="/project/:projectId/milestones" element={<MilestonesPage />} />
        <Route path="/project/:projectId/todo" element={<TodoPage />} />
        <Route path="/project/:projectId/reports" element={<ReportsPage />} />
        <Route path="/project/:projectId/dashboard" element={<MyDashboardPage />} />
      </Route>
    </Routes>
  );
}
