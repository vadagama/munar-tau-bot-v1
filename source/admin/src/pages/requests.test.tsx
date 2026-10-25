import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RequestsPage } from "./requests";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock(
  "../lib/identity",
  () => ({
    useCabinetIdentity: () => ({
      identity: { me: { person: { id: "author" } } },
      roles: [],
    }),
  }),
);
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    computed(element)
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
// Find labels without computing styles for every AntD button. A short action
// keeps its disabled opener visible; submission must select the one enabled button.
async function findButton(name: string, enabled = false) {
  return waitFor(() => {
    const buttons = screen.getAllByText(name, { selector: "button > span" })
      .map(label => label.closest("button")!)
      .filter(button => !enabled || !button.disabled);
    expect(buttons).toHaveLength(1);
    return buttons[0]!;
  });
}
function setup(manager = false) {
  const row = {
    id: "r",
    number: "З-26-00001",
    state: "awaiting_confirmation",
    author_person_id: "author",
    kind: "question",
    description: "Вопрос жителя",
    source: "bot",
    can_manage: manager,
    confirmation_version: 2,
    version: 4,
    participants: [],
    attachments: [],
    log: [],
    confirmation: { payload: { summary: "Ответ жителю" } },
    messages: [
      {
        id: "m",
        channel: "resident",
        text: "Публичный ответ",
        created_at: "2026-10-17T00:00:00Z",
      },
      ...(manager
        ? [{
          id: "i",
          channel: "internal",
          text: "Внутреннее обсуждение",
          created_at: "2026-10-17T00:00:00Z",
        }]
        : []),
    ],
  };
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === "/v1/requests" || path === "/v1/requests/search") {
      return { items: [row] };
    }
    if (path === "/v1/requests/r") return row;
    if (path === "/v1/requests/context") return { premises: [], buildings: [] };
    return { items: [] };
  });
  return row;
}
it(
  "автор видит только канал Жителю и подтверждает конкретную версию",
  async () => {
    setup();
    render(<RequestsPage />);
    fireEvent.click(await findButton("З-26-00001"));
    expect(await screen.findByText("Публичный ответ")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Внутреннее" })).not
      .toBeInTheDocument();
    fireEvent.click(
      await findButton("Подтвердить результат", true),
    );
    expect(await screen.findByText(/Подтверждаете результат версии 2/))
      .toBeInTheDocument();
    fireEvent.click(
      await findButton("Подтвердить результат", true),
    );
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/v1/requests/r/transitions",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            action: "confirm_result",
            expected_version: 4,
            payload: expect.objectContaining({ confirmation_version: 2 }),
          }),
        }),
      )
    );
  },
  15000,
);
it("служебный канал явно помечен перед отправкой", async () => {
  setup(true);
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  fireEvent.click(await screen.findByRole("tab", { name: "Внутреннее" }));
  expect(screen.getByText("Внутреннее сообщение: житель его не увидит"))
    .toBeInTheDocument();
  expect(screen.getByText("Внутреннее обсуждение")).toBeInTheDocument();
  expect(await findButton("Отправить"))
    .toBeDisabled();
}, 15000);
it("черновик внутреннего сообщения не переносится в канал жителя", async () => {
  setup(true);
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  fireEvent.click(await screen.findByRole("tab", { name: "Внутреннее" }));
  fireEvent.change(screen.getByLabelText("Текст сообщения"), {
    target: { value: "Служебный черновик" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Жителю" }));
  expect(screen.getByLabelText("Текст сообщения")).toHaveValue("");
  fireEvent.click(screen.getByRole("tab", { name: "Внутреннее" }));
  expect(screen.getByLabelText("Текст сообщения")).toHaveValue(
    "Служебный черновик",
  );
}, 15000);
it("бывший автор сохраняет чтение истории без кнопок изменения", async () => {
  const row = setup();
  Object.assign(row, {
    can_share: false,
    can_act_as_author: false,
    can_comment: false,
  });
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  expect(await findButton("Закрыть карточку"))
    .toBeInTheDocument();
  expect(screen.queryByText("Подтвердить результат", { selector: "button > span" })).not
    .toBeInTheDocument();
  expect(screen.getByLabelText("Текст сообщения")).toBeDisabled();
}, 15000);
it("ошибка доступа не показывает старую карточку", async () => {
  setup();
  vi.mocked(apiFetch).mockRejectedValue(new Error("Объект не найден"));
  render(<RequestsPage />);
  expect(await screen.findByText("Объект не найден")).toBeInTheDocument();
  expect(screen.queryByText("Вопрос жителя")).not.toBeInTheDocument();
});
it("доска обращений: статусы в колонках, карточка открывает обращение", async () => {
  const row = setup();
  Object.assign(row, {
    created_at: "2026-10-17T08:00:00Z",
    open_at: "2026-10-18T07:30:00Z",
    first_response_due_at: "2026-10-19T07:30:00Z",
  });
  render(<RequestsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Доска" }));
  // Колонка по статусу строки и карточка с номером на доске.
  expect(await screen.findByText("Ожидает подтверждения")).toBeInTheDocument();
  expect(screen.getByText("Вопрос жителя")).toBeInTheDocument();
  expect(screen.getByText("18.10.2026, 12:30")).toBeInTheDocument();
  expect(screen.queryByText(/Первый ответ до/)).toBeNull();
  fireEvent.click(screen.getByText("З-26-00001"));
  expect(await screen.findByText("Публичный ответ")).toBeInTheDocument();
}, 15000);

it("подтверждение результата раскрывается в исходной карточке и отменяется без запроса", async () => {
  setup();
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  await screen.findByText("Публичный ответ");
  const drawer = screen.getByRole("dialog");
  const callsBeforeAction = vi.mocked(apiFetch).mock.calls.length;
  fireEvent.click(within(drawer).getByRole("button", { name: "Подтвердить результат" }));
  await screen.findByText(/Подтверждаете результат версии 2/);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(within(drawer).getByText("Публичный ответ")).toBeInTheDocument();
  expect(within(drawer).getByText(/Подтверждаете результат версии 2/)).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole("button", { name: "Отмена" }));
  expect(within(drawer).queryByText(/Подтверждаете результат версии 2/)).toBeNull();
  expect(within(drawer).getByText("Публичный ответ")).toBeInTheDocument();
  expect(vi.mocked(apiFetch).mock.calls.slice(callsBeforeAction).some(([,opts]) => opts?.method === "POST")).toBe(false);
}, 15000);


it("форма действия блокирует параллельную отправку сообщения и сохраняет его черновик", async () => {
  setup();
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  const text = await screen.findByLabelText("Текст сообщения");
  fireEvent.change(text, { target: { value: "Сохранить черновик сообщения" } });
  const send = await findButton("Отправить");
  expect(send).toBeEnabled();
  fireEvent.click(await findButton("Подтвердить результат"));
  expect(text).toBeDisabled();
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByText("Отмена", { selector: "button > span" }));
  expect(text).toBeEnabled();
  expect(text).toHaveValue("Сохранить черновик сообщения");
});

it("в списке видна дата регистрации, срок скрыт по умолчанию", async () => {
  const row = setup();
  Object.assign(row, {
    created_at: "2026-10-17T08:00:00Z",
    open_at: "2026-10-18T07:30:00Z",
    first_response_due_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
  render(<RequestsPage />);
  expect(await screen.findByRole("columnheader", { name: "Дата регистрации" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "18.10.2026, 12:30" })).toBeInTheDocument();
  // Срок скрыт по умолчанию (defaultHidden); включение панелью колонок — общее поведение ConfigurableTable.
  expect(screen.queryByRole("columnheader", { name: "Срок" })).not.toBeInTheDocument();
});

it("на телефоне в записи показывается дата регистрации без срока", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: query === "(max-width: 767px)", media: query,
    onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false }));
  const row = setup();
  Object.assign(row, {
    created_at: "2026-10-17T08:00:00Z",
    open_at: "2026-10-18T07:30:00Z",
    first_response_due_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
  render(<RequestsPage />);
  expect(await screen.findByText("Дата регистрации: 18.10.2026, 12:30")).toBeInTheDocument();
  expect(screen.queryByText(/Первый ответ до/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Срок/)).not.toBeInTheDocument();
}, 15000);

it("фильтр здания отправляет выбранное здание и сбрасывается на все здания", async () => {
  setup();
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === "/v1/requests/context") {
      return { premises: [], buildings: [{ id: "b1", name: "Дом 1" }] };
    }
    return { items: [] };
  });
  render(<RequestsPage />);
  const filter = screen.getByRole("combobox", { name: "Фильтр по зданию" });
  fireEvent.mouseDown(filter);
  fireEvent.click(await screen.findByText("Дом 1", { selector: ".ant-select-item-option-content" }));
  await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith(
    "/v1/requests/search",
    expect.objectContaining({ body: expect.objectContaining({ building_id: "b1" }) }),
  ));
  fireEvent.mouseDown(filter.closest(".ant-select")!.querySelector(".ant-select-clear")!);
  await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith(
    "/v1/requests/search",
    expect.objectContaining({ body: expect.objectContaining({ building_id: undefined }) }),
  ));
});

