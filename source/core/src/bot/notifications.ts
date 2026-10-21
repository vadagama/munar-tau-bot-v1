import { loadDialog } from "./dialog.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";
import { BotTemplateError } from "./bot-errors.ts";
import { t as templateText } from "../templates/store.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { actorForTelegram } from "./registration.ts";
import { btn, type BotReply } from "./keyboard.ts";
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
      templateText(
        deps.templates,
        lang,
        "notifications.snachala_podtverdite_registratsiyu_register",
      ),
    );
  }
  await loadDialog(deps.db,telegramId,deps.bot ?? "resident",actor.profile.id,actor.emulation?.sessionId??null,"notifications");
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
  let settings = await getPreferences(deps.db, actor);
  if(type==='language' && ['ru','kk'].includes(String(mode))) {
    const item=settings.items.find(i=>i.event_type==='publication');
    settings=await setPreference(deps,actor,'publication',item?.mode??'immediate',mode);
  } else if(type && mode) settings=await setPreference(deps,actor,type,mode,language);
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
  const lang = kk ? "kk" : "ru";
  const button=(id:string,command:string)=>btn(messageButton(deps.templates,lang,"bot.controls",id),command);
  return {text: message(
    deps.templates,
    kk ? "kk" : "ru",
    "bot.settings",
    {
      settings: safeBlock(
        settings.items.map((i) => `${names[i.event_type]}: ${names[i.mode]}`)
          .join("\n"),
      ),
    },
  ), buttons: type && type!=="language" && !mode
    ? [(["immediate",...(type==="request.status"?[]:["digest"]),"off"]).map(mode=>button(mode,`/notifications ${type} ${mode}`)),[button("back","/notifications")]]
    : [[button("publication","/notifications publication")],[button("work_report","/notifications work.report")],[button("request_status","/notifications request.status")],[btn("Русский","/notifications language ru"),btn("Қазақша","/notifications language kk")]]};
}
