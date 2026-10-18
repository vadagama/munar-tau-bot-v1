import type { TemplateDef } from "./types.ts";
export const noticesTemplates: readonly TemplateDef[] = [
  {
    "key": "notices.registrations_service_submit_registration_1",
    "section": "notices",
    "title":
      "Новая анкета арендатора: {fullname}, {premisetext}. Рассмотрите её в кабинете или боте (/pending).",
    "description":
      "Уведомление: Новая анкета арендатора: {fullname}, {premisetext}. Рассмотрите её в кабинете или боте (/pending).",
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
  },
  {
    "key": "notices.registrations_service_submit_registration_2",
    "section": "notices",
    "title": "Новая анкета: {fullname}, {premisetext}",
    "description": "Уведомление: Новая анкета: {fullname}, {premisetext}",
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
  },
  {
    "key": "notices.registrations_service_review_registration_3",
    "section": "notices",
    "title": "Состояние регистрации: {state_ru}.{reason}",
    "description": "Уведомление: Состояние регистрации: {state_ru}.{reason}",
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
  },
  {
    "key": "notices.registrations_service_review_registration_3_clarify",
    "section": "notices",
    "title":
      "Состояние регистрации: {state_ru}.{reason} Исправьте анкету: отправьте боту /fix.",
    "description":
      "Уведомление: Состояние регистрации: {state_ru}.{reason} Исправьте анкету: отправьте боту /fix.",
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
  },
  {
    "key": "notices.registrations_service_accept_invite_4",
    "section": "notices",
    "title":
      "Принято приглашение собственника: {actor_person_fullname}, {detail_b} {premises_number}",
    "description":
      "Уведомление: Принято приглашение собственника: {actor_person_fullname}, {detail_b} {premises_number}",
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
  },
  {
    "key": "notices.registrations_service_accept_invite_5",
    "section": "notices",
    "title": "Приглашение принято",
    "description": "Уведомление: Приглашение принято",
    "variables": [],
    "ru": "Приглашение принято",
    "kk": "Шақыру қабылданды",
  },
  {
    "key": "notices.registrations_service_revoke_own_connection_6",
    "section": "notices",
    "title": "Связь прекращена: {reason}",
    "description": "Уведомление: Связь прекращена: {reason}",
    "variables": [
      {
        "name": "reason",
        "description": "Причина решения",
        "example": "Уточнить данные",
      },
    ],
    "ru": "Связь прекращена: {reason}",
    "kk": "Байланыс тоқтатылды: {reason}",
  },
  {
    "key": "notices.registrations_jobs_sweep_registrations_1",
    "section": "notices",
    "title": "Спор просрочен: {detail_a}. Рассмотрите в кабинете.",
    "description":
      "Уведомление: Спор просрочен: {detail_a}. Рассмотрите в кабинете.",
    "variables": [
      {
        "name": "detail_a",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru": "Спор просрочен: {detail_a}. Рассмотрите в кабинете.",
    "kk": "Дау мерзімі өтті: {detail_a}. Кабинетте қарастырыңыз.",
  },
  {
    "key": "notices.registrations_jobs_sweep_registrations_2",
    "section": "notices",
    "title": "Требуется решение по анкете: {detail_a}. Рассмотрите в кабинете.",
    "description":
      "Уведомление: Требуется решение по анкете: {detail_a}. Рассмотрите в кабинете.",
    "variables": [
      {
        "name": "detail_a",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru": "Требуется решение по анкете: {detail_a}. Рассмотрите в кабинете.",
    "kk": "Өтінім бойынша шешім қажет: {detail_a}. Кабинетте қарастырыңыз.",
  },
  {
    "key": "notices.registrations_jobs_sweep_registrations_3",
    "section": "notices",
    "title": "Анкета передана следующему ответственному",
    "description": "Уведомление: Анкета передана следующему ответственному",
    "variables": [],
    "ru": "Анкета передана следующему ответственному",
    "kk": "Өтінім келесі жауапты қызметкерге берілді",
  },
  {
    "key": "notices.requests_service_create_request_1",
    "section": "notices",
    "title":
      "{next_number}: обращение зарегистрировано. Первый ответ до {detail_b}.",
    "description":
      "Уведомление: {next_number}: обращение зарегистрировано. Первый ответ до {detail_b}.",
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
  },
  {
    "key": "notices.requests_service_transition_request_2",
    "section": "notices",
    "title": "{next_number}: зарегистрировано. Первый ответ до {detail_b}.",
    "description":
      "Уведомление: {next_number}: зарегистрировано. Первый ответ до {detail_b}.",
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
  },
  {
    "key": "notices.requests_service_transition_request_3",
    "section": "notices",
    "title": "{row_number}: {st_ru}. Подробности в карточке обращения.",
    "description":
      "Уведомление: {row_number}: {st_ru}. Подробности в карточке обращения.",
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
  },
  {
    "key": "notices.requests_messages_add_message_1",
    "section": "notices",
    "title": "{row_number}: новое сообщение. Откройте карточку обращения.",
    "description":
      "Уведомление: {row_number}: новое сообщение. Откройте карточку обращения.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{row_number}: новое сообщение. Откройте карточку обращения.",
    "kk": "{row_number}: жаңа хабарлама. Өтініш карточкасын ашыңыз.",
  },
  {
    "key": "notices.tasks_service_task_log_1",
    "section": "notices",
    "title": "Ваше назначение на задание {row_number} снято.",
    "description":
      "Уведомление: Ваше назначение на задание {row_number} снято.",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "Ваше назначение на задание {row_number} снято.",
    "kk": "{row_number} тапсырмасына тағайындауыңыз алынып тасталды.",
  },
  {
    "key": "notices.tasks_service_task_log_2",
    "section": "notices",
    "title": "Задание {row_number}: {state_ru}. Откройте карточку задания.",
    "description":
      "Уведомление: Задание {row_number}: {state_ru}. Откройте карточку задания.",
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
  },
  {
    "key": "notices.tasks_service_task_log_2_pause",
    "section": "notices",
    "title":
      "Задание {row_number}: исполнитель запросил остановку: {reason}. Откройте карточку задания.",
    "description":
      "Уведомление: Задание {row_number}: исполнитель запросил остановку: {reason}. Откройте карточку задания.",
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
  },
  {
    "key": "notices.tasks_service_task_log_2_problem",
    "section": "notices",
    "title":
      "Задание {row_number}: исполнитель сообщил о найденной проблеме. Откройте карточку задания.",
    "description":
      "Уведомление: Задание {row_number}: исполнитель сообщил о найденной проблеме. Откройте карточку задания.",
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
  },
  {
    "key": "notices.tasks_common_work_log_1",
    "section": "notices",
    "title":
      "Обращение {request_number}: общая работа {row_number} {detail_c}. Проверка вашего обращения остаётся отдельной",
    "description":
      "Уведомление: Обращение {request_number}: общая работа {row_number} {detail_c}. Проверка вашего обращения остаётся отдельной",
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
  },
  {
    "key": "notices.tasks_common_work_log_1_unfinished",
    "section": "notices",
    "title":
      "Обращение {request_number}: общая работа {row_number} {detail_c}. Остаются локальные задания; результат обраще",
    "description":
      "Уведомление: Обращение {request_number}: общая работа {row_number} {detail_c}. Остаются локальные задания; результат обраще",
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
  },
  {
    "key": "notices.tasks_common_work_log_1_ready",
    "section": "notices",
    "title":
      "Обращение {request_number}: общая работа {row_number} {detail_c}. Администратор подготовит результат для вашег",
    "description":
      "Уведомление: Обращение {request_number}: общая работа {row_number} {detail_c}. Администратор подготовит результат для вашег",
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
  },
  {
    "key": "notices.tasks_common_link_2",
    "section": "notices",
    "title":
      "Обращение {request_number} включено в общую работу {work_number}. Срок: {detail_d}. Результат по вашему обраще",
    "description":
      "Уведомление: Обращение {request_number} включено в общую работу {work_number}. Срок: {detail_d}. Результат по вашему обраще",
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
  },
  {
    "key": "notices.tasks_common_link_2_plan",
    "section": "notices",
    "title":
      "Обращение {request_number} включено в общую работу {work_number}. План: {plan}. Срок: {detail_d}. Результат по",
    "description":
      "Уведомление: Обращение {request_number} включено в общую работу {work_number}. План: {plan}. Срок: {detail_d}. Результат по",
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
  },
  {
    "key": "notices.tasks_common_unlink_common_request_3",
    "section": "notices",
    "title": "Обращение {request_number}: дальнейший план — {plan}.",
    "description":
      "Уведомление: Обращение {request_number}: дальнейший план — {plan}.",
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
  },
  {
    "key": "notices.tasks_visits_propose_visit_1",
    "section": "notices",
    "title":
      "Предложен визит: {detail_a}. Подтвердите интервал в карточке обращения.",
    "description":
      "Уведомление: Предложен визит: {detail_a}. Подтвердите интервал в карточке обращения.",
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
  },
  {
    "key": "notices.tasks_visits_update_visit_2",
    "section": "notices",
    "title":
      "Исполнитель сообщил об отсутствии доступа. Согласуйте новый визит.",
    "description":
      "Уведомление: Исполнитель сообщил об отсутствии доступа. Согласуйте новый визит.",
    "variables": [],
    "ru": "Исполнитель сообщил об отсутствии доступа. Согласуйте новый визит.",
    "kk":
      "Орындаушы қолжетімділік жоқ екенін хабарлады. Жаңа сапарды келістіріңіз.",
  },
  {
    "key": "notices.registry_service_mutate_registry_1",
    "section": "notices",
    "title": "Связь прекращена при смене собственника",
    "description": "Уведомление: Связь прекращена при смене собственника",
    "variables": [],
    "ru": "Связь прекращена при смене собственника",
    "kk": "Меншік иесі ауысқанда байланыс тоқтатылды",
  },
  {
    "key": "notices.registry_service_mutate_registry_2",
    "section": "notices",
    "title": "Связь прекращена: {after_revoked_reason}",
    "description": "Уведомление: Связь прекращена: {after_revoked_reason}",
    "variables": [
      {
        "name": "after_revoked_reason",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru": "Связь прекращена: {after_revoked_reason}",
    "kk": "Байланыс тоқтатылды: {after_revoked_reason}",
  },
  {
    "key": "notices.privacy_service_submit_privacy_request_1",
    "section": "notices",
    "title":
      "Запрос ({detail_a}): {actor_person_fullname}. Рассмотрите его в кабинете ОСИ.",
    "description":
      "Уведомление: Запрос ({detail_a}): {actor_person_fullname}. Рассмотрите его в кабинете ОСИ.",
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
  },
  {
    "key": "notices.publications_service_broadcast_publication_1",
    "section": "notices",
    "title": "{row_title} {row_body}",
    "description": "Уведомление: {row_title} {row_body}",
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
  },
  {
    "key": "notices.publications_service_broadcast_publication_1_pending",
    "section": "notices",
    "title":
      "{row_title} {row_body} План: {interval}. Восстановление: пока не подтверждено",
    "description":
      "Уведомление: {row_title} {row_body} План: {interval}. Восстановление: пока не подтверждено",
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
  },
  {
    "key": "notices.publications_service_broadcast_publication_1_restored",
    "section": "notices",
    "title":
      "{row_title} {row_body} План: {interval}. Восстановление: {restored_at}",
    "description":
      "Уведомление: {row_title} {row_body} План: {interval}. Восстановление: {restored_at}",
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
  },
  {
    "key": "notices.locales_notifications_author_reminder_1",
    "section": "notices",
    "title": "{number}: подтвердите результат или верните на доработку.",
    "description":
      "Уведомление: {number}: подтвердите результат или верните на доработку.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{number}: подтвердите результат или верните на доработку.",
    "kk": "{number}: нәтижені растаңыз немесе түзетуге қайтарыңыз.",
  },
  {
    "key": "notices.locales_notifications_admin_check_2",
    "section": "notices",
    "title": "{number}: автор не ответил, требуется проверка администратора.",
    "description":
      "Уведомление: {number}: автор не ответил, требуется проверка администратора.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{number}: автор не ответил, требуется проверка администратора.",
    "kk": "{number}: автор жауап бермеді, әкімшінің тексеруі қажет.",
  },
  {
    "key": "notices.locales_notifications_delivery_failed_3",
    "section": "notices",
    "title":
      "{number}: важное уведомление не доставлено. Свяжитесь с жителем по телефону.",
    "description":
      "Уведомление: {number}: важное уведомление не доставлено. Свяжитесь с жителем по телефону.",
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
  },
  {
    "key": "notices.locales_notifications_first_response_overdue_4",
    "section": "notices",
    "title": "{number}: истёк срок первого ответа.",
    "description": "Уведомление: {number}: истёк срок первого ответа.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{number}: истёк срок первого ответа.",
    "kk": "{number}: алғашқы жауап мерзімі өтті.",
  },
  {
    "key": "notices.locales_notifications_next_action_reminder_5",
    "section": "notices",
    "title": "{number}: наступила дата следующего действия.",
    "description": "Уведомление: {number}: наступила дата следующего действия.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{number}: наступила дата следующего действия.",
    "kk": "{number}: келесі әрекет күні келді.",
  },
  {
    "key": "notices.requests_service_create_request_101",
    "section": "notices",
    "title": "{next_number}: новое обращение",
    "description": "Уведомление: {next_number}: новое обращение",
    "variables": [
      {
        "name": "next_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{next_number}: новое обращение",
    "kk": "{next_number}: жаңа өтініш",
  },
  {
    "key": "notices.requests_service_transition_request_102",
    "section": "notices",
    "title": "{next_number}: новое обращение",
    "description": "Уведомление: {next_number}: новое обращение",
    "variables": [
      {
        "name": "next_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{next_number}: новое обращение",
    "kk": "{next_number}: жаңа өтініш",
  },
  {
    "key": "notices.requests_service_transition_request_103",
    "section": "notices",
    "title": "{row_number}: {st_ru}",
    "description": "Уведомление: {row_number}: {st_ru}",
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
  },
  {
    "key": "notices.requests_messages_add_message_101",
    "section": "notices",
    "title": "{row_number}: новое сообщение",
    "description": "Уведомление: {row_number}: новое сообщение",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{row_number}: новое сообщение",
    "kk": "{row_number}: жаңа хабарлама",
  },
  {
    "key": "notices.requests_messages_rate_request_102",
    "section": "notices",
    "title": "{row_number}: низкая оценка",
    "description": "Уведомление: {row_number}: низкая оценка",
    "variables": [
      {
        "name": "row_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "{row_number}: низкая оценка",
    "kk": "{row_number}: төмен баға",
  },
  {
    "key": "notices.tasks_timing_sweep_task_timers_101",
    "section": "notices",
    "title":
      "Задание {detail_a} не принято исполнителем. Требуется проверить назначение.",
    "description":
      "Уведомление: Задание {detail_a} не принято исполнителем. Требуется проверить назначение.",
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
  },
  {
    "key": "notices.tasks_timing_sweep_task_timers_102",
    "section": "notices",
    "title": "Задание {task_number}: срок выполнения истёк.",
    "description": "Уведомление: Задание {task_number}: срок выполнения истёк.",
    "variables": [
      {
        "name": "task_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "Задание {task_number}: срок выполнения истёк.",
    "kk": "{task_number}: орындау мерзімі өтті.",
  },
  {
    "key": "notices.tasks_timing_sweep_task_timers_103",
    "section": "notices",
    "title": "Задание {task_number}: наступила дата следующего действия.",
    "description":
      "Уведомление: Задание {task_number}: наступила дата следующего действия.",
    "variables": [
      {
        "name": "task_number",
        "description": "Номер обращения или работы",
        "example": "З-26-00001",
      },
    ],
    "ru": "Задание {task_number}: наступила дата следующего действия.",
    "kk": "{task_number}: келесі әрекет күні келді.",
  },
  {
    "key": "notices.tasks_schedule_process_scheduled_jobs_101",
    "section": "notices",
    "title": "Создано регулярное задание {detail_a}.",
    "description": "Уведомление: Создано регулярное задание {detail_a}.",
    "variables": [
      {
        "name": "detail_a",
        "description": "Данные события",
        "example": "Пример",
      },
    ],
    "ru": "Создано регулярное задание {detail_a}.",
    "kk": "{detail_a}: жоспарлы тапсырма жасалды.",
  },
  {
    "key": "notices.bot_request-files_process_request_uploads_101",
    "section": "notices",
    "title": "Файл сохранён",
    "description": "Уведомление: Файл сохранён",
    "variables": [],
    "ru": "Файл сохранён",
    "kk": "Файл сақталды",
  },
  {
    "key": "notices.bot_request-files_process_request_uploads_102",
    "section": "notices",
    "title":
      "Файл не сохранён: повторите загрузку или выберите другой файл. Текст обращения сохранён.",
    "description":
      "Уведомление: Файл не сохранён: повторите загрузку или выберите другой файл. Текст обращения сохранён.",
    "variables": [],
    "ru":
      "Файл не сохранён: повторите загрузку или выберите другой файл. Текст обращения сохранён.",
    "kk":
      "Файл сақталмады: қайта жүктеңіз немесе басқа файлды таңдаңыз. Өтініш мәтіні сақталды.",
  },
  {
    "key": "notices.incidents_duty_notify_signal_101",
    "section": "notices",
    "title":
      "Возможная авария {s_id}. Требуется явное принятие текущим ответственным.",
    "description":
      "Уведомление: Возможная авария {s_id}. Требуется явное принятие текущим ответственным.",
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
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_101_invalid",
    "section": "notices",
    "title":
      "Возможная авария {s_id}: нет принятия. Ответственность передана администратору; назначение недействительно, тр",
    "description":
      "Уведомление: Возможная авария {s_id}: нет принятия. Ответственность передана администратору; назначение недействительно, тр",
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
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_101",
    "section": "notices",
    "title":
      "Возможная авария {s_id}: нет принятия. Ответственность передана администратору.",
    "description":
      "Уведомление: Возможная авария {s_id}: нет принятия. Ответственность передана администратору.",
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
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_101_reserve_invalid",
    "section": "notices",
    "title":
      "Возможная авария {s_id}: нет принятия. Ответственность передана резервному дежурному; назначение недействитель",
    "description":
      "Уведомление: Возможная авария {s_id}: нет принятия. Ответственность передана резервному дежурному; назначение недействитель",
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
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_101_reserve",
    "section": "notices",
    "title":
      "Возможная авария {s_id}: нет принятия. Ответственность передана резервному дежурному.",
    "description":
      "Уведомление: Возможная авария {s_id}: нет принятия. Ответственность передана резервному дежурному.",
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
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_102",
    "section": "notices",
    "title":
      "Авария {row_id}: пропущено обещанное обновление. Опубликуйте актуальные сведения.",
    "description":
      "Уведомление: Авария {row_id}: пропущено обещанное обновление. Опубликуйте актуальные сведения.",
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
  },
  {
    "key": "notices.incidents_jobs_sweep_emergencies_103",
    "section": "notices",
    "title":
      "Авария {row_id}: ответственный не обновил сведения. Требуется вмешательство.",
    "description":
      "Уведомление: Авария {row_id}: ответственный не обновил сведения. Требуется вмешательство.",
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
  },
  {
    "key": "notices.incidents_failures_emergency_delivery_failure_101",
    "section": "notices",
    "title":
      "Важное аварийное уведомление не доставлено. Проверьте журнал доставки и свяжитесь с ответственным или жителем.",
    "description":
      "Уведомление: Важное аварийное уведомление не доставлено. Проверьте журнал доставки и свяжитесь с ответственным или жителем.",
    "variables": [],
    "ru":
      "Важное аварийное уведомление не доставлено. Проверьте журнал доставки и свяжитесь с ответственным или жителем.",
    "kk":
      "Маңызды апат хабарламасы жеткізілмеді. Жеткізу журналын тексеріп, жауапты тұлғамен немесе тұрғынмен байланысыңыз.",
  },
  {
    "key": "notices.incidents_service_broadcast_incident_101",
    "section": "notices",
    "title":
      "🚨 Авария {row_number}: {row_title} {row_public_text} Услуга: {row_service} Прогноз: {row_forecast}",
    "description":
      "Уведомление: 🚨 Авария {row_number}: {row_title} {row_public_text} Услуга: {row_service} Прогноз: {row_forecast}",
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
  },
  {
    "key": "notices.incidents_service_broadcast_incident_101_restrictions",
    "section": "notices",
    "title":
      "🚨 Авария {row_number}: {row_title} {row_public_text} Услуга: {row_service} Прогноз: {row_forecast} Ограничения",
    "description":
      "Уведомление: 🚨 Авария {row_number}: {row_title} {row_public_text} Услуга: {row_service} Прогноз: {row_forecast} Ограничения",
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
  },
  {
    "key": "notices.incidents_service_broadcast_incident_101_next",
    "section": "notices",
    "title":
      "🚨 Авария {row_number}: {row_title} {row_public_text} Услуга: {row_service} Прогноз: {row_forecast} Следующее о",
    "description":
      "Уведомление: 🚨 Авария {row_number}: {row_title} {row_public_text} Услуга: {row_service} Прогноз: {row_forecast} Следующее о",
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
  },
  {
    "key": "notices.incidents_service_broadcast_incident_101_next_restrictions",
    "section": "notices",
    "title":
      "🚨 Авария {row_number}: {row_title} {row_public_text} Услуга: {row_service} Прогноз: {row_forecast} Следующее о",
    "description":
      "Уведомление: 🚨 Авария {row_number}: {row_title} {row_public_text} Услуга: {row_service} Прогноз: {row_forecast} Следующее о",
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
  },
];