it("карточка группирует информацию и показывает просрочку сверху, журнал доставки снизу", async () => {
  const row = setup(true);
  Object.assign(row, {
    overdue_since: "2020-01-01T00:00:00Z",
    first_response_due_at: "2020-01-01T00:00:00Z",
    delivery_failures: [
      { id: "f1", last_error: "DELIVERY_FAILED" },
      { id: "f2", last_error: "DELIVERY_FAILED" },
    ],
  });
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  await screen.findByText("Публичный ответ");
  const dialog = screen.getByRole("dialog");
  const information = within(dialog).getByRole("region", { name: "Информация об обращении" });
  expect(within(dialog).queryByRole("region", { name: "Свойства обращения" })).toBeNull();
  expect(within(information).getByRole("button", { name: "Исправить место" })).toBeInTheDocument();
  expect(within(information).getByRole("combobox", { name: "Срочность обращения" })).toBeInTheDocument();
  expect(within(information).getByRole("combobox", { name: "Техническая категория" })).toBeInTheDocument();
  expect(within(information).getByRole("combobox", { name: "Вид обращения" })).toBeInTheDocument();
  const process = within(dialog).getByRole("region", { name: "Действия по процессу" });
  const conversation = within(dialog).getByRole("region", { name: "Переписка" });
  const history = within(dialog).getByRole("region", { name: "История состояний" });
  const warning = within(dialog).getByRole("alert", { name: "Просрочка обращения" });
  expect(warning).toHaveTextContent("Обращение просрочено");
  const delivery = within(dialog).getByRole("link", { name: "Открыть журнал доставки" });
  expect(delivery).toHaveAttribute("href", "/notifications/failures");
  const blocks = [warning, process, information, conversation, history, delivery];
  blocks.slice(1).forEach((block, index) => {
    expect(blocks[index]!.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  expect(within(dialog).queryByText("Доставка не удалась")).toBeNull();
  expect(within(conversation).getByRole("tab", { name: "Внутреннее" })).toBeInTheDocument();
});

it("показывает инициатора, подпись сообщения и авторов обоих каналов курсивом", async () => {
  const row = setup(true);
  Object.assign(row, { author_name: "Петров Пётр Петрович" });
  Object.assign(row.messages[0]!, { author_name: "Иванов Иван Андреевич" });
  Object.assign(row.messages[1]!, { author_name: "Сидоров Сергей Сергеевич" });
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  await screen.findByText("Публичный ответ");
  const dialog = screen.getByRole("dialog");
  const info = within(dialog).getByRole("region", { name: "Информация об обращении" });
  expect(within(info).getByText("Инициатор")).toBeInTheDocument();
  expect(within(info).getByText("Петров Пётр Петрович")).toBeInTheDocument();
  expect(within(info).getByText("Сообщение:")).toBeInTheDocument();
  expect(within(dialog).getByText("Иванов Иван Андреевич").closest("em")).not.toBeNull();
  const send = within(dialog).getByRole("button", { name: "Отправить" });
  const attach = within(dialog).getByRole("button", { name: "Добавить файл" });
  expect(send.compareDocumentPosition(attach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("tab", { name: "Внутреннее" }));
  expect(within(dialog).getByText("Сидоров Сергей Сергеевич").closest("em")).not.toBeNull();
});

it("прошлая задержка ответа не показывает предупреждение о текущей просрочке", async () => {
  const row = setup(true);
  Object.assign(row, {
    overdue_since: "2020-01-01T00:00:00Z",
    first_response_due_at: "2020-01-01T00:00:00Z",
    first_response_at: "2020-01-01T00:26:00Z",
  });
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  await screen.findByText("Публичный ответ");
  expect(within(screen.getByRole("dialog")).queryByRole("alert", { name: "Просрочка обращения" })).toBeNull();
});

it("запрос уточнения требует только вопрос и сохраняет его как пояснение перехода", async () => {
  const row = setup(true);
  row.state = "reviewing";
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  fireEvent.click(await findButton("Запросить уточнение", true));
  expect(screen.queryByLabelText("Причина / пояснение")).not.toBeInTheDocument();
  const question = await screen.findByLabelText("Конкретный вопрос");
  fireEvent.change(question, { target: { value: "Уточните номер подъезда" } });
  fireEvent.click(await findButton("Запросить уточнение", true));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    "/v1/requests/r/transitions",
    expect.objectContaining({ body: expect.objectContaining({
      action: "ask_clarification",
      reason: "Уточните номер подъезда",
      payload: expect.objectContaining({ question: "Уточните номер подъезда" }),
    }) }),
  ));
});

it("исправление места показывает дом перед помещением", async () => {
  setup(true);
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  fireEvent.click(await findButton("Исправить место", true));
  const building = await screen.findByLabelText("Дом");
  const premises = screen.getByLabelText("Помещение");
  expect(building.compareDocumentPosition(premises) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByLabelText("Причина исправления")).toBeInTheDocument();
});


it.each([
  ["Итоговый ответ", "submit_result", "Итоговый ответ жителю", "summary"],
])("%s не требует отдельного пояснения", async (label, action, field, key) => {
  const row = setup(true);
  row.state = "reviewing";
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  fireEvent.click(await findButton(label, true));
  expect(screen.queryByLabelText("Причина / пояснение")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(field), { target: { value: "Содержательное описание" } });
  fireEvent.click(await findButton(label, true));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    "/v1/requests/r/transitions", expect.objectContaining({ body: expect.objectContaining({
      action, payload: expect.objectContaining({ [key]: "Содержательное описание" }),
    }) }),
  ));
});

