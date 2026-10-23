import { expect, it, vi } from "vitest";
import { financialStep } from "./financial-publications.ts";
import { replyText } from "./keyboard.ts";
import { makeTestActor, B1 } from "../testing/actors.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { financialOwnerBuildings } from "../domains/publications/financial-access.ts";
import { publicationFile } from "../domains/publications/media.ts";
vi.mock("../domains/publications/financial-access.ts", () => ({ financialOwnerBuildings: vi.fn(async () => [B1]), publicFinancialHeads: vi.fn(async () => [{ publication_id: "pub", title: "Опубликованный отчёт" }]) }));
vi.mock("../domains/publications/financial-catalog.ts", () => ({ listFinancialCatalogue: vi.fn(async () => ({ items: [{ publication_id: "pub", title: "Опубликованный отчёт" }], has_more: false })) }));
vi.mock("../domains/publications/financial-queries.ts", () => ({ getFinancialObligation: async () => ({ period_from: "2026-09-01", period_to: "2026-09-30", due_at: "2026-10-01T10:00:00Z", prepared_name: "Тест: подготовитель", reviewer_name: "Тест: проверяющий", publisher_name: "Тест: публикатор", missing_channels: ["Стенд"] }), listFinancialObligations: async () => ({ items: [], has_more: false }) }));
vi.mock("../domains/publications/media.ts", () => ({ publicationFile: vi.fn(async () => ({ url: "https://files.invalid/report" })) }));
vi.mock("../domains/publications/service.ts", () => ({ getPublication: async () => ({ id: "pub", kind: "financial_report", financial_versions: [{ id: "v", version: 2, title: "<b>Отчёт</b>", body: "Доступный текст", period_from: "2026-09-01", period_to: "2026-09-30", building_ids: [B1], published_at: "2026-10-01", replaced_at: null, correction_note: "Поправка", needs_fix: true, documents: [{ title: "Отчёт", attachment_id: "f", signed_attachment_id: "signed", disclosed: true }, { title: "Секретное основание", attachment_id: "secret", disclosed: false }] }] }), listPublications: async () => [{ id: "pub", kind: "financial_report", state: "draft", title: "Чужой черновик", building_ids: [B1] }] }));
function fixture() {
  let state: Row = {};
  const deps = { bot: "resident", fileStorage: {}, db: { query: async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    if (sql.startsWith("select state")) return [{ state }] as T[];
    if (sql.startsWith("update bot_dialog_channel")) state = JSON.parse(String(params[1]));
    if (sql.includes("from financial_publication_version")) return [{ publication_id: "pub" }] as T[];
    return [];
  } } } as RegistryDeps;
  return { deps, state: () => state };
}
for (const lang of ["ru", "kk"] as const) it(`карточка ${lang}: точная версия, поправка и needs_fix, скрытые части не попадают в кнопки`, async () => {
  vi.mocked(financialOwnerBuildings).mockResolvedValue([B1]);
  const s = fixture(), base = makeTestActor("finance", [B1]), actor = { ...base, profile: { ...base.profile, language: lang } };
  const reply = await financialStep(s.deps, "123", "/fv v", actor);
  expect(replyText(reply)).toContain("&lt;b&gt;Отчёт&lt;/b&gt;");
  expect(replyText(reply)).toContain("Поправка");
  expect(JSON.stringify(reply)).not.toContain("Секретное основание");
  const buttons = typeof reply === "string" ? [] : reply.buttons?.flat() ?? [];
  expect(buttons.some(b => b.data?.startsWith("/fc "))).toBe(true);
  expect(buttons.every(b => !b.data || new TextEncoder().encode(b.data).length <= 64)).toBe(true);
  const token = String(s.state().financial_token);
  await financialStep(s.deps, "123", `/fc ${token} 0 0`, actor);
  expect(publicationFile).toHaveBeenCalledWith(s.deps, s.deps.fileStorage, actor, "pub", "f");
  vi.mocked(financialOwnerBuildings).mockResolvedValue([]);
  await expect(financialStep(s.deps, "123", `/fc ${token} 0 0`, actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("другая карточка инвалидирует прежние кнопки файла", async () => {
  vi.mocked(financialOwnerBuildings).mockResolvedValue([B1]);
  const s = fixture(), actor = makeTestActor("finance", [B1]);
  await financialStep(s.deps, "123", "/fv v", actor);
  const token = String(s.state().financial_token);
  await financialStep(s.deps, "123", "/fv v", actor);
  await expect(financialStep(s.deps, "123", `/fc ${token} 0 0`, actor)).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
});
it("бот жителя не открывает служебную обязанность", async () => {
  const s = fixture();
  await expect(financialStep(s.deps, "123", "/fd duty", makeTestActor("chairman", [B1]))).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("служебная роль собственника не подменяет опубликованное название текущим черновиком", async () => {
  const s = fixture();
  const reply = await financialStep(s.deps, "123", "/financial", makeTestActor("finance", [B1]));
  expect(replyText(reply)).toContain("Опубликованный отчёт");
  expect(replyText(reply)).not.toContain("Чужой черновик");
});

it("бот сотрудника показывает исходный срок и незавершённый канал без команд изменения", async () => {
  const s = fixture(); s.deps.bot = "worker";
  const reply = await financialStep(s.deps, "123", "/fd duty", makeTestActor("finance", [B1]));
  expect(replyText(reply)).toContain("Первоначальный срок: 01.10.2026 15:00");
  expect(replyText(reply)).toContain("Осталось подтвердить: Стенд");
  expect(typeof reply !== "string" && reply.buttons?.flat().map(b => b.data)).toEqual(["/financialduties"]);
});
