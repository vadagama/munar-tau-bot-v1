import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TelegramHandle } from "./telegram-handle";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("имя аккаунта — ссылка на t.me в новом окне", () => {
  render(<TelegramHandle username="w84gr8" />);
  const link = screen.getByRole("link", { name: "@w84gr8" });
  expect(link).toHaveAttribute("href", "https://t.me/w84gr8");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noreferrer noopener");
});
it("без имени — прочерк, без ссылки", () => {
  for (const empty of [null, undefined, "", "   "]) {
    render(<TelegramHandle username={empty} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
    cleanup();
  }
});
