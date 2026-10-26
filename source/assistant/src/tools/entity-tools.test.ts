// Тесты read-only инструментов сущностей (S2.1): list-контракт {items, total,
// page, has_more}, жёсткий page_size ≤ 20, абсолютные ссылки на карточки
// (ADR-021 deep links), язык профиля ru/kk, дружелюбные отказы вместо ошибок.
// API /v1 — фейк с фикстурами в формах реальных ответов эндпоинтов.

import { describe, expect, it } from "vitest";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { createEntityTools, READONLY_TOOL_NAMES, type EntityTool } from "./entity-tools.ts";
import { EntityApiClient } from "./api-client.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const INCIDENT_ID = "55555555-5555-4555-8555-555555555555";
const PERSON_ID = "66666666-6666-4666-8666-666666666666";
const PREMISES_ID = "22222222-2222-4222-8222-222222222222";
const BUILDING_ID = "33333333-3333-4333-8333-333333333333";
const STAFF_ID = "77777777-7777-4777-8777-777777777777";

interface Route {
  path: string;
  body: unknown;
  status?: number;
  fail?: boolean;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeApi(routes: Route[], language: "ru" | "kk" = "ru") {
  const calls: Array<{ path: string; params: URLSearchParams }> = [];
  const client = new EntityApiClient({
    getAccessToken: () => "jwt-user",
    fetchApi: async (rawPath) => {
      const [path, query = ""] = rawPath.split("?");
      const params = new URLSearchParams(query);
      if (path === "/v1/meta/me") {
        // Язык профиля — вне журнала: тесты проверяют вызовы инструментов.
        return jsonResponse(200, { profile: { language } });
      }
      calls.push({ path: path ?? "", params });
      const route = routes.find((r) => r.path === path);
      if (route?.fail) throw new Error("network down");
      if (!route) return jsonResponse(404, { error: { code: "NOT_FOUND" } });
      return jsonResponse(route.status ?? 200, route.body);
    },
  });
  const tools = createEntityTools(client);
  const byName = (name: string): EntityTool => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`нет инструмента ${name}`);
    return tool as EntityTool;
  };
  return { client, calls, tools, byName };
}

/** Текст из output инструмента: массив контента или строка (как в транскрипте Pi). */
function outputText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("");
  }
  return "";
}

async function run(tool: EntityTool, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await tool.execute(args as never, {} as ToolExecutionApi, undefined as never);
  return JSON.parse(outputText(result.output)) as Record<string, unknown>;
}

// — Фикстуры в формах реальных ответов /v1 —

const requestRow = {
  id: REQUEST_ID,
  number: "ОБ-12",
  state: "new",
  description: "Не работает лифт в подъезде 2",
  premises_id: PREMISES_ID,
  building_id: BUILDING_ID,
  created_at: "2026-10-20T08:00:00Z",
  author_name: "Иванов Иван",
  is_test: false,
};

const taskRow = {
  id: TASK_ID,
  number: "ЗД-7",
  title: "Заявка в лифтовую службу",
  instruction: "Составить заявку и дождаться бригады",
  state: "in_progress",
  assignee_person_id: STAFF_ID,
  assignee_name: "Петров Пётр",
  created_at: "2026-10-21T10:00:00Z",
  request_id: REQUEST_ID,
  building_ids: [BUILDING_ID],
  linked_request: { id: REQUEST_ID, number: "ОБ-12" },
  is_test: false,
  version: 1,
};

const incidentRow = {
  id: INCIDENT_ID,
  number: "АВ-3",
  title: "Отключение холодной воды",
  state: "mitigation",
  version: 2,
  public_text: "Идут восстановительные работы, ориентир — к вечеру.",
};

const personRow = {
  id: PERSON_ID,
  full_name: "Смагулов Ерлан",
  status: "active",
  phone_e164: "+77012345678",
  telegram_username: "erlan",
  registration_state: "approved",
  staff_roles: [],
  linked_premises: [
    { id: PREMISES_ID, building_id: BUILDING_ID, building_code: "Д-1", building_name: "Дом 1", kind: "apartment", number: "12", role: "owner" },
  ],
};

const connectionRow = {
  id: "88888888-8888-4888-8888-888888888888",
  person_id: PERSON_ID,
  premises_id: PREMISES_ID,
  status: "active",
  role: "owner",
  kind: "apartment",
  number: "12",
  building_id: BUILDING_ID,
  full_name: "Смагулов Ерлан",
};

