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
