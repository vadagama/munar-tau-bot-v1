import { Button, Card, Form, Typography } from "antd";

const { Paragraph, Text } = Typography;

// Страница входа (VS-0): заглушка. Telegram OIDC + серверная проверка роли
// появятся в VS-1 (AUTH-01, ADR-001); до тех пор кнопка входа заблокирована.
export function LoginPage() {
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
        <Form layout="vertical" disabled>
          <Form.Item style={{ marginBottom: 8 }}>
            <Button
              type="primary"
              size="large"
              block
              disabled
              title="Вход через Telegram появится со срезом VS-1 (AUTH-01)"
            >
              Войти через Telegram
            </Button>
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Вход будет открыт после подключения аутентификации (VS-1, AUTH-01).
        </Text>
      </Card>
    </div>
  );
}
