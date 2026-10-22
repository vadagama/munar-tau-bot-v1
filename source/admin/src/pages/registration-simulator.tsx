import { TelegramText } from "../components/telegram-text";
import type { InlineButton } from "../../../core/src/bot/keyboard";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Input, Space, Typography, Select } from "antd";
import { apiFetch } from "../lib/api";
interface SimulatorReply {
  bot?: "worker";
  scenario_id?: string;
  reply: string;
  buttons?: InlineButton[][];
}
export function RegistrationSimulator({ active }: { active: boolean }) {
  const [scenario,setScenario]=useState("registration");
  const [bot,setBot]=useState<"worker"|undefined>();
  const [input, setInput] = useState(""),
    [history, setHistory] = useState<{ input: string; reply: string; buttons?: InlineButton[][]; scenario: string;bot?:"worker" }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const latestMessage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const message = latestMessage.current;
    if (!message) return;
    message.focus({ preventScroll: true });
    message.scrollIntoView({ block: "start", inline: "nearest" });
  }, [history.length]);
  const send = async (text: string, targetScenario = scenario,targetBot=bot) => {
    if (!active || busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<SimulatorReply>(
        "/v1/emulation/simulate",
        { method: "POST", body: { scenario: targetScenario, input: text,...(targetBot&&!["registration","requests"].includes(targetScenario)?{bot:targetBot}:{}) } },
      );
      const resolvedScenario = result.scenario_id ?? targetScenario;
      setHistory((previous) => [
        ...previous,
        { input: text, reply: result.reply, buttons: result.buttons, scenario: resolvedScenario,bot:result.bot },
      ]);
      setScenario(resolvedScenario);
      setBot(result.bot);
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
        <Select aria-label="Сценарий симулятора" value={scenario} onChange={setScenario} options={[{value:"registration",label:"Регистрация"},{value:"requests",label:"Обращения"},{value:"tasks",label:"Задания"},{value:"staff-requests",label:"Обращения сотрудников"},{value:"notifications",label:"Уведомления"},{value:"incidents",label:"Аварии и публикации"}]} />
        {scenario === "notifications" && <Button disabled={!active || busy} onClick={()=>void send("/notifications")}>Настройки уведомлений</Button>}
        {scenario === "staff-requests" && <Button disabled={!active || busy} onClick={()=>void send("/staffrequests")}>Обращения сотрудников</Button>}
        {scenario === "tasks" && <Button disabled={!active || busy} onClick={()=>void send("/tasks")}>Мои задания</Button>}
        {scenario === "requests" && <Space wrap><Button disabled={!active || busy} onClick={()=>void send("/newrequest")}>Новое обращение</Button><Button disabled={!active || busy} onClick={()=>void send("/requests")}>Мои обращения</Button></Space>}
        {!active && (
          <Alert
            type="info"
            message="Сначала войдите под тестовой персоной. Симулятор использует тот же сценарий, что и Telegram-бот."
          />
        )}
        {error && <Alert showIcon type="error" message={error} />}
        {scenario === "registration" && (
          <Space wrap>
            <Button
              disabled={!active || busy}
              onClick={() => void send("/register", "registration")}
            >
              Зарегистрироваться
            </Button>
            <Button
              disabled={!active || busy}
              onClick={() => void send("/status", "registration")}
            >
              Статус регистрации
            </Button>
            <Button
              disabled={!active || busy}
              onClick={() => void send("/objects", "registration")}
            >
              Мои помещения
            </Button>
          </Space>
        )}
        <Button
          disabled={!active || busy}
          onClick={() => void send("/cancel")}
        >
          Отменить
        </Button>
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
                <TelegramText text={entry.reply} onBotLink={href => {
                  try {
                    const url = new URL(href), payload = url.searchParams.get("start") ?? "";
                    const match = /^(sreq|stsk|req|wrk)_([0-9a-f-]{36})$/i.exec(payload);
                    if (url.protocol !== "https:" || url.hostname !== "t.me" || url.username || url.password || !match) return false;
                    const worker = ["sreq", "stsk", "wrk"].includes(match[1]!);
                    if (url.pathname !== (worker ? "/munar_tau_worker_bot" : "/munar_tau_bot")) return false;
                    const target = match[1] === "req" ? "requests" : match[1] === "wrk" ? "tasks" : "staff-requests";
                    const command = match[1] === "req" ? `/request ${match[2]}` : match[1] === "wrk" ? `/task ${match[2]}` : `/start ${payload}`;
                    void send(command, target);
                    return true;
                  } catch { return false; }
                }} />
              </Typography.Paragraph>
              {entry.buttons?.map((row, rowIndex) => (
                <Space key={rowIndex} wrap style={{ display: "flex", marginTop: 8 }}>
                  {row.map((button, buttonIndex) => (
                    <Button key={buttonIndex} disabled={!active || busy}
                      onClick={() => void send(button.data, entry.scenario,entry.bot)}>{button.text}</Button>
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