it("итоговый ответ доступен и для заявки с работами в состоянии В работе", async () => {
  const row = setup(true);
  Object.assign(row, { kind: "request", work_execution_required: true });
  row.state = "in_work";
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  fireEvent.click(await findButton("Итоговый ответ", true));
  fireEvent.change(screen.getByLabelText("Итоговый ответ жителю"), {
    target: { value: "Работы выполнены" },
  });
  fireEvent.click(await findButton("Итоговый ответ", true));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    "/v1/requests/r/transitions", expect.objectContaining({ body: expect.objectContaining({
      action: "submit_result",
      payload: expect.objectContaining({
        confirmation_payload: expect.objectContaining({ summary: "Работы выполнены" }),
      }),
    }) }),
  ));
});

it("Отклонить сохраняет причину и маршрут без отдельного поля остановки работ", async () => {
  const row = setup(true);
  row.state = "reviewing";
  Object.assign(row, { work_started_at: "2026-10-17T00:00:00Z" });
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  fireEvent.click(await findButton("Отклонить", true));
  expect(screen.queryByLabelText("Остановка работ и обязательства")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Причина отклонения и урегулирование обязательств"), {
    target: { value: "Работы остановлены, обязательства урегулированы" },
  });
  fireEvent.change(screen.getByLabelText("Дальнейший маршрут"), { target: { value: "Обратиться к поставщику" } });
  fireEvent.click(await findButton("Отклонить", true));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    "/v1/requests/r/transitions", expect.objectContaining({ body: expect.objectContaining({
      action: "reject", payload: expect.objectContaining({
        stop_resolution: "Работы остановлены, обязательства урегулированы", route: "Обратиться к поставщику",
      }),
    }) }),
  ));
});


