import { ruleContract } from "../timing/contracts.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { jsonValue } from "../registry/validation.ts";
import type { RuleParams } from "../registry/time.ts";
import { digestWindow, type EventType } from "./policy.ts";
import { noticeAllowed, preference, recipientActor } from "./service.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
export interface DigestItem {
  id: string;
  text: string;
  building_ids: string[];
  event_type: EventType;
  is_test: boolean;
  event_ref?: import("./service.ts").NoticeOptions;
}
export async function digestText(
  exec: DbExecutor,
  actor: Actor,
  items: DigestItem[],
): Promise<string | null> {
  const visible: string[] = [];
  for (const item of items) {
    if (
      await preference(exec, actor.person.id, item.event_type) !== "off" &&
      await noticeAllowed(exec, actor, {
        ...jsonValue<import("./service.ts").NoticeOptions>(
          item.event_ref ?? {},
        ),
        audience: "publication",
        buildingIds: item.building_ids,
        isTest: item.is_test,
      })
    ) visible.push(item.text.slice(0, 160));
  }
  return visible.length
    ? `${
      actor.profile.language === "kk" ? "Күндік шолу" : "Ежедневная сводка"
    }\n\n${visible.map((t) => `• ${t}`).join("\n\n")}`
    : null;
}
export async function sweepDigests(
  deps: RegistryDeps,
  now = new Date(),
  deadline = Date.now() + 45000,
): Promise<number> {
  return deps.db.transaction(async (exec) => {
    const [schedule] = await exec.query<{ params: RuleParams }>(
      "select v.params from time_rule r join time_rule_version v on v.rule_id=r.id where r.key='work_schedule' order by v.version desc limit 1",
    );
    if (!schedule) return 0;
    ruleContract("work_schedule", schedule.params);
    const day = digestWindow(now, jsonValue<RuleParams>(schedule.params));
    if (!day) return 0;
    const people = await exec.query<{ recipient_person_id: string }>(
      "select distinct recipient_person_id from notification_digest_item d where consumed_at is null and not exists(select 1 from notification_digest_run r where r.person_id=d.recipient_person_id and r.local_day=$1::date and r.completed_at is not null) order by recipient_person_id limit 20",
      [day],
    );
    let count = 0;
    for (const p of people) {
      if (Date.now() >= deadline) break;
      const claimed = await exec.query<{ cutoff_at: string; pages: number }>(
        "insert into notification_digest_run(person_id,local_day) values ($1,$2) on conflict(person_id,local_day) do update set pages=notification_digest_run.pages+1 where notification_digest_run.completed_at is null returning cutoff_at,pages",
        [p.recipient_person_id, day],
      );
      if (!claimed.length) continue;
      const items = await exec.query<DigestItem>(
        "select * from notification_digest_item where recipient_person_id=$1 and consumed_at is null and created_at<=$2 order by created_at for update limit 20",
        [p.recipient_person_id, claimed[0]!.cutoff_at],
      );
      const actor = await recipientActor(exec, p.recipient_person_id),
        text = actor ? await digestText(exec, actor, items) : null;
      if (actor && text) {
        await exec.query(
          `insert into notification(telegram_user_id,text,dedup_key,recipient_person_id,channel,event_type,event_ref,priority,is_test) select telegram_user_id,$2,$3,person_id,case when is_test then 'simulator' else 'telegram' end,'digest',$4::text::jsonb,2,is_test from profile where id=$1 on conflict(dedup_key) do nothing`,
          [
            actor.profile.id,
            text,
            `digest:${p.recipient_person_id}:${day}:${claimed[0]!.pages}`,
            JSON.stringify({ items }),
          ],
        );
        count++;
      }
      await exec.query(
        "update notification_digest_item set consumed_at=now() where id=any($1::uuid[])",
        [items.map((i) => i.id)],
      );
      await exec.query(
        "update notification_digest_run set completed_at=now() where person_id=$1 and local_day=$2 and not exists(select 1 from notification_digest_item where recipient_person_id=$1 and consumed_at is null and created_at<=$3)",
        [p.recipient_person_id, day, claimed[0]!.cutoff_at],
      );
    }
    return count;
  });
}
