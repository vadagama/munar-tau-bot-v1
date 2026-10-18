import {
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
  expect(await findButton("Отправить в «Внутреннее»"))
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
  setup();
  render(<RequestsPage />);
  fireEvent.click(await screen.findByRole("radio", { name: "Доска" }));
  // Колонка по статусу строки и карточка с номером на доске.
  expect(await screen.findByText("Ожидает подтверждения")).toBeInTheDocument();
  expect(screen.getByText("Вопрос жителя")).toBeInTheDocument();
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
  const send = screen.getByRole("button", { name: "Отправить в «Жителю»" });
  expect(send).toBeEnabled();
  fireEvent.click(await findButton("Подтвердить результат"));
  expect(text).toBeDisabled();
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(text).toBeEnabled();
  expect(text).toHaveValue("Сохранить черновик сообщения");
});
