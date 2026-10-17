import { BotTemplateError } from "./bot-errors.ts";
import { t as templateText } from "../templates/store.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { actorForTelegram } from "./registration.ts";
import type { BotReply } from "./keyboard.ts";
import {
  getPreferences,
  setPreference,
} from "../domains/notifications/service.ts";
export async function notificationStep(
  deps: RegistryDeps,
  telegramId: string,
  input: string,
  providedActor?: Actor,
): Promise<BotReply> {
  const actor = providedActor ?? await actorForTelegram(deps, telegramId);
  if (!actor) {
    // Ошибка до Actor: язык берём напрямую из профиля (нет профиля — русский).
    const [p] = await deps.db.query<{ language: string }>(
      "select language from profile where telegram_user_id=$1 and archived_at is null limit 1",
      [telegramId],
    );
    const lang = p?.language === "kk" ? "kk" : "ru";
    throw new BotTemplateError(
      "FORBIDDEN",
      templateText(deps.templates, lang, "notifications.snachala_podtverdite_registratsiyu_register"),
    );
  }
  const [, requestedType, requestedMode, language] = input.trim().toLowerCase()
    .split(/\s+/);
  const types: Record<string, string> = {
    новости: "publication",
    жаңалықтар: "publication",
    отчёты: "work.report",
    есептер: "work.report",
    статусы: "request.status",
    күйлер: "request.status",
  };
  const modes: Record<string, string> = {
    сразу: "immediate",
    бірден: "immediate",
    сводка: "digest",
    шолу: "digest",
    выключено: "off",
    өшіру: "off",
  };
  const type = requestedType
    ? types[requestedType] ?? requestedType
    : undefined;
  const mode = requestedMode
    ? modes[requestedMode] ?? requestedMode
    : undefined;
  const settings = type
    ? await setPreference(deps, actor, type, mode, language)
    : await getPreferences(deps.db, actor);
  const kk = settings.language === "kk";
  const names: Record<string, string> = kk
    ? {
      publication: "Жаңалықтар",
      "work.report": "Жарияланған есептер",
      "request.status": "Өтініш күйлері",
      immediate: "бірден",
      digest: "шолу",
      off: "өшіру",
    }
    : {
      publication: "Новости",
      "work.report": "Опубликованные отчёты",
      "request.status": "Статусы обращений",
      immediate: "сразу",
      digest: "сводка",
      off: "выключено",
    };
  const help = templateText(deps.templates, (kk ? "kk" : "ru"), "notifications.primer_izmeneniya_notifications_novosti_svodka_ru_vidy");
  return `${
    settings.items.map((i) => `${names[i.event_type]}: ${names[i.mode]}`).join(
      "\n",
    )
  }\n\n${help}`;
}
