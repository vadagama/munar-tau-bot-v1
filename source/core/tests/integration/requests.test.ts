import { startEmulation } from "../../src/domains/emulation/service.ts";
import { SqlEmulationRepo } from "../../src/domains/emulation/repo.ts";
import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { SqlAdminRepo } from "../../src/domains/admin/repo.ts";
import { buildActorForProfile } from "../../src/domains/admin/actor-service.ts";
import type { DbClient } from "../../src/db/client.ts";
import {
  createRequest,
  editRequest,
  getRequest,
  listRequests,
  transitionRequest,
} from "../../src/domains/requests/service.ts";
import {
  addMessage,
  rateRequest,
  restrictMessage,
  shareRequest,
} from "../../src/domains/requests/messages.ts";
import {
  completeFile,
  type FileStorage,
  fileUrl,
  prepareFile,
  uploadFile,
} from "../../src/domains/requests/files.ts";
import { requestStep } from "../../src/bot/requests.ts";
async function setup(db: DbClient) {
  const premises = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  await db.query(
    "insert into person(id,full_name,phone_e164,is_test) values ($1,'Тест: совладелец','+700000000003',true)",
    [participantId],
  );
  await db.query(
    "insert into profile(person_id,telegram_user_id,is_test) values ($1,-3,true)",
    [participantId],
  );
  await db.query(
    `with a as (insert into staff_assignment(person_id,role) values ($1,'administrator') returning id) insert into staff_scope(assignment_id,building_id) select id,$2 from a`,
    [SEED.testAdminPersonId, SEED.building1],
  );
  await db.query(
    "insert into premises(id,building_id,kind,number,is_test) values ($1,$2,'apartment','VS3',true)",
    [premises, SEED.building1],
  );
  await db.query(
    "insert into connection(person_id,premises_id,role,basis,status) values ($1,$3,'tenant','rent','active'),($2,$3,'owner','ownership','active')",
    [SEED.testExecutorPersonId, participantId, premises],
  );
  const repo = new SqlAdminRepo();
  const actor = async (id: string) => {
    const [p] = await db.query<{ id: string }>(
      "select id from profile where person_id=$1 and archived_at is null",
      [id],
    );
    return buildActorForProfile(
      repo,
      db,
      (await repo.getProfile(db, p!.id))!,
      new Date(),
    );
  };
  const author = await actor(SEED.testExecutorPersonId),
    admin = await actor(SEED.testAdminPersonId);
  const participant = await actor(participantId);
  return {
    deps: { db, audit: new SqlAuditRepo() },
    author,
    admin,
    participant,
    premises,
    input: {
      text: "Тестовый вопрос",
      kind: "question",
      source: "bot",
      premises_id: premises,
    },
  };
}
describeWithDb("VS-3 REQ/SHR/MSG/RAT/FIL", (getDb) => {
  it("REQ-08: фильтр здания включает помещения и общее имущество, сохраняя область доступа", async () => {
    const { deps, author, admin, input } = await setup(getDb());
    const room = await createRequest(deps, author, input, "filter-room");
    const common = await createRequest(deps, author, {
      text: "Общее имущество", kind: "question", source: "bot", building_id: SEED.building1,
    }, "filter-common");
    const other = await createRequest(deps, author, {
      text: "Другой дом", kind: "question", source: "bot", building_id: SEED.building2,
    }, "filter-other");
    expect((await listRequests(deps, author, { building_id: SEED.building1 })).map(r => r.id))
      .toEqual(expect.arrayContaining([room.id, common.id]));
    expect((await listRequests(deps, author, { building_id: SEED.building1 })).map(r => r.id))
      .not.toContain(other.id);
    expect((await listRequests(deps, author, { building_id: SEED.building2 })).map(r => r.id))
      .toEqual([other.id]);
    expect(await listRequests(deps, admin, { building_id: SEED.building2 })).toEqual([]);
    expect((await listRequests(deps, author)).map(r => r.id)).toEqual(expect.arrayContaining([room.id, common.id, other.id]));
  });

  it("REQ: список активных отделён от архива закрытых (states, limit)", async () => {
    const { deps, author, admin, input } = await setup(getDb());
    const active = await createRequest(deps, author, input, "states-active");
    const rejected = await createRequest(deps, author, input, "states-rejected");
    await transitionRequest(deps, admin, String(rejected.id), {
      action: "reject",
      expected_version: rejected.version,
      reason: "Не относится к ОСИ",
      payload: { route: "Горячая линия УК" },
    });
    // Без фильтра — все состояния (кабинет); у бота фильтр задаёт states.
    expect((await listRequests(deps, author)).map(r => r.id))
      .toEqual(expect.arrayContaining([active.id, rejected.id]));
    expect((await listRequests(deps, author, { states: ["closed", "canceled", "rejected"] })).map(r => r.id))
      .toEqual([rejected.id]);
    expect((await listRequests(deps, author, { states: ["new"] })).map(r => r.id))
      .toEqual([active.id]);
    // limit проверяется после фильтра: закрытых нет — пусто даже с лимитом.
    expect(await listRequests(deps, author, { states: ["closed"], limit: 1 }))
      .toEqual([]);
    expect((await listRequests(deps, author, { states: ["new"], limit: 1 })).map(r => r.id))
      .toEqual([active.id]);
  });

  it("REQ-05: параллельная отправка одна; другой payload — 409; черновик приватен", async () => {
    const { deps, author, admin, participant, input } = await setup(getDb());
    const [a, b] = await Promise.all([
      createRequest(deps, author, input, "same"),
      createRequest(deps, author, { ...input }, "same"),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.number).toMatch(/^З-\d\d-\d{5}$/);
    await expect(
      createRequest(deps, author, { ...input, text: "Другой текст" }, "same"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(getRequest(deps, participant, String(a.id))).rejects
      .toMatchObject({ code: "NOT_FOUND" });
    const draft = await createRequest(deps, author, {
      ...input,
      as_draft: true,
    });
    expect(draft.number).toBeNull();
    await expect(getRequest(deps, admin, String(draft.id))).rejects
      .toMatchObject({ code: "NOT_FOUND" });
    expect(
      await getDb().query(
        "select id from outbox where event_type='request.created'",
      ),
    ).toHaveLength(1);
  });
  it("SHR/MSG: доступ по приглашению, внутренний канал/файл/цитата закрыты; отзыв связи синхронен", async () => {
    const { deps, author, admin, participant, input, premises } = await setup(
      getDb(),
    );
    const row = await createRequest(deps, author, input, "privacy");
    const id = String(row.id);
    const internal = await addMessage(deps, admin, id, {
      channel: "internal",
      text: "Служебный секрет",
    }, "internal");
    const f = await prepareFile(deps, admin, {
      owner_type: "request",
      owner_id: id,
      bucket: "internal",
      filename: "a.pdf",
      size: 4,
      mime: "application/pdf",
    });
    const detail = await getRequest(deps, admin, id);
    expect(detail.author_name).toBe(author.person.fullName);
    expect(detail.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Служебный секрет", author_name: admin.person.fullName }),
      expect.objectContaining({ text: input.text, author_name: author.person.fullName }),
    ]));
    await shareRequest(deps, author, id, participant.person.id);
    const pending = await prepareFile(deps, admin, {
      owner_id: id,
      bucket: "resident",
      filename: "pending.pdf",
      size: 4,
      mime: "application/pdf",
    });
    await expect(
      fileUrl(
        deps,
        {} as FileStorage,
        participant,
        String(pending.attachment_id),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getRequest(deps, participant, id)).messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Служебный секрет" }),
      ]),
    );
    await expect(
      fileUrl(deps, {} as FileStorage, participant, String(f.attachment_id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      addMessage(
        deps,
        participant,
        id,
        { channel: "internal", text: "Нет" },
        "wrong",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      addMessage(deps, participant, id, {
        channel: "resident",
        text: "Цитата",
        reply_to: internal.id,
      }, "quote"),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const resident = await addMessage(deps, participant, id, {
      text: "Доступное сообщение",
    }, "resident");
    await restrictMessage(deps, admin, id, String(resident.id), {
      reason: "Ошибка раскрытия",
    });
    expect((await getRequest(deps, author, id)).messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Доступное сообщение" }),
      ]),
    );
    await expect(
      getDb().query("update message set channel='resident' where id=$1", [
        internal.id,
      ]),
    ).rejects.toThrow("immutable");
    await getDb().query(
      "update connection set status='revoked' where person_id=$1 and premises_id=$2",
      [participant.person.id, premises],
    );
    await expect(getRequest(deps, participant, id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      addMessage(
        deps,
        participant,
        id,
        { text: "Доступное сообщение" },
        "resident",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listRequests(deps, participant, { search: "секрет" }))
      .toHaveLength(0);
  });
  it(
    "FLOW/RAT: устаревшая версия/участник не подтверждают; оценка исключается после возврата",
    async () => {
      const { deps, author, admin, participant, input } = await setup(getDb());
      let row = await createRequest(deps, author, input, "fsm");
      const id = String(row.id);
      const move = async (
        actor: typeof author,
        action: string,
        payload = {},
        reason = "Причина",
      ) => {
        row = await transitionRequest(deps, actor, id, {
          action,
          expected_version: row.version,
          payload,
          reason,
        });
        return row;
      };
      await move(admin, "start_review");
      await expect(
        transitionRequest(deps, admin, id, {
          action: "ask_clarification",
          expected_version: 1,
          reason: "вопрос",
        }),
      ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
      await move(admin, "ask_clarification", { question: "Уточните место" });
      await move(author, "answer_clarification", { answer: "У двери" });
      await move(admin, "submit_result", {
        confirmation_payload: { summary: "Ответ подготовлен" },
      });
      await shareRequest(deps, author, id, participant.person.id);
      await expect(
        move(participant, "confirm_result", {
          confirmation_version: row.confirmation_version,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(move(author, "confirm_result", { confirmation_version: 0 }))
        .rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
      await move(author, "confirm_result", {
        confirmation_version: row.confirmation_version,
      });
      expect(row.close_method).toBe("author");
      await rateRequest(deps, author, id, { value: 2, comment: "Замечание" });
      await rateRequest(deps, author, id, { value: 4 });
      expect(
        await getDb().query("select id from rating_log where request_id=$1", [
          id,
        ]),
      ).toHaveLength(2);
      await move(author, "reopen");
      const [rating] = await getDb().query<{ withdrawn_at: unknown }>(
        "select withdrawn_at from rating where request_id=$1",
        [id],
      );
      expect(rating!.withdrawn_at).not.toBeNull();
      expect(row.open_at).not.toBeNull();
    },
    240000,
  );
  it("FIL-02: неполный файл не блокирует отправку; complete только после подтверждения; URL 300 сек", async () => {
    const { deps, author, admin, input } = await setup(getDb());
    const draft = await createRequest(deps, author, {
      ...input,
      as_draft: true,
    });
    const f = await prepareFile(deps, author, {
      owner_id: draft.id,
      filename: "тест.pdf",
      size: 4,
      mime: "application/pdf",
    });
    const store: FileStorage = {
      put: async () => {},
      info: async () => ({ size: 4, mime: "application/pdf" }),
      sign: async (_b, _p, seconds) => {
        expect(seconds).toBe(300);
        return "https://example.invalid/file";
      },
    };
    await expect(fileUrl(deps, store, author, String(f.attachment_id))).rejects
      .toMatchObject({ code: "INVALID_TRANSITION" });
    const row = await transitionRequest(deps, author, String(draft.id), {
      action: "submit",
      expected_version: draft.version,
    }, "submit");
    expect(row.number).toBeTruthy();
    expect((await getRequest(deps, admin, String(row.id))).attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "incomplete" }),
      ]),
    );
    await uploadFile(
      deps,
      store,
      author,
      String(f.attachment_id),
      new TextEncoder().encode("%PDF"),
    );
    await completeFile(deps, store, author, String(f.attachment_id));
    expect(
      (await fileUrl(deps, store, author, String(f.attachment_id))).expires_in,
    ).toBe(300);
  });
  it(
    "REQ-06: исправление места сохраняет историю, проверяет сопровождающего и отзывает прежние shares",
    async () => {
      const { deps, author, admin, participant, premises, input } = await setup(
        getDb(),
      );
      const target = crypto.randomUUID();
      await getDb().query(
        "insert into premises(id,building_id,kind,number,is_test) values ($1,$2,'apartment','VS3-target',true)",
        [target, SEED.building1],
      );
      await getDb().query(
        "insert into connection(person_id,premises_id,role,basis,status) values ($1,$2,'tenant','rent','active')",
        [author.person.id, target],
      );
      let row = await createRequest(deps, author, input, "move");
      const id = String(row.id);
      row = await transitionRequest(deps, admin, id, {
        action: "start_review",
        expected_version: row.version,
      });
      await shareRequest(deps, author, id, participant.person.id);
      row = await editRequest(deps, admin, id, {
        expected_version: row.version,
        premises_id: target,
        building_id: SEED.building1,
        reason: "Ошибочно выбрана квартира",
      });
      expect(row.premises_id).toBe(target);
      expect(row.assigned_admin_person_id).toBe(admin.person.id);
      await expect(getRequest(deps, participant, id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const [history] = await getDb().query<
        { before_id: string; after_id: string }
      >(
        "select meta->'before'->>'premises_id' before_id,meta->'after'->>'premises_id' after_id from request_log where request_id=$1 order by id desc limit 1",
        [id],
      );
      expect(history).toEqual({ before_id: premises, after_id: target });
    },
    180000,
  );
  it(
    "VS-4 gate: смена вида после начала работы не обходит приёмку; отмена требует решения",
    async () => {
      const { deps, author, admin, input } = await setup(getDb());
      let row = await createRequest(
        deps,
        author,
        { ...input, kind: "request" },
        "work",
      );
      const id = String(row.id);
      row = await transitionRequest(deps, admin, id, {
        action: "start_review",
        expected_version: row.version,
      });
      row = await transitionRequest(deps, admin, id, {
        action: "start_work",
        expected_version: row.version,
        payload: { plan: "План работ" },
      });
      row = await editRequest(deps, admin, id, {
        kind: "question",
        expected_version: row.version,
      });
      await expect(
        transitionRequest(deps, admin, id, {
          action: "submit_result",
          expected_version: row.version,
          payload: { confirmation_payload: { summary: "Обход" } },
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      row = await transitionRequest(deps, author, id, {
        action: "cancel_request",
        expected_version: row.version,
        reason: "Нужна отмена",
      });
      expect(row.state).toBe("in_work");
      row = await transitionRequest(deps, admin, id, {
        action: "approve_cancel",
        expected_version: row.version,
        reason: "Остановка согласована",
        payload: { stop_resolution: "Начатых затрат нет, работы остановлены" },
      });
      expect(row.state).toBe("canceled");
    },
    180000,
  );
  it("бот и эмуляция: черновик → отправка → статус через общий сервис", async () => {
    const { deps, author } = await setup(getDb());
    const repo = new SqlAdminRepo();
    const [realProfile] = await getDb().query<{ id: string }>(
      "select id from profile where person_id=$1",
      [SEED.techAdminPersonId],
    );
    const real = await buildActorForProfile(
      repo,
      getDb(),
      (await repo.getProfile(getDb(), realProfile!.id))!,
      new Date(),
    );
    const session = await startEmulation(
      {
        tx: getDb(),
        admin: repo,
        audit: deps.audit,
        emulation: new SqlEmulationRepo(),
      },
      real,
      { emulatedProfileId: author.profile.id },
      new Date(),
    );
    const actor = {
      ...author,
      emulation: {
        sessionId: session.id,
        realPersonId: real.person.id,
        realProfileId: real.profile.id,
      },
    };
    await requestStep(deps, "-2", "/newrequest", actor);
    await requestStep(deps, "-2", "1", actor);
    expect(await requestStep(deps, "-2", "Проблема у двери", actor)).toContain(
      "/sendrequest",
    );
    const reply = await requestStep(
      deps,
      "-2",
      "/sendrequest",
      actor,
      "bot-submit",
    );
    expect(reply).toMatch(/З-\d\d-\d{5}/);
    expect(
      await getDb().query(
        "select id from audit_log where emulation_session_id=$1 and action='request.submitted'",
        [session.id],
      ),
    ).toHaveLength(1);
    expect(
      await getDb().query(
        "select id from notification where channel='telegram'",
      ),
    ).toHaveLength(0);
    expect(await requestStep(deps, "-2", "/requests", actor)).toContain(
      "Проблема у двери",
    );
  });
});
