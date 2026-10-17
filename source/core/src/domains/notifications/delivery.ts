import { informTaskManagers } from "../tasks/timing.ts";
import { TASK_SELECT, type TaskRow } from "../tasks/access.ts";
import { deliveryFailed } from "../../locales/notifications.ts";
import { informManagers } from "../requests/service.ts";
import type { RequestRow } from "../requests/access.ts";
import { type DigestItem, digestText } from "./digest.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { jsonValue, type Row } from "../registry/validation.ts";
import {
  noticeAllowed,
  type NoticeOptions,
  preference,
  recipientActor,
} from "./service.ts";
import { type EventType, retryPolicy } from "./policy.ts";
export interface TelegramSender {
  (telegramId: string, text: string): Promise<void>;
}
/** At-least-once: Telegram не поддерживает ключ идемпотентности отправки. */
export async function sendNotifications(
  deps: RegistryDeps,
  send: TelegramSender,
  deadline = Date.now() + 45000,
): Promise<number> {
  // После падения воркера: ограничить попытки, не создавать бесконечный lease-цикл.
  await deps.db.query(
    "update notification set state=case when attempts>=5 then 'failed' else 'queued' end,last_error='DELIVERY_INTERRUPTED',lease_token=null where state='sending' and next_attempt_at<now()",
  );
  let sent = 0;
  for (let i = 0; i < 20 && Date.now() + 1000 < deadline; i++) {
    const token = crypto.randomUUID();
    const row = await deps.db.transaction(async (exec) => {
      const [n] = await exec.query<Row>(
        "select * from notification where state='queued' and next_attempt_at<=now() order by priority,created_at for update skip locked limit 1",
      );
      if (n) {
        await exec.query(
          "update notification set state='sending',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',lease_token=$2 where id=$1",
          [n.id, token],
        );
      }
      return n;
    });
    if (!row) break;
    try {
      if (row.recipient_person_id) {
        const actor = await recipientActor(
          deps.db,
          String(row.recipient_person_id),
        );
        const ref = jsonValue<NoticeOptions & { items?: DigestItem[] }>(
          row.event_ref,
        );
        if (
          !actor || !await noticeAllowed(deps.db, actor, {
            taskId: row.task_id as string | undefined,
            requestId: row.request_id as string | undefined,
            audience: row.audience as
              | "personal"
              | "resident"
              | "staff"
              | "publication",
            isTest: Boolean(row.is_test),
            buildingIds: ref.buildingIds,
            registrationAccess: ref.registrationAccess,
          }) ||
          await preference(
              deps.db,
              actor.person.id,
              row.event_type as EventType,
            ) === "off"
        ) {
          await deps.db.query(
            "update notification set state='canceled',last_error='RECIPIENT_UNAVAILABLE',lease_token=null where id=$1 and lease_token=$2",
            [row.id, token],
          );
          continue;
        }
        if (row.event_type === "digest") {
          const text = await digestText(deps.db, actor, ref.items ?? []);
          if (!text) {
            await deps.db.query(
              "update notification set state='canceled',lease_token=null where id=$1 and lease_token=$2",
              [row.id, token],
            );
            continue;
          }
          row.text = text;
        }
        const [profile] = await deps.db.query<{ telegram_user_id: string }>(
          "select telegram_user_id from profile where id=$1 and archived_at is null",
          [actor.profile.id],
        );
        if (!profile) throw new Error("RECIPIENT_UNAVAILABLE");
        row.telegram_user_id = profile.telegram_user_id;
        if (actor.person.isTest) row.channel = "simulator";
      }
      const [profile] = await deps.db.query<Row>(
        "select is_test from profile where telegram_user_id=$1 and archived_at is null",
        [row.telegram_user_id],
      );
      if (
        row.channel !== "simulator" && !row.is_test && !profile?.is_test &&
        Number(row.telegram_user_id) > 0
      ) {
        await send(String(row.telegram_user_id), String(row.text));
        // Один jobs lease на проект; не более 20 отправок/с, личные перед сводкой.
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await deps.db.query(
        "update notification set state='sent',sent_at=now(),last_error=null,lease_token=null where id=$1 and lease_token=$2",
        [row.id, token],
      );
      sent++;
    } catch (error) {
      const policy = retryPolicy(
        Number(row.attempts) + 1,
        error as { retryAfter?: number; blocked?: boolean },
      );
      await deps.db.query(
        "update notification set state=$2,last_error=$3,next_attempt_at=now()+$4*interval '1 second',lease_token=null where id=$1 and lease_token=$5",
        [
          row.id,
          policy.failed ? "failed" : "queued",
          policy.code,
          policy.delay,
          token,
        ],
      );
    }
  }
  // NTF-02: одна задача контакта на окончательную ошибку, включая прерванные доставки.
  await deps.db.transaction(async (exec) => {
    const created = await exec.query<{ notification_id: string }>(
      `insert into notification_followup(notification_id) select n.id from notification n where n.state='failed' and n.important and not exists(select 1 from notification_followup f where f.notification_id=n.id) order by n.created_at limit 100 on conflict(notification_id) do nothing returning notification_id`,
    );
    for (const item of created) {
      const [task] = await exec.query<TaskRow>(
        `${TASK_SELECT} join notification n on n.task_id=t.id where n.id=$1`,
        [item.notification_id],
      );
      if (task) {
        const message = {ru:`Назначение задания ${task.number} не доставлено. Требуется резервный ответственный.`,kk:`${task.number}: тапсырма тағайындауы жеткізілмеді. Қосалқы жауапты қажет.`};
        await informTaskManagers(
          exec,
          task,
          message,
          `delivery-failed:${item.notification_id}:deputy`,
          "deputy",
        );
        await informTaskManagers(
          exec,
          task,
          message,
          `delivery-failed:${item.notification_id}:chairman`,
          "chairman",
        );
      }
      const [request] = await exec.query<RequestRow>(
        "select r.* from notification n join request r on r.id=n.request_id where n.id=$1",
        [item.notification_id],
      );
      if (request) {
        await informManagers(
          exec,
          request,
          deliveryFailed(request.number),
          `delivery-failed:${item.notification_id}`,
        );
      }
    }
  });
  return sent;
}
