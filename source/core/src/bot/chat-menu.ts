import type { DbExecutor } from "../db/client.ts";

/** Пункт нативного меню команд Telegram (BotCommand из setMyCommands). */
export interface BotCommandItem {
  command: string;
  description: string;
}

/**
 * Меню команд бота жителей (ADR-009): порядок и формулировки согласованы со
 * справкой /help и скриншотом командного меню (25.10.2026). default-область
 * Telegram заполняется русскими текстами. Emoji-префиксы повторяют стиль
 * пунктов справки.
 */
/** Полное меню — состояние по умолчанию, включая незарегистрированных. */
export const RESIDENT_MENU_UNREGISTERED: Record<"ru" | "kk", BotCommandItem[]> =
  {
    ru: [
      { command: "start", description: "🚀 Главное меню" },
      { command: "register", description: "📝 Регистрация" },
      { command: "requests", description: "📬 Мои обращения" },
      { command: "newrequest", description: "🆕 Новое обращение" },
      { command: "objects", description: "🏠 Мои помещения" },
      { command: "add", description: "➕ Добавить помещение" },
      { command: "invite", description: "✉️ Пригласить жильца" },
      { command: "bind", description: "🔗 Привязать жильца к помещению" },
      { command: "accesses", description: "🔑 Доступы жильцов" },
      { command: "status", description: "🔎 Статус регистрации" },
      { command: "fix", description: "✏️ Исправить данные анкеты" },
      { command: "delete", description: "🗑 Удалить анкету" },
      { command: "notifications", description: "⚙️ Настройки" },
      { command: "help", description: "❓ Справка" },
    ],
    kk: [
      { command: "start", description: "🚀 Басты мәзір" },
      { command: "register", description: "📝 Тіркелу" },
      { command: "requests", description: "📬 Менің өтініштерім" },
      { command: "newrequest", description: "🆕 Жаңа өтініш" },
      { command: "objects", description: "🏠 Менің үй-жайларым" },
      { command: "add", description: "➕ Үй-жай қосу" },
      { command: "invite", description: "✉️ Тұрғынды шақыру" },
      { command: "bind", description: "🔗 Тұрғынды үй-жайға байланыстыру" },
      { command: "accesses", description: "🔑 Тұрғындардың рұқсаттары" },
      { command: "status", description: "🔎 Тіркелу күйі" },
      { command: "fix", description: "✏️ Сауалнама деректерін түзету" },
      { command: "delete", description: "🗑 Сауалнаманы жою" },
      { command: "notifications", description: "⚙️ Баптаулар" },
      { command: "help", description: "❓ Анықтама" },
    ],
  };

/** Меню при действующем профиле: «Регистрация» скрыта (REG-01/02). */
export const RESIDENT_MENU_REGISTERED: Record<"ru" | "kk", BotCommandItem[]> = {
  ru: RESIDENT_MENU_UNREGISTERED.ru.filter((item) =>
    item.command !== "register"
  ),
  kk: RESIDENT_MENU_UNREGISTERED.kk.filter((item) =>
    item.command !== "register"
  ),
};

/**
 * Применение меню в Telegram: выставляет chat-области (default + языковые)
 * воркера доставки. Сбой не должен влиять на саму доставку уведомления.
 */
export type ChatMenuSync = (
  telegramId: string,
  registered: boolean,
) => Promise<void>;

/**
 * Приводит chat-меню команд жителя к текущему состоянию регистрации
 * (REG-01/02, тот же предикат, что у inline-кнопки «Регистрация» в
 * actorForTelegram). Один apply на изменение: флаг хранится в
 * bot_dialog_channel.menu_registered (не в state — его пишут транзакции
 * вебхука под FOR UPDATE). Состояние регистрации вычисляется независимо от
 * наличия строки диалога: житель, ещё не писавший боту (анкета через кабинет),
 * тоже должен получить chat-меню без «Регистрации». Сбой apply оставляет флаг
 * прежним, поэтому синк повторится при следующей доставке; после удаления
 * анкеты меню вернётся к полному списку при ближайшей доставке. Строка
 * диалога при отсутствии создаётся заглушкой — loadDialog наполнит её при
 * первом сообщении.
 */
export async function syncResidentChatMenu(
  exec: DbExecutor,
  telegramId: string,
  apply: ChatMenuSync,
): Promise<void> {
  const [row] = await exec.query<{
    menu_registered: boolean | null;
    registered: boolean;
  }>(
    `select
       (select d.menu_registered from bot_dialog_channel d
        where d.telegram_user_id=$1 and d.bot='resident') as menu_registered,
     exists(
       select 1 from profile pr join person n on n.id=pr.person_id
       where pr.telegram_user_id=$1
         and pr.archived_at is null and n.status='active'
     ) as registered`,
    [telegramId],
  );
  const registered = Boolean(row?.registered);
  if (row?.menu_registered === registered) return;
  await apply(telegramId, registered);
  await exec.query(
    `insert into bot_dialog_channel(telegram_user_id,bot,menu_registered)
     values ($1,'resident',$2)
     on conflict (bot,telegram_user_id) do update
     set menu_registered=excluded.menu_registered,updated_at=now()`,
    [telegramId, registered],
  );
}
