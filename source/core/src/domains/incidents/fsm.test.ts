import { describe, expect, it } from "vitest";
import { nextIncidentState, requireFullRecovery } from "./fsm.ts";

describe("EMG-05: явная проверка восстановления", () => {
  it("проходит полный путь и возвращается к устранению при ошибке", () => {
    let state = nextIncidentState("signal_check", "confirm");
    state = nextIncidentState(state, "start_mitigation");
    state = nextIncidentState(state, "report_recovery");
    state = nextIncidentState(state, "complete");
    expect(state).toBe("completed");
    expect(nextIncidentState(state, "reopen")).toBe("mitigation");
    expect(nextIncidentState("not_confirmed", "recheck")).toBe("signal_check");
  });
  it.each(["timer", "complete", "reopen", "toString", "__proto__"])("не завершает проверку сигнала командой %s", action => {
    expect(() => nextIncidentState("signal_check", action)).toThrow();
  });
  it("не завершает инцидент после восстановления только одного дома", () => {
    expect(() => requireFullRecovery(["house1", "house2"], ["house1"])).toThrow();
    expect(() => requireFullRecovery(["house1", "house2"], ["house1", "house1"])).toThrow();
  });
  it("не подменяет восстановление пустым или чужим охватом", () => {
    expect(() => requireFullRecovery([], [])).toThrow();
    expect(() => requireFullRecovery(["zone1"], ["zone2"])).toThrow();
  });
  it("допускает проверку полного охвата независимо от порядка", () => {
    expect(() => requireFullRecovery(["zone1", "zone2"], ["zone2", "zone1"])).not.toThrow();
  });
});
