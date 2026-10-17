import { informManagers } from "./service.ts";
import type { RequestRow } from "./access.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { notifyPerson } from "../registrations/notifications.ts";
/** Первый ответ: только напоминание. Молчание никогда не меняет состояние. */
export async function sweepRequests(
  deps: RegistryDeps,
  deadline = Date.now() + 45000,
): Promise<number> {
  return deps.db.transaction(async (exec) => {
    const timers = await exec.query<
      {
        id: string;
        entity_id: string;
        assigned_admin_person_id: string | null;
        number: string;
      }
    >(`select t.id,t.entity_id,r.assigned_admin_person_id,r.number from timer t join request r on r.id=t.entity_id where t.stage='request_first_response' and t.state='pending' and t.due_at<=now() order by t.due_at for update of t skip locked limit 10`);
    let count = 0;
    for (const timer of timers) {
      if (Date.now() >= deadline) break;
      await exec.query(
        "update timer set state='fired',fired_at=now() where id=$1",
        [timer.id],
      );
      const rows = await exec.query(
        "update request set overdue_since=coalesce(overdue_since,first_response_due_at) where id=$1 and first_response_at is null and state not in ('closed','canceled','rejected') returning id",
        [timer.entity_id],
      );
      if (rows.length) {
        const [request] = await exec.query<RequestRow>(
          "select * from request where id=$1",
          [timer.entity_id],
        );
        if (request) {
          await informManagers(
            exec,
            request,
            `${timer.number}: истёк срок первого ответа / алғашқы жауап мерзімі өтті`,
            `timer:${timer.id}`,
          );
        }
      }
      count++;
    }
    const held = await exec.query<
      { id: string; number: string; assigned_admin_person_id: string | null }
    >("select id,number,assigned_admin_person_id from request where state='on_hold' and next_action_at<=now() and next_action_reminded_at is null order by next_action_at for update skip locked limit 10");
    for (const row of held) {
      if (Date.now() >= deadline) break;
      if (row.assigned_admin_person_id) {
        await notifyPerson(
          exec,
          row.assigned_admin_person_id,
          `${row.number}: наступила дата следующего действия / келесі әрекет күні келді`,
          `request:${row.id}:next-action:${Date.now()}`,
        );
      }
      await exec.query(
        "update request set next_action_reminded_at=now() where id=$1",
        [row.id],
      );
      count++;
    }
    return count;
  });
}
