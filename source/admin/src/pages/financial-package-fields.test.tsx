import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Form } from "antd";
import { afterEach, expect, it, vi } from "vitest";
import { FinancialPackageFields } from "./financial-package-fields";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function Harness({ selected = false, extra = false }: { selected?: boolean; extra?: boolean }) { const [form] = Form.useForm(); const disclosed = Form.useWatch("disclosed_version_ids", form), bases = Form.useWatch("basis_versions", form); return <Form form={form} initialValues={{ obligation_id: "duty", ...(selected ? { basis_versions: [{ code: "council", document_version_id: "a" }, ...(extra ? [{ code: "annex", document_version_id: "x" }] : [])], disclosed_version_ids: ["a", ...(extra ? ["x"] : [])] } : {}) }}><FinancialPackageFields form={form} obligations={[{ id: "duty", period_from: "2026-09-01", period_to: "2026-09-30" }]} versions={selected ? ["a", "b", "x"].map(id => ({ id, document_id: id, title: `Основание ${id}`, kind: "decision_basis", audience: "owner", version: 1, signed: true })) : []} /><output data-testid="disclosed">{JSON.stringify(disclosed ?? [])}</output><output data-testid="bases">{JSON.stringify(bases ?? [])}</output></Form>; }
const duty = { id: "duty", period_from: "2026-09-01", period_to: "2026-09-30", building_ids: ["house"], rule_snapshot: { definition: { form_description: "Согласованная форма", report_signed_required: true,
  required_agreements: [{ code: "council", label: "Решение совета", kind: "decision_basis", signed_required: true }] } } };
it("сохраняет дополнительное приложение и раскрытие до явного удаления", async () => {
  vi.mocked(apiFetch).mockResolvedValue(duty);
  render(<Harness selected extra />);
  await screen.findByText("Согласованная форма");
  expect(screen.getByTestId("bases")).toHaveTextContent('"annex"');
  expect(screen.getByTestId("disclosed")).toHaveTextContent('["a","x"]');
  fireEvent.click(screen.getByRole("button", { name: "Удалить дополнительный документ 1" }));
  await vi.waitFor(() => expect(screen.getByTestId("bases")).not.toHaveTextContent('"annex"'));
  expect(screen.getByTestId("disclosed")).toHaveTextContent('["a"]');
});
it("замена основания удаляет прежнее приложение из раскрываемого комплекта", async () => {
  vi.mocked(apiFetch).mockResolvedValue(duty);
  render(<Harness selected />);
  const select = await screen.findByLabelText("Основание: Решение совета");
  expect(screen.getByTestId("disclosed")).toHaveTextContent('["a"]');
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByText("Основание b · версия 1 · подписан"));
  await vi.waitFor(() => expect(screen.getByTestId("disclosed")).toHaveTextContent("[]"));
});
it("берёт период и обязательные основания из снимка обязанности", async () => {
  vi.mocked(apiFetch).mockResolvedValue(duty);
  render(<Harness />);
  expect(await screen.findByText("Согласованная форма")).toBeInTheDocument();
  expect(screen.getByLabelText("Начало отчётного периода")).toHaveValue("2026-09-01");
  expect(screen.getByLabelText("Окончание отчётного периода")).toHaveValue("2026-09-30");
  expect(screen.getByLabelText("Основание: Решение совета")).toBeInTheDocument();
});
it("сбой чтения обязанности сохраняет форму и предлагает повторить чтение", async () => {
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Обязанность недоступна")).mockResolvedValue(duty);
  render(<Harness />);
  expect(await screen.findByText("Обязанность недоступна")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Повторить чтение обязанности" }));
  expect(await screen.findByText("Согласованная форма")).toBeInTheDocument();
  expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
