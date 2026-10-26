import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { DashboardChart, DashboardIncidentsChart, DashboardQualityChart, DashboardRegistrationsChart, DashboardTasksChart, DashboardTasksWorkload } from "./home-charts";
import { analyticsLink, useDashboardResource } from "../lib/dashboard";
const harness = vi.hoisted(() => ({ data: undefined as unknown, error: undefined as string | undefined }));
vi.mock("../lib/dashboard", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/dashboard")>(),
  useDashboardResource: vi.fn(() => ({ data: harness.data, error: harness.error, loading: false, reload: () => {} })),
}));
const mockResource = vi.mocked(useDashboardResource);
afterEach(() => { cleanup(); harness.data = undefined; harness.error = undefined; });
const period = { period: "month", from: "2026-10-01T00:00:00+05:00", to: "2026-11-01T00:00:00+05:00" };
const bucket = { label: "26.10", from: "2026-10-26T00:00:00+05:00", to: "2026-10-27T00:00:00+05:00" };
function renderChart(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}
it("график обращений без данных показывает стандартное пустое состояние", () => {
  harness.data = { ...period, buckets: [{ ...bucket, created: 0, closed: 0 }], kinds: [] };
  renderChart(<DashboardChart kind="flow" />);
  expect(screen.getByText("За период нет обращений")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "26.10: создано 0" })).toBeInTheDocument();
});
it("виды обращений без данных также показывают пустое состояние", () => {
  harness.data = { ...period, buckets: [{ ...bucket, created: 0, closed: 0 }], kinds: [{ kind: "request", count: 0 }] };
  renderChart(<DashboardChart kind="kinds" />);
  expect(screen.getByText("За период нет обращений")).toBeInTheDocument();
});
it("график заданий без данных показывает «За период нет заданий»", () => {
  harness.data = { ...period, buckets: [{ ...bucket, created: 0, accepted: 0 }], states: [] };
  renderChart(<DashboardTasksChart kind="task-flow" />);
  expect(screen.getByText("За период нет заданий")).toBeInTheDocument();
});
it("столбцы заданий ведут к списку заданий за день и к принятым", () => {
  harness.data = { ...period, buckets: [{ ...bucket, created: 3, accepted: 1 }], states: [] };
  renderChart(<DashboardTasksChart kind="task-flow" />);
  expect(screen.getByRole("link", { name: "26.10: создано 3" })).toHaveAttribute("href", "/tasks?from=2026-10-26&to=2026-10-26");
  expect(screen.getByRole("link", { name: "26.10: принято 1" })).toHaveAttribute("href", "/tasks?state=accepted_admin");
});
it("состояния заданий подписаны по-русски и ведут к отфильтрованному списку", () => {
  harness.data = { ...period, buckets: [{ ...bucket, created: 2, accepted: 0 }], states: [{ state: "on_review", count: 2 }, { state: "created", count: 0 }] };
  renderChart(<DashboardTasksChart kind="task-states" />);
  expect(screen.getByRole("link", { name: /На проверке/ })).toHaveAttribute("href", "/tasks?state=on_review");
  expect(screen.getByRole("link", { name: /Создано/ })).toHaveAttribute("href", "/tasks?state=created");
});
it("переключение периода перезапрашивает аналитику заданий", () => {
  harness.data = { ...period, buckets: [{ ...bucket, created: 1, accepted: 0 }], states: [] };
  renderChart(<DashboardTasksChart kind="task-flow" />);
  fireEvent.click(screen.getByRole("radio", { name: "Год" }));
  expect(mockResource.mock.calls.at(-1)![0]).toBe("/v1/dashboard/tasks-analytics?period=year");
});
const qualityBucket = { ...bucket, requests_late: 0, accepted_late: 0, median_hours: null as number | null, avg_rating: null as number | null, rated: 0 };
it("длительность показывает медиану в часах и ведёт к закрытым обращениям", () => {
  harness.data = { ...period, buckets: [{ ...qualityBucket, median_hours: 26 }] };
  renderChart(<DashboardQualityChart kind="lead" />);
  expect(screen.getByText("Медиана от создания до закрытия")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "26.10: медиана 26 ч" })).toHaveAttribute("href", analyticsLink("month", bucket.from, bucket.to, "closed"));
});
it("длительность без закрытых обращений показывает пустое состояние", () => {
  harness.data = { ...period, buckets: [{ ...qualityBucket }] };
  renderChart(<DashboardQualityChart kind="lead" />);
  expect(screen.getByText("За период нет закрытых обращений")).toBeInTheDocument();
});
it("просрочки разделяют обращения и задания с опозданием", () => {
  harness.data = { ...period, buckets: [{ ...qualityBucket, requests_late: 2, accepted_late: 1 }] };
  renderChart(<DashboardQualityChart kind="overdue" />);
  expect(screen.getByRole("link", { name: "26.10: обращения с опозданием 2" })).toHaveAttribute("href", analyticsLink("month", bucket.from, bucket.to, "closed"));
  expect(screen.getByRole("link", { name: "26.10: задания с опозданием 1" })).toHaveAttribute("href", "/tasks?state=accepted_admin");
});
it("просрочки без опозданий показывают пустое состояние", () => {
  harness.data = { ...period, buckets: [{ ...qualityBucket }] };
  renderChart(<DashboardQualityChart kind="overdue" />);
  expect(screen.getByText("За период нет просрочек")).toBeInTheDocument();
});
it("оценки жителей показывают среднюю и число оценок", () => {
  harness.data = { ...period, buckets: [{ ...qualityBucket, avg_rating: 4.5, rated: 3 }] };
  renderChart(<DashboardQualityChart kind="rating" />);
  expect(screen.getByText("Средняя оценка (1–5)")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "26.10: средняя оценка 4,5 (оценок: 3)" })).toHaveAttribute("href", analyticsLink("month", bucket.from, bucket.to, "closed"));
});
it("оценки за период отсутствуют — пустое состояние", () => {
  harness.data = { ...period, buckets: [{ ...qualityBucket }] };
  renderChart(<DashboardQualityChart kind="rating" />);
  expect(screen.getByText("За период нет оценок")).toBeInTheDocument();
});
it("нагрузка исполнителей ведёт к фильтру по исполнителю", () => {
  harness.data = { workload: [
    { person_id: "w", name: "Работник", open: 3, overdue: 2 },
    { person_id: null, name: "Без исполнителя", open: 1, overdue: 0 },
  ] };
  renderChart(<DashboardTasksWorkload />);
  expect(screen.getByRole("link", { name: /Работник/ })).toHaveAttribute("href", "/tasks?assignee=w");
  expect(screen.getByText("Просрочено: 2")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Без исполнителя/ })).toHaveAttribute("href", "/tasks?assignee=unassigned");
});
it("без открытых заданий нагрузка показывает пустое состояние", () => {
  harness.data = { workload: [] };
  renderChart(<DashboardTasksWorkload />);
  expect(screen.getByText("Открытых заданий нет")).toBeInTheDocument();
});
it("аварии без данных показывают пустое состояние", () => {
  harness.data = { ...period, buckets: [{ ...bucket, created: 0, completed: 0 }] };
  renderChart(<DashboardIncidentsChart />);
  expect(screen.getByText("За период нет аварий")).toBeInTheDocument();
});
it("столбцы аварий ведут к списку аварий", () => {
  harness.data = { ...period, buckets: [{ ...bucket, created: 1, completed: 0 }] };
  renderChart(<DashboardIncidentsChart />);
  expect(screen.getByRole("link", { name: "26.10: создано 1" })).toHaveAttribute("href", "/incidents");
  expect(screen.getByRole("link", { name: "26.10: завершено 0" })).toHaveAttribute("href", "/incidents");
});
it("регистрации без данных показывают пустое состояние", () => {
  harness.data = { ...period, buckets: [{ ...bucket, primary: 0, binding: 0 }] };
  renderChart(<DashboardRegistrationsChart />);
  expect(screen.getByText("За период нет регистраций")).toBeInTheDocument();
});
it("анкеты и привязки ведут к отфильтрованному списку регистраций", () => {
  harness.data = { ...period, buckets: [{ ...bucket, primary: 2, binding: 1 }] };
  renderChart(<DashboardRegistrationsChart />);
  expect(screen.getByRole("link", { name: "26.10: анкеты 2" })).toHaveAttribute("href", "/registrations?kind=primary");
  expect(screen.getByRole("link", { name: "26.10: привязки 1" })).toHaveAttribute("href", "/registrations?kind=binding");
});
