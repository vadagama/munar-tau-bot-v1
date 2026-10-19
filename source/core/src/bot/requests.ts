import { message, messageButton, safeBlock } from "../templates/message.ts";
import { BotTemplateError } from "./bot-errors.ts";
import { t as templateText } from "../templates/store.ts";
import { listRequestVisits, updateVisit } from "../domains/tasks/visits.ts";
import { label, premiseLabels } from "../locales/registry.ts";
import { preview, requestCardText, requestListText } from "./request-text.ts";
import { esc, fmtDate, fmtInterval, numbered } from "./text.ts";
import { visitStateText } from "../locales/tasks.ts";
import { registrationHelp } from "./help.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { ApiError } from "../errors/api.ts";
import { jsonValue, type Row } from "../domains/registry/validation.ts";
import { actorForTelegram } from "./registration.ts";
import { type BotReply, btn } from "./keyboard.ts";
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
  "/result",
  "/visits",
  "/confirmvisit",
  "/missedvisit",
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

/** Виды обращения (request_kind): порядок — нумерация в реплике и в кнопках. */
const REQUEST_KINDS = ["request", "question", "complaint"] as const;
/** Текстовые эквиваленты шага вида (без учёта регистра, оба языка). */
const KIND_ALIASES: Record<string, (typeof REQUEST_KINDS)[number]> = {
  "заявка": "request",
  "заявка на работу": "request",
  "жұмысқа өтінім": "request",
  "өтінім": "request",
  "вопрос": "question",
  "сұрақ": "question",
  "жалоба": "complaint",
  "шағым": "complaint",
};
/** Адресат обращения: мои помещения или общее имущество. */
const REQUEST_TARGETS = ["my_places", "common"] as const;
const TARGET_ALIASES: Record<string, (typeof REQUEST_TARGETS)[number]> = {
  "мои помещения": "my_places",
  "мои": "my_places",
  "помещения": "my_places",
  "үй-жайларым": "my_places",
  "менің үй-жайларым": "my_places",
  "общее имущество": "common",
  "общее": "common",
  "имущество": "common",
  "ортақ мүлік": "common",
  "ортақ": "common",
};
/** Подменю общего имущества: в доме или на территории. */
const COMMON_KINDS = ["house", "territory"] as const;
const COMMON_ALIASES: Record<string, (typeof COMMON_KINDS)[number]> = {
  "в доме": "house",
  "дом": "house",
  "доме": "house",
  "үйде": "house",
  "на территории": "territory",
  "территория": "territory",
  "аумақ": "territory",
  "аумақта": "territory",
};
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
          templateText(
            deps.templates,
            L,
            "requests.ukazhite_nomer_obrascheniya",
          ),
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
    if (command === "/result") {
      const r = await find(),
        snapshot = (r.confirmation as Row | undefined)?.payload as
          | Row
          | undefined;
      const reports = (snapshot?.task_results as Row[]) ?? [];
      const index = Number(args[0] ?? 1) - 1;
      if (!Number.isInteger(index) || index < 0) {
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          templateText(deps.templates, L, "requests.ukazhite_nomer_otcheta"),
        );
      }
      const report = reports[index];
      if (!report) {
        return templateText(
          deps.templates,
          L,
          "requests.rezultat_esche_ne_peredan",
        );
      }
      return message(
        deps.templates,
        L,
        index + 1 < reports.length
          ? "message.requests.result.more"
          : "message.requests.result",
        {
          number: r.number,
          index: index + 1,
          total: reports.length,
          task_number: report.task_number,
          work: report.performed_work,
          result: report.result,
          limitations: report.limitations
            ? report.limitations
            : safeBlock(templateText(deps.templates, L, "requests.net")),
          next_index: index + 2,
        },
      );
    }
    if (command === "/visits") {
      const r = await find();
      const visits = await listRequestVisits(d, actor, String(r.id));
      state.scenario = "requests";
      state.visit_options = visits;
      const lines = visits.map((v) =>
        `${fmtInterval(v.interval_start, v.interval_end)} — ${
          esc(visitStateText(v.status, L))
        }`
      );
      return save({
        text: message(deps.templates, L, "message.requests.visits", {
          visits: safeBlock(
            lines.length
              ? numbered(lines)
              : templateText(deps.templates, L, "requests.vizitov_net"),
          ),
        }),
        // Согласование визита — кнопкой по строке списка.
        buttons: visits.map((v, i) => [
          btn(
            messageButton(
              deps.templates,
              L,
              "message.requests.visits",
              "confirm",
              { index: i + 1 },
            ),
            `/confirmvisit ${r.number} ${i + 1}`,
          ),
        ]),
      });
    }
    if (command === "/confirmvisit" || command === "/missedvisit") {
      const visits = (state.visit_options as Row[]) ?? [];
      const visit = visits[Number(number) - 1];
      if (!visit) {
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          templateText(
            deps.templates,
            L,
            "requests.snachala_otkroyte_visits_nomer_obrascheniya",
          ),
        );
      }
      visits[Number(number) - 1] = await updateVisit(
        d,
        actor,
        String(visit.id),
        {
          version: visit.version,
          action: command === "/confirmvisit" ? "confirm" : "no_show",
          reason: args.join(" "),
        },
        opKey,
      );
      return save(
        command === "/confirmvisit"
          ? templateText(deps.templates, L, "requests.vizit_soglasovan")
          : templateText(
            deps.templates,
            L,
            "requests.soobschenie_o_neyavke_peredano_administratoru_dlya_proverki",
          ),
      );
    }
    const places = async () =>
      exec.query<Row>(
        `select p.id,p.building_id,p.number,p.kind,b.name,b.code from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id where c.person_id=$1 and c.status='active' and p.status='active' and p.is_test=$2 order by b.code,p.kind,p.number`,
        [actor.person.id, actor.person.isTest],
      );
    const placeMenu = (items: Row[]) =>
      numbered(
        items.slice(0, 20).map((p) =>
          `${esc(preview(p.name ?? p.code, 50))}, ${
            esc(label(premiseLabels, p.kind, L, "помещение"))
          } ${esc(preview(p.number, 30))}`
        ),
      );
    // Шаг вида (REQ-03): подписи и список — из одного шаблона каталога,
    // кнопка равна номеру строки.
    const kindPrompt = () => ({
      text: message(deps.templates, L, "message.requests.kind", {
        kinds: numbered(
          REQUEST_KINDS.map((k) =>
            messageButton(deps.templates, L, "message.requests.kind", k)
          ),
        ),
      }),
      buttons: REQUEST_KINDS.map((k, i) => [
        btn(
          messageButton(deps.templates, L, "message.requests.kind", k),
          String(i + 1),
        ),
      ]),
    });
    const placePrompt = async () => {
      const items = await places();
      state.place_options = items;
      return {
        text: message(deps.templates, L, "message.requests.choose_place", {
          premises: safeBlock(placeMenu(items)),
        }),
        buttons: items.slice(0, 20).map((p, i) => [
          btn(
            messageButton(
              deps.templates,
              L,
              "message.requests.choose_place",
              "place",
              {
                building: preview(p.name ?? p.code, 24),
                number: preview(p.number, 12),
              },
            ),
            String(i + 1),
          ),
        ]),
      };
    };
    // Шаг адресата (REQ-02): мои помещения или общее имущество.
    const targetPrompt = () => ({
      text: message(deps.templates, L, "message.requests.target"),
      buttons: REQUEST_TARGETS.map((t, i) => [
        btn(messageButton(deps.templates, L, "message.requests.target", t), String(i + 1)),
      ]),
    });
    const commonPrompt = () => ({
      text: message(deps.templates, L, "message.requests.common"),
      buttons: COMMON_KINDS.map((k, i) => [
        btn(messageButton(deps.templates, L, "message.requests.common", k), String(i + 1)),
      ]),
    });
    const commonPlacePrompt = () =>
      message(deps.templates, L, "message.requests.common_place", {
        name: preview(state.common_name ?? state.common_code ?? "", 50),
      });
    const commonTerritoryPrompt = () =>
      message(deps.templates, L, "message.requests.common_territory");
    // Список домов (как askBuilding в регистрации); код текстом — альтернатива.
    const askBuildings = async () => {
      const buildings = await exec.query<Row>(
        "select id,name,code from building order by code",
      );
      state.building_options = buildings;
      state.step = "common_building";
      return {
        text: message(deps.templates, L, "message.requests.building", {
          buildings: safeBlock(
            numbered(
              buildings.map((b) => esc(preview(b.name ?? b.code, 50))),
            ),
          ),
        }),
        buttons: buildings.map((b, i) => [
          btn(
            messageButton(
              deps.templates,
              L,
              "message.requests.building",
              "building",
              { name: preview(b.name ?? b.code, 20) },
            ),
            String(i + 1),
          ),
        ]),
      };
    };
    const premisesLabel = (p: Row) =>
      `${preview(p.name ?? p.code, 50)}, ${
        label(premiseLabels, p.kind, L, "помещение")
      } ${preview(p.number, 30)}`;
    // Метка места из состояния диалога — для /editrequest и ввода UUID.
    const loadPlaceLabel = async () => {
      if (state.premises_id) {
        const [p] = await exec.query<Row>(
          "select p.number,p.kind,b.name,b.code from premises p join building b on b.id=p.building_id where p.id=$1",
          [state.premises_id],
        );
        if (p) {
          state.place_label = premisesLabel(p);
          return;
        }
      }
      if (state.building_id) {
        const [b] = await exec.query<Row>(
          "select name,code from building where id=$1",
          [state.building_id],
        );
        if (b) {
          state.place_label = `${preview(b.name ?? b.code, 50)}${
            state.location_text ? `, ${state.location_text}` : ""
          }`;
          return;
        }
      }
      state.place_label = state.location_text
        ? preview(String(state.location_text), 120)
        : templateText(deps.templates, L, "requests.net");
    };
    if (command === "/objects") {
      const items = await places();
      state.place_options = items;
      // Нажатие кнопки помещения начинает черновик для него: тот же шаг выбора,
      // что и после /newrequest, — иначе кнопка вне диалога черновика не работает.
      // Вид и место через /objects не выбираются — не оставлять выбор
      // прерванного диалога в состоянии.
      delete state.kind;
      delete state.place_label;
      delete state.common_kind;
      delete state.common_code;
      delete state.common_name;
      state.step = "place";
      return save({
        text: message(deps.templates, L, "message.requests.places", {
          premises: safeBlock(
            placeMenu(items) ||
              templateText(
                deps.templates,
                L,
                "requests.podtverzhdennyh_pomescheniy_net",
              ),
          ),
        }),
        // Выбор помещения — кнопка равна номеру строки.
        buttons: items.slice(0, 20).map((p, i) => [
          btn(
            messageButton(
              deps.templates,
              L,
              "message.requests.places",
              "place",
              { number: preview(p.number, 20) },
            ),
            String(i + 1),
          ),
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
        templateText(
          deps.templates,
          L,
          "requests.lichnyy_chernovik_udalen_newrequest",
        ),
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
        if (command === "/editrequest") {
          await loadPlaceLabel();
          state.step = "kind";
          return save(kindPrompt());
        }
        state.step = "verify";
        return save({
          text: message(deps.templates, L, "message.requests.saved_draft", {
            description: preview(draft.description, 1200),
          }),
          buttons: [[
            btn(
              messageButton(
                deps.templates,
                L,
                "message.requests.saved_draft",
                "send",
              ),
              "/sendrequest",
            ),
            btn(
              messageButton(
                deps.templates,
                L,
                "message.requests.saved_draft",
                "delete",
              ),
              "/deletedraft",
            ),
          ]],
        });
      }
      delete state.draft_id;
      // Вид — первый шаг (REQ-03), затем адресат (REQ-02).
      delete state.kind;
      delete state.place_label;
      delete state.common_kind;
      delete state.common_code;
      delete state.common_name;
      state.step = "kind";
      return save(kindPrompt());
    }
    if (command === "/requestcancel" || command === "/registration") {
      for (const k of Object.keys(state)) delete state[k];
      return save(
        templateText(
          deps.templates,
          L,
          "requests.dialog_priostanovlen_chernovik_sohranen_register_requests",
        ),
      );
    }
    if (command === "/requests") {
      const tokens = [number, ...args].filter((t): t is string => !!t);
      const pageToken = tokens.find((t) => /^page:\d+$/.test(t));
      const page = pageToken ? Number(pageToken.slice(5)) : 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          templateText(deps.templates, L, "requests.nekorrektnaya_stranitsa"),
        );
      }
      const rows = await listRequests(d, actor, {
        cursor: btoa(String((page - 1) * 10)),
        search: tokens.filter((t) => t !== pageToken).join(" ") || undefined,
      });
      state.scenario = "requests";
      delete state.request_id;
      delete state.draft_id;
      delete state.step;
      return save(
        requestListText(rows, actor.person.id, page, L, deps.templates),
      );
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
        message(deps.templates, L, "message.requests.sent", {
          number: sent.number,
          deadline: fmtDate(sent.first_response_due_at),
        }),
      );
    }
    if (state.step === "kind") {
      const token = input.trim().toLowerCase();
      const kind = REQUEST_KINDS[Number(token) - 1] ?? KIND_ALIASES[token];
      // Недопустимый ввод повторяет вопрос, состояние не меняется.
      if (!kind) return save(kindPrompt());
      state.kind = kind;
      if (state.draft_id) {
        // /editrequest: место черновика сохранено, остаётся новый текст.
        state.step = "description";
        return save(
          templateText(
            deps.templates,
            L,
            "requests.vvedite_novyy_tekst_chernovika",
          ),
        );
      }
      state.step = "target";
      return save(targetPrompt());
    }
    if (state.step === "target") {
      const token = input.trim().toLowerCase();
      const target = REQUEST_TARGETS[Number(token) - 1] ?? TARGET_ALIASES[token];
      if (!target) return save(targetPrompt());
      if (target === "my_places") {
        state.step = "place";
        return save(await placePrompt());
      }
      state.step = "common";
      return save(commonPrompt());
    }
    if (state.step === "common") {
      const token = input.trim().toLowerCase();
      const target = COMMON_KINDS[Number(token) - 1] ?? COMMON_ALIASES[token];
      if (!target) return save(commonPrompt());
      if (target === "house") return save(await askBuildings());
      state.premises_id = null;
      state.building_id = null;
      state.common_kind = "territory";
      state.step = "common_place";
      return save(commonTerritoryPrompt());
    }
    if (state.step === "common_building") {
      const options = (state.building_options ?? []) as Row[];
      const selected = options[Number(input.trim()) - 1];
      let building: Row | undefined = selected;
      if (!building) {
        const q = input.trim();
        if (!q) return save(await askBuildings());
        const [found] = await exec.query<Row>(
          "select id,name,code from building where id::text=$1 or code=$1 limit 1",
          [q],
        );
        building = found;
      }
      if (!building) return save(await askBuildings());
      state.building_id = building.id;
      state.premises_id = null;
      state.common_kind = "house";
      state.common_code = building.code;
      state.common_name = building.name;
      state.step = "common_place";
      return save(commonPlacePrompt());
    }
    if (state.step === "common_place") {
      const location = input.trim();
      if (!location) {
        return save(
          state.common_kind === "house"
            ? commonPlacePrompt()
            : commonTerritoryPrompt(),
        );
      }
      state.location_text = location;
      state.premises_id = null;
      if (state.common_kind === "house") {
        state.place_label = `${
          preview(state.common_name ?? state.common_code ?? "", 50)
        }, ${location}`;
      } else {
        state.building_id = null;
        state.place_label = preview(location, 120);
      }
      state.step = "description";
      return save(
        templateText(
          deps.templates,
          L,
          "requests.opishite_problemu_svoimi_slovami_kategoriya_ne_nuzhna",
        ),
      );
    }
    if (state.step === "place") {
      if (command === "дом" || command === "үй") {
        if (!number || !args.join(" ").trim()) {
          return templateText(
            deps.templates,
            L,
            "requests.ukazhite_kod_doma_i_mesto_dom_1",
          );
        }
        // Колонка building.kind удалена (REG-11): код здания уникален сам.
        const [building] = await exec.query<Row>(
          "select id,name,code from building where id::text=$1 or code=$1 limit 1",
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
        state.place_label = `${
          preview(building.name ?? building.code, 50)
        }, ${state.location_text}`;
      } else if (command === "территория" || command === "аумақ") {
        if (!number) {
          // Без описания — приглашение места (тот же шаг, что в подменю общего имущества).
          state.premises_id = null;
          state.building_id = null;
          state.common_kind = "territory";
          state.step = "common_place";
          return save(commonTerritoryPrompt());
        }
        state.building_id = null;
        state.location_text = [number, ...args].join(" ");
        state.premises_id = null;
        state.place_label = preview(state.location_text, 120);
      } else {
        const options = (state.place_options ?? []) as Row[];
        const selected = options[Number(input.trim()) - 1];
        if (
          !selected &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            .test(input.trim())
        ) {
          return templateText(
            deps.templates,
            L,
            "requests.vyberite_nomer_iz_spiska_objects",
          );
        }
        state.premises_id = selected?.id ?? input.trim();
        state.building_id = selected?.building_id ?? null;
        state.location_text = null;
        if (selected) {
          state.place_label = premisesLabel(selected);
        } else {
          // Ввод UUID помещения — метку собираем из реестра.
          await loadPlaceLabel();
        }
      }
      state.step = "description";
      return save(
        templateText(
          deps.templates,
          L,
          "requests.opishite_problemu_svoimi_slovami_kategoriya_ne_nuzhna",
        ),
      );
    }
    if (state.step === "description") {
      // Вид передаём только выбранный в этом диалоге: undefined сохраняет
      // вид существующего черновика (editRequest) или дефолт «request».
      const kind = REQUEST_KINDS.find((k) => k === state.kind);
      // Диалоги, начатые до деплоя, не имеют метки места — собираем из реестра.
      if (state.place_label === undefined) await loadPlaceLabel();
      const inputRow = {
        text: input,
        premises_id: state.premises_id,
        building_id: state.building_id,
        location_text: state.location_text,
        ...(kind ? { kind } : {}),
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
        text: message(deps.templates, L, "message.requests.verify", {
          kind: messageButton(
            deps.templates,
            L,
            "message.requests.kind",
            kind ?? "request",
          ),
          place: state.place_label ??
            templateText(deps.templates, L, "requests.net"),
          description: preview(input, 1200),
        }),
        buttons: [[
          btn(
            messageButton(deps.templates, L, "message.requests.verify", "send"),
            "/sendrequest",
          ),
        ]],
      });
    }
    if (state.draft_id) {
      return save(
        templateText(
          deps.templates,
          L,
          "requests.chernovik_sohranen_dobavte_fayly_ili_sendrequest_requestcancel",
        ),
      );
    }
    return registrationHelp(L, deps.templates);
  });
}