const staffItem = {
  id: STAFF_ID,
  full_name: "Ахметова Айгуль",
  phone_e164: "+77076543210",
  telegram_username: "aiman",
  roles: ["administrator"],
  scheduled: false,
  open_tasks: 3,
};

describe("инструменты — реестр", () => {
  it("десять read-only инструментов, имена совпадают с белым списком", () => {
    const { tools } = makeApi([]);
    expect(tools.map((t) => t.name).sort()).toEqual([...READONLY_TOOL_NAMES].sort());
    expect(tools).toHaveLength(10);
  });

  it("все инструменты воспроизводимы после сбоя (replay: safe — только чтение)", () => {
    const { tools } = makeApi([]);
    for (const tool of tools) expect(tool.replay).toBe("safe");
  });

  it("page_size в схеме ограничен 20", () => {
    const { byName } = makeApi([]);
    const schema = byName("search_requests").parameters as {
      properties: { page_size?: { maximum?: number } };
    };
    expect(schema.properties.page_size?.maximum).toBe(20);
  });
});

describe("search_requests", () => {
  it("список обращений: карточки-ссылки с характеристиками, ru-подписи состояний", async () => {
    const { byName, calls } = makeApi([{ path: "/v1/requests", body: { items: [requestRow], next_cursor: null } }]);
    const out = await run(byName("search_requests"), { state: "new" });
    expect(calls[0]!.path).toBe("/v1/requests");
    expect(calls[0]!.params.get("state")).toBe("new");
    expect(out).toEqual({
      items: [{
        id: REQUEST_ID,
        label: "№ОБ-12 · Не работает лифт в подъезде 2",
        state: "Новая",
        href: `/requests?request=${REQUEST_ID}&entity_page=1`,
        created_at: "2026-10-20T08:00:00Z",
        author: "Иванов Иван",
      }],
      total: 1,
      page: 1,
      has_more: false,
    });
  });

  it("kk-профиль — подписи состояний на казахском", async () => {
    const { byName } = makeApi([{ path: "/v1/requests", body: { items: [requestRow] } }], "kk");
    const out = await run(byName("search_requests"), {});
    expect((out.items as Array<{ state: string }>)[0]!.state).toBe("Жаңа");
  });

  it("page_size > 20 невозможен: ограничение в запросе к API", async () => {
    const { byName, calls } = makeApi([{ path: "/v1/requests", body: { items: [] } }]);
    await run(byName("search_requests"), { page_size: 50 });
    expect(calls[0]!.params.get("limit")).toBe("21"); // page_size 20 + 1 на признак has_more
    expect(calls[0]!.params.get("cursor")).toBe(btoa("0"));
  });

  it("страница 2 уходит курсором-смещением", async () => {
    const { byName, calls } = makeApi([{ path: "/v1/requests", body: { items: [] } }]);
    await run(byName("search_requests"), { page: 2, page_size: 10 });
    expect(calls[0]!.params.get("cursor")).toBe(btoa("10"));
  });

  it("полная страница — признак has_more, лишняя запись не показывается", async () => {
    const extra = { ...requestRow, id: "99999999-9999-4999-8999-999999999999", number: "ОБ-13" };
    const { byName } = makeApi([{ path: "/v1/requests", body: { items: [requestRow, extra] } }]);
    const out = await run(byName("search_requests"), { page_size: 1 });
    expect(out.total).toBe(1);
    expect(out.has_more).toBe(true);
  });

  it("пустой разрез — «данных нет» без выдумок: пустой items", async () => {
    const { byName } = makeApi([{ path: "/v1/requests", body: { items: [], next_cursor: null } }]);
    const out = await run(byName("search_requests"), { search: "несуществующее" });
    expect(out).toEqual({ items: [], total: 0, page: 1, has_more: false });
  });

  it("403 от API — дружелюбный отказ, PDP не обходится", async () => {
    const { byName } = makeApi([{ path: "/v1/requests", body: { error: { code: "FORBIDDEN" } }, status: 403 }]);
    const out = await run(byName("search_requests"), {});
    expect(out).toEqual({ error: "Нет доступа к этим данным" });
  });
});

