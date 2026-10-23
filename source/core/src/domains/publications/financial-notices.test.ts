import { expect, it } from "vitest";
import type { DbExecutor } from "../../db/client.ts";
import { B1, B2, makeTestActor } from "../../testing/actors.ts";
import { financialPublicationNotice } from "./financial-notices.ts";
import { noticeAllowed, type NoticeOptions } from "../notifications/service.ts";
import { digestText } from "../notifications/digest.ts";
import { renderNotice } from "../../templates/notice.ts";
function fixture(owner = B1, published = true) {
  const db: DbExecutor = { async query<T>(sql: string): Promise<T[]> {
    if (sql.includes("from financial_publication_version")) return (published ? [{ id: "v2", publication_id: "pub", version: 2, title: "<b>Отчёт</b>", period_from: "2026-09-01", period_to: "2026-09-30", building_ids: [B1], correction_note: "Уточнение <данных>", published_at: "2026-10-01" }] : []) as T[];
    if (sql.includes("from publication where")) return [{ id: "pub", kind: "financial_report", state: "draft" }] as T[];
    if (sql.includes("select distinct p.building_id")) return [{ building_id: owner }] as T[];
    if (sql.includes("from notification_pref")) return [{ mode: "immediate" }] as T[];
    if (sql.includes("select exists")) return [{ ok: true }] as T[];
    throw new Error(`Unexpected notice query: ${sql}`);
  } };
  return db;
}
it("уведомление исправления хранит конкретную версию и неизменную область, каталог экранирует ru/kk", async () => {
  const notice = await financialPublicationNotice(fixture(), "pub", "v2", true);
  expect(notice).toMatchObject({ key: "financial:v2", financialVersionId: "v2", scope: [{ building_id: B1, premises_ids: [] }], text: { template: "notices.financial.corrected", vars: { version: 2, period_from: "01.09.2026", period_to: "30.09.2026" } } });
  for (const language of ["ru", "kk"] as const) {
    const text = renderNotice(notice.text, language);
    expect(text).toContain("&lt;b&gt;Отчёт&lt;/b&gt;");
    expect(text).toContain("Уточнение &lt;данных&gt;");
    expect(text).not.toContain("/fv");
  }
});
it("не создаёт уведомление по невыпущенной версии", async () => {
  await expect(financialPublicationNotice(fixture(B1, false), "pub", "draft", true)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
});
it("доставка повторяет собственность в области конкретной версии, служебная роль и другой дом не заменяют её", async () => {
  const actor = makeTestActor("finance", [B1, B2], { isTest: true });
  const notice = { publicationId: "pub", financialVersionId: "v2", audience: "publication" as const, buildingIds: [B1], isTest: true };
  expect(await noticeAllowed(fixture(), actor, notice)).toBe(true);
  expect(await noticeAllowed(fixture(B2), actor, notice)).toBe(false);
  expect(await noticeAllowed(fixture(B1, false), actor, notice)).toBe(false);
  expect(await noticeAllowed(fixture(), actor, { ...notice, buildingIds: [B2] })).toBe(false);
});

it("FIN-04: уведомление обязанности проверяет режим, полномочия и актуального ответственного повторно", async () => {
  const actor = makeTestActor("finance", [B1], { isTest: true });
  const options = { financialObligationId: "duty", isTest: true } as NoticeOptions;
  for (const patch of [{}, { completed_at: "done" }, { is_test: false }, { prepared_by: "new-person" }, { building_ids: ["other-house"] }]) {
    const row = { building_ids: [B1], is_test: true, completed_at: null, prepared_by: actor.person.id, reviewer_id: "reviewer", publisher_id: "publisher", ...patch };
    const exec: DbExecutor = { async query<T>() { return [row] as T[]; } };
    expect(await noticeAllowed(exec, actor, options)).toBe(Object.keys(patch).length === 0);
  }
  const exec: DbExecutor = { async query<T>() { return [{ building_ids: [B1], is_test: true, completed_at: null, prepared_by: actor.person.id }] as T[]; } };
  expect(await noticeAllowed(exec, { ...actor, assignments: [] }, options)).toBe(false);
});

it("FIN-02: широкое уведомление требует текущей собственности даже у финансового сотрудника", async () => {
  const actor = makeTestActor("finance", [B1], { isTest: true });
  for (const [owner, state, building] of [[false, "published", B1], [true, "published", B1], [false, "draft", B1], [true, "draft", B1], [true, "published", "another-house"]] as const) {
    const exec: DbExecutor = { async query<T>(sql: string) {
      if (sql.includes("select distinct p.building_id")) return (owner ? [{ building_id: building }] : []) as T[];
      if (sql.includes("distinct on(f.publication_id)")) return (owner ? [{ id: "version" }] : []) as T[];
      if (sql.includes("from publication where")) return [{ id: "publication", kind: "financial_report", state }] as T[];
      if (sql.includes("as ok")) return [{ ok: true }] as T[]; // Действующая связь арендатора тоже есть.
      throw new Error(`Неожиданный SQL: ${sql}`);
    } };
    expect(await noticeAllowed(exec, actor, { publicationId: "publication", isTest: true, audience: "publication", buildingIds: [B1] })).toBe(owner && building === B1);
  }
});

it("дайджест не сохраняет текст финансового выпуска после утраты собственности", async () => {
  const actor = makeTestActor("finance", [B1, B2], { isTest: true });
  const item = { id: "digest", event_type: "publication" as const, text: "Финансовые сведения", building_ids: [B1], is_test: true,
    event_ref: { publicationId: "pub", financialVersionId: "v2" } };
  expect(await digestText(fixture(B2), actor, [item])).toBeNull();
  expect(await digestText(fixture(), actor, [item])).toContain("Финансовые сведения");
});
it("ссылка на финансовую версию требует публикацию и аудиторию собственников", async () => {
  const actor = makeTestActor("finance", [B1], { isTest: true });
  expect(await noticeAllowed(fixture(), actor, { financialVersionId: "v2", isTest: true })).toBe(false);
  expect(await noticeAllowed(fixture(), actor, { financialVersionId: "v2", publicationId: "pub", audience: "personal", isTest: true })).toBe(false);
});