it("начало работы выбирает исполнителя и отправляет одну составную операцию с ключом повтора", async () => {
  const row = setup(true); row.state = "reviewing";
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === "/v1/requests/r/task-assignees") return { items: [{ id: "worker", full_name: "Исполнитель дома" }] };
    return original(path, options);
  });
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  fireEvent.click(await findButton("Начать работу", true));
  expect(screen.queryByLabelText("Причина / пояснение")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Описание работы")).toHaveValue("Подготовить ответ по обращению З-26-00001");
  fireEvent.click(await findButton("Начать работу", true));
  expect(apiFetch).not.toHaveBeenCalledWith("/v1/requests/r/start-work", expect.anything());
  fireEvent.mouseDown(screen.getByLabelText("Исполнитель"));
  fireEvent.click(await screen.findByText("Исполнитель дома", { selector: ".ant-select-item-option-content" }));
  fireEvent.change(screen.getByLabelText("Срок выполнения"), { target: { value: "2099-01-01T15:00" } });
  fireEvent.change(screen.getByLabelText("Описание работы"), { target: { value: "Проверить водоснабжение" } });
  fireEvent.click(await findButton("Начать работу", true));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/requests/r/start-work", expect.objectContaining({
    method: "POST", idempotencyKey: expect.any(String), body: {
      expected_version: 4, plan: "Проверить водоснабжение", assignee_person_id: "worker",
      due_at: new Date("2099-01-01T15:00").toISOString(),
    },
  })));
  expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/v1/requests/r/transitions")).toHaveLength(0);
});