describe("get_request", () => {
  it("карточка обращения: описание, место, автор и ссылка", async () => {
    const card = {
      ...requestRow,
      place_label: "Дом 1, квартира 12",
      location_text: null,
      current_overdue: null,
    };
    const { byName, calls } = makeApi([{ path: `/v1/requests/${REQUEST_ID}`, body: card }]);
    const out = await run(byName("get_request"), { id: REQUEST_ID });
    expect(calls[0]!.path).toBe(`/v1/requests/${REQUEST_ID}`);
    expect(out).toMatchObject({
      id: REQUEST_ID,
      label: "№ОБ-12 · Не работает лифт в подъезде 2",
      state: "Новая",
      href: `/requests?request=${REQUEST_ID}&entity_page=1`,
      description: "Не работает лифт в подъезде 2",
      place: "Дом 1, квартира 12",
      author: "Иванов Иван",
    });
  });

  it("нет записи — «не найдено»; нет доступа — дружелюбный отказ", async () => {
    const { byName } = makeApi([{ path: `/v1/requests/${REQUEST_ID}`, body: {}, status: 404 }]);
    expect(await run(byName("get_request"), { id: REQUEST_ID })).toEqual({ error: "Запись не найдена" });
    const deny = makeApi([{ path: `/v1/requests/${REQUEST_ID}`, body: { error: { code: "FORBIDDEN" } }, status: 403 }]);
    expect(await run(deny.byName("get_request"), { id: REQUEST_ID })).toEqual({ error: "Нет доступа к этой записи" });
  });
});

describe("search_tasks", () => {
  it("задания по обращению: фильтр request_id уходит в API", async () => {
    const { byName, calls } = makeApi([{ path: "/v1/tasks", body: { items: [taskRow] } }]);
    const out = await run(byName("search_tasks"), { request_id: REQUEST_ID });
    expect(calls[0]!.path).toBe("/v1/tasks");
    expect(calls[0]!.params.get("request_id")).toBe(REQUEST_ID);
    expect(out).toEqual({
      items: [{
        id: TASK_ID,
        label: "№ЗД-7 · Заявка в лифтовую службу",
        state: "Выполняется",
        href: `/tasks?task=${TASK_ID}&entity_page=1`,
        assignee: "Петров Пётр",
        created_at: "2026-10-21T10:00:00Z",
        request: { label: "№ОБ-12", href: `/requests?request=${REQUEST_ID}&entity_page=1` },
      }],
      total: 1,
      page: 1,
      has_more: false,
    });
  });

  it("текстовый поиск фильтруется в адаптере (API ищет только по request_id)", async () => {
    const other = { ...taskRow, id: "99999999-9999-4999-8999-999999999999", title: "Уборка территории" };
    const { byName, calls } = makeApi([{ path: "/v1/tasks", body: { items: [taskRow, other] } }]);
    const out = await run(byName("search_tasks"), { search: "лифт" });
    expect(calls[0]!.params.get("search")).toBeNull();
    expect(out.total).toBe(1);
    expect((out.items as Array<{ label: string }>)[0]!.label).toContain("Заявка в лифтовую службу");
  });

  it("фильтр по состоянию задания", async () => {
    const review = { ...taskRow, state: "on_review" };
    const { byName } = makeApi([{ path: "/v1/tasks", body: { items: [taskRow, review] } }]);
    const out = await run(byName("search_tasks"), { state: "on_review" });
    expect(out.total).toBe(1);
    expect((out.items as Array<{ state: string }>)[0]!.state).toBe("На проверке");
  });
});

describe("get_task", () => {
  it("карточка задания: инструкция, исполнитель, отчёт и ссылка на обращение", async () => {
    const card = {
      ...taskRow,
      reports: [{ version: 1, performed_work: "Заменил датчик", result: "Лифт работает", performed_at: "2026-10-22T09:00:00Z" }],
    };
    const { byName, calls } = makeApi([{ path: `/v1/tasks/${TASK_ID}`, body: card }]);
    const out = await run(byName("get_task"), { id: TASK_ID });
    expect(calls[0]!.path).toBe(`/v1/tasks/${TASK_ID}`);
    expect(out).toMatchObject({
      id: TASK_ID,
      label: "№ЗД-7 · Заявка в лифтовую службу",
      state: "Выполняется",
      href: `/tasks?task=${TASK_ID}&entity_page=1`,
      assignee: "Петров Пётр",
      request: { label: "№ОБ-12", href: `/requests?request=${REQUEST_ID}&entity_page=1` },
      report: { performed_work: "Заменил датчик", result: "Лифт работает" },
    });
  });

  it("несуществующее задание — «не найдено»", async () => {
    const { byName } = makeApi([{ path: `/v1/tasks/${TASK_ID}`, body: {}, status: 404 }]);
    expect(await run(byName("get_task"), { id: TASK_ID })).toEqual({ error: "Запись не найдена" });
  });
});

