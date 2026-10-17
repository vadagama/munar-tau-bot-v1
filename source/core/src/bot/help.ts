/**
 * Контекстные подсказки бота. Вместо полной простыни команд в каждой реплике —
 * только действия, доступные в текущем состоянии. Полная справка — по /help.
 * Срез UX B: один язык по профилю (по умолчанию русский) вместо «ru / kk».
 * Команды в тексте — обычный текст: Telegram сам делает их кликабельными.
 */
import { cmd, pick, type Lang } from "./text.ts";

/** Полная справка бота жителей: разделы команд, экстренная строка. */
export function registrationHelp(lang: Lang = "ru"): string {
  if (lang === "kk") {
    return [
      "<b>🏛 «Мұнар Тау» тұрғын алабының ОСИ</b>",
      "",
      "<b>Анкета</b>",
      `• ${cmd("/register")} — тіркелу`,
      `• ${cmd("/status")} — күйі`,
      `• ${cmd("/fix")} — деректерді түзету`,
      `• ${cmd("/delete")} — өтінімді жою`,
      "",
      "<b>Нысандар</b>",
      `• ${cmd("/objects")} — менің нысандарым`,
      `• ${cmd("/add")} — нысан қосу`,
      "",
      "<b>Өтініштер</b>",
      `• ${cmd("/newrequest")} — жаңа өтініш`,
      `• ${cmd("/requests")} — менің өтініштерім`,
      "",
      "<b>Меншік иесінің қолжетімділігі</b>",
      `• ${cmd("/invite")} — тұрғынды шақыру`,
      `• ${cmd("/accesses")} — берілген қолжетімділік`,
      "",
      "<b>Баптаулар</b>",
      `• ${cmd("/notifications")} — хабарламалар мен тіл`,
      "",
      "🚨 Төтенше жағдайда және өмірге тікелей қауіп төнгенде 112 нөміріне қоңырау шалыңыз!",
    ].join("\n");
  }
  return [
    "<b>🏛 ОСИ ЖК «Мунар Тау»</b>",
    "",
    "<b>Анкета</b>",
    `• ${cmd("/register")} — регистрация`,
    `• ${cmd("/status")} — статус анкеты`,
    `• ${cmd("/fix")} — исправить данные`,
    `• ${cmd("/delete")} — удалить анкету`,
    "",
    "<b>Объекты</b>",
    `• ${cmd("/objects")} — мои объекты`,
    `• ${cmd("/add")} — добавить объект`,
    "",
    "<b>Обращения</b>",
    `• ${cmd("/newrequest")} — новое обращение`,
    `• ${cmd("/requests")} — мои обращения`,
    "",
    "<b>Доступы собственника</b>",
    `• ${cmd("/invite")} — пригласить жильца`,
    `• ${cmd("/accesses")} — выданные доступы`,
    "",
    "<b>Настройки</b>",
    `• ${cmd("/notifications")} — уведомления и язык`,
    "",
    "🚨 В экстренной ситуации и при непосредственной угрозе жизни звоните 112!",
  ].join("\n");
}

/** Полная справка бота сотрудников: задания исполнителя (WRK). */
export function workerHelp(lang: Lang = "ru"): string {
  if (lang === "kk") {
    return [
      "<b>🛠 ОСИ ЖК «Мунар Тау» — қызметкерлер боты</b>",
      "",
      "<b>Тапсырмалар</b>",
      `• ${cmd("/tasks")} — менің тапсырмаларым`,
      `• ${cmd("/task НОМІР")} — тапсырманы ашу`,
      `• ${cmd("/taskfiles")} — файлдар ашық тапсырмаға`,
      "",
      "<b>Жұмыс</b>",
      `• ${cmd("/accepttask НОМІР")} — қабылдау`,
      `• ${cmd("/declinetask НОМІР себеп")} — болмайды`,
      `• ${cmd("/starttask НОМІР")} — бастау`,
      `• ${cmd("/reporttask НОМІР")} — есеп`,
      `• ${cmd("/submitreport")} — нәтижені жіберу`,
      "",
      "<b>Жұмыс барысында</b>",
      `• ${cmd("/pausetask НОМІР себеп")} — тоқтату`,
      `• ${cmd("/proposevisit НОМІР ертең 10:00-12:00")} — сапар (немесе «бүгін 18:00»)`,
      `• ${cmd("/noaccess")} — қолжетімділік жоқ`,
      `• ${cmd("/problem НОМІР орын|сипаттама")} — табылған мәселе`,
      "",
      "Тұрғындардың өтініштері мен тіркелуі — тұрғындар ботында.",
      "🚨 Өмірге тікелей қауіп төнгенде 112 нөміріне қоңырау шалыңыз.",
    ].join("\n");
  }
  return [
    "<b>🛠 ОСИ ЖК «Мунар Тау» — бот сотрудников</b>",
    "",
    "<b>Задания</b>",
    `• ${cmd("/tasks")} — мои задания`,
    `• ${cmd("/task НОМЕР")} — открыть задание`,
    `• ${cmd("/taskfiles")} — файлы открытого задания`,
    "",
    "<b>Работа с заданием</b>",
    `• ${cmd("/accepttask НОМЕР")} — принять`,
    `• ${cmd("/declinetask НОМЕР причина")} — не могу`,
    `• ${cmd("/starttask НОМЕР")} — начать`,
    `• ${cmd("/reporttask НОМЕР")} — отчёт`,
    `• ${cmd("/submitreport")} — передать результат`,
    "",
    "<b>В работе</b>",
    `• ${cmd("/pausetask НОМЕР причина")} — остановка`,
    `• ${cmd("/proposevisit НОМЕР завтра 10:00-12:00")} — визит (или «сегодня 18:00»)`,
    `• ${cmd("/noaccess")} — нет доступа`,
    `• ${cmd("/problem НОМЕР место|описание")} — найденная проблема`,
    "",
    "Обращения и регистрация жителей — в боте для жителей.",
    "🚨 При непосредственной угрозе жизни звоните 112.",
  ].join("\n");
}

