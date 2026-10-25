import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CardDrawer } from "./card-drawer";

afterEach(cleanup);

it("карточка-шторка: закрыта — содержимого нет, открыта — есть; кнопка закрывает", () => {
  const onClose = vi.fn();
  const { rerender } = render(
    <CardDrawer open={false} title="Обращение З-1" onClose={onClose}>
      <span>содержимое карточки</span>
    </CardDrawer>,
  );
  // Шторка всегда смонтирована ради анимации закрытия, но без card контента нет.
  expect(screen.queryByText("содержимое карточки")).toBeNull();
  rerender(
    <CardDrawer open title="Обращение З-1" onClose={onClose}>
      <span>содержимое карточки</span>
    </CardDrawer>,
  );
  expect(screen.getByText("содержимое карточки")).toBeInTheDocument();
  expect(screen.getByText("Обращение З-1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть карточку" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  // Отключение кнопки закрытия во время сохранения/загрузки файла.
  rerender(
    <CardDrawer open title="Т" onClose={onClose} closeDisabled>
      <span>содержимое карточки</span>
    </CardDrawer>,
  );
  expect(screen.getByRole("button", { name: "Закрыть карточку" }))
    .toBeDisabled();
});

it("сохранение защищает все способы закрытия карточки", () => {
  const onClose = vi.fn();
  const { baseElement } = render(
    <CardDrawer open title="Сохранение" onClose={onClose} closeDisabled>
      <span>Форма с несохранёнными данными</span>
    </CardDrawer>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Закрыть карточку" }));
  const cross = screen.queryByRole("button", { name: /close/i });
  if (cross) fireEvent.click(cross);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", keyCode: 27 });
  const mask = baseElement.querySelector(".ant-drawer-mask");
  if (mask) fireEvent.click(mask);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText("Форма с несохранёнными данными")).toBeInTheDocument();
});

it("подтверждение выхода не закрывает карточку, если после предупреждения началось сохранение", () => {
  const onClose = vi.fn();
  const { rerender } = render(
    <CardDrawer open title="Объект" onClose={onClose} hasUnsavedChanges={() => true}>
      <span>Изменённые данные</span>
    </CardDrawer>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Закрыть карточку" }));
  expect(screen.getByText("Выйти без сохранения?")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Выйти без сохранения" })).toBeInTheDocument();
  rerender(
    <CardDrawer open title="Объект" onClose={onClose} hasUnsavedChanges={() => true} closeDisabled>
      <span>Изменённые данные</span>
    </CardDrawer>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Выйти без сохранения" }));
  expect(onClose).not.toHaveBeenCalled();
});


it("разворачивает карточку и сохраняет заполненную форму", () => {
 render(<CardDrawer open title="Задание" onClose={() => {}}><input aria-label="Черновик" defaultValue="Материалы" /></CardDrawer>);
 fireEvent.change(screen.getByLabelText("Черновик"),{target:{value:"Изменённый отчёт"}});
 fireEvent.click(screen.getByRole("button",{name:"Развернуть карточку"}));
 expect(screen.getByRole("button",{name:"Свернуть карточку"})).toBeInTheDocument();
 expect(screen.getByLabelText("Черновик")).toHaveValue("Изменённый отчёт");
 fireEvent.click(screen.getByRole("button",{name:"Свернуть карточку"}));
 expect(screen.getByLabelText("Черновик")).toHaveValue("Изменённый отчёт");
});
