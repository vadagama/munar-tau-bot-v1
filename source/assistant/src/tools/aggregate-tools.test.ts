// Тесты инструментов агрегатов (S4a.2): табличный контракт {table, note},
// числа только из API, пустой период — «нет данных», дружелюбные отказы,
// период/дом/исполнитель уходят в query /v1/reports/*, язык ru/kk.

import { describe, expect, it } from "vitest";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { AGGREGATE_TOOL_NAMES, createAggregateTools, type AggregateResult } from "./aggregate-tools.ts";
import { EntityApiClient } from "./api-client.ts";
import type { EntityTool } from "./entity-tools.ts";

const WORKLOAD_PATH = "/v1/reports/workload-by-assignee";
const CREATED_CLOSED_PATH = "/v1/reports/created-closed-by-day";
const OVERDUE_PATH = "/v1/reports/overdue-by-building";

interface Route {
  path: string;
  body: unknown;
  status?: number;
  fail?: boolean;
}

function makeApi(routes: Route[], language: "ru" | "kk" = "ru") {
  const calls: Array<{ path: string; params: URLSearchParams }> = [];
  const client = new EntityApiClient({
    getAccessToken: () => "jwt-user",
    fetchApi: async (rawPath) => {
      const [path, query = ""] = rawPath.split("?");
      const params = new URLSearchParams(query);
      if (path === "/v1/meta/me") return new Response(JSON.stringify({ profile: { language } }), { status: 200 });
      calls.push({ path: path ?? "", params });
      const route = routes.find((r) => r.path === path);
      if (route?.fail) throw new Error("network down");
      if (!route) return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
      return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
    },
  });
  const tools = createAggregateTools(client);
  const byName = (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`нет инструмента ${name}`);
    return tool;
  };
  return { client, calls, tools, byName };
}

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

const workloadResponse = {
  kind: "workload_by_assignee",
  as_of: "2026-10-26T10:00:00Z",
  period: null,
  rows: [
    { person_id: "w1", name: "Петров Пётр", open: 3, overdue: 1, on_review: 1, rework: 0 },
    { person_id: null, name: null, open: 2, overdue: 0, on_review: 0, rework: 2 },
  ],
  total: 5,
  truncated: false,
  is_test: false,
};

const createdClosedResponse = {
  kind: "created_closed_by_day",
  as_of: "2026-10-26T10:00:00Z",
  period: { from: "2026-10-24T00:00:00Z", to: "2026-10-26T00:00:00Z", timezone: "Asia/Almaty" },
  buckets: [
    { day: "2026-10-24", from: "2026-10-24T00:00:00Z", to: "2026-10-25T00:00:00Z", created: 3, closed: 1 },
    { day: "2026-10-25", from: "2026-10-25T00:00:00Z", to: "2026-10-26T00:00:00Z", created: 2, closed: 0 },
  ],
  totals: { created: 5, closed: 1 },
  is_test: false,
};

const overdueResponse = {
  kind: "overdue_by_building",
  as_of: "2026-10-26T10:00:00Z",
  period: null,
  rows: [
    { building_id: "b1", label: "Дом 1", overdue: 2, open: 5 },
    { building_id: null, label: null, overdue: 0, open: 1 },
  ],
  total: 2,
  truncated: false,
  is_test: false,
};

describe("инструменты агрегатов — контракт таблицы", () => {
  it("имена инструментов совпадают с read-only списком", () => {
    expect(AGGREGATE_TOOL_NAMES).toEqual(["workload_by_assignee", "created_closed_by_day", "overdue_by_building"]);
  });

  it("нагрузка: числа из API в таблице, пусто — «нет данных»", async () => {
    const api = makeApi([{ path: WORKLOAD_PATH, body: workloadResponse }]);
    const result = (await run(api.byName("workload_by_assignee"), {})) as unknown as AggregateResult;
    expect(result.table.id).toBe("workload_by_assignee");
    expect(result.table.columns.map((c) => `${c.title}:${c.kind}`)).toEqual([
      "Исполнитель:text",
      "Открытые:number",
      "Просрочено:number",
      "На проверке:number",
      "На доработке:number",
    ]);
    expect(result.table.rows).toEqual([
      { name: "Петров Пётр", open: 3, overdue: 1, on_review: 1, rework: 0 },
      { name: "Без исполнителя", open: 2, overdue: 0, on_review: 0, rework: 2 },
    ]);
    expect(result.note).toContain("Всего открытых заданий: 5");
    expect(result.note).not.toContain("первые 50");
  });

  it("создано/закрыто: бакеты по дням с totals в примечании", async () => {
    const api = makeApi([{ path: CREATED_CLOSED_PATH, body: createdClosedResponse }]);
    const result = (await run(api.byName("created_closed_by_day"), {})) as unknown as AggregateResult;
    expect(result.table.columns.map((c) => c.title)).toEqual(["День", "Создано", "Закрыто"]);
    expect(result.table.rows).toEqual([
      { day: "2026-10-24", created: 3, closed: 1 },
      { day: "2026-10-25", created: 2, closed: 0 },
    ]);
    expect(result.note).toContain("Создано: 5, закрыто: 1");
  });

  it("просрочка по домам: безадресные обращения отдельной строкой", async () => {
    const api = makeApi([{ path: OVERDUE_PATH, body: overdueResponse }]);
    const result = (await run(api.byName("overdue_by_building"), {})) as unknown as AggregateResult;
    expect(result.table.columns.map((c) => c.title)).toEqual(["Дом", "Просрочено", "Открытые"]);
    expect(result.table.rows).toEqual([
      { building: "Дом 1", overdue: 2, open: 5 },
      { building: "Без адреса", overdue: 0, open: 1 },
    ]);
    expect(result.note).toContain("Просроченных обращений: 2");
  });
});

