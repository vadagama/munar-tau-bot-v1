import { message, messageButton, safeBlock } from "../templates/message.ts";
import { BotTemplateError } from "./bot-errors.ts";
import { loadTemplateStore, type TemplateStore } from "../templates/store.ts";
import {
  label,
  premiseLabels,
  roleLabels,
  stateLabels,
} from "../locales/registry.ts";
import { jsonValue } from "../domains/registry/validation.ts";
import type { Actor } from "../pdp/types.ts";
import type { DbExecutor } from "../db/client.ts";
import { ApiError } from "../errors/api.ts";
import { SqlAdminRepo } from "../domains/admin/repo.ts";
import { buildActorForProfile } from "../domains/admin/actor-service.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { normalizePhone, type Row } from "../domains/registry/validation.ts";
import {
  acceptInvite,
  acceptInviteForNewTelegram,
  createInvite,
  reviewRegistration,
  revokeOwnConnection,
  submitRegistration,
} from "../domains/registrations/service.ts";
import { submitPrivacyRequest } from "../domains/privacy/service.ts";
import { ScenarioRegistry } from "./registry.ts";
import { registrationHelp, welcomeText } from "./help.ts";
import { type BotReply, btn, replyText } from "./keyboard.ts";
import {
  esc,
  fmtDate,
  type Lang,
  langOf,
  numbered,
  resolveRef,
} from "./text.ts";

export async function actorForTelegram(
  deps: RegistryDeps,
  telegramId: string,
): Promise<Actor | null> {
  const [p] = await deps.db.query<{ id: string }>(
    "select pr.id from profile pr join person n on n.id=pr.person_id where pr.telegram_user_id=$1 and pr.archived_at is null and n.status='active'",
    [telegramId],
  );
  if (!p) return null;
  const repo = new SqlAdminRepo();
  const profile = await repo.getProfile(deps.db, p.id);
  return profile
    ? buildActorForProfile(repo, deps.db, profile, new Date())
    : null;
}

/** Типы помещений анкеты: номера строк равны callback-данным кнопок. */
const KIND_OPTIONS = ["apartment", "commercial", "parking_slot", "storage"];
const ROLE_OPTIONS = ["owner", "tenant", "resident", "other"];
const KIND_TEXT = (lang: Lang) =>
  numbered(KIND_OPTIONS.map((kind) => label(premiseLabels, kind, lang)));
const ROLE_TEXT = (lang: Lang) =>
  numbered(ROLE_OPTIONS.map((role) => label(roleLabels, role, lang)));

/**
 * Роль из слова жителя («арендатор», «проживающий», «жилец») или слага;
 * английские слаги сохранены для совместимости.
 */
const ROLE_WORDS: Record<string, string> = {
  "арендатор": "tenant",
  "жалға алушы": "tenant",
  "жилец": "resident",
  "проживающий": "resident",
  "тұрғын": "resident",
  "другое": "other",
  "басқа": "other",
  tenant: "tenant",
  resident: "resident",
  other: "other",
};
function roleFromWord(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return ROLE_WORDS[value.trim().toLowerCase()];
}

/** Строка списка анкет: состояние, анкетные данные, помещение, роль, причина. */
function registrationLines(rows: Row[], L: Lang): string[] {
  return rows.map((r) => {
    const draft = r.draft ? jsonValue<Row>(r.draft) : {};
    return `<b>${esc(label(stateLabels, r.state, L))}</b>: ${
      esc(draft.full_name ?? "—")
    }, ${esc(label(premiseLabels, r.kind, L, "помещение"))} ${
      esc(r.code ?? "—")
    }/${esc(r.number ?? "—")}, ${esc(label(roleLabels, r.role, L))}${
      r.decided_reason ? ` — ${esc(String(r.decided_reason))}` : ""
    }`;
  });
}

function scopedDeps(deps: RegistryDeps, exec: DbExecutor): RegistryDeps {
  return {
    ...deps,
    db: {
      ...deps.db,
      query: exec.query.bind(exec),
      transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn(exec),
    },
  };
}

