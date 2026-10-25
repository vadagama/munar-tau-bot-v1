import { visitFlow, VISIT_COMMANDS } from "./visits.ts";
import { inputFormReply, type BotInput } from "./input-form.ts";
import { loadDialog, saveDialog } from "./dialog.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";
import { BotTemplateError } from "./bot-errors.ts";
import { t as templateText } from "../templates/store.ts";
import { label, premiseLabels } from "../locales/registry.ts";
import { preview, requestCardText, requestListText } from "./request-text.ts";
import {
  buildingCodeMatches,
  esc,
  fmtDate,
  normalizeBuildingCode,
  numbered,
} from "./text.ts";
import { registrationHelp } from "./help.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { ApiError } from "../errors/api.ts";
import { type Row } from "../domains/registry/validation.ts";
import { actorForTelegram } from "./registration.ts";
import { type BotReply, btn } from "./keyboard.ts";
import { CLOSED_STATES, STATES } from "../domains/requests/fsm.ts";
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
  ...VISIT_COMMANDS,
  "/rinput", "/rskip", "/sharepick",
  "/result",
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
    const bot = deps.bot ?? "resident";
    const state = await loadDialog(exec, telegramId, bot, actor?.profile.id ?? null, actor?.emulation?.sessionId ?? null, "requests");
    const save = async (reply: BotReply) => {
      await saveDialog(exec, telegramId, bot, state);
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
      const current=await getRequest(d, actor, r.id);
      state.request_id=current.id;delete state.draft_id;
      await saveDialog(exec,telegramId,bot,state);
      return current;
    };
    if(input.startsWith('/')) {
      if(!['/rinput','/rskip'].includes(command??''))delete state.input_form;
      if(command!=='/sharepick')delete state.share_form;
      await saveDialog(exec,telegramId,bot,state);
    }
    const visitReply=await visitFlow(d,actor,state,input,false);
    if(visitReply)return save(visitReply);
    const actions: Record<string,string> = {"/confirm":"confirm_result","/return":"return_result","/cancelrequest":"cancel_request","/appeal":"appeal_reject","/reopen":"reopen"};
    const pending = state.input_form as BotInput | undefined;
    if (command === "/rinput" && pending) {
      if(number!==pending.token || pending.index!==pending.fields.length) throw new ApiError("VALIDATION_FAILED");
      if(pending.command==='/say') await addMessage(d,actor,pending.object_id,{text:pending.values[0],channel:'resident',source:'bot'},`resident:input:${pending.token}`);
      else if(pending.command==='/rate')await rateRequest(d,actor,pending.object_id,{value:pending.value,comment:pending.values[0]});
      else await transitionRequest(d,actor,pending.object_id,{action:actions[pending.command],expected_version:pending.version,reason:pending.values[0]},`resident:input:${pending.token}`);
      delete state.input_form;
      return save(requestCardText(await getRequest(d,actor,pending.object_id),L,deps.templates));
    }
    if(command==='/rskip'&&pending?.command==='/rate'&&pending.index===0&&number===pending.token){pending.values=[''];pending.index=1;return save(inputFormReply(pending,L,deps.templates));}
    if(pending && !input.startsWith('/')) {
      // Сообщение по обращению уходит сразу: текст — это и есть сообщение,
      // дополнительный предпросмотр и «Подтвердить» перед обычной перепиской
      // не нужны. Ветка /rinput ниже сохранена для диалогов, начатых раньше.
      if(pending.command==='/say') {
        if(!input.trim()||input.length>10000)throw new ApiError('VALIDATION_FAILED');
        pending.values=[input.trim()];pending.index=pending.fields.length;
        await addMessage(d,actor,pending.object_id,{text:pending.values[0],channel:'resident',source:'bot'},`resident:input:${pending.token}`);
        delete state.input_form;
        return save(requestCardText(await getRequest(d,actor,pending.object_id),L,deps.templates));
      }
      if(pending.index<pending.fields.length) {
        if(!input.trim()||input.length>10000)throw new ApiError('VALIDATION_FAILED');
        pending.values.push(input.trim());pending.index++;
      }
      return save(inputFormReply(pending,L,deps.templates));
    }
    if(['/request','/requests','/newrequest','/requestcancel'].includes(command??'')) {delete state.input_form;delete state.share_form;}
    if(command==='/sharepick') {
      const form=state.share_form as Row|undefined;
      const choice=(form?.choices as string[]|undefined)?.[Number(args[0])];
      if(!form||number!==form.token||!choice)throw new ApiError('VALIDATION_FAILED');
      await shareRequest(d,actor,String(form.request_id),choice,form.revoke===true);
      delete state.share_form;
      return save(requestCardText(await getRequest(d,actor,String(form.request_id)),L,deps.templates));
    }
    if(command && ['/say','/return','/cancelrequest','/appeal','/reopen'].includes(command)&&!args.length) {
      const row=await find();
      state.request_id=row.id;delete state.draft_id;delete state.step;
      // Приглашение ввода несёт номер обращения: пользователь видит, куда
      // уйдёт сообщение, без отдельного шага предпросмотра.
      state.input_form={token:crypto.randomUUID(),command,object_id:String(row.id),number:String(row.number),version:Number(row.version),title:messageButton(deps.templates,L,'bot.controls',command.slice(1)),fields:[command==='/say'?'text':'reason'],values:[],index:0,confirm_command:'/rinput',cancel_command:`/request ${row.number}`,...(command==='/say'?{prompt:message(deps.templates,L,'message.requests.say_prompt',{number:String(row.number)})}:{})} satisfies BotInput;
      return save(inputFormReply(state.input_form as BotInput,L,deps.templates));
    }
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
      return {text:message(
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
      ),buttons:[...(index+1<reports.length?[[btn(messageButton(deps.templates,L,'bot.controls','next'),`/result ${r.number} ${index+2}`)]]:[]),[btn(messageButton(deps.templates,L,'bot.controls','back'),`/request ${r.number}`)]]};
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
    // Адрес одной строкой (REG-01): для жителя без подтверждённых помещений —
    // вместо шага адресата; адрес сохраняется как написан, без распознавания.
    const addressPrompt = () =>
      message(deps.templates, L, "message.requests.address");
    // Диалог файлов (REQ-03): медиа прикрепляются ответом на приглашение;
    // сохранение запроса — кнопка «Сохранить запрос» → /sendrequest.
    // attachments_wait/attachments_more — шаги старых диалогов, нормализуем в
    // attachments, но продолжаем распознавать.
    const fileSteps = ["attachments", "attachments_wait", "attachments_more"];
    const attachmentsPrompt = () => ({
      text: message(deps.templates, L, "message.requests.attachments_prompt"),
      buttons: [[
        btn(
          messageButton(
            deps.templates,
            L,
            "message.requests.attachments_prompt",
            "save",
          ),
          "/sendrequest",
        ),
      ]],
    });
    // Плюрализация числа файлов: ru — 1 файл/2 файла/5 файлов, kk — всегда
    // «N файл».
    const filesLabel = (n: number) => {
      if (L === "kk") return `${n} файл`;
      const mod10 = n % 10;
      const mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return `${n} файл`;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
        return `${n} файла`;
      }
      return `${n} файлов`;
    };
    const verifyCard = async () => {
      const [filesRow] = state.draft_id
        ? await exec.query<{ n: number }>(
          // Считаются и incomplete: файл уже в очереди на сохранение.
          "select count(*)::int as n from attachment where request_id=$1 and owner_type='request'",
          [String(state.draft_id)],
        )
        : [{ n: 0 }];
      const vars = {
        kind: messageButton(
          deps.templates,
          L,
          "message.requests.kind",
          REQUEST_KINDS.find((k) => k === state.kind) ?? "request",
        ),
        place: state.place_label ??
          templateText(deps.templates, L, "requests.net"),
        description: preview(String(state.description ?? ""), 1200),
      };
      return {
        text: (filesRow?.n ?? 0) > 0
          ? message(deps.templates, L, "message.requests.verify_files", {
            ...vars,
            files: filesLabel(filesRow!.n),
          })
          : message(deps.templates, L, "message.requests.verify", vars),
        buttons: [[
          btn(
            messageButton(deps.templates, L, "message.requests.verify", "send"),
            "/sendrequest",
          ),
          btn(
            messageButton(
              deps.templates,
              L,
              "message.requests.verify",
              "cancel",
            ),
            "/requestcancel",
          ),
        ]],
      };
    };
    const commonPlacePrompt = () =>
      message(deps.templates, L, "message.requests.common_place", {
        name: preview(state.common_name ?? state.common_code ?? "", 50),
      });
    const commonTerritoryPrompt = () =>
      message(deps.templates, L, "message.requests.common_territory");
    // Дом текстом с автопроверкой (REG-11): список всех домов не выводится.
    const askBuildings = async () => {
      state.step = "common_building";
      return {
        text: message(deps.templates, L, "message.requests.building"),
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
    if (command === "/requestcancel") {
      for (const k of Object.keys(state)) delete state[k];
      return save(
        templateText(
          deps.templates,
          L,
          "requests.formirovanie_obrascheniya_priostanovleno",
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
      // По умолчанию — только активные обращения; закрытые — в архиве по кнопке.
      const archive = tokens.includes("archive");
      const search =
        tokens.filter((t) => t !== pageToken && t !== "archive").join(" ") ||
        undefined;
      const states = archive
        ? [...CLOSED_STATES]
        : STATES.filter((s) => !CLOSED_STATES.includes(s));
      const rows = await listRequests(d, actor, {
        cursor: btoa(String((page - 1) * 10)),
        search,
        states,
      });
      // Кнопка архива — только когда закрытые обращения уже есть.
      const hasArchive = !archive &&
        (await listRequests(d, actor, { states: [...CLOSED_STATES], limit: 1 }))
          .length > 0;
      state.scenario = "requests";
      delete state.request_id;
      delete state.draft_id;
      delete state.step;
      return save(
        requestListText(
          rows,
          actor.person.id,
          page,
          L,
          deps.templates,
          deps.residentBotUsername,
          { archive, hasArchive },
        ),
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
      if(!args.length) {
        if(!row.can_share)throw new ApiError('FORBIDDEN');
        const choices=command==='/unshare'
          ? await exec.query<Row>("select n.id,n.full_name from request_participant p join person n on n.id=p.person_id where p.request_id=$1 and p.revoked_at is null and p.role='participant' order by n.full_name",[row.id])
          : await exec.query<Row>("select distinct n.id,n.full_name from connection c join person n on n.id=c.person_id where c.premises_id=$1 and c.status='active' and n.status='active' and n.is_test=$2 and n.id<>$3 and exists(select 1 from profile p where p.person_id=n.id and p.archived_at is null) order by n.full_name",[row.premises_id,actor.person.isTest,actor.person.id]);
        const token=crypto.randomUUID().slice(0,12);
        state.share_form={token,request_id:row.id,choices:choices.map(c=>c.id),revoke:command==='/unshare'};
        return save({text:message(deps.templates,L,'bot.select'),buttons:[...choices.map((c,i)=>[btn(String(c.full_name),`/sharepick ${token} ${i}`)]),[btn(messageButton(deps.templates,L,'bot.controls','back'),`/request ${row.number}`)]]});
      }
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
      if(args.length===1){
        const value=Number(args[0]);if(!Number.isInteger(value)||value<1||value>5)throw new ApiError('VALIDATION_FAILED');
        state.input_form={token:crypto.randomUUID(),command:'/rate',object_id:String(row.id),number:String(row.number),version:Number(row.version),value,title:messageButton(deps.templates,L,'bot.controls','rate')+` ${value}/5`,fields:['rating_comment'],values:[],index:0,confirm_command:'/rinput',cancel_command:`/request ${row.number}`} satisfies BotInput;
        return save(inputFormReply(state.input_form as BotInput,L,deps.templates));
      }
      await rateRequest(d, actor, String(row.id), {
        value: Number(args[0]),
        comment: args.slice(1).join(" "),
      });
      return templateText(deps.templates, L, "requests.otsenka_sohranena");
    }
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
    // «Сохранить запрос» из файлового шага — сначала карточка проверки.
    if (
      command === "/sendrequest" && state.draft_id &&
      fileSteps.includes(String(state.step ?? ""))
    ) {
      state.step = "verify";
      return save(await verifyCard());
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
          registered: fmtDate(sent.open_at),
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
      // Без подтверждённых помещений шаг «Мои помещения / Общее имущество»
      // пропускается (REG-01): сразу адрес одной строкой.
      if (!(await places()).length) {
        state.step = "address";
        return save(addressPrompt());
      }
      state.step = "target";
      return save(targetPrompt());
    }
    if (state.step === "address") {
      const location = input.trim();
      if (!location) return save(addressPrompt());
      state.premises_id = null;
      state.building_id = null;
      state.location_text = location;
      state.place_label = preview(location, 120);
      state.step = "description";
      return save(
        templateText(
          deps.templates,
          L,
          "requests.opishite_problemu_svoimi_slovami_kategoriya_ne_nuzhna",
        ),
      );
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
      // Номер дома текстом с автопроверкой (REG-11); точный код/UUID тоже принимается.
      const code = normalizeBuildingCode(input);
      if (!code) return save(await askBuildings());
      const buildings = await exec.query<Row>(
        "select id,name,code from building order by code",
      );
      const building = buildings.find((b) =>
        String(b.id) === input.trim() || buildingCodeMatches(b.code, input)
      );
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
      state.description = input;
      state.step = "attachments";
      return save(attachmentsPrompt());
    }
    // Файловый шаг (REQ-03): текст вместо медиа — повтор приглашения.
    if (fileSteps.includes(String(state.step ?? ""))) {
      state.step = "attachments";
      return save(attachmentsPrompt());
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
