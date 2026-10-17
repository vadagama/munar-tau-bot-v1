import { notificationStep } from "./notifications.ts";
import { queueRequestFile } from "./request-files.ts";
import { requestStep,REQUEST_COMMANDS } from "./requests.ts";
import { jsonValue } from "../domains/registry/validation.ts";
import { ApiError } from "../errors/api.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { registrationStep } from "./registration.ts";
import { notifyTelegram } from "../domains/registrations/notifications.ts";
import type { Row } from "../domains/registry/validation.ts";
export async function processInbound(
  deps: RegistryDeps,
  update: Row,
): Promise<boolean> {
  if (!Number.isSafeInteger(update.update_id))
    throw new ApiError("VALIDATION_FAILED", "Некорректный update_id");
  return deps.db.transaction(async (exec) => {
    const inserted = await exec.query(
      "insert into bot_inbound(update_id,payload) values ($1,$2::text::jsonb) on conflict do nothing returning update_id",
      [update.update_id, JSON.stringify(update)],
    );
    if (!inserted.length) return false;
    const message = update.message as Row | undefined;
    const from = message?.from as Row | undefined,
      chat = message?.chat as Row | undefined;
    if (
      message &&
      from &&
      chat &&
      Number.isSafeInteger(from.id) &&
      from.id === chat.id &&
      chat.type === "private" &&
      (typeof message.text === "string" || message.photo || message.document || message.video)
    ) {
      await exec.query("savepoint bot_scenario");
      let reply: string;
      try {
        const db = {
          ...deps.db,
          query: exec.query.bind(exec),
          transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
        };
        const [dialog]=await exec.query<{state:unknown}>("select state from bot_dialog where telegram_user_id=$1",[from.id]);
        const state=dialog ? jsonValue<Row>(dialog.state):{};
        const command=typeof message.text==="string" ? message.text.split(/\s+/)[0]:"";
        reply = command === "/notifications" ? await notificationStep({...deps,db},String(from.id),String(message.text)) : typeof message.text!=="string" ? await queueRequestFile({...deps,db},String(from.id),message,update.update_id) : REQUEST_COMMANDS.includes(command ?? "") || state.scenario==="requests"
          ? await requestStep({...deps,db},String(from.id),String(message.text),undefined,`telegram:${update.update_id}`)
          : await registrationStep({...deps,db},String(from.id),String(message.text));
      } catch (error) {
        await exec.query("rollback to savepoint bot_scenario");
        if (error instanceof ApiError) reply = error.message;
        else if ((error as { code?: string }).code === "23505")
          reply =
            "Телефон или привязка уже существует. Требуется проверка администратора. / Телефон немесе тіркелгі бар. Әкімшінің тексеруі қажет.";
        else throw error;
      }
      await notifyTelegram(
        exec,
        from.id,
        reply,
        `update:${update.update_id}:reply`,
      );
    }
    await exec.query(
      "update bot_inbound set status='processed',processed_at=now() where update_id=$1",
      [update.update_id],
    );
    return true;
  });
}
