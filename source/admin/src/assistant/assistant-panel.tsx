// Панель AI-ассистента на главной (план S1.2): сворачиваемая карточка рядом с
// «Очередью дня» (очередь не заменяет), на мобильном — во всю ширину сетки.
// Тексты и состояния — по прототипу prototypes/dashboard-library
// (dashboard-browser.html): «Вопрос ассистенту», «Спросить» → «Готовлю ответ»,
// примечание об AI-подсказке. Ответ — AssistantMarkdown (HTML не рендерится).

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Input, Progress, Space, Spin, Typography } from "antd";
import { ClearOutlined, RedoOutlined, SendOutlined } from "@ant-design/icons";

import { AssistantMarkdown } from "./assistant-markdown";
import { AssistantTable } from "./assistant-table";
import { useAssistantSocket, type AssistantMessageView } from "./use-assistant-socket";
import "./assistant.css";

const OPEN_STORAGE_KEY = "assistant.panel.open";

function readOpen(): boolean {
  try {
    const saved = localStorage.getItem(OPEN_STORAGE_KEY);
    // Первый вход (нет сохранённого выбора) — панель развёрнута: поле ввода
    // должно быть видно сразу, пустая карточка выглядит сломанной.
    return saved === null ? true : saved === "1";
  } catch {
    return true;
  }
}

function messageBody(message: AssistantMessageView): string {
  if (message.role === "assistant") return message.text;
  if (message.status === "unanswered" || message.status === "failed") {
    return message.error ?? "Ответ не получен";
  }
  return message.text;
}

export function AssistantPanel() {
  const { status, messages, send, retry, clearSession, clearing, access } = useAssistantSocket();
  const [open, setOpen] = useState(readOpen);
  const [question, setQuestion] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Мини-индикатор дневного расхода (S3.2): только при заданном дневном лимите.
  const dailyLimit = access?.daily_token_limit ?? null;
  const dayUsed = access?.day_used ?? 0;

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
    } catch {
      // Хранилище недоступно — состояние держится до перезагрузки.
    }
  }, [open]);

  const visible = status.kind !== "disabled" && status.kind !== "loading";
  useEffect(() => {
    const thread = threadRef.current;
    if (thread !== null) thread.scrollTop = thread.scrollHeight;
  }, [messages, visible, open]);

  if (status.kind === "disabled" || status.kind === "loading") return null;

  if (status.kind === "limit") {
    return <Alert type="info" showIcon message="Дневной лимит AI-ассистента исчерпан. Все доступные виджеты продолжают работать." />;
  }

  const toggle = (
    <Button
      type="text"
      size="small"
      aria-expanded={open}
      onClick={() => setOpen(value => !value)}
    >
      {open ? "Свернуть" : "Развернуть"}
    </Button>
  );

  const busy = messages.some((m) => m.status === "queued" || m.status === "running");

  return (
    <section className="assistant-panel" aria-label="AI-ассистент">
      <Card
        title="AI-ассистент"
        extra={<Space size={4}>{toggle}</Space>}
        // Свёрнутая панель без содержимого — только шапка: пустое тело карточки
        // выглядит как сломанный рендер (сообщения статусов остаются видимыми).
        styles={!open && status.kind === "open" ? { body: { display: "none" } } : undefined}
      >
        {status.kind === "unconfigured" && (
          <Typography.Paragraph type="secondary">
            Ассистент включён, но адрес сервиса не настроен в этой сборке кабинета.
          </Typography.Paragraph>
        )}
        {status.kind === "error" && (
          <Alert
            type="error"
            showIcon
            message={status.message}
            action={<Button size="small" onClick={() => window.location.reload()}>Обновить</Button>}
          />
        )}
        {status.kind === "connecting" && (
          <Typography.Paragraph type="secondary"><Spin size="small" /> Подключение к ассистенту…</Typography.Paragraph>
        )}
        {open && (status.kind === "open" || status.kind === "connecting") && (
          <>
            {dailyLimit !== null && (
              <div className="assistant-usage" title="Расход токенов за текущие сутки (05:00→05:00 Алматы)">
                <Progress
                  aria-label="Расход дневного лимита"
                  percent={dailyLimit > 0 ? Math.min(100, Math.round((dayUsed / dailyLimit) * 100)) : 100}
                  size="small"
                  showInfo={false}
                />
                <Typography.Text type="secondary">
                  {dayUsed.toLocaleString("ru-RU")} / {dailyLimit.toLocaleString("ru-RU")} токенов сегодня
                </Typography.Text>
              </div>
            )}
            <div className="assistant-thread" ref={threadRef} aria-live="polite" aria-busy={busy}>
              {messages.length === 0 && (
                <Typography.Paragraph type="secondary" className="assistant-empty">
                  Помогу оценить текущую нагрузку и подскажу, с чего начать. Спросите своими словами.
                </Typography.Paragraph>
              )}
              {messages.map((message) => (
                <div key={message.messageId} className={`assistant-msg assistant-msg--${message.role}`}>
                  {message.role === "assistant" ? (
                    <>
                      <AssistantMarkdown text={messageBody(message)} sources={message.sources} />
                      {(message.tables ?? []).map((table) => <AssistantTable key={table.id} table={table} />)}
                    </>
                  ) : (
                    <div className="assistant-msg-text">{messageBody(message)}</div>
                  )}
                  {(message.status === "unanswered" || message.status === "failed" || message.status === "parked") && message.role === "user" && (
                    <Button
                      size="small"
                      icon={<RedoOutlined aria-hidden="true" />}
                      onClick={() => retry(message)}
                    >
                      Повторить
                    </Button>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form
              className="assistant-form"
              onSubmit={event => {
                event.preventDefault();
                if (!question.trim() || busy) return;
                if (send(question)) setQuestion("");
              }}
            >
              <Input.TextArea
                aria-label="Вопрос ассистенту"
                placeholder="Задайте вопрос по обращениям, заданиям и авариям"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                maxLength={2000}
                autoSize={{ minRows: 1, maxRows: 4 }}
                disabled={busy || status.kind !== "open"}
              />
              <div className="assistant-form-footer">
                <Button
                  icon={<ClearOutlined aria-hidden="true" />}
                  onClick={() => void clearSession()}
                  loading={clearing}
                  title="Начать новый контекст: история текущего дня будет недоступна"
                >
                  Очистить контекст
                </Button>
                <Button
                  htmlType="submit"
                  type="primary"
                  icon={<SendOutlined aria-hidden="true" />}
                  loading={busy}
                  disabled={!question.trim() || status.kind !== "open"}
                >
                  {busy ? "Готовлю ответ" : "Спросить"}
                </Button>
              </div>
              <Typography.Paragraph type="secondary" className="assistant-note">
                Выводы AI — подсказка. Проверяйте детали в исходных записях.
              </Typography.Paragraph>
            </form>
          </>
        )}
      </Card>
    </section>
  );
}
