// Панель AI-ассистента на главной (план S1.2): сворачиваемая карточка рядом с
// «Очередью дня» (очередь не заменяет), на мобильном — во всю ширину сетки.
// Тексты и состояния — по прототипу prototypes/dashboard-library
// (home-assistant.tsx): подсказка, чипы примеров (заполняют поле ввода),
// форма («В DeepSeek отправятся…» + «Спросить»), ответы — под формой,
// при сбое — развёрнутый текст и «Повторить» (решение владельца 26.10.2026).
// Поток — в стиле чата (референс владельца 26.10.2026): вопрос — пузырь
// справа; ответ — чистый текст (AssistantMarkdown, HTML не рендерится)
// с тихими действиями под ним — копировать, переспросить, время; пока дельт
// нет — индикатор набора.

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Input, Space, Spin, Tooltip, Typography } from "antd";
import { CheckOutlined, CopyOutlined, RedoOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";

import { AssistantMarkdown } from "./assistant-markdown";
import { AssistantTable } from "./assistant-table";
import { useAssistantSocket, type AssistantMessageView } from "./use-assistant-socket";
import { formatDateTime } from "../lib/format-date";
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

/** Текст сбоя для блока ошибки: причина от сервера либо общий fallback. */
function failureDescription(message: AssistantMessageView): string {
  if (message.error !== undefined && message.error !== "") return message.error;
  if (message.status === "parked") {
    return "Обработка вопроса приостановлена из-за сбоя сервиса ассистента. Нажмите «Повторить» — попытка будет выполнена заново.";
  }
  return "Ассистент не смог подготовить ответ. Нажмите «Повторить» — попытка будет выполнена заново.";
}

/** Копирование в буфер обмена: Clipboard API, при недоступности — скрытая textarea. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Окружение без Clipboard API или отказ доступа — пробуем fallback ниже.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Действия под ответом (референс владельца 26.10.2026): копировать ответ,
    переспросить исходный вопрос, время. Тихие иконки, вторичный цвет. */
function AssistantAnswerActions({ message, question, busy, enabled, onReask }: {
  message: AssistantMessageView;
  question: string | null;
  busy: boolean;
  enabled: boolean;
  onReask: (text: string) => boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const copy = async () => {
    if (!(await writeClipboard(message.text))) return;
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="assistant-actions">
      {copied ? (
        <span className="assistant-copied" role="status">
          <CheckOutlined aria-hidden="true" /> Скопировано
        </span>
      ) : (
        <Tooltip title="Скопировать ответ">
          <Button
            className="assistant-action"
            type="text"
            size="small"
            aria-label="Скопировать ответ"
            icon={<CopyOutlined aria-hidden="true" />}
            onClick={() => void copy()}
          />
        </Tooltip>
      )}
      {question !== null && (
        <Tooltip title="Задать этот вопрос заново">
          <Button
            className="assistant-action"
            type="text"
            size="small"
            aria-label="Переспросить"
            icon={<ReloadOutlined aria-hidden="true" />}
            disabled={busy || !enabled}
            onClick={() => onReask(question)}
          />
        </Tooltip>
      )}
      {message.at !== undefined && (
        <span className="assistant-answer-time">{formatDateTime(message.at)}</span>
      )}
    </div>
  );
}

const QUESTION_PROMPTS = ["Что требует внимания?", "Как распределить работу по очередям?", "Составь краткую сводку"];

export function AssistantPanel() {
  const { status, messages, send, retry, access } = useAssistantSocket();
  const [open, setOpen] = useState(readOpen);
  const [question, setQuestion] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const dailyLimit = access?.daily_token_limit ?? null;
  const dayUsed = access?.day_used ?? 0;
  // Остаток дневного лимита в шапке (S3.2, решение владельца 26.10.2026):
  // заменяет мини-индикатор-прогрессбар.
  const remaining = dailyLimit !== null ? Math.max(0, dailyLimit - dayUsed) : null;

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
  const formEnabled = status.kind === "open";
  /** Исходный вопрос ответа: ближайшее предыдущее сообщение пользователя. */
  const questionBefore = (index: number): string | null => {
    for (let i = index - 1; i >= 0; i--) {
      const previous = messages[i];
      if (previous !== undefined && previous.role === "user") return previous.text;
    }
    return null;
  };

  return (
    <section className="assistant-panel" aria-label="AI-ассистент">
      <Card
        title="AI-ассистент"
        extra={
          <Space size={8}>
            {remaining !== null && (
              <Typography.Text
                type="secondary"
                title="Остаток дневного лимита токенов (05:00→05:00 Алматы)"
              >
                {`Осталось ${remaining.toLocaleString("ru-RU")} из ${dailyLimit!.toLocaleString("ru-RU")}`}
              </Typography.Text>
            )}
            {toggle}
          </Space>
        }
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
            <Typography.Paragraph className="assistant-hint">
              Помогу оценить текущую нагрузку и выбрать, с чего начать.
            </Typography.Paragraph>
            <Space wrap className="assistant-prompts">
              {QUESTION_PROMPTS.map((text) => (
                <Button
                  key={text}
                  size="small"
                  disabled={busy || !formEnabled}
                  onClick={() => setQuestion(text)}
                >
                  {text}
                </Button>
              ))}
            </Space>
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
                disabled={busy || !formEnabled}
              />
              <div className="assistant-form-footer">
                <Typography.Text type="secondary" className="assistant-privacy">
                  В DeepSeek отправятся ваш вопрос, количества записей и номера доступных карточек.
                </Typography.Text>
                <Button
                  htmlType="submit"
                  type="primary"
                  icon={<SendOutlined aria-hidden="true" />}
                  loading={busy}
                  disabled={!question.trim() || !formEnabled}
                >
                  {busy ? "Готовлю ответ" : "Спросить"}
                </Button>
              </div>
            </form>
            {/* Ответы — под формой ввода (решение владельца 26.10.2026). */}
            <div className="assistant-thread" ref={threadRef} aria-live="polite" aria-busy={busy}>
              {messages.map((message, index) => (
                message.role === "user" ? (
                  <div key={message.messageId} className="assistant-question">
                    <div className="assistant-question-text">{message.text}</div>
                    {(message.status === "unanswered" || message.status === "failed" || message.status === "parked") && (
                      <Alert
                        className="assistant-failure"
                        type="error"
                        showIcon
                        message="Не удалось получить ответ"
                        description={
                          <>
                            <Typography.Paragraph className="assistant-failure-text">{failureDescription(message)}</Typography.Paragraph>
                            <Button
                              size="small"
                              icon={<RedoOutlined aria-hidden="true" />}
                              onClick={() => retry(message)}
                            >
                              Повторить
                            </Button>
                          </>
                        }
                      />
                    )}
                  </div>
                ) : (
                  <div key={message.messageId} className="assistant-answer">
                    <AssistantMarkdown text={message.text} sources={message.sources} />
                    {(message.tables ?? []).map((table) => <AssistantTable key={table.id} table={table} />)}
                    {message.status === "done" && (
                      <AssistantAnswerActions
                        message={message}
                        question={questionBefore(index)}
                        busy={busy}
                        enabled={formEnabled}
                        onReask={send}
                      />
                    )}
                  </div>
                )
              ))}
              {/* Вопрос отправлен, дельт ещё нет — тихий индикатор набора. */}
              {busy && !messages.some((m) => m.role === "assistant" && m.status === "running") && (
                <div className="assistant-typing" role="status">
                  <span className="assistant-typing-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span>Ассистент печатает…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <Typography.Paragraph type="secondary" className="assistant-note">
              Выводы AI — подсказка. Проверяйте детали в исходных записях.
            </Typography.Paragraph>
          </>
        )}
      </Card>
    </section>
  );
}
