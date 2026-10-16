import { Alert, Button, Card, Typography } from "antd";
import { useState } from "react";
import { useLogin } from "@refinedev/core";

import { appEnv } from "../lib/env";

const { Paragraph, Text } = Typography;

// Страница входа (VS-1, AUTH-01): Telegram OIDC через Supabase Auth (ADR-001).
// Без публичных переменных среды — заглушка VS-0 с пояснением настройки.
export function LoginPage() {
  const { mutate: login, isLoading } = useLogin();
  const [error, setError] = useState<string | null>(null);

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
        background: "#f5f5f5",
      }}
    >
      <Card style={{ width: 400 }}>
        <Typography.Title level={3} style={{ textAlign: "center" }}>
          Вход в кабинет ОСИ
        </Typography.Title>
        <Paragraph type="secondary">
          Кабинет предназначен для администраторов и председателя ОСИ. Вход
          выполняется через Telegram; права определяются ролью и областью домов
          (матрица прав).
        </Paragraph>
        {error !== null && (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        )}
        {appEnv.configured ? (
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
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          Профиль и полномочия проверяются на сервере (PDP); вход не выдаёт роль.
        </Text>
      </Card>
    </div>
  );
}
