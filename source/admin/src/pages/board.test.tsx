import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BoardView, ViewToggle, useBoardView, type ListKind } from "./board";

function ToggleProbe({ storageKey }: { storageKey: string }) {
  const [kind, setKind] = useBoardView(storageKey);
  return (
    <>
      <span data-testid="kind">{kind}</span>
      <ViewToggle kind={kind} onChange={setKind} />
    </>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("тогл переключает вид и запоминает его между визитами", () => {
  render(<ToggleProbe storageKey="view.persist" />);
  expect(screen.getByTestId("kind")).toHaveTextContent("table");
  fireEvent.click(screen.getByRole("radio", { name: "Доска" }));
  expect(screen.getByTestId("kind")).toHaveTextContent("board");
  expect(localStorage.getItem("view.persist")).toBe("board");
  cleanup();
  render(<ToggleProbe storageKey="view.persist" />);
  expect(screen.getByTestId("kind")).toHaveTextContent("board");
});

it("доска группирует карточки по статусам и открывает карточку кликом", () => {
  const onOpen = vi.fn();
  const rows = [
    { id: 1, state: "a" },
    { id: 2, state: "b" },
    { id: 3, state: "unknown_state" },
  ];
  render(
    <BoardView<{ id: number; state: string }>
      columns={[
        { value: "a", label: "Первая" },
        { value: "b", label: "Вторая" },
      ]}
      rows={rows}
      stateOf={(r) => r.state}
      onOpen={onOpen}
      renderCard={(r) => <span>карточка-{r.id}</span>}
    />,
  );
  expect(screen.getByText("Первая")).toBeInTheDocument();
  expect(screen.getByText("Вторая")).toBeInTheDocument();
  // Неизвестный статус не теряется — уходит в служебную колонку.
  expect(screen.getByText("Прочее")).toBeInTheDocument();
  fireEvent.click(screen.getByText("карточка-2"));
  expect(onOpen).toHaveBeenCalledWith(rows[1]);
});

it("карточка без onOpen не кликабельна, пустая доска показывает заглушку", () => {
  const { unmount } = render(
    <BoardView
      columns={[{ value: "a", label: "Первая" }]}
      rows={[{ id: 1, state: "a" }]}
      stateOf={() => "a"}
      renderCard={() => <span>тихая карточка</span>}
    />,
  );
  expect(screen.getByText("тихая карточка")).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
  unmount();
  render(
    <BoardView
      columns={[]}
      rows={[]}
      stateOf={() => ""}
      renderCard={() => null}
      emptyText="Совсем пусто"
    />,
  );
  expect(screen.getByText("Совсем пусто")).toBeInTheDocument();
});

it("счётчик колонки показывает число карточек", () => {
  render(
    <BoardView
      columns={[{ value: "a", label: "Первая" }]}
      rows={[
        { id: 1, state: "a" },
        { id: 2, state: "a" },
      ]}
      stateOf={(r) => String((r as { state: string }).state)}
      renderCard={(r) => <span>к-{String(r.id)}</span>}
    />,
  );
  expect(screen.getByTestId("board-count-a")).toHaveTextContent("2");
});

it("открытая карточка выделена на доске, остальные — нет", () => {
  render(
    <BoardView
      columns={[{ value: "a", label: "Первая" }]}
      rows={[
        { id: 1, state: "a" },
        { id: 2, state: "a" },
      ]}
      stateOf={(r) => String((r as { state: string }).state)}
      onOpen={() => {}}
      selectedId="2"
      renderCard={(r) => <span>к-{String(r.id)}</span>}
    />,
  );
  expect(screen.getByText("к-2").closest(".board-card"))
    .toHaveClass("board-card--selected");
  expect(screen.getByText("к-2").closest(".board-card"))
    .toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("к-1").closest(".board-card"))
    .not.toHaveClass("board-card--selected");
  expect(screen.getByText("к-1").closest(".board-card"))
    .not.toHaveAttribute("aria-pressed");
});

// Тип-проверка вида: useBoardView возвращает кортеж вида и сеттера.
const _kindCheck: ListKind = "table";
void _kindCheck;

it("доска — одна линия колонок, страница скроллится браузером", () => {
  const { container } = render(
    <BoardView columns={[{ value: "a", label: "Новая" }]} rows={[{ id: 1 }]}
      stateOf={() => "a"} renderCard={() => "Карточка"} />, 
  );
  const board = container.firstElementChild as HTMLElement;
  // Колонки не переносятся на новый ряд: не влезающие уходят в прокрутку браузера.
  expect(board.style.flexWrap).toBe("nowrap");
  expect(board.style.height).toBe("");
  expect(board.style.overflowX).toBe("");
  expect(board.style.overflowY).toBe("");
});
