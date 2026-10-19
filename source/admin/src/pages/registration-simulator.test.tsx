import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { expect, it, vi, afterEach } from "vitest";
import { RegistrationSimulator } from "./registration-simulator";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue({ reply: "Выберите язык: ru / kk" }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("до включения эмуляции не отправляет шаг", () => {
  render(<RegistrationSimulator active={false} />);
  expect(screen.getByRole("button", { name: "Начать анкету" })).toBeDisabled();
});
it("активная персона исполняет общий сценарий registration и видит ответ", async () => {
  render(<RegistrationSimulator active />);
  fireEvent.click(screen.getByRole("button", { name: "Начать анкету" }));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith("/v1/emulation/simulate", {
      method: "POST",
      body: { scenario: "registration", input: "/register" },
    }),
  );
  expect(await screen.findByText("Выберите язык: ru / kk")).toBeInTheDocument();
});

it("показывает кнопки сценария и отправляет их data вместо подписи", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({
    reply: "Выберите язык",
    buttons: [[{ text: "Қазақша", data: "kk" }, { text: "Русский", data: "ru" }]],
  }).mockResolvedValueOnce({ reply: "Укажите имя" });
  render(<RegistrationSimulator active />);
  fireEvent.click(screen.getByRole("button", { name: "Начать анкету" }));
  fireEvent.click(await screen.findByRole("button", { name: "Қазақша" }));
  await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith("/v1/emulation/simulate", {
    method: "POST", body: { scenario: "registration", input: "kk" },
  }));
  expect(await screen.findByText("Укажите имя")).toBeInTheDocument();
});
it("кнопка главного меню выбирает сценарий, а продолжение сохраняет его", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ reply: "Меню", menu: [[{
    text: "Новое обращение", data: "/newrequest", scenario: "requests",
  }]] }).mockResolvedValueOnce({ reply: "Опишите проблему" }).mockResolvedValueOnce({ reply: "Принято" });
  render(<RegistrationSimulator active />);
  fireEvent.click(screen.getByRole("button", { name: "Начать анкету" }));
  fireEvent.click(await screen.findByRole("button", { name: "Новое обращение" }));
  expect(await screen.findByText("Опишите проблему")).toBeInTheDocument();
  expect(apiFetch).toHaveBeenLastCalledWith("/v1/emulation/simulate", {
    method: "POST", body: { scenario: "requests", input: "/newrequest" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Сообщение симулятору" }), { target: { value: "Не горит свет" } });
  fireEvent.click(screen.getByRole("button", { name: "Отправить шаг" }));
  await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith("/v1/emulation/simulate", {
    method: "POST", body: { scenario: "requests", input: "Не горит свет" },
  }));
});

it("показывает кнопки под ответом и продолжает сценарий, выбранный сервером по /register", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({
    scenario_id: "registration", reply: "Выберите язык",
    buttons: [[{ text: "Русский", data: "ru" }]],
  }).mockResolvedValueOnce({ scenario_id: "registration", reply: "Укажите имя" });
  render(<RegistrationSimulator active />);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Сценарий симулятора" }));
  fireEvent.click(screen.getByText("Обращения", { selector: ".ant-select-item-option-content" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Сообщение симулятору" }), { target: { value: "/register" } });
  fireEvent.click(screen.getByRole("button", { name: "Отправить шаг" }));
  const button = await screen.findByRole("button", { name: "Русский" });
  expect(screen.getByRole("log", { name: "Диалог симулятора" })).toContainElement(button);
  fireEvent.click(button);
  await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith("/v1/emulation/simulate", {
    method: "POST", body: { scenario: "registration", input: "ru" },
  }));
});
