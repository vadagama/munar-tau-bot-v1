import { jsonValue } from "../registry/validation.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { reviewers, initialStage } from "./routing.ts";
import { addRuleHours, type RuleParams } from "../registry/time.ts";
import { notifyPerson, notifyTelegram } from "./notifications.ts";
import type { Row } from "../registry/validation.ts";

export async function sweepRegistrations(
  deps: RegistryDeps,
  now = new Date(),
  deadline = Date.now() + 45000,
): Promise<number> {
  return deps.db.transaction(async (exec) => {
    const timers = await exec.query<Row>(
      `select t.*,v.params from timer t join time_rule_version v on v.id=t.rule_version_id
      where t.state='pending' and t.due_at<=$1 and t.stage not like 'request_%' order by t.due_at for update of t skip locked limit 10`,
      [now.toISOString()],
    );
    let processed = 0;
    for (const timer of timers) {
      if (Date.now() >= deadline) break;
      processed++;
      await exec.query(
        "update timer set state='fired',fired_at=$2 where id=$1",
        [timer.id, now.toISOString()],
      );
      if (timer.stage === "invite") {
        await exec.query(
          "update invite set status='expired' where id=$1 and status='active'",
          [timer.entity_id],
        );
        continue;
      }
      const [row] = await exec.query<Row>(
        `select r.*,p.building_id from registration r join premises p on p.id=r.premises_id where r.id=$1 for update of r`,
        [timer.entity_id],
      );
      if (
        !row ||
        !["pending_review", "need_clarification", "disputed"].includes(
          String(row.state),
        )
      )
        continue;
      let stage = String(row.review_stage);
      if (timer.stage === "dispute:total") {
        await exec.query(
          "update registration set overdue_at=coalesce(overdue_at,$2) where id=$1",
          [row.id, now.toISOString()],
        );
        for (const person of await reviewers(
          exec,
          String(row.building_id),
          "chairman",
          Boolean(row.is_test),
        ))
          await notifyPerson(
            exec,
            person,
            `Спор просрочен / Дау мерзімі өтті: ${row.id}`,
            `${timer.id}:${person}`,
          );
      } else {
        if (stage === "owner")
          stage = await initialStage(
            exec,
            String(row.building_id),
            Boolean(row.is_test),
          );
        else if (stage === "administrator")
          stage = (
            await reviewers(
              exec,
              String(row.building_id),
              "deputy",
              Boolean(row.is_test),
            )
          ).length
            ? "deputy"
            : "chairman";
        else stage = "chairman";
        let due: Date | null = null;
        if (stage !== "chairman") {
          // Эскалации сохраняют версию графика и длительности первоначального таймера.
          const params = jsonValue<RuleParams>(timer.params);
          let versionId = timer.rule_version_id;
          let rule = params;
          if (row.review_stage === "owner") {
            const [version] = await exec.query<Row>(
              "select v.* from time_rule_version v join time_rule r on r.id=v.rule_id where r.key='registration_stage' order by version desc limit 1",
            );
            rule = jsonValue<RuleParams>(version!.params);
            versionId = version!.id;
          }
          due = addRuleHours(now, rule);
          await exec.query(
            "insert into timer(rule_version_id,entity_id,stage,due_at) values ($1,$2,$3,$4) on conflict (entity_id,stage) do update set rule_version_id=excluded.rule_version_id,due_at=excluded.due_at,state='pending',fired_at=null where timer.state<>'pending'",
            [
              versionId,
              row.id,
              `${row.total_due_at ? "dispute:" : ""}${stage}`,
              due.toISOString(),
            ],
          );
        }
        await exec.query(
          "update registration set review_stage=$2,stage_due_at=$3 where id=$1",
          [row.id, stage, due?.toISOString() ?? null],
        );
        for (const person of await reviewers(
          exec,
          String(row.building_id),
          stage,
          Boolean(row.is_test),
        ))
          await notifyPerson(
            exec,
            person,
            `Требуется решение по анкете / Өтінім бойынша шешім қажет: ${row.id}`,
            `${timer.id}:${person}`,
          );
        await notifyTelegram(
          exec,
          row.telegram_user_id,
          "Анкета передана следующему ответственному / Өтінім келесі жауапты қызметкерге берілді",
          `${timer.id}:applicant`,
        );
      }
      await deps.audit.append(exec, {
        actorPersonId: null,
        actorProfileId: null,
        emulationSessionId: null,
        emulatedPersonId: null,
        action: "registration.timer",
        entityType: "registration",
        entityId: String(row.id),
        before: { stage: row.review_stage },
        after: { stage, overdue: timer.stage === "dispute:total" },
        reason: "REG-14",
        scopeBuildings: [String(row.building_id)],
        meta: { timer_id: timer.id },
      });
    }
    return processed;
  });
}
export interface TelegramSender {
  (telegramId: string, text: string): Promise<void>;
}
export async function sendNotifications(
  deps: RegistryDeps,
  send: TelegramSender,
  deadline = Date.now() + 45000,
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < 20 && Date.now() < deadline; i++) {
    const row = await deps.db.transaction(async (exec) => {
      const [row] = await exec.query<Row>(
        "select * from notification where state='queued' and next_attempt_at<=now() order by created_at for update skip locked limit 1",
      );
      if (row)
        await exec.query(
          "update notification set state='sending',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' where id=$1",
          [row.id],
        );
      return row;
    });
    if (!row) break;
    const [profile] = await deps.db.query<Row>(
      "select is_test from profile where telegram_user_id=$1 and archived_at is null",
      [row.telegram_user_id],
    );
    try {
      // Тестовые персоны используют симулятор, реальные сообщения им не отправляются.
      if (
        row.channel !== "simulator" &&
        !profile?.is_test &&
        Number(row.telegram_user_id) > 0
      )
        await send(String(row.telegram_user_id), String(row.text));
      await deps.db.query(
        "update notification set state='sent',sent_at=now(),last_error=null where id=$1",
        [row.id],
      );
      sent++;
    } catch (error) {
      const attempts = Number(row.attempts) + 1;
      const delay = Math.max(
        [60, 300, 900, 3600, 21600][Math.min(attempts - 1, 4)]!,
        Number((error as { retryAfter?: number }).retryAfter) || 0,
      );
      await deps.db.query(
        "update notification set state=$2,last_error=$3,next_attempt_at=now()+$4*interval '1 second' where id=$1",
        [
          row.id,
          attempts >= 5 || (error as { blocked?: boolean }).blocked
            ? "failed"
            : "queued",
          error instanceof Error && /^TELEGRAM_[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "DELIVERY_FAILED",
          delay,
        ],
      );
    }
  }
  await deps.db.query(
    "update notification set state='queued' where state='sending' and next_attempt_at<now()",
  );
  return sent;
}
