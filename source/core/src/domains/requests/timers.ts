import type { DbExecutor } from "../../db/client.ts";
import { startTimer } from "../registry/time.ts";
/** Версия результата — часть ключа таймера: доработка не оживляет старый отчёт. */
export async function startConfirmationTimers(
  exec: DbExecutor,
  id: string,
  version: number,
) {
  await startTimer(
    exec,
    "author_reminder",
    id,
    `request_author_reminder:${version}`,
  );
  await startTimer(
    exec,
    "request_admin_close_wait",
    id,
    `request_admin_check:${version}`,
  );
}
