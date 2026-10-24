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
    "title": "Действия: /reporttask НОМЕР — отчёт; /pausetask НОМЕР причина — останов",
    "description": "Реплика help",
    "variables": [],
    "ru":
      "Действия: /reporttask НОМЕР — отчёт; /pausetask НОМЕР причина — остановка; /problem НОМЕР … — найденная проблема",
    "kk":
      "Әрекеттер: /reporttask НОМІР — есеп; /pausetask НОМІР себеп — тоқтату; /problem НОМІР … — табылған мәселе",
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
      "<b>❓ Справка — ОСИ ЖК «Мунар Тау»</b>\n\n<b>👤 Регистрация</b>\n📝 /register — Зарегистрироваться.\n🔎 /status — Статус регистрации.\n✏️ /fix — Исправить данные анкеты.\n🗑 /delete — Удалить анкету и закрыть доступ.\n\n<b>🏠 Помещения</b>\n🏠 /objects — Мои помещения и привязки.\n➕ /add — Привязать помещение к анкете.\n\n<b>🔑 Доступы собственника</b>\n✉️ /invite — Пригласить жильца в своё помещение.\n🔑 /accesses — Посмотреть выданные доступы.\n\n<b>📬 Обращения</b>\n🆕 /newrequest — Создать обращение в ОСИ.\n📬 /requests — Мои обращения и их состояния.\n💬 /request НОМЕР — Открыть обращение.\n\n<b>⚙️ Настройки и навигация</b>\n⚙️ /notifications — Настроить уведомления и язык.\n🏠 /start — Открыть главное меню.\n↩️ /cancel — Отменить текущий диалог.\n❓ /help — Открыть эту справку.\n\nДействия с обращением доступны в его карточке.\n🚨 При непосредственной угрозе жизни звоните 112.",
    "kk":
      "<b>❓ Анықтама — «Мұнар Тау» ТК МИБ</b>\n\n<b>👤 Тіркелу</b>\n📝 /register — Тіркелу.\n🔎 /status — Тіркелу күйін көру.\n✏️ /fix — Сауалнама деректерін түзету.\n🗑 /delete — Сауалнаманы жою және қолжетімділікті жабу.\n\n<b>🏠 Үй-жайлар</b>\n🏠 /objects — Менің үй-жайларым мен байланыстарым.\n➕ /add — Үй-жайды сауалнамаға байланыстыру.\n\n<b>🔑 Меншік иесінің рұқсаттары</b>\n✉️ /invite — Тұрғынды өз үй-жайыма шақыру.\n🔑 /accesses — Берілген рұқсаттарды көру.\n\n<b>📬 Өтініштер</b>\n🆕 /newrequest — МИБ-ке өтініш жасау.\n📬 /requests — Менің өтініштерім мен олардың күйлері.\n💬 /request НӨМІР — Өтінішті ашу.\n\n<b>⚙️ Баптаулар мен навигация</b>\n⚙️ /notifications — Хабарламалар мен тілді баптау.\n🏠 /start — Басты мәзірді ашу.\n↩️ /cancel — Ағымдағы диалогты болдырмау.\n❓ /help — Осы анықтаманы ашу.\n\nӨтінішпен әрекеттер оның карточкасында қолжетімді.\n🚨 Өмірге тікелей қауіп төнсе, 112 нөміріне қоңырау шалыңыз.",
  },
  {
    "key": "help.worker_help",
    "section": "help",
    "title": "Справка сотрудников",
    "description": "Раздел справки",
    "variables": [],
    "ru":
      "<b>❓ Справка — ОСИ ЖК «Мунар Тау», бот сотрудников</b>\n\n<b>📬 Обращения</b>\n📬 /staffrequests — Очередь обращений в пределах ваших полномочий.\n💬 /staffrequest НОМЕР — Открыть обращение.\nУправление и переписка доступны кнопками в карточке. Новое обращение сотрудник создаёт в кабинете.\n\n<b>🗂 Задания</b>\n🗂 /tasks — Мои задания и их состояния.\n🔎 /task НОМЕР — Открыть задание.\n📎 /taskfiles — Файлы открытого задания.\n\n<b>🛠 Работа с заданием</b>\n✅ /accepttask НОМЕР — Принять задание.\n🙅 /declinetask НОМЕР — Сообщить, что не можете выполнить.\n▶️ /starttask НОМЕР — Начать работу.\n📝 /reporttask НОМЕР — Подготовить отчёт.\n📤 /submitreport — Передать результат на проверку.\n⏸ /pausetask НОМЕР — Запросить остановку работы.\n🔧 /problem НОМЕР — Сообщить о найденной проблеме.\n\n<b>⚙️ Настройки и навигация</b>\n⚙️ /notifications — Настроить уведомления и язык.\n🏠 /start — Открыть главное меню.\n↩️ /cancel — Отменить текущий диалог.\n❓ /help — Открыть эту справку.\n\nДоступные действия зависят от ваших полномочий и состояния записи.\n🚨 При непосредственной угрозе жизни звоните 112.",
    "kk":
      "<b>❓ Анықтама — «Мұнар Тау» ТК МИБ, қызметкерлер боты</b>\n\n<b>📬 Өтініштер</b>\n📬 /staffrequests — Өкілеттіктеріңіз шегіндегі өтініштер кезегі.\n💬 /staffrequest НӨМІР — Өтінішті ашу.\nБасқару мен хат алмасу карточкадағы батырмалар арқылы қолжетімді. Қызметкер жаңа өтінішті кабинетте жасайды.\n\n<b>🗂 Тапсырмалар</b>\n🗂 /tasks — Менің тапсырмаларым мен олардың күйлері.\n🔎 /task НӨМІР — Тапсырманы ашу.\n📎 /taskfiles — Ашық тапсырманың файлдары.\n\n<b>🛠 Тапсырмамен жұмыс</b>\n✅ /accepttask НӨМІР — Тапсырманы қабылдау.\n🙅 /declinetask НӨМІР — Орындай алмайтыныңызды хабарлау.\n▶️ /starttask НӨМІР — Жұмысты бастау.\n📝 /reporttask НӨМІР — Есеп дайындау.\n📤 /submitreport — Нәтижені тексеруге жіберу.\n⏸ /pausetask НӨМІР — Жұмысты тоқтатуды сұрау.\n🔧 /problem НӨМІР — Табылған мәселені хабарлау.\n\n<b>⚙️ Баптаулар мен навигация</b>\n⚙️ /notifications — Хабарламалар мен тілді баптау.\n🏠 /start — Басты мәзірді ашу.\n↩️ /cancel — Ағымдағы диалогты болдырмау.\n❓ /help — Осы анықтаманы ашу.\n\nҚолжетімді әрекеттер өкілеттіктеріңізге және жазба күйіне байланысты.\n🚨 Өмірге тікелей қауіп төнсе, 112 нөміріне қоңырау шалыңыз.",
  },
  {
    "key": "help.welcome_text",
    "section": "help",
    "title": "Приветствие",
    "description": "Раздел справки",
    "variables": [],
    "ru":
      "<b>ОСИ ЖК «Мунар Тау»</b>\nРегистрация, помещения, обращения и уведомления.\nПри непосредственной угрозе жизни звоните 112.",
    "kk":
      "<b>«Мұнар Тау» ТК МИБ</b>\nТіркелу, үй-жайлар, өтініштер және хабарламалар.\nӨмірге тікелей қауіп төнсе, 112 нөміріне қоңырау шалыңыз.",
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
