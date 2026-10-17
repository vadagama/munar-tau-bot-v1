import { useState } from "react";
import { Alert, Button, Card, Input, Space, Typography, Select } from "antd";
import { apiFetch } from "../lib/api";
export function RegistrationSimulator({ active }: { active: boolean }) {
  const [scenario,setScenario]=useState("registration");
  const [input, setInput] = useState(""),
    [history, setHistory] = useState<{ input: string; reply: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const send = async (text: string) => {
    if (!active || busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ reply: string }>(
        "/v1/emulation/simulate",
        { method: "POST", body: { scenario, input: text } },
      );
      setHistory((previous) => [
        ...previous,
        { input: text, reply: result.reply },
      ]);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка симулятора");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Симулятор бота" style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Select aria-label="Сценарий симулятора" value={scenario} onChange={setScenario} options={[{value:"registration",label:"Регистрация"},{value:"requests",label:"Обращения"},{value:"tasks",label:"Задания"},{value:"notifications",label:"Уведомления"},{value:"incidents",label:"Аварии и публикации"}]} />
        {scenario === "notifications" && <Button disabled={!active || busy} onClick={()=>void send("/notifications")}>Настройки уведомлений</Button>}
        {scenario === "tasks" && <Button disabled={!active || busy} onClick={()=>void send("/tasks")}>Мои задания</Button>}
        {scenario === "requests" && <Space wrap><Button disabled={!active || busy} onClick={()=>void send("/newrequest")}>Новое обращение</Button><Button disabled={!active || busy} onClick={()=>void send("/requests")}>Мои обращения</Button></Space>}
        {!active && (
          <Alert
            type="info"
            message="Сначала войдите под тестовой персоной. Симулятор использует тот же сценарий, что и Telegram-бот."
          />
        )}
        {error && <Alert showIcon type="error" message={error} />}
        <Space wrap>
          <Button
            disabled={!active || busy}
            onClick={() => void send("/register")}
          >
            Начать анкету
          </Button>
          <Button
            disabled={!active || busy}
            onClick={() => void send("/status")}
          >
            Статус
          </Button>
          <Button
            disabled={!active || busy}
            onClick={() => void send("/objects")}
          >
            Мои объекты
          </Button>
          <Button
            disabled={!active || busy}
            onClick={() => void send("/cancel")}
          >
            Отменить диалог
          </Button>
        </Space>
        <div
          role="log"
          aria-live="polite"
          aria-label="Диалог симулятора"
          style={{ maxHeight: 420, overflowY: "auto", width: "100%" }}
        >
          {history.map((entry, index) => (
            <div
              key={index}
              style={{ padding: "12px 0", borderBottom: "1px solid #eee" }}
            >
              <Typography.Text type="secondary">
                Вы: {entry.input}
              </Typography.Text>
              <Typography.Paragraph
                style={{
                  whiteSpace: "pre-wrap",
                  marginTop: 8,
                  marginBottom: 0,
                }}
              >
                {entry.reply}
              </Typography.Paragraph>
            </div>
          ))}
        </div>
        <Input.TextArea
          aria-label="Сообщение симулятору"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
          maxLength={300}
          disabled={!active || busy}
          placeholder="Введите ответ или команду бота"
        />
        <Button
          type="primary"
          disabled={!active || !input.trim()}
          loading={busy}
          onClick={() => void send(input)}
        >
          Отправить шаг
        </Button>
      </Space>
    </Card>
  );
}
