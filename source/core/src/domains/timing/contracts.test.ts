import { expect, it } from "vitest";
import { editableRuleParams, ruleContract } from "./contracts.ts";
it("TIM-02: все действующие регламенты имеют закрытый контракт с условиями", () => {
  for (
    const key of [
      "work_schedule",
      "first_response",
      "author_reminder",
      "request_admin_close_wait",
      "request_reopen",
      "digest_time",
      "invite_expiry",
      "tenant_wait",
      "registration_stage",
      "dispute_total",
      "task_accept",
      "task_escalation",
      "financial_monthly_publication",
      "financial_annual_publication",
    ]
  ) {
    const contract = ruleContract(key);
    expect(contract).toMatchObject({ version: 1, key });
    expect(contract.start.length).toBeGreaterThan(0);
    expect(contract.finish.length).toBeGreaterThan(0);
    expect(ruleContract(key, { contract })).toEqual(contract);
  }
});
it("неизвестная семантика, версия и подмена автозакрытием отклоняются", () => {
  const contract = ruleContract("author_reminder");
  expect(() => ruleContract("unknown")).toThrow();
  for (
    const override of [{ version: 2 }, { action: "request.close" }, {
      business_pause: "Всегда",
    }]
  ) {
    expect(() =>
      ruleContract("author_reminder", {
        contract: { ...contract, ...override },
      })
    ).toThrow();
  }
  for (
    const injected of [{ contract }, { action: "request.close" }, {
      sql: "select 1",
    }]
  ) {
    expect(() =>
      editableRuleParams({ hours: 48, clock: "calendar", ...injected })
    ).toThrow();
  }
  expect(() => editableRuleParams({ hours: 48, clock: "calendar" })).not
    .toThrow();
});
it("исторические параметры получают исходный контракт без переписывания", () => {
  const legacy = { hours: 48, clock: "calendar" };
  const snapshot = JSON.stringify(legacy);
  const contract = ruleContract("author_reminder", legacy);
  expect(contract.action).toBe("request.remind_author");
  expect(JSON.stringify(legacy)).toBe(snapshot);
  contract.action = "request.close";
  expect(ruleContract("author_reminder").action).toBe("request.remind_author");
});
