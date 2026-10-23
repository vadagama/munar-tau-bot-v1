import type { TemplateDef } from "./types.ts";
export const requestsMessageTemplates: readonly TemplateDef[] = [
  {
    "key": "message.requests.kind",
    "section": "requests",
    "title": "Выбор вида обращения",
    "description": "Полное сообщение бота: Выбор вида обращения",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru":
      "Выберите вид обращения.",
    "kk":
      "Өтініш түрін таңдаңыз.",
    "variables": [
      {
        "name": "kinds",
        "description": "Нумерованный список видов обращения",
        "example": "1. Заявка на работу\n2. Вопрос\n3. Жалоба",
      },
    ],
    "buttons": [
      {
        "id": "request",
        "ru": "Заявка на работу",
        "kk": "Жұмысқа өтінім",
      },
      {
        "id": "question",
        "ru": "Вопрос",
        "kk": "Сұрақ",
      },
      {
        "id": "complaint",
        "ru": "Жалоба",
        "kk": "Шағым",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "kinds": "1. Заявка на работу\n2. Вопрос\n3. Жалоба",
        },
        "kk": {
          "kinds": "1. Жұмысқа өтінім\n2. Сұрақ\n3. Шағым",
        },
        "buttons": [
          [
            {
              "id": "request",
            },
          ],
          [
            {
              "id": "question",
            },
          ],
          [
            {
              "id": "complaint",
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "message.requests.target",
    "section": "requests",
    "title": "Выбор адресата",
    "description": "Полное сообщение бота: Выбор адресата",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru": "Где возникла проблема?",
    "kk": "Мәселе қай жерде?",
    "variables": [],
    "buttons": [
      {
        "id": "my_places",
        "ru": "Мои помещения",
        "kk": "Үй-жайларым",
      },
      {
        "id": "common",
        "ru": "Общее имущество",
        "kk": "Ортақ мүлік",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {},
        "kk": {},
        "buttons": [
          [
            {
              "id": "my_places",
            },
          ],
          [
            {
              "id": "common",
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "message.requests.common",
    "section": "requests",
    "title": "Общее имущество — подменю",
    "description": "Полное сообщение бота: Общее имущество — подменю",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru": "Общее имущество. Где именно?",
    "kk": "Ортақ мүлік. Дәл қайда?",
    "variables": [],
    "buttons": [
      {
        "id": "house",
        "ru": "В доме",
        "kk": "Үйде",
      },
      {
        "id": "territory",
        "ru": "На территории",
        "kk": "Аумақта",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {},
        "kk": {},
        "buttons": [
          [
            {
              "id": "house",
            },
          ],
          [
            {
              "id": "territory",
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "message.requests.building",
    "section": "requests",
    "title": "Номер дома текстом",
    "description":
      "Полное сообщение бота: ввод номера дома текстом с автопроверкой (REG-11)",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru": "Напишите номер вашего дома (например, 107/1).",
    "kk": "Үйіңіздің нөмірін жазыңыз (мысалы, 107/1).",
    "variables": [],
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "message.requests.common_place",
    "section": "requests",
    "title": "Место в доме",
    "description": "Полное сообщение бота: Место в доме",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru": "{name}. Опишите место: например, подъезд 2, первый этаж.",
    "kk": "{name}. Орынды сипаттаңыз: мысалы, 2-кіреберіс, бірінші қабат.",
    "variables": [
      {
        "name": "name",
        "description": "Название или код дома",
        "example": "Дом 1",
      },
    ],
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "name": "Дом 1",
        },
        "kk": {
          "name": "Дом 1",
        },
      },
    ],
  },
  {
    "key": "message.requests.common_territory",
    "section": "requests",
    "title": "Место на территории",
    "description": "Полное сообщение бота: Место на территории",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru":
      "Опишите место на территории ЖК, например: детская площадка у дома 1.",
    "kk":
      "Аумақтағы орынды сипаттаңыз, мысалы: 1-үйдегі балалар алаңы.",
    "variables": [],
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "message.requests.address",
    "section": "requests",
    "title": "Адрес одной строкой",
    "description":
      "Полное сообщение бота: адрес обращения одной строкой для жителя без привязанных помещений (REG-01)",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru":
      "Напишите адрес одной строкой (например: дом 107/2, кв 11).\nP.S. Позже, когда вы привяжете к профилю свои помещения, нужно будет только выбрать их из списка.",
    "kk":
      "Адресті бір жолмен жазыңыз (мысалы: 107/2-үй, 11-пәтер).\nP.S. Кейін профиліңізге өз үй-жайларыңызды байланыстырсаңыз, оларды тізімнен ғана таңдау қалады.",
    "variables": [],
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "message.requests.choose_place",
    "section": "requests",
    "title": "Выбор помещения",
    "description": "Полное сообщение бота: Выбор помещения",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "legacyKeys": [
      "requests.vyberite_nomer_svoego_pomescheniya",
      "requests.obschee_imuschestvo_dom_kod_opisanie_mesta_territoriya",
      "requests.chernovik_sohranyaetsya_do_otpravki",
      "requests.nazad",
    ],
    "ru": "Выберите номер своего помещения:\n{premises}",
    "kk": "Үй-жайыңыздың нөмірін таңдаңыз:\n{premises}",
    "variables": [
      {
        "name": "premises",
        "description": "Список доступных помещений",
        "example":
          "1. Дом 1, Квартира 4\n2. Дом 1, Парковочное место 25",
      },
    ],
    "buttons": [
      {
        "id": "place",
        "ru": "{building} {number}",
        "kk": "{building} {number}",
        "variables": [
          {
            "name": "building",
            "description": "Здание",
            "example": "Дом 1",
          },
          {
            "name": "number",
            "description": "Номер помещения",
            "example": "4",
          },
        ],
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Несколько помещений",
        "ru": {
          "premises":
            "1. Дом 1, Квартира 4\n2. Дом 1, Парковочное место 25",
        },
        "kk": {
          "premises": "1. Дом 1, Пәтер 4\n2. Дом 1, Тұрақ орны 25",
        },
        "buttons": [
          [
            {
              "id": "place",
              "vars": {
                "building": "Дом 1",
                "number": "4",
              },
            },
          ],
          [
            {
              "id": "place",
              "vars": {
                "building": "Дом 1",
                "number": "25",
              },
            },
          ],
        ],
      },
      {
        "id": "one",
        "title": "Одно помещение",
        "ru": {
          "premises": "1. Дом 1, Квартира 4",
        },
        "kk": {
          "premises": "1. Дом 1, Пәтер 4",
        },
        "buttons": [
          [
            {
              "id": "place",
              "vars": {
                "building": "Дом 1",
                "number": "4",
              },
            },
          ],
        ],
      },
      {
        "id": "empty",
        "title": "Нет помещений",
        "ru": {
          "premises": "",
        },
        "kk": {
          "premises": "",
        },
        "buttons": [],
      },
    ],
  },
  {
    "key": "message.requests.saved_draft",
    "section": "requests",
    "title": "Найден сохранённый черновик",
    "description": "Полное сообщение бота: Найден сохранённый черновик",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "legacyKeys": [
      "requests.sohranennyy_chernovik",
      "requests.otpravit",
      "requests.izmenit_tekst",
      "requests.udalit",
      "requests.fayly_prosto_prikrepite_k_sleduyuschemu_soobscheniyu",
    ],
    "ru":
      "<b>Сохранённый черновик</b>:\n{description}\nФайлы можно прикрепить следующим сообщением.",
    "kk":
      "<b>Сақталған жоба</b>:\n{description}\nФайлдарды келесі хабарламамен тіркеуге болады.",
    "variables": [
      {
        "name": "description",
        "description": "Описание обращения",
        "example": "Не работает освещение",
      },
    ],
    "buttons": [
      {
        "id": "send",
        "ru": "Отправить",
        "kk": "Жіберу",
      },
      {
        "id": "delete",
        "ru": "Удалить",
        "kk": "Жою",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "description": "Не работает освещение",
        },
        "kk": {
          "description": "Не работает освещение",
        },
        "buttons": [
          [
            {
              "id": "send",
            },
            {
              "id": "delete",
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "message.requests.verify",
    "section": "requests",
    "title": "Проверка перед отправкой",
    "description": "Полное сообщение бота: Проверка перед отправкой",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "legacyKeys": [
      "requests.proverte",
      "requests.polnyy_tekst_sohranen",
      "requests.dobavte_fayly_neobyazatelno_zatem_sendrequest_pri_sboe",
      "requests.sohranit_chernovik",
    ],
    "ru":
      "Проверьте:\n- Вид: {kind}\n- Место: {place}\n- Сообщение: {description}",
    "kk":
      "Тексеріңіз:\n- Түрі: {kind}\n- Орны: {place}\n- Хабарлама: {description}",
    "variables": [
      {
        "name": "description",
        "description": "Описание обращения",
        "example": "Не работает освещение",
      },
      {
        "name": "kind",
        "description": "Вид обращения",
        "example": "Заявка на работу",
      },
      {
        "name": "place",
        "description": "Место обращения",
        "example": "Дом 1, подъезд 2",
      },
    ],
    "buttons": [
      {
        "id": "send",
        "ru": "Отправить",
        "kk": "Жіберу",
      },
      {
        "id": "cancel",
        "ru": "Отменить",
        "kk": "Болдырмау",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "description": "Не работает освещение",
        },
        "kk": {
          "description": "Не работает освещение",
        },
        "buttons": [
          [
            {
              "id": "send",
            },
            {
              "id": "cancel",
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "message.requests.verify_files",
    "section": "requests",
    "title": "Проверка перед отправкой — с файлами",
    "description":
      "Полное сообщение бота: проверка перед отправкой со счётчиком файлов (REQ-03)",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru":
      "Проверьте:\n- Вид: {kind}\n- Место: {place}\n- Сообщение: {description}\n- Файлы: {files}",
    "kk":
      "Тексеріңіз:\n- Түрі: {kind}\n- Орны: {place}\n- Хабарлама: {description}\n- Файлдар: {files}",
    "variables": [
      {
        "name": "description",
        "description": "Описание обращения",
        "example": "Не работает освещение",
      },
      {
        "name": "files",
        "description": "Число прикреплённых файлов",
        "example": "3 файла",
      },
      {
        "name": "kind",
        "description": "Вид обращения",
        "example": "Заявка на работу",
      },
      {
        "name": "place",
        "description": "Место обращения",
        "example": "Дом 1, подъезд 2",
      },
    ],
    "buttons": [
      {
        "id": "send",
        "ru": "Отправить",
        "kk": "Жіберу",
      },
      {
        "id": "cancel",
        "ru": "Отменить",
        "kk": "Болдырмау",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "description": "Не работает освещение",
          "files": "3 файла",
        },
        "kk": {
          "description": "Не работает освещение",
          "files": "3 файл",
        },
        "buttons": [
          [
            {
              "id": "send",
            },
            {
              "id": "cancel",
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "message.requests.attachments_prompt",
    "section": "requests",
    "title": "Файлы — приглашение",
    "description":
      "Полное сообщение бота: предложение прикрепить файлы с кнопкой сохранения запроса (REQ-03)",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru":
      "Прикрепите файл или фото для подтверждения проблемы или нажмите «Сохранить запрос».\nPS/ Можно добавлять до 10 файлов, размер каждого файла не должен превышать 20 МБ.",
    "kk":
      "Мәселені растайтын файл немесе фото жіберіңіз немесе «Өтінішті сақтау» түймесін басыңыз.\nPS/ 10-ға дейін файл қосуға болады, әр файлдың өлшемі 20 МБ-тан аспауы керек.",
    "variables": [],
    "buttons": [
      { "id": "save", "ru": "Сохранить запрос", "kk": "Өтінішті сақтау" },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {},
        "kk": {},
        "buttons": [[{ "id": "save" }]],
      },
    ],
  },
  {
    "key": "message.requests.attachments_more",
    "section": "requests",
    "title": "Файлы — файл принят",
    "description":
      "Полное сообщение бота: файл принят, можно прикрепить ещё или сохранить запрос (REQ-03)",
    "scenario": "Новое обращение",
    "command": "/newrequest",
    "ru":
      "Файл принят в очередь на сохранение. Можно прикрепить ещё файл или нажать «Сохранить запрос».",
    "kk":
      "Файл сақтау кезегіне қабылданды. Тағы бір файл жіберуге болады немесе «Өтінішті сақтау» түймесін басыңыз.",
    "variables": [],
    "buttons": [
      { "id": "save", "ru": "Сохранить запрос", "kk": "Өтінішті сақтау" },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {},
        "kk": {},
        "buttons": [[{ "id": "save" }]],
      },
    ],
  },
  {
    "key": "message.requests.sent",
    "section": "requests",
    "title": "Обращение отправлено",
    "description": "Полное сообщение бота: Обращение отправлено",
    "scenario": "Новое обращение",
    "command": "/sendrequest",
    "legacyKeys": [
      "requests.zaregistrirovano",
      "requests.pervyy_otvet",
      "requests.ekstrennye_sluzhby_bot_ne_zamenyaet_pri_neposredstvennoy",
      "help.actions_prefix",
      "help.visits_nomer_vizity_say_nomer_tekst_soobschenie",
    ],
    "ru":
      "Обращение <b>{number}</b> успешно зарегистрировано {registered}.\nВ ближайшее время ваше обращение будет рассмотрено администратором.\nPS/ Экстренные службы бот не заменяет: при непосредственной угрозе жизни звоните 112.",
    "kk":
      "Өтініш <b>{number}</b> сәтті тіркелді {registered}.\nЖақын арада өтінішіңіз әкімші тарапынан қаралады.\nPS/ Төтенше қызметтерді бот алмастырмайды: өмірге тікелей қауіп төнгенде 112 нөміріне қоңырау шалыңыз.",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения",
        "example": "З-26-00001",
      },
      {
        "name": "registered",
        "description": "Дата и время регистрации",
        "example": "20.10.2026 08:44",
      },
    ],
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "number": "З-26-00001",
          "registered": "20.10.2026 08:44",
        },
        "kk": {
          "number": "З-26-00001",
          "registered": "20.10.2026 08:44",
        },
      },
    ],
  },
  {
    "key": "message.requests.places",
    "section": "requests",
    "title": "Мои помещения",
    "description": "Полное сообщение бота: Мои помещения",
    "scenario": "Мои помещения",
    "command": "/objects",
    "legacyKeys": [
      "requests.nazhmite_nomer_pomescheniya_ili",
    ],
    "ru": "{premises}",
    "kk": "{premises}",
    "variables": [
      {
        "name": "premises",
        "description": "Доступные помещения",
        "example": "1. Дом 1, Квартира 4",
      },
    ],
    "buttons": [
      {
        "id": "place",
        "ru": "{number}",
        "kk": "{number}",
        "variables": [
          {
            "name": "number",
            "description": "Номер помещения",
            "example": "4",
          },
        ],
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "premises": "1. Дом 1, Квартира 4",
        },
        "kk": {
          "premises": "1. Дом 1, Квартира 4",
        },
        "buttons": [
          [
            {
              "id": "place",
              "vars": {
                "number": "4",
              },
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "message.requests.result",
    "section": "requests",
    "title": "Результат работ",
    "description": "Полное сообщение бота: Результат работ",
    "scenario": "Результат обращения",
    "command": "/result",
    "legacyKeys": [
      "requests.otchet",
      "requests.iz",
      "requests.zadanie",
      "requests.ogranicheniya",
    ],
    "ru":
      "<b>{number}</b> · Отчёт {index} из {total} · задание {task_number}\n{work}\n{result}\nОграничения: {limitations}",
    "kk":
      "<b>{number}</b> · Есеп {index} із ішінен {total} · тапсырма {task_number}\n{work}\n{result}\nШектеулер: {limitations}",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения",
        "example": "З-26-00001",
      },
      {
        "name": "index",
        "description": "Номер отчёта",
        "example": "1",
      },
      {
        "name": "total",
        "description": "Количество отчётов",
        "example": "2",
      },
      {
        "name": "task_number",
        "description": "Номер задания",
        "example": "З-26-1",
      },
      {
        "name": "work",
        "description": "Выполненные работы",
        "example": "Заменили лампу",
      },
      {
        "name": "result",
        "description": "Результат",
        "example": "Освещение восстановлено",
      },
      {
        "name": "limitations",
        "description": "Ограничения",
        "example": "нет",
      },
    ],
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "number": "З-26-00001",
          "index": "1",
          "total": "2",
          "task_number": "З-26-1",
          "work": "Заменили лампу",
          "result": "Освещение восстановлено",
          "limitations": "нет",
        },
        "kk": {
          "number": "З-26-00001",
          "index": "1",
          "total": "2",
          "task_number": "З-26-1",
          "work": "Заменили лампу",
          "result": "Освещение восстановлено",
          "limitations": "нет",
        },
      },
    ],
  },
  {
    "key": "message.requests.list",
    "section": "requests",
    "title": "Список обращений",
    "description": "Полное сообщение бота: Список обращений",
    "scenario": "Просмотр обращений",
    "command": "/requests",
    "legacyKeys": [],
    "ru": "{requests}",
    "kk": "{requests}",
    "variables": [
      {
        "name": "requests",
        "description":
          "Строки обращений с номером, состоянием, датой и описанием",
        "example":
          "1. З-26-00001 · В работе · 20.10.2026\nНе работает освещение",
      },
    ],
    "buttons": [
      {
        "id": "open_draft",
        "ru": "Открыть",
        "kk": "Ашу",
      },
      {
        "id": "next",
        "ru": "Далее",
        "kk": "Әрі қарай",
      },
      {
        "id": "open",
        "ru": "{number}",
        "kk": "{number}",
        "variables": [
          {
            "name": "number",
            "description": "Номер обращения",
            "example": "З-26-00001",
          },
        ],
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "requests":
            "1. <b>З-26-00001</b> · В работе · 20.10.2026\nНе работает &lt;лампа&gt; &amp; свет",
        },
        "kk": {
          "requests":
            "1. <b>З-26-00001</b> · Орындалуда · 20.10.2026\nНе работает &lt;лампа&gt; &amp; свет",
        },
        "buttons": [
          [
            {
              "id": "open",
              "vars": {
                "number": "З-26-00001",
              },
            },
          ],
        ],
        "blocks": [
          "requests",
        ],
      },
    ],
  },
  {
    "key": "requests.ukazhite_nomer_obrascheniya",
    "section": "requests",
    "title": "Укажите номер обращения",
    "description":
      "Полный ответ бота в сценарии «Обращения: ответы и подсказки».",
    "variables": [],
    "ru": "Укажите номер обращения",
    "kk": "Өтініш нөмірін көрсетіңіз",
    "scenario": "Обращения: ответы и подсказки",
    "command": "/request",
  },
  {
    "key": "requests.ukazhite_nomer_otcheta",
    "section": "requests",
    "title": "Укажите номер отчёта",
    "description": "Полный ответ бота в сценарии «Результат обращения».",
    "variables": [],
    "ru": "Укажите номер отчёта",
    "kk": "Есеп нөмірін көрсетіңіз",
    "scenario": "Результат обращения",
    "command": "/result",
  },
  {
    "key": "requests.rezultat_esche_ne_peredan",
    "section": "requests",
    "title": "Результат ещё не передан",
    "description": "Полный ответ бота в сценарии «Результат обращения».",
    "variables": [],
    "ru": "Результат ещё не передан",
    "kk": "Нәтиже әлі берілмеген",
    "scenario": "Результат обращения",
    "command": "/result",
  },
  {
    "key": "requests.snachala_otkroyte_visits_nomer_obrascheniya",
    "section": "requests",
    "title": "Сначала откройте /visits НОМЕР_ОБРАЩЕНИЯ",
    "description": "Полный ответ бота в сценарии «Визиты».",
    "variables": [],
    "ru": "Сначала откройте визиты из карточки обращения.",
    "kk": "Алдымен өтініш карточкасынан келулерді ашыңыз.",
    "scenario": "Визиты",
    "command": "/visits",
  },
  {
    "key": "requests.vizit_soglasovan",
    "section": "requests",
    "title": "Визит согласован",
    "description": "Полный ответ бота в сценарии «Визиты».",
    "variables": [],
    "ru": "Визит согласован",
    "kk": "Сапар келісілді",
    "scenario": "Визиты",
    "command": "/visits",
  },
  {
    "key":
      "requests.soobschenie_o_neyavke_peredano_administratoru_dlya_proverki",
    "section": "requests",
    "title": "Сообщение о неявке передано администратору для проверки",
    "description": "Полный ответ бота в сценарии «Визиты».",
    "variables": [],
    "ru": "Сообщение о неявке передано администратору для проверки",
    "kk": "Жоқтық туралы хабарлама әкімшіге берілді",
    "scenario": "Визиты",
    "command": "/visits",
  },
  {
    "key": "requests.lichnyy_chernovik_udalen_newrequest",
    "section": "requests",
    "title": "Личный черновик удалён. /newrequest",
    "description": "Полный ответ бота в сценарии «Новое обращение».",
    "variables": [],
    "ru": "Личный черновик удалён.",
    "kk": "Жеке жоба жойылды.",
    "scenario": "Новое обращение",
    "command": "/newrequest",
  },
  {
    "key": "requests.vvedite_novyy_tekst_chernovika",
    "section": "requests",
    "title": "Изменение текста черновика",
    "description": "Полный ответ бота в сценарии «Новое обращение».",
    "variables": [],
    "ru": "Введите новый текст черновика",
    "kk": "Жобаның жаңа мәтінін енгізіңіз",
    "scenario": "Новое обращение",
    "command": "/newrequest",
  },
  {
    "key": "requests.formirovanie_obrascheniya_priostanovleno",
    "section": "requests",
    "title": "Формирование обращения приостановлено.",
    "description": "Полный ответ бота в сценарии «Новое обращение».",
    "variables": [],
    "ru": "Формирование обращения приостановлено.",
    "kk": "Өтінішті жасау тоқтатылды.",
    "scenario": "Новое обращение",
    "command": "/newrequest",
  },
  {
    "key": "requests.nekorrektnaya_stranitsa",
    "section": "requests",
    "title": "Некорректная страница",
    "description": "Полный ответ бота в сценарии «Просмотр обращений».",
    "variables": [],
    "ru": "Некорректная страница",
    "kk": "Бұрыс бет",
    "scenario": "Просмотр обращений",
    "command": "/requests",
  },
  {
    "key": "requests.soobschenie_sohraneno",
    "section": "requests",
    "title": "Сообщение сохранено",
    "description": "Полный ответ бота в сценарии «Переписка».",
    "variables": [],
    "ru": "Сообщение сохранено",
    "kk": "Хабарлама сақталды",
    "scenario": "Переписка",
    "command": "/say",
  },
  {
    "key": "requests.dostup_izmenen",
    "section": "requests",
    "title": "Доступ изменён",
    "description": "Полный ответ бота в сценарии «Совместный доступ».",
    "variables": [],
    "ru": "Доступ изменён",
    "kk": "Қолжетімділік өзгертілді",
    "scenario": "Совместный доступ",
    "command": "/share",
  },
  {
    "key": "requests.otsenka_sohranena",
    "section": "requests",
    "title": "Оценка сохранена",
    "description": "Полный ответ бота в сценарии «Оценка результата».",
    "variables": [],
    "ru": "Оценка сохранена",
    "kk": "Баға сақталды",
    "scenario": "Оценка результата",
    "command": "/rate",
  },
  {
    "key": "requests.reshenie_sohraneno",
    "section": "requests",
    "title": "Решение сохранено",
    "description": "Полный ответ бота в сценарии «Решение по обращению».",
    "variables": [],
    "ru": "Решение сохранено",
    "kk": "Шешім сақталды",
    "scenario": "Решение по обращению",
    "command": "/request",
  },
  {
    "key": "requests.ukazhite_kod_doma_i_mesto_dom_1",
    "section": "requests",
    "title": "Укажите код дома и место: дом 1 подъезд 2",
    "description": "Полный ответ бота в сценарии «Новое обращение».",
    "variables": [],
    "ru": "Укажите код дома и место: дом 1 подъезд 2",
    "kk": "Үй коды мен орнын көрсетіңіз: үй 1 кіреберіс 2",
    "scenario": "Новое обращение",
    "command": "/newrequest",
  },
  {
    "key": "requests.dom_ne_nayden",
    "section": "requests",
    "title": "Дом не найден",
    "description": "Полный ответ бота в сценарии «Новое обращение».",
    "variables": [],
    "ru": "Дом не найден",
    "kk": "Үй табылмады",
    "scenario": "Новое обращение",
    "command": "/newrequest",
  },
  {
    "key": "requests.opishite_mesto_na_territorii",
    "section": "requests",
    "title": "Опишите место на территории",
    "description": "Полный ответ бота в сценарии «Новое обращение».",
    "variables": [],
    "ru": "Опишите место на территории",
    "kk": "Аумақтағы орынды сипаттаңыз",
    "scenario": "Новое обращение",
    "command": "/newrequest",
  },
  {
    "key": "requests.vyberite_nomer_iz_spiska_objects",
    "section": "requests",
    "title": "Выберите номер из списка. /objects",
    "description": "Полный ответ бота в сценарии «Новое обращение».",
    "variables": [],
    "ru": "Выберите помещение.",
    "kk": "Үй-жайды таңдаңыз.",
    "scenario": "Новое обращение",
    "command": "/newrequest",
  },
  {
    "key": "requests.opishite_problemu_svoimi_slovami_kategoriya_ne_nuzhna",
    "section": "requests",
    "title": "Ввод описания проблемы",
    "description": "Полный ответ бота в сценарии «Новое обращение».",
    "variables": [],
    "ru":
      "Опишите проблему в свободной форме (например, «Не включается свет в подъезде»).",
    "kk":
      "Мәселені еркін түрде сипаттаңыз (мысалы, «Кіреберістегі жарық жанбайды»).",
    "scenario": "Новое обращение",
    "command": "/newrequest",
  },
  {
    "key":
      "requests.chernovik_sohranen_dobavte_fayly_ili_sendrequest_requestcancel",
    "section": "requests",
    "title": "Ожидание отправки черновика",
    "description": "Полный ответ бота в сценарии «Новое обращение».",
    "variables": [],
    "ru":
      "Черновик сохранён. Можно прикрепить файлы.",
    "kk":
      "Жоба сақталды. Файлдарды тіркеуге болады.",
    "scenario": "Новое обращение",
    "command": "/newrequest",
  },
  {
    "key": "requests.obrascheniy_net",
    "section": "requests",
    "title": "Обращений нет",
    "description": "Полный ответ бота в сценарии «Просмотр обращений».",
    "variables": [],
    "ru": "Обращений нет",
    "kk": "Өтініш жоқ",
    "scenario": "Просмотр обращений",
    "command": "/requests",
  },
  {
    "key": "requests.otkroyte_zadanie_task_nomer_zatem_otpravte_fayl",
    "section": "requests",
    "title": "Откройте задание: /task НОМЕР, затем отправьте файл.",
    "description": "Полный ответ бота в сценарии «Файлы обращения».",
    "variables": [],
    "ru": "Сначала откройте задание, затем отправьте файл.",
    "kk": "Алдымен тапсырманы ашып, файлды жіберіңіз.",
    "scenario": "Файлы обращения",
    "command": "/newrequest · /request · /task",
  },
  {
    "key":
      "requests.snachala_sozdayte_ili_otkroyte_obraschenie_newrequest_request",
    "section": "requests",
    "title":
      "Сначала создайте или откройте обращение: /newrequest, /request НОМЕР.",
    "description":
      "Полный ответ бота в сценарии «Обращения: ответы и подсказки».",
    "variables": [],
    "ru":
      "Сначала откройте обращение.",
    "kk": "Алдымен өтінішті ашыңыз.",
    "scenario": "Обращения: ответы и подсказки",
    "command": "/request",
  },
  {
    "key": "requests.etot_vid_fayla_ne_podderzhivaetsya_otpravte_dokumentom",
    "section": "requests",
    "title": "Этот вид файла не поддерживается. Отправьте документом.",
    "description": "Полный ответ бота в сценарии «Файлы обращения».",
    "variables": [],
    "ru": "Этот вид файла не поддерживается. Отправьте документом.",
    "kk": "Бұл файл түріне қолдау жоқ. Құжат ретінде жіберіңіз.",
    "scenario": "Файлы обращения",
    "command": "/newrequest · /request · /task",
  },
  {
    "key": "requests.fayl_zadaniya_prinyat_v_ochered_dozhdites_soobscheniya",
    "section": "requests",
    "title":
      "Файл задания принят в очередь. Дождитесь сообщения о сохранении, затем /taskfiles.",
    "description": "Полный ответ бота в сценарии «Файлы обращения».",
    "variables": [],
    "ru":
      "Файл задания принят в очередь. Дождитесь сообщения о сохранении.",
    "kk":
      "Тапсырма файлы кезекке қабылданды. Сақталу туралы хабарламаны күтіңіз.",
    "scenario": "Файлы обращения",
    "command": "/newrequest · /request · /task",
  },
  {
    "key": "requests.fayl_prinyat_v_ochered_poka_ne_sohranen",
    "section": "requests",
    "title":
      "Файл принят в очередь, пока не сохранён. Обращение можно отправить независимо: /sendrequest.",
    "description": "Полный ответ бота в сценарии «Файлы обращения».",
    "variables": [],
    "ru":
      "Файл принят в очередь, пока не сохранён. Обращение можно отправить независимо.",
    "kk":
      "Файл кезекке қабылданды, әлі сақталған жоқ. Өтінішті бөлек жіберуге болады.",
    "scenario": "Файлы обращения",
    "command": "/newrequest · /request · /task",
  },
  {
    "key": "message.requests.card.active",
    "section": "requests",
    "title": "Карточка обращения — в работе",
    "description": "Полное сообщение бота: Карточка обращения",
    "scenario": "Просмотр обращений",
    "command": "/request",
    "legacyKeys": [
      "requests.sozdano",
      "help.actions_prefix",
      "help.visits_nomer_vizity_say_nomer_tekst_soobschenie",
      "requests.soobscheniya",
      "requests.otchety",
    ],
    "ru":
      "<b>{number}</b> · {state}\n{place} · создано {created}\n{description}\nПоследние сообщения:\n{messages}{result}\nОтчёты: {report_count}",
    "kk":
      "<b>{number}</b> · {state}\n{place} · құрылды {created}\n{description}\nСоңғы хабарламалар:\n{messages}{result}\nЕсептер: {report_count}",
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "З-26-00001",
      },
      {
        "name": "state",
        "description": "Состояние",
        "example": "В работе",
      },
      {
        "name": "place",
        "description": "Помещение",
        "example": "Дом 1, Квартира 4",
      },
      {
        "name": "created",
        "description": "Дата создания",
        "example": "20.10.2026 12:00",
      },
      {
        "name": "description",
        "description": "Описание",
        "example": "Не работает освещение",
      },
      {
        "name": "messages",
        "description": "Последние сообщения: дата, автор и текст",
        "example": "20.10.2026 12:30 — Администратор: Передано электрику",
      },
      {
        "name": "result",
        "description": "Результат",
        "example": "",
      },
      {
        "name": "report_count",
        "description": "Количество отчётов",
        "example": "0",
      },
      {
        "name": "report_command",
        "description": "Команда просмотра отчётов; пуста при отсутствии",
        "example": "",
      },
    ],
    "buttons": [
      {
        "id": "confirm",
        "ru": "Принять результат",
        "kk": "Нәтижені қабылдау",
      },
      {
        "id": "rate",
        "ru": "★ {value}",
        "kk": "★ {value}",
        "variables": [
          {
            "name": "value",
            "description": "Оценка",
            "example": "5",
          },
        ],
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "number": "З-26-00001",
          "state": "В работе",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Администратор: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "kk": {
          "number": "З-26-00001",
          "state": "Орындалуда",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Әкімші: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "blocks": [
          "messages",
        ],
      },
    ],
  },
  {
    "key": "message.requests.card.confirmation",
    "section": "requests",
    "title": "Карточка обращения — ожидает подтверждения",
    "description": "Полное сообщение бота: Карточка обращения",
    "scenario": "Просмотр обращений",
    "command": "/request",
    "legacyKeys": [
      "requests.sozdano",
      "help.actions_prefix",
      "help.result_nomer_otchety_return_nomer_prichina_dorabotka",
      "requests.soobscheniya",
      "requests.otchety",
    ],
    "ru":
      "<b>{number}</b> · {state}\n{place} · создано {created}\n{description}\nПоследние сообщения:\n{messages}{result}\nОтчёты: {report_count}",
    "kk":
      "<b>{number}</b> · {state}\n{place} · құрылды {created}\n{description}\nСоңғы хабарламалар:\n{messages}{result}\nЕсептер: {report_count}",
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "З-26-00001",
      },
      {
        "name": "state",
        "description": "Состояние",
        "example": "В работе",
      },
      {
        "name": "place",
        "description": "Помещение",
        "example": "Дом 1, Квартира 4",
      },
      {
        "name": "created",
        "description": "Дата создания",
        "example": "20.10.2026 12:00",
      },
      {
        "name": "description",
        "description": "Описание",
        "example": "Не работает освещение",
      },
      {
        "name": "messages",
        "description": "Последние сообщения: дата, автор и текст",
        "example": "20.10.2026 12:30 — Администратор: Передано электрику",
      },
      {
        "name": "result",
        "description": "Результат",
        "example": "",
      },
      {
        "name": "report_count",
        "description": "Количество отчётов",
        "example": "0",
      },
      {
        "name": "report_command",
        "description": "Команда просмотра отчётов; пуста при отсутствии",
        "example": "",
      },
    ],
    "buttons": [
      {
        "id": "confirm",
        "ru": "Принять результат",
        "kk": "Нәтижені қабылдау",
      },
      {
        "id": "rate",
        "ru": "★ {value}",
        "kk": "★ {value}",
        "variables": [
          {
            "name": "value",
            "description": "Оценка",
            "example": "5",
          },
        ],
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "number": "З-26-00001",
          "state": "Ожидает подтверждения",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Администратор: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "kk": {
          "number": "З-26-00001",
          "state": "Растауды күтуде",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Әкімші: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "buttons": [
          [
            {
              "id": "confirm",
            },
          ],
        ],
        "blocks": [
          "messages",
        ],
      },
    ],
  },
  {
    "key": "message.requests.card.closed",
    "section": "requests",
    "title": "Карточка обращения — закрыто",
    "description": "Полное сообщение бота: Карточка обращения",
    "scenario": "Просмотр обращений",
    "command": "/request",
    "legacyKeys": [
      "requests.sozdano",
      "help.actions_prefix",
      "help.rate_nomer_1_5_kommentariy_otsenka_appeal",
      "requests.soobscheniya",
      "requests.otchety",
    ],
    "ru":
      "<b>{number}</b> · {state}\n{place} · создано {created}\n{description}\nПоследние сообщения:\n{messages}{result}\nОтчёты: {report_count}",
    "kk":
      "<b>{number}</b> · {state}\n{place} · құрылды {created}\n{description}\nСоңғы хабарламалар:\n{messages}{result}\nЕсептер: {report_count}",
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "З-26-00001",
      },
      {
        "name": "state",
        "description": "Состояние",
        "example": "В работе",
      },
      {
        "name": "place",
        "description": "Помещение",
        "example": "Дом 1, Квартира 4",
      },
      {
        "name": "created",
        "description": "Дата создания",
        "example": "20.10.2026 12:00",
      },
      {
        "name": "description",
        "description": "Описание",
        "example": "Не работает освещение",
      },
      {
        "name": "messages",
        "description": "Последние сообщения: дата, автор и текст",
        "example": "20.10.2026 12:30 — Администратор: Передано электрику",
      },
      {
        "name": "result",
        "description": "Результат",
        "example": "",
      },
      {
        "name": "report_count",
        "description": "Количество отчётов",
        "example": "0",
      },
      {
        "name": "report_command",
        "description": "Команда просмотра отчётов; пуста при отсутствии",
        "example": "",
      },
    ],
    "buttons": [
      {
        "id": "confirm",
        "ru": "Принять результат",
        "kk": "Нәтижені қабылдау",
      },
      {
        "id": "rate",
        "ru": "★ {value}",
        "kk": "★ {value}",
        "variables": [
          {
            "name": "value",
            "description": "Оценка",
            "example": "5",
          },
        ],
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "number": "З-26-00001",
          "state": "Закрыта",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Администратор: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "kk": {
          "number": "З-26-00001",
          "state": "Жабылды",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Әкімші: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "buttons": [
          [
            {
              "id": "rate",
              "vars": {
                "value": "1",
              },
            },
            {
              "id": "rate",
              "vars": {
                "value": "2",
              },
            },
            {
              "id": "rate",
              "vars": {
                "value": "3",
              },
            },
            {
              "id": "rate",
              "vars": {
                "value": "4",
              },
            },
            {
              "id": "rate",
              "vars": {
                "value": "5",
              },
            },
          ],
        ],
        "blocks": [
          "messages",
        ],
      },
    ],
  },
  {
    "key": "message.requests.card.rejected",
    "section": "requests",
    "title": "Карточка обращения — отклонено или отменено",
    "description": "Полное сообщение бота: Карточка обращения",
    "scenario": "Просмотр обращений",
    "command": "/request",
    "legacyKeys": [
      "requests.sozdano",
      "help.actions_prefix",
      "help.appeal_nomer_prichina_apellyatsiya_reopen_nomer_prichina",
      "requests.soobscheniya",
      "requests.otchety",
    ],
    "ru":
      "<b>{number}</b> · {state}\n{place} · создано {created}\n{description}\nПоследние сообщения:\n{messages}{result}\nОтчёты: {report_count}",
    "kk":
      "<b>{number}</b> · {state}\n{place} · құрылды {created}\n{description}\nСоңғы хабарламалар:\n{messages}{result}\nЕсептер: {report_count}",
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "З-26-00001",
      },
      {
        "name": "state",
        "description": "Состояние",
        "example": "В работе",
      },
      {
        "name": "place",
        "description": "Помещение",
        "example": "Дом 1, Квартира 4",
      },
      {
        "name": "created",
        "description": "Дата создания",
        "example": "20.10.2026 12:00",
      },
      {
        "name": "description",
        "description": "Описание",
        "example": "Не работает освещение",
      },
      {
        "name": "messages",
        "description": "Последние сообщения: дата, автор и текст",
        "example": "20.10.2026 12:30 — Администратор: Передано электрику",
      },
      {
        "name": "result",
        "description": "Результат",
        "example": "",
      },
      {
        "name": "report_count",
        "description": "Количество отчётов",
        "example": "0",
      },
      {
        "name": "report_command",
        "description": "Команда просмотра отчётов; пуста при отсутствии",
        "example": "",
      },
    ],
    "buttons": [
      {
        "id": "confirm",
        "ru": "Принять результат",
        "kk": "Нәтижені қабылдау",
      },
      {
        "id": "rate",
        "ru": "★ {value}",
        "kk": "★ {value}",
        "variables": [
          {
            "name": "value",
            "description": "Оценка",
            "example": "5",
          },
        ],
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "number": "З-26-00001",
          "state": "Отказано",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Администратор: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "kk": {
          "number": "З-26-00001",
          "state": "Қабылданбады",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Әкімші: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "blocks": [
          "messages",
        ],
      },
    ],
  },
  {
    "key": "message.requests.card.other",
    "section": "requests",
    "title": "Карточка обращения — прочие состояния",
    "description": "Полное сообщение бота: Карточка обращения",
    "scenario": "Просмотр обращений",
    "command": "/request",
    "legacyKeys": [
      "requests.sozdano",
      "help.actions_prefix",
      "requests.soobscheniya",
      "requests.otchety",
    ],
    "ru":
      "<b>{number}</b> · {state}\n{place} · создано {created}\n{description}\nПоследние сообщения:\n{messages}{result}\nОтчёты: {report_count}",
    "kk":
      "<b>{number}</b> · {state}\n{place} · құрылды {created}\n{description}\nСоңғы хабарламалар:\n{messages}{result}\nЕсептер: {report_count}",
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "З-26-00001",
      },
      {
        "name": "state",
        "description": "Состояние",
        "example": "В работе",
      },
      {
        "name": "place",
        "description": "Помещение",
        "example": "Дом 1, Квартира 4",
      },
      {
        "name": "created",
        "description": "Дата создания",
        "example": "20.10.2026 12:00",
      },
      {
        "name": "description",
        "description": "Описание",
        "example": "Не работает освещение",
      },
      {
        "name": "messages",
        "description": "Последние сообщения: дата, автор и текст",
        "example": "20.10.2026 12:30 — Администратор: Передано электрику",
      },
      {
        "name": "result",
        "description": "Результат",
        "example": "",
      },
      {
        "name": "report_count",
        "description": "Количество отчётов",
        "example": "0",
      },
      {
        "name": "report_command",
        "description": "Команда просмотра отчётов; пуста при отсутствии",
        "example": "",
      },
    ],
    "buttons": [
      {
        "id": "confirm",
        "ru": "Принять результат",
        "kk": "Нәтижені қабылдау",
      },
      {
        "id": "rate",
        "ru": "★ {value}",
        "kk": "★ {value}",
        "variables": [
          {
            "name": "value",
            "description": "Оценка",
            "example": "5",
          },
        ],
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "number": "З-26-00001",
          "state": "На доработке",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Администратор: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "kk": {
          "number": "З-26-00001",
          "state": "Түзетуде",
          "place": "Дом 1, Квартира 4",
          "created": "20.10.2026 12:00",
          "description": "Не работает <лампа> & свет",
          "messages":
            "20.10.2026 12:30 — Әкімші: Передано &lt;электрику&gt; &amp; мастеру",
          "result": "",
          "report_count": "0",
          "report_command": "",
        },
        "blocks": [
          "messages",
        ],
      },
    ],
  },
  {
    "key": "message.requests.result.more",
    "section": "requests",
    "title": "Результат работ — есть следующий отчёт",
    "description": "Полное сообщение бота: Результат работ",
    "scenario": "Результат обращения",
    "command": "/result",
    "legacyKeys": [
      "requests.otchet",
      "requests.iz",
      "requests.zadanie",
      "requests.ogranicheniya",
      "requests.sleduyuschiy_otchet",
    ],
    "ru":
      "<b>{number}</b> · Отчёт {index} из {total} · задание {task_number}\n{work}\n{result}\nОграничения: {limitations}",
    "kk":
      "<b>{number}</b> · Есеп {index} із ішінен {total} · тапсырма {task_number}\n{work}\n{result}\nШектеулер: {limitations}",
    "variables": [
      {
        "name": "number",
        "description": "Номер обращения",
        "example": "З-26-00001",
      },
      {
        "name": "index",
        "description": "Номер отчёта",
        "example": "1",
      },
      {
        "name": "total",
        "description": "Количество отчётов",
        "example": "2",
      },
      {
        "name": "task_number",
        "description": "Номер задания",
        "example": "З-26-1",
      },
      {
        "name": "work",
        "description": "Выполненные работы",
        "example": "Заменили лампу",
      },
      {
        "name": "result",
        "description": "Результат",
        "example": "Освещение восстановлено",
      },
      {
        "name": "limitations",
        "description": "Ограничения",
        "example": "нет",
      },
      {
        "name": "next_index",
        "description": "Следующий отчёт",
        "example": "2",
      },
    ],
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример",
        "ru": {
          "number": "З-26-00001",
          "index": "1",
          "total": "2",
          "task_number": "З-26-1",
          "work": "Заменили лампу",
          "result": "Освещение восстановлено",
          "limitations": "нет",
        },
        "kk": {
          "number": "З-26-00001",
          "index": "1",
          "total": "2",
          "task_number": "З-26-1",
          "work": "Заменили лампу",
          "result": "Освещение восстановлено",
          "limitations": "нет",
        },
      },
    ],
  },
];
