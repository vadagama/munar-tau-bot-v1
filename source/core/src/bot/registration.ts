import { navigationReply } from "./navigation.ts";
import { loadDialog, saveDialog } from "./dialog.ts";
import { withSimulatorMenu } from "./simulator-menu.ts";
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
import { manageRegistration, withdrawUnconfirmedRegistration } from "../domains/registrations/management.ts";
import { ScenarioRegistry } from "./registry.ts";
import { menuCommand, registrationHelp, welcomeText } from "./help.ts";
import { type BotReply, btn } from "./keyboard.ts";
import {
  buildingCodeMatches,
  esc,
  fmtDate,
  type Lang,
  langOf,
  normalizeBuildingCode,
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
function registrationLines(rows: Row[], L: Lang, store?: TemplateStore): string[] {
  return rows.map((r) => {
    const draft = r.draft ? jsonValue<Row>(r.draft) : {};
    // Анкета-минимум (REG-01) без помещения и роли — только имя и состояние.
    const place = r.premises_id
      ? `${esc(label(premiseLabels, r.kind, L, "помещение"))} ${
        esc(r.code ?? "—")
      }/${esc(r.number ?? "—")}`
      : esc(message(store, L, "registration.pomeschenie_ne_ukazano"));
    return `<b>${esc(label(stateLabels, r.state, L))}</b>: ${
      esc(draft.full_name ?? "—")
    }, ${place}${
      r.role ? `, ${esc(label(roleLabels, r.role, L))}` : ""
    }${
      r.decided_reason ? ` — ${esc(String(r.decided_reason))}` : ""
    }${r.confirmed_draft ? `\n${esc(message(store, L, "registration.previous_access_retained"))}` : ""}`;
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
    const bot = deps.bot ?? "resident";
    const state = await loadDialog(exec, telegramId, bot, actor?.profile.id ?? null, actor?.emulation?.sessionId ?? null, "registration");
    // Язык подачи: выбранный в диалоге, иначе язык профиля, иначе русский.
    const L: Lang = langOf(state.language ?? actor?.profile.language);
    const help = () => registrationHelp(L, deps.templates);
    const save = async (reply: BotReply) => {
      await saveDialog(exec, telegramId, bot, state);
      return reply;
    };
    input = menuCommand(input, deps.templates) ?? input;
    const parts = input.trim().split(/\s+/),
      cmd = parts[0];
    if (cmd === "/cancel") {
      for (const key of Object.keys(state)) delete state[key];
      return save(help());
    }
    if (cmd === "/start" && !parts[1]?.startsWith("invite_")) {
      for (const key of Object.keys(state)) delete state[key];
      return save(welcomeText(L, deps.templates));
    }
    if (cmd === "/status") {
      const rows = await exec.query<Row>(
        `select r.id,r.state,r.confirmed_draft,r.decided_reason,r.review_stage,r.draft,r.role,r.premises_id,p.kind,p.number,b.code,
        exists(select 1 from connection c where c.person_id=r.person_id and c.status='active') as has_active_premises
        from registration r left join premises p on p.id=r.premises_id left join building b on b.id=p.building_id
        where (r.telegram_user_id=$1 or r.person_id=$2) and r.superseded_by is null order by r.created_at desc limit 20`,
        [telegramId, actor?.person.id ?? null],
      );
      if (!rows.length) {
        return message(deps.templates, L, "registration.anket_poka_net");
      }
      state.status_options = rows.map((r) => String(r.id));
      const registeredWithoutPremises = rows.length === 1 && rows[0]!.state === "approved" &&
        rows[0]!.premises_id === null && !rows[0]!.has_active_premises;
      // Кнопка доступна только редактируемым анкетам: /edit проверит и ответит.
      const editable = new Set([
        "pending_review",
        "need_clarification",
        "rejected",
        "approved",
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
      if (rows.some(r => r.state !== "withdrawn")) buttons.push([
        btn(messageButton(deps.templates, L, "message.registration.status", "delete"), "/delete"),
      ]);
      if (registeredWithoutPremises) buttons.unshift([
        btn(messageButton(deps.templates, L, "message.registration.status_registered_without_premises", "add"), "/add"),
      ]);
      return save({
        text: message(deps.templates, L,
          registeredWithoutPremises
            ? "message.registration.status_registered_without_premises"
            : "message.registration.status", {
          registrations: safeBlock(
            numbered(registrationLines(rows, L, deps.templates)),
          ),
        }),
        ...(buttons.length ? { buttons } : {}),
      });
    }
    if (cmd === "/pending" || cmd === "/accesses") {
      if (!actor) {
        return save(registerPrompt(deps.templates, L));
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
          // Решение по каждой анкете — кнопкой; отказ и спор спросят причину.
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
            btn(
              messageButton(
                deps.templates,
                L,
                "message.registration.pending",
                "reject",
                { index: i + 1 },
              ),
              `/reject ${i + 1}`,
            ),
            btn(
              messageButton(
                deps.templates,
                L,
                "message.registration.pending",
                "dispute",
                { index: i + 1 },
              ),
              `/dispute ${i + 1}`,
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
      return save({
        text: message(deps.templates, L, "message.registration.accesses", {
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
        // Прекратить и оспорить — кнопками; обе спросят причину.
        buttons: rows.map((r, i) => [
          btn(
            messageButton(
              deps.templates,
              L,
              "message.registration.accesses",
              "revoke",
              { index: i + 1 },
            ),
            `/revoke ${i + 1}`,
          ),
          btn(
            messageButton(
              deps.templates,
              L,
              "message.registration.accesses",
              "dispute",
              { index: i + 1 },
            ),
            `/dispute ${i + 1}`,
          ),
        ]),
      });
    }
    if (cmd === "/objects") {
      if (!actor) {
        return save(registerPrompt(deps.templates, L));
      }
      const rows = await exec.query<Row>(
        "select c.id,c.premises_id,c.role,c.status,p.kind,p.number,b.code from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id where c.person_id=$1",
        [actor.person.id],
      );
      if (!rows.length) {
        const key = "registration.podtverzhdennyh_obektov_net";
        return save({
          text: message(deps.templates, L, key),
          buttons: [[
            btn(messageButton(deps.templates, L, key, "add"), "/add"),
            btn(messageButton(deps.templates, L, key, "cancel"), "/cancel"),
          ]],
        });
      }
      const seen = new Set<string>();
      state.object_options = rows.flatMap((r) => {
        const id = String(r.premises_id);
        if (seen.has(id)) return [];
        seen.add(id);
        return [id];
      });
      return save({
        text: message(deps.templates, L, "message.registration.objects", {
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
        buttons: [[
          btn(
            messageButton(
              deps.templates,
              L,
              "message.registration.objects",
              "invite",
            ),
            "/invite",
          ),
        ]],
      });
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
        return save(registerPrompt(deps.templates, L));
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
        if (!parts[1]) {
          const options = state.object_options as string[] | undefined;
          if (!options?.length) {
            throw new BotTemplateError(
              "VALIDATION_FAILED",
              message(
                deps.templates,
                L,
                "registration.ukazhite_nomer_iz_spiska",
              ),
            );
          }
          if (options.length === 1) {
            parts[1] = "1";
          } else {
            // Несколько помещений: выбор строки кнопками, затем роль.
            const rows = await exec.query<Row>(
              "select c.premises_id,p.kind,p.number,b.code from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id where c.person_id=$1",
              [actor.person.id],
            );
            const seen = new Set<string>();
            const optRows: Row[] = [];
            for (const r of rows) {
              const id = String(r.premises_id);
              if (!seen.has(id)) {
                seen.add(id);
                optRows.push(r);
              }
            }
            return save({
              text: message(
                deps.templates,
                L,
                "registration.ukazhite_nomer_iz_spiska",
              ),
              buttons: optRows.map((r, i) => [
                btn(
                  messageButton(
                    deps.templates,
                    L,
                    "message.registration.objects",
                    "invite_premise",
                    { code: r.code, number: r.number },
                  ),
                  `/invite ${i + 1}`,
                ),
              ]),
            });
          }
        }
        const role = roleFromWord(parts[2]);
        if (!role) {
          // Роль не указана: выбор роли кнопками для выбранного помещения.
          return save({
            text: message(
              deps.templates,
              L,
              "registration.ukazhite_rol_arendator_prozhivayuschiy_ili_drugoe",
            ),
            buttons: ["tenant", "resident", "other"].map((id) => [
              btn(
                messageButton(
                  deps.templates,
                  L,
                  "registration.ukazhite_rol_arendator_prozhivayuschiy_ili_drugoe",
                  "role",
                  { label: label(roleLabels, id, L) },
                ),
                `/invite ${parts[1]} ${id}`,
              ),
            ]),
          });
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
        const reason = parts.slice(2).join(" ");
        const target = ref([state.access_options as string[]]);
        if (!reason) {
          state.reason_action = "revoke";
          state.reason_id = target;
          state.step = "reason_prompt";
          return save(reasonPromptText(deps.templates, L));
        }
        await revokeOwnConnection(d, actor, target, reason);
        return save(
          message(deps.templates, L, "registration.svyaz_prekraschena"),
        );
      }
      const decision = cmd === "/approve"
        ? "approve"
        : cmd === "/reject"
        ? "reject"
        : "dispute";
      const reason = parts.slice(2).join(" ");
      const target = ref([
        state.pending_options as string[],
        state.dispute_options as string[],
        state.status_options as string[],
      ]);
      if (decision !== "approve" && !reason) {
        // Отказ и спор требуют основания: номер резолвим сразу, а следующее
        // сообщение собственника станет причиной решения (как в /edit —
        // резолв до очистки состояния).
        state.reason_action = decision;
        state.reason_id = target;
        state.step = "reason_prompt";
        return save(reasonPromptText(deps.templates, L));
      }
      await reviewRegistration(
        d,
        actor,
        target,
        decision,
        {
          reason: reason ||
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
        // Анкета-минимум (REG-01): сначала базовая регистрация, привязка
        // помещения доступна после одобрения анкеты.
        return save(registerPrompt(deps.templates, L));
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
          `select r.id,r.state,r.confirmed_draft,r.decided_reason,r.review_stage,r.draft,r.role,r.premises_id,p.kind,p.number,b.code,
          r.created_at, exists(select 1 from connection c where c.person_id=r.person_id and c.status='active') as has_active_premises
          from registration r left join premises p on p.id=r.premises_id left join building b on b.id=p.building_id
          where (r.telegram_user_id=$1 or r.person_id=$2)
          and r.superseded_by is null and r.state in ('pending_review','need_clarification','approved','rejected')
          order by r.created_at desc limit 20`,
          [telegramId, actor?.person.id ?? null],
        );
        if (rows.length) {
          const hasApproved = rows.some((r) => r.state === "approved");
          const primary = rows.find(r => r.state === "approved" && r.premises_id === null);
          const withoutPremises = primary && !primary.has_active_premises;
          const key = withoutPremises
            ? "message.registration.already_registered_without_premises"
            : hasApproved
            ? "message.registration.already_registered"
            : "message.registration.already_applied";
          const confirmed = primary ? jsonValue<Row>(primary.confirmed_draft ?? primary.draft) : {};
          return save({
            text: message(deps.templates, L, key, {
              ...(withoutPremises ? {
                full_name: confirmed.full_name ?? actor?.person.fullName ?? "—",
                registered_at: fmtDate(primary.created_at),
              } : {}),
              registrations: safeBlock(
                numbered(registrationLines(rows, L, deps.templates)),
              ),
            }),
            buttons: [[
              btn(
                messageButton(deps.templates, L, key, "status"),
                "/status",
              ),
              btn(
                messageButton(deps.templates, L, key, "fix"),
                "/fix",
              ),
              btn(
                messageButton(deps.templates, L, key, "add"),
                "/add",
              ),
              btn(messageButton(deps.templates, L, key, "delete"), "/delete"),
            ]],
          });
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
          "select id,premises_id,version from registration where id=$1 and telegram_user_id=$2 and superseded_by is null and state in ('pending_review','need_clarification','rejected','approved')",
          [id, telegramId],
        );
        if (!registration) throw new ApiError("NOT_FOUND");
        for (const key of Object.keys(state)) delete state[key];
        state.registration_id = id;
        state.expected_version = registration.version;
        // Анкета-минимум (REG-01) редактируется без помещения: роль и дом не спрашиваем.
        if (!registration.premises_id) state.mode = "lite";
        state.step = "language";
        return save(languageStepText(deps.templates));
      }
      for (const key of Object.keys(state)) delete state[key];
      if (parts[1]?.startsWith("invite_")) state.invite = parts[1].slice(7);
      else state.mode = "lite"; // /register — анкета-минимум без помещения и роли.
      state.step = "language";
      return save(languageStepText(deps.templates));
    }
    if (cmd === "/fix") {
      // Простое исправление анкеты после уточнения: бот сам находит редактируемую
      // анкету и переспрашивает только имя и телефон; помещение, роль и язык
      // сохраняются из анкеты. Номер резолвится по свежему запросу — ничего
      // в состоянии не хранится (иначе воспроизводится баг /edit).
      const rows = await exec.query<Row>(
        `select id,state,decided_reason,draft,premises_id,role,version from registration
        where telegram_user_id=$1 and is_test=$2 and superseded_by is null and state in ('need_clarification','rejected','pending_review','approved') and (total_due_at is null or state='approved')
        order by case state when 'need_clarification' then 0 when 'rejected' then 1 else 2 end, updated_at desc`,
        [telegramId, actor?.person.isTest ?? false],
      );
      if (!rows.length) {
        return {
          text: message(
            deps.templates,
            L,
            "registration.anket_dlya_ispravleniya_net_utochneniy_i_otkazov",
          ),
          buttons: [[
            btn(
              messageButton(
                deps.templates,
                L,
                "registration.anket_dlya_ispravleniya_net_utochneniy_i_otkazov",
                "register",
              ),
              "/register",
            ),
          ]],
        };
      }
      if (!parts[1] && rows.length > 1) {
        return save({
          text: message(deps.templates, L, "message.registration.fix_select", {
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
          // Запрос /fix уже отфильтровал редактируемые состояния — кнопка у каждой строки.
          buttons: rows.map((r, i) => [
            btn(
              messageButton(
                deps.templates,
                L,
                "message.registration.fix_select",
                "fix",
                { index: i + 1 },
              ),
              `/fix ${i + 1}`,
            ),
          ]),
        });
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
      state.expected_version = reg.version;
      state.language = ["ru", "kk"].includes(String(draft.language))
        ? String(draft.language)
        : "ru";
      // Анкета-минимум (REG-01) хранится без помещения: String(null) даёт "null"
      // и уводит повторную подачу в поиск несуществующего помещения.
      if (reg.premises_id) state.premises_id = String(reg.premises_id);
      if (reg.role) state.role = String(reg.role);
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
      if (parts[1] !== "confirm") {
        const [row] = await exec.query<Row>(
          "select id,version from registration where telegram_user_id=$1 and superseded_by is null and state<>'withdrawn' order by (premises_id is null) desc,created_at desc limit 1", [telegramId],
        );
        if (!row) return save(message(deps.templates, L, "registration.anket_poka_net"));
        state.delete_id = row.id;
        state.delete_version = row.version;
        state.delete_key = crypto.randomUUID();
        return save({
          text: message(deps.templates, L, "registration.delete_confirm"),
          buttons: [[btn(messageButton(deps.templates, L, "registration.delete_confirm", "confirm"), "/delete confirm"),
            btn(messageButton(deps.templates, L, "registration.delete_confirm", "cancel"), "/cancel")]],
        });
      }
      if (!state.delete_id || !state.delete_key) throw new ApiError("INVALID_TRANSITION");
      if (actor) await manageRegistration(d, actor, String(state.delete_id), {
        operation: "delete", expected_version: state.delete_version,
        reason: message(deps.templates, L, "registration.delete_own_reason"),
      }, state.delete_key);
      else await withdrawUnconfirmedRegistration(d, telegramId, String(state.delete_id), Number(state.delete_version));
      for (const key of Object.keys(state)) delete state[key];
      return save(message(deps.templates, L, "registration.deleted"));
    }
    // свободный текст без активного шага — полная справка, как раньше.
    if (!state.step || cmd === "/help") return help();
    switch (state.step) {
      case "language":
        if (!["ru", "kk"].includes(input.trim())) {
          return languageStepText(deps.templates);
        }
        state.language = input.trim();
        state.step = "name";
        return save({
          text: message(deps.templates, L, "registration.vashe_imya_i_familiya"),
          buttons: [[btn(messageButton(deps.templates, L, "bot.controls", "cancel"), "/cancel")]],
        });
      case "name":
        if (!input.trim() || input.length > 300) {
          throw new ApiError("VALIDATION_FAILED");
        }
        state.full_name = input.trim();
        state.step = "phone";
        return save({
          text: message(deps.templates, L, "registration.telefon_7"),
          buttons: [[btn(messageButton(deps.templates, L, "bot.controls", "cancel"), "/cancel")]],
        });
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
        // Анкета-минимум (REG-01): после телефона сразу согласие — без дома,
        // типа, номера и роли; привязка помещения — отдельно через /add.
        if (state.mode === "lite") {
          state.step = "consent";
          return save(
            consentText(
              L,
              message(
                deps.templates,
                L,
                "message.registration.lite_consent",
                { full_name: state.full_name, phone: state.phone_e164 },
              ),
              deps.templates,
              "message.registration.lite_consent",
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
          return save({
            text: message(
              deps.templates,
              L,
              "registration.svyaz_uzhe_obrabotana_otpravte_add_zanovo",
            ),
            buttons: [[
              btn(
                messageButton(
                  deps.templates,
                  L,
                  "registration.svyaz_uzhe_obrabotana_otpravte_add_zanovo",
                  "add",
                ),
                "/add",
              ),
            ]],
          });
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
        // Номер дома текстом с автопроверкой (REG-11): «/», «-» и пробелы
        // равнозначны; не найден — повтор с примером.
        const code = normalizeBuildingCode(input);
        const buildings = code
          ? await exec.query<Row>("select id,code from building order by code")
          : [];
        const selected = buildings.find((b) =>
          buildingCodeMatches(b.code, input)
        );
        if (!selected) {
          return save(await askBuilding(exec, state, L, deps.templates));
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
        const submitted = await submitRegistration(d, actor, state, telegramId);
        const submittedKey = submitted?.confirmed_draft ? "message.registration.correction_submitted" : "message.registration.submitted";
        for (const key of Object.keys(state)) delete state[key];
        return save({
          text: message(
            deps.templates,
            L,
            submittedKey,
          ),
          buttons: [[
            btn(
              messageButton(
                deps.templates,
                L,
                submittedKey,
                "status",
              ),
              "/status",
            ),
          ]],
        });
      }
      case "reason_prompt": {
        // Причина решения: следующее после вопроса сообщение — основание.
        if (!actor) {
          return save(registerPrompt(deps.templates, L));
        }
        const reason = input.trim();
        if (!reason) return reasonPromptText(deps.templates, L);
        const action = String(state.reason_action ?? "");
        const target = String(state.reason_id ?? "");
        if (!target) throw new ApiError("NOT_FOUND");
        for (const key of Object.keys(state)) delete state[key];
        if (action === "revoke") {
          await revokeOwnConnection(d, actor, target, reason);
        } else {
          await reviewRegistration(
            d,
            actor,
            target,
            action === "dispute" ? "dispute" : "reject",
            { reason },
            true,
          );
        }
        return save(
          message(
            deps.templates,
            L,
            action === "revoke"
              ? "registration.svyaz_prekraschena"
              : "registration.reshenie_sohraneno",
          ),
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

/** Вопрос о причине решения: ответ — следующим сообщением, отмена — /cancel. */
function reasonPromptText(store?: TemplateStore, L: Lang = "ru"): BotReply {
  return {
    text: message(store, L, "message.registration.reason_prompt"),
    buttons: [[
      btn(
        messageButton(store, L, "message.registration.reason_prompt", "cancel"),
        "/cancel",
      ),
    ]],
  };
}

/** Заглушка без профиля: приглашение к регистрации кнопкой мастера. */
function registerPrompt(store?: TemplateStore, L: Lang = "ru"): BotReply {
  return {
    text: message(store, L, "registration.snachala_registratsiya_register"),
    buttons: [[
      btn(
        messageButton(
          store,
          L,
          "registration.snachala_registratsiya_register",
          "register",
        ),
        "/register",
      ),
    ]],
  };
}

/** Шаг выбора здания текстом (REG-11): список всех домов не выводится. */
async function askBuilding(
  exec: DbExecutor,
  state: Row,
  L: Lang,
  store?: TemplateStore,
): Promise<BotReply> {
  state.step = "building";
  return {
    text: message(store, L, "message.registration.building"),
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
      const [profile] = await (ctx.executor ?? deps.db).query<{
        telegram_user_id: string | number;
      }>("select telegram_user_id from profile where id=$1 and is_test=true", [
        ctx.profileId,
      ]);
      if (!profile || !ctx.actor?.emulation) throw new ApiError("FORBIDDEN");
      const templates = await loadTemplateStore(ctx.executor ?? deps.db);
      const reply = await registrationStep(
        {
          ...(ctx.executor ? scopedDeps(deps, ctx.executor) : deps),
          templates,
        },
        String(profile.telegram_user_id),
        input,
        ctx.actor,
      );
      return withSimulatorMenu(navigationReply(reply,"registration",ctx.actor.profile.language,templates,input), "registration", ctx.actor.profile.language, templates, input);
    },
  });
  return scenarios;
}
