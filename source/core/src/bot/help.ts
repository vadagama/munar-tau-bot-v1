/**
 * Контекстные подсказки бота. Вместо полной простыни команд в каждой реплике —
 * только действия, доступные в текущем состоянии. Полная справка — по /help.
 * Срез UX B: один язык по профилю (по умолчанию русский) вместо «ru / kk».
 */
import { cmd, pick, type Lang } from "./text.ts";

/** Полная справка бота жителей: разделы команд, экстренная строка. */
export function registrationHelp(lang: Lang = "ru"): string {
  if (lang === "kk") {
    return [
      "<b>«Мунар Тау» тұрғын алабының ОСИ</b>",
      `<b>Өтініштер:</b> ${cmd("/newrequest")} — жаңа; ${cmd("/requests")} — менікі; ${cmd("/request НОМІР")} — ашу; ${cmd("/say НОМІР мәтін")} — хабарлама`,
      `<b>Тіркелу:</b> ${cmd("/register")}; ${cmd("/add")} — жаңа нысан; ${cmd("/status")} — өтінімдер; ${cmd("/fix")} — нақтылаудан кейін түзету; ${cmd("/objects")} — нысандар`,
      `<b>Меншік иесінің қолжетімділігі:</b> ${cmd("/pending")}; ${cmd("/accesses")}; ${cmd("/invite")} — шақыру; ${cmd("/approve")}, ${cmd("/reject")}, ${cmd("/dispute")}, ${cmd("/revoke")} — шешімдер`,
      `<b>Баптаулар:</b> ${cmd("/notifications")} — хабарламалар мен тіл`,
      "Өмірге тікелей қауіп төнсе 112 нөміріне қоңырау шалыңыз.",
    ].join("\n");
  }
  return [
    "<b>ОСИ ЖК «Мунар Тау»</b>",
    `<b>Обращения:</b> ${cmd("/newrequest")} — новое; ${cmd("/requests")} — мои; ${cmd("/request НОМЕР")} — открыть; ${cmd("/say НОМЕР текст")} — сообщение`,
    `<b>Регистрация:</b> ${cmd("/register")}; ${cmd("/add")} — новый объект; ${cmd("/status")} — анкеты; ${cmd("/fix")} — исправить после уточнения; ${cmd("/objects")} — объекты`,
    `<b>Доступы собственника:</b> ${cmd("/pending")}; ${cmd("/accesses")}; ${cmd("/invite")} — пригласить; ${cmd("/approve")}, ${cmd("/reject")}, ${cmd("/dispute")}, ${cmd("/revoke")} — решения`,
    `<b>Настройки:</b> ${cmd("/notifications")} — уведомления и язык`,
    "При непосредственной угрозе жизни звоните 112.",
  ].join("\n");
}

/** Полная справка бота сотрудников: задания исполнителя (WRK). */
export function workerHelp(lang: Lang = "ru"): string {
  if (lang === "kk") {
    return [
      "<b>ОСИ ЖК «Мунар Тау» — қызметкерлер боты</b>",
      `<b>Орындаушының тапсырмалары:</b> ${cmd("/tasks")} — менің тапсырмаларым; ${cmd("/task НОМІР")} — ашу; файлдар — ашық тапсырмаға жабыстырыңыз`,
      `<b>Тапсырмамен жұмыс:</b> ${cmd("/accepttask НОМІР")} — қабылдау; ${cmd("/declinetask НОМІР себеп")} — болмайды; ${cmd("/starttask НОМІР")} — бастау; ${cmd("/reporttask НОМІР")} — есеп толтыру; ${cmd("/submitreport")} — нәтижені жіберу; ${cmd("/taskfiles")} — файлдар`,
      `<b>Жұмыс барысында:</b> ${cmd("/pausetask НОМІР себеп")} — тоқтату; ${cmd("/proposevisit НОМІР кк.аа.жжжг гг:сс|кк.аа.жжжг гг:сс")} — сапар; ${cmd("/noaccess")} — қолжетімділік жоқ (ашық тапсырмада); ${cmd("/problem НОМІР орын|сипаттама")} — табылған мәселе`,
      "Тұрғындардың өтініштері мен тіркелуі — тұрғындар ботында. Өмірге тікелей қауіп төнсе 112 нөміріне қоңырау шалыңыз.",
    ].join("\n");
  }
  return [
    "<b>ОСИ ЖК «Мунар Тау» — бот сотрудников</b>",
    `<b>Задания исполнителя:</b> ${cmd("/tasks")} — мои задания; ${cmd("/task НОМЕР")} — открыть; файлы — просто прикрепите к открытому заданию`,
    `<b>Работа с заданием:</b> ${cmd("/accepttask НОМЕР")} — принять; ${cmd("/declinetask НОМЕР причина")} — не могу; ${cmd("/starttask НОМЕР")} — начать; ${cmd("/reporttask НОМЕР")} — заполнить отчёт; ${cmd("/submitreport")} — передать результат; ${cmd("/taskfiles")} — файлы`,
    `<b>В работе:</b> ${cmd("/pausetask НОМЕР причина")} — остановка; ${cmd("/proposevisit НОМЕР дд.мм.гггг чч:мм|дд.мм.гггг чч:мм")} — визит; ${cmd("/noaccess")} — нет доступа (по открытому заданию); ${cmd("/problem НОМЕР место|описание")} — найденная проблема`,
    "Обращения и регистрация жителей — в боте для жителей. При непосредственной угрозе жизни звоните 112.",
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

/** Reply-меню жителя: кнопки отправляют текст команды (текстовый эквивалент). */
export function residentMenu(): string[][] {
  return [
    ["/newrequest", "/requests"],
    ["/status", "/objects"],
    ["/notifications", "/help"],
  ];
}

/** Reply-меню сотрудника: задания и справка. */
export function workerMenu(): string[][] {
  return [["/tasks", "/help"]];
}
