// Рендер-тест главной страницы кабинета (Task 7): идентичность, роли,
// пределы сеанса AUTH-06. Хуки Refine и идентичность замоканы — проверяется
// разметка страницы, не провайдер.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HomePage } from "./home";

const harness = vi.hoisted(() => {
  const makeMe = (assignments: Array<Record<string, unknown>>) => ({
    profile: {
      id: "abcdefgh-0000-0000-0000-000000000000",
      person_id: "person-1",
      language: "ru" as const,
      is_test: false,
    },
    person: { id: "person-1", full_name: "Председатель ОСИ", status: "active", is_test: false },
    assignments,
    session: {
      id: "session-1",
      started_at: "2026-10-16T08:00:00Z",
      last_activity_at: "2026-10-16T09:00:00Z",
      total_limit_seconds: 43200,
      idle_limit_seconds: 1800,
    },
    emulation: null,
  });
  return { current: { value: makeMe([]) }, makeMe };
});

vi.mock("@refinedev/core", () => ({
  useLogout: () => ({ mutate: () => {} }),
}));

vi.mock("../lib/identity", () => ({
  useCabinetIdentity: () => ({
    identity: { id: "profile-1", fullName: "Председатель ОСИ", me: harness.current.value },
    isLoading: false,
    roles: [],
    isError: false,
  }),
}));

describe("HomePage", () => {
  it("показывает идентичность, роль «весь ОСИ» и пределы сеанса (AUTH-06)", () => {
    harness.current.value = harness.makeMe([
      {
        id: "assignment-1",
        role: "chairman",
        financial_rights: false,
        registry_export_rights: false,
        regulations_rights: false,
        scope_building_ids: null,
      },
    ]);
    render(<HomePage />);
    expect(screen.getByText("Председатель ОСИ")).toBeInTheDocument();
    expect(screen.getByText("Председатель")).toBeInTheDocument();
    expect(screen.getByText("Весь ОСИ")).toBeInTheDocument();
    expect(screen.getByText("12 ч")).toBeInTheDocument();
    expect(screen.getByText("30 мин")).toBeInTheDocument();
  });

  it("без назначений объясняет, что вход не выдаёт роль (AUTH-01)", () => {
    harness.current.value = harness.makeMe([]);
    render(<HomePage />);
    expect(screen.getByText(/Действующих назначений нет/)).toBeInTheDocument();
  });
});
