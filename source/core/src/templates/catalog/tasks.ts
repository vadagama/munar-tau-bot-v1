import type { TemplateDef } from "./types.ts";
export const tasksTemplates: readonly TemplateDef[] = [
  {
    "key": "tasks.ukazhite_nomer_zadaniya",
    "section": "tasks",
    "title": "Укажите номер задания",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Укажите номер задания",
    "kk": "Тапсырма нөмірін көрсетіңіз",
  },
  {
    "key": "tasks.zadaniy_net",
    "section": "tasks",
    "title": "Заданий нет",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Заданий нет",
    "kk": "Тапсырма жоқ",
  },
  {
    "key": "tasks.vizit",
    "section": "tasks",
    "title": "Визит",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Визит",
    "kk": "Сапар",
  },
  {
    "key": "tasks.metodichka_versiya_deystvuet_s",
    "section": "tasks",
    "title":
      "Методичка: версия {value_1}, действует с {fmtday_t_methodology_as_row_created_at}",
    "description": "Реплика tasks",
    "variables": [
      {
        "name": "value_1",
        "description": "Версия методички",
        "example": "2",
      },
      {
        "name": "fmtday_t_methodology_as_row_created_at",
        "description": "Дата методички",
        "example": "18.10.2026",
      },
    ],
    "ru":
      "Методичка: версия {value_1}, действует с {fmtday_t_methodology_as_row_created_at}",
    "kk":
      "Әдістеме: нұсқа {value_1}, {fmtday_t_methodology_as_row_created_at} бастап қолданылады",
  },
  {
    "key": "tasks.srok",
    "section": "tasks",
    "title": "Срок",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Срок",
    "kk": "Мерзім",
  },
  {
    "key": "tasks.opishite_vypolnennyy_obem",
    "section": "tasks",
    "title": "Опишите выполненный объём.",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Опишите выполненный объём.",
    "kk": "Орындалған жұмыстың көлемін сипаттаңыз.",
  },
  {
    "key":
      "tasks.naydennaya_problema_peredana_administratoru_dlya_sozdaniya_ili",
    "section": "tasks",
    "title":
      "Найденная проблема передана администратору для создания или связывания задания.",
    "description": "Реплика tasks",
    "variables": [],
    "ru":
      "Найденная проблема передана администратору для создания или связывания задания.",
    "kk":
      "Табылған мәселе әкімшіге жаңа тапсырма жасау немесе байланыстыру үшін берілді.",
  },
  {
    "key":
      "tasks.kogda_predlozhite_vizit_napishite_odnim_soobscheniem_naprimer",
    "section": "tasks",
    "title":
      "Когда предложите визит? Напишите одним сообщением, например: завтра 10:00-12:00",
    "description": "Реплика tasks",
    "variables": [],
    "ru":
      "Когда предложите визит? Напишите одним сообщением, например: завтра 10:00-12:00",
    "kk":
      "Сапарды қашан ұсынасыз? Бір хабарламада жазыңыз, мысалы: ертең 10:00-12:00",
  },
  {
    "key": "tasks.teper_ukazhite_vremya_odnim_soobscheniem_naprimer_10",
    "section": "tasks",
    "title": "Теперь укажите время одним сообщением, например 10:00-12:00",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Теперь укажите время одним сообщением, например 10:00-12:00",
    "kk": "Енді уақытты бір хабарламада жазыңыз, мысалы 10:00-12:00",
  },
  {
    "key": "tasks.ne_ponyal_kogda_vizit_primery_zavtra_10",
    "section": "tasks",
    "title":
      "Не понял, когда визит. Примеры: завтра 10:00-12:00, сегодня 18:00, 20.10 09:00-11:00",
    "description": "Реплика tasks",
    "variables": [],
    "ru":
      "Не понял, когда визит. Примеры: завтра 10:00-12:00, сегодня 18:00, 20.10 09:00-11:00",
    "kk":
      "Сапар уақытын түсінбедім. Мысалдар: ертең 10:00-12:00, бүгін 18:00, 20.10 09:00-11:00",
  },
  {
    "key":
      "tasks.interval_predlozhen_vizit_sostoitsya_tolko_posle_soglasovaniya",
    "section": "tasks",
    "title":
      "Интервал предложен: {fmtinterval_interval_start_interval_end}. Визит состоится только после согласов",
    "description": "Реплика tasks",
    "variables": [
      {
        "name": "fmtinterval_interval_start_interval_end",
        "description": "Интервал визита",
        "example": "18.10 10:00–12:00",
      },
    ],
    "ru":
      "Интервал предложен: {fmtinterval_interval_start_interval_end}. Визит состоится только после согласования.",
    "kk":
      "Аралық ұсынылды: {fmtinterval_interval_start_interval_end}. Сапар тек келісілгеннен кейін өтеді.",
  },
  {
    "key": "tasks.snachala_otkroyte_task_nomer",
    "section": "tasks",
    "title": "Сначала откройте /task НОМЕР",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Сначала откройте /task НОМЕР",
    "kk": "Алдымен /task НОМІР ашыңыз",
  },
  {
    "key": "tasks.vizit_ne_nayden",
    "section": "tasks",
    "title": "Визит не найден",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Визит не найден",
    "kk": "Сапар табылмады",
  },
  {
    "key":
      "tasks.otsutstvie_dostupa_zafiksirovano_administrator_i_zhitel_uvedomleny",
    "section": "tasks",
    "title":
      "Отсутствие доступа зафиксировано. Администратор и житель уведомлены.",
    "description": "Реплика tasks",
    "variables": [],
    "ru":
      "Отсутствие доступа зафиксировано. Администратор и житель уведомлены.",
    "kk": "Қолжетімділік жоқ екені тіркелді. Әкімші мен тұрғын хабарланды.",
  },
  {
    "key": "tasks.ne_ponyal_vremya_napishite_odnim_soobscheniem_naprimer",
    "section": "tasks",
    "title": "Не понял время. Напишите одним сообщением, например 10:00-12:00",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Не понял время. Напишите одним сообщением, например 10:00-12:00",
    "kk": "Уақытты түсінбедім. Бір хабарламада жазыңыз, мысалы 10:00-12:00",
  },
  {
    "key": "tasks.snachala_otkroyte_zadanie",
    "section": "tasks",
    "title": "Сначала откройте задание",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Сначала откройте задание",
    "kk": "Алдымен тапсырманы ашыңыз",
  },
  {
    "key": "tasks.sohranen",
    "section": "tasks",
    "title": "сохранён",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "сохранён",
    "kk": "сақталды",
  },
  {
    "key": "tasks.esche_v_ocheredi",
    "section": "tasks",
    "title": "ещё в очереди",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "ещё в очереди",
    "kk": "кезекте",
  },
  {
    "key": "tasks.faylov_poka_net",
    "section": "tasks",
    "title": "Файлов пока нет",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Файлов пока нет",
    "kk": "Файл әзірше жоқ",
  },
  {
    "key": "tasks.zapolnite_otchet_reporttask_nomer",
    "section": "tasks",
    "title": "Заполните отчёт: /reporttask НОМЕР",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Заполните отчёт: /reporttask НОМЕР",
    "kk": "Есепті толтырыңыз: /reporttask НОМІР",
  },
  {
    "key": "tasks.vremya_vypolneniya_gggg_mm_dd_chch_mm",
    "section": "tasks",
    "title":
      "Время выполнения: ГГГГ-ММ-ДД ЧЧ:ММ (Алматы). Например 2026-10-17 15:30.",
    "description": "Реплика tasks",
    "variables": [],
    "ru":
      "Время выполнения: ГГГГ-ММ-ДД ЧЧ:ММ (Алматы). Например 2026-10-17 15:30.",
    "kk":
      "Орындалу уақыты: ЖЖЖЖ-АА-КК СС:ММ (Алматы). Мысалы 2026-10-17 15:30.",
  },
  {
    "key": "tasks.vvedite_vremya_v_formate_gggg_mm_dd",
    "section": "tasks",
    "title": "Введите время в формате ГГГГ-ММ-ДД ЧЧ:ММ",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Введите время в формате ГГГГ-ММ-ДД ЧЧ:ММ",
    "kk": "Уақытты ЖЖЖЖ-АА-КК СС:ММ форматында енгізіңіз",
  },
  {
    "key": "tasks.opishite_rezultat",
    "section": "tasks",
    "title": "Опишите результат.",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Опишите результат.",
    "kk": "Нәтижені сипаттаңыз.",
  },
  {
    "key": "tasks.ostavshiesya_ogranicheniya_napishite_net_esli_ih_net",
    "section": "tasks",
    "title": "Оставшиеся ограничения? Напишите «нет», если их нет.",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Оставшиеся ограничения? Напишите «нет», если их нет.",
    "kk": "Қалған шектеулер бар ма? Жоқ болса «жоқ» деп жазыңыз.",
  },
  {
    "key": "tasks.vyberite_nomera_sohranennyh_faylov_cherez_zapyatuyu_ili",
    "section": "tasks",
    "title":
      "Выберите номера сохранённых файлов через запятую или напишите «нет причина».\n",
    "description": "Реплика tasks",
    "variables": [],
    "ru":
      "Выберите номера сохранённых файлов через запятую или напишите «нет причина».\n",
    "kk":
      "Сақталған файлдардың нөмірлерін үтірмен таңдаңыз немесе «жоқ себеп» деп жазыңыз.\n",
  },
  {
    "key":
      "tasks.dokazatelstvo_iz_otpravte_fayl_dozhdites_sohraneniya_taskfiles",
    "section": "tasks",
    "title":
      "Доказательство {number_report_index_1} из {requirements_length}. Отправьте файл, дождитесь сохранени",
    "description": "Реплика tasks",
    "variables": [
      {
        "name": "number_report_index_1",
        "description": "Номер пункта отчёта",
        "example": "1",
      },
      {
        "name": "requirements_length",
        "description": "Всего пунктов отчёта",
        "example": "3",
      },
    ],
    "ru":
      "Доказательство {number_report_index_1} из {requirements_length}. Отправьте файл, дождитесь сохранения (/taskfiles), затем введите его номер. Если доказательства нет — нет причина.\n",
    "kk":
      "Дәлел {number_report_index_1} / {requirements_length}. Файл жіберіп, сақталуын күтіңіз (/taskfiles), содан кейін нөмірін жазыңыз. Дәлел жоқ болса — жоқ себеп.\n",
  },
  {
    "key": "tasks.otchet_podgotovlen_submitreport_otpravit_na_proverku",
    "section": "tasks",
    "title": "Отчёт подготовлен. /submitreport — отправить на проверку.",
    "description": "Реплика tasks",
    "variables": [],
    "ru": "Отчёт подготовлен. /submitreport — отправить на проверку.",
    "kk": "Есеп дайын. /submitreport — тексеруге жіберу.",
  },
];
