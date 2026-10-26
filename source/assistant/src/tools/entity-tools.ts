// Read-only инструменты сущностей (S2.1): обращения, задания, аварии, жители,
// связи, сотрудники. Каждый инструмент ходит в /v1 с JWT пользователя
// (ADR-021: PDP на стороне API) и отдаёт модели list-контракт
// {items, total, page, has_more} с готовыми абсолютными ссылками на карточки
// (deep links ADR-021). Дружелюбные отказы вместо исключений: модель честно
// говорит «нет данных»/«нет доступа» и не выдумывает записи. Все инструменты —
// replay: "safe" (повтор после сбоя безопасен: только чтение).

import { Type, type TSchema } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { requestStateText } from "../../../core/src/locales/requests.ts";
import { taskStateText } from "../../../core/src/locales/tasks.ts";
import { label, premiseLabels, roleLabels, stateLabels } from "../../../core/src/locales/registry.ts";
import { ApiToolError, EntityApiClient } from "./api-client.ts";

/** Имена инструментов read-only реестра — белый список для guard (guard.ts). */
export const READONLY_TOOL_NAMES: readonly string[] = [
  "search_requests",
  "get_request",
  "search_tasks",
  "get_task",
  "list_incidents",
  "get_incident",
  "search_residents",
  "list_connections",
  "list_staff",
  "get_staff",
];

/** Инструмент сущностей: execute возвращает JSON-конверт в output. */
export type EntityTool = ToolRegistration<TSchema>;

/** Жёсткий предел страницы (план S2.1: page_size ≤ 20). */
const MAX_PAGE_SIZE = 20;
const DEFAULT_PAGE_SIZE = 10;

/** Ограничение числа источников в ответе (пул ссылок для панели). */
export const MAX_SOURCES = 40;

// — Deep links кабинета (ADR-021, эталон — domains/dashboard/service.ts) —

const requestHref = (id: string) => `/requests?request=${encodeURIComponent(id)}&entity_page=1`;
const taskHref = (id: string) => `/tasks?task=${encodeURIComponent(id)}&entity_page=1`;
const incidentHref = (id: string) => `/incidents?incident=${encodeURIComponent(id)}&entity_page=1`;
const premisesHref = (id: string) => `/registry/premises?entity=${encodeURIComponent(id)}&entity_page=1`;
const residentHref = (id: string) => `/users/residents?entity=${encodeURIComponent(id)}&entity_page=1`;
const STAFF_HREF = "/users/staff";

/** Подписи состояний аварий (VS-7); kk — предварительные, выверка в S6.2. */
const INCIDENT_STATE_TEXT: Record<string, { ru: string; kk: string }> = {
  signal_check: { ru: "Проверка сигнала", kk: "Сигналды тексеру" },
  confirmed: { ru: "Подтверждена", kk: "Расталды" },
  not_confirmed: { ru: "Не подтверждена", kk: "Расталмады" },
  mitigation: { ru: "Устранение", kk: "Жойылуда" },
  recovery_check: { ru: "Проверка восстановления", kk: "Қалпына келуін тексеру" },
  completed: { ru: "Завершена", kk: "Аяқталды" },
};

function incidentStateText(state: unknown, lang: "ru" | "kk"): string {
  return INCIDENT_STATE_TEXT[String(state)]?.[lang] ?? String(state ?? "");
}

/** Компактная строка для label/summary: пробелы схлопнуты, хвост — с многоточием. */
function cut(value: unknown, max = 120): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Страница и размер — из аргументов модели, с защитными границами. */
function pageBounds(args: { page?: unknown; page_size?: unknown }): { page: number; size: number } {
  return {
    page: Math.max(1, Math.floor(num(args.page, 1))),
    size: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(num(args.page_size, DEFAULT_PAGE_SIZE)))),
  };
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  has_more: boolean;
}