it("связанные задания показывают ссылку, исполнителя и состояние", async () => {
  const row = setup(true);
  Object.assign(row, { tasks: [{ id: "task-id", number: "ЗД-42", assignee_name: "Исполнитель дома", state: "awaiting_acceptance", due_at: "2099-01-01T10:00:00Z" }] });
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  expect(await screen.findByRole("link", { name: "ЗД-42" })).toHaveAttribute("href", "/tasks?task=task-id");
  expect(screen.getByText(/Исполнитель дома · Ожидает принятия/)).toBeInTheDocument();
});


it("выбор колонок обращений скрывает описание и сохраняется отдельно от заданий", async () => {
  setup();
  localStorage.setItem("columns.tasks", JSON.stringify(["assignee_name"]));
  render(<RequestsPage />);
  await findButton("З-26-00001");
  fireEvent.click(screen.getByRole("button", { name: "Колонки" }));
  const settings = await screen.findByRole("group", { name: "Видимые колонки" });
  fireEvent.click(within(settings).getByRole("checkbox", { name: "Описание" }));
  expect(screen.queryByRole("columnheader", { name: "Описание" })).not.toBeInTheDocument();
  // Срок скрыт по умолчанию и попадает в сохранение как явно скрытая колонка.
  expect(JSON.parse(localStorage.getItem("columns.requests")!)).toEqual({ v: 2, hidden: ["first_response_due_at", "description"] });
  // Задания не настраивались — старое сохранение не переписывается без изменений.
  expect(JSON.parse(localStorage.getItem("columns.tasks")!)).toEqual(["assignee_name"]);
});


it("поиск, состояние и период применяются автоматически без кнопки Применить", async () => {
  setup();
  render(<RequestsPage />);
  await findButton("З-26-00001");
  expect(screen.queryByRole("button", { name: "Применить" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Поиск обращений"), { target: { value: "кран" } });
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/requests/search",
    expect.objectContaining({ body: expect.objectContaining({ search: "кран", cursor: undefined }) })));
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Статус обращения" }));
  fireEvent.click(await screen.findByText("В работе", { selector: ".ant-select-item-option-content" }));
  fireEvent.change(screen.getByLabelText("Период с"), { target: { value: "2026-10-20" } });
  fireEvent.change(screen.getByLabelText("Период по"), { target: { value: "2026-10-22" } });
  await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith("/v1/requests/search",
    expect.objectContaining({ body: expect.objectContaining({ search: "кран", state: "in_work",
      from: "2026-10-20T00:00:00+05:00", to: "2026-10-22T23:59:59.999+05:00" }) })));
});

it("запоздавший ответ предыдущего фильтра не заменяет новые обращения", async () => {
  setup();
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  let resolveOld!: (value: unknown) => void;
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === "/v1/requests/search" && (options?.body as { state?: string } | undefined)?.state === "in_work") {
      return new Promise(resolve => { resolveOld = resolve; });
    }
    return original(path, options);
  });
  render(<RequestsPage />);
  await findButton("З-26-00001");
  const stateFilter = screen.getByRole("combobox", { name: "Статус обращения" });
  fireEvent.mouseDown(stateFilter);
  fireEvent.click(await screen.findByText("В работе", { selector: ".ant-select-item-option-content" }));
  await waitFor(() => expect(resolveOld).toBeDefined());
  fireEvent.mouseDown(stateFilter.closest(".ant-select")!.querySelector(".ant-select-clear")!);
  await findButton("З-26-00001");
  await act(async () => { resolveOld({ items: [] }); });
  await waitFor(() => expect(screen.getByText("З-26-00001", { selector: "button > span" })).toBeInTheDocument());
});

