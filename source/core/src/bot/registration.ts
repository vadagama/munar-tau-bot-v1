import { premiseLabels, roleLabels, stateLabels } from "../locales/registry.ts";
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
  submitRegistration,
  reviewRegistration,
  revokeOwnConnection,
} from "../domains/registrations/service.ts";
import { ScenarioRegistry } from "./registry.ts";
import { registrationHelp } from "./help.ts";
import { cmd as cmdCode, esc, fmtDate, numbered, resolveRef } from "./text.ts";

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
const TYPES =
  "1. apartment — квартира / пәтер; 2. commercial — коммерческое / коммерциялық; 3. parking_slot — парковочное место / тұрақ орны; 4. storage — кладовка / қойма";
/** Полная справка — HTML-разделы; в реплики не вклеивается, только /help и /start. */
const HELP = registrationHelp();
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
): Promise<string> {
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
    const save = async (reply: string) => {
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
      return save(HELP);
    }
    if (cmd === "/status") {
      const rows = await exec.query<Row>(
        "select id,state,decided_reason,review_stage from registration where telegram_user_id=$1 or person_id=$2 order by created_at desc limit 20",
        [telegramId, actor?.person.id ?? null],
      );
      if (!rows.length) return "Анкет пока нет / Өтінімдер жоқ";
      state.status_options = rows.map((r) => String(r.id));
      return save(
        numbered(rows.map((r) =>
          `<b>${esc(stateLabels[String(r.state)] ?? String(r.state))}</b>${r.decided_reason ? ` — ${esc(String(r.decided_reason))}` : ""}`
        )) +
        `\n${cmdCode("/fix")} — исправить анкету после уточнения; ${cmdCode("/edit НОМЕР")} — заполнить заново / өтінімді түзету`,
      );
    }
    if (cmd === "/pending" || cmd === "/accesses") {
      if (!actor) return "Сначала регистрация / Алдымен тіркеліңіз: /register";
      if (cmd === "/pending") {
        const rows = await exec.query<Row>(
          `select r.id,r.draft,p.kind,p.number from registration r join premises p on p.id=r.premises_id
          where r.review_stage='owner' and r.state in ('pending_review','need_clarification') and r.is_test=$2 and exists(select 1 from connection c where c.person_id=$1 and c.premises_id=r.premises_id and c.status='active' and c.role='owner')`,
          [actor.person.id, actor.person.isTest],
        );
        if (!rows.length)
          return "Анкет на подтверждение нет / Растауды күтетін өтінімдер жоқ";
        state.pending_options = rows.map((r) => String(r.id));
        return save(
          numbered(rows.map((r) => {
            const draft = jsonValue<Row>(r.draft);
            return `<b>${esc(draft.full_name)}</b>, ${esc(draft.phone_e164)}; ${esc(premiseLabels[String(r.kind)] ?? "помещение")} ${esc(r.number)}`;
          })) +
          `\n${cmdCode("/approve НОМЕР")} — подтвердить; ${cmdCode("/reject НОМЕР причина")} — отказ; ${cmdCode("/dispute НОМЕР причина")} — спор`,
        );
      }
      const rows = await exec.query<Row>(
        `select c.id,c.confirmed_by,n.full_name,p.kind,p.number,(select r.id from registration r where r.person_id=c.person_id and r.premises_id=c.premises_id and r.state='approved' order by created_at desc limit 1) as registration_id
        from connection c join premises p on p.id=c.premises_id join person n on n.id=c.person_id where c.role<>'owner' and c.status='active' and n.is_test=$2
        and exists(select 1 from connection o where o.person_id=$1 and o.premises_id=c.premises_id and o.role='owner' and o.status='active')`,
        [actor.person.id, actor.person.isTest],
      );
      if (!rows.length)
        return "Выданных доступов нет / Берілген қолжетімділік жоқ";
      state.access_options = rows.map((r) => String(r.id));
      const disputeRefs = rows.map((r) => r.registration_id).filter(Boolean);
      state.dispute_options = disputeRefs.map(String);
      return save(
        numbered(rows.map((r) =>
          `<b>${esc(r.full_name)}</b>: ${esc(premiseLabels[String(r.kind)] ?? "помещение")} ${esc(r.number)}`
        )) +
        `\n${cmdCode("/revoke НОМЕР причина")} — прекратить доступ / қолжетімділікті тоқтату; ${cmdCode("/dispute НОМЕР причина")} — спор по анкете / өтінім бойынша дау`,
      );
    }
    if (cmd === "/objects") {
      if (!actor) return "Сначала регистрация / Алдымен тіркеліңіз: /register";
      const rows = await exec.query<Row>(
        "select c.id,c.premises_id,c.role,c.status,p.kind,p.number,b.code from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id where c.person_id=$1",
        [actor.person.id],
      );
      if (!rows.length)
        return "Подтверждённых объектов нет / Расталған нысандар жоқ";
      const seen = new Set<string>();
      state.object_options = rows.flatMap((r) => {
        const id = String(r.premises_id);
        if (seen.has(id)) return [];
        seen.add(id);
        return [id];
      });
      return save(
        numbered(rows.map((r) =>
          `${esc(premiseLabels[String(r.kind)] ?? "помещение")} ${esc(r.code)}/${esc(r.number)} — ${esc(roleLabels[String(r.role)] ?? String(r.role))}, ${esc(stateLabels[String(r.status)] ?? String(r.status))}`
        )) +
        `\n${cmdCode("/invite НОМЕР tenant|resident|other")} — пригласить жильца / тұрғынды шақыру`,
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
      if (!actor) return "Сначала регистрация / Алдымен тіркеліңіз: /register";
      if (!parts[1])
        throw new ApiError("VALIDATION_FAILED", "Укажите номер из списка или ID / Тізім нөмірін немесе ID-ны көрсетіңіз");
      /** Ссылка на объект: номер строки последнего списка или UUID. */
      const ref = (groups: (string[] | undefined)[]): string => {
        const id = resolveRef(parts[1], groups);
        if (!id)
          throw new ApiError(
            "VALIDATION_FAILED",
            "Не понял ссылку. Откройте список и укажите номер строки / Тізім нөмірін көрсетіңіз",
          );
        return id;
      };
      if (cmd === "/invite") {
        const invite = await createInvite(d, actor, {
          premises_id: ref([state.object_options as string[]]),
          role: parts[2],
        });
        return `Приглашение / Шақыру: ${cmdCode(`/start invite_${invite.token}`)}\nДействует до / Жарамды: ${fmtDate(invite.expires_at)}`;
      }
      if (cmd === "/accept") {
        await acceptInvite(d, actor, parts[1]);
        return "Доступ подтверждён / Қолжетімділік расталды";
      }
      if (cmd === "/revoke") {
        await revokeOwnConnection(
          d,
          actor,
          ref([state.access_options as string[]]),
          parts.slice(2).join(" "),
        );
        return "Связь прекращена / Байланыс тоқтатылды";
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
          reason:
            parts.slice(2).join(" ") ||
            "Решение собственника / Меншік иесінің шешімі",
        },
        true,
      );
      return "Решение сохранено / Шешім сақталды";
    }
    if (
      cmd === "/register" ||
      cmd === "/add" ||
      cmd === "/edit" ||
      (cmd === "/start" && parts[1]?.startsWith("invite_"))
    ) {
      if (cmd === "/edit") {
        // Номер резолвим до очистки состояния: status_options ещё живы.
        if (!parts[1])
          throw new ApiError(
            "VALIDATION_FAILED",
            "Укажите номер из /status или ID анкеты / Тізім нөмірін немесе ID-ны көрсетіңіз",
          );
        const id = resolveRef(parts[1], [state.status_options as string[]]);
        if (!id)
          throw new ApiError(
            "VALIDATION_FAILED",
            "Не понял ссылку. Откройте /status и укажите номер строки / Тізім нөмірін көрсетіңіз",
          );
        const [registration] = await exec.query<Row>(
          "select id from registration where id=$1 and telegram_user_id=$2 and state in ('pending_review','need_clarification','rejected')",
          [id, telegramId],
        );
        if (!registration) throw new ApiError("NOT_FOUND");
        for (const key of Object.keys(state)) delete state[key];
        state.registration_id = id;
        state.step = "language";
        return save("Выберите язык / Тілді таңдаңыз: ru / kk");
      }
      for (const key of Object.keys(state)) delete state[key];
      if (parts[1]?.startsWith("invite_")) state.invite = parts[1].slice(7);
      state.step = "language";
      return save("Выберите язык / Тілді таңдаңыз: ru / kk");
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
      if (!rows.length)
        return "Анкет для исправления нет: уточнений и отказов не найдено. /register — новая анкета. / Түзететін өтінім жоқ. /register — жаңа өтінім";
      if (!parts[1] && rows.length > 1)
        return (
          numbered(rows.map((r) =>
            `<b>${esc(stateLabels[String(r.state)] ?? String(r.state))}</b>${r.decided_reason ? ` — ${esc(String(r.decided_reason))}` : ""}`,
          )) +
          `\n${cmdCode("/fix НОМЕР")} — какую анкету исправить? / Қайсысын түзетеміз?`
        );
      const id = parts[1]
        ? resolveRef(parts[1], [rows.map((r) => String(r.id))])
        : String(rows[0]!.id);
      if (!id)
        throw new ApiError(
          "VALIDATION_FAILED",
          "Не понял ссылку. Укажите номер из списка / Тізім нөмірін көрсетіңіз",
        );
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
        (reg.decided_reason
          ? `Вопрос администратора / Әкімшінің сұрағы: ${esc(String(reg.decided_reason))}\n`
          : "") +
          "Введите имя и фамилию (или точку, чтобы оставить прежнее) / Аты-жөнді жазыңыз (немесе нүкте — өзгеріссіз):",
      );
    }
    if (!state.step || cmd === "/start" || cmd === "/help") return HELP;
    switch (state.step) {
      case "language":
        if (!["ru", "kk"].includes(input.trim())) return "ru / kk";
        state.language = input.trim();
        state.step = "name";
        return save("Ваше имя и фамилия / Аты-жөніңіз:");
      case "name":
        if (!input.trim() || input.length > 300)
          throw new ApiError("VALIDATION_FAILED");
        state.full_name = input.trim();
        state.step = "phone";
        return save("Телефон / Телефон нөмірі (+7…):");
      case "phone": {
        state.phone_e164 = normalizePhone(input);
        if (state.invite) {
          state.step = "consent";
          return save(
            "Подтвердите сведения и согласие на обработку имени и телефона для доступа к сервисам ОСИ: да / иә. Для отмены /cancel. / ОСИ қызметтеріне қол жеткізу үшін аты-жөніңіз бен телефонды өңдеуге келісіңіз: иә.",
          );
        }
        const buildings = await exec.query<Row>(
          "select id,code,kind from building order by code",
        );
        state.buildings = buildings;
        state.step = "building";
        return save(
          "Выберите номер строки здания / Ғимарат жолының нөмірін таңдаңыз:\n" +
            numbered(
              buildings.map((b) => `${esc(b.code)} (${esc(b.kind)})`),
            ),
        );
      }
      case "building": {
        const selected = (state.buildings as Row[])[Number(input) - 1];
        if (!selected)
          throw new ApiError("VALIDATION_FAILED", "Выберите номер строки");
        state.building_id = selected.id;
        state.step = "kind";
        return save(TYPES);
      }
      case "kind":
        input =
          (
            {
              "1": "apartment",
              "2": "commercial",
              "3": "parking_slot",
              "4": "storage",
            } as Record<string, string>
          )[input.trim()] ?? input;
        if (
          !["apartment", "commercial", "parking_slot", "storage"].includes(
            input.trim(),
          )
        )
          return TYPES;
        state.kind = input.trim();
        state.step = "number";
        return save("Номер помещения / Нысан нөмірі:");
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
        if (!premises)
          return "Помещение не найдено. Проверьте номер или обратитесь к администратору. / Нысан табылмады. Нөмірін тексеріңіз немесе әкімшіге хабарласыңыз.";
        state.premises_id = premises.id;
        state.step = "role";
        return save(
          "Отношение / Қатынас: 1. owner — собственник / меншік иесі; 2. tenant — арендатор / жалға алушы; 3. resident — проживающий / тұрғын; 4. other — пользователь / пайдаланушы",
        );
      }
      case "role":
        state.role =
          (
            {
              "1": "owner",
              "2": "tenant",
              "3": "resident",
              "4": "other",
            } as Record<string, string>
          )[input.trim()] ?? input.trim();
        state.step = "consent";
        return save(
          `<b>Проверьте / Тексеріңіз</b>: ${esc(state.full_name)}, ${esc(state.phone_e164)}, ${esc(premiseLabels[String(state.kind)] ?? state.kind)}, ${esc(roleLabels[String(state.role)] ?? state.role)}.\nСогласие на обработку этих данных для регистрации в ОСИ: да / иә. Отмена: ${cmdCode("/cancel")}. / ОСИ тіркелуі үшін осы деректерді өңдеуге келісіңіз: иә.`,
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
          "Телефон (+7…) — или точку, чтобы оставить прежний / Телефон (+7…) — немесе нүкте — өзгеріссіз:",
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
          `<b>Проверьте / Тексеріңіз</b>: ${esc(String(state.full_name))}, ${esc(String(state.phone_e164))}. Помещение и роль сохранены / Нысан мен рөл сақталды.\nСогласие на обработку этих данных для регистрации в ОСИ: да / иә. Отмена: ${cmdCode("/cancel")}. / ОСИ тіркелуі үшін осы деректерді өңдеуге келісіңіз: иә.`,
        );
      }
      case "consent": {
        if (!["да", "иә"].includes(input.trim().toLowerCase()))
          return "Для согласия / Келісу үшін: да / иә. Отмена / Бас тарту: /cancel";
        state.consent = true;
        if (state.invite) {
          if (actor) await acceptInvite(d, actor, String(state.invite));
          else
            await acceptInviteForNewTelegram(
              d,
              telegramId,
              String(state.invite),
              state,
            );
          for (const key of Object.keys(state)) delete state[key];
          return save("Доступ подтверждён / Қолжетімділік расталды");
        }
        await submitRegistration(d, actor, state, telegramId);
        for (const key of Object.keys(state)) delete state[key];
        return save(
          `Анкета принята, доступ ожидает подтверждения / Өтінім қабылданды, қолжетімділік растауды күтуде.\n${cmdCode("/status")} — статус анкеты / өтінім күйі`,
        );
      }
    }
    return HELP;
  });
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
      return registrationStep(
        ctx.executor ? scopedDeps(deps, ctx.executor) : deps,
        String(profile.telegram_user_id),
        input,
        ctx.actor,
      );
    },
  });
  return scenarios;
}
