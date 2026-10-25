import type { TemplateDef } from "./types.ts";
export const otherMessageTemplates: readonly TemplateDef[] = [
  {
    "key": "messages.incidents.contact_on_no_phone",
    "section": "incidents",
    "title": "Телефон аварийной службы · дежурный на связи · без телефона",
    "description":
      "Полное сообщение: Телефон аварийной службы · дежурный на связи · без телефона",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "legacyKeys": [
      "incidents.telefon_esche_ne_nastroen",
      "incidents.signal_otpravlen_dezhurnomu",
      "incidents.duty_notice",
    ],
    "variables": [],
    "ru": "Телефон ещё не настроен\nСигнал не означает подтверждение выезда",
    "kk": "Телефон әлі бапталмаған\nСигнал шығуды растауды білдірмейді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.incidents.contact_on_phone",
    "section": "incidents",
    "title": "Телефон аварийной службы · дежурный на связи · телефон указан",
    "description":
      "Полное сообщение: Телефон аварийной службы · дежурный на связи · телефон указан",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "legacyKeys": [
      "incidents.telefon_esche_ne_nastroen",
      "incidents.signal_otpravlen_dezhurnomu",
      "incidents.duty_notice",
    ],
    "variables": [
      {
        "name": "phone",
        "description": "Телефон службы",
        "example": "+7 700 000 00 00",
      },
    ],
    "ru": "{phone}\nСигнал не означает подтверждение выезда",
    "kk": "{phone}\nСигнал шығуды растауды білдірмейді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "phone": "+7 700 000 00 00",
        },
        "kk": {
          "phone": "+7 700 000 00 00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.sent_on_no_phone",
    "section": "incidents",
    "title": "Сигнал отправлен · дежурный на связи · без телефона",
    "description":
      "Полное сообщение: Сигнал отправлен · дежурный на связи · без телефона",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "legacyKeys": [
      "incidents.telefon_esche_ne_nastroen",
      "incidents.signal_otpravlen_dezhurnomu",
      "incidents.duty_notice",
    ],
    "variables": [],
    "ru":
      "Сигнал отправлен дежурному\nТелефон ещё не настроен\nСигнал не означает подтверждение выезда",
    "kk":
      "Сигнал кезекшіді жіберілді\nТелефон әлі бапталмаған\nСигнал шығуды растауды білдірмейді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.incidents.sent_on_phone",
    "section": "incidents",
    "title": "Сигнал отправлен · дежурный на связи · телефон указан",
    "description":
      "Полное сообщение: Сигнал отправлен · дежурный на связи · телефон указан",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "legacyKeys": [
      "incidents.telefon_esche_ne_nastroen",
      "incidents.signal_otpravlen_dezhurnomu",
      "incidents.duty_notice",
    ],
    "variables": [
      {
        "name": "phone",
        "description": "Телефон службы",
        "example": "+7 700 000 00 00",
      },
    ],
    "ru":
      "Сигнал отправлен дежурному\n{phone}\nСигнал не означает подтверждение выезда",
    "kk":
      "Сигнал кезекшіді жіберілді\n{phone}\nСигнал шығуды растауды білдірмейді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "phone": "+7 700 000 00 00",
        },
        "kk": {
          "phone": "+7 700 000 00 00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.contact_off_no_phone",
    "section": "incidents",
    "title": "Телефон аварийной службы · вне дежурства · без телефона",
    "description":
      "Полное сообщение: Телефон аварийной службы · вне дежурства · без телефона",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "legacyKeys": [
      "incidents.telefon_esche_ne_nastroen",
      "incidents.signal_otpravlen_dezhurnomu",
      "incidents.off_duty_notice",
    ],
    "variables": [],
    "ru": "Телефон ещё не настроен\nНемедленная обработка не обеспечена",
    "kk": "Телефон әлі бапталмаған\nЖедел өңдеу қамтамасыз етілмейді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.incidents.contact_off_phone",
    "section": "incidents",
    "title": "Телефон аварийной службы · вне дежурства · телефон указан",
    "description":
      "Полное сообщение: Телефон аварийной службы · вне дежурства · телефон указан",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "legacyKeys": [
      "incidents.telefon_esche_ne_nastroen",
      "incidents.signal_otpravlen_dezhurnomu",
      "incidents.off_duty_notice",
    ],
    "variables": [
      {
        "name": "phone",
        "description": "Телефон службы",
        "example": "+7 700 000 00 00",
      },
    ],
    "ru": "{phone}\nНемедленная обработка не обеспечена",
    "kk": "{phone}\nЖедел өңдеу қамтамасыз етілмейді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "phone": "+7 700 000 00 00",
        },
        "kk": {
          "phone": "+7 700 000 00 00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.sent_off_no_phone",
    "section": "incidents",
    "title": "Сигнал отправлен · вне дежурства · без телефона",
    "description":
      "Полное сообщение: Сигнал отправлен · вне дежурства · без телефона",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "legacyKeys": [
      "incidents.telefon_esche_ne_nastroen",
      "incidents.signal_otpravlen_dezhurnomu",
      "incidents.off_duty_notice",
    ],
    "variables": [],
    "ru":
      "Сигнал отправлен дежурному\nТелефон ещё не настроен\nНемедленная обработка не обеспечена",
    "kk":
      "Сигнал кезекшіді жіберілді\nТелефон әлі бапталмаған\nЖедел өңдеу қамтамасыз етілмейді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.incidents.sent_off_phone",
    "section": "incidents",
    "title": "Сигнал отправлен · вне дежурства · телефон указан",
    "description":
      "Полное сообщение: Сигнал отправлен · вне дежурства · телефон указан",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "legacyKeys": [
      "incidents.telefon_esche_ne_nastroen",
      "incidents.signal_otpravlen_dezhurnomu",
      "incidents.off_duty_notice",
    ],
    "variables": [
      {
        "name": "phone",
        "description": "Телефон службы",
        "example": "+7 700 000 00 00",
      },
    ],
    "ru":
      "Сигнал отправлен дежурному\n{phone}\nНемедленная обработка не обеспечена",
    "kk":
      "Сигнал кезекшіді жіберілді\n{phone}\nЖедел өңдеу қамтамасыз етілмейді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "phone": "+7 700 000 00 00",
        },
        "kk": {
          "phone": "+7 700 000 00 00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.list",
    "section": "incidents",
    "title": "Список доступных аварий",
    "description": "Полное сообщение: Список доступных аварий",
    "scenario": "Просмотр аварий",
    "command": "/incidents",
    "legacyKeys": [],
    "variables": [
      {
        "name": "items",
        "description": "Список доступных записей",
        "example": "А-26-00001: Отключение воды",
      },
    ],
    "ru": "{items}",
    "kk": "{items}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "items": "А-26-00001: Отключение воды",
        },
        "kk": {
          "items": "А-26-00001: Отключение воды",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.card_checking_no_forecast_no_update",
    "section": "incidents",
    "title": "Карточка аварии · проверка · без прогноза · без обновления",
    "description":
      "Полное сообщение: Карточка аварии · проверка · без прогноза · без обновления",
    "scenario": "Просмотр аварий",
    "command": "/incident",
    "legacyKeys": [
      "incidents.signal_proveryaetsya",
      "incidents.prognoz",
      "incidents.sleduyuschee_obnovlenie",
    ],
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "А-26-00001",
      },
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
    ],
    "ru": "{number}: {title}\nСигнал проверяется",
    "kk": "{number}: {title}\nСигнал тексерілуде",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "number": "А-26-00001",
          "title": "Отключение воды",
        },
        "kk": {
          "number": "А-26-00001",
          "title": "Отключение воды",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.card_checking_no_forecast_update",
    "section": "incidents",
    "title": "Карточка аварии · проверка · без прогноза · с обновлением",
    "description":
      "Полное сообщение: Карточка аварии · проверка · без прогноза · с обновлением",
    "scenario": "Просмотр аварий",
    "command": "/incident",
    "legacyKeys": [
      "incidents.signal_proveryaetsya",
      "incidents.prognoz",
      "incidents.sleduyuschee_obnovlenie",
    ],
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "А-26-00001",
      },
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "next_update",
        "description": "Время следующего обновления",
        "example": "18.10.2026 16:00",
      },
    ],
    "ru":
      "{number}: {title}\nСигнал проверяется\nСледующее обновление: {next_update}",
    "kk":
      "{number}: {title}\nСигнал тексерілуде\nКелесі жаңарту: {next_update}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "next_update": "18.10.2026 16:00",
        },
        "kk": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "next_update": "18.10.2026 16:00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.card_checking_forecast_no_update",
    "section": "incidents",
    "title": "Карточка аварии · проверка · с прогнозом · без обновления",
    "description":
      "Полное сообщение: Карточка аварии · проверка · с прогнозом · без обновления",
    "scenario": "Просмотр аварий",
    "command": "/incident",
    "legacyKeys": [
      "incidents.signal_proveryaetsya",
      "incidents.prognoz",
      "incidents.sleduyuschee_obnovlenie",
    ],
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "А-26-00001",
      },
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "forecast",
        "description": "Прогноз",
        "example": "Сегодня до 18:00",
      },
    ],
    "ru": "{number}: {title}\nСигнал проверяется\nПрогноз: {forecast}",
    "kk": "{number}: {title}\nСигнал тексерілуде\nБолжам: {forecast}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "forecast": "Сегодня до 18:00",
        },
        "kk": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "forecast": "Сегодня до 18:00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.card_checking_forecast_update",
    "section": "incidents",
    "title": "Карточка аварии · проверка · с прогнозом · с обновлением",
    "description":
      "Полное сообщение: Карточка аварии · проверка · с прогнозом · с обновлением",
    "scenario": "Просмотр аварий",
    "command": "/incident",
    "legacyKeys": [
      "incidents.signal_proveryaetsya",
      "incidents.prognoz",
      "incidents.sleduyuschee_obnovlenie",
    ],
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "А-26-00001",
      },
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "forecast",
        "description": "Прогноз",
        "example": "Сегодня до 18:00",
      },
      {
        "name": "next_update",
        "description": "Время следующего обновления",
        "example": "18.10.2026 16:00",
      },
    ],
    "ru":
      "{number}: {title}\nСигнал проверяется\nПрогноз: {forecast}\nСледующее обновление: {next_update}",
    "kk":
      "{number}: {title}\nСигнал тексерілуде\nБолжам: {forecast}\nКелесі жаңарту: {next_update}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "forecast": "Сегодня до 18:00",
          "next_update": "18.10.2026 16:00",
        },
        "kk": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "forecast": "Сегодня до 18:00",
          "next_update": "18.10.2026 16:00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.card_public_no_forecast_no_update",
    "section": "incidents",
    "title": "Карточка аварии · опубликовано · без прогноза · без обновления",
    "description":
      "Полное сообщение: Карточка аварии · опубликовано · без прогноза · без обновления",
    "scenario": "Просмотр аварий",
    "command": "/incident",
    "legacyKeys": [
      "incidents.signal_proveryaetsya",
      "incidents.prognoz",
      "incidents.sleduyuschee_obnovlenie",
    ],
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "А-26-00001",
      },
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "description",
        "description": "Описание",
        "example": "Проверяем оборудование",
      },
    ],
    "ru": "{number}: {title}\n{description}",
    "kk": "{number}: {title}\n{description}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "description": "Проверяем оборудование",
        },
        "kk": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "description": "Проверяем оборудование",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.card_public_no_forecast_update",
    "section": "incidents",
    "title": "Карточка аварии · опубликовано · без прогноза · с обновлением",
    "description":
      "Полное сообщение: Карточка аварии · опубликовано · без прогноза · с обновлением",
    "scenario": "Просмотр аварий",
    "command": "/incident",
    "legacyKeys": [
      "incidents.signal_proveryaetsya",
      "incidents.prognoz",
      "incidents.sleduyuschee_obnovlenie",
    ],
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "А-26-00001",
      },
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "description",
        "description": "Описание",
        "example": "Проверяем оборудование",
      },
      {
        "name": "next_update",
        "description": "Время следующего обновления",
        "example": "18.10.2026 16:00",
      },
    ],
    "ru":
      "{number}: {title}\n{description}\nСледующее обновление: {next_update}",
    "kk": "{number}: {title}\n{description}\nКелесі жаңарту: {next_update}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "description": "Проверяем оборудование",
          "next_update": "18.10.2026 16:00",
        },
        "kk": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "description": "Проверяем оборудование",
          "next_update": "18.10.2026 16:00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.card_public_forecast_no_update",
    "section": "incidents",
    "title": "Карточка аварии · опубликовано · с прогнозом · без обновления",
    "description":
      "Полное сообщение: Карточка аварии · опубликовано · с прогнозом · без обновления",
    "scenario": "Просмотр аварий",
    "command": "/incident",
    "legacyKeys": [
      "incidents.signal_proveryaetsya",
      "incidents.prognoz",
      "incidents.sleduyuschee_obnovlenie",
    ],
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "А-26-00001",
      },
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "description",
        "description": "Описание",
        "example": "Проверяем оборудование",
      },
      {
        "name": "forecast",
        "description": "Прогноз",
        "example": "Сегодня до 18:00",
      },
    ],
    "ru": "{number}: {title}\n{description}\nПрогноз: {forecast}",
    "kk": "{number}: {title}\n{description}\nБолжам: {forecast}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "description": "Проверяем оборудование",
          "forecast": "Сегодня до 18:00",
        },
        "kk": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "description": "Проверяем оборудование",
          "forecast": "Сегодня до 18:00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.card_public_forecast_update",
    "section": "incidents",
    "title": "Карточка аварии · опубликовано · с прогнозом · с обновлением",
    "description":
      "Полное сообщение: Карточка аварии · опубликовано · с прогнозом · с обновлением",
    "scenario": "Просмотр аварий",
    "command": "/incident",
    "legacyKeys": [
      "incidents.signal_proveryaetsya",
      "incidents.prognoz",
      "incidents.sleduyuschee_obnovlenie",
    ],
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "А-26-00001",
      },
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "description",
        "description": "Описание",
        "example": "Проверяем оборудование",
      },
      {
        "name": "forecast",
        "description": "Прогноз",
        "example": "Сегодня до 18:00",
      },
      {
        "name": "next_update",
        "description": "Время следующего обновления",
        "example": "18.10.2026 16:00",
      },
    ],
    "ru":
      "{number}: {title}\n{description}\nПрогноз: {forecast}\nСледующее обновление: {next_update}",
    "kk":
      "{number}: {title}\n{description}\nБолжам: {forecast}\nКелесі жаңарту: {next_update}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "description": "Проверяем оборудование",
          "forecast": "Сегодня до 18:00",
          "next_update": "18.10.2026 16:00",
        },
        "kk": {
          "number": "А-26-00001",
          "title": "Отключение воды",
          "description": "Проверяем оборудование",
          "forecast": "Сегодня до 18:00",
          "next_update": "18.10.2026 16:00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.signals",
    "section": "incidents",
    "title": "Сигналы дежурному",
    "description": "Полное сообщение: Сигналы дежурному",
    "scenario": "Приём срочных сигналов",
    "command": "/signals",
    "legacyKeys": [],
    "variables": [
      {
        "name": "items",
        "description": "Список доступных записей",
        "example": "А-26-00001: Отключение воды",
      },
    ],
    "ru": "{items}",
    "kk": "{items}",
    "buttons": [
      {
        "id": "accept",
        "ru": "Принять сигнал",
        "kk": "Сигналды қабылдау",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "items": "А-26-00001: Отключение воды",
        },
        "kk": {
          "items": "А-26-00001: Отключение воды",
        },
        "buttons": [
          [
            {
              "id": "accept",
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "messages.incidents.publications",
    "section": "incidents",
    "title": "Список публикаций",
    "description": "Полное сообщение: Список публикаций",
    "scenario": "Публикации ОСИ",
    "command": "/publications",
    "legacyKeys": [],
    "variables": [
      {
        "name": "items",
        "description": "Список доступных записей",
        "example": "А-26-00001: Отключение воды",
      },
    ],
    "ru": "{items}",
    "kk": "{items}",
    "buttons": [
      {
        "id": "open",
        "ru": "Открыть",
        "kk": "Ашу",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "items": "А-26-00001: Отключение воды",
        },
        "kk": {
          "items": "А-26-00001: Отключение воды",
        },
        "buttons": [
          [
            {
              "id": "open",
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "messages.incidents.publication",
    "section": "incidents",
    "title": "Публикация",
    "description": "Полное сообщение: Публикация",
    "scenario": "Публикации ОСИ",
    "command": "/publication",
    "legacyKeys": [],
    "variables": [
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "body",
        "description": "Содержимое публикации",
        "example": "Проводятся работы",
      },
    ],
    "ru": "{title}\n{body}",
    "kk": "{title}\n{body}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "title": "Отключение воды",
          "body": "Проводятся работы",
        },
        "kk": {
          "title": "Отключение воды",
          "body": "Проводятся работы",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.work_report",
    "section": "incidents",
    "title": "Публикация отчёта о работах",
    "description": "Полное сообщение: Публикация отчёта о работах",
    "scenario": "Публикации ОСИ",
    "command": "/publication",
    "legacyKeys": [],
    "variables": [
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "body",
        "description": "Содержимое публикации",
        "example": "Проводятся работы",
      },
    ],
    "ru": "{title}\n{body}",
    "kk": "{title}\n{body}",
    "buttons": [
      {
        "id": "problem",
        "ru": "Сообщить о проблеме",
        "kk": "Мәселе туралы хабарлау",
      },
    ],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "title": "Отключение воды",
          "body": "Проводятся работы",
        },
        "kk": {
          "title": "Отключение воды",
          "body": "Проводятся работы",
        },
        "buttons": [
          [
            {
              "id": "problem",
            },
          ],
        ],
      },
    ],
  },
  {
    "key": "messages.incidents.outage_pending",
    "section": "incidents",
    "title": "Плановое отключение · ожидается восстановление",
    "description":
      "Полное сообщение: Плановое отключение · ожидается восстановление",
    "scenario": "Публикации ОСИ",
    "command": "/publication",
    "legacyKeys": [
      "incidents.plan",
      "incidents.vosstanovlenie",
      "incidents.vosstanovlenie_poka_ne_podtverzhdeno",
    ],
    "variables": [
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "body",
        "description": "Содержимое публикации",
        "example": "Проводятся работы",
      },
      {
        "name": "interval",
        "description": "Плановый интервал",
        "example": "18.10.2026 12:00–18:00",
      },
    ],
    "ru":
      "{title}\n{body}\nПлан: {interval}\nВосстановление пока не подтверждено",
    "kk": "{title}\n{body}\nЖоспар: {interval}\nҚалпына келтіру әлі расталмады",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "title": "Отключение воды",
          "body": "Проводятся работы",
          "interval": "18.10.2026 12:00–18:00",
        },
        "kk": {
          "title": "Отключение воды",
          "body": "Проводятся работы",
          "interval": "18.10.2026 12:00–18:00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.outage_restored",
    "section": "incidents",
    "title": "Плановое отключение · восстановлено",
    "description": "Полное сообщение: Плановое отключение · восстановлено",
    "scenario": "Публикации ОСИ",
    "command": "/publication",
    "legacyKeys": [
      "incidents.plan",
      "incidents.vosstanovlenie",
      "incidents.vosstanovlenie_poka_ne_podtverzhdeno",
    ],
    "variables": [
      {
        "name": "title",
        "description": "Название",
        "example": "Отключение воды",
      },
      {
        "name": "body",
        "description": "Содержимое публикации",
        "example": "Проводятся работы",
      },
      {
        "name": "interval",
        "description": "Плановый интервал",
        "example": "18.10.2026 12:00–18:00",
      },
      {
        "name": "restored_at",
        "description": "Время восстановления",
        "example": "18.10.2026 17:00",
      },
    ],
    "ru": "{title}\n{body}\nПлан: {interval}\nВосстановление: {restored_at}",
    "kk": "{title}\n{body}\nЖоспар: {interval}\nҚалпына келтіру: {restored_at}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "title": "Отключение воды",
          "body": "Проводятся работы",
          "interval": "18.10.2026 12:00–18:00",
          "restored_at": "18.10.2026 17:00",
        },
        "kk": {
          "title": "Отключение воды",
          "body": "Проводятся работы",
          "interval": "18.10.2026 12:00–18:00",
          "restored_at": "18.10.2026 17:00",
        },
      },
    ],
  },
  {
    "key": "messages.incidents.problem_sent",
    "section": "incidents",
    "title": "Проблема после работ принята",
    "description": "Полное сообщение: Проблема после работ принята",
    "scenario": "Проблема после выполненных работ",
    "command": "/workproblem",
    "legacyKeys": [
      "incidents.problema_peredana_administratoru",
    ],
    "variables": [
      {
        "name": "number",
        "description": "Номер",
        "example": "А-26-00001",
      },
    ],
    "ru": "{number}: проблема передана администратору",
    "kk": "{number}: мәселе әкімшіге берілді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "number": "А-26-00001",
        },
        "kk": {
          "number": "А-26-00001",
        },
      },
    ],
  },
  {
    "key": "messages.notifications.settings",
    "section": "help",
    "title": "Настройки уведомлений",
    "description": "Полное сообщение: Настройки уведомлений",
    "scenario": "Справка и настройки",
    "command": "/notifications",
    "legacyKeys": [
      "notifications.primer_izmeneniya_notifications_novosti_svodka_ru_vidy",
    ],
    "variables": [
      {
        "name": "settings",
        "description": "Текущие настройки получателя",
        "example": "Новости: сразу",
      },
    ],
    "ru":
      "{settings}\nОбязательные согласования и аварии не отключаются.",
    "kk":
      "{settings}\nМіндетті келісулер мен апат хабарламалары өшірілмейді.",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "settings": "Новости: сразу",
        },
        "kk": {
          "settings": "Новости: сразу",
        },
      },
    ],
  },
  {
    "key": "messages.errors.UNAUTHENTICATED",
    "section": "errors",
    "title": "Требуется вход",
    "description": "Полное сообщение: Требуется вход",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.UNAUTHENTICATED",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Требуется вход",
    "kk": "Кіру қажет",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.NO_PROFILE",
    "section": "errors",
    "title": "Профиль не найден",
    "description": "Полное сообщение: Профиль не найден",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.NO_PROFILE",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Профиль не найден",
    "kk": "Профиль табылмады",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.SESSION_EXPIRED",
    "section": "errors",
    "title": "Сеанс истёк, войдите заново",
    "description": "Полное сообщение: Сеанс истёк, войдите заново",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.SESSION_EXPIRED",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Сеанс истёк, войдите заново",
    "kk": "Сеанс аяқталды, қайта кіріңіз",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.FORBIDDEN",
    "section": "errors",
    "title": "Недостаточно прав для этого действия",
    "description": "Полное сообщение: Недостаточно прав для этого действия",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.FORBIDDEN",
      "common.error_help",
    ],
    "variables": [],
    "ru":
      "Недостаточно прав для этого действия. Если считаете это ошибкой — напишите администратору ОСИ.",
    "kk": "Рұқсат жеткіліксіз. Қате деп есептесеңіз, әкімшіге жазыңыз.",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.PRIVILEGED_REQUIRED",
    "section": "errors",
    "title": "Это действие доступно в веб-кабинете",
    "description": "Полное сообщение: Это действие доступно в веб-кабинете",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.PRIVILEGED_REQUIRED",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Это действие доступно в веб-кабинете",
    "kk": "Бұл әрекет веб-кабинетте қолжетімді",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.NOT_FOUND",
    "section": "errors",
    "title": "Не найдено",
    "description": "Полное сообщение: Не найдено",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.NOT_FOUND",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Не найдено. Проверьте номер",
    "kk": "Табылмады. Нөмірді тексеріңіз",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.VALIDATION_FAILED",
    "section": "errors",
    "title": "Не удалось разобрать данные",
    "description": "Полное сообщение: Не удалось разобрать данные",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.VALIDATION_FAILED",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Не удалось разобрать данные. Проверьте формат и повторите",
    "kk": "Деректерді түсінбедім. Пішімді тексеріп, қайталап көріңіз",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.INVALID_TRANSITION",
    "section": "errors",
    "title": "Такое действие сейчас недоступно",
    "description": "Полное сообщение: Такое действие сейчас недоступно",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.INVALID_TRANSITION",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Такое действие сейчас недоступно. Откройте объект заново",
    "kk": "Бұл әрекет қазір қолжетімсіз. Нысанды қайта ашыңыз",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.CONCURRENT_MODIFICATION",
    "section": "errors",
    "title": "Объект уже изменён кем-то другим",
    "description": "Полное сообщение: Объект уже изменён кем-то другим",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.CONCURRENT_MODIFICATION",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Объект уже изменён кем-то другим. Откройте заново и повторите",
    "kk": "Нысанды басқа біреу өзгерткен. Қайта ашып, қайталаңыз",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.IDEMPOTENCY_CONFLICT",
    "section": "errors",
    "title": "Повтор того же действия с другими данными",
    "description":
      "Полное сообщение: Повтор того же действия с другими данными",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.IDEMPOTENCY_CONFLICT",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Повтор того же действия с другими данными. Откройте объект заново",
    "kk": "Сол әрекет басқа деректермен қайталанды. Нысанды қайта ашыңыз",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.FILE_LIMIT",
    "section": "errors",
    "title": "Файл не подходит: до 20 МБ, только согласованные форматы",
    "description":
      "Полное сообщение: Файл не подходит: до 20 МБ, только согласованные форматы",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.FILE_LIMIT",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Файл не подходит: до 20 МБ, только согласованные форматы",
    "kk": "Файл жарамайды: 20 МБ-ға дейін, келісілген пішімдер ғана",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.RULE_LEGAL_BOUNDARY",
    "section": "errors",
    "title": "Значение выходит за допустимые границы",
    "description": "Полное сообщение: Значение выходит за допустимые границы",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.RULE_LEGAL_BOUNDARY",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Значение выходит за допустимые границы",
    "kk": "Мән рұқсат етілген шектен шығып кетті",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.RATE_LIMITED",
    "section": "errors",
    "title": "Слишком много запросов",
    "description": "Полное сообщение: Слишком много запросов",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.RATE_LIMITED",
      "common.error_help",
    ],
    "variables": [],
    "ru": "Слишком много запросов. Попробуйте через минуту",
    "kk": "Тым көп сұраныс. Бір минуттан кейін көріңіз",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.INTERNAL",
    "section": "errors",
    "title": "Техническая ошибка",
    "description": "Полное сообщение: Техническая ошибка",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "errors.INTERNAL",
      "common.error_help",
    ],
    "variables": [],
    "ru":
      "Техническая ошибка. Попробуйте позже; если повторится — сообщите в ОСИ",
    "kk": "Техникалық қате. Кейінірек көріңіз; қайталанса, ОСИ-ге хабарлаңыз",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.errors.custom",
    "section": "errors",
    "title": "Ошибка ввода с пояснением",
    "description": "Полное сообщение: Ошибка ввода с пояснением",
    "scenario": "Ошибки и восстановление",
    "command": "",
    "legacyKeys": [
      "common.error_help",
    ],
    "variables": [
      {
        "name": "detail",
        "description": "Описание ошибки",
        "example": "Проверьте введённые данные",
      },
    ],
    "ru": "{detail}",
    "kk": "{detail}",
    "buttons": [],
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {
          "detail": "Проверьте введённые данные",
        },
        "kk": {
          "detail": "Проверьте введённые данные",
        },
      },
    ],
  },
  {
    "key":
      "incidents.opasnost_avariya_napishite_emergency_nomer_obrascheniya_chto",
    "section": "incidents",
    "title":
      "Опасность, авария? Напишите: /emergency НОМЕР_ОБРАЩЕНИЯ что произошло. Телефон аварийной службы дома",
    "description": "Реплика incidents",
    "variables": [],
    "ru":
      "Укажите код дома для телефона аварийной службы. При непосредственной угрозе жизни звоните 112.",
    "kk":
      "Апаттық қызмет телефоны үшін үй кодын көрсетіңіз. Өмірге тікелей қауіп төнсе, 112 нөміріне қоңырау шалыңыз.",
    "scenario": "Просмотр аварий",
    "command": "/incidents",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "incidents.podtverdite_registratsiyu",
    "section": "incidents",
    "title": "Подтвердите регистрацию",
    "description": "Реплика incidents",
    "variables": [],
    "ru": "Подтвердите регистрацию",
    "kk": "Тіркелуді растаңыз",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "incidents.net_dostupnyh_avariy",
    "section": "incidents",
    "title": "Нет доступных аварий",
    "description": "Реплика incidents",
    "variables": [],
    "ru": "Нет доступных аварий",
    "kk": "Қолжетімді апаттар жоқ",
    "scenario": "Просмотр аварий",
    "command": "/incidents",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "incidents.net_signalov",
    "section": "incidents",
    "title": "Нет сигналов",
    "description": "Реплика incidents",
    "variables": [],
    "ru": "Нет сигналов",
    "kk": "Сигналдар жоқ",
    "scenario": "Приём срочных сигналов",
    "command": "/signals",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "incidents.signal_prinyat",
    "section": "incidents",
    "title": "Сигнал принят",
    "description": "Реплика incidents",
    "variables": [],
    "ru": "Сигнал принят",
    "kk": "Сигнал қабылданды",
    "scenario": "Приём срочных сигналов",
    "command": "/acceptsignal",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "incidents.dom_ne_nayden",
    "section": "incidents",
    "title": "Дом не найден",
    "description": "Реплика incidents",
    "variables": [],
    "ru": "Дом не найден",
    "kk": "Үй табылмады",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/emergency",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "incidents.danger_nomer_zadaniya_kod_doma_opisanie",
    "section": "incidents",
    "title": "/danger НОМЕР_ЗАДАНИЯ КОД_ДОМА | описание",
    "description": "Реплика incidents",
    "variables": [],
    "ru": "Укажите код дома и опишите опасность.",
    "kk": "Үй кодын көрсетіп, қауіпті сипаттаңыз.",
    "scenario": "Срочный сигнал и аварийные контакты",
    "command": "/danger",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "incidents.net_publikatsiy",
    "section": "incidents",
    "title": "Нет публикаций",
    "description": "Реплика incidents",
    "variables": [],
    "ru": "Нет публикаций",
    "kk": "Жарияланымдар жоқ",
    "scenario": "Публикации ОСИ",
    "command": "/publications",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "incidents.ukazhite_dom_i_opishite_problemu_odnim_soobscheniem",
    "section": "incidents",
    "title":
      "Укажите дом и опишите проблему одним сообщением: например «1 После ремонта кран протекает». /cancel ",
    "description": "Реплика incidents",
    "variables": [],
    "ru":
      "Укажите дом и опишите проблему одним сообщением, например «1 После ремонта кран протекает».",
    "kk":
      "Үйді және мәселені бір хабарламада көрсетіңіз, мысалы «1 Жөндеуден кейін кран ағып тұр».",
    "scenario": "Проблема после выполненных работ",
    "command": "/workproblem",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key":
      "incidents.incidents_avarii_publications_publikatsii_emergency_opasnost_signals",
    "section": "incidents",
    "title":
      "/incidents — аварии; /publications — публикации; /emergency — опасность; /signals — сигналы",
    "description": "Реплика incidents",
    "variables": [],
    "ru":
      "Аварии, публикации и сообщения об опасности.",
    "kk":
      "Апаттар, жарияланымдар және қауіп туралы хабарламалар.",
    "scenario": "Приём срочных сигналов",
    "command": "/signals",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "incidents.dom_ne_vhodit_v_etu_publikatsiyu_ukazhite",
    "section": "incidents",
    "title":
      "Дом не входит в эту публикацию. Укажите код дома и описание ещё раз, /cancel — отмена.",
    "description": "Реплика incidents",
    "variables": [],
    "ru":
      "Дом не входит в эту публикацию. Укажите код дома и описание ещё раз.",
    "kk":
      "Бұл үй жарияланымға кірмейді. Үй коды мен сипаттамасын қайта көрсетіңіз.",
    "scenario": "Публикации ОСИ",
    "command": "/publications",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "help.registration_help",
    "section": "help",
    "title": "Справка жителей",
    "description": "Раздел справки",
    "variables": [],
    "ru":
      "<b>Справка — ОСИ ЖК «Мунар Тау»</b>\n\n<b>Регистрация</b>\n📝 /register — Зарегистрироваться.\n🔎 /status — Статус регистрации.\n✏️ /fix — Исправить данные анкеты.\n🗑 /delete — Удалить анкету и закрыть доступ.\n\n<b>Помещения</b>\n🏠 /objects — Мои помещения и привязки.\n➕ /add — Привязать помещение к анкете.\n\n<b>Доступы собственника</b>\n✉️ /invite — Пригласить жильца: пришлём ссылку для регистрации.\n🔗 /bind — Привязать зарегистрировавшегося жильца к помещению.\n🔑 /accesses — Доступы жильцов и отправленные приглашения.\n\n<b>Обращения</b>\n🆕 /newrequest — Создать обращение в ОСИ.\n📬 /requests — Мои обращения и их состояния.\n💬 /request НОМЕР — Открыть обращение.\n\n<b>Настройки и навигация</b>\n⚙️ /notifications — Настроить уведомления и язык.\n🏠 /start — Открыть главное меню.\n↩️ /cancel — Отменить текущий диалог.\n❓ /help — Открыть эту справку.\n\n🚨 При непосредственной угрозе жизни звоните 112.",
    "kk":
      "<b>Анықтама — «Мұнар Тау» ТК МИБ</b>\n\n<b>Тіркелу</b>\n📝 /register — Тіркелу.\n🔎 /status — Тіркелу күйін көру.\n✏️ /fix — Сауалнама деректерін түзету.\n🗑 /delete — Сауалнаманы жою және қолжетімділікті жабу.\n\n<b>Үй-жайлар</b>\n🏠 /objects — Менің үй-жайларым мен байланыстарым.\n➕ /add — Үй-жайды сауалнамаға байланыстыру.\n\n<b>Меншік иесінің рұқсаттары</b>\n✉️ /invite — Тұрғынды шақыру: тіркелуге сілтеме жібереміз.\n🔗 /bind — Тіркелген тұрғынды үй-жайға байланыстыру.\n🔑 /accesses — Тұрғындардың рұқсаттары мен жіберілген шақырулар.\n\n<b>Өтініштер</b>\n🆕 /newrequest — МИБ-ке өтініш жасау.\n📬 /requests — Менің өтініштерім мен олардың күйлері.\n💬 /request НӨМІР — Өтінішті ашу.\n\n<b>Баптаулар мен навигация</b>\n⚙️ /notifications — Хабарламалар мен тілді баптау.\n🏠 /start — Басты мәзірді ашу.\n↩️ /cancel — Ағымдағы диалогты болдырмау.\n❓ /help — Осы анықтаманы ашу.\n\n🚨 Өмірге тікелей қауіп төнсе, 112 нөміріне қоңырау шалыңыз.",
    "scenario": "Справка и настройки",
    "command": "/help",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
        "buttons": [
          [
            {
              "id": "newrequest",
            },
            {
              "id": "requests",
            },
          ],
          [
            {
              "id": "objects",
            },
            {
              "id": "add",
            },
          ],
          [
            {
              "id": "notifications",
            },
            {
              "id": "help",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "newrequest",
        "ru": "🆕 Новое обращение",
        "kk": "🆕 Жаңа өтініш",
      },
      {
        "id": "requests",
        "ru": "📬 Мои обращения",
        "kk": "📬 Менің өтініштерім",
      },
      {
        "id": "objects",
        "ru": "🏠 Мои помещения",
        "kk": "🏠 Менің үй-жайларым",
      },
      {
        "id": "add",
        "ru": "➕ Добавить помещение",
        "kk": "➕ Үй-жай қосу",
      },
      {
        "id": "notifications",
        "ru": "⚙️ Настройки",
        "kk": "⚙️ Баптаулар",
      },
      {
        "id": "help",
        "ru": "❓ Помощь",
        "kk": "❓ Анықтама",
      },
    ],
  },
  {
    "key": "help.worker_help",
    "section": "help",
    "title": "Справка сотрудников",
    "description": "Раздел справки",
    "variables": [],
    "ru": "<b>Справка — ОСИ ЖК «Мунар Тау», бот сотрудников</b>\n\n<b>Обращения</b>\n📬 /staffrequests — Очередь обращений в пределах ваших полномочий.\n💬 /staffrequest НОМЕР — Открыть обращение.\nУправление и переписка доступны кнопками в карточке. Новое обращение сотрудник создаёт в кабинете.\n\n<b>Задания</b>\n🗂 /tasks — Мои задания и их состояния.\n🔎 /task НОМЕР — Открыть задание.\n📎 /taskfiles — Файлы открытого задания.\n\n<b>Работа с заданием</b>\n✅ /accepttask НОМЕР — Принять задание.\n🙅 /declinetask НОМЕР — Сообщить, что не можете выполнить.\n▶️ /starttask НОМЕР — Начать работу.\n📝 /reporttask НОМЕР — Подготовить отчёт.\n📤 /submitreport — Передать результат на проверку.\n⏸ /pausetask НОМЕР — Запросить остановку работы.\n🔧 /problem НОМЕР — Сообщить о найденной проблеме.\n\n<b>Личная работа</b>\n📈 /mywork — Мои показатели и переходы к заданиям.\n📑 /financialduties — Финансовые обязанности по полномочиям.\n\n<b>Настройки и навигация</b>\n⚙️ /notifications — Настроить уведомления и язык.\n🏠 /start — Открыть главное меню.\n↩️ /cancel — Отменить текущий диалог.\n❓ /help — Открыть эту справку.\n\nДоступные действия зависят от ваших полномочий и состояния записи.\n🚨 При непосредственной угрозе жизни звоните 112.",
    "kk": "<b>Анықтама — «Мұнар Тау» ТК МИБ, қызметкерлер боты</b>\n\n<b>Өтініштер</b>\n📬 /staffrequests — Өкілеттіктеріңіз шегіндегі өтініштер кезегі.\n💬 /staffrequest НӨМІР — Өтінішті ашу.\nБасқару мен хат алмасу карточкадағы батырмалар арқылы қолжетімді. Қызметкер жаңа өтінішті кабинетте жасайды.\n\n<b>Тапсырмалар</b>\n🗂 /tasks — Менің тапсырмаларым мен олардың күйлері.\n🔎 /task НӨМІР — Тапсырманы ашу.\n📎 /taskfiles — Ашық тапсырманың файлдары.\n\n<b>Тапсырмамен жұмыс</b>\n✅ /accepttask НӨМІР — Тапсырманы қабылдау.\n🙅 /declinetask НӨМІР — Орындай алмайтыныңызды хабарлау.\n▶️ /starttask НӨМІР — Жұмысты бастау.\n📝 /reporttask НӨМІР — Есеп дайындау.\n📤 /submitreport — Нәтижені тексеруге жіберу.\n⏸ /pausetask НӨМІР — Жұмысты тоқтатуды сұрау.\n🔧 /problem НӨМІР — Табылған мәселені хабарлау.\n\n<b>Жеке жұмыс</b>\n📈 /mywork — Жеке көрсеткіштер мен тапсырмаларға өту.\n📑 /financialduties — Өкілеттік бойынша қаржылық міндеттемелер.\n\n<b>Баптаулар мен навигация</b>\n⚙️ /notifications — Хабарламалар мен тілді баптау.\n🏠 /start — Басты мәзірді ашу.\n↩️ /cancel — Ағымдағы диалогты болдырмау.\n❓ /help — Осы анықтаманы ашу.\n\nҚолжетімді әрекеттер өкілеттіктеріңізге және жазба күйіне байланысты.\n🚨 Өмірге тікелей қауіп төнсе, 112 нөміріне қоңырау шалыңыз.",
    "scenario": "Справка и настройки",
    "command": "/help",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
        "buttons": [
          [
            {
              "id": "tasks"
            },
            {
              "id": "staffrequests"
            }
          ],
          [
            {
              "id": "notifications"
            },
            {
              "id": "help"
            }
          ]
        ]
      }
    ],
    "buttons": [
      {
        "id": "tasks",
        "ru": "🗂 Мои задания",
        "kk": "🗂 Менің тапсырмаларым"
      },
      {
        "id": "help",
        "ru": "❓ Помощь",
        "kk": "❓ Анықтама"
      },
      {
        "id": "staffrequests",
        "ru": "📬 Обращения",
        "kk": "📬 Өтініштер"
      },
      {
        "id": "notifications",
        "ru": "⚙️ Настройки",
        "kk": "⚙️ Баптаулар"
      }
    ]
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
    "scenario": "Справка и настройки",
    "command": "/start",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
        "buttons": [
          [
            {
              "id": "newrequest",
            },
            {
              "id": "requests",
            },
          ],
          [
            {
              "id": "objects",
            },
            {
              "id": "add",
            },
          ],
          [
            {
              "id": "notifications",
            },
            {
              "id": "help",
            },
          ],
        ],
      },
    ],
    "buttons": [
      {
        "id": "newrequest",
        "ru": "🆕 Новое обращение",
        "kk": "🆕 Жаңа өтініш",
      },
      {
        "id": "requests",
        "ru": "📬 Мои обращения",
        "kk": "📬 Менің өтініштерім",
      },
      {
        "id": "objects",
        "ru": "🏠 Мои помещения",
        "kk": "🏠 Менің үй-жайларым",
      },
      {
        "id": "add",
        "ru": "➕ Добавить помещение",
        "kk": "➕ Үй-жай қосу",
      },
      {
        "id": "notifications",
        "ru": "⚙️ Настройки",
        "kk": "⚙️ Баптаулар",
      },
      {
        "id": "help",
        "ru": "❓ Помощь",
        "kk": "❓ Анықтама",
      },
    ],
  },
  {
    "key": "notifications.snachala_podtverdite_registratsiyu_register",
    "section": "help",
    "title": "Сначала подтвердите регистрацию: /register",
    "description": "Реплика notifications",
    "variables": [],
    "ru": "Сначала подтвердите регистрацию.",
    "kk": "Алдымен тіркелуді растаңыз.",
    "scenario": "Справка и настройки",
    "command": "/notifications",
    "examples": [
      {
        "id": "default",
        "title": "Пример сообщения",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "common.telefon_ili_privyazka_uzhe_suschestvuet_trebuetsya_proverka",
    "section": "common",
    "title": "Телефон или профиль уже связан",
    "description": "Реплика inbound",
    "variables": [],
    "ru":
      "Телефон или привязка уже существует. Требуется проверка администратора.",
    "kk": "Телефон немесе тіркелгі бар. Әкімшінің тексеруі қажет.",
    "scenario": "Регистрация · Проверка данных",
    "command": "/register",
    "examples": [
      {
        "id": "default",
        "title": "Конфликт данных",
        "ru": {},
        "kk": {},
      },
    ],
  },
  {
    "key": "messages.notices.digest",
    "section": "notices",
    "scenario": "Уведомления · Ежедневная сводка",
    "title": "Ежедневная сводка",
    "description":
      "Сводка доступных получателю уведомлений. Элементы уже проверены по правам доступа.",
    "legacyKeys": [
      "notices.digest_heading",
    ],
    "variables": [
      {
        "name": "items",
        "description": "Список уведомлений, доступных получателю",
        "example":
          "• Опубликован отчёт о работах\n\n• Запланировано отключение воды",
      },
    ],
    "ru": "Ежедневная сводка\n\n{items}",
    "kk": "Күндік шолу\n\n{items}",
    "examples": [
      {
        "id": "default",
        "title": "Два уведомления",
        "ru": {
          "items":
            "• Опубликован отчёт о работах\n\n• Запланировано отключение воды",
        },
        "kk": {
          "items": "• Жұмыс есебі жарияланды\n\n• Су өшіру жоспарланған",
        },
      },
    ],
  },
  {
    "key": "messages.notices.digest_dated",
    "section": "notices",
    "scenario": "Уведомления · Ежедневная сводка",
    "title": "Ежедневная сводка за дату",
    "description":
      "Сводка доступных получателю уведомлений. Элементы уже проверены по правам доступа.",
    "legacyKeys": [
      "notices.digest_heading",
    ],
    "variables": [
      {
        "name": "items",
        "description": "Список уведомлений, доступных получателю",
        "example":
          "• Опубликован отчёт о работах\n\n• Запланировано отключение воды",
      },
      {
        "name": "date",
        "description": "Дата сводки",
        "example": "18.10.2026",
      },
    ],
    "ru": "Ежедневная сводка {date}\n\n{items}",
    "kk": "Күндік шолу {date}\n\n{items}",
    "examples": [
      {
        "id": "default",
        "title": "Два уведомления",
        "ru": {
          "items":
            "• Опубликован отчёт о работах\n\n• Запланировано отключение воды",
          "date": "18.10.2026",
        },
        "kk": {
          "items": "• Жұмыс есебі жарияланды\n\n• Су өшіру жоспарланған",
          "date": "18.10.2026",
        },
      },
    ],
  },
];
