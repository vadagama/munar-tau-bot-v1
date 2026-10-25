import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ListFilters, type FilterValues } from "./list-filters";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("черновик дат не меняет выдачу до применения, закрытие отменяет черновик, сброс очищает условия", () => {
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({matches: query === "(max-width: 767px)", media: query, onchange:null,
    addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:()=>false}));
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computed(element));
  function Example() {
    const [values,setValues] = useState<FilterValues>({from:"",to:""});
    return <><output aria-label="Применённая дата">{values.from || "Нет"}</output>
      <ListFilters search={<input aria-label="Поиск" />} values={values} onChange={setValues}
        stateLabel="Состояние" stateOptions={[]} relatedLabel="Исполнитель" relatedOptions={[]} /></>;
  }
  render(<Example />);
  fireEvent.click(screen.getByRole("button",{name:"Фильтры"}));
  fireEvent.change(screen.getByLabelText("Период с"),{target:{value:"2026-10-25"}});
  expect(screen.getByLabelText("Применённая дата")).toHaveTextContent("Нет");
  fireEvent.click(screen.getByRole("button",{name:"Применить"}));
  expect(screen.getByLabelText("Применённая дата")).toHaveTextContent("2026-10-25");
  fireEvent.click(screen.getByRole("button",{name:"Фильтры · 1"}));
  fireEvent.change(screen.getByLabelText("Период с"),{target:{value:"2026-10-24"}});
  fireEvent.click(screen.getByRole("button",{name:"Close"}));
  fireEvent.click(screen.getByRole("button",{name:"Фильтры · 1"}));
  expect(screen.getByLabelText("Период с")).toHaveValue("2026-10-25");
  fireEvent.click(screen.getByRole("button",{name:"Сбросить"}));
  expect(screen.getByLabelText("Применённая дата")).toHaveTextContent("Нет");
});
