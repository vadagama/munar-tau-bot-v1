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
      "<b>📋 Өтінім</b>",
      `• 📝 Тіркелу: ${cmd("/register")}`,
      `• 🔎 Күйі: ${cmd("/status")}`,
      `• ✏️ Деректерді түзету: ${cmd("/fix")}`,
      `• 🗑 Өтінімді жою: ${cmd("/delete")}`,
      "",
      "<b>🏠 Нысандар</b>",
      `• 📃 Менің нысандарым: ${cmd("/objects")}`,
      `• ➕ Нысан қосу: ${cmd("/add")}`,
      "",
      "<b>💬 Өтініштер</b>",
      `• 🆕 Жаңа өтініш: ${cmd("/newrequest")}`,
      `• 📬 Менің өтініштерім: ${cmd("/requests")}`,
      "",
      "<b>🔑 Меншік иесінің қолжетімділігі</b>",
      `• 📨 Тұрғынды шақыру: ${cmd("/invite")}`,
      `• 📄 Берілген қолжетімділік: ${cmd("/accesses")}`,
      "",
      "<b>⚙️ Баптаулар</b>",
      `• 🔔 Хабарламалар мен тіл: ${cmd("/notifications")}`,
      "",
      "🚨 Төтенше жағдайда және өмірге тікелей қауіп төнгенде 112 нөміріне қоңырау шалыңыз!",
    ].join("\n");
  }
  return [
    "<b>🏛 ОСИ ЖК «Мунар Тау»</b>",
    "",
    "<b>📋 Анкета</b>",
    `• 📝 Регистрация: ${cmd("/register")}`,
    `• 🔎 Статус: ${cmd("/status")}`,
    `• ✏️ Исправить данные: ${cmd("/fix")}`,
    `• 🗑 Удалить анкету: ${cmd("/delete")}`,
    "",
    "<b>🏠 Объекты</b>",
    `• 📃 Мои объекты: ${cmd("/objects")}`,
    `• ➕ Добавить объект: ${cmd("/add")}`,
    "",
    "<b>💬 Обращения</b>",
    `• 🆕 Новое обращение: ${cmd("/newrequest")}`,
    `• 📬 Мои обращения: ${cmd("/requests")}`,
    "",
    "<b>🔑 Доступы собственника</b>",
    `• 📨 Пригласить жильца: ${cmd("/invite")}`,
    `• 📄 Выданные доступы: ${cmd("/accesses")}`,
    "",
    "<b>⚙️ Настройки</b>",
    `• 🔔 Уведомления и язык: ${cmd("/notifications")}`,
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
      "<b>🗂 Тапсырмалар</b>",
      `• 📋 Менің тапсырмаларым: ${cmd("/tasks")}`,
      `• 🔎 Тапсырманы ашу: ${cmd("/task НОМІР")}`,
      `• 📎 Файлдар — ашық тапсырмаға жабыстырыңыз (тізім: ${cmd("/taskfiles")})`,
      "",
      "<b>🔧 Тапсырмамен жұмыс</b>",
      `• ✅ Қабылдау: ${cmd("/accepttask НОМІР")}`,
      `• ✋ Болмайды: ${cmd("/declinetask НОМІР себеп")}`,
      `• ▶️ Бастау: ${cmd("/starttask НОМІР")}`,
      `• 📝 Есеп: ${cmd("/reporttask НОМІР")}`,
      `• 📤 Нәтижені жіберу: ${cmd("/submitreport")}`,
      "",
      "<b>🧰 Жұмыс барысында</b>",
      `• ⏸ Тоқтату: ${cmd("/pausetask НОМІР себеп")}`,
      `• 🚗 Сапар: ${cmd("/proposevisit НОМІР ертең 10:00-12:00")} (немесе «бүгін 18:00»)`,
      `• 🚫 Қолжетімділік жоқ: ${cmd("/noaccess")}`,
      `• ⚠️ Табылған мәселе: ${cmd("/problem НОМІР орын|сипаттама")}`,
      "",
      "Тұрғындардың өтініштері мен тіркелуі — тұрғындар ботында.",
      "🚨 Өмірге тікелей қауіп төнгенде 112 нөміріне қоңырау шалыңыз.",
    ].join("\n");
  }
  return [
    "<b>🛠 ОСИ ЖК «Мунар Тау» — бот сотрудников</b>",
    "",
    "<b>🗂 Задания</b>",
    `• 📋 Мои задания: ${cmd("/tasks")}`,
    `• 🔎 Открыть задание: ${cmd("/task НОМЕР")}`,
    `• 📎 Файлы — прикрепите к открытому заданию (список: ${cmd("/taskfiles")})`,
    "",
    "<b>🔧 Работа с заданием</b>",
    `• ✅ Принять: ${cmd("/accepttask НОМЕР")}`,
    `• ✋ Не могу: ${cmd("/declinetask НОМЕР причина")}`,
    `• ▶️ Начать: ${cmd("/starttask НОМЕР")}`,
    `• 📝 Отчёт: ${cmd("/reporttask НОМЕР")}`,
    `• 📤 Передать результат: ${cmd("/submitreport")}`,
    "",
    "<b>🧰 В работе</b>",
    `• ⏸ Остановка: ${cmd("/pausetask НОМЕР причина")}`,
    `• 🚗 Визит: ${cmd("/proposevisit НОМЕР завтра 10:00-12:00")} (или «сегодня 18:00»)`,
    `• 🚫 Нет доступа: ${cmd("/noaccess")}`,
    `• ⚠️ Найденная проблема: ${cmd("/problem НОМЕР место|описание")}`,
    "",
    "Обращения и регистрация жителей — в боте для жителей.",
    "🚨 При непосредственной угрозе жизни звоните 112.",
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
        `${cmd("/result НОМЕР")} — отчёты; ${cmd("/confirm НОМЕР ВЕРСИЯ")} — принять; ${cmd("/return НОМЕР причина")} — доработка`,
        `${cmd("/result НОМІР")} — есептер; ${cmd("/confirm НОМІР НҰСҚА")} — қабылдау; ${cmd("/return НОМІР себеп")} — түзету`,
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
