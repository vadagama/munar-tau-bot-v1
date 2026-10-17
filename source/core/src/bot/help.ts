import { t as templateText, type TemplateStore } from "../templates/store.ts";
/**
 * Контекстные подсказки бота. Вместо полной простыни команд в каждой реплике —
 * только действия, доступные в текущем состоянии. Полная справка — по /help.
 * Срез UX B: один язык по профилю (по умолчанию русский) вместо «ru / kk».
 * Команды в тексте — обычный текст: Telegram сам делает их кликабельными.
 */
import { type Lang } from "./text.ts";

/** Полная справка бота жителей: разделы команд, экстренная строка. */
export function registrationHelp(lang: Lang = "ru", store?: TemplateStore): string { return templateText(store, lang, "help.registration_help"); }

/** Полная справка бота сотрудников: задания исполнителя (WRK). */
export function workerHelp(lang: Lang = "ru", store?: TemplateStore): string { return templateText(store, lang, "help.worker_help"); }

/** Короткое приветствие для /start: суть бота и две точки входа. */
export function welcomeText(lang: Lang = "ru", store?: TemplateStore): string { return templateText(store, lang, "help.welcome_text"); }

/** Подсказки по карточке обращения в зависимости от состояния. */
export function requestActions(state: unknown, lang: Lang = "ru", isDraft = false, store?: TemplateStore): string {
  const actions: string[] = isDraft
    ? [templateText(store, lang, "help.sendrequest_otpravit_editrequest_tekst_deletedraft_udalit_fayly")]
    : [];
  switch (String(state)) {
    case "new":
    case "reviewing":
    case "need_clarification":
    case "in_work":
    case "on_hold":
      actions.push(templateText(store, lang, "help.visits_nomer_vizity_say_nomer_tekst_soobschenie"));
      break;
    case "awaiting_confirmation":
      actions.push(templateText(store, lang, "help.result_nomer_otchety_return_nomer_prichina_dorabotka"));
      break;
    case "closed":
      actions.push(templateText(store, lang, "help.rate_nomer_1_5_kommentariy_otsenka_appeal"));
      break;
    case "canceled":
    case "rejected":
      actions.push(templateText(store, lang, "help.appeal_nomer_prichina_apellyatsiya_reopen_nomer_prichina"));
      break;
    default:
      break;
  }
  return actions.length
    ? templateText(store, lang, "help.actions_prefix") + actions.join("; ")
    : "";
}

/** Подсказки по карточке задания в зависимости от состояния. */
export function taskActions(state: unknown, lang: Lang = "ru", store?: TemplateStore): string {

  switch (String(state)) {
    case "awaiting_acceptance":
      return templateText(store, lang, "help.deystviya_accepttask_nomer_prinyat_declinetask_nomer_prichina");
    case "accepted":
      return templateText(store, lang, "help.deystviya_starttask_nomer_nachat_rabotu");
    case "in_progress":
      return templateText(store, lang, "help.deystviya_reporttask_nomer_otchet_proposevisit_nomer_vizit");
    case "suspended":
      return templateText(store, lang, "help.deystviya_starttask_nomer_vozobnovit");
    case "rework":
      return templateText(store, lang, "help.deystviya_starttask_nomer_prodolzhit_posle_dorabotki");
    case "on_review":
      return templateText(store, lang, "help.otchet_na_proverke_u_administratora");
    default:
      return "";
  }
}

/** Подписи кнопок reply-меню на двух языках; ключ — команда без слэша. */
type MenuKey =
  | "newrequest"
  | "requests"
  | "objects"
  | "add"
  | "notifications"
  | "help"
  | "tasks";
const MENU_LABELS: Record<"ru" | "kk", Record<MenuKey, string>> = {
  ru: {
    newrequest: "🆕 Новое обращение",
    requests: "📬 Мои обращения",
    objects: "🏠 Мои объекты",
    add: "➕ Добавить объект",
    notifications: "⚙️ Настройки",
    help: "❓ Помощь",
    tasks: "🗂 Мои задания",
  },
  kk: {
    newrequest: "🆕 Жаңа өтініш",
    requests: "📬 Менің өтініштерім",
    objects: "🏠 Менің нысандарым",
    add: "➕ Нысан қосу",
    notifications: "⚙️ Баптаулар",
    help: "❓ Анықтама",
    tasks: "🗂 Менің тапсырмаларым",
  },
};

/** Текст кнопки reply-меню → текстовая команда (кнопка отправляет подпись). */
const MENU_COMMANDS: Record<string, string> = Object.fromEntries(
  (Object.values(MENU_LABELS) as Record<MenuKey, string>[]).flatMap((labels) =>
    Object.entries(labels).map(([key, labelText]) => [labelText, `/${key}`])),
);

/** Reply-меню жителя: подписи с иконками на языке профиля. */
export function residentMenu(lang: Lang = "ru"): string[][] {
  const l = MENU_LABELS[lang === "kk" ? "kk" : "ru"];
  return [
    [l.newrequest, l.requests],
    [l.objects, l.add],
    [l.notifications, l.help],
  ];
}

/** Reply-меню сотрудника: задания и справка. */
export function workerMenu(lang: Lang = "ru"): string[][] {
  const l = MENU_LABELS[lang === "kk" ? "kk" : "ru"];
  return [[l.tasks, l.help]];
}

/**
 * Текст входящего сообщения → команда reply-меню (иначе — как есть).
 * Сопоставление точное по подписи; callback_data не меняется (это уже команда).
 */
export function menuCommand(text: string): string | undefined {
  return MENU_COMMANDS[text.trim()];
}
