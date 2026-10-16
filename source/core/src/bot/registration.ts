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
const HELP =
  "/register — регистрация / тіркелу; /add — добавить объект / нысан қосу; /status — статус / күйі; /edit ID — исправить анкету / өтінімді түзету; /pending — анкеты арендаторов / жалға алушылар өтінімдері; /accesses — выданные доступы / берілген қолжетімділік; /objects — мои объекты / менің нысандарым; /invite ID tenant|resident|other; /approve ID; /reject ID причина; /dispute ID причина; /revoke ID причина. Общая справка / Жалпы ақпарат: ОСИ ЖК «Мунар Тау». При непосредственной угрозе жизни звоните 112 / Өмірге тікелей қауіп төнсе 112 нөміріне қоңырау шалыңыз.";
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
        "update bot_dialog set state=$2::jsonb,updated_at=now() where telegram_user_id=$1",
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
      return rows.length
        ? rows
            .map(
              (r) =>
                `${r.id}: ${stateLabels[String(r.state)] ?? r.state} ${r.decided_reason ?? ""}`,
            )
            .join("\n")
        : "Анкет пока нет / Өтінімдер жоқ";
    }
    if (cmd === "/pending" || cmd === "/accesses") {
      if (!actor) return "Сначала регистрация / Алдымен тіркеліңіз: /register";
      if (cmd === "/pending") {
        const rows = await exec.query<Row>(
          `select r.id,r.draft,p.kind,p.number from registration r join premises p on p.id=r.premises_id
          where r.review_stage='owner' and r.state in ('pending_review','need_clarification') and r.is_test=$2 and exists(select 1 from connection c where c.person_id=$1 and c.premises_id=r.premises_id and c.status='active' and c.role='owner')`,
          [actor.person.id, actor.person.isTest],
        );
        return rows.length
          ? rows
              .map((r) => {
                const draft = jsonValue<Row>(r.draft);
                return `${r.id}: ${draft.full_name}, ${draft.phone_e164}; ${premiseLabels[String(r.kind)]} ${r.number}`;
              })
              .join("\n")
          : "Анкет на подтверждение нет / Растауды күтетін өтінімдер жоқ";
      }
      const rows = await exec.query<Row>(
        `select c.id,c.confirmed_by,n.full_name,p.kind,p.number,(select r.id from registration r where r.person_id=c.person_id and r.premises_id=c.premises_id and r.state='approved' order by created_at desc limit 1) as registration_id
        from connection c join premises p on p.id=c.premises_id join person n on n.id=c.person_id where c.role<>'owner' and c.status='active' and n.is_test=$2
        and exists(select 1 from connection o where o.person_id=$1 and o.premises_id=c.premises_id and o.role='owner' and o.status='active')`,
        [actor.person.id, actor.person.isTest],
      );
      return rows.length
        ? rows
            .map(
              (r) =>
                `${r.full_name}: ${premiseLabels[String(r.kind)]} ${r.number}; /revoke ${r.id} причина; /dispute ${r.registration_id} причина`,
            )
            .join("\n")
        : "Выданных доступов нет / Берілген қолжетімділік жоқ";
    }
    if (cmd === "/objects") {
      if (!actor) return "Сначала регистрация / Алдымен тіркеліңіз: /register";
      const rows = await exec.query<Row>(
        "select c.id,c.premises_id,c.role,c.status,p.kind,p.number,b.code from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id where c.person_id=$1",
        [actor.person.id],
      );
      return rows.length
        ? rows
            .map(
              (r) =>
                `${premiseLabels[String(r.kind)]} ${r.code}/${r.number}: ${roleLabels[String(r.role)]} ${stateLabels[String(r.status)]}; premises=${r.premises_id}; connection=${r.id}`,
            )
            .join("\n")
        : "Подтверждённых объектов нет / Расталған нысандар жоқ";
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
        throw new ApiError("VALIDATION_FAILED", "Укажите ID / ID көрсетіңіз");
      if (cmd === "/invite") {
        const invite = await createInvite(d, actor, {
          premises_id: parts[1],
          role: parts[2],
        });
        return `Приглашение / Шақыру: /start invite_${invite.token}\nДействует до / Жарамды: ${invite.expires_at}`;
      }
      if (cmd === "/accept") {
        await acceptInvite(d, actor, parts[1]);
        return "Доступ подтверждён / Қолжетімділік расталды";
      }
      if (cmd === "/revoke") {
        await revokeOwnConnection(d, actor, parts[1], parts.slice(2).join(" "));
        return "Связь прекращена / Байланыс тоқтатылды";
      }
      await reviewRegistration(
        d,
        actor,
        parts[1],
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
      for (const key of Object.keys(state)) delete state[key];
      if (cmd === "/edit") {
        if (!parts[1])
          throw new ApiError("VALIDATION_FAILED", "Укажите ID анкеты");
        const [registration] = await exec.query<Row>(
          "select id from registration where id=$1 and telegram_user_id=$2 and state in ('pending_review','need_clarification','rejected')",
          [parts[1], telegramId],
        );
        if (!registration) throw new ApiError("NOT_FOUND");
        state.registration_id = parts[1];
      }
      if (parts[1]?.startsWith("invite_")) state.invite = parts[1].slice(7);
      state.step = "language";
      return save("Выберите язык / Тілді таңдаңыз: ru / kk");
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
            buildings
              .map((b, i) => `${i + 1}. ${b.code} (${b.kind})`)
              .join("\n"),
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
          `Проверьте / Тексеріңіз: ${state.full_name}, ${state.phone_e164}, ${premiseLabels[String(state.kind)]}, ${roleLabels[String(state.role)]}.\nСогласие на обработку этих данных для регистрации в ОСИ: да / иә. Отмена: /cancel. / ОСИ тіркелуі үшін осы деректерді өңдеуге келісіңіз: иә.`,
        );
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
        const result = await submitRegistration(d, actor, state, telegramId);
        for (const key of Object.keys(state)) delete state[key];
        return save(
          `Анкета принята, доступ ожидает подтверждения. / Өтінім қабылданды, қолжетімділік растауды күтуде. ${result.id}\n/status`,
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
