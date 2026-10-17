// Настройка меню команд и описания бота в Telegram (срез UX A, бот ОСИ ЖК «Мунар Тау»).
// Из source/: deno run --allow-env --allow-net tools/scripts/set-bot-commands.ts
// Требует переменную окружения TELEGRAM_BOT_TOKEN (не коммитится, не печатается).
// Повторный запуск безопасен: методы просто перезаписывают меню и описание.

interface BotCommand {
  command: string;
  description: string;
}

// Команды соответствуют сценариям бота: registration, requests, tasks, notifications.
const COMMANDS_RU: BotCommand[] = [
  { command: "start", description: "Запуск и главное меню" },
  { command: "help", description: "Справка по всем командам" },
  { command: "register", description: "Регистрация в ОСИ (анкета)" },
  { command: "status", description: "Статус анкеты регистрации" },
  { command: "objects", description: "Мои помещения" },
  { command: "newrequest", description: "Новое обращение" },
  { command: "requests", description: "Мои обращения" },
  { command: "request", description: "Открыть обращение по номеру" },
  { command: "tasks", description: "Мои задания" },
  { command: "task", description: "Открыть задание по номеру" },
  { command: "notifications", description: "Настройки уведомлений" },
];

const COMMANDS_KK: BotCommand[] = [
  { command: "start", description: "Іске қосу және басты мәзір" },
  { command: "help", description: "Барлық командалар туралы анықтама" },
  { command: "register", description: "ОСИ-де тіркеу (өтінім)" },
  { command: "status", description: "Тіркелу өтінімінің күйі" },
  { command: "objects", description: "Менің үй-жайларым" },
  { command: "newrequest", description: "Жаңа өтініш" },
  { command: "requests", description: "Менің өтініштерім" },
  { command: "request", description: "Өтінішті нөмір бойынша ашу" },
  { command: "tasks", description: "Менің тапсырмаларым" },
  { command: "task", description: "Тапсырманы нөмір бойынша ашу" },
  { command: "notifications", description: "Хабарландырулар баптаулары" },
];

const DESCRIPTION_RU =
  "Бот ОСИ ЖК «Мунар Тау»: обращения жителей, задания исполнителям, уведомления. Начните с /register или /help.";
const DESCRIPTION_KK =
  "«Мұнар Тау» ТКБ боты: тұрғындардың өтініштері, орындаушылардың тапсырмалары, хабарландырулар. /register немесе /help-тен бастаңыз.";
const SHORT_RU = "Обращения, задания и уведомления ОСИ";
const SHORT_KK = "ОСИ өтініштері, тапсырмалары және хабарландырулары";

// default-область (без language_code) заполняется русскими текстами:
// Telegram показывает её пользователям с прочими языковыми настройками.
const SCOPES: {
  language_code?: string;
  commands: BotCommand[];
  description: string;
  short: string;
}[] = [
  { commands: COMMANDS_RU, description: DESCRIPTION_RU, short: SHORT_RU },
  {
    language_code: "ru",
    commands: COMMANDS_RU,
    description: DESCRIPTION_RU,
    short: SHORT_RU,
  },
  {
    language_code: "kk",
    commands: COMMANDS_KK,
    description: DESCRIPTION_KK,
    short: SHORT_KK,
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

const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
if (!token) {
  console.error(
    "TELEGRAM_BOT_TOKEN не задан. Пример: TELEGRAM_BOT_TOKEN=123:ABC deno run --allow-env --allow-net tools/scripts/set-bot-commands.ts",
  );
  Deno.exit(1);
}

try {
  await callBot(token, "getMe", {});
  for (const scope of SCOPES) {
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
        ? `[ok] область language_code=${scope.language_code}`
        : "[ok] область по умолчанию",
    );
  }
  console.log(
    "Готово: меню команд, описание и краткое описание установлены (default, ru, kk).",
  );
} catch (error) {
  console.error(
    "Ошибка обращения к Telegram API:",
    error instanceof Error ? error.message : error,
  );
  Deno.exit(1);
}
