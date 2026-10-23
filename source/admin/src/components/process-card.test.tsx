import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "antd";
import { ProcessActions, ProcessHistory, ProcessOverview } from "./process-card";
afterEach(cleanup);
it("показывает все действия сразу, сохраняя главное, обработчики и disabled", () => {
 const onClick=vi.fn();
 render(<ProcessOverview guidance={{title:"Нужен отчёт",description:"Приложите фото",waitingFor:"Исполнитель"}} state="Выполняется"><ProcessActions primary="report">
  <><Button key="cancel" danger>Отменить</Button><Button key="report" onClick={onClick}>Отправить отчёт</Button></><Button key="pause" disabled>Приостановить</Button>
 </ProcessActions></ProcessOverview>);
 expect(screen.getByRole("button",{name:"Отправить отчёт"})).toHaveClass("ant-btn-primary");
 fireEvent.click(screen.getByRole("button",{name:"Отправить отчёт"})); expect(onClick).toHaveBeenCalledOnce();
 expect(screen.getByRole("button",{name:"Приостановить"})).toBeDisabled();
 expect(screen.queryByRole("button",{name:"Другие действия"})).toBeNull();
 expect(screen.getByRole("button",{name:"Отменить"})).toBeVisible();
 expect(screen.getByRole("button",{name:"Отменить"})).toHaveClass("ant-btn-dangerous");
 expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Отправить отчёт", "Отменить", "Приостановить"]);
});
it("не создаёт кнопку при недоступном переходе и сворачивает историю", () => {
 render(<><ProcessActions primary="approve"><Button key="return">Вернуть</Button></ProcessActions><ProcessHistory><p>Прошлое событие</p></ProcessHistory></>);
 expect(document.querySelector(".ant-btn-primary")).toBeNull();
 expect(screen.getByText("Прошлое событие").closest("details")).not.toHaveAttribute("open");
});
