import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router-v6";
import { ConfigProvider, theme as antdTheme } from "antd";
import ruRU from "antd/locale/ru_RU";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "./layouts/app-layout";
import { HomePage } from "./pages/home";
import { LoginPage } from "./pages/login";

// VS-0: каркас маршрутов без аутентификации. Telegram-вход и authProvider
// появятся в VS-1 (AUTH-01): до этого защищённая зона — только каркас layout.
export default function App() {
  return (
    <ConfigProvider
      locale={ruRU}
      theme={{ algorithm: antdTheme.defaultAlgorithm }}
    >
      <BrowserRouter>
        <Refine routerProvider={routerProvider} resources={[]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Refine>
      </BrowserRouter>
    </ConfigProvider>
  );
}
