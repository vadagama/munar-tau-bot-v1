import type { DbExecutor } from "../db/client.ts";
import { jsonValue, type Row } from "../domains/registry/validation.ts";
import type { BotKind } from "./bots.ts";

/** Call inside the business transaction: upsert locks this channel only. */
export async function loadDialog(
  exec: DbExecutor,
  telegramId: string,
  bot: BotKind,
  profileId: string | null,
  contextId: string | null = null,
): Promise<Row> {
  await exec.query(
    `insert into bot_dialog_channel(telegram_user_id,profile_id,bot,context_id)
     values ($1,$2,$3,$4) on conflict (bot,telegram_user_id) do update set
     state=case when bot_dialog_channel.profile_id is distinct from excluded.profile_id
       or bot_dialog_channel.context_id is distinct from excluded.context_id
       or bot_dialog_channel.format_version<>1 then '{}'::jsonb else bot_dialog_channel.state end,
     profile_id=excluded.profile_id,context_id=excluded.context_id,format_version=1`,
    [telegramId, profileId, bot, contextId],
  );
  return readDialog(exec, telegramId, bot);
}

export async function readDialog(exec: DbExecutor, telegramId: string, bot: BotKind): Promise<Row> {
  const [row] = await exec.query<{ state: unknown }>(
    "select state from bot_dialog_channel where telegram_user_id=$1 and bot=$2 for update",
    [telegramId, bot],
  );
  return jsonValue<Row>(row?.state ?? {});
}

export async function saveDialog(exec: DbExecutor, telegramId: string, bot: BotKind, state: Row): Promise<void> {
  await exec.query(
    "update bot_dialog_channel set state=$2::text::jsonb,updated_at=now() where telegram_user_id=$1 and bot=$3",
    [telegramId, JSON.stringify(state), bot],
  );
}
