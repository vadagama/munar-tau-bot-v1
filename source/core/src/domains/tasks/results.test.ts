import { expect, it } from "vitest";
import { requestResultSnapshot } from "./results.ts";
import type { DbExecutor } from "../../db/client.ts";

it("вопрос без заданий всё равно требует готового документального обязательства", async () => {
  const exec: DbExecutor = { async query<T>(sql: string) {
    if (sql.includes("for update of o")) return [{ id: "obligation", kind: "act", document_id: null }] as T[];
    if (sql.includes("from task t")) throw new Error("Вопрос не требует заданий");
    return [];
  } };
  await expect(requestResultSnapshot(exec, "request", false)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("пустой комплект вопроса не требует отчёта исполнителя", async () => {
  const exec: DbExecutor = { async query<T>() { return [] as T[]; } };
  expect(await requestResultSnapshot(exec, "request", false)).toEqual({ task_report_ids: [], task_results: [], document_versions: [] });
});
