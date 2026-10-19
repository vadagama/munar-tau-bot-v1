import { TelegramText } from "../components/telegram-text";
import type { InlineButton } from "../../../core/src/bot/keyboard";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Input, Space, Typography, Select } from "antd";
import { apiFetch } from "../lib/api";
interface SimulatorReply {
  scenario_id?: string;
  reply: string;
  buttons?: InlineButton[][];
}
export function RegistrationSimulator({ active }: { active: boolean }) {
  const [scenario,setScenario]=useState("registration");
  const [input, setInput] = useState(""),
    [history, setHistory] = useState<{ input: string; reply: string; buttons?: InlineButton[][]; scenario: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const latestMessage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const message = latestMessage.current;
    if (!message) return;
    message.focus({ preventScroll: true });
    message.scrollIntoView({ block: "start", inline: "nearest" });
  }, [history.length]);
  const send = async (text: string, targetScenario = scenario) => {
    if (!active || busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<SimulatorReply>(
        "/v1/emulation/simulate",
        { method: "POST", body: { scenario: targetScenario, input: text } },
      );
      const resolvedScenario = result.scenario_id ?? targetScenario;
      setHistory((previous) => [
        ...previous,
        { input: text, reply: result.reply, buttons: result.buttons, scenario: resolvedScenario },
      ]);
      setScenario(resolvedScenario);
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
            onClick={() => void send("/register", "registration")}
          >
            Начать анкету
          </Button>
          <Button
            disabled={!active || busy}
            onClick={() => void send("/status", "registration")}
          >
            Статус
          </Button>
          <Button
            disabled={!active || busy}
            onClick={() => void send("/objects", "registration")}
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
              ref={index === history.length - 1 ? latestMessage : undefined}
              role="article"
              aria-label={`Ответ симулятора ${index + 1}`}
              tabIndex={-1}
              style={{ padding: "12px 0", borderBottom: "1px solid #eee" }}
            >
              <Typography.Text type="secondary">
                Вы: {entry.input}
              </Typography.Text>
              <Typography.Paragraph
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  marginTop: 8,
                  marginBottom: 0,
                }}
              >
                <TelegramText text={entry.reply} />
              </Typography.Paragraph>
              {entry.buttons?.map((row, rowIndex) => (
                <Space key={rowIndex} wrap style={{ display: "flex", marginTop: 8 }}>
                  {row.map((button, buttonIndex) => (
                    <Button key={buttonIndex} disabled={!active || busy}
                      onClick={() => void send(button.data, entry.scenario)}>{button.text}</Button>
                  ))}
                </Space>
              ))}
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
