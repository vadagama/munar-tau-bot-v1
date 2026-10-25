import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { AssistantRichText, type AssistantSource } from "./assistant-rich-text";
import type { AssistantStatus } from "../../../core/src/domains/dashboard/assistant";
import { apiFetch } from "../lib/api";
import { formatDateTime } from "../lib/format-date";
interface Answer { text: string; truncated: boolean; remaining: number | null; generated_at: string; sources: AssistantSource[] }
export function HomeAssistant({ status }: { status: AssistantStatus }) {
  if (status.state === "disabled") return null;
  if (status.state === "unavailable") return <Alert showIcon type="info" message="AI-ассистент временно недоступен. Виджеты продолжают работать." />;
  return <AssistantForm status={status} />;
}
function AssistantForm({ status }: { status: Extract<AssistantStatus, { remaining: number | null }> }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer>();
  const [remaining, setRemaining] = useState(status.remaining);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setRemaining(status.remaining); }, [status.remaining]);
  async function submit() {
    if (!question.trim() || busy.current || remaining === 0) return;
    busy.current = true; setPending(true); setError(""); setAnswer(undefined);
    try {
      const response = await apiFetch<Answer>("/v1/dashboard/assistant", { method: "POST", body: { question } });
      if (alive.current) { setAnswer(response); setRemaining(response.remaining); }
    } catch (e) {
      if (alive.current) {
        if ((e as { code?: string }).code === "RATE_LIMITED") setRemaining(0);
        setError(e instanceof Error ? e.message : "Не удалось получить ответ. Повторите запрос позже.");
      }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  if (remaining === 0 && !pending && !answer) return <Alert showIcon type="info" message="Лимит AI исчерпан. Он обновится в полночь по Алматы. Виджеты продолжают работать." />;
  return <section className="home-assistant" aria-label="AI-ассистент">
    <Card title="AI-ассистент" extra={<Typography.Text type="secondary">{remaining === null ? "Без суточного лимита" : `Осталось ${remaining} из 20`}</Typography.Text>}>
      <Typography.Paragraph>Помогу оценить текущую нагрузку и выбрать, с чего начать.</Typography.Paragraph>
      <Space wrap className="home-assistant-prompts">
        {["Что требует внимания?", "Как распределить работу по очередям?", "Составь краткую сводку"].map(text => <Button key={text} size="small" disabled={pending || remaining === 0} onClick={() => setQuestion(text)}>{text}</Button>)}
      </Space>
      {remaining !== 0 ? <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <Input.TextArea aria-label="Вопрос ассистенту" placeholder="Задайте вопрос по сводке главной" value={question} onChange={e => setQuestion(e.target.value)} maxLength={2000} autoSize={{ minRows: 2, maxRows: 6 }} disabled={pending} />
        <div className="home-assistant-footer"><Typography.Text type="secondary">В DeepSeek отправятся ваш вопрос, количества записей и номера доступных карточек.</Typography.Text>
          <Button htmlType="submit" type="primary" icon={<SendOutlined aria-hidden="true" />} loading={pending} disabled={!question.trim()}>{pending ? "Готовлю ответ" : "Спросить"}</Button></div>
      </form> : <Alert type="info" message="Лимит исчерпан до полуночи по Алматы." />}
      <div aria-live="polite" aria-busy={pending}>
        {error && <Alert showIcon type="error" message={error} />}
        {answer && <div className="home-assistant-answer"><div className="assistant-answer-heading"><h3>Ответ ассистента</h3><Typography.Text type="secondary">{formatDateTime(answer.generated_at)}</Typography.Text></div><AssistantRichText text={answer.text} sources={answer.sources} />
          {answer.truncated && <Typography.Paragraph type="secondary">Ответ сокращён по лимиту длины.</Typography.Paragraph>}
          <Typography.Paragraph type="secondary" className="assistant-answer-note">Выводы AI — подсказка. Проверяйте детали в исходных записях.</Typography.Paragraph>
        </div>}
      </div>
    </Card>
  </section>;
}
