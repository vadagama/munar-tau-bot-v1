import { listRequestVisits, updateVisit } from "../domains/tasks/visits.ts";
import { premiseLabels } from "../locales/registry.ts";
import { preview, requestCardText, requestListText } from "./request-text.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { ApiError } from "../errors/api.ts";
import { jsonValue, type Row } from "../domains/registry/validation.ts";
import { actorForTelegram } from "./registration.ts";
import {
  createRequest,
  deleteDraft,
  editRequest,
  getRequest,
  listRequests,
  transitionRequest,
} from "../domains/requests/service.ts";
import {
  addMessage,
  rateRequest,
  shareRequest,
} from "../domains/requests/messages.ts";
const HELP =
  "/visits НОМЕР — визиты; /newrequest — новое обращение / жаңа өтініш; /requests — мои обращения / менің өтініштерім; /request НОМЕР — открыть / ашу; /say НОМЕР текст — сообщение / хабарлама; /confirm НОМЕР ВЕРСИЯ — подтвердить / растау; /return НОМЕР причина — доработка / түзету; /cancelrequest НОМЕР причина; /share НОМЕР ID; /unshare НОМЕР ID; /rate НОМЕР 1–5 комментарий; /appeal НОМЕР причина; /reopen НОМЕР причина. /editrequest — текст черновика / жоба мәтіні; /deletedraft — удалить черновик / жобаны жою. /registration — вернуться к регистрации / тіркелуге оралу.";
