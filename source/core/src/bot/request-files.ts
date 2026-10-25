import { lockAudience } from "../domains/registry/audience-lock.ts";
import { initiativeUploadActor,advanceInitiativePhotos } from "../domains/initiatives/files.ts";
import { loadDialog, saveDialog } from "./dialog.ts";
import { templateNotice } from "../templates/notice.ts";
import { t as templateText } from "../templates/store.ts";
import { messageButton } from "../templates/message.ts";
import { type BotReply, btn } from "./keyboard.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { actorForPerson, actorForTelegram } from "./registration.ts";
import { requestCardText } from "./request-text.ts";
import { getRequest } from "../domains/requests/service.ts";
import type { DbExecutor } from "../db/client.ts";
import type { BotKind } from "./bots.ts";
import {
  type FileStorage,
  MAX_FILE_BYTES,
  prepareFile,
  verifyFileHeader,
} from "../domains/requests/files.ts";
import { addMessage } from "../domains/requests/messages.ts";
import { ApiError } from "../errors/api.ts";
import { notifyPerson } from "../domains/registrations/notifications.ts";
import { type Lang } from "./text.ts";
/** Webhook фиксирует только метаданные; getFile/загрузка выполняются jobs. */
export async function queueRequestFile(
  deps: RegistryDeps,
  telegramId: string,
  message: Row,
  updateId: unknown,
  bot: BotKind = "resident",
): Promise<BotReply> {
  const actor = await actorForTelegram(deps, telegramId);
  if (!actor) throw new ApiError("FORBIDDEN");
  const L: Lang = actor.profile.language ?? "ru";
  const state = await loadDialog(deps.db, telegramId, bot, actor.profile.id, actor.emulation?.sessionId ?? null);
  const textForm=(state.input_form??state.visit_form??state.visit_context??state.share_form) as Row|undefined;
  // Переписка по открытому обращению принимает медиа: скрепка уходит
  // вложением сообщения, а не отказом «сейчас только текст».
  const sayForm = bot === "resident" && !!state.input_form && textForm === state.input_form &&
    String((state.input_form as Row).command) === "/say";
  if(textForm && !sayForm && (bot==='resident'||textForm.command!=='/problem')) return {text:templateText(deps.templates,L,'bot.text_only'),buttons:[[btn(messageButton(deps.templates,L,'bot.controls','back'),String(textForm.cancel_command??textForm.back??`/request ${textForm.request_id}`))]]};
  const taskFile = state.scenario === "tasks";
  const form = state.form as Row | undefined;
  const staffCompose = bot === "worker" && state.scenario === "staff-requests" &&
    form && ["answer", "note"].includes(String(form.action));
  if (bot === "worker" && !taskFile && !staffCompose) {
    return { text: templateText(deps.templates,L,"staff.open_compose"), buttons: [[btn(messageButton(deps.templates,L,"staff.controls","back"),"/staffrequests")]] };
  }
  if (textForm?.command==='/problem' && ((textForm.attachment_ids??[]) as unknown[]).length>=10)throw new ApiError('FILE_LIMIT');
  if (staffCompose && (form!.attachment_ids as unknown[]).length >= 10) throw new ApiError("FILE_LIMIT");
  const requestId = sayForm
    ? String(textForm!.object_id)
    : taskFile
    ? textForm?.command==='/problem'?textForm.object_id:state.task_id
    : state.draft_id ?? state.request_id;
  if (!requestId) {
    // У сотрудника файлы прикрепляются к открытому заданию (ADR-009).
    return bot === "worker"
      ? templateText(deps.templates, L, "requests.otkroyte_zadanie_task_nomer_zatem_otpravte_fayl")
      : templateText(deps.templates, L, "requests.snachala_sozdayte_ili_otkroyte_obraschenie_newrequest_request");
  }
  // Telegram-альбом (скрепка, несколько файлов): публикуется одним сообщением
  // флашем после загрузки, а не пофайлово.
  const mediaGroup = typeof message.media_group_id === "string" && message.media_group_id
    ? String(message.media_group_id)
    : null;
  const residentChat = bot === "resident" && !taskFile && !staffCompose &&
    (!state.draft_id || sayForm);
  const photos = message.photo as Row[] | undefined;
  const photo = photos?.[photos.length - 1];
  const item = (message.document ?? message.video ?? photo) as Row | undefined;
  if (!item || typeof item.file_id !== "string") {
    return templateText(deps.templates, L, "requests.etot_vid_fayla_ne_podderzhivaetsya_otpravte_dokumentom");
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
    bucket: taskFile ? "internal" : staffCompose ? String(form!.channel) : "resident",
  });
  if (residentChat && !mediaGroup) {
    await addMessage(deps, actor, String(requestId), {
      text: typeof message.caption === "string" ? message.caption : "",
      attachments: [f.attachment_id],
      channel: "resident",
      source: "bot",
    }, `media:${updateId}`);
    if (sayForm) {
      delete state.input_form;
      await saveDialog(deps.db, telegramId, bot, state);
    }
  }
  await deps.db.query(
    "insert into request_upload_job(attachment_id,telegram_file_id,person_id,bot,media_group_id,caption) values ($1,$2,$3,$4,$5,$6) on conflict do nothing",
    [
      f.attachment_id,
      item.file_id,
      actor.person.id,
      bot,
      mediaGroup,
      typeof message.caption === "string" ? message.caption : null,
    ],
  );
  if (staffCompose) {
    (form!.attachment_ids as string[]).push(String(f.attachment_id));
    const values = form!.values as Row;
    if (!values.text && typeof message.caption === "string") values.text = message.caption;
    form!.step = (form!.fields as unknown[]).length;
    await saveDialog(deps.db,telegramId,bot,state);
    return { text: templateText(deps.templates,L,"staff.upload_queued"),
      buttons: [[btn(messageButton(deps.templates,L,"staff.controls","next"),`/sr ${state.token} review`)]] };
  }
  if(taskFile&&textForm?.command==='/problem'){
    textForm.attachment_ids=[...((textForm.attachment_ids??[]) as string[]),String(f.attachment_id)];
    textForm.file_names=[...((textForm.file_names??[]) as string[]),filename];
    await saveDialog(deps.db,telegramId,bot,state);
  }
  if (taskFile) {
    return templateText(deps.templates, L, "requests.fayl_zadaniya_prinyat_v_ochered_dozhdites_soobscheniya");
  }
  if (sayForm && mediaGroup) {
    // Первый файл группы ставит альбом в очередь, последующие подтверждаются
    // молча: сообщение соберёт и опубликует флаш после загрузки материалов.
    const [dup] = await deps.db.query<{ attachment_id: string }>(
      "select 1 from request_upload_job where person_id=$1 and media_group_id=$2 and attachment_id<>$3 limit 1",
      [actor.person.id, mediaGroup, f.attachment_id],
    );
    if (dup) return "";
    return {
      text: templateText(deps.templates, L, "message.requests.media_queued"),
      buttons: [[
        btn(
          messageButton(deps.templates, L, "bot.controls", "back"),
          String(textForm?.cancel_command ?? `/request ${requestId}`),
        ),
      ]],
    };
  }
  // Файловый диалог (REQ-03): после принятого медиа — приглашение следующего
  // файла или сохранения запроса; сохранение остаётся асинхронным
  // («Файл сохранён» — из джобы). Старые шаги нормализуются в attachments.
  if (
    ["attachments", "attachments_wait", "attachments_more"].includes(
      String(state.step ?? ""),
    )
  ) {
    state.step = "attachments";
    await saveDialog(deps.db, telegramId, bot, state);
    return {
      text: templateText(deps.templates, L, "message.requests.attachments_more"),
      buttons: [[
        btn(
          messageButton(
            deps.templates,
            L,
            "message.requests.attachments_more",
            "save",
          ),
          "/sendrequest",
        ),
      ]],
    };
  }
  // Открытое обращение жителя: медиа уже опубликовано сообщением — возвращаем
  // обновлённую карточку вместо служебной реплики очереди.
  if (residentChat) {
    return requestCardText(
      await getRequest(deps, actor, String(requestId)),
      L,
      deps.templates,
    );
  }
  return templateText(deps.templates, L, "requests.fayl_prinyat_v_ochered_poka_ne_sohranen");
}

