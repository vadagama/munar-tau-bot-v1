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
              <Route path="/time-rules" element={<TimeRulesPage />} />
              <Route path="/invites" element={<InvitesPage />} />
              <Route path="/registry" element={<RegistryPage />} />
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
