import type { DbExecutor } from "../../db/client.ts";

export async function notifyPerson(
  exec: DbExecutor,
  personId: string,
  message: string,
  key: string,
): Promise<void> {
  await exec.query(
    `insert into notification(telegram_user_id,text,dedup_key,recipient_person_id,channel)
    select telegram_user_id,$2,$3,person_id,case when is_test then 'simulator' else 'telegram' end from profile where person_id=$1 and archived_at is null on conflict(dedup_key) do nothing`,
    [personId, message, key],
  );
}
export async function notifyTelegram(
  exec: DbExecutor,
  telegramId: unknown,
  message: string,
  key: string,
): Promise<void> {
  if (!telegramId) return;
  await exec.query(
    "insert into notification(telegram_user_id,text,dedup_key,channel) values ($1,$2,$3,case when exists(select 1 from profile where telegram_user_id=$1 and is_test=true and archived_at is null) then 'simulator' else 'telegram' end) on conflict(dedup_key) do nothing",
    [telegramId, message, key],
  );
}
