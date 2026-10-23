import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Form } from "antd";
import dayjs from "dayjs";
import { afterEach, expect, it, vi } from "vitest";
import { DeadlineDatePicker, DeadlineInput } from "./deadline-input";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("устанавливает каждый срок от момента нажатия, сохраняя местное время", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 10, 15));
  const change = vi.fn();
  render(<DeadlineInput onChange={change} />);
  const cases = [
    ["час", "2026-10-23T11:15"], ["2 часа", "2026-10-23T12:15"],
    ["3 часа", "2026-10-23T13:15"], ["6 часов", "2026-10-23T16:15"],
    ["12 часов", "2026-10-23T22:15"], ["сутки", "2026-10-24T10:15"],
    ["неделя", "2026-10-30T10:15"], ["месяц", "2026-11-23T10:15"],
  ];
  for (const [label, date] of cases) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(change).toHaveBeenLastCalledWith(date);
  }
  vi.setSystemTime(new Date(2026, 9, 24, 12, 30));
  fireEvent.click(screen.getByRole("button", { name: "час" }));
  expect(change).toHaveBeenLastCalledWith("2026-10-24T13:30");
});

it.each([[2026, "2026-02-28T14:20"], [2028, "2028-02-29T14:20"]])(
  "календарный месяц от 31 января %i ограничивается последним днём февраля",
  (year, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(year, 0, 31, 14, 20));
    const change = vi.fn();
    render(<DeadlineInput onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "месяц" }));
    expect(change).toHaveBeenCalledWith(expected);
  },
);

it("передаёт шаблон и ручное изменение через обычные изменения формы и отправку", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 10, 15));
  const changed = vi.fn();
  const submit = vi.fn();
  render(
    <Form onValuesChange={changed} onFinish={submit}>
      <Form.Item name="due_at" label="Срок выполнения" rules={[{ required: true }]}>
        <DeadlineInput />
      </Form.Item>
      <button type="submit">Сохранить</button>
    </Form>,
  );
  fireEvent.click(screen.getByRole("button", { name: "2 часа" }));
  const input = screen.getByLabelText("Срок выполнения") as HTMLInputElement;
  expect(input.value).toBe("2026-10-23T12:15");
  expect(changed).toHaveBeenLastCalledWith({ due_at: input.value }, { due_at: input.value });
  fireEvent.change(input, { target: { value: "2026-12-01T18:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith({ due_at: "2026-12-01T18:00" }));
});

it("обновляет DatePicker и отправляет дату в прежнем формате Dayjs", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 10, 15));
  const submit = vi.fn();
  render(
    <Form onFinish={submit}>
      <Form.Item name="due_at" label="Следующее обновление">
        <DeadlineDatePicker showTime format="DD.MM.YYYY HH:mm" />
      </Form.Item>
      <button type="submit">Сохранить</button>
    </Form>,
  );
  fireEvent.click(screen.getByRole("button", { name: "6 часов" }));
  expect((screen.getByLabelText("Следующее обновление") as HTMLInputElement).value).toBe("23.10.2026 16:15");
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  const value = submit.mock.calls[0]![0].due_at;
  expect(dayjs.isDayjs(value)).toBe(true);
  expect(value.format("YYYY-MM-DDTHH:mm")).toBe("2026-10-23T16:15");
});

it("блокирует дату и все шаблоны вместе с формой", () => {
  render(<Form disabled><Form.Item name="due_at" label="Срок"><DeadlineInput /></Form.Item></Form>);
  expect((screen.getByLabelText("Срок") as HTMLInputElement).disabled).toBe(true);
  for (const button of screen.getAllByRole("button")) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  }
});

 it("задаёт быстрый срок в указанном часовом поясе",()=>{
  vi.useFakeTimers({toFake:["Date"]});
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  const change=vi.fn();
  render(<DeadlineDatePicker timeZone="Asia/Almaty" onChange={change}/>);
  fireEvent.click(screen.getByRole("button",{name:"час"}));
  expect(change.mock.calls[0]![0].format("YYYY-MM-DDTHH:mm")).toBe("2026-10-23T16:00");
  expect(change.mock.calls[0]![0].toISOString()).toBe("2026-10-23T11:00:00.000Z");
});
