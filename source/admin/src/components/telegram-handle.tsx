import type { ReactNode } from "react";

/**
 * Имя аккаунта Telegram ссылкой https://t.me/<name> — быстрая проверка автора
 * из кабинета. Имя display-only (ADR-001/004): не идентификатор, только показ.
 */
export function TelegramHandle({ username }: { username: unknown }): ReactNode {
  const name = typeof username === "string" ? username.trim() : "";
  if (!name) return "—";
  return (
    <a
      href={`https://t.me/${name}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      @{name}
    </a>
  );
}
