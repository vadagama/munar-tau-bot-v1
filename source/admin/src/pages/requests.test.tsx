import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    computed(element)
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
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
    fireEvent.click(await screen.findByRole("button", { name: "З-26-00001" }));
    expect(await screen.findByText("Публичный ответ")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Внутреннее" })).not
      .toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить результат" }),
    );
    expect(await screen.findByText(/Подтверждаете результат версии 2/))
      .toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить действие" }),
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
  fireEvent.click(await screen.findByRole("button", { name: "З-26-00001" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Внутреннее" }));
  expect(screen.getByText("Внутреннее сообщение: житель его не увидит"))
    .toBeInTheDocument();
  expect(screen.getByText("Внутреннее обсуждение")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Отправить в «Внутреннее»" }))
    .toBeDisabled();
}, 15000);
it("черновик внутреннего сообщения не переносится в канал жителя", async () => {
  setup(true);
  render(<RequestsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "З-26-00001" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "З-26-00001" }));
  expect(await screen.findByRole("button", { name: "Закрыть карточку" }))
    .toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Подтвердить результат" })).not
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
