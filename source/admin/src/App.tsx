import { ReportsPage } from "./pages/reports";
import { InitiativesPage } from "./pages/initiatives";
import { PollsPage } from "./pages/polls";
import { RegistryPhasesPage } from "./pages/registry-phases";
import { StaffPage } from "./pages/staff";
import { DocumentsPage } from "./pages/documents";
import { RequestSettingsPage } from "./pages/request-settings";
import { TaskToolsPage } from "./pages/task-tools";
import { TemplatesPage } from "./pages/templates";
import { IncidentsPage } from "./pages/incidents";
import { PublicationsPage } from "./pages/publications";
import { NotificationsPage } from "./pages/notifications";
import { TasksPage } from "./pages/tasks";
import { RequestsPage } from "./pages/requests";
import { TimeRulesPage } from "./pages/time-rules";
import { InvitesPage } from "./pages/invites";
import { RegistryPage } from "./pages/registry";
import { RegistrationsPage } from "./pages/registrations";
import { RegistryImportPage } from "./pages/registry-import";
import { Refine, Authenticated } from "@refinedev/core";
import routerProvider from "@refinedev/react-router-v6";
import { ConfigProvider, Spin, theme as antdTheme } from "antd";
import ruRU from "antd/locale/ru_RU";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { authProvider } from "./lib/auth-provider";
import { AppLayout } from "./layouts/app-layout";
import { AuditPage } from "./pages/audit";
import { EmulationPage } from "./pages/emulation";
import { HomePage } from "./pages/home";
import { LoginPage } from "./pages/login";

// VS-1: Telegram-вход (AUTH-01, ADR-001), authProvider на /v1/meta/me,
// серверная проверка прав — PDP в функции api при каждом запросе.
export default function App() {
  return (
    <ConfigProvider
      locale={ruRU}
      theme={{ algorithm: antdTheme.defaultAlgorithm }}
    >
      <BrowserRouter>
        <Refine routerProvider={routerProvider} authProvider={authProvider} resources={[]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <Authenticated
                  key="cabinet"
                  redirectOnFail="/login"
                  loading={<Spin size="large" style={{ display: "block", margin: "120px auto" }} />}
                >
                  <AppLayout />
                </Authenticated>
              }
            >
              <Route path="/" element={<HomePage />} />
              <Route path="/incidents" element={<IncidentsPage />} />
              <Route path="/publications" element={<PublicationsPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/polls" element={<PollsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/initiatives" element={<InitiativesPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/notifications" element={<Navigate to="/notifications/preferences" replace />} />
              <Route path="/notifications/preferences" element={<NotificationsPage key="preferences" section="preferences" />} />
              <Route path="/notifications/failures" element={<NotificationsPage key="failures" section="failures" />} />
              <Route path="/settings/requests" element={<RequestSettingsPage />} />
              <Route path="/users/residents" element={<RegistryPage key="residents" users="residents" />} />
              <Route path="/users/staff" element={<StaffPage />} />
              <Route path="/time-rules" element={<TimeRulesPage />} />
              <Route path="/invites" element={<InvitesPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/common-works" element={<TaskToolsPage />} />
              <Route path="/job-templates" element={<TaskToolsPage templates />} />
              <Route path="/registry" element={<Navigate to="/registry/premises" replace />} />
              <Route path="/registry/buildings" element={<RegistryPage key="buildings" section="buildings" />} />
              <Route path="/registry/premises" element={<RegistryPage key="premises" section="premises" />} />
              <Route path="/registry/connections" element={<RegistryPage key="connections" section="connections" />} />
              <Route path="/registry/phases" element={<RegistryPhasesPage />} />
              <Route path="/registrations" element={<RegistrationsPage />} />
              <Route path="/registry-import" element={<RegistryImportPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/emulation" element={<EmulationPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Refine>
      </BrowserRouter>
    </ConfigProvider>
  );
}
