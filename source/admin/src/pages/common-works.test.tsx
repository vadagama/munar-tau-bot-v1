import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommonWorks } from "./common-works";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
const computed = window.getComputedStyle.bind(window);
beforeEach(() => { localStorage.clear(); vi.spyOn(window, "getComputedStyle").mockImplementation(el => computed(el)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it("поиск, состояние и даты создания сразу фильтруют общие работы", async () => {
  vi.mocked(apiFetch).mockResolvedValue({items:[
    {id:"a",number:"ОР-1",title:"Ремонт",plan:"Восстановить свет",state:"planned",created_at:"2026-10-20T19:00:00Z"},
    {id:"b",number:"ОР-2",title:"Ремонт",plan:"Восстановить свет",state:"completed",created_at:"2026-10-21T18:59:59Z"},
    {id:"c",number:"ОР-3",title:"Ремонт",plan:"Восстановить свет",state:"planned",created_at:"2026-10-21T19:00:00Z"},
  ]});
  render(<CommonWorks onTask={() => {}} />);
  await screen.findByRole("button",{name:"ОР-3"});
  fireEvent.change(screen.getByLabelText("Поиск общих работ"),{target:{value:"свет"}});
  fireEvent.change(screen.getByLabelText("Дата создания с"),{target:{value:"2026-10-21"}});
  fireEvent.change(screen.getByLabelText("Дата создания по"),{target:{value:"2026-10-21"}});
  expect(screen.queryByRole("button",{name:"ОР-3"})).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("combobox",{name:"Состояние общей работы"}));
  fireEvent.click(await screen.findByText("Запланирована",{selector:".ant-select-item-option-content"}));
  expect(screen.getByRole("button",{name:"ОР-1"})).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"ОР-2"})).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Поиск общих работ"),{target:{value:"ОР-1"}});
  expect(screen.getByRole("button",{name:"ОР-1"})).toBeInTheDocument();
  expect(within(screen.getByRole("search")).getByRole("button",{name:"Колонки"})).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"К заданиям"})).not.toBeInTheDocument();
});
