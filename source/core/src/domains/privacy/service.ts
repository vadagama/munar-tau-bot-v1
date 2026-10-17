/**
 * Приватность (PRV-02): запрос на удаление профиля/отзыв согласия подаётся
 * жителем, решение принимает администратор самостоятельно (позже — кабинет).
 * Необязательные рассылки прекращаются сразу; история операций остаётся
 * в append-only audit_log. Модель данных — LLD-02 §2.9.
 */
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
import { reviewers } from "../registrations/routing.ts";
import { notifyPerson } from "../registrations/notifications.ts";

export type PrivacyKind = "delete_profile" | "withdraw_consent" | "data_export";

const KIND_TEXT: Record<PrivacyKind, { ru: string; kk: string }> = {
  delete_profile: { ru: "удаление анкеты и данных", kk: "өтінім мен деректерді жою" },
  withdraw_consent: { ru: "отзыв согласия", kk: "келісімді қайтару" },
  data_export: { ru: "запрос своих данных", kk: "деректерін сұрау" },
};

/** Необязательные рассылки (policy.ts), отключаемые сразу по PRV-02. */
const OPTIONAL_EVENT_TYPES = ["publication", "work.report", "request.status"];

export async function submitPrivacyRequest(
  deps: RegistryDeps,
  actor: Actor,
  input: { kind: PrivacyKind },
): Promise<Row> {
  if (!can(actor, "privacy.request").allow) throw new ApiError("FORBIDDEN");
  const kind = input.kind;
  return deps.db.transaction(async (exec) => {
    const [open] = await exec.query<Row>(
      "select id from privacy_request where person_id=$1 and kind=$2 and state in ('received','reviewing') limit 1",
      [actor.person.id, kind],
    );
    if (open) {
      throw new ApiError(
        "INVALID_TRANSITION",
        "Такой запрос уже подан и ожидает решения администратора",
      );
    }
    const [row] = await exec.query<Row>(
      "insert into privacy_request(person_id,kind) values ($1,$2) returning *",
      [actor.person.id, kind],
    );
    // PRV-02: необязательные рассылки прекращаются сразу, до решения администратора.
    for (const type of OPTIONAL_EVENT_TYPES) {
      await exec.query(
        "insert into notification_pref(person_id,event_type,mode) values ($1,$2,'off') on conflict (person_id,event_type) do update set mode='off',updated_at=now()",
        [actor.person.id, type],
      );
    }
    // Уведомляем администраторов зданий жителя; нет администратора — заместителя,
    // далее председателя. Нет активных связей — председателей всего ОСИ.
    const buildings = (
      await exec.query<{ building_id: string }>(
        "select distinct p.building_id from connection c join premises p on p.id=c.premises_id where c.person_id=$1 and c.status='active'",
        [actor.person.id],
      )
    ).map((r) => String(r.building_id));
    const notified = new Set<string>();
    for (const building of buildings.length ? buildings : [null]) {
      let staff = building
        ? await reviewers(exec, building, "administrator", actor.person.isTest)
        : [];
      if (!staff.length && building) {
        staff = await reviewers(exec, building, "deputy", actor.person.isTest);
      }
      if (!staff.length) {
        staff = await reviewers(exec, building ?? "", "chairman", actor.person.isTest);
      }
      for (const person of staff) {
        if (notified.has(person)) continue;
        notified.add(person);
        await notifyPerson(
          exec,
          person,
          {
            ru: `Запрос (${KIND_TEXT[kind].ru}): ${actor.person.fullName}. Рассмотрите в кабинете — privacy_request.`,
            kk: `Сұрау (${KIND_TEXT[kind].kk}): ${actor.person.fullName}. Кабинетте қарастырыңыз — privacy_request.`,
          },
          `${row!.id}:${person}`,
          { bot: "worker", buildingIds: building ? [building] : [], isTest: actor.person.isTest },
        );
      }
    }
    await recordAudit(
      deps,
      exec,
      actor,
      "privacy.request",
      "privacy_request",
      String(row!.id),
      buildings,
      null,
      { kind, state: "received" },
    );
    return row!;
  });
}
