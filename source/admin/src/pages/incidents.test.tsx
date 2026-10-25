import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IncidentsPage } from "./incidents";
import { PublicationsPage } from "./publications";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock(
  "../lib/identity",
  () => ({ useCabinetIdentity: () => ({ roles: ["administrator"] }) }),
);
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    computed(element)
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("инцидент показывает незавершённое восстановление и историю", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path === "/v1/incidents"
      ? {
        items: [{
          id: "i",
          number: "АВ-1",
          title: "Вода",
          state: "recovery_check",
        }],
      }
      : path === "/v1/emergency-signals"
      ? { items: [] }
      : {
        id: "i",
        number: "АВ-1",
        title: "Вода",
        state: "recovery_check",
        forecast: "Уточняется",
        actions: ["complete"],
        scope: [{
          id: "s",
          zone: "Первый дом",
          service: "Вода",
          recovered_at: null,
        }],
        history: [{ at: "Сегодня", reason: "Второй стояк ещё проверяется" }],
      }
  );
  render(<IncidentsPage />);
  fireEvent.click(await screen.findByRole("button", {name:"Вода"}));
  expect(await screen.findByText(/восстановление не подтверждено/))
    .toBeInTheDocument();
  expect(screen.getByText(/Второй стояк ещё проверяется/)).toBeInTheDocument();
  const drawer = screen.getByRole("dialog");
  fireEvent.click(screen.getByText("Завершить"));
  expect(await screen.findByText("Проверенные зоны")).toBeInTheDocument();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(within(drawer).getByText(/Проверено: опасности нет/)).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole("button", { name: "Отмена" }));
  expect(within(drawer).getByText(/Второй стояк ещё проверяется/)).toBeInTheDocument();
  expect(vi.mocked(apiFetch).mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
}, 15000);
it("сбой списка виден пользователю; повтор не выполняет бизнес-действий", async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error("Нет связи"));
  render(<IncidentsPage />);
  expect(await screen.findByText("Нет связи")).toBeInTheDocument();
  expect(
    vi.mocked(apiFetch).mock.calls.every(([, options]) =>
      !options?.method || options.method === "GET"
    ),
  ).toBe(true);
});
it(
  "отключение с истекшим планом остаётся без подтверждения восстановления",
  async () => {
    const row = {
      id: "p",
      title: "Промывка",
      kind: "outage",
      state: "published",
      body: "Работы продолжаются",
      planned_end: "2020-01-01",
      restored_at: null,
    };
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      path === "/v1/publications" ? { items: [row] } : row
    );
    render(<PublicationsPage />);
    fireEvent.click(await screen.findByRole("button", {name:"Промывка"}));
    await waitFor(() =>
      expect(screen.getByText(/Фактическое восстановление: не подтверждено/))
        .toBeInTheDocument()
    );
    expect(screen.getByText("Подтвердить восстановление")).toBeInTheDocument();
  },
  15000,
);
it("доска инцидентов: состояния в колонках, карточка открывает инцидент", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path === "/v1/incidents"
      ? {
        items: [{
          id: "i",
          number: "АВ-1",
          title: "Вода",
          state: "recovery_check",
        }],
      }
      : path === "/v1/emergency-signals"
      ? { items: [] }
      : {
        id: "i",
        number: "АВ-1",
        title: "Вода",
        state: "recovery_check",
        forecast: "Уточняется",
        actions: [],
        scope: [{
          id: "s",
          zone: "Первый дом",
          service: "Вода",
          recovered_at: null,
        }],
        history: [],
      }
  );
  render(<IncidentsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Доска" }));
  expect(await screen.findByText("Проверка восстановления")).toBeInTheDocument();
  expect(screen.getByText("Вода")).toBeInTheDocument();
  fireEvent.click(screen.getByText("АВ-1"));
  expect(await screen.findByText(/восстановление не подтверждено/))
    .toBeInTheDocument();
}, 15000);

it("редактирование публикации использует ту же шторку и возвращает к карточке", async () => {
  const row = { id: "p", title: "Промывка", kind: "announcement", state: "draft", body: "Сообщение жителям", files: [] };
  vi.mocked(apiFetch).mockImplementation(async path =>
    path === "/v1/incidents/context" ? { persons: [] } :
    path === "/v1/publications" || path.startsWith("/v1/registry/") || path === "/v1/common-works"
      ? { items: path === "/v1/publications" ? [row] : [] } : row
  );
  render(<PublicationsPage />);
  fireEvent.click(await screen.findByRole("button", {name:"Промывка"}));
  await screen.findByText("Сообщение жителям");
  const drawer = screen.getByRole("dialog");
  fireEvent.click(within(drawer).getByRole("button", { name: "Редактировать" }));
  await screen.findByLabelText("Текст для жителей");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(within(drawer).getByLabelText("Текст для жителей")).toHaveValue("Сообщение жителям");
  fireEvent.click(within(drawer).getByRole("button", { name: "Отмена" }));
  expect(within(drawer).getByText("Сообщение жителям")).toBeInTheDocument();
  expect(vi.mocked(apiFetch).mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
}, 15000);


it("согласованный финансовый отчёт предлагает публикацию вместо повторного согласования", async () => {
 const card={id:"p",title:"Отчёт за месяц",body:"Доходы и расходы",kind:"financial_report",state:"draft",approved_by:"chairman",files:[],history:[],can_manage:true,can_approve:false,financial_versions:[]};
 vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/publications" ? {items:[card]} : card);
 render(<PublicationsPage/>);
 fireEvent.click(await screen.findByRole("button", {name:"Отчёт за месяц"}));
 const process=await screen.findByRole("region",{name:"Сейчас по процессу"});
 expect(within(process).getByRole("button",{name:"Опубликовать"})).toHaveClass("ant-btn-primary");
 expect(within(process).queryByRole("button",{name:"На согласование председателю"})).toBeNull();
 fireEvent.click(within(process).getByRole("button",{name:"Опубликовать"}));
 expect(await screen.findByText(/Материал станет доступен выбранной аудитории/)).toBeInTheDocument();
 expect(vi.mocked(apiFetch).mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
});
