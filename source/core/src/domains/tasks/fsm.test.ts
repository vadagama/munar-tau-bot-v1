import { describe, expect, it } from "vitest";
import {
  aggregateCommonWorkState, nextTaskState, requiredTasksAccepted,
  TASK_STATES, type TaskProgress, type TaskState,
} from "./fsm.ts";

describe("VS-4 WRK-02/06/11: жизненный цикл задания", () => {
  it("проводит явное принятие, отчёт, приёмку и повторную доработку", () => {
    let state: TaskState = "created";
    for (const [action, expected] of [
      ["assign", "awaiting_acceptance"], ["accept", "accepted"],
      ["start", "in_progress"], ["report", "on_review"],
      ["return", "rework"], ["start", "in_progress"],
      ["report", "on_review"], ["approve", "accepted_admin"],
      ["return", "rework"],
    ]) {
      state = nextTaskState(state, action!);
      expect(state).toBe(expected);
    }
  });
  it.each(["accepted", "in_progress"] as const)("возвращает из паузы в %s", (state) => {
    expect(nextTaskState(state, "suspend")).toBe("suspended");
    expect(nextTaskState("suspended", "resume", state)).toBe(state);
  });
  it.each([undefined, null, "created", "on_review", "canceled"] as const)(
    "не угадывает состояние возврата %s", (previous) => {
      expect(() => nextTaskState("suspended", "resume", previous)).toThrow(
        expect.objectContaining({ code: "INVALID_TRANSITION", status: 409 }),
      );
    },
  );
  it("отказ требует нового назначения и принятия", () => {
    expect(nextTaskState("awaiting_acceptance", "decline")).toBe("created");
    expect(() => nextTaskState("created", "start")).toThrow();
    expect(() => nextTaskState("awaiting_acceptance", "start")).toThrow();
  });
  it.each(TASK_STATES)("не меняет %s по молчанию, таймеру или событию доступа", (state) => {
    for (const action of ["timeout", "no_access", "missed_visit", "toString", "__proto__"]) {
      expect(() => nextTaskState(state, action)).toThrow();
    }
  });
  it.each(["accepted_admin", "canceled"] as const)("не отменяет и не переназначает %s", (state) => {
    for (const action of ["cancel", "reassign", "assign", "resume"]) {
      expect(() => nextTaskState(state, action, "accepted")).toThrow();
    }
  });
  it.each(TASK_STATES.filter((state) => state !== "accepted_admin" && state !== "canceled"))(
    "разрешает администратору отмену и снятие назначения из %s", (state) => {
      expect(nextTaskState(state, "cancel")).toBe("canceled");
      expect(nextTaskState(state, "reassign")).toBe("created");
    },
  );
});

const task = (state: TaskState, isRequired = true, started = false): TaskProgress =>
  ({ state, isRequired, started });

describe("VS-4 WRK-10/11: общая работа", () => {
  it("пустая работа не готова к приёмке", () => {
    expect(requiredTasksAccepted([])).toBe(false);
    expect(aggregateCommonWorkState("planned", [])).toBe("planned");
  });
  it("завершение остаётся явным решением администратора", () => {
    const tasks = [task("accepted_admin")];
    expect(requiredTasksAccepted(tasks)).toBe(true);
    expect(aggregateCommonWorkState("in_progress", tasks)).toBe("on_review");
    expect(aggregateCommonWorkState("completed", tasks)).toBe("completed");
  });
  it("отменённое обязательное задание не считается выполненным", () => {
    const tasks = [task("accepted_admin"), task("canceled")];
    expect(requiredTasksAccepted(tasks)).toBe(false);
    expect(aggregateCommonWorkState("in_progress", tasks)).toBe("in_progress");
  });
  it("возврат обязательного задания возобновляет завершённую работу", () => {
    expect(aggregateCommonWorkState("completed", [task("rework")])).toBe("in_progress");
  });
  it("возврат необязательного задания также возобновляет работу", () => {
    expect(aggregateCommonWorkState("completed", [task("accepted_admin"), task("rework", false)]))
      .toBe("in_progress");
  });
  it("переназначение не стирает факт начала", () => {
    expect(aggregateCommonWorkState("in_progress", [task("created", true, true)]))
      .toBe("in_progress");
  });
  it("отмена общей работы не выводится из состояний заданий", () => {
    expect(aggregateCommonWorkState("planned", [task("canceled")])).toBe("planned");
    expect(aggregateCommonWorkState("canceled", [task("in_progress")])).toBe("canceled");
  });
  it("необязательные задания не блокируют проверку необходимого объёма", () => {
    const tasks = [task("on_review"), task("created", false)];
    expect(aggregateCommonWorkState("in_progress", tasks)).toBe("on_review");
    expect(requiredTasksAccepted(tasks)).toBe(false);
  });
});
