// Настройка меню команд и описаний двух ботов ОСИ ЖК «Мунар Тау» (ADR-009):
// бот жителей (resident) и бот сотрудников (worker).
// Задаёт области default/ru/kk. Chat-области жителей (без «Регистрации» при
// действующем профиле, REG-01/02) поддерживает воркер доставки
// (functions/jobs: residentMenuSync) — здесь они не настраиваются.
// Из source/: deno run --env-file=.env.local --allow-env --allow-net tools/scripts/set-bot-commands.ts
// Требует TELEGRAM_BOT_TOKEN и/или TELEGRAM_WORKER_BOT_TOKEN (не коммитятся, не печатаются);
// отсутствующий токен — пропуск с предупреждением, настройка одного бота не мешает другому.
// Повторный запуск безопасен: методы просто перезаписывают меню и описание.

import { botTokenEnv, type BotKind } from "../../core/src/bot/bots.ts";
import {
  RESIDENT_MENU_UNREGISTERED,
  type BotCommandItem,
} from "../../core/src/bot/chat-menu.ts";

// Команды бота жителей: сценарии registration и requests (анкета, обращения).
// Список определён в core (bot/chat-menu.ts) — его же использует воркер доставки
// для chat-областей; /request остаётся командой, но в меню не входит.
const RESIDENT_COMMANDS_RU: BotCommandItem[] = RESIDENT_MENU_UNREGISTERED.ru;
const RESIDENT_COMMANDS_KK: BotCommandItem[] = RESIDENT_MENU_UNREGISTERED.kk;

// Команды бота сотрудников: задания исполнителей (WRK); полный список — /help.
const WORKER_COMMANDS_RU: BotCommandItem[] = [
  { command: "start", description: "🚀 Запуск и главное меню" },
  { command: "help", description: "❓ Справка по всем командам" },
  { command: "tasks", description: "🗂 Мои задания" },
  { command:"staffrequests",description:"📬 Обращения" },
  { command:"notifications",description:"⚙️ Уведомления и язык" },
  { command: "task", description: "🔎 Открыть задание по номеру" },
];

const WORKER_COMMANDS_KK: BotCommandItem[] = [
  { command: "start", description: "🚀 Іске қосу және басты мәзір" },
  { command: "help", description: "❓ Барлық командалар туралы анықтама" },
  { command: "tasks", description: "🗂 Менің тапсырмаларым" },
  { command:"staffrequests",description:"📬 Өтініштер" },
  { command:"notifications",description:"⚙️ Хабарламалар мен тіл" },
  { command: "task", description: "🔎 Тапсырманы нөмір бойынша ашу" },
];

const RESIDENT_DESCRIPTION_RU =
  "Бот жителей ОСИ ЖК «Мунар Тау»: регистрация, обращения, уведомления.";
const RESIDENT_DESCRIPTION_KK =
  "«Мұнар Тау» ТКБ тұрғындар боты: тіркеу, өтініштер, хабарландырулар.";
const RESIDENT_SHORT_RU = "Обращения и уведомления жителей ОСИ";
const RESIDENT_SHORT_KK = "Тұрғындардың өтініштері мен хабарландырулары";

const WORKER_DESCRIPTION_RU =
  "Бот сотрудников ОСИ ЖК «Мунар Тау»: задания исполнителям, служебные уведомления.";
const WORKER_DESCRIPTION_KK =
  "«Мұнар Тау» ТКБ қызметкерлер боты: орындаушылардың тапсырмалары, қызметтік хабарландырулар.";
const WORKER_SHORT_RU = "Задания и служебные уведомления ОСИ";
const WORKER_SHORT_KK = "ОСИ тапсырмалары мен қызметтік хабарландырулары";

interface Scope {
  language_code?: string;
  commands: BotCommandItem[];
  description: string;
  short: string;
}

interface BotConfig {
  kind: BotKind;
  label: string;
  scopes: Scope[];
}

// default-область (без language_code) заполняется русскими текстами:
// Telegram показывает её пользователям с прочими языковыми настройками.
const BOTS: BotConfig[] = [
  {
    kind: "resident",
    label: "бот жителей",
    scopes: [
      {
        commands: RESIDENT_COMMANDS_RU,
        description: RESIDENT_DESCRIPTION_RU,
        short: RESIDENT_SHORT_RU,
      },
      {
        language_code: "ru",
        commands: RESIDENT_COMMANDS_RU,
        description: RESIDENT_DESCRIPTION_RU,
        short: RESIDENT_SHORT_RU,
      },
      {
        language_code: "kk",
        commands: RESIDENT_COMMANDS_KK,
        description: RESIDENT_DESCRIPTION_KK,
        short: RESIDENT_SHORT_KK,
      },
    ],
  },
  {
    kind: "worker",
    label: "бот сотрудников",
    scopes: [
      {
        commands: WORKER_COMMANDS_RU,
        description: WORKER_DESCRIPTION_RU,
        short: WORKER_SHORT_RU,
      },
      {
        language_code: "ru",
        commands: WORKER_COMMANDS_RU,
        description: WORKER_DESCRIPTION_RU,
        short: WORKER_SHORT_RU,
      },
      {
        language_code: "kk",
        commands: WORKER_COMMANDS_KK,
        description: WORKER_DESCRIPTION_KK,
        short: WORKER_SHORT_KK,
      },
    ],
  },
];

async function callBot(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const result = await response.json() as {
    ok?: boolean;
    description?: string;
  };
  if (!response.ok || !result.ok) {
    throw new Error(
      `${method}: HTTP ${response.status} ${
        result.description ?? "неизвестная ошибка"
      }`,
    );
  }
}

let configured = 0;
let failures = 0;
for (const bot of BOTS) {
  const tokenEnv = botTokenEnv(bot.kind);
  const token = Deno.env.get(tokenEnv);
  if (!token) {
    console.warn(
      `[пропуск] ${bot.label}: ${tokenEnv} не задан — бот не настраивался.`,
    );
    continue;
  }
  try {
    await callBot(token, "getMe", {});
    for (const scope of bot.scopes) {
      await callBot(token, "setMyCommands", {
        commands: scope.commands,
        ...(scope.language_code ? { language_code: scope.language_code } : {}),
      });
      await callBot(token, "setMyDescription", {
        description: scope.description,
        ...(scope.language_code ? { language_code: scope.language_code } : {}),
      });
      await callBot(token, "setMyShortDescription", {
        short_description: scope.short,
        ...(scope.language_code ? { language_code: scope.language_code } : {}),
      });
      console.log(
        scope.language_code
          ? `[ok] ${bot.label}, область language_code=${scope.language_code}`
          : `[ok] ${bot.label}, область по умолчанию`,
      );
    }
    configured++;
  } catch (error) {
    console.error(
      `${bot.label}: ошибка обращения к Telegram API:`,
      error instanceof Error ? error.message : error,
    );
    failures++;
  }
}
if (configured === 0 && failures === 0) {
  console.error(
    "Не задан ни один токен ботов (TELEGRAM_BOT_TOKEN, TELEGRAM_WORKER_BOT_TOKEN).",
  );
  Deno.exit(1);
}
if (failures > 0) Deno.exit(1);
console.log(
  `Готово: настроено ботов — ${configured} из ${BOTS.length} (меню, описание и краткое описание, области default/ru/kk).`,
);
