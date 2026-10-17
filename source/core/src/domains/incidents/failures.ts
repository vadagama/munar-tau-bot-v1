import { templateNotice } from "../../templates/notice.ts";
import type { DbExecutor } from "../../db/client.ts";
import { jsonValue, type Row } from "../registry/validation.ts";
import { enqueueNotice, type NoticeOptions } from "../notifications/service.ts";
/** NTF-02: резерву сообщается о недоставке, принятие сигнала не имитируется. */
export async function emergencyDeliveryFailure(
  exec: DbExecutor,
  notificationId: string,
) {
  const [n] = await exec.query<Row>(
    "select * from notification where id=$1 and event_type='incident'",
    [notificationId],
  );
  if (!n) return;
  const ref = jsonValue<NoticeOptions>(n.event_ref);
  const people = await exec.query<{ person_id: string }>(
    `select distinct d.reserve_person_id as person_id from duty_shift d where d.is_test=$1 and d.starts_at<=now() and d.ends_at>now() and d.building_id=any($2::uuid[])
 union select distinct a.person_id from staff_assignment a join person p on p.id=a.person_id where p.is_test=$1 and p.status='active' and a.status='active' and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now()) and (a.role='chairman' or (a.role in ('administrator','deputy') and exists(select 1 from staff_scope s where s.assignment_id=a.id and s.building_id=any($2::uuid[]))))`,
    [n.is_test, ref.buildingIds ?? []],
  );
  for (const p of people) {
    if (p.person_id !== n.recipient_person_id) {
      await enqueueNotice(exec, {
        personId: p.person_id,
        key: `incident-failed:${notificationId}:${p.person_id}`,
        type: "incident",
        bot: "worker",
        important: false,
        audience: "staff",
        isTest: Boolean(n.is_test),
        buildingIds: ref.buildingIds,
        text: templateNotice("notices.incidents_failures_emergency_delivery_failure_101", {}),
      });
    }
  }
}
