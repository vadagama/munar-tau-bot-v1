import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ListFilters, type FilterValues } from "./list-filters";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("мобильные фильтры применяются сразу, показывают ошибку периода и сбрасываются", () => {
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
  fireEvent.change(screen.getByLabelText("Период с"),{target:{value:"2026-10-25"}});
  expect(screen.getByLabelText("Применённая дата")).toHaveTextContent("2026-10-25");
  fireEvent.change(screen.getByLabelText("Период по"),{target:{value:"2026-10-24"}});
  expect(screen.getByRole("alert")).toHaveTextContent("Дата начала периода позже даты окончания");
  fireEvent.click(screen.getByRole("button",{name:"Сбросить фильтры"}));
  expect(screen.getByLabelText("Применённая дата")).toHaveTextContent("Нет");
  expect(screen.queryByRole("alert")).toBeNull();
});