/** Публикует накопленный альбом переписки жителя одним сообщением. */
async function flushMediaGroup(
  deps: RegistryDeps,
  exec: DbExecutor,
  job: Row,
): Promise<void> {
  const personId = String(job.person_id);
  const group = String(job.media_group_id);
  const [pending] = await exec.query<{ n: string }>(
    "select count(*)::text n from request_upload_job where person_id=$1 and media_group_id=$2 and state in ('queued','processing')",
    [personId, group],
  );
  if (Number(pending?.n ?? 0) > 0) return;
  const rows = await exec.query<Row>(
    `select j.attachment_id,j.caption,j.created_at,a.status,a.discarded_at,a.request_id from request_upload_job j join attachment a on a.id=j.attachment_id where j.person_id=$1 and j.media_group_id=$2 order by j.created_at`,
    [personId, group],
  );
  if (!rows.length) return;
  const rest = rows
    .filter((r) => !(r.status === "complete" && !r.discarded_at))
    .map((r) => String(r.attachment_id));
  if (rest.length) {
    await exec.query(
      "update attachment set discarded_at=now() where id=any($1::uuid[]) and owner_type='request'",
      [rest],
    );
  }
  const ids = rows
    .filter((r) => r.status === "complete" && !r.discarded_at)
    .map((r) => String(r.attachment_id));
  if (!ids.length) return;
  const requestId = String(rows[0]!.request_id);
  const caption = rows
    .map((r) => (typeof r.caption === "string" ? r.caption.trim() : ""))
    .find(Boolean) ?? "";
  const db = {
    ...deps.db,
    query: exec.query.bind(exec),
    transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn(exec),
  };
  const chatDeps = { ...deps, db } as RegistryDeps;
  const actor = await actorForPerson(chatDeps, personId);
  if (!actor) return;
  try {
    // Ключ идемпотентности даёт exactly-once при повторном флаше группы.
    await addMessage(chatDeps, actor, requestId, {
      text: caption,
      attachments: ids,
      channel: "resident",
      source: "bot",
    }, `media:group:${group}`);
  } catch {
    // Обращение могло закрыться/быть удалено после отправки материалов;
    // откат транзакции джобы здесь вернул бы уже скачанные файлы в очередь.
  }
}
export async function processRequestUploads(
  deps: RegistryDeps,
  storage: FileStorage,
  botTokens: Record<BotKind, string>,
  deadline = Date.now() + 45000,
): Promise<number> {
  let count = 0;
  while (Date.now() < deadline - 10000 && count < 3) {
    const job = await deps.db.transaction(async (exec) => {
      const [row] = await exec.query<Row>(
        `select j.*,a.bucket,a.storage_path,a.size_bytes,a.mime,a.request_id,a.filename,a.owner_type,a.owner_id from request_upload_job j join attachment a on a.id=j.attachment_id
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
      if(job.owner_type==="initiative")await deps.db.transaction(async exec=>{await lockAudience(exec);await initiativeUploadActor(exec,String(job.attachment_id),String(job.person_id));});
      // Файл скачивается токеном того бота, который его принял: file_id
      // в Telegram привязан к боту-получателю.
      const token = botTokens[(job.bot as BotKind) ?? "resident"];
      if (!token) throw new Error("FILE_TRANSFER_FAILED");
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
        let photo:Awaited<ReturnType<typeof initiativeUploadActor>>|null=null;
        if(job.owner_type==="initiative"){await lockAudience(exec);photo=await initiativeUploadActor(exec,String(job.attachment_id),String(job.person_id));}
        const claimed = await exec.query(
          "update request_upload_job set state='complete',lease_until=null where attachment_id=$1 and state='processing' and attempts=$2 returning attachment_id",
          [job.attachment_id, job.attempts],
        );
        if (!claimed.length) return;
        if(!photo||photo.attachment.status!=="complete"){
          await exec.query("update attachment set status='complete' where id=$1",[job.attachment_id]);
          if(photo)await advanceInitiativePhotos(deps,exec,photo.actor,photo.row,"initiative.photo.complete");
        }
        await notifyPerson(
          exec,
          String(job.person_id),
          templateNotice("notices.bot_request-files_process_request_uploads_101", {}),
          `file:${job.attachment_id}:complete`,
          { bot: (job.bot as BotKind) ?? "resident",...(job.owner_type==="initiative"?{initiativeId:String(job.owner_id)}:{}) },
        );
        if (job.owner_type === "request" && job.media_group_id) {
          await flushMediaGroup(deps, exec, job);
        }
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
            templateNotice("notices.bot_request-files_process_request_uploads_102", {}),
            `file:${job.attachment_id}:failed`,
            { bot: (job.bot as BotKind) ?? "resident",...(job.owner_type==="initiative"?{initiativeId:String(job.owner_id)}:{}) },
          );
          if (job.owner_type === "request" && job.media_group_id) {
            await flushMediaGroup(deps, exec, job);
          }
        }
      });
    }
  }
  return count;
}