describe("list_incidents", () => {
  it("список аварий с подписями состояний и ссылками", async () => {
    const { byName, calls } = makeApi([{ path: "/v1/incidents", body: { items: [incidentRow] } }]);
    const out = await run(byName("list_incidents"), {});
    expect(calls[0]!.path).toBe("/v1/incidents");
    expect(out).toEqual({
      items: [{
        id: INCIDENT_ID,
        label: "№АВ-3 · Отключение холодной воды",
        state: "Устранение",
        href: `/incidents?incident=${INCIDENT_ID}&entity_page=1`,
        summary: "Идут восстановительные работы, ориентир — к вечеру.",
      }],
      total: 1,
      page: 1,
      has_more: false,
    });
  });

  it("фильтр по состоянию — в адаптере", async () => {
    const { byName } = makeApi([{ path: "/v1/incidents", body: { items: [incidentRow] } }]);
    const out = await run(byName("list_incidents"), { state: "completed" });
    expect(out).toEqual({ items: [], total: 0, page: 1, has_more: false });
  });
});

describe("get_incident", () => {
  it("карточка аварии: публичный текст и зоны", async () => {
    const card = {
      ...incidentRow,
      forecast: "Вода появится к 18:00",
      next_update_at: "2026-10-23T18:00:00Z",
      scope: [{ building_id: BUILDING_ID, zone: null, service: "cold_water", recovered_at: null }],
      actions: [],
    };
    const { byName } = makeApi([{ path: `/v1/incidents/${INCIDENT_ID}`, body: card }]);
    const out = await run(byName("get_incident"), { id: INCIDENT_ID });
    expect(out).toMatchObject({
      id: INCIDENT_ID,
      label: "№АВ-3 · Отключение холодной воды",
      state: "Устранение",
      href: `/incidents?incident=${INCIDENT_ID}&entity_page=1`,
      summary: "Идут восстановительные работы, ориентир — к вечеру.",
      forecast: "Вода появится к 18:00",
      zones: 1,
    });
  });
});

describe("search_residents", () => {
  it("жители по подстроке имени: ссылка на карточку в реестре", async () => {
    const other = { ...personRow, id: "99999999-9999-4999-8999-999999999999", full_name: "Другой Житель" };
    const { byName, calls } = makeApi([{ path: "/v1/registry/persons", body: { items: [personRow, other] } }]);
    const out = await run(byName("search_residents"), { search: "Смагулов" });
    expect(calls[0]!.path).toBe("/v1/registry/persons");
    expect(out.total).toBe(1);
    expect(out.items).toEqual([{
      id: PERSON_ID,
      label: "Смагулов Ерлан",
      state: "Доступ подтверждён",
      href: `/users/residents?entity=${PERSON_ID}&entity_page=1`,
      phone: "+77012345678",
      premises: { label: "Квартира 12", href: `/registry/premises?entity=${PREMISES_ID}&entity_page=1` },
    }]);
  });

  it("поиск обязателен и не короче двух символов — по схеме", () => {
    const { byName } = makeApi([]);
    const schema = byName("search_residents").parameters as {
      properties: { search?: { minLength?: number } };
      required?: string[];
    };
    expect(schema.properties.search?.minLength).toBe(2);
    expect(schema.required).toContain("search");
  });

  it("поиск по телефону тоже находит", async () => {
    const { byName } = makeApi([{ path: "/v1/registry/persons", body: { items: [personRow] } }]);
    const out = await run(byName("search_residents"), { search: "45678" });
    expect(out.total).toBe(1);
  });
});

describe("list_connections", () => {
  it("связи жителей с помещениями: ссылка ведёт на помещение", async () => {
    const { byName, calls } = makeApi([{ path: "/v1/registry/connections", body: { items: [connectionRow] } }]);
    const out = await run(byName("list_connections"), {});
    expect(calls[0]!.path).toBe("/v1/registry/connections");
    expect(out).toEqual({
      items: [{
        id: connectionRow.id,
        label: "Смагулов Ерлан · Квартира 12",
        state: "Действует",
        href: `/registry/premises?entity=${PREMISES_ID}&entity_page=1`,
        role: "Собственник",
      }],
      total: 1,
      page: 1,
      has_more: false,
    });
  });

  it("фильтр по дому — в адаптере", async () => {
    const otherBuilding = { ...connectionRow, id: "99999999-9999-4999-8999-999999999999", building_id: "aaaaaaa1-1111-4111-8111-111111111111" };
    const { byName } = makeApi([{ path: "/v1/registry/connections", body: { items: [connectionRow, otherBuilding] } }]);
    const out = await run(byName("list_connections"), { building_id: BUILDING_ID });
    expect(out.total).toBe(1);
  });
});

