import { useEffect, useState } from "react";
import { Alert, List, Spin, Typography } from "antd";
import { apiFetch } from "../lib/api";
type Row = Record<string, unknown>;

/** Сводка в карточке источника; операции выполняются в разделе документов. */
export function DocumentObligationSummary({ kind, id, actRequired = false }: { kind: "request" | "task"; id: string; actRequired?: boolean }) {
  const [items, setItems] = useState<Row[] | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setItems(null); setError(null);
    void apiFetch<{ items: Row[] }>(`/v1/documents/obligations?${kind}_id=${encodeURIComponent(id)}`)
      .then(r => { if (active) setItems(r.items); }, e => { if (active) setError(e instanceof Error ? e.message : "Не удалось проверить комплект"); });
    return () => { active = false; };
  }, [id, kind]);
  if (error) return <Alert type="error" message={error} />;
  if (!items) return <Spin aria-label="Загрузка комплекта документов" />;
  return <>
    {actRequired && !items.some(o => o.kind === "act" && o.phase === "before_acceptance") && <Alert type="warning" message="Приёмка заблокирована: для обязательного акта не настроено документальное обязательство." />}
    <List dataSource={items} locale={{ emptyText: "Документальные обязательства не назначены" }} renderItem={o => <List.Item><div>
      <Typography.Text>{String(o.basis)}</Typography.Text>
      <div>{o.phase === "before_acceptance" ? "До приёмки" : "После приёмки"} · {String(o.prepared_name)} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(String(o.due_at)))}</div>
      <Typography.Text type={o.completed_at ? "success" : "warning"}>{o.completed_at ? "Проверенный комплект указан" : "Не готово: требуется проверенная версия документа"}</Typography.Text>
    </div></List.Item>} />
    <Typography.Link href="/documents">Перейти к документам и обязанностям</Typography.Link>
  </>;
}
