import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InvitesPage } from "./invites";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));

const invite = {
  id: "inv-1",
  created_at: "2026-10-23T10:00:00Z",
  expires_at: "2026-10-25T10:00:00Z",
  status: "active",
  role: "tenant",
  kind: "apartment",
  number: "5",
  building_code: "107/1",
  created_by_name: "Олег Краснов",
  created_by_telegram: "oleg_san_krasnov",
};
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    computed(element),
  );
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path === "/v1/registrations/invites" ? { items: [invite] } : { items: [] },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("приглашения: Telegram пригласившего в таблице, поиск по нему", async () => {
  render(<InvitesPage />);
  expect(await screen.findByText("Олег Краснов")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "@oleg_san_krasnov" });
  expect(link).toHaveAttribute("href", "https://t.me/oleg_san_krasnov");
  const search = screen.getByRole("searchbox", { name: "Поиск приглашений" });
  fireEvent.change(search, { target: { value: "@oleg_san" } });
  expect(screen.getByText("Олег Краснов")).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "нет такого" } });
  expect(screen.getByText("По выбранным условиям ничего не найдено")).toBeInTheDocument();
  expect(screen.queryByText("Олег Краснов")).toBeNull();
});

it("приглашение без Telegram-имени показывает прочерк", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) =>
    path === "/v1/registrations/invites"
      ? { items: [{ ...invite, created_by_telegram: null }] }
      : { items: [] },
  );
  render(<InvitesPage />);
  expect(await screen.findByText("Олег Краснов")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
});
