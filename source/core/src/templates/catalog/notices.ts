import type { TemplateDef } from "./types.ts";
export const noticesTemplates: readonly TemplateDef[] = [
  ...([
    ["approve", "Исправления анкеты подтверждены. Данные обновлены.", "Өтінім түзетулері расталды. Деректер жаңартылды."],
    ["reject", "Исправления анкеты отклонены. Прежние данные и доступ сохранены. {reason}", "Өтінім түзетулері қабылданбады. Бұрынғы деректер мен қолжетімділік сақталды. {reason}"],
    ["clarify", "Нужно уточнить исправления анкеты. Прежний доступ сохранён. {reason}", "Өтінім түзетулерін нақтылау керек. Бұрынғы қолжетімділік сақталды. {reason}"],
  ] as const).map(([decision, ru, kk]) => ({
    key: `notices.registration.correction_${decision}`, section: "notices" as const, scenario: "Уведомления · Исправление анкеты", title: `${({ approve: "Исправления подтверждены", reject: "Исправления отклонены", clarify: "Уточнение исправлений" })[decision]} → заявителю`,
    description: "Решение ОСИ без изменения прежнего доступа при отказе или уточнении",
    variables: [{ name: "reason", description: "Причина решения", example: "Уточните телефон" }], ru, kk,
    examples: [{ id: "default", title: "Решение по исправлениям", ru: { reason: "Уточните телефон" }, kk: { reason: "Телефонды нақтылаңыз" } }],
  })),

  {
    "key": "notices.registrations_service_submit_registration_1",
    "section": "notices",
    "title": "Новая анкета арендатора → собственнику",
    "description":
      "Новая анкета арендатора → собственнику. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "fullname",
        "description": "Имя заявителя",
        "example": "Иван Тестов",
      },
      {
        "name": "premisetext",
        "description": "Помещение по-русски",
        "example": "квартира 12",
      },
      {
        "name": "premisetextkk",
        "description": "Помещение по-казахски",
        "example": "пәтер 12",
      },
    ],
    "ru":
      "Новая анкета арендатора: {fullname}, {premisetext}. Рассмотрите её в кабинете или боте (/pending).",
    "kk":
      "Жалға алушының өтінімі: {fullname}, {premisetextkk}. Кабинетте немесе ботыпта қарастырыңыз (/pending).",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "fullname": "Иван Тестов",
          "premisetext": "квартира 12",
          "premisetextkk": "пәтер 12",
        },
        "kk": {
          "fullname": "Иван Тестов",
          "premisetext": "квартира 12",
          "premisetextkk": "пәтер 12",
        },
      },
    ],
  },
  {
    "key": "notices.registrations_service_submit_registration_2",
    "section": "notices",
    "title": "Новая анкета → администратору",
    "description":
      "Новая анкета → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "fullname",
        "description": "Имя заявителя",
        "example": "Иван Тестов",
      },
      {
        "name": "premisetext",
        "description": "Помещение по-русски",
        "example": "квартира 12",
      },
      {
        "name": "premisetextkk",
        "description": "Помещение по-казахски",
        "example": "пәтер 12",
      },
    ],
    "ru": "Новая анкета: {fullname}, {premisetext}",
    "kk": "Жаңа өтінім: {fullname}, {premisetextkk}",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "fullname": "Иван Тестов",
          "premisetext": "квартира 12",
          "premisetextkk": "пәтер 12",
        },
        "kk": {
          "fullname": "Иван Тестов",
          "premisetext": "квартира 12",
          "premisetextkk": "пәтер 12",
        },
      },
    ],
  },
  {
    "key": "notices.registrations_service_submit_registration_lite",
    "section": "notices",
    "title": "Новая анкета без помещения → администратору",
    "description":
      "Новая анкета без помещения (REG-01) → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "fullname",
        "description": "Имя заявителя",
        "example": "Иван Тестов",
      },
    ],
    "ru": "Новая анкета без помещения: {fullname}",
    "kk": "Үй-жайсыз жаңа өтінім: {fullname}",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": { "fullname": "Иван Тестов" },
        "kk": { "fullname": "Иван Тестов" },
      },
    ],
  },
  {
    "key": "notices.registrations_service_review_registration_3",
    "section": "notices",
    "title": "Решение по анкете → заявителю",
    "description":
      "Решение по анкете → заявителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "state_ru",
        "description": "Подпись состояния (ru)",
        "example": "В работе",
      },
      {
        "name": "reason",
        "description": "Причина решения",
        "example": "Уточнить данные",
      },
      {
        "name": "state_kk",
        "description": "Подпись состояния (kk)",
        "example": "Жұмыста",
      },
    ],
    "ru": "Состояние регистрации: {state_ru}.{reason}",
    "kk": "Тіркелу күйі: {state_kk}.{reason}",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "state_ru": "В работе",
          "reason": "Уточнить данные",
          "state_kk": "Жұмыста",
        },
        "kk": {
          "state_ru": "В работе",
          "reason": "Уточнить данные",
          "state_kk": "Жұмыста",
        },
      },
    ],
  },
  {
    "key": "notices.registrations_service_review_registration_3_clarify",
    "section": "notices",
    "title": "Нужно уточнение анкеты → заявителю",
    "description":
      "Нужно уточнение анкеты → заявителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "state_ru",
        "description": "Подпись состояния (ru)",
        "example": "В работе",
      },
      {
        "name": "reason",
        "description": "Причина решения",
        "example": "Уточнить данные",
      },
      {
        "name": "state_kk",
        "description": "Подпись состояния (kk)",
        "example": "Жұмыста",
      },
    ],
    "ru":
      "Состояние регистрации: {state_ru}.{reason} Исправьте анкету: отправьте боту /fix.",
    "kk":
      "Тіркелу күйі: {state_kk}.{reason} Түзету үшін ботыға /fix жіберіңіз.",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "state_ru": "В работе",
          "reason": "Уточнить данные",
          "state_kk": "Жұмыста",
        },
        "kk": {
          "state_ru": "В работе",
          "reason": "Уточнить данные",
          "state_kk": "Жұмыста",
        },
      },
    ],
  },
  {
    "key": "notices.registrations_service_accept_invite_4",
    "section": "notices",
    "title": "Приглашение принято → собственнику",
    "description":
      "Приглашение принято → собственнику. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "actor_person_fullname",
        "description": "Имя участника",
        "example": "Иван Тестов",
      },
      {
        "name": "detail_b",
        "description": "Данные события",
        "example": "Пример",
      },
      {
        "name": "premises_number",
        "description": "Номер помещения",
        "example": "12",
      },
      {
        "name": "detail_d",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "Принято приглашение собственника: {actor_person_fullname}, {detail_b} {premises_number}",
    "kk":
      "Меншік иесінің шақырысы қабылданды: {actor_person_fullname}, {detail_d} {premises_number}",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "actor_person_fullname": "Иван Тестов",
          "detail_b": "Пример",
          "premises_number": "12",
          "detail_d": "Пример",
        },
        "kk": {
          "actor_person_fullname": "Иван Тестов",
          "detail_b": "Пример",
          "premises_number": "12",
          "detail_d": "Пример",
        },
      },
    ],
  },
  {
    "key": "notices.registrations_service_accept_invite_5",
    "section": "notices",
    "title": "Приглашение принято → приглашённому",
    "description":
      "Приглашение принято → приглашённому. Полный текст уведомления на языке получателя.",
    "variables": [],
    "ru": "Приглашение принято",
    "kk": "Шақыру қабылданды",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "notices.registrations_service_revoke_own_connection_6",
    "section": "notices",
    "title": "Связь с помещением прекращена → жителю",
    "description":
      "Связь с помещением прекращена → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "reason",
        "description": "Причина решения",
        "example": "Уточнить данные",
      },
    ],
    "ru": "Связь прекращена: {reason}",
    "kk": "Байланыс тоқтатылды: {reason}",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "reason": "Уточнить данные",
        },
        "kk": {
          "reason": "Уточнить данные",
        },
      },
    ],
  },
  {
    "key": "notices.registrations_jobs_sweep_registrations_1",
    "section": "notices",
    "title": "Просрочен спор → ответственному",
    "description":
      "Просрочен спор → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "detail_a",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru": "Спор просрочен: {detail_a}. Рассмотрите в кабинете.",
    "kk": "Дау мерзімі өтті: {detail_a}. Кабинетте қарастырыңыз.",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "detail_a": "Пример",
        },
        "kk": {
          "detail_a": "Пример",
        },
      },
    ],
  },
  {
    "key": "notices.registrations_jobs_sweep_registrations_2",
    "section": "notices",
    "title": "Просрочено рассмотрение анкеты → ответственному",
    "description":
      "Просрочено рассмотрение анкеты → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "detail_a",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru": "Требуется решение по анкете: {detail_a}. Рассмотрите в кабинете.",
    "kk": "Өтінім бойынша шешім қажет: {detail_a}. Кабинетте қарастырыңыз.",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "detail_a": "Пример",
        },
        "kk": {
          "detail_a": "Пример",
        },
      },
    ],
  },
  {
    "key": "notices.registrations_jobs_sweep_registrations_3",
    "section": "notices",
    "title": "Анкета передана далее → заявителю",
    "description":
      "Анкета передана далее → заявителю. Полный текст уведомления на языке получателя.",
    "variables": [],
    "ru": "Анкета передана следующему ответственному",
    "kk": "Өтінім келесі жауапты қызметкерге берілді",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "notices.requests_service_create_request_1",
    "section": "notices",
    "title": "Обращение зарегистрировано → автору",
    "description":
      "Обращение зарегистрировано → автору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "next_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "detail_b",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "{next_number}: обращение зарегистрировано. Первый ответ до {detail_b}.",
    "kk": "{next_number}: өтініш тіркелді. Алғашқы жауап {detail_b}.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "next_number": "З-26-00001",
          "detail_b": "Пример",
        },
        "kk": {
          "next_number": "З-26-00001",
          "detail_b": "Пример",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.requests_service_transition_request_2",
    "section": "notices",
    "title": "Черновик отправлен → автору",
    "description":
      "Черновик отправлен → автору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "next_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "detail_b",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru": "{next_number}: зарегистрировано. Первый ответ до {detail_b}.",
    "kk": "{next_number}: тіркелді. Алғашқы жауап {detail_b}.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "next_number": "З-26-00001",
          "detail_b": "Пример",
        },
        "kk": {
          "next_number": "З-26-00001",
          "detail_b": "Пример",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.requests_service_transition_request_3",
    "section": "notices",
    "title": "Состояние обращения изменилось → участнику",
    "description":
      "Состояние обращения изменилось → участнику. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "st_ru",
        "description": "Подпись состояния (ru)",
        "example": "В работе",
      },
      {
        "name": "st_kk",
        "description": "Подпись состояния (kk)",
        "example": "Жұмыста",
      },
    ],
    "ru": "{row_number}: {st_ru}. Подробности в карточке обращения.",
    "kk": "{row_number}: {st_kk}. Толығырақ өтініш карточкасында.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
          "st_ru": "В работе",
          "st_kk": "Жұмыста",
        },
        "kk": {
          "row_number": "З-26-00001",
          "st_ru": "В работе",
          "st_kk": "Жұмыста",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.requests_messages_add_message_1",
    "section": "notices",
    "title": "Новое сообщение → участнику обращения",
    "description":
      "Новое сообщение → участнику обращения. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{row_number}: новое сообщение. Откройте карточку обращения.",
    "kk": "{row_number}: жаңа хабарлама. Өтініш карточкасын ашыңыз.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
        },
        "kk": {
          "row_number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_service_task_log_1",
    "section": "notices",
    "title": "Назначение снято → исполнителю",
    "description":
      "Назначение снято → исполнителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "Ваше назначение на задание {row_number} снято.",
    "kk": "{row_number} тапсырмасына тағайындауыңыз алынып тасталды.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
        },
        "kk": {
          "row_number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "task",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "task",
        "ru": "Открыть задание",
        "kk": "Тапсырманы ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_service_task_log_2",
    "section": "notices",
    "title": "Состояние задания → исполнителю",
    "description":
      "Состояние задания → исполнителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "state_ru",
        "description": "Подпись состояния (ru)",
        "example": "В работе",
      },
      {
        "name": "state_kk",
        "description": "Подпись состояния (kk)",
        "example": "Жұмыста",
      },
    ],
    "ru": "Задание {row_number}: {state_ru}. Откройте карточку задания.",
    "kk": "{row_number} тапсырма: {state_kk}. Тапсырма картасын ашыңыз.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
          "state_ru": "В работе",
          "state_kk": "Жұмыста",
        },
        "kk": {
          "row_number": "З-26-00001",
          "state_ru": "В работе",
          "state_kk": "Жұмыста",
        },
        "buttons": [
          [
            {
              "id": "task",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "task",
        "ru": "Открыть задание",
        "kk": "Тапсырманы ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_service_task_log_2_pause",
    "section": "notices",
    "title": "Запрос остановки → ответственному",
    "description":
      "Запрос остановки → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "reason",
        "description": "Причина решения",
        "example": "Уточнить данные",
      },
    ],
    "ru":
      "Задание {row_number}: исполнитель запросил остановку: {reason}. Откройте карточку задания.",
    "kk":
      "{row_number} тапсырма: орындаушы тоқтату сұрады: {reason}. Тапсырма картасын ашыңыз.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
          "reason": "Уточнить данные",
        },
        "kk": {
          "row_number": "З-26-00001",
          "reason": "Уточнить данные",
        },
        "buttons": [
          [
            {
              "id": "task",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "task",
        "ru": "Открыть задание",
        "kk": "Тапсырманы ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_service_task_log_2_problem",
    "section": "notices",
    "title": "Найдена проблема → ответственному",
    "description":
      "Найдена проблема → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru":
      "Задание {row_number}: исполнитель сообщил о найденной проблеме. Откройте карточку задания.",
    "kk":
      "{row_number} тапсырма: орындаушы табылған мәселе туралы хабарлады. Тапсырма картасын ашыңыз.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
        },
        "kk": {
          "row_number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "task",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "task",
        "ru": "Открыть задание",
        "kk": "Тапсырманы ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_common_work_log_1",
    "section": "notices",
    "title": "Общая работа: изменение состояния → жителю",
    "description":
      "Общая работа: изменение состояния → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "request_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "detail_c",
        "description": "Данные события",
        "example": "Пример",
      },
      {
        "name": "detail_e",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "Обращение {request_number}: общая работа {row_number} {detail_c}. Проверка вашего обращения остаётся отдельной.",
    "kk":
      "{request_number} өтінім: жалпы жұмыс {row_number} {detail_e}. Сіздің өтінішіңіздің тексерісі бөлек өтеді.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "request_number": "З-26-00001",
          "row_number": "З-26-00001",
          "detail_c": "Пример",
          "detail_e": "Пример",
        },
        "kk": {
          "request_number": "З-26-00001",
          "row_number": "З-26-00001",
          "detail_c": "Пример",
          "detail_e": "Пример",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_common_work_log_1_unfinished",
    "section": "notices",
    "title": "Общая работа: остаются локальные задания → жителю",
    "description":
      "Общая работа: остаются локальные задания → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "request_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "detail_c",
        "description": "Данные события",
        "example": "Пример",
      },
      {
        "name": "detail_e",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "Обращение {request_number}: общая работа {row_number} {detail_c}. Остаются локальные задания; результат обращения пока не готов.",
    "kk":
      "{request_number} өтінім: жалпы жұмыс {row_number} {detail_e}. Жергілікті тапсырмалар бар; өтініштің нәтижесі әзірше дайын емес.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "request_number": "З-26-00001",
          "row_number": "З-26-00001",
          "detail_c": "Пример",
          "detail_e": "Пример",
        },
        "kk": {
          "request_number": "З-26-00001",
          "row_number": "З-26-00001",
          "detail_c": "Пример",
          "detail_e": "Пример",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_common_work_log_1_ready",
    "section": "notices",
    "title": "Общая работа: результат готовится → жителю",
    "description":
      "Общая работа: результат готовится → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "request_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "detail_c",
        "description": "Данные события",
        "example": "Пример",
      },
      {
        "name": "detail_e",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "Обращение {request_number}: общая работа {row_number} {detail_c}. Администратор подготовит результат для вашего отдельного подтверждения.",
    "kk":
      "{request_number} өтінім: жалпы жұмыс {row_number} {detail_e}. Әкімші нәтижені сіздің жеке растауыңызға дайындайды.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "request_number": "З-26-00001",
          "row_number": "З-26-00001",
          "detail_c": "Пример",
          "detail_e": "Пример",
        },
        "kk": {
          "request_number": "З-26-00001",
          "row_number": "З-26-00001",
          "detail_c": "Пример",
          "detail_e": "Пример",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_common_link_2",
    "section": "notices",
    "title": "Обращение включено в общую работу → жителю",
    "description":
      "Обращение включено в общую работу → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "request_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "work_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "detail_d",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "Обращение {request_number} включено в общую работу {work_number}. Срок: {detail_d}. Результат по вашему обращению подтвердят отдельно.",
    "kk":
      "{request_number} өтінім {work_number} жалпы жұмысына енгізілді. Мерзім: {detail_d}. Өтінішіңіздің нәтижесі бөлек расталады.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "request_number": "З-26-00001",
          "work_number": "З-26-00001",
          "detail_d": "Пример",
        },
        "kk": {
          "request_number": "З-26-00001",
          "work_number": "З-26-00001",
          "detail_d": "Пример",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_common_link_2_plan",
    "section": "notices",
    "title": "Обращение включено в общую работу с планом → жителю",
    "description":
      "Обращение включено в общую работу с планом → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "request_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "work_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "plan",
        "description": "План работы",
        "example": "Проверить оборудование",
      },
      {
        "name": "detail_d",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "Обращение {request_number} включено в общую работу {work_number}. План: {plan}. Срок: {detail_d}. Результат по вашему обращению подтвердят отдельно.",
    "kk":
      "{request_number} өтінім {work_number} жалпы жұмысына енгізілді. Жоспар: {plan}. Мерзім: {detail_d}. Өтінішіңіздің нәтижесі бөлек расталады.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "request_number": "З-26-00001",
          "work_number": "З-26-00001",
          "plan": "Проверить оборудование",
          "detail_d": "Пример",
        },
        "kk": {
          "request_number": "З-26-00001",
          "work_number": "З-26-00001",
          "plan": "Проверить оборудование",
          "detail_d": "Пример",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_common_unlink_common_request_3",
    "section": "notices",
    "title": "Обращение выведено из общей работы → жителю",
    "description":
      "Обращение выведено из общей работы → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "request_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "plan",
        "description": "План работы",
        "example": "Проверить оборудование",
      },
    ],
    "ru": "Обращение {request_number}: дальнейший план — {plan}.",
    "kk": "{request_number} өтінім: әрі қарайғы жоспар — {plan}.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "request_number": "З-26-00001",
          "plan": "Проверить оборудование",
        },
        "kk": {
          "request_number": "З-26-00001",
          "plan": "Проверить оборудование",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_visits_propose_visit_1",
    "section": "notices",
    "title": "Предложен визит → жителю",
    "description":
      "Предложен визит → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "detail_a",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "Предложен визит: {detail_a}. Подтвердите интервал в карточке обращения.",
    "kk": "Сапар ұсынылды: {detail_a}. Аралықты өтініш картасында растаңыз.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "detail_a": "Пример",
        },
        "kk": {
          "detail_a": "Пример",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_visits_update_visit_2",
    "section": "notices",
    "title": "Нет доступа для визита → жителю",
    "description":
      "Нет доступа для визита → жителю. Полный текст уведомления на языке получателя.",
    "variables": [],
    "ru": "Исполнитель сообщил об отсутствии доступа. Согласуйте новый визит.",
    "kk":
      "Орындаушы қолжетімділік жоқ екенін хабарлады. Жаңа сапарды келістіріңіз.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {},
        "kk": {},
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.registry_service_mutate_registry_1",
    "section": "notices",
    "title": "Сменился собственник → бывшему участнику",
    "description":
      "Сменился собственник → бывшему участнику. Полный текст уведомления на языке получателя.",
    "variables": [],
    "ru": "Связь прекращена при смене собственника",
    "kk": "Меншік иесі ауысқанда байланыс тоқтатылды",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "notices.registry_service_mutate_registry_2",
    "section": "notices",
    "title": "Связь отозвана с причиной → жителю",
    "description":
      "Связь отозвана с причиной → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "after_revoked_reason",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru": "Связь прекращена: {after_revoked_reason}",
    "kk": "Байланыс тоқтатылды: {after_revoked_reason}",
    "scenario": "Уведомления · Регистрация и доступ",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "after_revoked_reason": "Пример",
        },
        "kk": {
          "after_revoked_reason": "Пример",
        },
      },
    ],
  },
  {
    "key": "notices.privacy_service_submit_privacy_request_1",
    "section": "notices",
    "title": "Запрос о персональных данных → администратору",
    "description":
      "Запрос о персональных данных → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "detail_a",
        "description": "Данные события",
        "example": "Пример",
      },
      {
        "name": "actor_person_fullname",
        "description": "Имя участника",
        "example": "Иван Тестов",
      },
      {
        "name": "detail_c",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "Запрос ({detail_a}): {actor_person_fullname}. Рассмотрите его в кабинете ОСИ.",
    "kk":
      "Сұрау ({detail_c}): {actor_person_fullname}. ОСИ кабинетінде қарастырыңыз.",
    "scenario": "Уведомления · Персональные данные",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "detail_a": "Пример",
          "actor_person_fullname": "Иван Тестов",
          "detail_c": "Пример",
        },
        "kk": {
          "detail_a": "Пример",
          "actor_person_fullname": "Иван Тестов",
          "detail_c": "Пример",
        },
      },
    ],
  },
  {
    "key": "notices.publications_service_broadcast_publication_1",
    "section": "notices",
    "title": "Публикация → подписчику",
    "description":
      "Публикация → подписчику. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_title",
        "description": "Заголовок",
        "example": "Плановые работы",
      },
      {
        "name": "row_body",
        "description": "Содержимое публикации",
        "example": "Работы завершены",
      },
    ],
    "ru": "{row_title}\n{row_body}",
    "kk": "{row_title}\n{row_body}",
    "scenario": "Уведомления · Публикации",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_title": "Плановые работы",
          "row_body": "Работы завершены",
        },
        "kk": {
          "row_title": "Плановые работы",
          "row_body": "Работы завершены",
        },
      },
    ],
  },
  {
    "key": "notices.publications_service_broadcast_publication_1_pending",
    "section": "notices",
    "title": "Плановое отключение: восстановление ожидается → жителю",
    "description":
      "Плановое отключение: восстановление ожидается → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_title",
        "description": "Заголовок",
        "example": "Плановые работы",
      },
      {
        "name": "row_body",
        "description": "Содержимое публикации",
        "example": "Работы завершены",
      },
      {
        "name": "interval",
        "description": "Интервал работ",
        "example": "18.10 10:00–12:00",
      },
    ],
    "ru":
      "{row_title}\n{row_body}\nПлан: {interval}. Восстановление: пока не подтверждено",
    "kk":
      "{row_title}\n{row_body}\nЖоспар: {interval}. Қалпына келтіру: әлі расталмады",
    "scenario": "Уведомления · Публикации",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_title": "Плановые работы",
          "row_body": "Работы завершены",
          "interval": "18.10 10:00–12:00",
        },
        "kk": {
          "row_title": "Плановые работы",
          "row_body": "Работы завершены",
          "interval": "18.10 10:00–12:00",
        },
      },
    ],
  },
  {
    "key": "notices.publications_service_broadcast_publication_1_restored",
    "section": "notices",
    "title": "Плановое отключение: восстановлено → жителю",
    "description":
      "Плановое отключение: восстановлено → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_title",
        "description": "Заголовок",
        "example": "Плановые работы",
      },
      {
        "name": "row_body",
        "description": "Содержимое публикации",
        "example": "Работы завершены",
      },
      {
        "name": "interval",
        "description": "Интервал работ",
        "example": "18.10 10:00–12:00",
      },
      {
        "name": "restored_at",
        "description": "Дата восстановления",
        "example": "18.10.2026 12:00",
      },
    ],
    "ru":
      "{row_title}\n{row_body}\nПлан: {interval}. Восстановление: {restored_at}",
    "kk":
      "{row_title}\n{row_body}\nЖоспар: {interval}. Қалпына келтіру: {restored_at}",
    "scenario": "Уведомления · Публикации",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_title": "Плановые работы",
          "row_body": "Работы завершены",
          "interval": "18.10 10:00–12:00",
          "restored_at": "18.10.2026 12:00",
        },
        "kk": {
          "row_title": "Плановые работы",
          "row_body": "Работы завершены",
          "interval": "18.10 10:00–12:00",
          "restored_at": "18.10.2026 12:00",
        },
      },
    ],
  },
  {
    "key": "notices.locales_notifications_author_reminder_1",
    "section": "notices",
    "title": "Напоминание подтвердить результат → автору",
    "description":
      "Напоминание подтвердить результат → автору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{number}: подтвердите результат или верните на доработку.",
    "kk": "{number}: нәтижені растаңыз немесе түзетуге қайтарыңыз.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "number": "З-26-00001",
        },
        "kk": {
          "number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.locales_notifications_admin_check_2",
    "section": "notices",
    "title": "Нет ответа на результат → администратору",
    "description":
      "Нет ответа на результат → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{number}: автор не ответил, требуется проверка администратора.",
    "kk": "{number}: автор жауап бермеді, әкімшінің тексеруі қажет.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "number": "З-26-00001",
        },
        "kk": {
          "number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.locales_notifications_delivery_failed_3",
    "section": "notices",
    "title": "Уведомление не доставлено → администратору",
    "description":
      "Уведомление не доставлено → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru":
      "{number}: важное уведомление не доставлено. Свяжитесь с жителем по телефону.",
    "kk": "{number}: маңызды хабарлама жеткізілмеді, тұрғынға қоңырау шалыңыз.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "number": "З-26-00001",
        },
        "kk": {
          "number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.locales_notifications_first_response_overdue_4",
    "section": "notices",
    "title": "Первый ответ просрочен → ответственному",
    "description":
      "Первый ответ просрочен → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{number}: истёк срок первого ответа.",
    "kk": "{number}: алғашқы жауап мерзімі өтті.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "number": "З-26-00001",
        },
        "kk": {
          "number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.locales_notifications_next_action_reminder_5",
    "section": "notices",
    "title": "Наступило следующее действие → ответственному",
    "description":
      "Наступило следующее действие → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{number}: наступила дата следующего действия.",
    "kk": "{number}: келесі әрекет күні келді.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "number": "З-26-00001",
        },
        "kk": {
          "number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.requests_service_create_request_101",
    "section": "notices",
    "title": "Новое обращение → администратору",
    "description":
      "Новое обращение → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "next_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{next_number}: новое обращение",
    "kk": "{next_number}: жаңа өтініш",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "next_number": "З-26-00001",
        },
        "kk": {
          "next_number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.requests_service_transition_request_102",
    "section": "notices",
    "title": "Отправлен черновик → администратору",
    "description":
      "Отправлен черновик → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "next_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{next_number}: новое обращение",
    "kk": "{next_number}: жаңа өтініш",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "next_number": "З-26-00001",
        },
        "kk": {
          "next_number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.requests_service_transition_request_103",
    "section": "notices",
    "title": "Состояние обращения → администратору",
    "description":
      "Состояние обращения → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "st_ru",
        "description": "Подпись состояния (ru)",
        "example": "В работе",
      },
      {
        "name": "st_kk",
        "description": "Подпись состояния (kk)",
        "example": "Жұмыста",
      },
    ],
    "ru": "{row_number}: {st_ru}",
    "kk": "{row_number}: {st_kk}",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
          "st_ru": "В работе",
          "st_kk": "Жұмыста",
        },
        "kk": {
          "row_number": "З-26-00001",
          "st_ru": "В работе",
          "st_kk": "Жұмыста",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.requests_messages_add_message_101",
    "section": "notices",
    "title": "Сообщение в обращении → администратору",
    "description":
      "Сообщение в обращении → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{row_number}: новое сообщение",
    "kk": "{row_number}: жаңа хабарлама",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
        },
        "kk": {
          "row_number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.requests_messages_rate_request_102",
    "section": "notices",
    "title": "Низкая оценка → администратору",
    "description":
      "Низкая оценка → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{row_number}: низкая оценка",
    "kk": "{row_number}: төмен баға",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
        },
        "kk": {
          "row_number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Открыть обращение",
        "kk": "Өтінішті ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_timing_sweep_task_timers_101",
    "section": "notices",
    "title": "Задание не принято вовремя → ответственному",
    "description":
      "Задание не принято вовремя → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "detail_a",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru":
      "Задание {detail_a} не принято исполнителем. Требуется проверить назначение.",
    "kk":
      "{detail_a}: орындаушы тапсырманы қабылдамады. Тағайындауды тексеру қажет.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "detail_a": "Пример",
        },
        "kk": {
          "detail_a": "Пример",
        },
        "buttons": [
          [
            {
              "id": "task",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "task",
        "ru": "Открыть задание",
        "kk": "Тапсырманы ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_timing_sweep_task_timers_102",
    "section": "notices",
    "title": "Срок задания истёк → ответственному",
    "description":
      "Срок задания истёк → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "task_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "Задание {task_number}: срок выполнения истёк.",
    "kk": "{task_number}: орындау мерзімі өтті.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "task_number": "З-26-00001",
        },
        "kk": {
          "task_number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "task",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "task",
        "ru": "Открыть задание",
        "kk": "Тапсырманы ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_timing_sweep_task_timers_103",
    "section": "notices",
    "title": "Следующее действие по заданию → ответственному",
    "description":
      "Следующее действие по заданию → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "task_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "Задание {task_number}: наступила дата следующего действия.",
    "kk": "{task_number}: келесі әрекет күні келді.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "task_number": "З-26-00001",
        },
        "kk": {
          "task_number": "З-26-00001",
        },
        "buttons": [
          [
            {
              "id": "task",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "task",
        "ru": "Открыть задание",
        "kk": "Тапсырманы ашу",
      },
    ],
  },
  {
    "key": "notices.tasks_schedule_process_scheduled_jobs_101",
    "section": "notices",
    "title": "Регулярное задание создано → ответственному",
    "description":
      "Регулярное задание создано → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "detail_a",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru": "Создано регулярное задание {detail_a}.",
    "kk": "{detail_a}: жоспарлы тапсырма жасалды.",
    "scenario": "Уведомления · Задания и работы",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "detail_a": "Пример",
        },
        "kk": {
          "detail_a": "Пример",
        },
        "buttons": [
          [
            {
              "id": "task",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "task",
        "ru": "Открыть задание",
        "kk": "Тапсырманы ашу",
      },
    ],
  },
  {
    "key": "notices.bot_request-files_process_request_uploads_101",
    "section": "notices",
    "title": "Файл сохранён → отправителю",
    "description":
      "Файл сохранён → отправителю. Полный текст уведомления на языке получателя.",
    "variables": [],
    "ru": "Файл сохранён",
    "kk": "Файл сақталды",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "notices.bot_request-files_process_request_uploads_102",
    "section": "notices",
    "title": "Файл не сохранён → отправителю",
    "description":
      "Файл не сохранён → отправителю. Полный текст уведомления на языке получателя.",
    "variables": [],
    "ru":
      "Файл не сохранён: повторите загрузку или выберите другой файл. Текст обращения сохранён.",
    "kk":
      "Файл сақталмады: қайта жүктеңіз немесе басқа файлды таңдаңыз. Өтініш мәтіні сақталды.",
    "scenario": "Уведомления · Обращения",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "notices.incidents_duty_notify_signal_101",
    "section": "notices",
    "title": "Новый срочный сигнал → дежурному",
    "description":
      "Новый срочный сигнал → дежурному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "s_id",
        "description": "Идентификатор события",
        "example": "00000000-0000-0000-0000-000000000001",
      },
    ],
    "ru":
      "Возможная авария {s_id}. Требуется явное принятие текущим ответственным.",
    "kk": "Ықтимал апат {s_id}. Қазіргі жауапты тұлғаның қабылдауы қажет.",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
        "kk": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_101_invalid",
    "section": "notices",
    "title": "Сигнал не принят, назначение недействительно → администратору",
    "description":
      "Сигнал не принят, назначение недействительно → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "s_id",
        "description": "Идентификатор события",
        "example": "00000000-0000-0000-0000-000000000001",
      },
    ],
    "ru":
      "Возможная авария {s_id}: нет принятия. Ответственность передана администратору; назначение недействительно, требуется замена.",
    "kk":
      "Ықтимал апат {s_id}: қабылданбады. Жауапкершілік әкімшіге берілді; жаңа жауаптыны тағайындау қажет.",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
        "kk": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_101",
    "section": "notices",
    "title": "Сигнал не принят → администратору",
    "description":
      "Сигнал не принят → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "s_id",
        "description": "Идентификатор события",
        "example": "00000000-0000-0000-0000-000000000001",
      },
    ],
    "ru":
      "Возможная авария {s_id}: нет принятия. Ответственность передана администратору.",
    "kk": "Ықтимал апат {s_id}: қабылданбады. Жауапкершілік әкімшіге берілді.",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
        "kk": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_101_reserve_invalid",
    "section": "notices",
    "title":
      "Сигнал не принят, назначение недействительно → резервному дежурному",
    "description":
      "Сигнал не принят, назначение недействительно → резервному дежурному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "s_id",
        "description": "Идентификатор события",
        "example": "00000000-0000-0000-0000-000000000001",
      },
    ],
    "ru":
      "Возможная авария {s_id}: нет принятия. Ответственность передана резервному дежурному; назначение недействительно, требуется замена.",
    "kk":
      "Ықтимал апат {s_id}: қабылданбады. Жауапкершілік резервтік кезекшіге берілді; жаңа жауаптыны тағайындау қажет.",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
        "kk": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_101_reserve",
    "section": "notices",
    "title": "Сигнал не принят → резервному дежурному",
    "description":
      "Сигнал не принят → резервному дежурному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "s_id",
        "description": "Идентификатор события",
        "example": "00000000-0000-0000-0000-000000000001",
      },
    ],
    "ru":
      "Возможная авария {s_id}: нет принятия. Ответственность передана резервному дежурному.",
    "kk":
      "Ықтимал апат {s_id}: қабылданбады. Жауапкершілік резервтік кезекшіге берілді.",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
        "kk": {
          "s_id": "00000000-0000-0000-0000-000000000001",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_102",
    "section": "notices",
    "title": "Пропущено обновление аварии → ответственному",
    "description":
      "Пропущено обновление аварии → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_id",
        "description": "Идентификатор события",
        "example": "00000000-0000-0000-0000-000000000001",
      },
    ],
    "ru":
      "Авария {row_id}: пропущено обещанное обновление. Опубликуйте актуальные сведения.",
    "kk":
      "Апат {row_id}: жоспарланған жаңарту кешіктірілді. Өзекті ақпаратты жариялаңыз.",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_id": "00000000-0000-0000-0000-000000000001",
        },
        "kk": {
          "row_id": "00000000-0000-0000-0000-000000000001",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_103",
    "section": "notices",
    "title": "Повторно пропущено обновление аварии → администратору",
    "description":
      "Повторно пропущено обновление аварии → администратору. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_id",
        "description": "Идентификатор события",
        "example": "00000000-0000-0000-0000-000000000001",
      },
    ],
    "ru":
      "Авария {row_id}: ответственный не обновил сведения. Требуется вмешательство.",
    "kk": "Апат {row_id}: жауапты ақпаратты жаңартпады. Араласу қажет.",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_id": "00000000-0000-0000-0000-000000000001",
        },
        "kk": {
          "row_id": "00000000-0000-0000-0000-000000000001",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_failures_emergency_delivery_failure_101",
    "section": "notices",
    "title": "Аварийное уведомление не доставлено → ответственному",
    "description":
      "Аварийное уведомление не доставлено → ответственному. Полный текст уведомления на языке получателя.",
    "variables": [],
    "ru":
      "Важное аварийное уведомление не доставлено. Проверьте журнал доставки и свяжитесь с ответственным или жителем.",
    "kk":
      "Маңызды апат хабарламасы жеткізілмеді. Жеткізу журналын тексеріп, жауапты тұлғамен немесе тұрғынмен байланысыңыз.",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "notices.incidents_service_broadcast_incident_101",
    "section": "notices",
    "title": "Авария → жителю",
    "description":
      "Авария → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "row_title",
        "description": "Заголовок",
        "example": "Плановые работы",
      },
      {
        "name": "row_public_text",
        "description": "Опубликованный текст инцидента",
        "example": "Проверяем причину",
      },
      {
        "name": "row_service",
        "description": "Услуга",
        "example": "Вода",
      },
      {
        "name": "row_forecast",
        "description": "Прогноз",
        "example": "До 18:00",
      },
    ],
    "ru":
      "🚨 Авария {row_number}: {row_title}\n{row_public_text}\nУслуга: {row_service}\nПрогноз: {row_forecast}",
    "kk":
      "🚨 Апат {row_number}: {row_title}\n{row_public_text}\nҚызмет: {row_service}\nБолжам: {row_forecast}",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
          "row_title": "Плановые работы",
          "row_public_text": "Проверяем причину",
          "row_service": "Вода",
          "row_forecast": "До 18:00",
        },
        "kk": {
          "row_number": "З-26-00001",
          "row_title": "Плановые работы",
          "row_public_text": "Проверяем причину",
          "row_service": "Вода",
          "row_forecast": "До 18:00",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_service_broadcast_incident_101_restrictions",
    "section": "notices",
    "title": "Авария с ограничениями → жителю",
    "description":
      "Авария с ограничениями → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "row_title",
        "description": "Заголовок",
        "example": "Плановые работы",
      },
      {
        "name": "row_public_text",
        "description": "Опубликованный текст инцидента",
        "example": "Проверяем причину",
      },
      {
        "name": "row_service",
        "description": "Услуга",
        "example": "Вода",
      },
      {
        "name": "row_forecast",
        "description": "Прогноз",
        "example": "До 18:00",
      },
      {
        "name": "restrictions",
        "description": "Ограничения",
        "example": "Не пользоваться лифтом",
      },
    ],
    "ru":
      "🚨 Авария {row_number}: {row_title}\n{row_public_text}\nУслуга: {row_service}\nПрогноз: {row_forecast}\nОграничения: {restrictions}",
    "kk":
      "🚨 Апат {row_number}: {row_title}\n{row_public_text}\nҚызмет: {row_service}\nБолжам: {row_forecast}\nШектеулер: {restrictions}",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
          "row_title": "Плановые работы",
          "row_public_text": "Проверяем причину",
          "row_service": "Вода",
          "row_forecast": "До 18:00",
          "restrictions": "Не пользоваться лифтом",
        },
        "kk": {
          "row_number": "З-26-00001",
          "row_title": "Плановые работы",
          "row_public_text": "Проверяем причину",
          "row_service": "Вода",
          "row_forecast": "До 18:00",
          "restrictions": "Не пользоваться лифтом",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_service_broadcast_incident_101_next",
    "section": "notices",
    "title": "Авария со сроком обновления → жителю",
    "description":
      "Авария со сроком обновления → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "row_title",
        "description": "Заголовок",
        "example": "Плановые работы",
      },
      {
        "name": "row_public_text",
        "description": "Опубликованный текст инцидента",
        "example": "Проверяем причину",
      },
      {
        "name": "row_service",
        "description": "Услуга",
        "example": "Вода",
      },
      {
        "name": "row_forecast",
        "description": "Прогноз",
        "example": "До 18:00",
      },
      {
        "name": "next_update",
        "description": "Следующее обновление",
        "example": "18.10.2026 13:00",
      },
    ],
    "ru":
      "🚨 Авария {row_number}: {row_title}\n{row_public_text}\nУслуга: {row_service}\nПрогноз: {row_forecast}\nСледующее обновление: {next_update}",
    "kk":
      "🚨 Апат {row_number}: {row_title}\n{row_public_text}\nҚызмет: {row_service}\nБолжам: {row_forecast}\nКелесі жаңарту: {next_update}",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
          "row_title": "Плановые работы",
          "row_public_text": "Проверяем причину",
          "row_service": "Вода",
          "row_forecast": "До 18:00",
          "next_update": "18.10.2026 13:00",
        },
        "kk": {
          "row_number": "З-26-00001",
          "row_title": "Плановые работы",
          "row_public_text": "Проверяем причину",
          "row_service": "Вода",
          "row_forecast": "До 18:00",
          "next_update": "18.10.2026 13:00",
        },
      },
    ],
  },
  {
    "key": "notices.incidents_service_broadcast_incident_101_next_restrictions",
    "section": "notices",
    "title": "Авария с ограничениями и сроком обновления → жителю",
    "description":
      "Авария с ограничениями и сроком обновления → жителю. Полный текст уведомления на языке получателя.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
      {
        "name": "row_title",
        "description": "Заголовок",
        "example": "Плановые работы",
      },
      {
        "name": "row_public_text",
        "description": "Опубликованный текст инцидента",
        "example": "Проверяем причину",
      },
      {
        "name": "row_service",
        "description": "Услуга",
        "example": "Вода",
      },
      {
        "name": "row_forecast",
        "description": "Прогноз",
        "example": "До 18:00",
      },
      {
        "name": "next_update",
        "description": "Следующее обновление",
        "example": "18.10.2026 13:00",
      },
      {
        "name": "restrictions",
        "description": "Ограничения",
        "example": "Не пользоваться лифтом",
      },
    ],
    "ru":
      "🚨 Авария {row_number}: {row_title}\n{row_public_text}\nУслуга: {row_service}\nПрогноз: {row_forecast}\nСледующее обновление: {next_update}\nОграничения: {restrictions}",
    "kk":
      "🚨 Апат {row_number}: {row_title}\n{row_public_text}\nҚызмет: {row_service}\nБолжам: {row_forecast}\nКелесі жаңарту: {next_update}\nШектеулер: {restrictions}",
    "scenario": "Уведомления · Аварии",
    "examples": [
      {
        "id": "default",
        "title": "Пример доставки",
        "ru": {
          "row_number": "З-26-00001",
          "row_title": "Плановые работы",
          "row_public_text": "Проверяем причину",
          "row_service": "Вода",
          "row_forecast": "До 18:00",
          "next_update": "18.10.2026 13:00",
          "restrictions": "Не пользоваться лифтом",
        },
        "kk": {
          "row_number": "З-26-00001",
          "row_title": "Плановые работы",
          "row_public_text": "Проверяем причину",
          "row_service": "Вода",
          "row_forecast": "До 18:00",
          "next_update": "18.10.2026 13:00",
          "restrictions": "Не пользоваться лифтом",
        },
      },
    ],
  },
  {
    "key": "notices.tasks_delivery_failed",
    "section": "notices",
    "scenario": "Уведомления · Задания и работы",
    "title": "Назначение не доставлено → заместителю и председателю",
    "description":
      "Не удалось доставить назначение исполнителю. Требуется резервный ответственный.",
    "variables": [
      {
        "name": "number",
        "description": "Номер задания",
        "example": "З-26-1",
      },
    ],
    "ru":
      "Назначение задания {number} не доставлено. Требуется резервный ответственный.",
    "kk": "{number}: тапсырма тағайындауы жеткізілмеді. Қосалқы жауапты қажет.",
    "buttons": [
      {
        "id": "task",
        "ru": "Открыть задание",
        "kk": "Тапсырманы ашу",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Неудачная доставка назначения",
        "ru": {
          "number": "З-26-1",
        },
        "kk": {
          "number": "З-26-1",
        },
        "buttons": [
          [
            {
              "id": "task",
            },
          ],
        ],
      },
    ],
  },
];
