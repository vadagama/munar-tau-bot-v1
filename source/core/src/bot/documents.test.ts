import { expect, it, vi } from "vitest";
import { documentStep, queueDocumentFile } from "./documents.ts";
import { replyText } from "./keyboard.ts";
import { B1, makeTestActor } from "../testing/actors.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { listObligations } from "../domains/documents/obligations.ts";
import { actorForTelegram } from "./registration.ts";
import { prepareFile } from "../domains/requests/files.ts";
vi.mock("./registration.ts", () => ({ actorForTelegram: vi.fn() }));
vi.mock("../domains/requests/files.ts", () => ({ prepareFile: vi.fn(async () => ({ attachment_id: "staged-file" })), fileUrl: vi.fn() }));
vi.mock("../domains/documents/obligations.ts", () => ({ listObligations: vi.fn() }));
vi.mock("../domains/documents/service.ts", () => ({
  listDocuments: async () => ({ items: [{ id: "d", title: "<b>Акт & проверка</b>" }], total: 1 }),
  getDocument: async () => ({ id: "d", title: "<b>Акт & проверка</b>", version: 3, can_prepare: true, can_review: true, can_manage: true, versions: [{ id: "v", version: 1, state: "on_review", attachment_id: "f" }] }),
  addDocumentVersion: async () => { throw new Error("unexpected mutation"); },
  transitionDocumentVersion: async () => ({}),
}));
function fixture() {
  let state: Row = {};
  const deps = { bot: "worker", db: { query: async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    if (sql.startsWith("select state")) return [{ state }] as T[];
    if (sql.startsWith("update bot_dialog_channel")) state = JSON.parse(String(params[1]));
    return [];
  } } } as RegistryDeps;
  return { deps, state: () => state };
}
it("каталог экранирует название, управление остаётся кнопками", async () => {
  const s = fixture();
  const reply = await documentStep(s.deps, "123", "/documents", makeTestActor("administrator", [B1]));
  expect(replyText(await documentStep(s.deps, "123", "/doc d", makeTestActor("administrator", [B1])))).toContain("&lt;b&gt;Акт &amp; проверка&lt;/b&gt;");
  expect(replyText(reply)).not.toContain("/doc");
  expect(typeof reply !== "string" && reply.buttons?.flat().some(b => b.data === "/doc d")).toBe(true);
});
it("старая кнопка не открывает форму для нового объекта", async () => {
  const s = fixture(), actor = makeTestActor("administrator", [B1]);
  await documentStep(s.deps, "123", "/doc d", actor);
  const token = String(s.state().document_token);
  await documentStep(s.deps, "123", "/documents", actor);
  await expect(documentStep(s.deps, "123", `/dc ${token} return`, actor)).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
  expect(s.state()).not.toHaveProperty("document_form");
});
it("решение требует текст и явное подтверждение, использованная форма не восстанавливается", async () => {
  const s = fixture(), actor = makeTestActor("administrator", [B1]);
  await documentStep(s.deps, "123", "/doc d", actor);
  await documentStep(s.deps, "123", `/dc ${s.state().document_token} return`, actor);
  const form = s.state().document_form as Row;
  expect(form.step).toBe("reason");
  const reply = await documentStep(s.deps, "123", "Исправить <b>объём</b>", actor);
  expect(replyText(reply)).toContain("Исправить &lt;b&gt;объём&lt;/b&gt;");
  await documentStep(s.deps, "123", `/docform ${form.token} confirm`, actor);
  expect(s.state()).not.toHaveProperty("document_form");
  await expect(documentStep(s.deps, "123", `/docform ${form.token} confirm`, actor)).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
});
it("бот жителей не принимает служебное решение даже для совмещающего роли", async () => {
  const s = fixture(), actor = makeTestActor("administrator", [B1]); s.deps.bot = "resident";
  const reply = await documentStep(s.deps, "123", "/doc d", actor);
  expect(typeof reply !== "string" && reply.buttons?.flat().some(b => b.data.endsWith("approve"))).toBe(false);
  await expect(documentStep(s.deps, "123", `/dc ${s.state().document_token} approve`, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("все обязанности доступны по страницам без молчаливого обрезания", async () => {
  const s = fixture(), actor = makeTestActor("administrator", [B1]);
  vi.mocked(listObligations).mockResolvedValue({ items: Array.from({ length: 31 }, (_, i) => ({ prepared_by: actor.person.id, completed_at: null, source_number: `ОБ-${i}`, basis: "Подготовить акт", due_at: "2026-10-23T12:00:00Z" })) });
  const first = await documentStep(s.deps, "123", "/docduties", actor);
  expect(typeof first !== "string" && first.buttons?.flat().some(b => b.data === "/docduties 10")).toBe(true);
  const last = await documentStep(s.deps, "123", "/docduties 30", actor);
  expect(replyText(last)).toContain("ОБ-30");
  expect(replyText(last)).not.toContain("ОБ-29");
});
it.each([{ language: "ru", state: "На проверке", prompt: "Укажите причину" }, { language: "kk", state: "Тексеруде", prompt: "Әрекеттің себебін" }])("карточка и форма используют один язык $language в общем сценарии симулятора", async ({ language, state, prompt }) => {
  const s = fixture(), actor = makeTestActor("administrator", [B1]);
  actor.profile.language = language as "ru" | "kk";
  expect(replyText(await documentStep(s.deps, "123", "/doc d", actor))).toContain(state);
  const form = await documentStep(s.deps, "123", `/dc ${s.state().document_token} return`, actor);
  expect(replyText(form)).toContain(prompt);
});
it("файл сохраняется через устойчивую очередь и не объявляется сохранённым до обработки", async () => {
  const s = fixture(), actor = makeTestActor("administrator", [B1]);
  const queries = vi.spyOn(s.deps.db, "query");
  vi.mocked(actorForTelegram).mockResolvedValue(actor);
  await documentStep(s.deps, "123", "/doc d", actor);
  await documentStep(s.deps, "123", `/dc ${s.state().document_token} version`, actor);
  const reply = await queueDocumentFile(s.deps, "123", { document: { file_id: "telegram-file", file_name: "act.pdf", mime_type: "application/pdf", file_size: 12 } });
  expect(prepareFile).toHaveBeenCalledWith(s.deps, actor, expect.objectContaining({ owner_type: "document", owner_id: "d", expected_version: 3 }));
  expect(queries).toHaveBeenCalledWith("insert into request_upload_job(attachment_id,telegram_file_id,person_id,bot) values($1,$2,$3,'worker')", ["staged-file", "telegram-file", actor.person.id]);
  expect(replyText(reply)).toContain("Файл принят в очередь");
  expect(s.state().document_form).toMatchObject({ step: "choose_signed", values: { attachment_id: "staged-file" } });
  await documentStep(s.deps, "123", "/documents", actor);
  const cancelled = await queueDocumentFile(s.deps, "123", { document: { file_id: "late-file" } });
  expect(replyText(cancelled)).toContain("ожидается текст");
  expect(prepareFile).toHaveBeenCalledTimes(1);
});
