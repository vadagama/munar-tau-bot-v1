import { useState } from "react";
import { Button, Input } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActionPanel } from "./action-panel";
import { CardDrawer } from "./card-drawer";

afterEach(cleanup);

function Editor({ full = false, onClose = vi.fn() }: { full?: boolean; onClose?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  return <CardDrawer open title="Объект" onClose={onClose}>
    <p>Сведения карточки</p>
    <Button onClick={() => setEditing(true)}>Начать действие</Button>
    <ActionPanel open={editing} title="Действие" full={full}
      onCancel={() => { setEditing(false); setValue(""); }}
      hasUnsavedChanges={() => value !== ""}>
      <Input aria-label="Комментарий действия" value={value} onChange={event => setValue(event.target.value)} />
    </ActionPanel>
  </CardDrawer>;
}

it.each([false, true])("форма full=%s остаётся в единственном dialog и возвращает фокус", async full => {
  render(<Editor full={full} />);
  const opener = screen.getByRole("button", { name: "Начать действие" });
  opener.focus();
  fireEvent.click(opener);
  const drawer = screen.getByRole("dialog");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(within(drawer).getByRole("textbox", { name: "Комментарий действия" })).toBeVisible();
  if (full) expect(screen.getByText("Сведения карточки")).not.toBeVisible();
  else expect(screen.getByText("Сведения карточки")).toBeVisible();
  fireEvent.click(within(drawer).getByRole("button", { name: "Отмена" }));
  await waitFor(() => expect(opener).toHaveFocus());
  expect(screen.getByText("Сведения карточки")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Комментарий действия" })).toBeNull();
});

it("Escape при изменённой форме просит подтвердить выход и сохраняет ввод до решения", async () => {
  const onClose = vi.fn();
  render(<Editor full onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Начать действие" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Комментарий действия" }), { target: { value: "Не потерять текст" } });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", keyCode: 27 });
  expect(screen.getByText("Выйти без сохранения введённых данных?")).toBeVisible();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Продолжить редактирование" }));
  expect(screen.getByRole("textbox", { name: "Комментарий действия" })).toHaveValue("Не потерять текст");
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  fireEvent.click(screen.getByRole("button", { name: "Выйти без сохранения" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Комментарий действия" })).toBeNull());
  expect(screen.getByText("Сведения карточки")).toBeVisible();
  expect(onClose).not.toHaveBeenCalled();
});

it("короткая форма отключает исходные бизнес-действия и не позволяет открыть другую форму", () => {
  function ShortActions() {
    const [action, setAction] = useState<string | null>(null);
    return <CardDrawer open title="Объект" onClose={() => {}}>
      <Button onClick={() => setAction("review")}>Начать проверку</Button>
      <Button onClick={() => setAction("assign")}>Изменить назначение</Button>
      <ActionPanel open={action === "review"} title="Проверка" onCancel={() => setAction(null)}>
        <Input aria-label="Комментарий проверки" />
      </ActionPanel>
      <ActionPanel open={action === "assign"} title="Назначение" onCancel={() => setAction(null)}>
        <Input aria-label="Новое назначение" />
      </ActionPanel>
    </CardDrawer>;
  }
  render(<ShortActions />);
  const opener = screen.getByRole("button", { name: "Начать проверку" });
  const otherAction = screen.getByRole("button", { name: "Изменить назначение" });
  fireEvent.click(opener);
  expect(opener).toBeDisabled();
  expect(otherAction).toBeDisabled();
  fireEvent.click(otherAction);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("textbox", { name: "Комментарий проверки" })).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Новое назначение" })).toBeNull();
});

it.each([false, true])("форма full=%s открывается с прокруткой до самого верха", async full => {
  render(<Editor full={full} />);
  const opener = screen.getByRole("button", { name: "Начать действие" });
  const body = opener.closest(".ant-drawer-body")!;
  body.scrollTop = 240;
  opener.focus();
  fireEvent.click(opener);
  await waitFor(() => expect(body.scrollTop).toBe(0));
  expect(screen.getByRole("region", { name: "Действие" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  await waitFor(() => expect(body.scrollTop).toBe(240));
});
