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
afterEach(cleanup);
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
