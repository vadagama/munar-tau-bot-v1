import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JobTemplates } from "./job-templates";
import { OSI_PRESETS } from "./job-template-presets";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => computed(el));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it("каталог готовых шаблонов ОСИ подставляет методичку в новый шаблон", async () => {
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === "/v1/job-templates") return { items: [] };
    if (path === "/v1/registry/buildings")
      return { items: [{ id: "b1", name: "Дом 1" }] };
    throw new Error(`Unexpected ${path}`);
  });
  render(<JobTemplates onCreated={() => {}} />);
  fireEvent.click(await screen.findByText(/Готовые шаблоны для ОСИ/));
  // Каталог раскрылся: пресеты видны целиком, последний тоже.
  expect(
    screen.getByText("Дератизация и дезинсекция · по графику, ежеквартально"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getAllByText("Взять за основу")[0]!);
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByLabelText("Название шаблона"),
  ).toHaveProperty("value", OSI_PRESETS[0]!.name);
  expect(
    within(dialog).getByLabelText("Объём задания"),
  ).toHaveProperty("value", OSI_PRESETS[0]!.title);
  expect(
    within(dialog).getByLabelText("Утверждённая инструкция"),
  ).toHaveProperty("value", OSI_PRESETS[0]!.instruction);
  expect(
    within(dialog).getAllByLabelText("Пункт")[0],
  ).toHaveProperty("value", OSI_PRESETS[0]!.evidence[0]!.id);
  // Дома администратор выбирает сам; сохранение идёт обычным POST /v1/job-templates.
  fireEvent.mouseDown(within(dialog).getAllByRole("combobox")[0]!);
  fireEvent.click(await screen.findByText("Дом 1"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/job-templates",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          name: OSI_PRESETS[0]!.name,
          title: OSI_PRESETS[0]!.title,
          instruction: OSI_PRESETS[0]!.instruction,
          buildings: ["b1"],
          required_evidence: OSI_PRESETS[0]!.evidence,
        }),
      }),
    ),
  );
}, 20000);

it("название и инструкция, активность и даты сразу фильтруют шаблоны заданий", async () => {
  vi.mocked(apiFetch).mockImplementation(async path => path === "/v1/job-templates" ? {items:[
    {id:"a",name:"Освещение",version:1,active:true,blueprint:{instruction:"Проверить свет"},created_at:"2026-10-20T19:00:00Z"},
    {id:"b",name:"Лампы",version:1,active:false,blueprint:{instruction:"Проверить свет"},created_at:"2026-10-21T18:59:59Z"},
    {id:"c",name:"Поздний",version:1,active:true,blueprint:{instruction:"Проверить свет"},created_at:"2026-10-21T19:00:00Z"},
  ]} : {items:[]});
  render(<JobTemplates onCreated={() => {}} />);
  await screen.findByRole("cell",{name:"Поздний"});
  fireEvent.change(screen.getByLabelText("Поиск шаблонов заданий"),{target:{value:"свет"}});
  fireEvent.change(screen.getByLabelText("Дата создания с"),{target:{value:"2026-10-21"}});
  fireEvent.change(screen.getByLabelText("Дата создания по"),{target:{value:"2026-10-21"}});
  expect(screen.queryByRole("cell",{name:"Поздний"})).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("combobox",{name:"Состояние шаблона"}));
  fireEvent.click(await screen.findByText("Действующие",{selector:".ant-select-item-option-content"}));
  expect(screen.getByRole("cell",{name:"Освещение"})).toBeInTheDocument();
  expect(screen.queryByRole("cell",{name:"Лампы"})).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Поиск шаблонов заданий"),{target:{value:"Освещение"}});
  expect(screen.getByRole("cell",{name:"Освещение"})).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"К заданиям"})).not.toBeInTheDocument();
});
