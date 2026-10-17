import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import {
  dispatchNotices,
  enqueueNotice,
  recipientActor,
  setPreference,
} from "../../src/domains/notifications/service.ts";
import { sendNotifications } from "../../src/domains/notifications/delivery.ts";
import { changeRule } from "../../src/domains/timing/rules.ts";
import { startTimer } from "../../src/domains/registry/time.ts";
import { listFailures } from "../../src/domains/notifications/followup.ts";
describeWithDb("VS-5 TIM/NTF", (getDb) => {
  it("TIM-04: старый таймер сохраняется, новые сроки получают новый график; TIM-03 запрещает исполнителю правку", async () => {
    const db = getDb(),
      audit = new SqlAuditRepo(),
      actor = (await recipientActor(db, SEED.chairmanPersonId))!;
    const rollback = Symbol();
    try {
      await db.transaction(async (exec) => {
        const deps = {
          audit,
          db: {
            ...db,
            query: exec.query.bind(exec),
            transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
          },
        };
        const before = crypto.randomUUID();
        await startTimer(
          exec,
          "first_response",
          before,
          "request_first_response",
          new Date("2026-10-17T14:00:00Z"),
        );
        const [old] = await exec.query(
          "select rule_version_id,due_at from timer where entity_id=$1",
          [before],
        );
        await changeRule(deps, actor, "work_schedule", {
          hours: 10,
          clock: "working",
          start: 10,
          end: 18,
          days: [0, 1, 2, 3, 4, 5, 6],
          timezone: "Asia/Almaty",
        }, "Тест смены");
        const after = crypto.randomUUID();
        await startTimer(
          exec,
          "first_response",
          after,
          "request_first_response",
          new Date("2026-10-17T14:00:00Z"),
        );
        const [next] = await exec.query(
          "select rule_version_id,due_at from timer where entity_id=$1",
          [after],
        );
        expect(next!.rule_version_id).not.toBe(old!.rule_version_id);
        expect(new Date(String(next!.due_at)).toISOString()).toBe(
          "2026-10-18T07:00:00.000Z",
        );
        expect(
          (await exec.query(
            "select rule_version_id,due_at from timer where entity_id=$1",
            [before],
          ))[0],
        ).toEqual(old);
        const executor =
          (await recipientActor(exec, SEED.testExecutorPersonId))!;
        await expect(
          changeRule(deps, executor, "first_response", {
            hours: 1,
            clock: "calendar",
          }, "нет права"),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        throw rollback;
      });
    } catch (e) {
      if (e !== rollback) throw e;
    }
  });
  it("NTF: outbox дедуп, обязательность, simulator и окончательная ошибка без дублей контакта", async () => {
    const db = getDb(),
      deps = { db, audit: new SqlAuditRepo() },
      personId = SEED.testExecutorPersonId;
    const actor = (await recipientActor(db, personId))!;
    await setPreference(deps, actor, "request.status", "off");
    await db.transaction(async (exec) => {
      await enqueueNotice(exec, {
        personId,
        key: "required",
        text: "Обязательно",
        type: "request.required",
      });
      await enqueueNotice(exec, {
        personId,
        key: "required",
        text: "Повтор",
        type: "request.required",
      });
      await enqueueNotice(exec, {
        personId,
        key: "optional",
        text: "Статус",
        type: "request.status",
      });
    });
    await dispatchNotices(deps);
    expect(await db.query("select * from notification")).toHaveLength(1);
    let external = 0;
    await sendNotifications(deps, async () => {
      external++;
    });
    expect(external).toBe(0);
    expect((await db.query("select state from notification"))[0]!.state).toBe(
      "sent",
    );
    // Проверка окончательной ошибки на вымышленном получателе без реальной отправки.
    await db.query(
      "insert into notification(telegram_user_id,text,dedup_key,important) values (123456,'Тест','failed',true)",
    );
    await sendNotifications(deps, async () => {
      throw Object.assign(new Error("SECRET_URL"), { blocked: true });
    });
    await sendNotifications(deps, async () => {});
    expect(await db.query("select * from notification_followup")).toHaveLength(
      1,
    );
    expect(
      (await db.query(
        "select last_error from notification where dedup_key='failed'",
      ))[0]!.last_error,
    ).toBe("BLOCKED_BY_USER");
    await expect(listFailures(db, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describeWithDb("VS-5 дайджест, доступ и таймеры", (getDb) => {
  it("NTF-01: нет пустой сводки, дедуп; прекращение связи перед отправкой отменяет доставку", async () => {
    const db = getDb(),
      deps = { db, audit: new SqlAuditRepo() },
      personId = SEED.testExecutorPersonId;
    const actor = (await recipientActor(db, personId))!;
    const [premisesRow] = await db.query<{ id: string }>(
      "insert into premises(building_id,kind,number,is_test) values ($1,'apartment','VS5',true) returning id",
      [SEED.building1],
    );
    const premises = premisesRow!.id;
    await db.query(
      "insert into connection(person_id,premises_id,role,basis,status) values ($1,$2,'owner','ownership','active')",
      [personId, premises],
    );
    await setPreference(deps, actor, "publication", "digest");
    const { sweepDigests } = await import(
      "../../src/domains/notifications/digest.ts"
    );
    const now = new Date("2026-10-17T15:30:00Z");
    expect(await sweepDigests(deps, now)).toBe(0);
    await enqueueNotice(db, {
      personId,
      key: "publication:1",
      text: { ru: "Новость", kk: "Жаңалық" },
      type: "publication",
      audience: "publication",
      buildingIds: [SEED.building1],
      isTest: true,
    });
    await dispatchNotices(deps);
    expect(await sweepDigests(deps, now)).toBe(1);
    expect(await sweepDigests(deps, now)).toBe(0);
    await db.query(
      "update connection set status='revoked' where person_id=$1",
      [personId],
    );
    await sendNotifications(deps, async () => {
      throw new Error("Must not send");
    });
    expect(
      (await db.query(
        "select state from notification where event_type='digest'",
      ))[0]!.state,
    ).toBe("canceled");
  });
  it("WRK-07: напоминание не закрывает обращение; предыдущая версия результата не срабатывает", async () => {
    const db = getDb(), deps = { db, audit: new SqlAuditRepo() };
    const [requestRow] = await db.query<{ id: string }>(
      "insert into request(number,kind,state,author_person_id,created_by,source,description,is_test,building_id,confirmation_version) values ('VS5-1','question','awaiting_confirmation',$1,$1,'bot','Тест',true,$2,2) returning id",
      [SEED.testExecutorPersonId, SEED.building1],
    );
    const id = requestRow!.id;
    const { startConfirmationTimers, sweepConfirmationTimers } = await import(
      "../../src/domains/timing/request-timers.ts"
    );
    await db.transaction(async (exec) => {
      await startConfirmationTimers(exec, id, 1);
      await startConfirmationTimers(exec, id, 2);
    });
    await db.query(
      "update timer set due_at=now()-interval '1 minute' where entity_id=$1",
      [id],
    );
    expect(await sweepConfirmationTimers(deps)).toBe(4);
    expect(await sweepConfirmationTimers(deps)).toBe(0);
    expect(
      (await db.query("select state from request where id=$1", [id]))[0]!.state,
    ).toBe("awaiting_confirmation");
    expect(
      (await db.query(
        "select state from timer where entity_id=$1 and stage like '%:1'",
        [id],
      )).every((r) => r.state === "canceled"),
    ).toBe(true);
    expect(
      (await db.query(
        "select count(*)::int n from outbox where event_type='notification.requested'",
      ))[0]!.n,
    ).toBe(1);
  });
  it("NTF: отозванная роль администратора блокирует отложенное уведомление", async () => {
    const db = getDb(), deps = { db, audit: new SqlAuditRepo() };
    const [requestRow] = await db.query<{ id: string }>(
      "insert into request(number,state,author_person_id,created_by,source,description,is_test,building_id) values ('VS5-2','new',$1,$1,'bot','Тест',true,$2) returning id",
      [SEED.testExecutorPersonId, SEED.building1],
    );
    const id = requestRow!.id;
    await db.query(
      "with a as (insert into staff_assignment(person_id,role) values ($1,'administrator') returning id) insert into staff_scope(assignment_id,building_id) select id,$2 from a",
      [SEED.testAdminPersonId, SEED.building1],
    );
    await enqueueNotice(db, {
      personId: SEED.testAdminPersonId,
      key: "staff:1",
      text: "Новая заявка",
      requestId: id,
      audience: "staff",
      isTest: true,
    });
    await dispatchNotices(deps);
    expect(await db.query("select * from notification")).toHaveLength(1);
    await db.query(
      "update staff_assignment set status='revoked' where person_id=$1",
      [SEED.testAdminPersonId],
    );
    await sendNotifications(deps, async () => {
      throw new Error("Must not send");
    });
    expect((await db.query("select state from notification"))[0]!.state).toBe(
      "canceled",
    );
  });
  it("RLS: таблицы VS-5 закрыты от прямого REST-доступа", async () => {
    const rows = await getDb().query<
      { tablename: string; rowsecurity: boolean; readable: boolean }
    >(
      "select tablename,rowsecurity,has_table_privilege('authenticated','public.'||tablename,'select') as readable from pg_tables where schemaname='public' and tablename=any($1::text[])",
      [[
        "notification_pref",
        "notification_followup",
        "notification_digest_item",
        "notification_digest_run",
      ]],
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.rowsecurity).toBe(true);
      expect(row.readable).toBe(false);
    }
  });
});

describeWithDb("VS-5 регрессии проверки", (getDb) => {
  async function premises(db: ReturnType<typeof getDb>) {
    const [p] = await db.query<{ id: string }>(
      "insert into premises(building_id,kind,number,is_test) values ($1,'apartment','VS5-TEST',true) returning id",
      [SEED.building1],
    );
    await db.query(
      "insert into connection(person_id,premises_id,role,basis,status) values ($1,$2,'owner','ownership','active')",
      [SEED.testExecutorPersonId, p!.id],
    );
    return p!.id;
  }
  it("NTF-03: создание и отправка черновика соблюдают request.status=off", async () => {
    const db = getDb(),
      deps = { db, audit: new SqlAuditRepo() },
      personId = SEED.testExecutorPersonId;
    const premisesId = await premises(db),
      actor = (await recipientActor(db, personId))!;
    await setPreference(deps, actor, "request.status", "off");
    const { createRequest, transitionRequest } = await import(
      "../../src/domains/requests/service.ts"
    );
    const input = {
      text: "Тестовый вопрос",
      kind: "question",
      source: "bot",
      premises_id: premisesId,
    };
    await createRequest(deps, actor, input, "direct");
    const draft = await createRequest(deps, actor, {
      ...input,
      as_draft: true,
    });
    await transitionRequest(deps, actor, String(draft.id), {
      action: "submit",
      expected_version: draft.version,
    }, "submit");
    const rows = await db.query<{ type: string }>(
      "select payload->>'type' as type from outbox where event_type='notification.requested' and payload->>'personId'=$1",
      [personId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type === "request.status")).toBe(true);
    await dispatchNotices(deps);
    expect(
      await db.query(
        "select id from notification where recipient_person_id=$1",
        [personId],
      ),
    ).toHaveLength(0);
  });
  it("Анкеты: отзыв области перед dispatch и собственности перед send исключает доставку", async () => {
    const db = getDb(),
      deps = { db, audit: new SqlAuditRepo() },
      premisesId = await premises(db);
    await db.query(
      "with a as (insert into staff_assignment(person_id,role) values ($1,'administrator') returning id) insert into staff_scope(assignment_id,building_id) select id,$2 from a",
      [SEED.testAdminPersonId, SEED.building1],
    );
    await enqueueNotice(db, {
      personId: SEED.testAdminPersonId,
      key: "review",
      text: "Анкета",
      registrationAccess: { premisesId, role: "administrator" },
    });
    await db.query(
      "delete from staff_scope where assignment_id in (select id from staff_assignment where person_id=$1)",
      [SEED.testAdminPersonId],
    );
    await dispatchNotices(deps);
    expect(await db.query("select id from notification")).toHaveLength(0);
    await enqueueNotice(db, {
      personId: SEED.testExecutorPersonId,
      key: "owner",
      text: "Анкета",
      registrationAccess: { premisesId, role: "owner" },
    });
    await dispatchNotices(deps);
    await db.query(
      "update connection set status='revoked' where person_id=$1",
      [SEED.testExecutorPersonId],
    );
    await sendNotifications(deps, async () => {
      throw new Error("Must not send");
    });
    expect(
      (await db.query(
        "select state from notification where dedup_key='owner'",
      ))[0]!.state,
    ).toBe("canceled");
  });
  it("Исчерпанный dispatch виден в журнале и создаёт одну задачу контакта", async () => {
    const db = getDb(), deps = { db, audit: new SqlAuditRepo() };
    await db.query(
      "insert into outbox(event_type,payload,dedup_key,attempts) values ('notification.requested',$1::text::jsonb,'broken',4)",
      [JSON.stringify({
        personId: SEED.testExecutorPersonId,
        key: "broken",
        text: null,
        type: "request.required",
        buildingIds: [SEED.building1],
      })],
    );
    await dispatchNotices(deps);
    await sendNotifications(deps, async () => {
      throw new Error("Must not send");
    });
    await dispatchNotices(deps);
    await sendNotifications(deps, async () => {});
    expect(
      (await db.query(
        "select state,last_error from notification where dedup_key='broken'",
      ))[0],
    ).toMatchObject({ state: "failed", last_error: "DISPATCH_FAILED" });
    expect(await db.query("select id from notification_followup")).toHaveLength(
      1,
    );
  });
  it("Дайджест продолжает 21 элемент при конкурентных тиках без повторов; lease восстанавливается", async () => {
    const db = getDb(),
      deps = { db, audit: new SqlAuditRepo() },
      personId = SEED.testExecutorPersonId;
    await premises(db);
    await db.query(
      "insert into notification_digest_item(recipient_person_id,event_type,dedup_key,text,building_ids,is_test) select $1,'publication','page:'||i,'Новость '||i,array[$2::uuid],true from generate_series(1,21) i",
      [personId, SEED.building1],
    );
    const { sweepDigests } = await import(
      "../../src/domains/notifications/digest.ts"
    );
    const now = new Date("2026-10-17T15:30:00Z");
    await Promise.all([sweepDigests(deps, now), sweepDigests(deps, now)]);
    await sweepDigests(deps, now);
    const rows = await db.query<{ n: number }>(
      "select jsonb_array_length(event_ref->'items') n from notification where event_type='digest'",
    );
    expect(rows.map((r) => r.n).sort((a, b) => a - b)).toEqual([1, 20]);
    expect(await sweepDigests(deps, now)).toBe(0);
    await db.query(
      "update notification set state='sending',attempts=1,next_attempt_at=now()-interval '1 minute'",
    );
    await sendNotifications(deps, async () => {
      throw new Error("Must not send test");
    });
    expect(
      (await db.query("select state from notification")).every((r) =>
        r.state === "sent"
      ),
    ).toBe(true);
  });
});
