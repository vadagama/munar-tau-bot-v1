import { listRequestVisits, updateVisit } from "../domains/tasks/visits.ts";
import { label, premiseLabels } from "../locales/registry.ts";
import { requestActions } from "./help.ts";
import {
  preview,
  requestCardText,
  requestListText,
} from "./request-text.ts";
import { cmd, esc, fmtDate, fmtInterval, numbered } from "./text.ts";
import { registrationHelp } from "./help.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { ApiError } from "../errors/api.ts";
import { jsonValue, type Row } from "../domains/registry/validation.ts";
import { actorForTelegram } from "./registration.ts";
import { btn, type BotReply } from "./keyboard.ts";
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

/** Полная справка по обращениям — только для /help (в реплики не вклеивается). */
const helpText = (lang: "ru" | "kk") => registrationHelp(lang);

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
): Promise<BotReply> {
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
      throw new ApiError("FORBIDDEN");
    }
    const L = actor.profile.language;
    await exec.query(
      "insert into bot_dialog(telegram_user_id,profile_id) values ($1,$2) on conflict do nothing",
      [telegramId, actor.profile.id],
    );
    const [dialog] = await exec.query<{ state: unknown }>(
      "select state from bot_dialog where telegram_user_id=$1 for update",
      [telegramId],
    );
    const state = jsonValue<Row>(dialog!.state);
    const save = async (reply: BotReply) => {
      await exec.query(
        "update bot_dialog set state=$2::text::jsonb,updated_at=now() where telegram_user_id=$1",
        [telegramId, JSON.stringify(state)],
      );
      return reply;
    };
    const [command, number, ...args] = input.trim().split(/\s+/);
    const opKey = operationId ?? crypto.randomUUID();
    // Номер обязателен: postgres.js отклоняет undefined в параметрах
    // (UNDEFINED_VALUE), а без guard'а команда без номера уводит апдейт в 500
    // и зацикливает повторную доставку Telegram (инцидент 17.10.2026).
    const find = async () => {
      if (!number) {
        throw new ApiError(
          "VALIDATION_FAILED",
          L === "kk"
            ? "Өтініш нөмірін көрсетіңіз"
            : "Укажите номер обращения",
        );
      }
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
      if(!Number.isInteger(index)||index<0)throw new ApiError("VALIDATION_FAILED",L==="kk"?"Есеп нөмірін көрсетіңіз":"Укажите номер отчёта");
      const report=reports[index];
      if(!report)return preview(esc(L==="kk"?"Нәтиже әлі берілмеген":"Результат ещё не передан"),3500);
      return preview(
        `<b>${esc(r.number)}</b> — ${L==="kk"?"нәтиже нұсқасы":"версия результата"} ${r.confirmation_version}. ${L==="kk"?"Есеп":"Отчёт"} ${index+1}/${reports.length}: ${esc(String(report.task_number))}, ${L==="kk"?"нұсқа":"версия"} ${report.report_version}.\n${esc(report.performed_work)}\n${esc(report.result)}\n${L==="kk"?"Шектеулер":"Ограничения"}: ${esc(report.limitations|| (L==="kk"?"жоқ":"нет"))}\n${cmd(`/result ${r.number} ${index+2}`)} — ${L==="kk"?"келесі есеп":"следующий отчёт"}`,
        3500,
      );
    }
    if (command === "/visits") {
      const r = await find();
      const visits = await listRequestVisits(d,actor,String(r.id));
      state.scenario="requests";state.visit_options=visits;
      const lines = visits.map((v) =>
        `${fmtInterval(v.interval_start, v.interval_end)} — ${esc(String(v.status))}`
      );
      return save({
        text:
          (lines.length
            ? numbered(lines)
            : L === "kk" ? "Сапарлар жоқ" : "Визитов нет") +
          `\n${cmd("/confirmvisit НОМЕР_ОБРАЩЕНИЯ НОМЕР_В_СПИСКЕ")} — ${L === "kk" ? "келісу" : "согласовать"}; ${cmd("/missedvisit НОМЕР_ОБРАЩЕНИЯ НОМЕР_В_СПИСКЕ причина")} — ${L === "kk" ? "орындаушы келмеді" : "исполнитель не пришёл"}`,
        // Согласование визита — кнопкой по строке списка.
        buttons: visits.map((v, i) => [
          btn(
            L === "kk" ? `Келісу ${i + 1}` : `Согласовать ${i + 1}`,
            `/confirmvisit ${r.number} ${i + 1}`,
          ),
        ]),
      });
    }
    if (command === "/confirmvisit" || command === "/missedvisit") {
      const visits=(state.visit_options as Row[])??[];const visit=visits[Number(number)-1];
      if(!visit)throw new ApiError("VALIDATION_FAILED",L==="kk"?"Алдымен /visits НОМІР ашыңыз":"Сначала откройте /visits НОМЕР_ОБРАЩЕНИЯ");
      visits[Number(number)-1]=await updateVisit(d,actor,String(visit.id),{version:visit.version,action:command==="/confirmvisit"?"confirm":"no_show",reason:args.join(" ")},opKey);
      return save(
        command === "/confirmvisit"
          ? L === "kk" ? "Сапар келісілді" : "Визит согласован"
          : L === "kk"
            ? "Жоқтық туралы хабарлама әкімшіге берілді"
            : "Сообщение о неявке передано администратору для проверки",
      );
    }
    const places = async () =>
      exec.query<Row>(
        `select p.id,p.building_id,p.number,p.kind,b.name,b.code from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id where c.person_id=$1 and c.status='active' and p.status='active' and p.is_test=$2 order by b.code,p.kind,p.number`,
        [actor.person.id, actor.person.isTest],
      );
    const placeMenu = (items: Row[]) =>
      numbered(items.slice(0, 20).map((p) =>
        `${esc(preview(p.name ?? p.code, 50))}, ${
          esc(label(premiseLabels, p.kind, L, "помещение"))
        } ${esc(preview(p.number, 30))}`
      ));
    if (command === "/objects") {
      const items = await places();
      state.place_options = items;
      // Нажатие кнопки помещения начинает черновик для него: тот же шаг выбора,
      // что и после /newrequest, — иначе кнопка вне диалога черновика не работает.
      state.step = "place";
      return save({
        text:
          (placeMenu(items) ||
            (L === "kk" ? "Расталған үй-жай жоқ" : "Подтверждённых помещений нет")) +
          `\n${L === "kk" ? "Түртіңіз нөмірі немесе" : "Нажмите номер помещения или"} /newrequest`,
        buttons: items.slice(0, 20).map((p, i) => [
          btn(`${preview(p.number, 20)}`, String(i + 1)),
        ]),
      });
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
      return save(
        L === "kk"
          ? "Жеке жоба жойылды. /newrequest"
          : "Личный черновик удалён. /newrequest",
      );
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
            ? L === "kk"
              ? "Жобаның жаңа мәтінін енгізіңіз"
              : "Введите новый текст черновика"
            : {
              text:
                `<b>${L === "kk" ? "Сақталған жоба" : "Сохранённый черновик"}</b>:\n${
                  esc(preview(draft.description, 1200))
                }\n${cmd("/sendrequest")} — ${L === "kk" ? "жіберу" : "отправить"}; ${cmd("/editrequest")} — ${L === "kk" ? "мәтінді өзгерту" : "изменить текст"}; ${cmd("/deletedraft")} — ${L === "kk" ? "жою" : "удалить"}. ${L === "kk" ? "Файлдарды келесі хабарламаға жабыстырыңыз." : "Файлы — просто прикрепите к следующему сообщению."}`,
              buttons: [[
                btn(L === "kk" ? "Жіберу" : "Отправить", "/sendrequest"),
                btn(L === "kk" ? "Жою" : "Удалить", "/deletedraft"),
              ]],
            },
        );
      }
      delete state.draft_id;
      state.step = "place";
      const items = await places();
      state.place_options = items;
      return save({
        text:
          `${L === "kk" ? "Үй-жайыңыздың нөмірін таңдаңыз:" : "Выберите номер своего помещения:"}\n${
            placeMenu(items)
          }\n${L === "kk" ? `Ортақ мүлік: ${cmd("үй КОД орын сипаттамасы")}; аумақ: ${cmd("аумақ орын сипаттамасы")}.` : `Общее имущество: ${cmd("дом КОД описание места")}; территория: ${cmd("территория описание места")}.`} ${L === "kk" ? "Жоба жіберілгенше сақталады." : "Черновик сохраняется до отправки."} ${cmd("/requestcancel")} — ${L === "kk" ? "артқа" : "назад"}.`,
        // Выбор помещения — главный выбор среза: кнопка равна номеру строки.
        buttons: items.slice(0, 20).map((p, i) => [
          btn(`${preview(p.name ?? p.code, 24)} ${preview(p.number, 12)}`, String(i + 1)),
        ]),
      });
    }
    if (command === "/requestcancel" || command === "/registration") {
      for (const k of Object.keys(state)) delete state[k];
      return save(
        L === "kk"
          ? "Диалог тоқтатылды, жоба сақталды. /register /requests"
          : "Диалог приостановлен, черновик сохранён. /register /requests",
      );
    }
    if (command === "/requests") {
      const tokens = [number, ...args].filter((t): t is string => !!t);
      const pageToken = tokens.find((t) => /^page:\d+$/.test(t));
      const page = pageToken ? Number(pageToken.slice(5)) : 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
        throw new ApiError("VALIDATION_FAILED", L === "kk" ? "Бұрыс бет" : "Некорректная страница");
      }
      const rows = await listRequests(d, actor, {
        cursor: btoa(String((page - 1) * 10)),
        search: tokens.filter((t) => t !== pageToken).join(" ") || undefined,
      });
      state.scenario = "requests";
      delete state.request_id;
      delete state.draft_id;
      delete state.step;
      return save(requestListText(rows, actor.person.id, page, L));
    }
    if (command === "/request") {
      const row = await find();
      state.scenario = "requests";
      state.request_id = row.id;
      delete state.draft_id;
      delete state.step;
      return save(requestCardText(row, L));
    }
    if (command === "/say") {
      const row = await find();
      await addMessage(d, actor, String(row.id), {
        text: args.join(" "),
        channel: "resident",
        source: "bot",
      }, opKey);
      return L === "kk" ? "Хабарлама сақталды" : "Сообщение сохранено";
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
      return L === "kk" ? "Қолжетімділік өзгертілді" : "Доступ изменён";
    }
    if (command === "/rate") {
      const row = await find();
      await rateRequest(d, actor, String(row.id), {
        value: Number(args[0]),
        comment: args.slice(1).join(" "),
      });
      return L === "kk" ? "Баға сақталды" : "Оценка сохранена";
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
        action: actions[command]!,
        expected_version: row.version,
        reason: args.join(" "),
        payload: {
          confirmation_version: command === "/confirm"
            ? Number(args[0])
            : row.confirmation_version,
        },
      });
      return L === "kk" ? "Шешім сақталды" : "Решение сохранено";
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
        `<b>${esc(sent.number)}</b> — ${L === "kk" ? "тіркелді" : "зарегистрировано"}. ${L === "kk" ? "Алғашқы жауап" : "Первый ответ"}: ${
          fmtDate(sent.first_response_due_at)
        }. ${L === "kk" ? "Өңдеудің басталуы" : "Начало обработки"}: ${fmtDate(sent.first_response_start_at)} (${L === "kk" ? "Алматы" : "Алматы"}).\n${
          requestActions(sent.state, L)
        }\n${
          L === "kk"
            ? "Жұмыс уақытынан тыс дереу өңдеу жоқ. Тікелей қауіп кезінде 112 нөміріне қоңырау шалыңыз."
            : "Вне графика немедленной обработки нет. При непосредственной угрозе жизни звоните 112."
        }`,
      );
    }
    if (state.step === "place") {
      if (command === "дом" || command === "үй") {
        if (!number || !args.join(" ").trim()) {
          return L === "kk"
            ? "Үй коды мен орнын көрсетіңіз: үй 1 кіреберіс 2"
            : "Укажите код дома и место: дом 1 подъезд 2";
        }
        const [building] = await exec.query<{ id: string }>(
          "select id from building where id::text=$1 or (kind='house' and code=$1) limit 1",
          [number],
        );
        if (!building) {
          throw new ApiError(
            "VALIDATION_FAILED",
            L === "kk" ? "Үй табылмады" : "Дом не найден",
          );
        }
        state.building_id = building.id;
        state.location_text = args.join(" ");
        state.premises_id = null;
      } else if (command === "территория" || command === "аумақ") {
        if (!number) {
          return L === "kk" ? "Аумақтағы орынды сипаттаңыз" : "Опишите место на территории";
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
        ) {
          return L === "kk"
            ? "Тізімнен нөмір таңдаңыз. /objects"
            : "Выберите номер из списка. /objects";
        }
        state.premises_id = selected?.id ?? input.trim();
        state.building_id = selected?.building_id ?? null;
        state.location_text = null;
      }
      state.step = "description";
      return save(
        L === "kk"
          ? "Мәселені сипаттаңыз. Санат қажет емес — мәтін мен фото жеткілікті."
          : "Опишите проблему своими словами. Категория не нужна — достаточно текста и фото.",
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
      return save({
        text:
          `${L === "kk" ? "Тексеріңіз" : "Проверьте"}:\n${
            esc(preview(input, 1200))
          }\n${L === "kk" ? "Толық мәтін сақталды." : "Полный текст сохранён."}\n${L === "kk" ? `Файл қосыңыз (міндетті емес), содан кейін ${cmd("/sendrequest")}. Файл сәтсіз болса, өтінішті жібере аласыз.` : `Добавьте файлы (необязательно), затем ${cmd("/sendrequest")}. При сбое файла обращение можно отправить.`} ${cmd("/requestcancel")} — ${L === "kk" ? "жобаны сақтау" : "сохранить черновик"}.`,
        buttons: [[btn(L === "kk" ? "Жіберу" : "Отправить", "/sendrequest")]],
      });
    }
    if (state.draft_id) {
      return save(
        L === "kk"
          ? `Жоба сақталды. Файл қосыңыз немесе ${cmd("/sendrequest")}. ${cmd("/requestcancel")} — жобаны сақтап шығу.`
          : `Черновик сохранён. Добавьте файлы или ${cmd("/sendrequest")}. ${cmd("/requestcancel")} — выйти без удаления.`,
      );
    }
    return helpText(L);
  });
}
