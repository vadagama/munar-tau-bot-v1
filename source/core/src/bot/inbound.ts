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
      "insert into bot_inbound(update_id,payload) values ($1,$2::jsonb) on conflict do nothing returning update_id",
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
      typeof message.text === "string"
    ) {
      await exec.query("savepoint bot_scenario");
      let reply: string;
      try {
        const db = {
          ...deps.db,
          query: exec.query.bind(exec),
          transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
        };
        reply = await registrationStep(
          { ...deps, db },
          String(from.id),
          message.text,
        );
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
