import type { TemplateDef } from "./types.ts";
export const helpTemplates: readonly TemplateDef[] = [
  {
    "key":
      "help.sendrequest_otpravit_editrequest_tekst_deletedraft_udalit_fayly",
    "section": "help",
    "title":
      "/sendrequest — отправить; /editrequest — текст; /deletedraft — удалить; файлы — просто прикрепите к ",
    "description": "Реплика help",
    "variables": [],
    "ru":
      "/sendrequest — отправить; /editrequest — текст; /deletedraft — удалить; файлы — просто прикрепите к следующему сообщению",
    "kk":
      "/sendrequest — жіберу; /editrequest — мәтін; /deletedraft — жою; файлдарды келесі хабарламаға жабыстырыңыз",
  },
  {
    "key": "help.visits_nomer_vizity_say_nomer_tekst_soobschenie",
    "section": "help",
    "title": "/visits НОМЕР — визиты; /say НОМЕР текст — сообщение",
    "description": "Реплика help",
    "variables": [],
    "ru": "/visits НОМЕР — визиты; /say НОМЕР текст — сообщение",
    "kk": "/visits НОМІР — сапарлар; /say НОМІР мәтін — хабарлама",
  },
  {
    "key": "help.result_nomer_otchety_return_nomer_prichina_dorabotka",
    "section": "help",
    "title": "/result НОМЕР — отчёты; /return НОМЕР причина — доработка",
    "description": "Реплика help",
    "variables": [],
    "ru": "/result НОМЕР — отчёты; /return НОМЕР причина — доработка",
    "kk": "/result НОМІР — есептер; /return НОМІР себеп — түзету",
  },
  {
    "key": "help.rate_nomer_1_5_kommentariy_otsenka_appeal",
    "section": "help",
    "title": "/rate НОМЕР 1–5 комментарий — оценка; /appeal НОМЕР причина",
    "description": "Реплика help",
    "variables": [],
    "ru": "/rate НОМЕР 1–5 комментарий — оценка; /appeal НОМЕР причина",
    "kk": "/rate НОМІР 1–5 түсініктеме — баға; /appeal НОМІР себеп",
  },
  {
    "key": "help.appeal_nomer_prichina_apellyatsiya_reopen_nomer_prichina",
    "section": "help",
    "title": "/appeal НОМЕР причина — апелляция; /reopen НОМЕР причина",
    "description": "Реплика help",
    "variables": [],
    "ru": "/appeal НОМЕР причина — апелляция; /reopen НОМЕР причина",
    "kk": "/appeal НОМІР себеп — шағым; /reopen НОМІР себеп",
  },
  {
    "key": "help.deystviya_accepttask_nomer_prinyat_declinetask_nomer_prichina",
    "section": "help",
    "title":
      "Действия: /accepttask НОМЕР — принять; /declinetask НОМЕР причина — не могу",
    "description": "Реплика help",
    "variables": [],
    "ru":
      "Действия: /accepttask НОМЕР — принять; /declinetask НОМЕР причина — не могу",
    "kk":
      "Әрекеттер: /accepttask НОМІР — қабылдау; /declinetask НОМІР себеп — болмайды",
  },
  {
    "key": "help.deystviya_starttask_nomer_nachat_rabotu",
    "section": "help",
    "title": "Действия: /starttask НОМЕР — начать работу",
    "description": "Реплика help",
    "variables": [],
    "ru": "Действия: /starttask НОМЕР — начать работу",
    "kk": "Әрекеттер: /starttask НОМІР — жұмысты бастау",
  },
  {
    "key": "help.deystviya_reporttask_nomer_otchet_proposevisit_nomer_vizit",
    "section": "help",
    "title":
      "Действия: /reporttask НОМЕР — отчёт; /proposevisit НОМЕР — визит; /pausetask НОМЕР причина — останов",
    "description": "Реплика help",
    "variables": [],
    "ru":
      "Действия: /reporttask НОМЕР — отчёт; /proposevisit НОМЕР — визит; /pausetask НОМЕР причина — остановка; /problem НОМЕР … — найденная проблема",
    "kk":
      "Әрекеттер: /reporttask НОМІР — есеп; /proposevisit НОМІР — сапар; /pausetask НОМІР себеп — тоқтату; /problem НОМІР … — табылған мәселе",
  },
  {
    "key": "help.deystviya_starttask_nomer_vozobnovit",
    "section": "help",
    "title": "Действия: /starttask НОМЕР — возобновить",
    "description": "Реплика help",
    "variables": [],
    "ru": "Действия: /starttask НОМЕР — возобновить",
    "kk": "Әрекеттер: /starttask НОМІР — жалғастыру",
  },
  {
    "key": "help.deystviya_starttask_nomer_prodolzhit_posle_dorabotki",
    "section": "help",
    "title": "Действия: /starttask НОМЕР — продолжить после доработки",
    "description": "Реплика help",
    "variables": [],
    "ru": "Действия: /starttask НОМЕР — продолжить после доработки",
    "kk": "Әрекеттер: /starttask НОМІР — түзетуден кейін жалғастыру",
  },
  {
    "key": "help.otchet_na_proverke_u_administratora",
    "section": "help",
    "title": "Отчёт на проверке у администратора.",
    "description": "Реплика help",
    "variables": [],
    "ru": "Отчёт на проверке у администратора.",
    "kk": "Есеп әкімшінің тексерінде.",
  },
  {
    "key": "help.registration_help",
    "section": "help",
    "title": "Справка жителей",
    "description": "Раздел справки",
    "variables": [],
    "ru":
      "<b>🏛 ОСИ ЖК «Мунар Тау»</b>\n\n<b>Анкета</b>\n• /register — регистрация\n• /status — статус анкеты\n• /fix — исправить данные\n• /delete — удалить анкету\n\n<b>Помещения</b>\n• /objects — мои помещения\n• /add — добавить помещение\n\n<b>Обращения</b>\n• /newrequest — новое обращение\n• /requests — мои обращения\n\n<b>Доступы собственника</b>\n• /invite — пригласить жильца\n• /accesses — выданные доступы\n\n<b>Настройки</b>\n• /notifications — уведомления и язык\n\n🚨 В экстренной ситуации и при непосредственной угрозе жизни звоните 112!",
    "kk":
      "<b>🏛 «Мұнар Тау» тұрғын алабының ОСИ</b>\n\n<b>Анкета</b>\n• /register — тіркелу\n• /status — күйі\n• /fix — деректерді түзету\n• /delete — өтінімді жою\n\n<b>Үй-жайлар</b>\n• /objects — менің үй-жайларым\n• /add — үй-жай қосу\n\n<b>Өтініштер</b>\n• /newrequest — жаңа өтініш\n• /requests — менің өтініштерім\n\n<b>Меншік иесінің қолжетімділігі</b>\n• /invite — тұрғынды шақыру\n• /accesses — берілген қолжетімділік\n\n<b>Баптаулар</b>\n• /notifications — хабарламалар мен тіл\n\n🚨 Төтенше жағдайда және өмірге тікелей қауіп төнгенде 112 нөміріне қоңырау шалыңыз!",
  },
  {
    "key": "help.worker_help",
    "section": "help",
    "title": "Справка сотрудников",
    "description": "Раздел справки",
    "variables": [],
    "ru":
      "<b>🛠 ОСИ ЖК «Мунар Тау» — бот сотрудников</b>\n\n<b>Задания</b>\n• /tasks — мои задания\n• /task НОМЕР — открыть задание\n• /taskfiles — файлы открытого задания\n\n<b>Работа с заданием</b>\n• /accepttask НОМЕР — принять\n• /declinetask НОМЕР причина — не могу\n• /starttask НОМЕР — начать\n• /reporttask НОМЕР — отчёт\n• /submitreport — передать результат\n\n<b>В работе</b>\n• /pausetask НОМЕР причина — остановка\n• /proposevisit НОМЕР завтра 10:00-12:00 — визит (или «сегодня 18:00»)\n• /noaccess — нет доступа\n• /problem НОМЕР место|описание — найденная проблема\n\nОбращения и регистрация жителей — в боте для жителей.\n🚨 При непосредственной угрозе жизни звоните 112.",
    "kk":
      "<b>🛠 ОСИ ЖК «Мунар Тау» — қызметкерлер боты</b>\n\n<b>Тапсырмалар</b>\n• /tasks — менің тапсырмаларым\n• /task НОМІР — тапсырманы ашу\n• /taskfiles — файлдар ашық тапсырмаға\n\n<b>Жұмыс</b>\n• /accepttask НОМІР — қабылдау\n• /declinetask НОМІР себеп — болмайды\n• /starttask НОМІР — бастау\n• /reporttask НОМІР — есеп\n• /submitreport — нәтижені жіберу\n\n<b>Жұмыс барысында</b>\n• /pausetask НОМІР себеп — тоқтату\n• /proposevisit НОМІР ертең 10:00-12:00 — сапар (немесе «бүгін 18:00»)\n• /noaccess — қолжетімділік жоқ\n• /problem НОМІР орын|сипаттама — табылған мәселе\n\nТұрғындардың өтініштері мен тіркелуі — тұрғындар ботында.\n🚨 Өмірге тікелей қауіп төнгенде 112 нөміріне қоңырау шалыңыз.",
  },
  {
    "key": "help.welcome_text",
    "section": "help",
    "title": "Приветствие",
    "description": "Раздел справки",
    "variables": [],
    "ru":
      "<b>🏛 ОСИ ЖК «Мунар Тау»</b>\n\nЗдесь можно зарегистрироваться, сообщать о проблемах и получать уведомления ОСИ.\n\n/register — анкета регистрации\n/help — все команды\n\n🚨 В экстренной ситуации звоните 112!",
    "kk":
      "<b>🏛 «Мұнар Тау» тұрғын алабының ОСИ</b>\n\nБұл ботта тіркелуге, өтініш жіберге және хабарламалар алуға болады.\n\n/register — тіркелу анкетасы\n/help — барлық командалар\n\n🚨 Төтенше жағдайда 112 нөміріне қоңырау шалыңыз!",
  },
  {
    "key": "help.actions_prefix",
    "section": "help",
    "title": "Префикс доступных действий",
    "description": "Перед списком действий",
    "variables": [],
    "ru": "Действия: ",
    "kk": "Әрекеттер: ",
  },
];