describe("инструменты агрегатов — параметры и язык", () => {
  it("период, дом и исполнитель уходят в query нагрузки", async () => {
    const api = makeApi([{ path: WORKLOAD_PATH, body: workloadResponse }]);
    await run(api.byName("workload_by_assignee"), {
      from: "2026-10-24", to: "2026-10-26", building_id: "b1", assignee_id: "w1",
    });
    const params = api.calls[0]!.params;
    expect(params.get("from")).toBe("2026-10-24");
    expect(params.get("to")).toBe("2026-10-26");
    expect(params.get("building_ids")).toBe("b1");
    expect(params.get("assignee_id")).toBe("w1");
  });

  it("динамика и просрочка не передают assignee_id — его нет в схеме", async () => {
    const api = makeApi([
      { path: CREATED_CLOSED_PATH, body: createdClosedResponse },
      { path: OVERDUE_PATH, body: overdueResponse },
    ]);
    await run(api.byName("created_closed_by_day"), { from: "2026-10-24", to: "2026-10-25" });
    await run(api.byName("overdue_by_building"), { building_id: "b2" });
    expect(api.calls[0]!.params.get("assignee_id")).toBeNull();
    expect(api.calls[1]!.params.get("assignee_id")).toBeNull();
    expect(api.calls[1]!.params.get("building_ids")).toBe("b2");
  });

  it("без периода query не содержит дат", async () => {
    const api = makeApi([{ path: WORKLOAD_PATH, body: workloadResponse }]);
    await run(api.byName("workload_by_assignee"), {});
    expect([...api.calls[0]!.params.keys()]).toEqual([]);
  });

  it("казахские заголовки по языку профиля", async () => {
    const api = makeApi([{ path: WORKLOAD_PATH, body: workloadResponse }], "kk");
    const result = (await run(api.byName("workload_by_assignee"), {})) as unknown as AggregateResult;
    expect(result.table.columns.map((c) => c.title)).toEqual([
      "Орындаушы", "Ашық", "Мерзімі өткен", "Тексеруде", "Түзетуде",
    ]);
    expect(result.table.rows[0]?.name).toBe("Петров Пётр");
  });

  it("kk-эталон: заголовок, пустое примечание и отказ — на казахском (S6.2)", async () => {
    const api = makeApi([{ path: WORKLOAD_PATH, body: { rows: [], total: 0 } }], "kk");
    const result = (await run(api.byName("workload_by_assignee"), {})) as unknown as AggregateResult;
    expect(result.table.title).toBe("Орындаушылар бойынша жүктеме");
    expect(result.note).toBe("Деректер жоқ: қолжетімді аумақта ашық тапсырма жоқ.");
  });

  it("kk-эталон: отказ инструмента — на казахском (S6.2)", async () => {
    const api = makeApi([{ path: WORKLOAD_PATH, body: {}, status: 403 }], "kk");
    const out = await run(api.byName("workload_by_assignee"), {});
    expect(out).toEqual({ error: "Бұл деректерге рұқсат жоқ" });
  });

  it("усечённый ответ честно помечен в примечании", async () => {
    const api = makeApi([{
      path: OVERDUE_PATH,
      body: { ...overdueResponse, truncated: true, total: 150 },
    }]);
    const result = (await run(api.byName("overdue_by_building"), {})) as unknown as AggregateResult;
    expect(result.note).toContain("первые 100 домов");
    expect(result.note).toContain("150");
  });
});

describe("инструменты агрегатов — пусто и отказы", () => {
  it("пустые строки — таблица без строк и примечание «нет данных»", async () => {
    const api = makeApi([
      { path: WORKLOAD_PATH, body: { ...workloadResponse, rows: [], total: 0 } },
      { path: CREATED_CLOSED_PATH, body: { ...createdClosedResponse, buckets: [] } },
      { path: OVERDUE_PATH, body: { ...overdueResponse, rows: [], total: 0 } },
    ]);
    for (const name of AGGREGATE_TOOL_NAMES) {
      const result = (await run(api.byName(name), {})) as unknown as AggregateResult;
      expect(result.table.rows).toEqual([]);
      expect(result.note.toLowerCase()).toContain("нет данных");
    }
  });

  it("403 — «нет доступа», сетевой сбой — «сервис недоступен»; без стека", async () => {
    const api = makeApi([
      { path: WORKLOAD_PATH, body: { error: { code: "FORBIDDEN" } }, status: 403 },
      { path: CREATED_CLOSED_PATH, body: {}, fail: true },
    ]);
    const denied = await run(api.byName("workload_by_assignee"), {});
    expect(denied.error).toBe("Нет доступа к этим данным");
    expect(denied.table).toBeUndefined();
    const down = await run(api.byName("created_closed_by_day"), {});
    expect(down.error).toBe("Сервис данных недоступен");
  });

  it("все инструменты replay: safe (только чтение)", () => {
    const api = makeApi([]);
    for (const tool of api.tools) expect(tool.replay).toBe("safe");
  });
});
