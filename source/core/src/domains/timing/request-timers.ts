import {checkTimerContract} from "./contracts.ts";
import { adminCheck, authorReminder } from "../../locales/notifications.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { inform, informManagers } from "../requests/service.ts";
import type { RequestRow } from "../requests/access.ts";
export { startConfirmationTimers } from "../requests/timers.ts";
export async function sweepConfirmationTimers(
  deps: RegistryDeps,
  now = new Date(),
  deadline = Date.now() + 45000,
) {
  return deps.db.transaction(async (exec) => {
    const timers = await exec.query<
      { id: string; rule_version_id:string; entity_id: string; stage: string }
    >(
      `select t.id,t.rule_version_id,t.entity_id,t.stage from timer t join request r on r.id=t.entity_id where t.state='pending' and t.due_at<=$1 and (t.stage like 'request_author_reminder:%' or t.stage like 'request_admin_check:%') order by t.due_at for update of t,r skip locked limit 100`,
      [now.toISOString()],
    );
    let count = 0;
    for (const t of timers) {
      if (Date.now() >= deadline) break;
      await checkTimerContract(exec,t.rule_version_id,t.stage.startsWith("request_author_reminder:") ? "author_reminder" : "request_admin_close_wait");
      const [r] = await exec.query<RequestRow>(
        "select * from request where id=$1",
        [t.entity_id],
      );
      const current = r?.state === "awaiting_confirmation" &&
        r.confirmation_version === Number(t.stage.split(":")[1]);
      if (current) {
        if (t.stage.startsWith("request_author_reminder:")) {
          await inform(exec, r!, authorReminder(r!.number), `timer:${t.id}`);
        } else {await informManagers(
            exec,
            r!,
            adminCheck(r!.number),
            `timer:${t.id}`,
          );}
      }
      await exec.query(
        "update timer set state=$2,fired_at=case when $2='fired' then $3::timestamptz else null end,canceled_at=case when $2='canceled' then $3::timestamptz else null end where id=$1",
        [t.id, current ? "fired" : "canceled", now.toISOString()],
      );
      count++;
    }
    return count;
  });
}