export const REQUEST_COMMANDS = [
  "/result", "/visits", "/confirmvisit", "/missedvisit",
  "/newrequest",
  "/editrequest",
  "/deletedraft",
  "/requests",
  "/request",
  "/say",
  "/confirm",
  "/return",
  "/cancelrequest",
  "/share",
  "/unshare",
  "/rate",
  "/appeal",
  "/reopen",
  "/sendrequest",
  "/requestcancel",
];
export async function requestStep(
  deps: RegistryDeps,
  telegramId: string,
  input: string,
  providedActor?: Actor,
  operationId?: string,
): Promise<string> {
  return deps.db.transaction(async (exec) => {
    const d = {
      ...deps,
      db: {
        ...deps.db,
        query: exec.query.bind(exec),
        transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
      },
    };
    const actor = providedActor ?? await actorForTelegram(d, telegramId);
    if (!actor) {
      throw new ApiError(
        "FORBIDDEN",
        "Сначала подтвердите регистрацию / Алдымен тіркелуді растаңыз",
      );
    }
    await exec.query(
      "insert into bot_dialog(telegram_user_id,profile_id) values ($1,$2) on conflict do nothing",
      [telegramId, actor.profile.id],
    );
    const [dialog] = await exec.query<{ state: unknown }>(
      "select state from bot_dialog where telegram_user_id=$1 for update",
      [telegramId],
    );
    const state = jsonValue<Row>(dialog!.state);
    const save = async (reply: string) => {
      await exec.query(
        "update bot_dialog set state=$2::text::jsonb,updated_at=now() where telegram_user_id=$1",
        [telegramId, JSON.stringify(state)],
      );
      return reply;
    };
    const [command, number, ...args] = input.trim().split(/\s+/);
    const opKey = operationId ?? crypto.randomUUID();
    const find = async () => {
      const [r] = await exec.query<{ id: string }>(
        "select id from request where number=$1",
        [number],
      );
      if (!r) throw new ApiError("NOT_FOUND");
      return getRequest(d, actor, r.id);
    };
    if(command==="/result"){
      const r=await find(),snapshot=(r.confirmation as Row|undefined)?.payload as Row|undefined;
      const reports=(snapshot?.task_results as Row[])??[];
      const index=Number(args[0]??1)-1;
      if(!Number.isInteger(index)||index<0)throw new ApiError("VALIDATION_FAILED","Укажите номер отчёта");
      const report=reports[index];
      if(!report)return preview(snapshot?.summary??"Результат ещё не передан",3500);
      return preview(`${r.number}, версия результата ${r.confirmation_version}. Отчёт ${index+1}/${reports.length}: ${report.task_number}, версия ${report.report_version}.\n${report.performed_work}\n${report.result}\nОграничения: ${report.limitations||"нет"}\n/result ${r.number} ${index+2} — следующий отчёт`,3500);
    }
    if (command === "/visits") {
      const r = await find();
      const visits = await listRequestVisits(d,actor,String(r.id));
      state.scenario="requests";state.visit_options=visits;
      return save(visits.map((v,i)=>`${i+1}. ${new Date(String(v.interval_start)).toISOString()} — ${new Date(String(v.interval_end)).toISOString()} (${v.status})`).join("\n")+"\n/confirmvisit НОМЕР_В_СПИСКЕ — согласовать; /missedvisit НОМЕР_В_СПИСКЕ причина — исполнитель не пришёл");
    }
    if (command === "/confirmvisit" || command === "/missedvisit") {
      const visits=(state.visit_options as Row[])??[];const visit=visits[Number(number)-1];
      if(!visit)throw new ApiError("VALIDATION_FAILED","Сначала откройте /visits НОМЕР_ОБРАЩЕНИЯ");
      visits[Number(number)-1]=await updateVisit(d,actor,String(visit.id),{version:visit.version,action:command==="/confirmvisit"?"confirm":"no_show",reason:args.join(" ")},opKey);
      return save(command==="/confirmvisit"?"Визит согласован":"Сообщение о неявке передано администратору для проверки");
    }
    const places = async () =>
      exec.query<Row>(
        `select p.id,p.building_id,p.number,p.kind,b.name,b.code from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id where c.person_id=$1 and c.status='active' and p.status='active' and p.is_test=$2 order by b.code,p.kind,p.number`,
        [actor.person.id, actor.person.isTest],
      );
    const placeMenu = (items: Row[]) =>
      items.slice(0, 20).map((p, i) =>
        `${i + 1}. ${preview(p.name ?? p.code, 50)}, ${
          premiseLabels[String(p.kind)] ?? "помещение"
        } ${preview(p.number, 30)}`
      ).join("\n");
    if (command === "/objects") {
      const items = await places();
      state.place_options = items;
      return save(
        `${
          placeMenu(items) ||
          "Подтверждённых помещений нет / Расталған үй-жай жоқ"
        }\n/newrequest`,
      );
    }
    if (command === "/deletedraft") {
      const [draft] = await exec.query<{ id: string }>(
        "select id from request where author_person_id=$1 and state='draft'",
        [actor.person.id],
      );
      if (draft) await deleteDraft(d, actor, draft.id);
      delete state.draft_id;
      delete state.request_id;
      state.step = "";
      return save("Личный черновик удалён / Жеке жоба жойылды. /newrequest");
    }
    if (command === "/newrequest" || command === "/editrequest") {
      const [draft] = await exec.query<Row>(
        "select * from request where author_person_id=$1 and state='draft'",
        [actor.person.id],
      );
      state.scenario = "requests";
      delete state.request_id;
      if (draft) {
        state.draft_id = draft.id;
        state.premises_id = draft.premises_id;
        state.building_id = draft.building_id;
        state.location_text = draft.location_text;
        state.step = command === "/editrequest" ? "description" : "verify";
        return save(
          command === "/editrequest"
            ? "Введите новый текст черновика / Жобаның жаңа мәтінін енгізіңіз"
            : `Сохранённый черновик / Сақталған жоба:\n${
              preview(draft.description, 1200)
            }\n/sendrequest — отправить / жіберу; /editrequest — изменить текст / мәтінді өзгерту; /deletedraft — удалить / жою.`,
        );
      }
      delete state.draft_id;
      state.step = "place";
      const items = await places();
      state.place_options = items;
      return save(
        `Выберите номер своего помещения / Үй-жайыңыздың нөмірін таңдаңыз:\n${
          placeMenu(items)
        }\nОбщее имущество: дом КОД описание места; территория описание места. / Ортақ мүлік: үй КОД орын сипаттамасы; аумақ орын сипаттамасы. Черновик сохраняется до отправки. /requestcancel — назад / артқа.`,
      );
    }
    if (command === "/requestcancel" || command === "/registration") {
      for (const k of Object.keys(state)) delete state[k];
      return save(
        "Диалог приостановлен, черновик сохранён. / Диалог тоқтатылды, жоба сақталды. /register /requests",
      );
    }
    if (command === "/requests") {
      const tokens = [number, ...args].filter((t): t is string => !!t);
      const pageToken = tokens.find((t) => /^page:\d+$/.test(t));
      const page = pageToken ? Number(pageToken.slice(5)) : 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
        throw new ApiError("VALIDATION_FAILED", "Некорректная страница");
      }
      const rows = await listRequests(d, actor, {
        cursor: btoa(String((page - 1) * 10)),
        search: tokens.filter((t) => t !== pageToken).join(" ") || undefined,
      });
      state.scenario = "requests";
      delete state.request_id;
      delete state.draft_id;
      delete state.step;
      return save(requestListText(rows, actor.person.id, page, HELP));
    }
    if (command === "/request") {
      const row = await find();
      state.scenario = "requests";
      state.request_id = row.id;
      delete state.draft_id;
      delete state.step;
      return save(requestCardText(row, HELP));
    }
    if (command === "/say") {
      const row = await find();
      await addMessage(d, actor, String(row.id), {
        text: args.join(" "),
        channel: "resident",
        source: "bot",
      }, opKey);
      return "Сообщение сохранено / Хабарлама сақталды";
    }
    if (command === "/share" || command === "/unshare") {
      const row = await find();
      await shareRequest(
        d,
        actor,
        String(row.id),
        args[0] ?? "",
        command === "/unshare",
      );
      return "Доступ изменён / Қолжетімділік өзгертілді";
    }
    if (command === "/rate") {
      const row = await find();
      await rateRequest(d, actor, String(row.id), {
        value: Number(args[0]),
        comment: args.slice(1).join(" "),
      });
      return "Оценка сохранена / Баға сақталды";
    }
    const actions: Record<string, string> = {
      "/confirm": "confirm_result",
      "/return": "return_result",
      "/cancelrequest": "cancel_request",
      "/appeal": "appeal_reject",
      "/reopen": "reopen",
    };
    if (command && actions[command]) {
      const row = await find();
      await transitionRequest(d, actor, String(row.id), {
        action: actions[command],
        expected_version: row.version,
        reason: args.join(" "),
        payload: {
          confirmation_version: command === "/confirm"
            ? Number(args[0])
            : row.confirmation_version,
        },
      });
      return "Решение сохранено / Шешім сақталды";
    }
    if (command === "/sendrequest" && state.draft_id) {
      const row = await getRequest(d, actor, String(state.draft_id));
      const sent = await transitionRequest(d, actor, String(row.id), {
        action: "submit",
        expected_version: row.version,
      }, opKey);
      delete state.draft_id;
      state.request_id = sent.id;
      state.step = "";
      return save(
        `${sent.number}: зарегистрировано / тіркелді. Первый ответ / Алғашқы жауап: ${
          new Date(String(sent.first_response_due_at)).toLocaleString("ru-RU",{timeZone:"Asia/Almaty"})
        }. Начало обработки / Өңдеудің басталуы: ${new Date(String(sent.first_response_start_at)).toLocaleString("ru-RU",{timeZone:"Asia/Almaty"})} (Алматы). Вне графика немедленной обработки нет / Жұмыс уақытынан тыс дереу өңдеу жоқ. При непосредственной угрозе жизни звоните 112 / Тікелей қауіп кезінде 112.\n${HELP}`,
      );
    }
    if (state.step === "place") {
      if (command === "дом" || command === "үй") {
        if (!number || !args.join(" ").trim()) {
          return "Укажите код дома и место: дом 1 подъезд 2 / Үй коды мен орнын көрсетіңіз: үй 1 кіреберіс 2";
        }
        const [building] = await exec.query<{ id: string }>(
          "select id from building where id::text=$1 or (kind='house' and code=$1) limit 1",
          [number],
        );
        if (!building) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "Дом не найден / Үй табылмады",
          );
        }
        state.building_id = building.id;
        state.location_text = args.join(" ");
        state.premises_id = null;
      } else if (command === "территория" || command === "аумақ") {
        if (!number) {
          return "Опишите место на территории / Аумақтағы орынды сипаттаңыз";
        }
        state.building_id = null;
        state.location_text = [number, ...args].join(" ");
        state.premises_id = null;
      } else {
        const options = (state.place_options ?? []) as Row[];
        const selected = options[Number(input.trim()) - 1];
        if (
          !selected &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            .test(input.trim())
        ) return "Выберите номер из списка / Тізімнен нөмір таңдаңыз. /objects";
        state.premises_id = selected?.id ?? input.trim();
        state.building_id = selected?.building_id ?? null;
        state.location_text = null;
      }
      state.step = "description";
      return save(
        "Опишите проблему своими словами / Мәселені сипаттаңыз. Категория не нужна. / Санат қажет емес.",
      );
    }
    if (state.step === "description") {
      const inputRow = {
        text: input,
        premises_id: state.premises_id,
        building_id: state.building_id,
        location_text: state.location_text,
        kind: "request",
        source: "bot",
        as_draft: true,
      };
      const [draft] = await exec.query<{ id: string; version: number }>(
        "select id,version from request where author_person_id=$1 and state='draft'",
        [actor.person.id],
      );
      const row = draft
        ? await editRequest(d, actor, draft.id, {
          ...inputRow,
          expected_version: draft.version,
        })
        : await createRequest(d, actor, inputRow);
      state.draft_id = row.id;
      state.step = "verify";
      return save(
        `Проверьте / Тексеріңіз:\n${
          preview(input, 1200)
        }\nПолный текст сохранён / Толық мәтін сақталды.\nДобавьте файлы (необязательно), затем /sendrequest. При сбое файла обращение можно отправить. / Файл қосыңыз (міндетті емес), содан кейін /sendrequest. /requestcancel — сохранить черновик.`,
      );
    }
    if (state.draft_id) {
      return save(
        "Черновик сохранён / Жоба сақталды. Добавьте файлы или /sendrequest. /requestcancel — выйти без удаления.",
      );
    }
    return HELP;
  });
}
