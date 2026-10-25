import { useEffect, useRef, useState } from "react";
import { Alert, Button, List, Space, Tabs, Typography } from "antd";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import { usePageRefresh } from "../lib/use-page-refresh";
import { DetailSection } from "../components/detail-section";
import { ConfigurableTable } from "../components/configurable-table";
import { CardDrawer } from "./card-drawer";
import { FinancialRuleEditor } from "./financial-rule-editor";
import { FinancialDutyEditor } from "./financial-duty-editor";
import { FinancialRuleDetails } from "./financial-rule-details";
import { FinancialPlacementEditor } from "./financial-placement-editor";
type Row = Record<string, unknown>;
const day = (value: unknown) => typeof value === "string" ? value.split("-").reverse().join(".") : "—";
const moment = (value: unknown) => value ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date(String(value))) : "—";
export function FinancialPublication(props: { manager: boolean }) {
  const { identity } = useCabinetIdentity();
  const [rows, setRows] = useState<Row[]>([]), [rules, setRules] = useState<Row[]>([]), [card, setCard] = useState<Row | null>(null), [rule, setRule] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [offset, setOffset] = useState(0), [hasMore, setHasMore] = useState(false);
  const generation = useRef(0), cardGeneration = useRef(0);
  const [editingRule, setEditingRule] = useState(false);
  const [dutyAction, setDutyAction] = useState<"create" | "reassign" | null>(null);
  const [placing, setPlacing] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Не удалось прочитать финансовые обязанности");
  async function load() {
    const g = ++generation.current; setBusy(true);
    try {
      const [duties, settings] = await Promise.all([apiFetch<{ items: Row[]; has_more: boolean }>(offset ? `/v1/financial-obligations?offset=${offset}` : "/v1/financial-obligations"), apiFetch<{ items: Row[] }>("/v1/financial-rules")]);
      if (g === generation.current) { setRows(duties.items ?? []); setHasMore(!!duties.has_more); setRules(settings.items ?? []); setError(null); }
    } catch (e) { if (g === generation.current) fail(e); } finally { if (g === generation.current) setBusy(false); }
  }
  useEffect(() => { setCard(null); setRule(null); setEditingRule(false); setDutyAction(null); setPlacing(false); setNotice(null); void load(); return () => { generation.current++; cardGeneration.current++; }; }, [identity?.id, offset]);
  usePageRefresh(load, () => !busy && !card && !rule && !editingRule && !dutyAction);
  async function open(row: Row) {
    const g = ++cardGeneration.current; setBusy(true); setError(null);
    try { const next = await apiFetch<Row>(`/v1/financial-obligations/${row.id}`); if (g === cardGeneration.current) { setCard({ ...row, ...next }); setRule(null); } }
    catch (e) { if (g === cardGeneration.current) fail(e); } finally { if (g === cardGeneration.current) setBusy(false); }
  }
  function openRule(row: Row) {
    cardGeneration.current++; setBusy(false); setError(null); setRule(row); setCard(null);
  }
  const definition = (rule?.definition ?? (card?.rule_snapshot as Row | undefined)?.definition) as Row | undefined;
  return <DetailSection title="Финансовые обязанности и регламенты">
    <Space wrap>
      {props.manager && <Button disabled={busy} onClick={() => { cardGeneration.current++; setCard(null); setRule(null); setEditingRule(true); }}>Новый финансовый регламент</Button>}
      {props.manager && <Button disabled={busy} onClick={() => { cardGeneration.current++; setCard(null); setRule(null); setDutyAction("create"); }}>Новая финансовая обязанность</Button>}
    </Space>
    {error && <Alert type="error" showIcon message={error} />}
    {notice && <Alert type="success" showIcon message={notice} closable onClose={() => setNotice(null)} />}
    <Tabs items={[{ key: "duties", label: "Обязанности", children: <>
      <ConfigurableTable storageKey="columns.financial-obligations" settingsPlacement="inline" rowKey="id" dataSource={rows} loading={busy && !card} pagination={false} locale={{ emptyText: "Финансовых обязанностей нет" }} scroll={{ x: 700 }} columns={[
        { title: "Период", render: (_, row) => `${day(row.period_from)} — ${day(row.period_to)}` }, { title: "Первоначальный срок", dataIndex: "due_at", render: moment },
        { title: "Подготовитель", dataIndex: "prepared_name" }, { title: "Состояние", render: (_, row) => row.completed_at ? "Завершена" : "Не завершена" },
        { title: "Действия", key: "actions", render: (_, row) => <Button disabled={busy} onClick={() => void open(row)}>Открыть обязанность</Button> },
      ]} />
      <Space><Button disabled={!offset || busy} onClick={() => setOffset(n => Math.max(0, n - 200))}>Предыдущие обязанности</Button><Button disabled={!hasMore || busy} onClick={() => setOffset(n => n + 200)}>Следующие обязанности</Button></Space>
    </> }, { key: "rules", label: "Регламенты отчётов", children: <List dataSource={rules} locale={{ emptyText: "Финансовые регламенты не настроены" }} renderItem={row => <List.Item><Space wrap><Typography.Text>{String(row.name)} · версия {String(row.version)}</Typography.Text><Button onClick={() => openRule(row)}>Открыть регламент</Button></Space></List.Item>} /> }]} />
    <CardDrawer open={!!card || !!rule || editingRule || !!dutyAction} title={rule ? String(rule.name) : editingRule ? "Новый финансовый регламент" : "Финансовая обязанность"} closeDisabled={busy} onClose={() => { cardGeneration.current++; setCard(null); setRule(null); setEditingRule(false); setDutyAction(null); setPlacing(false); }}>
      {rule?.can_manage === true && !editingRule && <Button onClick={() => setEditingRule(true)}>Изменить финансовый регламент</Button>}
      {editingRule && <FinancialRuleEditor rule={rule} onCancel={() => setEditingRule(false)} onSaved={() => { setEditingRule(false); setRule(null); void load(); }} />}
      {dutyAction && <FinancialDutyEditor duty={dutyAction === "reassign" ? card : null} onCancel={() => setDutyAction(null)} onSaved={() => { setDutyAction(null); setCard(null); void load(); }} />}
      {placing && card && <FinancialPlacementEditor duty={card} onCancel={() => setPlacing(false)} onSaved={result => { setPlacing(false); setCard(null); setNotice(result.completed_at ? "Размещение подтверждено. Обязанность завершена." : "Размещение сохранено. Обязанность остаётся незавершённой: проверьте текущий комплект и остальные каналы."); void load(); }} />}
      {rule ? <DetailSection title="Исходные условия"><FinancialRuleDetails rule={rule} /></DetailSection> : definition && <DetailSection title="Исходные условия"><Typography.Paragraph>{String(definition.form_description)}</Typography.Paragraph><Typography.Paragraph>Обязательные каналы: {((definition.channels as string[]) ?? []).join(", ")}</Typography.Paragraph></DetailSection>}
      {card && <>
        {card.can_manage === true && !dutyAction && !placing && <Space wrap>{!card.completed_at && <Button onClick={() => setDutyAction("reassign")}>Передать финансовую обязанность</Button>}{!!card.publication_id && <Button onClick={() => setPlacing(true)}>Подтвердить размещение</Button>}</Space>}
        <DetailSection title="Состояние обязанности"><Typography.Paragraph>Первоначальный срок: {moment(card.due_at)}. {card.completed_at ? "Завершена" : "Не завершена"}.</Typography.Paragraph>
          {!!card.rule_version && <Typography.Paragraph>Исходный регламент: версия {String(card.rule_version)}.</Typography.Paragraph>}
          <Typography.Paragraph>Подготовитель: {String(card.prepared_name ?? "—")}. Проверяющий: {String(card.reviewer_name ?? "—")}. Публикатор: {String(card.publisher_name ?? "—")}.</Typography.Paragraph>
          {!!(card.missing_channels as string[])?.length && <Alert type="warning" showIcon message={`Осталось подтвердить: ${(card.missing_channels as string[]).join(", ")}`} />}
          {!!card.publication_id && <Typography.Link href="/publications" target="_blank" rel="noreferrer">Открыть публикации</Typography.Link>}
        </DetailSection>
        <DetailSection title="История размещений"><List dataSource={(card.placements as Row[]) ?? []} locale={{ emptyText: "Размещения ещё не подтверждены" }} renderItem={placement => <List.Item><Space direction="vertical"><Typography.Text>Версия {String(placement.financial_version ?? "—")} · {String(placement.channel)} · {moment(placement.placed_at)}</Typography.Text><Typography.Paragraph>{String(placement.evidence)}</Typography.Paragraph></Space></List.Item>} /></DetailSection>
      </>}
    </CardDrawer>
  </DetailSection>;
}
