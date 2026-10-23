import { expect, it, vi } from "vitest";
import { listFailures } from "./followup.ts";
import { ApiError } from "../../errors/api.ts";
import { makeTestActor } from "../../testing/actors.ts";
import type { DbExecutor } from "../../db/client.ts";
vi.mock("../documents/access.ts", () => ({ requireDocument: async () => { throw new ApiError("FORBIDDEN"); } }));
it("задача контакта не обходит ограничения исходного документа даже для старшей роли", async () => {
  const actor = makeTestActor("chairman", [], { isTest: true });
  const row = { id: "notice", recipient_person_id: "recipient", is_test: true, event_ref: { documentId: "restricted-document" }, request_id: null, task_id: null };
  const exec: DbExecutor = { query: async <T>() => [row] as T[] };
  expect((await listFailures(exec, actor)).items).toEqual([]);
});
