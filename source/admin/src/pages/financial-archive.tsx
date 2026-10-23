import { useState } from "react";
import { Alert, Button, Collapse, List, Space, Tag, Typography } from "antd";
import { DetailSection } from "../components/detail-section";
import { apiFetch } from "../lib/api";
export interface FinancialArchiveVersion {
  id: string; version: number; title: string; body: string; period_from: string; period_to: string;
  published_at: string | null; replaced_at: string | null; approved: boolean; needs_fix: boolean; correction_note: string;
  documents: { document_version_id: string; title: string; attachment_id: string; signed_attachment_id: string | null }[];
}
const day = (value: string) => value.split("-").reverse().join(".");
export function FinancialArchive({ publicationId, versions, onError }: { publicationId: string; versions: FinancialArchiveVersion[]; onError: (error: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  async function download(id: string) {
    setBusy(true);
    try { const result = await apiFetch<{ url: string }>(`/v1/publications/${publicationId}/files/${id}/url`); window.open(result.url, "_blank", "noopener,noreferrer"); }
    catch (error) { onError(error); } finally { setBusy(false); }
  }
  return <DetailSection title="Финансовые версии и основания">
    {!versions.length && <Typography.Paragraph>Комплект ещё не подготовлен.</Typography.Paragraph>}
    <Collapse key={versions[0]?.id ?? "empty"} defaultActiveKey={versions[0]?.id} items={versions.map(version => ({ key: version.id,
      label: <Space wrap><span>Версия {version.version}: {day(version.period_from)} — {day(version.period_to)}</span><Tag>{version.replaced_at ? "Заменена" : version.published_at ? "Опубликована" : version.approved ? "Разрешён выпуск" : "Подготовка"}</Tag></Space>,
      children: <>
        {version.needs_fix && <Alert type="warning" showIcon message="Требует исправления: в комплекте есть документ с замечаниями." />}
        <Typography.Title level={5}>{version.title}</Typography.Title>
        <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>{version.body}</Typography.Paragraph>
        {version.correction_note && <Typography.Paragraph>Пояснение исправления: {version.correction_note}</Typography.Paragraph>}
        <List dataSource={version.documents} locale={{ emptyText: "Доступных приложений нет" }} renderItem={document => <List.Item><Space wrap>
          <Button disabled={busy} onClick={() => void download(document.attachment_id)}>Файл: {document.title}</Button>
          {document.signed_attachment_id && <Button disabled={busy} onClick={() => void download(document.signed_attachment_id!)}>Подписанный экземпляр: {document.title}</Button>}
        </Space></List.Item>} />
      </>,
    }))} />
  </DetailSection>;
}