/** Короткое приветствие для /start: суть бота и две точки входа. */
export function welcomeText(lang: Lang = "ru"): string {
  return lang === "kk"
    ? [
      "<b>🏛 «Мұнар Тау» тұрғын алабының ОСИ</b>",
      "",
      "Бұл ботта тіркелуге, өтініш жіберге және хабарламалар алуға болады.",
      "",
      `${cmd("/register")} — тіркелу анкетасы`,
      `${cmd("/help")} — барлық командалар`,
      "",
      "🚨 Төтенше жағдайда 112 нөміріне қоңырау шалыңыз!",
    ].join("\n")
    : [
      "<b>🏛 ОСИ ЖК «Мунар Тау»</b>",
      "",
      "Здесь можно зарегистрироваться, сообщать о проблемах и получать уведомления ОСИ.",
      "",
      `${cmd("/register")} — анкета регистрации`,
      `${cmd("/help")} — все команды`,
      "",
      "🚨 В экстренной ситуации звоните 112!",
    ].join("\n");
}

/** Подсказки по карточке обращения в зависимости от состояния. */
export function requestActions(state: unknown, lang: Lang = "ru", isDraft = false): string {
  const actions: string[] = isDraft
    ? [pick(
      lang,
      `${cmd("/sendrequest")} — отправить; ${cmd("/editrequest")} — текст; ${cmd("/deletedraft")} — удалить; файлы — просто прикрепите к следующему сообщению`,
      `${cmd("/sendrequest")} — жіберу; ${cmd("/editrequest")} — мәтін; ${cmd("/deletedraft")} — жою; файлдарды келесі хабарламаға жабыстырыңыз`,
    )]
    : [];
  switch (String(state)) {
    case "new":
    case "reviewing":
    case "need_clarification":
    case "in_work":
    case "on_hold":
      actions.push(pick(
        lang,
        `${cmd("/visits НОМЕР")} — визиты; ${cmd("/say НОМЕР текст")} — сообщение`,
        `${cmd("/visits НОМІР")} — сапарлар; ${cmd("/say НОМІР мәтін")} — хабарлама`,
      ));
      break;
    case "awaiting_confirmation":
      actions.push(pick(
        lang,
        `${cmd("/result НОМЕР")} — отчёты; ${cmd("/return НОМЕР причина")} — доработка`,
        `${cmd("/result НОМІР")} — есептер; ${cmd("/return НОМІР себеп")} — түзету`,
      ));
      break;
    case "closed":
      actions.push(pick(
        lang,
        `${cmd("/rate НОМЕР 1–5 комментарий")} — оценка; ${cmd("/appeal НОМЕР причина")}`,
        `${cmd("/rate НОМІР 1–5 түсініктеме")} — баға; ${cmd("/appeal НОМІР себеп")}`,
      ));
      break;
    case "canceled":
    case "rejected":
      actions.push(pick(
        lang,
        `${cmd("/appeal НОМЕР причина")} — апелляция; ${cmd("/reopen НОМЕР причина")}`,
        `${cmd("/appeal НОМІР себеп")} — шағым; ${cmd("/reopen НОМІР себеп")}`,
      ));
      break;
    default:
      break;
  }
  return actions.length
    ? pick(lang, `Действия: ${actions.join("; ")}`, `Әрекеттер: ${actions.join("; ")}`)
    : "";
}

/** Подсказки по карточке задания в зависимости от состояния. */
export function taskActions(state: unknown, lang: Lang = "ru"): string {
  const a = cmd;
  switch (String(state)) {
    case "awaiting_acceptance":
      return pick(
        lang,
        `Действия: ${a("/accepttask НОМЕР")} — принять; ${a("/declinetask НОМЕР причина")} — не могу`,
        `Әрекеттер: ${a("/accepttask НОМІР")} — қабылдау; ${a("/declinetask НОМІР себеп")} — болмайды`,
      );
    case "accepted":
      return pick(lang, `Действия: ${a("/starttask НОМЕР")} — начать работу`, `Әрекеттер: ${a("/starttask НОМІР")} — жұмысты бастау`);
    case "in_progress":
      return pick(
        lang,
        `Действия: ${a("/reporttask НОМЕР")} — отчёт; ${a("/proposevisit НОМЕР")} — визит; ${a("/pausetask НОМЕР причина")} — остановка; ${a("/problem НОМЕР …")} — найденная проблема`,
        `Әрекеттер: ${a("/reporttask НОМІР")} — есеп; ${a("/proposevisit НОМІР")} — сапар; ${a("/pausetask НОМІР себеп")} — тоқтату; ${a("/problem НОМІР …")} — табылған мәселе`,
      );
    case "suspended":
      return pick(lang, `Действия: ${a("/starttask НОМЕР")} — возобновить`, `Әрекеттер: ${a("/starttask НОМІР")} — жалғастыру`);
    case "rework":
      return pick(lang, `Действия: ${a("/starttask НОМЕР")} — продолжить после доработки`, `Әрекеттер: ${a("/starttask НОМІР")} — түзетуден кейін жалғастыру`);
    case "on_review":
      return pick(lang, "Отчёт на проверке у администратора.", "Есеп әкімшінің тексерінде.");
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
