import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { jsonValue } from "../domains/registry/validation.ts";
import { actorForTelegram } from "./registration.ts";
import {
  type FileStorage,
  MAX_FILE_BYTES,
  prepareFile,
  verifyFileHeader,
} from "../domains/requests/files.ts";
import { addMessage } from "../domains/requests/messages.ts";
import { ApiError } from "../errors/api.ts";
import { notifyPerson } from "../domains/registrations/notifications.ts";
/** Webhook фиксирует только метаданные; getFile/загрузка выполняются jobs. */
export async function queueRequestFile(
  deps: RegistryDeps,
  telegramId: string,
  message: Row,
  updateId: unknown,
): Promise<string> {
  const actor = await actorForTelegram(deps, telegramId);
  if (!actor) throw new ApiError("FORBIDDEN");
  const [dialog] = await deps.db.query<{ state: unknown }>(
    "select state from bot_dialog where telegram_user_id=$1",
    [telegramId],
  );
  const state = dialog ? jsonValue<Row>(dialog.state) : {};
  const taskFile = state.scenario === "tasks";
  const requestId = taskFile ? state.task_id : state.draft_id ?? state.request_id;
  if (!requestId) {
    return "Сначала создайте или откройте обращение: /newrequest, /request НОМЕР. / Алдымен өтінішті ашыңыз.";
  }
  const photos = message.photo as Row[] | undefined;
  const photo = photos?.[photos.length - 1];
  const item = (message.document ?? message.video ?? photo) as Row | undefined;
  if (!item || typeof item.file_id !== "string") {
    return "Этот вид файла не поддерживается. Отправьте документом. / Файлды құжат ретінде жіберіңіз.";
  }
  const filename = String(
    item.file_name ?? (photo ? "photo.jpg" : "video.mp4"),
  );
  const mime = String(item.mime_type ?? (photo ? "image/jpeg" : "video/mp4"));
  const f = await prepareFile(deps, actor, {
    owner_type: taskFile ? "task" : "request",
    owner_id: requestId,
    filename,
    size: item.file_size,
    mime,
    bucket: taskFile ? "internal" : "resident",
  });
  if (!taskFile && !state.draft_id) {
    await addMessage(deps, actor, String(requestId), {
      text: typeof message.caption === "string" ? message.caption : "",
      attachments: [f.attachment_id],
      channel: "resident",
      source: "bot",
    }, `media:${updateId}`);
  }
  await deps.db.query(
    "insert into request_upload_job(attachment_id,telegram_file_id,person_id) values ($1,$2,$3) on conflict do nothing",
    [f.attachment_id, item.file_id, actor.person.id],
  );
  if (taskFile) return "Файл задания принят в очередь. Дождитесь сообщения о сохранении, затем /taskfiles. / Файл кезекте.";
  return "Файл принят в очередь, пока не сохранён. Обращение можно отправить независимо: /sendrequest. / Файл кезекте, әлі сақталмады.";
}
export async function processRequestUploads(
  deps: RegistryDeps,
  storage: FileStorage,
  token: string,
  deadline = Date.now() + 45000,
): Promise<number> {
  let count = 0;
  while (Date.now() < deadline - 10000 && count < 3) {
    const job = await deps.db.transaction(async (exec) => {
      const [row] = await exec.query<Row>(
        `select j.*,a.bucket,a.storage_path,a.size_bytes,a.mime,a.request_id,a.filename from request_upload_job j join attachment a on a.id=j.attachment_id
    where (j.state='queued' or (j.state='processing' and j.lease_until<now())) and j.attempts<3 order by j.created_at for update of j skip locked limit 1`,
      );
      if (!row) return null;
      const [claimed] = await exec.query<{ attempts: number }>(
        "update request_upload_job set state='processing',attempts=attempts+1,lease_until=now()+interval '60 seconds' where attachment_id=$1 returning attempts",
        [row.attachment_id],
      );
      return Object.assign(row, { attempts: claimed!.attempts });
    });
    if (!job) break;
    count++;
    try {
      const metadata = await fetch(
        `https://api.telegram.org/bot${token}/getFile`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_id: job.telegram_file_id }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const data = await metadata.json();
      if (
        !metadata.ok || !data.ok ||
        typeof data.result?.file_path !== "string" ||
        Number(data.result.file_size) > MAX_FILE_BYTES
      ) throw new Error("FILE_TRANSFER_FAILED");
      const path = data.result.file_path as string;
      if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes("..")) {
        throw new Error("FILE_TRANSFER_FAILED");
      }
      const response = await fetch(
        `https://api.telegram.org/file/bot${token}/${path}`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!response.ok) throw new Error("FILE_TRANSFER_FAILED");
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.length;
          if (total > MAX_FILE_BYTES) throw new Error("FILE_TRANSFER_FAILED");
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
      }
      if (total !== job.size_bytes) throw new Error("FILE_TRANSFER_FAILED");
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      verifyFileHeader(String(job.filename), bytes);
      // Повтор после потери ответа проверяет уже сохранённый объект, не переписывает файл.
      let existing = false;
      try {
        const info = await storage.info(
          String(job.bucket),
          String(job.storage_path),
        );
        existing = info.size === total && info.mime === job.mime;
      } catch { /* объект ещё не загружен */ }
      if (!existing) {
        await storage.put(
          String(job.bucket),
          String(job.storage_path),
          bytes,
          String(job.mime),
        );
      }
      const info = await storage.info(
        String(job.bucket),
        String(job.storage_path),
      );
      if (info.size !== total || info.mime !== job.mime) {
        throw new Error("FILE_TRANSFER_FAILED");
      }
      await deps.db.transaction(async (exec) => {
        const claimed = await exec.query(
          "update request_upload_job set state='complete',lease_until=null where attachment_id=$1 and state='processing' and attempts=$2 returning attachment_id",
          [job.attachment_id, job.attempts],
        );
        if (!claimed.length) return;
        await exec.query(
          "update attachment set status='complete' where id=$1",
          [job.attachment_id],
        );
        await notifyPerson(
          exec,
          String(job.person_id),
          "Файл сохранён / Файл сақталды",
          `file:${job.attachment_id}:complete`,
        );
      });
    } catch {
      // Ответы Telegram и URLs с токеном в журнал/ошибки не записываются.
      await deps.db.transaction(async (exec) => {
        const claimed = await exec.query(
          "update request_upload_job set state=case when attempts>=3 then 'failed' else 'queued' end,last_error='FILE_TRANSFER_FAILED',lease_until=null where attachment_id=$1 and state='processing' and attempts=$2 returning attachment_id",
          [job.attachment_id, job.attempts],
        );
        if (claimed.length && Number(job.attempts) >= 3) {
          await notifyPerson(
            exec,
            String(job.person_id),
            "Файл не сохранён: повторите загрузку или выберите другой файл. Текст обращения сохранён. / Файл сақталмады, қайта жүктеңіз.",
            `file:${job.attachment_id}:failed`,
          );
        }
      });
    }
  }
  return count;
}
