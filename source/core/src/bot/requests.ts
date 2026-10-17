import { BotTemplateError } from "./bot-errors.ts";
import { t as templateText } from "../templates/store.ts";
import { listRequestVisits, updateVisit } from "../domains/tasks/visits.ts";
import { label, premiseLabels } from "../locales/registry.ts";
import { requestActions } from "./help.ts";
import {
  preview,
  requestCardText,
  requestListText,
} from "./request-text.ts";
import { cmd, esc, fmtDate, fmtInterval, numbered } from "./text.ts";
import { visitStateText } from "../locales/tasks.ts";
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
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          templateText(deps.templates, L, "requests.ukazhite_nomer_obrascheniya"),
        );
      }
      const [r] = await exec.query<{ id: string }>(
        // Полный UUID принимается наравне с номером: глубокие ссылки
        // /start req_<uuid> (срез C) открывают карточку тем же кодом.
        "select id from request where number=$1 or id::text=lower($1)",
        [number],
      );
      if (!r) throw new ApiError("NOT_FOUND");
      return getRequest(d, actor, r.id);
    };
    if(command==="/result"){
      const r=await find(),snapshot=(r.confirmation as Row|undefined)?.payload as Row|undefined;
      const reports=(snapshot?.task_results as Row[])??[];
      const index=Number(args[0]??1)-1;
      if(!Number.isInteger(index)||index<0)throw new BotTemplateError("VALIDATION_FAILED",templateText(deps.templates, L, "requests.ukazhite_nomer_otcheta"));
      const report=reports[index];
      if(!report)return preview(templateText(deps.templates, L, "requests.rezultat_esche_ne_peredan"),3500);
      return preview(
        `<b>${esc(r.number)}</b> · ${templateText(deps.templates, L, "requests.otchet")} ${index+1} ${templateText(deps.templates, L, "requests.iz")} ${reports.length} · ${templateText(deps.templates, L, "requests.zadanie")} ${esc(String(report.task_number))}\n${esc(report.performed_work)}\n${esc(report.result)}\n${templateText(deps.templates, L, "requests.ogranicheniya")}: ${(report.limitations ? esc(report.limitations) : templateText(deps.templates, L, "requests.net"))}${index+1<reports.length?`\n${cmd(`/result ${r.number} ${index+2}`)} — ${templateText(deps.templates, L, "requests.sleduyuschiy_otchet")}`:""}`,
        3500,
      );
    }
    if (command === "/visits") {
      const r = await find();
      const visits = await listRequestVisits(d,actor,String(r.id));
      state.scenario="requests";state.visit_options=visits;
      const lines = visits.map((v) =>
        `${fmtInterval(v.interval_start, v.interval_end)} — ${esc(visitStateText(v.status, L))}`
      );
      return save({
        text:
          (lines.length
            ? numbered(lines)
            : templateText(deps.templates, L, "requests.vizitov_net")) +
          `\n${cmd("/missedvisit НОМЕР_ОБРАЩЕНИЯ НОМЕР_В_СПИСКЕ причина")} — ${templateText(deps.templates, L, "requests.ispolnitel_ne_prishel")}`,
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
      if(!visit)throw new BotTemplateError("VALIDATION_FAILED",templateText(deps.templates, L, "requests.snachala_otkroyte_visits_nomer_obrascheniya"));
      visits[Number(number)-1]=await updateVisit(d,actor,String(visit.id),{version:visit.version,action:command==="/confirmvisit"?"confirm":"no_show",reason:args.join(" ")},opKey);
      return save(
        command === "/confirmvisit"
          ? templateText(deps.templates, L, "requests.vizit_soglasovan")
          : templateText(deps.templates, L, "requests.soobschenie_o_neyavke_peredano_administratoru_dlya_proverki"),
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
            (templateText(deps.templates, L, "requests.podtverzhdennyh_pomescheniy_net"))) +
          `\n${templateText(deps.templates, L, "requests.nazhmite_nomer_pomescheniya_ili")} /newrequest`,
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
        templateText(deps.templates, L, "requests.lichnyy_chernovik_udalen_newrequest"),
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
            ? templateText(deps.templates, L, "requests.vvedite_novyy_tekst_chernovika")
            : {
              text:
                `<b>${templateText(deps.templates, L, "requests.sohranennyy_chernovik")}</b>:\n${
                  esc(preview(draft.description, 1200))
                }\n${cmd("/sendrequest")} — ${templateText(deps.templates, L, "requests.otpravit")}; ${cmd("/editrequest")} — ${templateText(deps.templates, L, "requests.izmenit_tekst")}; ${cmd("/deletedraft")} — ${templateText(deps.templates, L, "requests.udalit")}. ${templateText(deps.templates, L, "requests.fayly_prosto_prikrepite_k_sleduyuschemu_soobscheniyu")}`,
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
          `${templateText(deps.templates, L, "requests.vyberite_nomer_svoego_pomescheniya")}\n${
            placeMenu(items)
          }\n${templateText(deps.templates, L, "requests.obschee_imuschestvo_dom_kod_opisanie_mesta_territoriya")} ${templateText(deps.templates, L, "requests.chernovik_sohranyaetsya_do_otpravki")} ${cmd("/requestcancel")} — ${templateText(deps.templates, L, "requests.nazad")}.`,
        // Выбор помещения — главный выбор среза: кнопка равна номеру строки.
        buttons: items.slice(0, 20).map((p, i) => [
          btn(`${preview(p.name ?? p.code, 24)} ${preview(p.number, 12)}`, String(i + 1)),
        ]),
      });
    }
    if (command === "/requestcancel" || command === "/registration") {
      for (const k of Object.keys(state)) delete state[k];
      return save(
        templateText(deps.templates, L, "requests.dialog_priostanovlen_chernovik_sohranen_register_requests"),
      );
    }
    if (command === "/requests") {
      const tokens = [number, ...args].filter((t): t is string => !!t);
      const pageToken = tokens.find((t) => /^page:\d+$/.test(t));
      const page = pageToken ? Number(pageToken.slice(5)) : 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
        throw new BotTemplateError("VALIDATION_FAILED", templateText(deps.templates, L, "requests.nekorrektnaya_stranitsa"));
      }
      const rows = await listRequests(d, actor, {
        cursor: btoa(String((page - 1) * 10)),
        search: tokens.filter((t) => t !== pageToken).join(" ") || undefined,
      });
      state.scenario = "requests";
      delete state.request_id;
      delete state.draft_id;
      delete state.step;
      return save(requestListText(rows, actor.person.id, page, L, deps.templates));
    }
    if (command === "/request") {
      const row = await find();
      state.scenario = "requests";
      state.request_id = row.id;
      delete state.draft_id;
      delete state.step;
      return save(requestCardText(row, L, deps.templates));
    }
    if (command === "/say") {
      const row = await find();
      await addMessage(d, actor, String(row.id), {
        text: args.join(" "),
        channel: "resident",
        source: "bot",
      }, opKey);
      return templateText(deps.templates, L, "requests.soobschenie_sohraneno");
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
      return templateText(deps.templates, L, "requests.dostup_izmenen");
    }
    if (command === "/rate") {
      const row = await find();
      await rateRequest(d, actor, String(row.id), {
        value: Number(args[0]),
        comment: args.slice(1).join(" "),
      });
      return templateText(deps.templates, L, "requests.otsenka_sohranena");
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
      return templateText(deps.templates, L, "requests.reshenie_sohraneno");
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
        `<b>${esc(sent.number)}</b> — ${templateText(deps.templates, L, "requests.zaregistrirovano")}. ${templateText(deps.templates, L, "requests.pervyy_otvet")}: ${
          fmtDate(sent.first_response_due_at)
        }.\n${
          requestActions(sent.state, L, false, deps.templates)
        }\n${
          templateText(deps.templates, L, "requests.ekstrennye_sluzhby_bot_ne_zamenyaet_pri_neposredstvennoy")
        }`,
      );
    }
    if (state.step === "place") {
      if (command === "дом" || command === "үй") {
        if (!number || !args.join(" ").trim()) {
          return templateText(deps.templates, L, "requests.ukazhite_kod_doma_i_mesto_dom_1");
        }
        const [building] = await exec.query<{ id: string }>(
          "select id from building where id::text=$1 or (kind='house' and code=$1) limit 1",
          [number],
        );
        if (!building) {
          throw new BotTemplateError(
            "VALIDATION_FAILED",
            templateText(deps.templates, L, "requests.dom_ne_nayden"),
          );
        }
        state.building_id = building.id;
        state.location_text = args.join(" ");
        state.premises_id = null;
      } else if (command === "территория" || command === "аумақ") {
        if (!number) {
          return templateText(deps.templates, L, "requests.opishite_mesto_na_territorii");
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
          return templateText(deps.templates, L, "requests.vyberite_nomer_iz_spiska_objects");
        }
        state.premises_id = selected?.id ?? input.trim();
        state.building_id = selected?.building_id ?? null;
        state.location_text = null;
      }
      state.step = "description";
      return save(
        templateText(deps.templates, L, "requests.opishite_problemu_svoimi_slovami_kategoriya_ne_nuzhna"),
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
          `${templateText(deps.templates, L, "requests.proverte")}:\n${
            esc(preview(input, 1200))
          }\n${templateText(deps.templates, L, "requests.polnyy_tekst_sohranen")}\n${templateText(deps.templates, L, "requests.dobavte_fayly_neobyazatelno_zatem_sendrequest_pri_sboe")} ${cmd("/requestcancel")} — ${templateText(deps.templates, L, "requests.sohranit_chernovik")}.`,
        buttons: [[btn(L === "kk" ? "Жіберу" : "Отправить", "/sendrequest")]],
      });
    }
    if (state.draft_id) {
      return save(
        templateText(deps.templates, L, "requests.chernovik_sohranen_dobavte_fayly_ili_sendrequest_requestcancel"),
      );
    }
    return registrationHelp(L, deps.templates);
  });
}