/** Нарезка полного списка (эндпоинты /v1 без серверной пагинации). */
function pageOf<T>(rows: T[], page: number, size: number): Page<T> {
  const start = (page - 1) * size;
  return {
    items: rows.slice(start, start + size),
    total: rows.slice(start, start + size).length,
    page,
    has_more: rows.length > start + size,
  };
}

// — Описание ошибок для модели: без стеков и кодов, дружелюбно и честно —

export function failure(error: unknown, kind: "single" | "list") {
  const status = error instanceof ApiToolError ? error.status : -1;
  const message =
    status === 403
      ? kind === "single" ? "Нет доступа к этой записи" : "Нет доступа к этим данным"
      : status === 404 || status === 400
        ? "Запись не найдена"
        : status === 0
          ? "Сервис данных недоступен"
          : "Не удалось получить данные";
  return textOutput({ error: message });
}

const listContractNote =
  "Формат: {items, total, page, has_more}. Ссылку из href вставляй в markdown-ссылку как есть, текст ссылки — label. " +
  "Если items пуст — так и сообщи, что данных нет, и не выдумывай записи.";

const uuid = () => Type.String({ description: "uuid записи" });
const pageArgs = {
  page: Type.Optional(Type.Number({ minimum: 1, description: "номер страницы, начиная с 1" })),
  page_size: Type.Optional(
    Type.Number({ minimum: 1, maximum: MAX_PAGE_SIZE, description: "записей на странице, не больше 20" }),
  ),
};

/**
 * Фабрика инструментов сущностей: клиент /v1 инъецируется (в тестах — фейк),
 * в PiChatRuntime создаётся на клиенте API изолята.
 */