/** Единственная анкета для Telegram и эмуляции; состояние диалога — PostgreSQL. */
export async function registrationStep(
  deps: RegistryDeps,
  telegramId: string,
  input: string,
  providedActor?: Actor,
): Promise<BotReply> {
  return deps.db.transaction(async (exec) => {
    const d = scopedDeps(deps, exec);
    const actor = providedActor ?? (await actorForTelegram(d, telegramId));
    await exec.query(
      "insert into bot_dialog(telegram_user_id,profile_id) values ($1,$2) on conflict do nothing",
      [telegramId, actor?.profile.id ?? null],
    );
    const [dialog] = await exec.query<{ state: Row }>(
      "select state from bot_dialog where telegram_user_id=$1 for update",
      [telegramId],
    );
    const state = { ...jsonValue<Row>(dialog!.state) };
    // Язык подачи: выбранный в диалоге, иначе язык профиля, иначе русский.
    const L: Lang = langOf(state.language ?? actor?.profile.language);
    const help = () => registrationHelp(L, deps.templates);
    const save = async (reply: BotReply) => {
      await exec.query(
        "update bot_dialog set state=$2::text::jsonb,updated_at=now() where telegram_user_id=$1",
        [telegramId, JSON.stringify(state)],
      );
      return reply;
    };
    const parts = input.trim().split(/\s+/),
      cmd = parts[0];
    if (cmd === "/cancel") {
      for (const key of Object.keys(state)) delete state[key];
      return save(help());
    }
    if (cmd === "/status") {
      const rows = await exec.query<Row>(
        `select r.id,r.state,r.decided_reason,r.review_stage,r.draft,r.role,p.kind,p.number,b.code
        from registration r join premises p on p.id=r.premises_id join building b on b.id=p.building_id
        where r.telegram_user_id=$1 or r.person_id=$2 order by r.created_at desc limit 20`,
        [telegramId, actor?.person.id ?? null],
      );
      if (!rows.length) {
        return message(deps.templates, L, "registration.anket_poka_net");
      }
      state.status_options = rows.map((r) => String(r.id));
      // Кнопка доступна только редактируемым анкетам: /edit проверит и ответит.
      const editable = new Set([
        "pending_review",
        "need_clarification",
        "rejected",
      ]);
      const buttons = rows
        .map((r, i) =>
          editable.has(String(r.state))
            ? [
              btn(
                messageButton(
                  deps.templates,
                  L,
                  "message.registration.status",
                  "edit",
                ),
                `/edit ${i + 1}`,
              ),
            ]
            : undefined
        )
        .filter((row): row is NonNullable<typeof row> => !!row);
      return save({
        text: message(deps.templates, L, "message.registration.status", {
          registrations: safeBlock(numbered(registrationLines(rows, L))),
        }),
        ...(buttons.length ? { buttons } : {}),
      });
    }
    if (cmd === "/pending" || cmd === "/accesses") {
      if (!actor) {
        return save(
          message(
            deps.templates,
            L,
            "registration.snachala_registratsiya_register",
          ),
        );
      }
      if (cmd === "/pending") {
        const rows = await exec.query<Row>(
          `select r.id,r.draft,p.kind,p.number from registration r join premises p on p.id=r.premises_id
          where r.review_stage='owner' and r.state in ('pending_review','need_clarification') and r.is_test=$2 and exists(select 1 from connection c where c.person_id=$1 and c.premises_id=r.premises_id and c.status='active' and c.role='owner')`,
          [actor.person.id, actor.person.isTest],
        );
        if (!rows.length) {
          return message(
            deps.templates,
            L,
            "registration.anket_na_podtverzhdenie_net",
          );
        }
        state.pending_options = rows.map((r) => String(r.id));
        return save({
          text: message(deps.templates, L, "message.registration.pending", {
            registrations: safeBlock(numbered(rows.map((r) => {
              const draft = jsonValue<Row>(r.draft);
              return `<b>${esc(draft.full_name)}</b>, ${
                esc(draft.phone_e164)
              }; ${esc(label(premiseLabels, r.kind, L, "помещение"))} ${
                esc(r.number)
              }`;
            }))),
          }),
          // Подтвердить можно кнопкой: причина подставится автоматически.
          buttons: rows.map((r, i) => [
            btn(
              messageButton(
                deps.templates,
                L,
                "message.registration.pending",
                "approve",
                { index: i + 1 },
              ),
              `/approve ${i + 1}`,
            ),
          ]),
        });
      }
      const rows = await exec.query<Row>(
        `select c.id,c.confirmed_by,n.full_name,p.kind,p.number,(select r.id from registration r where r.person_id=c.person_id and r.premises_id=c.premises_id and r.state='approved' order by created_at desc limit 1) as registration_id
        from connection c join premises p on p.id=c.premises_id join person n on n.id=c.person_id where c.role<>'owner' and c.status='active' and n.is_test=$2
        and exists(select 1 from connection o where o.person_id=$1 and o.premises_id=c.premises_id and o.role='owner' and o.status='active')`,
        [actor.person.id, actor.person.isTest],
      );
      if (!rows.length) {
        return message(deps.templates, L, "registration.vydannyh_dostupov_net");
      }
      state.access_options = rows.map((r) => String(r.id));
      const disputeRefs = rows.map((r) => r.registration_id).filter(Boolean);
      state.dispute_options = disputeRefs.map(String);
      return save(
        message(deps.templates, L, "message.registration.accesses", {
          accesses: safeBlock(
            numbered(
              rows.map((r) =>
                `<b>${esc(r.full_name)}</b>: ${
                  esc(label(premiseLabels, r.kind, L, "помещение"))
                } ${esc(r.number)}`
              ),
            ),
          ),
        }),
      );
    }
    if (cmd === "/objects") {
      if (!actor) {
        return save(
          message(
            deps.templates,
            L,
            "registration.snachala_registratsiya_register",
          ),
        );
      }
      const rows = await exec.query<Row>(
        "select c.id,c.premises_id,c.role,c.status,p.kind,p.number,b.code from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id where c.person_id=$1",
        [actor.person.id],
      );
      if (!rows.length) {
        return message(
          deps.templates,
          L,
          "registration.podtverzhdennyh_obektov_net",
        );
      }
      const seen = new Set<string>();
      state.object_options = rows.flatMap((r) => {
        const id = String(r.premises_id);
        if (seen.has(id)) return [];
        seen.add(id);
        return [id];
      });
      return save(
        message(deps.templates, L, "message.registration.objects", {
          premises: safeBlock(
            numbered(
              rows.map((r) =>
                `${esc(label(premiseLabels, r.kind, L, "помещение"))} ${
                  esc(r.code)
                }/${esc(r.number)} — ${esc(label(roleLabels, r.role, L))}, ${
                  esc(label(stateLabels, r.status, L))
                }`
              ),
            ),
          ),
        }),
      );
    }
    if (
      [
        "/invite",
        "/accept",
        "/approve",
        "/reject",
        "/dispute",
        "/revoke",
      ].includes(cmd ?? "")
    ) {
      if (!actor) {
        return save(
          message(
            deps.templates,
            L,
            "registration.snachala_registratsiya_register",
          ),
        );
      }
      if (!parts[1]) {
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          message(deps.templates, L, "registration.ukazhite_nomer_iz_spiska"),
        );
      }
      /** Ссылка на объект: номер строки последнего списка или UUID. */
      const ref = (groups: (string[] | undefined)[]): string => {
        const id = resolveRef(parts[1], groups);
        if (!id) {
          throw new BotTemplateError(
            "VALIDATION_FAILED",
            message(
              deps.templates,
              L,
              "registration.ne_ponyal_ssylku_otkroyte_spisok_i_ukazhite",
            ),
          );
        }
        return id;
      };
      if (cmd === "/invite") {
        const role = roleFromWord(parts[2]);
        if (!role) {
          throw new BotTemplateError(
            "VALIDATION_FAILED",
            message(
              deps.templates,
              L,
              "registration.ukazhite_rol_arendator_prozhivayuschiy_ili_drugoe",
            ),
          );
        }
        const invite = await createInvite(d, actor, {
          premises_id: ref([state.object_options as string[]]),
          role,
        });
        return save(
          message(deps.templates, L, "message.registration.invite", {
            invite_command: `/start invite_${invite.token}`,
            expires_at: fmtDate(invite.expires_at),
          }),
        );
      }
      if (cmd === "/accept") {
        await acceptInvite(d, actor, parts[1]);
        return save(
          message(deps.templates, L, "registration.dostup_podtverzhden"),
        );
      }
      if (cmd === "/revoke") {
        await revokeOwnConnection(
          d,
          actor,
          ref([state.access_options as string[]]),
          parts.slice(2).join(" "),
        );
        return save(
          message(deps.templates, L, "registration.svyaz_prekraschena"),
        );
      }
      await reviewRegistration(
        d,
        actor,
        ref([
          state.pending_options as string[],
          state.dispute_options as string[],
          state.status_options as string[],
        ]),
        cmd === "/approve"
          ? "approve"
          : cmd === "/reject"
          ? "reject"
          : "dispute",
        {
          reason: parts.slice(2).join(" ") ||
            message(deps.templates, L, "registration.reshenie_sobstvennika"),
        },
        true,
      );
      return save(
        message(deps.templates, L, "registration.reshenie_sohraneno"),
      );
    }
    if (cmd === "/add") {
      for (const key of Object.keys(state)) delete state[key];
      if (!actor) {
        // У нового пользователя ещё нет настроек — полный мастер анкеты (REG-01).
        state.step = "language";
        return save(languageStepText(deps.templates));
      }
      // У зарегистрированного пользователя анкетные данные уже известны (REG-01):
      // язык — из профиля, имя и телефон — из карточки реестра. Персона всегда
      // есть: профиль создаётся вместе с карточкой при первой проверке анкеты.
      state.language = String(actor.profile.language);
      state.full_name = actor.person.fullName;
      const [person] = await exec.query<Row>(
        "select phone_e164 from person where id=$1",
        [actor.person.id],
      );
      if (person?.phone_e164) state.phone_e164 = String(person.phone_e164);
      if (parts[1] === "manual") {
        return save(await askBuilding(exec, state, L, deps.templates));
      }
      // Помещения, связанные с пользователем связями исходного реестра (IMP-12:
      // импорт не подтверждает доступ автоматически), без действующей связи
      // и без анкеты в работе — их и предлагаем списком.
      const rows = await exec.query<Row>(
        `select c.premises_id,c.role,p.kind,p.number,b.code
        from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id
        where c.person_id=$1 and c.status='pending' and p.status='active' and p.is_test=$2
        and not exists(select 1 from connection a where a.person_id=c.person_id and a.premises_id=c.premises_id and a.status='active')
        and not exists(select 1 from registration r where r.person_id=c.person_id and r.premises_id=c.premises_id and r.state in ('pending_review','need_clarification','approved','disputed'))
        order by b.code,p.number limit 20`,
        [actor.person.id, actor.person.isTest],
      );
      const seen = new Set<string>();
      const options = rows.filter((r) => {
        const id = String(r.premises_id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      if (!options.length) {
        return save(await askBuilding(exec, state, L, deps.templates));
      }
      state.add_options = options.map((r) => String(r.premises_id));
      state.step = "add_select";
      return save({
        text: message(deps.templates, L, "message.registration.add_select", {
          premises: safeBlock(
            numbered(
              options.map((r) =>
                `${esc(label(premiseLabels, r.kind, L, "помещение"))} ${
                  esc(r.code)
                }/${esc(r.number)} — ${esc(label(roleLabels, r.role, L))}`
              ),
            ),
          ),
        }),
        buttons: [
          ...options.map((
            r,
            i,
          ) => [
            btn(
              messageButton(
                deps.templates,
                L,
                "message.registration.add_select",
                "premise",
                { code: r.code, number: r.number },
              ),
              String(i + 1),
            ),
          ]),
          [btn(
            messageButton(
              deps.templates,
              L,
              "message.registration.add_select",
              "manual",
            ),
            "/add manual",
          )],
        ],
      });
    }
    if (
      cmd === "/register" ||
      cmd === "/edit" ||
      (cmd === "/start" && parts[1]?.startsWith("invite_"))
    ) {
      // Повторная регистрация бессмысленна: если анкета уже есть и не отозвана —
      // показываем её актуальный статус вместо мастера. /start invite_*
      // сознательно проходит мимо guard: осознанный путь добавления объекта.
      // Добавление ещё одного помещения — /add, у него отдельная ветка выше.
      if (cmd === "/register") {
        const rows = await exec.query<Row>(
          `select r.id,r.state,r.decided_reason,r.review_stage,r.draft,r.role,p.kind,p.number,b.code
          from registration r join premises p on p.id=r.premises_id join building b on b.id=p.building_id
          where (r.telegram_user_id=$1 or r.person_id=$2)
          and r.state in ('pending_review','need_clarification','approved','rejected')
          order by r.created_at desc limit 20`,
          [telegramId, actor?.person.id ?? null],
        );
        if (rows.length) {
          const hasApproved = rows.some((r) => r.state === "approved");
          return save(
            message(
              deps.templates,
              L,
              hasApproved
                ? "message.registration.already_registered"
                : "message.registration.already_applied",
              {
                registrations: safeBlock(numbered(registrationLines(rows, L))),
              },
            ),
          );
        }
      }
      if (cmd === "/edit") {
        // Номер резолвим до очистки состояния: status_options ещё живы.
        if (!parts[1]) {
          throw new BotTemplateError(
            "VALIDATION_FAILED",
            message(deps.templates, L, "registration.ukazhite_nomer_iz_status"),
          );
        }
        const id = resolveRef(parts[1], [state.status_options as string[]]);
        if (!id) {
          throw new BotTemplateError(
            "VALIDATION_FAILED",
            message(
              deps.templates,
              L,
              "registration.ne_ponyal_ssylku_otkroyte_status_i_ukazhite",
            ),
          );
        }
        const [registration] = await exec.query<Row>(
          "select id from registration where id=$1 and telegram_user_id=$2 and state in ('pending_review','need_clarification','rejected')",
          [id, telegramId],
        );
        if (!registration) throw new ApiError("NOT_FOUND");
        for (const key of Object.keys(state)) delete state[key];
        state.registration_id = id;
        state.step = "language";
        return save(languageStepText(deps.templates));
      }
      for (const key of Object.keys(state)) delete state[key];
      if (parts[1]?.startsWith("invite_")) state.invite = parts[1].slice(7);
      state.step = "language";
      return save(languageStepText(deps.templates));
    }
    if (cmd === "/fix") {
      // Простое исправление анкеты после уточнения: бот сам находит редактируемую
      // анкету и переспрашивает только имя и телефон; помещение, роль и язык
      // сохраняются из анкеты. Номер резолвится по свежему запросу — ничего
      // в состоянии не хранится (иначе воспроизводится баг /edit).
      const rows = await exec.query<Row>(
        `select id,state,decided_reason,draft,premises_id,role from registration
        where telegram_user_id=$1 and is_test=$2 and state in ('need_clarification','rejected','pending_review') and total_due_at is null
        order by case state when 'need_clarification' then 0 when 'rejected' then 1 else 2 end, updated_at desc`,
        [telegramId, actor?.person.isTest ?? false],
      );
      if (!rows.length) {
        return message(
          deps.templates,
          L,
          "registration.anket_dlya_ispravleniya_net_utochneniy_i_otkazov",
        );
      }
      if (!parts[1] && rows.length > 1) {
        return save(
          message(deps.templates, L, "message.registration.fix_select", {
            registrations: safeBlock(
              numbered(
                rows.map((r) =>
                  `<b>${esc(label(stateLabels, r.state, L))}</b>${
                    r.decided_reason
                      ? ` — ${esc(String(r.decided_reason))}`
                      : ""
                  }`
                ),
              ),
            ),
          }),
        );
      }
      const id = parts[1]
        ? resolveRef(parts[1], [rows.map((r) => String(r.id))])
        : String(rows[0]!.id);
      if (!id) {
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          message(
            deps.templates,
            L,
            "registration.ne_ponyal_ssylku_ukazhite_nomer_iz_spiska",
          ),
        );
      }
      const reg = rows.find((r) => String(r.id) === id)!;
      const draft = jsonValue<Row>(reg.draft);
      for (const key of Object.keys(state)) delete state[key];
      state.registration_id = String(reg.id);
      state.language = ["ru", "kk"].includes(String(draft.language))
        ? String(draft.language)
        : "ru";
      state.premises_id = String(reg.premises_id);
      state.role = String(reg.role);
      state.step = "fix_name";
      return save(
        message(
          deps.templates,
          L,
          reg.decided_reason
            ? "message.registration.fix_name_reason"
            : "registration.vvedite_imya_i_familiyu_ili_tochku_chtoby",
          { reason: reg.decided_reason },
        ),
      );
    }
    if (cmd === "/delete") {
      // PRV-02: команда подаёт запрос администратору, а не удаляет анкету;
      // история обращений и операций сохраняется. Подтверждение — кнопкой
      // или текстовым эквивалентом "/delete confirm".
      if (!actor) {
        return save(
          message(
            deps.templates,
            L,
            "registration.snachala_registratsiya_register",
          ),
        );
      }
      if (parts[1] !== "confirm") {
        return save({
          text: message(
            deps.templates,
            L,
            "registration.podat_zapros_na_udalenie_ankety_i_dannyh",
          ),
          buttons: [[
            btn(
              messageButton(
                deps.templates,
                L,
                "registration.podat_zapros_na_udalenie_ankety_i_dannyh",
                "confirm",
              ),
              "/delete confirm",
            ),
            btn(
              messageButton(
                deps.templates,
                L,
                "registration.podat_zapros_na_udalenie_ankety_i_dannyh",
                "cancel",
              ),
              "/cancel",
            ),
          ]],
        });
      }
      await submitPrivacyRequest(d, actor, { kind: "delete_profile" });
      for (const key of Object.keys(state)) delete state[key];
      return save(
        message(
          deps.templates,
          L,
          "registration.zapros_na_udalenie_ankety_otpravlen_administratoru_neobyazatelnye",
        ),
      );
    }
    // /start — короткое приветствие (полная справка остаётся на /help);
    // свободный текст без активного шага — полная справка, как раньше.
    if (cmd === "/start") return welcomeText(L, deps.templates);
    if (!state.step || cmd === "/help") return help();
    switch (state.step) {
      case "language":
        if (!["ru", "kk"].includes(input.trim())) {
          return languageStepText(deps.templates);
        }
        state.language = input.trim();
        state.step = "name";
        return save(
          message(deps.templates, L, "registration.vashe_imya_i_familiya"),
        );
      case "name":
        if (!input.trim() || input.length > 300) {
          throw new ApiError("VALIDATION_FAILED");
        }
        state.full_name = input.trim();
        state.step = "phone";
        return save(message(deps.templates, L, "registration.telefon_7"));
      case "phone": {
        state.phone_e164 = normalizePhone(input);
        if (state.invite) {
          state.step = "consent";
          return save(
            consentText(
              L,
              message(
                deps.templates,
                L,
                "message.registration.invite_consent",
                { full_name: state.full_name, phone: state.phone_e164 },
              ),
              deps.templates,
              "message.registration.invite_consent",
            ),
          );
        }
        return save(await askBuilding(exec, state, L, deps.templates));
      }
      case "add_select": {
        const id = resolveRef(input.trim(), [state.add_options as string[]]);
        if (!id) {
          throw new BotTemplateError(
            "VALIDATION_FAILED",
            message(
              deps.templates,
              L,
              "registration.vyberite_nomer_stroki_iz_spiska_add",
            ),
          );
        }
        // Роль и помещение берём заново: связи могли измениться между /add
        // и выбором номера. Роль связи сохраняется в анкете.
        const [conn] = await exec.query<Row>(
          `select c.role,p.kind,p.number,b.code from connection c
          join premises p on p.id=c.premises_id join building b on b.id=p.building_id
          where c.person_id=$1 and c.premises_id=$2 and c.status='pending'`,
          [actor?.person.id ?? null, id],
        );
        if (!conn) {
          throw new BotTemplateError(
            "INVALID_TRANSITION",
            message(
              deps.templates,
              L,
              "registration.svyaz_uzhe_obrabotana_otpravte_add_zanovo",
            ),
          );
        }
        state.premises_id = id;
        state.kind = String(conn.kind);
        state.role = String(conn.role);
        state.step = "consent";
        return save(
          consentText(
            L,
            message(
              deps.templates,
              L,
              "message.registration.premises_consent",
              {
                full_name: state.full_name,
                phone: state.phone_e164,
                kind: label(premiseLabels, state.kind, L),
                code: conn.code,
                number: conn.number,
                role: label(roleLabels, state.role, L),
              },
            ),
            deps.templates,
            "message.registration.premises_consent",
          ),
        );
      }
      case "building": {
        const selected = (state.buildings as Row[])[Number(input) - 1];
        if (!selected) {
          throw new BotTemplateError(
            "VALIDATION_FAILED",
            message(deps.templates, L, "registration.vyberite_nomer_stroki"),
          );
        }
        state.building_id = selected.id;
        state.step = "kind";
        return save({
          text: message(deps.templates, L, "message.registration.kind", {
            kinds: safeBlock(KIND_TEXT(L)),
          }),
          buttons: KIND_OPTIONS.map((kind, i) => [
            btn(
              messageButton(
                deps.templates,
                L,
                "message.registration.kind",
                "kind",
                { label: label(premiseLabels, kind, L) },
              ),
              String(i + 1),
            ),
          ]),
        });
      }
      case "kind":
        input = (KIND_OPTIONS[Number(input.trim()) - 1] ?? input) as string;
        if (!KIND_OPTIONS.includes(input.trim())) {
          return {
            text: message(deps.templates, L, "message.registration.kind", {
              kinds: safeBlock(KIND_TEXT(L)),
            }),
            buttons: KIND_OPTIONS.map((kind, i) => [
              btn(
                messageButton(
                  deps.templates,
                  L,
                  "message.registration.kind",
                  "kind",
                  { label: label(premiseLabels, kind, L) },
                ),
                String(i + 1),
              ),
            ]),
          };
        }
        state.kind = input.trim();
        state.step = "number";
        return save(
          message(deps.templates, L, "registration.nomer_pomescheniya"),
        );
      case "number": {
        const [premises] = await exec.query<Row>(
          "select id from premises where building_id=$1 and kind=$2 and number=$3 and status='active' and is_test=$4",
          [
            state.building_id,
            state.kind,
            input.trim(),
            actor?.person.isTest ?? false,
          ],
        );
        if (!premises) {
          return message(
            deps.templates,
            L,
            "registration.pomeschenie_ne_naydeno_proverte_nomer_ili_obratites",
          );
        }
        state.premises_id = premises.id;
        state.step = "role";
        return save({
          text: message(deps.templates, L, "message.registration.role", {
            roles: safeBlock(ROLE_TEXT(L)),
          }),
          buttons: ROLE_OPTIONS.map((role, i) => [
            btn(
              messageButton(
                deps.templates,
                L,
                "message.registration.role",
                "role",
                { label: label(roleLabels, role, L) },
              ),
              String(i + 1),
            ),
          ]),
        });
      }
      case "role":
        state.role = (ROLE_OPTIONS[Number(input.trim()) - 1] ??
          input.trim()) as string;
        state.step = "consent";
        return save(
          consentText(
            L,
            message(deps.templates, L, "message.registration.consent", {
              full_name: state.full_name,
              phone: state.phone_e164,
              kind: label(premiseLabels, state.kind, L),
              role: label(roleLabels, state.role, L),
            }),
            deps.templates,
            "message.registration.consent",
          ),
        );
      case "fix_name": {
        const name = input.trim() === "." ? "" : input.trim();
        if (name.length > 300) throw new ApiError("VALIDATION_FAILED");
        if (!name) {
          const [reg] = await exec.query<Row>(
            "select draft from registration where id=$1 and telegram_user_id=$2",
            [state.registration_id, telegramId],
          );
          if (!reg) throw new ApiError("NOT_FOUND");
          state.full_name = jsonValue<Row>(reg.draft).full_name;
        } else state.full_name = name;
        state.step = "fix_phone";
        return save(
          message(
            deps.templates,
            L,
            "registration.telefon_7_ili_tochku_chtoby_ostavit_prezhniy",
          ),
        );
      }
      case "fix_phone": {
        if (input.trim() !== ".") state.phone_e164 = normalizePhone(input);
        else {
          const [reg] = await exec.query<Row>(
            "select draft from registration where id=$1 and telegram_user_id=$2",
            [state.registration_id, telegramId],
          );
          if (!reg) throw new ApiError("NOT_FOUND");
          state.phone_e164 = jsonValue<Row>(reg.draft).phone_e164;
        }
        state.step = "consent";
        return save(
          consentText(
            L,
            message(deps.templates, L, "message.registration.fix_consent", {
              full_name: state.full_name,
              phone: state.phone_e164,
            }),
            deps.templates,
            "message.registration.fix_consent",
          ),
        );
      }
      case "consent": {
        if (!["да", "иә"].includes(input.trim().toLowerCase())) {
          return consentText(
            L,
            message(deps.templates, L, "message.registration.consent_retry"),
            deps.templates,
            "message.registration.consent_retry",
          );
        }
        state.consent = true;
        if (state.invite) {
          if (actor) await acceptInvite(d, actor, String(state.invite));
          else {
            await acceptInviteForNewTelegram(
              d,
              telegramId,
              String(state.invite),
              state,
            );
          }
          for (const key of Object.keys(state)) delete state[key];
          return save(
            message(deps.templates, L, "registration.dostup_podtverzhden"),
          );
        }
        await submitRegistration(d, actor, state, telegramId);
        for (const key of Object.keys(state)) delete state[key];
        return save(
          message(deps.templates, L, "message.registration.submitted"),
        );
      }
    }
    return save(help());
  });
}

/** Вопрос о языке анкеты: единственная сдвоенная реплика — язык ещё не выбран. */
function languageStepText(store?: TemplateStore): BotReply {
  return {
    text: message(store, "ru", "registration.language_prompt"),
    buttons: [[
      btn(
        messageButton(store, "ru", "registration.language_prompt", "ru"),
        "ru",
      ),
      btn(
        messageButton(store, "ru", "registration.language_prompt", "kk"),
        "kk",
      ),
    ]],
  };
}

/** Шаг выбора здания: шаг и список — в состояние диалога, ответ — с кнопками. */
async function askBuilding(
  exec: DbExecutor,
  state: Row,
  L: Lang,
  store?: TemplateStore,
): Promise<BotReply> {
  const buildings = await exec.query<Row>(
    "select id,code,kind from building order by code",
  );
  state.step = "building";
  state.buildings = buildings;
  return {
    text: message(store, L, "message.registration.building", {
      buildings: safeBlock(
        numbered(buildings.map((b) => `${esc(b.code)} (${esc(b.kind)})`)),
      ),
    }),
    buttons: buildings.map((b, i) => [
      btn(
        messageButton(store, L, "message.registration.building", "building", {
          code: b.code,
        }),
        String(i + 1),
      ),
    ]),
  };
}

/** Шаг согласия: текст + кнопка подтверждения с текстовым эквивалентом. */
function consentText(
  lang: Lang,
  text: string,
  store: TemplateStore | undefined,
  key: string,
): BotReply {
  return {
    text,
    buttons: [[
      btn(
        messageButton(store, lang, key, "confirm"),
        lang === "kk" ? "иә" : "да",
      ),
      btn(messageButton(store, lang, key, "cancel"), "/cancel"),
    ]],
  };
}

export function registrationScenarios(deps: RegistryDeps): ScenarioRegistry {
  const scenarios = new ScenarioRegistry();
  scenarios.register({
    id: "registration",
    description: "REG: регистрация, объекты и приглашения",
    run: async (input, ctx) => {
      const [profile] = await deps.db.query<{
        telegram_user_id: string | number;
      }>("select telegram_user_id from profile where id=$1 and is_test=true", [
        ctx.profileId,
      ]);
      if (!profile || !ctx.actor?.emulation) throw new ApiError("FORBIDDEN");
      const reply = await registrationStep(
        {
          ...(ctx.executor ? scopedDeps(deps, ctx.executor) : deps),
          templates: await loadTemplateStore(ctx.executor ?? deps.db),
        },
        String(profile.telegram_user_id),
        input,
        ctx.actor,
      );
      // Эмуляция видит только текст: кнопки — сахар Telegram-транспорта.
      return replyText(reply);
    },
  });
  return scenarios;
}
