// Рендер-тест главной страницы кабинета: очередь дня + пределы сеанса AUTH-06.
// Идентичность замокана — проверяется
// разметка страницы, не провайдер.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

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

vi.mock("../lib/identity", () => ({
  useCabinetIdentity: () => ({
    identity: { id: "profile-1", fullName: "Председатель ОСИ", me: harness.current.value },
    isLoading: false,
    roles: ["chairman"],
    isError: false,
  }),
}));

// Очередь дня замокана: состав списков проверяется на странице очереди,
// здесь — структура главной и сеанс (AUTH-06).
vi.mock("../lib/day-queue", () => ({
  useDayQueue: () => ({
    requestsNew: [],
    requestsAction: [],
    requestsOverdue: 0,
    tasksAccept: [],
    tasksReview: [],
    incidentsAction: [],
    loading: false,
    error: null,
  }),
}));

describe("HomePage", () => {
  afterEach(cleanup);
  it("показывает пределы сеанса (AUTH-06)", () => {
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
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByText("12 ч")).toBeInTheDocument();
    expect(screen.getByText("30 мин")).toBeInTheDocument();
  });

  it("показывает очередь дня и сеанс без назначений", () => {
    harness.current.value = harness.makeMe([]);
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByText("Обращения: новые")).toBeInTheDocument();
    expect(screen.getByText("Задания: принятие и проверка")).toBeInTheDocument();
    expect(screen.getByText("Сеанс")).toBeInTheDocument();
  });
});