export function createEntityTools(client: EntityApiClient) {
  const language = () => client.language();

  const searchRequests = defineTool({
    name: "search_requests",
    replay: "safe",
    description:
      "Ищет обращения жителей ОСИ. Параметры: search — текст по номеру, описанию, автору или переписке; " +
      "state — состояние (new, in_work, on_review нет — смотри справочник состояний обращений: " +
      "draft, new, reviewing, need_clarification, in_work, on_hold, awaiting_confirmation, rework, closed, canceled, rejected); " +
      "premises_id/building_id — ограничить помещением/домом. " +
      `Возвращает список карточек-ссылок. ${listContractNote}`,
    parameters: Type.Object({
      search: Type.Optional(Type.String({ description: "текст поиска" })),
      state: Type.Optional(Type.String({ description: "состояние обращения" })),
      premises_id: Type.Optional(uuid()),
      building_id: Type.Optional(uuid()),
      ...pageArgs,
    }),
    execute: async (args) => {
      try {
        const lang = await language();
        const page = pageBounds(args);
        const raw = await client.get<{ items?: Record<string, unknown>[] }>("/v1/requests", {
          search: args.search,
          state: args.state,
          premises_id: args.premises_id,
          building_id: args.building_id,
          cursor: btoa(String((page.page - 1) * page.size)),
          limit: String(page.size + 1),
        });
        const rows = raw.items ?? [];
        const hasMore = rows.length > page.size;
        const visible = rows.slice(0, page.size);
        const items = visible.map((row) => ({
          id: String(row.id),
          label: row.number ? `№${row.number} · ${cut(row.description)}` : cut(row.description),
          state: requestStateText(row.state, lang),
          href: requestHref(String(row.id)),
          created_at: textOrNull(row.created_at),
          author: textOrNull(row.author_name),
        }));
        return textOutput({ items, total: items.length, page: page.page, has_more: hasMore });
      } catch (error) {
        return failure(error, "list");
      }
    },
  });

  const getRequest = defineTool({
    name: "get_request",
    replay: "safe",
    description:
      "Возвращает карточку обращения по id: описание, место, автор, состояние, ссылку на карточку. " +
      "id бери из результатов search_requests.",
    parameters: Type.Object({ id: uuid() }),
    execute: async (args) => {
      try {
        const lang = await language();
        const card = await client.get<Record<string, unknown>>(`/v1/requests/${args.id}`);
        return textOutput({
            id: String(card.id),
            label: card.number ? `№${card.number} · ${cut(card.description)}` : cut(card.description),
            state: requestStateText(card.state, lang),
            href: requestHref(String(card.id)),
            description: cut(card.description, 800),
            place: textOrNull(card.place_label),
            author: textOrNull(card.author_name),
            created_at: textOrNull(card.created_at),
          });
      } catch (error) {
        return failure(error, "single");
      }
    },
  });

  const searchTasks = defineTool({
    name: "search_tasks",
    replay: "safe",
    description:
      "Ищет задания исполнителям. API ищет только по request_id, поэтому текстовый поиск и фильтр по состоянию " +
      "применяются к выдаче (до 100 последних заданий). state: created, awaiting_acceptance, accepted, in_progress, " +
      "suspended, on_review, rework, accepted_admin, canceled. " +
      `Возвращает список карточек-ссылок. ${listContractNote}`,
    parameters: Type.Object({
      search: Type.Optional(Type.String({ description: "текст по номеру, названию или инструкции" })),
      request_id: Type.Optional(uuid()),
      state: Type.Optional(Type.String({ description: "состояние задания" })),
      ...pageArgs,
    }),
    execute: async (args) => {
      try {
        const lang = await language();
        const raw = await client.get<{ items?: Record<string, unknown>[] }>("/v1/tasks", {
          request_id: args.request_id,
        });
        const needle = args.search?.trim().toLowerCase() ?? "";
        const rows = (raw.items ?? []).filter((row) => {
          if (args.state !== undefined && String(row.state) !== args.state) return false;
          if (needle === "") return true;
          return ["number", "title", "instruction"].some((key) =>
            String(row[key] ?? "").toLowerCase().includes(needle),
          );
        });
        const page = pageBounds(args);
        const view = pageOf(rows, page.page, page.size);
        const items = view.items.map((row) => {
          const linked = row.linked_request as { id?: unknown; number?: unknown } | null;
          return {
            id: String(row.id),
            label: `№${row.number} · ${cut(row.title ?? "Задание")}`,
            state: taskStateText(row.state, lang),
            href: taskHref(String(row.id)),
            assignee: textOrNull(row.assignee_name),
            created_at: textOrNull(row.created_at),
            request: row.linked_request
              ? { label: `№${linked?.number}`, href: requestHref(String(linked?.id)) }
              : undefined,
          };
        });
        return textOutput({ items, total: items.length, page: page.page, has_more: view.has_more });
      } catch (error) {
        return failure(error, "list");
      }
    },
  });

  const getTask = defineTool({
    name: "get_task",
    replay: "safe",
    description:
      "Возвращает карточку задания по id: название, инструкцию, исполнителя, связь с обращением и последний отчёт. " +
      "id бери из результатов search_tasks.",
    parameters: Type.Object({ id: uuid() }),
    execute: async (args) => {
      try {
        const lang = await language();
        const card = await client.get<Record<string, unknown>>(`/v1/tasks/${args.id}`);
        const reports = Array.isArray(card.reports)
          ? (card.reports as Record<string, unknown>[])
          : [];
        const last = reports.at(-1);
        const linked = card.linked_request as { id?: unknown; number?: unknown } | null | undefined;
        return textOutput({
            id: String(card.id),
            label: `№${card.number} · ${cut(card.title ?? "Задание")}`,
            state: taskStateText(card.state, lang),
            href: taskHref(String(card.id)),
            title: textOrNull(card.title),
            instruction: cut(card.instruction, 600),
            assignee: textOrNull(card.assignee_name),
            created_at: textOrNull(card.created_at),
            request: linked
              ? { label: `№${linked.number}`, href: requestHref(String(linked.id)) }
              : undefined,
            report: last
              ? {
                  performed_work: cut(last.performed_work, 400),
                  result: cut(last.result, 400),
                  performed_at: textOrNull(last.performed_at),
                }
              : undefined,
          });
      } catch (error) {
        return failure(error, "single");
      }
    },
  });

  const listIncidents = defineTool({
    name: "list_incidents",
    replay: "safe",
    description:
      "Перечисляет общие аварии ОСИ (отключения и повреждения общих систем). " +
      "state: signal_check, confirmed, not_confirmed, mitigation, recovery_check, completed. " +
      `Возвращает список карточек-ссылок. ${listContractNote}`,
    parameters: Type.Object({
      state: Type.Optional(Type.String({ description: "состояние аварии" })),
      ...pageArgs,
    }),
    execute: async (args) => {
      try {
        const lang = await language();
        const raw = await client.get<{ items?: Record<string, unknown>[] }>("/v1/incidents");
        const rows = (raw.items ?? []).filter(
          (row) => args.state === undefined || String(row.state) === args.state,
        );
        const page = pageBounds(args);
        const view = pageOf(rows, page.page, page.size);
        const items = view.items.map((row) => ({
          id: String(row.id),
          label: `№${row.number} · ${cut(row.title)}`,
          state: incidentStateText(row.state, lang),
          href: incidentHref(String(row.id)),
          summary: cut(row.public_text, 200),
        }));
        return textOutput({ items, total: items.length, page: page.page, has_more: view.has_more });
      } catch (error) {
        return failure(error, "list");
      }
    },
  });

  const getIncident = defineTool({
    name: "get_incident",
    replay: "safe",
    description:
      "Возвращает карточку аварии по id: публичный текст для жителей, прогноз и зоны. " +
      "id бери из результатов list_incidents.",
    parameters: Type.Object({ id: uuid() }),
    execute: async (args) => {
      try {
        const lang = await language();
        const card = await client.get<Record<string, unknown>>(`/v1/incidents/${args.id}`);
        const scope = Array.isArray(card.scope) ? (card.scope as unknown[]) : [];
        return textOutput({
            id: String(card.id),
            label: `№${card.number} · ${cut(card.title)}`,
            state: incidentStateText(card.state, lang),
            href: incidentHref(String(card.id)),
            title: textOrNull(card.title),
            summary: cut(card.public_text, 800),
            forecast: textOrNull(card.forecast),
            next_update_at: textOrNull(card.next_update_at),
            zones: scope.length,
          });
      } catch (error) {
        return failure(error, "single");
      }
    },
  });

  const searchResidents = defineTool({
    name: "search_residents",
    replay: "safe",
    description:
      "Ищет жителей реестра по подстроке имени или телефона (не короче 2 символов). " +
      `Возвращает список карточек-ссылок на карточку жителя. ${listContractNote}`,
    parameters: Type.Object({
      search: Type.String({ minLength: 2, description: "имя или телефон" }),
      ...pageArgs,
    }),
    execute: async (args) => {
      try {
        const lang = await language();
        const raw = await client.get<{ items?: Record<string, unknown>[] }>("/v1/registry/persons");
        const needle = args.search.trim().toLowerCase();
        const rows = (raw.items ?? []).filter((row) =>
          [row.full_name, row.phone_e164].some((value) =>
            String(value ?? "").toLowerCase().includes(needle),
          ),
        );
        const page = pageBounds(args);
        const view = pageOf(rows, page.page, page.size);
        const items = view.items.map((row) => {
          const linked = Array.isArray(row.linked_premises)
            ? (row.linked_premises as Record<string, unknown>[])[0]
            : undefined;
          return {
            id: String(row.id),
            label: String(row.full_name ?? ""),
            state: label(stateLabels, row.registration_state ?? row.status, lang),
            href: residentHref(String(row.id)),
            phone: textOrNull(row.phone_e164),
            premises: linked
              ? {
                  label: `${label(premiseLabels, linked.kind, lang, "Помещение")} ${linked.number ?? ""}`.trim(),
                  href: premisesHref(String(linked.id)),
                }
              : undefined,
          };
        });
        return textOutput({ items, total: items.length, page: page.page, has_more: view.has_more });
      } catch (error) {
        return failure(error, "list");
      }
    },
  });

  const listConnections = defineTool({
    name: "list_connections",
    replay: "safe",
    description:
      "Связи жителей с помещениями (кто в каком помещении собственник/проживает). " +
      "building_id — ограничить домом. Ссылка ведёт на помещение. " +
      `Возвращает список карточек-ссылок. ${listContractNote}`,
    parameters: Type.Object({
      building_id: Type.Optional(uuid()),
      ...pageArgs,
    }),
    execute: async (args) => {
      try {
        const lang = await language();
        const raw = await client.get<{ items?: Record<string, unknown>[] }>("/v1/registry/connections");
        const rows = (raw.items ?? []).filter(
          (row) => args.building_id === undefined || String(row.building_id) === args.building_id,
        );
        const page = pageBounds(args);
        const view = pageOf(rows, page.page, page.size);
        const items = view.items.map((row) => ({
          id: String(row.id),
          label: `${row.full_name ?? ""} · ${label(premiseLabels, row.kind, lang, "Помещение")} ${row.number ?? ""}`.trim(),
          state: label(stateLabels, row.status, lang),
          href: premisesHref(String(row.premises_id)),
          role: label(roleLabels, row.role, lang),
        }));
        return textOutput({ items, total: items.length, page: page.page, has_more: view.has_more });
      } catch (error) {
        return failure(error, "list");
      }
    },
  });

  const listStaff = defineTool({
    name: "list_staff",
    replay: "safe",
    description:
      "Список сотрудников ОСИ с ролями и открытой нагрузкой. " +
      `Возвращает список карточек. ${listContractNote}`,
    parameters: Type.Object(pageArgs),
    execute: async (args) => {
      try {
        const raw = await client.get<{ items?: Record<string, unknown>[] }>("/v1/staff");
        const page = pageBounds(args);
        const view = pageOf(raw.items ?? [], page.page, page.size);
        const items = view.items.map((row) => ({
          id: String(row.id),
          label: String(row.full_name ?? ""),
          state: Array.isArray(row.roles) ? (row.roles as string[]).join(", ") : "",
          href: STAFF_HREF,
          phone: textOrNull(row.phone_e164),
          open_tasks: num(row.open_tasks, 0),
        }));
        return textOutput({ items, total: items.length, page: page.page, has_more: view.has_more });
      } catch (error) {
        return failure(error, "list");
      }
    },
  });

  const getStaff = defineTool({
    name: "get_staff",
    replay: "safe",
    description:
      "Возвращает карточку сотрудника по id: роли, контакты, нагрузку (открытые задания/обращения/регламенты). " +
      "id бери из результатов list_staff.",
    parameters: Type.Object({ id: uuid() }),
    execute: async (args) => {
      try {
        const card = await client.get<Record<string, unknown>>(`/v1/staff/${args.id}`);
        return textOutput({
            id: String(card.id),
            label: String(card.full_name ?? ""),
            state: Array.isArray(card.roles) ? (card.roles as string[]).join(", ") : "",
            href: STAFF_HREF,
            roles: card.roles,
            phone: textOrNull(card.phone_e164),
            telegram: textOrNull(card.telegram_username),
            workload: card.workload,
          });
      } catch (error) {
        return failure(error, "single");
      }
    },
  });

  return [
    searchRequests,
    getRequest,
    searchTasks,
    getTask,
    listIncidents,
    getIncident,
    searchResidents,
    listConnections,
    listStaff,
    getStaff,
  ];
}

/** JSON-конверт как текстовый контент результата инструмента (канал output). */
export function textOutput(value: unknown): { output: [{ type: "text"; text: string }] } {
  return { output: [{ type: "text", text: JSON.stringify(value) }] };
}

function textOrNull(value: unknown): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}