it("показывает инициатора, сортирует по имени и отправляет поиск на сервер", async () => {
  setup();
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  vi.mocked(apiFetch).mockImplementation(async (path, options) => path === "/v1/requests/search"
    ? { items: [
      { id: "r-z", number: "З-26-00002", description: "Второе", kind: "question", state: "new", author_name: "Яков Петров" },
      { id: "r-a", number: "З-26-00001", description: "Первое", kind: "question", state: "new", author_name: "Анна Соколова" },
      { id: "r-n", number: "З-26-00003", description: "Третье", kind: "question", state: "new", author_name: null },
    ] } : original(path, options));
  render(<RequestsPage />);
  await screen.findByText("Яков Петров");
  const header = screen.getByRole("columnheader", { name: /Инициатор/ });
  const names = () => screen.getAllByRole("row").slice(1).map(row => row.textContent);
  fireEvent.click(header);
  expect(names()[0]).toContain("Анна Соколова");
  expect(names()[2]).toContain("Не указан");
  fireEvent.click(header);
  expect(names()[0]).toContain("Яков Петров");
  expect(names()[2]).toContain("Не указан");
  fireEvent.change(screen.getByLabelText("Поиск обращений"), { target: { value: "Соколова" } });
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/requests/search",
    expect.objectContaining({ body: expect.objectContaining({ search: "Соколова", cursor: undefined }) })));
});

it("принятие на рассмотрение выполняется одним нажатием без панели подтверждения", async () => {
  const row = setup(true);
  row.state = "new";
  row.author_person_id = "resident";
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  let finish!: () => void;
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === "/v1/requests/r/transitions") {
      await new Promise<void>(resolve => { finish = resolve; });
      row.state = "reviewing";
      row.version++;
      return row;
    }
    return original(path, options);
  });
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  const button = await findButton("Принять на рассмотрение");
  fireEvent.click(button);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/requests/r/transitions", expect.objectContaining({
    method: "POST", body: expect.objectContaining({ action: "start_review", expected_version: 4 }),
  })));
  expect(screen.queryByRole("region", { name: "Принять на рассмотрение" })).not.toBeInTheDocument();
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith("/transitions"))).toHaveLength(1);
  await act(async () => { finish(); });
  await waitFor(() => expect(button).not.toBeInTheDocument());
  expect(screen.getAllByText("На рассмотрении").length).toBeGreaterThan(0);
});

it("ошибка прямого принятия остаётся в карточке и позволяет повторить действие", async () => {
  const row = setup(true);
  row.state = "new";
  row.author_person_id = "resident";
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === "/v1/requests/r/transitions") throw new Error("Не удалось принять обращение");
    return original(path, options);
  });
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  fireEvent.click(await findButton("Принять на рассмотрение"));
  expect(await screen.findByText("Не удалось принять обращение")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Принять на рассмотрение" })).not.toBeInTheDocument();
  expect(await findButton("Принять на рассмотрение")).toBeEnabled();
});

it.each(["request", "question"])("на рассмотрении %s: пять действий видны сразу в согласованном порядке", async kind => {
  const row = setup(true);
  row.state = "reviewing";
  row.kind = kind;
  row.author_person_id = "resident";
  render(<RequestsPage />);
  fireEvent.click(await findButton("З-26-00001"));
  await findButton("Начать работу");
  const actions = within(screen.getByRole("region", { name: "Действия по процессу" }));
  const buttons = actions.getAllByRole("button");
  expect(buttons.map(button => button.textContent)).toEqual([
    "Начать работу", "Итоговый ответ", "Запросить уточнение", "Отложить", "Отклонить",
  ]);
  expect(buttons[0]).toHaveClass("ant-btn-primary");
  expect(buttons.slice(1).every(button => !button.classList.contains("ant-btn-primary"))).toBe(true);
  expect(actions.queryByRole("button", { name: "Другие действия" })).not.toBeInTheDocument();
});
