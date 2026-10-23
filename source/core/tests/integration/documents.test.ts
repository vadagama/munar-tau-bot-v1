import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import type { DbClient } from "../../src/db/client.ts";
import { SqlAdminRepo } from "../../src/domains/admin/repo.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { buildActorForProfile } from "../../src/domains/admin/actor-service.ts";
import { createDocument, addDocumentVersion, transitionDocumentVersion, getDocument, publishDocument } from "../../src/domains/documents/service.ts";
import { prepareFile, uploadFile, completeFile, fileUrl, type FileStorage } from "../../src/domains/requests/files.ts";

async function setup(db: DbClient) {
  await db.query("insert into staff_assignment(person_id,role) values($1,'administrator'),($2,'doc_reviewer')", [SEED.testAdminPersonId, SEED.testExecutorPersonId]);
  const repo = new SqlAdminRepo();
  async function actor(id: string) {
    const [p] = await db.query<{ id: string }>("select id from profile where person_id=$1 and archived_at is null", [id]);
    return buildActorForProfile(repo, db, (await repo.getProfile(db, p!.id))!, new Date());
  }
  const admin = await actor(SEED.testAdminPersonId), reviewer = await actor(SEED.testExecutorPersonId);
  const deps = { db, audit: new SqlAuditRepo() };
  const bodies = new Map<string, { size: number; mime: string }>();
  const storage: FileStorage = {
    async put(bucket, path, bytes, mime) { bodies.set(`${bucket}/${path}`, { size: bytes.length, mime }); },
    async info(bucket, path) { const value = bodies.get(`${bucket}/${path}`); if (!value) throw new Error("missing file"); return value; },
    async sign(bucket, path) { return `https://files.invalid/${bucket}/${path}`; },
  };
  const input = { title: "Инструкция", kind: "instruction", audience: "resident", document_date: "2026-10-23", parties: "ОСИ", prepared_by: admin.person.id, reviewer_id: reviewer.person.id, building_ids: [], reason: "Проверка" };
  const doc = await createDocument(deps, admin, input, "create");
  async function attachment() {
    const bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF");
    const current = await getDocument(deps, admin, doc.id);
    const file = await prepareFile(deps, admin, { owner_type: "document", owner_id: doc.id, expected_version: current.version, filename: "instruction.pdf", mime: "application/pdf", size: bytes.length });
    const id = String(file.attachment_id);
    await uploadFile(deps, storage, admin, id, bytes);
    await completeFile(deps, storage, admin, id);
    return id;
  }
  return { db, deps, admin, reviewer, input, doc, attachment, storage };
}

describeWithDb("VS-8: документы и приватные файлы", getDb => {
  it("одновременные проверка и возврат сохраняют одно решение, второе получает конфликт", async () => {
    const s = await setup(getDb()), file = await s.attachment();
    const v = await addDocumentVersion(s.deps, s.admin, s.doc.id, { attachment_id: file, expected_version: s.doc.version, reason: "Новая версия" }, "race-version");
    let current = await getDocument(s.deps, s.admin, s.doc.id);
    await transitionDocumentVersion(s.deps, s.admin, s.doc.id, v.version, "submit", { expected_version: current.version, reason: "Проверить" }, "race-submit");
    current = await getDocument(s.deps, s.admin, s.doc.id);
    const decisions = await Promise.allSettled(["approve", "return"].map(action => transitionDocumentVersion(s.deps, s.reviewer, s.doc.id, v.version, action,
      { expected_version: current.version, reason: "Независимое решение" }, `race-${action}`)));
    expect(decisions.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(decisions.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CONCURRENT_MODIFICATION" } });
    expect(await s.db.query("select id from document_log where document_id=$1 and action in ('approve','return')", [s.doc.id])).toHaveLength(1);
  }, 300_000);
  it("проходит проверку/публикацию, повтор не создаёт вторую карточку", async () => {
    const s = await setup(getDb());
    expect((await createDocument(s.deps, s.admin, s.input, "create")).id).toBe(s.doc.id);
    const file = await s.attachment();
    const v = await addDocumentVersion(s.deps, s.admin, s.doc.id, { attachment_id: file, expected_version: s.doc.version, reason: "Новая версия" }, "version");
    let current = await getDocument(s.deps, s.admin, s.doc.id);
    await transitionDocumentVersion(s.deps, s.admin, s.doc.id, v.version, "submit", { expected_version: current.version, reason: "Проверить" }, "submit");
    current = await getDocument(s.deps, s.admin, s.doc.id);
    await transitionDocumentVersion(s.deps, s.reviewer, s.doc.id, v.version, "approve", { expected_version: current.version, reason: "Проверено" }, "approve");
    const resident = { ...s.admin, assignments: [] };
    await expect(getDocument(s.deps, resident, s.doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    current = await getDocument(s.deps, s.admin, s.doc.id);
    await publishDocument(s.deps, s.admin, s.doc.id, { expected_version: current.version, document_version_id: v.id, reason: "Разместить" }, "publish");
    expect((await getDocument(s.deps, resident, s.doc.id)).versions).toHaveLength(1);
    expect(await fileUrl(s.deps, s.storage, resident, file)).toMatchObject({ expires_in: 300 });
    await expect(uploadFile(s.deps, s.storage, s.admin, file, new Uint8Array())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(s.db.query("update document_version set attachment_id=gen_random_uuid() where id=$1", [v.id])).rejects.toThrow();
  }, 300_000);
  it("отклоняет чужой файл, конфликт и повтор ключа с другим телом", async () => {
    const s = await setup(getDb());
    const file = await s.attachment();
    await expect(addDocumentVersion(s.deps, s.admin, s.doc.id, { attachment_id: file, expected_version: 1, reason: "Старая форма" }, "stale")).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    await expect(createDocument(s.deps, s.admin, { ...s.input, title: "Другой" }, "create")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const other = await createDocument(s.deps, s.admin, { ...s.input, title: "Другой" }, "other");
    await expect(addDocumentVersion(s.deps, s.admin, other.id, { attachment_id: file, expected_version: other.version, reason: "Чужой файл" }, "foreign")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await getDocument(s.deps, s.admin, other.id)).versions).toHaveLength(0);
  }, 300_000);
});
