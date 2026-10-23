import { Alert, Button, Card, Spin, Typography, theme } from "antd";
import { useEffect, useState } from "react";
import { useLogin } from "@refinedev/core";
import { useNavigate } from "react-router-dom";

import { appEnv } from "../lib/env";
import { getSupabase } from "../lib/supabase";
import { getAuthCallbackError, hadPkceCodeAtLoad } from "../lib/auth-callback";
import { BrandLogo } from "../components/brand-logo";
import loginBg from "../assets/login-bg.jpg";

const { Paragraph } = Typography;

// Страница входа (VS-1, AUTH-01): Telegram OIDC через Supabase Auth (ADR-001).
// Без публичных переменных среды — заглушка VS-0 с пояснением настройки.
export function LoginPage() {
  const { token } = theme.useToken();
  const { mutate: login, isLoading } = useLogin();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // Ошибочный возврат от Auth-сервера (см. auth-callback.ts): без уведомления
  // вход выглядит как молчаливый возврат на страницу входа. Текст от сервера
  // (error_description) не показываем — только общее сообщение.
  const [hasCallbackError] = useState(() => getAuthCallbackError() !== null);
  // Возврат из Telegram получен (?code=... в URL при загрузке): пока идёт
  // обмен кода — показываем «Завершаем вход», по результату — уводим в
  // кабинет или показываем ошибку обмена.
  const [finishing, setFinishing] = useState(() => appEnv.configured && hadPkceCodeAtLoad());
  // Обмен кода провалился — сеанс не создан (supabase-js глушит ошибку в консоль).
  const [exchangeFailed, setExchangeFailed] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (supabase === null) {
      setFinishing(false);
      return;
    }
    let cancelled = false;
    // getSession ждёт инициализации клиента вместе с обменом PKCE-кода;
    // таймаут — на случай зависшего сетевого запроса при обмене.
    const timer = setTimeout(() => {
      setFinishing(false);
      setExchangeFailed(true);
    }, 5000);
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      clearTimeout(timer);
      setFinishing(false);
      if (data.session !== null) {
        // Сеанс уже есть (обмен кода прошёл) — не оставляем пользователя
        // на странице входа, уводим в кабинет.
        navigate("/", { replace: true });
      } else if (hadPkceCodeAtLoad()) {
        setExchangeFailed(true);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [navigate]);

  const handleLogin = () => {
    setError(null);
    login(
      {},
      {
        onError: (loginError) => setError(loginError.message),
      },
    );
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Фон — визуализация ЖК (из карточки novostroyki-almaty.kz); полупрозрачный
        // слой приглушает картинку ради читаемости карточки входа.
        backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.35)), url(${loginBg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <Card style={{ width: 400, borderRadius: 14, boxShadow: token.boxShadowSecondary }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <BrandLogo size={30} caption />
        </div>
        <Typography.Title level={3} style={{ textAlign: "center", fontSize: 20 }}>
          Вход в кабинет ОСИ
        </Typography.Title>
        <Paragraph type="secondary">
          Кабинет предназначен для исполнителей и администраторов ОСИ. Вход
          выполняется через Telegram.
        </Paragraph>
        {hasCallbackError && (
          <Alert
            type="error"
            showIcon
            message="Ошибка входа через Telegram"
            style={{ marginBottom: 16 }}
          />
        )}
        {exchangeFailed && (
          <Alert
            type="error"
            showIcon
            message="Ошибка входа через Telegram"
            description="Возврат из Telegram получен, но сеанс не создан. Нажмите «Войти через Telegram» ещё раз; если повторится — проверьте консоль браузера (запрос /auth/v1/token) и логи Supabase Auth."
            style={{ marginBottom: 16 }}
          />
        )}
        {error !== null && (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        )}
        {finishing && !exchangeFailed && (
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <Spin />
            <Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
              Завершаем вход…
            </Paragraph>
          </div>
        )}
        {!(finishing && !exchangeFailed) &&
          (appEnv.configured ? (
            <Button
              type="primary"
              size="large"
              block
              loading={isLoading}
              onClick={handleLogin}
            >
              Войти через Telegram
            </Button>
          ) : (
            <>
              <Button type="primary" size="large" block disabled>
                Войти через Telegram
              </Button>
              <Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
                Вход отключён: задайте публичные переменные среды VITE_SUPABASE_URL
                и VITE_SUPABASE_PUBLISHABLE_KEY (см. admin/README.md).
              </Paragraph>
            </>
          ))}
      </Card>
    </div>
  );
}