describe("list_staff / get_staff", () => {
  it("сотрудники из /v1/staff (staff.read)", async () => {
    const { byName, calls } = makeApi([{ path: "/v1/staff", body: { items: [staffItem], available_roles: [], can_edit: false } }]);
    const out = await run(byName("list_staff"), {});
    expect(calls[0]!.path).toBe("/v1/staff");
    expect(out).toEqual({
      items: [{
        id: STAFF_ID,
        label: "Ахметова Айгуль",
        state: "administrator",
        href: "/users/staff",
        phone: "+77076543210",
        open_tasks: 3,
      }],
      total: 1,
      page: 1,
      has_more: false,
    });
  });

  it("карточка сотрудника из /v1/staff/:id с нагрузкой", async () => {
    const detail = {
      id: STAFF_ID,
      full_name: "Ахметова Айгуль",
      telegram_username: "aiman",
      phone_e164: "+77076543210",
      roles: ["administrator"],
      workload: { tasks: 3, requests: 1, schedules: 0 },
    };
    const { byName, calls } = makeApi([{ path: `/v1/staff/${STAFF_ID}`, body: detail }]);
    const out = await run(byName("get_staff"), { id: STAFF_ID });
    expect(calls[0]!.path).toBe(`/v1/staff/${STAFF_ID}`);
    expect(out).toMatchObject({
      id: STAFF_ID,
      label: "Ахметова Айгуль",
      state: "administrator",
      href: "/users/staff",
      roles: ["administrator"],
      workload: { tasks: 3, requests: 1, schedules: 0 },
    });
  });

  it("нет доступа к сотрудникам — дружелюбный отказ", async () => {
    const { byName } = makeApi([{ path: "/v1/staff", body: { error: { code: "FORBIDDEN" } }, status: 403 }]);
    const out = await run(byName("list_staff"), {});
    expect(out).toEqual({ error: "Нет доступа к этим данным" });
  });
});

describe("отказы сервиса", () => {
  it("сетевой сбой — «сервис недоступен», без выдуманных данных", async () => {
    const { byName } = makeApi([{ path: "/v1/incidents", body: null, fail: true }]);
    const out = await run(byName("list_incidents"), {});
    expect(out).toEqual({ error: "Сервис данных недоступен" });
  });

  it("внутренняя ошибка API — нейтральный отказ", async () => {
    const { byName } = makeApi([{ path: "/v1/requests", body: {}, status: 500 }]);
    const out = await run(byName("search_requests"), {});
    expect(out).toEqual({ error: "Не удалось получить данные" });
  });
});

describe("kk-эталон (S6.2)", () => {
  it("состояния аварий на казахском — выверенный эталон (recovery_check исправлен)", async () => {
    const { byName } = makeApi(
      [
        {
          path: "/v1/incidents",
          body: {
            items: [
              { id: INCIDENT_ID, number: "А-01", state: "recovery_check", title: "Сеть", public_text: null },
              { id: PERSON_ID, number: "А-02", state: "confirmed", title: "Отопление", public_text: null },
            ],
          },
        },
      ],
      "kk",
    );
    const out = await run(byName("list_incidents"), {});
    expect((out.items as Array<{ state: string }>).map((i) => i.state)).toEqual([
      "Қалпына келтіруді тексеру",
      "Расталды",
    ]);
  });

  it("отказ инструмента — на языке профиля kk", async () => {
    const { byName } = makeApi([{ path: "/v1/requests", body: {}, status: 403 }], "kk");
    const out = await run(byName("search_requests"), {});
    expect(out).toEqual({ error: "Бұл деректерге рұқсат жоқ" });
  });

  it("отказ без ответа API — на казахском", async () => {
    const { byName } = makeApi([{ path: "/v1/requests", body: null, fail: true }], "kk");
    const out = await run(byName("search_requests"), {});
    expect(out).toEqual({ error: "Деректер қызметі қолжетімсіз" });
  });

  it("задание без названия — fallback «Тапсырма» на казахском", async () => {
    const { byName } = makeApi(
      [
        {
          path: "/v1/tasks",
          body: {
            items: [
              { id: TASK_ID, number: "З-1", state: "created", title: null, instruction: null, assignee_name: null, created_at: null, linked_request: null },
            ],
          },
        },
      ],
      "kk",
    );
    const out = await run(byName("search_tasks"), {});
    expect((out.items as Array<{ label: string }>)[0]!.label).toBe("№З-1 · Тапсырма");
  });
});
