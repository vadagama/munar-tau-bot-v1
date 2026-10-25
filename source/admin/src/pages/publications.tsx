import { DeadlineDatePicker } from "../components/deadline-input";
import { ProcessOverview, ProcessActions, ProcessHistory } from "../components/process-card";
import { publicationGuidance, processActionHint } from "../components/process-guidance";
import { DetailSection } from "../components/detail-section";
import { ConfigurableTable } from "../components/configurable-table";
import { PageLayout } from "../components/page-layout";
import { usePageRefresh } from "../lib/use-page-refresh";
import { isVersionConflict, VERSION_CONFLICT_MESSAGE } from "./version-conflict";
import { ActionPanel } from "./action-panel";
import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  List,
  Select,
  Space,
  Typography,
} from "antd";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import { CardDrawer } from "./card-drawer";
import { FinancialArchive, type FinancialArchiveVersion } from "./financial-archive";
import { FinancialPackageFields, type DocumentVersionOption } from "./financial-package-fields";
import { financialEditValues, financialPublicationValues } from "./financial-package-values";
import { FinancialPublication } from "./financial-publication";
type Row = Record<string, unknown>;
const required = [{ required: true, message: "Заполните поле" }];
const kinds: Record<string, string> = {
  announcement: "Объявление",
  outage: "Плановое отключение",
  work_report: "Отчёт о работе",
  financial_report: "Финансовый отчёт",
};
const actionNames: Record<string, string> = {
  create: "Новая публикация", edit: "Редактирование публикации",
  media: "Выбрать фото и видео", problem: "Сообщить о проблеме",
  submit_approval: "На согласование председателю", publish: "Опубликовать",
  schedule: "Запланировать публикацию", approve: "Разрешить публикацию",
  update_outage: "Обновить план отключения", restore: "Подтвердить восстановление",
  archive: "В архив",
};
const states: Record<string, string> = {
  draft: "Черновик",
  pending_approval: "На согласовании",
  scheduled: "Запланирована",
  published: "Опубликована",
  archived: "В архиве",
};
export function PublicationsPage() {
  const { roles, identity } = useCabinetIdentity(),
    manager = roles.some((r) =>
      ["chairman", "administrator", "deputy"].includes(r)
    );
  const [rows, setRows] = useState<Row[]>([]),
    [card, setCard] = useState<Row | null>(null),
    [buildings, setBuildings] = useState<Row[]>([]),
    [works, setWorks] = useState<Row[]>([]),
    [people, setPeople] = useState<Row[]>([]),
    [versions, setVersions] = useState<DocumentVersionOption[]>([]), [obligations, setObligations] = useState<Row[]>([]),
    [moreVersions, setMoreVersions] = useState(false), [moreObligations, setMoreObligations] = useState(false),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<string | null>(null),
    [form] = Form.useForm();
  const kind = Form.useWatch("kind", form), requiresDocument = Form.useWatch("requires_document", form), documentIds = Form.useWatch("document_version_ids", form) as string[] | undefined,
    key = useRef(crypto.randomUUID()),
    generation = useRef(0), cardGeneration = useRef(0), versionOffset = useRef(0), obligationOffset = useRef(0);
  const financial = card?.kind === "financial_report";
  const canManage = financial ? card.can_manage === true : manager;
  const canApprove = financial ? card.can_approve === true : roles.includes("chairman");
  const actionTitle = action === "approve" && financial ? "Разрешить финансовый выпуск" : actionNames[action ?? ""] ?? "Действие с публикацией";
  const currentPackage = ((card?.financial_versions as Row[]) ?? []).find(v => v.id === card?.financial_version_id);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Ошибка запроса");
  async function refresh() {
    const g = ++generation.current;
    setBusy(true);
    try {
      const r = await apiFetch<{ items: Row[] }>("/v1/publications");
      if (g === generation.current) setRows(r.items);
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  usePageRefresh(refresh, () => !busy && !action && !card);
  useEffect(() => {
    setCard(null); setAction(null);
    void refresh();
    return () => {
      generation.current++;
      cardGeneration.current++;
    };
  }, [identity?.id]);
  async function open(id: string) {
    const g = ++cardGeneration.current;
    try {
      const next = await apiFetch<Row>(`/v1/publications/${id}`);
      if (g === cardGeneration.current) { setCard(next); setError(null); }
    } catch (e) {
      if (g === cardGeneration.current) fail(e);
    }
  }
  async function begin(a: string) {
    if (a === "create") { cardGeneration.current++; setCard(null); }
    const g = cardGeneration.current;
    setError(null);
    setBusy(true);
    setAction(a);
    key.current = crypto.randomUUID();
    form.resetFields();
    form.setFieldsValue({ kind: "announcement", requires_document: false });
    try {
      if (a === "edit" && card) {
        form.setFieldsValue({
          ...card,
          ...(card.kind === "financial_report" ? financialEditValues(card) : {}),
          planned_start: card.planned_start
            ? dayjs(String(card.planned_start))
            : undefined,
          planned_end: card.planned_end
            ? dayjs(String(card.planned_end))
            : undefined,
        });
      }
      if (a === "media") {
        form.setFieldsValue({
          attachment_ids: ((card?.files as Row[]) ?? []).map((f) => f.id),
        });
      }
      if (a === "create" || a === "edit") {
        try {
          const [b, w, p, v, o] = await Promise.all([
            apiFetch<{ items: Row[] }>("/v1/registry/buildings"),
            apiFetch<{ items: Row[] }>("/v1/common-works"),
            apiFetch<{ persons: Row[] }>("/v1/incidents/context"),
            apiFetch<{ items: DocumentVersionOption[]; has_more: boolean }>("/v1/documents/version-options"),
            apiFetch<{ items: Row[]; has_more: boolean }>("/v1/financial-obligations"),
          ]);
          if (g !== cardGeneration.current) return;
          setBuildings(b.items);
          setWorks(w.items.filter((x) => x.state === "completed"));
          setPeople(p.persons);
          const selected = a === "edit" && card?.kind !== "financial_report" ? (card?.document_versions as DocumentVersionOption[]) ?? [] : [];
          setVersions([...new Map([...v.items, ...selected].map(item => [item.id, item])).values()]); setMoreVersions(v.has_more); versionOffset.current = 0;
          setObligations(o.items); setMoreObligations(o.has_more); obligationOffset.current = 0;
        } catch (e) {
          fail(e);
        }
      }
    } finally { if (g === cardGeneration.current) setBusy(false); }
  }
  async function loadMoreVersions() {
    setBusy(true); const g = cardGeneration.current;
    try { const next = await apiFetch<{ items: DocumentVersionOption[]; has_more: boolean }>(`/v1/documents/version-options?offset=${versionOffset.current + 200}`);
      if (g === cardGeneration.current) { versionOffset.current += 200; setVersions(old => [...old, ...next.items.filter(item => !old.some(previous => previous.id === item.id))]); setMoreVersions(next.has_more); } }
    catch (e) { if (g === cardGeneration.current) fail(e); } finally { if (g === cardGeneration.current) setBusy(false); }
  }
  async function loadMoreObligations() {
    setBusy(true); const g = cardGeneration.current;
    try { const next = await apiFetch<{ items: Row[]; has_more: boolean }>(`/v1/financial-obligations?offset=${obligationOffset.current + 200}`);
      if (g === cardGeneration.current) { obligationOffset.current += 200; setObligations(old => [...old, ...next.items]); setMoreObligations(next.has_more); } }
    catch (e) { if (g === cardGeneration.current) fail(e); } finally { if (g === cardGeneration.current) setBusy(false); }
  }
  async function submit() {
    try {
      const values = financialPublicationValues(await form.validateFields());
      delete values.replace_unavailable_documents;
      for (
        const name of [
          "planned_start",
          "planned_end",
          "publish_at",
          "restored_at",
        ]
      ) if (values[name]) values[name] = (values[name] as dayjs.Dayjs).toISOString();
      setBusy(true);
      setError(null);
      const result = await apiFetch<Row>(
        action === "create"
          ? "/v1/publications"
          : action === "edit"
          ? `/v1/publications/${card!.id}`
          : `/v1/publications/${card!.id}/${
            action === "media"
              ? "media"
              : action === "problem"
              ? "problems"
              : "transitions"
          }`,
        {
          method: action === "edit" ? "PATCH" : "POST",
          body: action === "create"
            ? values
            : { ...values, action, expected_version: card!.version },
          idempotencyKey: key.current,
        },
      );
      await refresh();
      if (action !== "problem") await open(String(result.id));
      setAction(null);
    } catch (e) {
      if (e instanceof Error) fail(e);
      if (isVersionConflict(e) && card) {
        try {
          setCard(await apiFetch<Row>(`/v1/publications/${card.id}`));
          setError(VERSION_CONFLICT_MESSAGE);
        } catch (refreshError) { fail(refreshError); }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageLayout title="Публикации и отключения"
      actions={manager ? (<Space wrap>
        {manager && (
          <Button type="primary" onClick={() => void begin("create")}>
            Создать публикацию
          </Button>
        )}
      </Space>) : null}>

      {error && !card && !action && <Alert type="error" message={error} showIcon />}

      <ConfigurableTable storageKey="columns.publications" onMobileRowClick={r => void open(String(r.id))} settingsPlacement="page"
        rowKey="id"
        dataSource={rows}
        mobileRender={r => <div className="mobile-summary"><Button type="link" onClick={() => void open(String(r.id))}>{String(r.title)}</Button><div>{kinds[String(r.kind)]} · {states[String(r.state)]}</div></div>}
        loading={busy}
        scroll={{ x: 650 }}
        locale={{ emptyText: "Публикаций нет" }}
        columns={[{ title: "Название", dataIndex: "title", render: (title, r) => <Button type="link" onClick={() => void open(String(r.id))}>{String(title)}</Button> }, {
          title: "Вид",
          dataIndex: "kind",
          render: (k) => kinds[String(k)],
        }, {
          title: "Состояние",
          dataIndex: "state",
          render: (s) => states[String(s)],
        }]}
      />
      {roles.some(r => ["finance", "chairman", "administrator", "deputy"].includes(r)) && <FinancialPublication manager={manager} />}
      <CardDrawer
        open={!!card || !!action}
        title={card ? String(card.title) : "Новая публикация"}
        closeDisabled={busy}
        onClose={() => { cardGeneration.current++; setCard(null); }}
      >
        {error && card && !action && <Alert role="alert" type="error" showIcon message={error} />}
        {card && (
          <div key={String(card.id)} className="process-card-content">
          <ProcessOverview guidance={publicationGuidance(card, canManage, canApprove)} state={states[String(card.state)]} due={card.publish_at} dueLabel="Публикация">
            <ProcessActions primary={publicationGuidance(card, canManage, canApprove).primary}>
          {card.kind === "work_report" && card.state === "published" && (
            <Button key="problem" onClick={() => void begin("problem")}>
              Сообщить о проблеме с этой работой
            </Button>
          )}
          {canManage && (
            <>
              {(card.state === "draft" || (financial && card.state === "published")) && (
                <>
                  <Button key="edit" onClick={() => void begin("edit")}>
                    {financial && card.state === "published" ? "Подготовить исправление" : "Редактировать"}
                  </Button>
                  {card.kind === "work_report" && (
                    <Button key="media" onClick={() => void begin("media")}>
                      Выбрать фото и видео
                    </Button>
                  )}
                </>
              )}
              {card.state === "draft" && (
                <>
                  {card.kind === "financial_report" && !card.approved_by
                    ? (
                      <Button key="submit_approval" onClick={() => void begin("submit_approval")}>
                        На согласование председателю
                      </Button>
                    )
                    : (
                      <>
                        <Button key="publish"
                          type="primary"
                          onClick={() => void begin("publish")}
                        >
                          Опубликовать
                        </Button>
                        <Button key="schedule" onClick={() => void begin("schedule")}>
                          Запланировать
                        </Button>
                      </>
                    )}
                </>
              )}
              {card.state === "pending_approval" &&
                canApprove && (
                <Button key="approve" onClick={() => void begin("approve")}>
                  {financial ? "Разрешить финансовый выпуск" : "Разрешить публикацию"}
                </Button>
              )}
              {card.state === "published" && card.kind === "outage" &&
                !card.restored_at && (
                <>
                  <Button key="update_outage" onClick={() => void begin("update_outage")}>
                    Обновить план
                  </Button>
                  <Button key="restore"
                    onClick={() => void begin("restore")}
                  >
                    Подтвердить восстановление
                  </Button>
                </>
              )}
              {["published", "scheduled"].includes(String(card.state)) && (
                <Button key="archive" onClick={() => void begin("archive")}>В архив</Button>
              )}
            </>
          )}
            </ProcessActions>
          </ProcessOverview>
          <DetailSection title="Содержание публикации">
          <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
            {String(card.body)}
          </Typography.Paragraph>
          {card.kind === "outage" && (
            <Alert
              type="info"
              message={`План: ${card.planned_start} — ${card.planned_end}. Фактическое восстановление: ${
                card.restored_at ?? "не подтверждено"
              }`}
            />
          )}
          <List
            dataSource={(card.files as Row[]) ?? []}
            renderItem={(f) => (
              <List.Item>
                <Button
                  onClick={() => {
                    void apiFetch<{ url: string }>(
                      `/v1/publications/${card.id}/files/${f.id}/url`,
                    ).then((r) =>
                      window.open(r.url, "_blank", "noopener,noreferrer")
                    ).catch(fail);
                  }}
                >
                  {String(f.filename)}
                </Button>
              </List.Item>
            )}
          />
          </DetailSection>
          {card.kind === "financial_report" && <FinancialArchive publicationId={String(card.id)} versions={(card.financial_versions as FinancialArchiveVersion[]) ?? []} onError={fail} />}
          <ProcessHistory>
          <List
            dataSource={(card.history as Row[]) ?? []}
            renderItem={(h) => (
              <List.Item>{String(h.at)} — версия {String(h.version)}</List.Item>
            )}
          />
          </ProcessHistory>
          </div>
        )}
      <ActionPanel
        description={processActionHint("publication", action)}
        form={form}
        error={error}
        full={action === "create" || action === "edit"}
        open={!!action}
        title={actionTitle}
        okText={action === "edit" ? "Сохранить изменения" : action === "create" ? "Создать публикацию" : action === "media" ? "Сохранить материалы" : action === "problem" ? "Отправить сообщение" : actionTitle}
        onCancel={() => setAction(null)}
        onOk={() => void submit()}
        busy={busy}
      >
        <Form form={form} layout="vertical" disabled={busy}>
          {(financial || kind === "financial_report" || requiresDocument === true || card?.requires_document === true) && action !== "archive" && <Form.Item name="reason" label="Служебная причина" rules={required}><Input.TextArea /></Form.Item>}
          {["create", "edit"].includes(action ?? "") && (
            <>
              <Form.Item name="kind" label="Вид" rules={required}>
                <Select
                  disabled={action === "edit" && financial}
                  options={Object.entries(kinds).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Form.Item>
              <Form.Item name="title" label="Название" rules={required}>
                <Input />
              </Form.Item>
              <Form.Item name="body" label="Текст для жителей" rules={required}>
                <Input.TextArea rows={5} />
              </Form.Item>
              <Form.Item name="building_ids" label="Аудитория" rules={required}>
                <Select
                  mode="multiple"
                  disabled={kind === "financial_report"}
                  options={buildings.map((b) => ({
                    value: String(b.id),
                    label: String(b.name ?? b.code),
                  }))}
                />
              </Form.Item>
              {kind !== "financial_report" && <Form.Item name="requires_document" valuePropName="checked">
                <Checkbox>
                  Сообщение о взносах, правилах или решении — требуется
                  утверждённый документ
                </Checkbox>
              </Form.Item>}
              {kind === "financial_report" ? <>
                <FinancialPackageFields form={form} obligations={obligations.filter(o => o.publication_id == null || o.publication_id === card?.id)} versions={versions} existing={(currentPackage?.documents as Row[]) ?? []} />
                {moreObligations && <Button onClick={() => void loadMoreObligations()}>Ещё обязанности</Button>}
                <Form.Item name="correction_note" label="Публичное пояснение исправления" rules={action === "edit" && ((card?.financial_versions as Row[]) ?? []).some(v => !!v.published_at) ? required : []}><Input.TextArea /></Form.Item>
              </> : requiresDocument === true && <>
                {card?.document_selection_incomplete === true && <>
                  <Alert type="warning" showIcon message="Часть прежних оснований недоступна. Выберите полный комплект заново и явно подтвердите замену." />
                  <Form.Item name="replace_unavailable_documents" valuePropName="checked" rules={[{ validator: async (_, value) => { if (value !== true) throw new Error("Подтвердите замену недоступных оснований"); } }]}><Checkbox>Заменить недоступные основания выбранным комплектом</Checkbox></Form.Item>
                </>}
                <Form.Item name="document_version_ids" label="Проверенные документальные основания" rules={required}><Select mode="multiple" showSearch optionFilterProp="label" options={versions.map(v => ({ value: v.id, label: `${v.title} · версия ${v.version}${v.available === false ? " · недоступно для выпуска" : ""}`, disabled: v.available === false }))} /></Form.Item>
                {versions.filter(v => v.available === false && documentIds?.includes(v.id)).map(v => <Button key={v.id} onClick={() => form.setFieldValue("document_version_ids", (documentIds ?? []).filter(id => id !== v.id))}>Убрать недействительное основание: {v.title} · версия {v.version}</Button>)}
              </>}
              {(kind === "financial_report" || requiresDocument === true) && moreVersions && <Button onClick={() => void loadMoreVersions()}>Ещё версии документов</Button>}
              {kind === "work_report" && (
                <Form.Item
                  name="common_work_id"
                  label="Принятая общая работа"
                  rules={required}
                >
                  <Select
                    options={works.map((w) => ({
                      value: String(w.id),
                      label: `${w.number}: ${w.title}`,
                    }))}
                  />
                </Form.Item>
              )}
              {kind === "outage" && (
                <>
                  <Form.Item name="service" label="Услуга" rules={required}>
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="responsible_person_id"
                    label="Ответственный"
                    rules={required}
                  >
                    <Select
                      options={people.map((p) => ({
                        value: String(p.id),
                        label: String(p.full_name),
                      }))}
                    />
                  </Form.Item>
                  {[["planned_start", "Начало"], ["planned_end", "Окончание"]]
                    .map(([name, label]) => (
                      <Form.Item
                        key={name}
                        name={name}
                        label={label}
                        rules={required}
                      >
                        {name === "planned_end"
                          ? <DeadlineDatePicker showTime format="DD.MM.YYYY HH:mm" />
                          : <DatePicker showTime format="DD.MM.YYYY HH:mm" />}
                      </Form.Item>
                    ))}
                </>
              )}
            </>
          )}
          {action === "media" && (
            <>
              <Form.Item
                name="attachment_ids"
                label="Выбранные материалы"
                rules={required}
              >
                <Select
                  mode="multiple"
                  options={((card?.available_files as Row[]) ?? []).map(
                    (f) => ({ value: String(f.id), label: String(f.filename) }),
                  )}
                />
              </Form.Item>
              <Form.Item name="privacy_checked" valuePropName="checked">
                <Checkbox>
                  Проверено: выбранные материалы можно раскрыть аудитории
                  публикации; чужих личных данных нет
                </Checkbox>
              </Form.Item>
            </>
          )}
          {action === "problem" && (
            <>
              <Form.Item name="building_id" label="Объект" rules={required}>
                <Select
                  options={((card?.building_ids as string[]) ?? []).map(
                    (value) => ({
                      value,
                      label: (buildings.find((b) =>
                        b.id === value
                      )?.name ?? buildings.find((b) =>
                        b.id === value
                      )?.code) as string ?? "Объект публикации",
                    }),
                  )}
                />
              </Form.Item>
              <Form.Item
                name="location_text"
                label="Где сохранилась проблема"
                rules={required}
              >
                <Input />
              </Form.Item>
              <Form.Item name="text" label="Описание" rules={required}>
                <Input.TextArea />
              </Form.Item>
            </>
          )}
          {action === "schedule" && (
            <Form.Item
              name="publish_at"
              label="Время публикации"
              rules={required}
            >
              <DatePicker showTime format="DD.MM.YYYY HH:mm" />
            </Form.Item>
          )}
          {action === "approve" && (
            <Form.Item
              name="approval_note"
              label="Основание внешних согласований"
              rules={required}
            >
              <Input.TextArea />
            </Form.Item>
          )}
          {action === "archive" && (
            <Form.Item name="reason" label="Причина" rules={required}>
              <Input.TextArea />
            </Form.Item>
          )}
          {["restore", "update_outage"].includes(action ?? "") && (
            <>
              <Form.Item
                name="body"
                label="Обновление для жителей"
                rules={required}
              >
                <Input.TextArea />
              </Form.Item>
              <Form.Item
                name={action === "restore" ? "restored_at" : "planned_end"}
                label={action === "restore"
                  ? "Фактическое восстановление"
                  : "Новый срок окончания"}
                rules={required}
              >
                {action === "restore"
                  ? <DatePicker showTime format="DD.MM.YYYY HH:mm" />
                  : <DeadlineDatePicker showTime format="DD.MM.YYYY HH:mm" />}
              </Form.Item>
              {action === "restore" && (
                <Form.Item
                  name="restoration_method"
                  label="Как проверено восстановление"
                  rules={required}
                >
                  <Input.TextArea />
                </Form.Item>
              )}
            </>
          )}
          {action === "publish" && (
            <Alert
              type="warning"
              showIcon
              message="Проверьте текст и аудиторию. Публикация будет доступна жителям и попадёт в их уведомления по настройкам."
            />
          )}
        </Form>
      </ActionPanel>
      </CardDrawer>

    </PageLayout>
  );
}
