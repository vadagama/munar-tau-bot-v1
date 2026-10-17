// Минимальный исполнитель SQL поверх postgres.js (ADR-003). Ядро не знает о
// рантайме: соединение создаёт вызывающая сторона (функции — по строке
// подключения из env, тесты — in-memory фейки из core/src/testing/memory.ts).
//
// prepare: false обязателен для пулеров транзакций (Supabase Pooler):
// подготовленные выражения не сохраняются между проверками соединений.

import postgres from "postgres";

/** Исполнитель запросов: клиент или транзакция. Первый аргумент всех репо. */
export interface DbExecutor {
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

/** Владелец транзакций: функции сервиса оборачивают в него составные операции. */
export interface DbTransactionRunner {
  transaction<T>(fn: (exec: DbExecutor) => Promise<T>): Promise<T>;
}

/** Клиент БД: исполнитель + транзакции. */
export interface DbClient extends DbExecutor, DbTransactionRunner {
  close(): Promise<void>;
}

const asParams = (params: readonly unknown[]): never[] => params as never[];

/** Соединение к PostgreSQL по строке подключения (например, из env). */
export function createDbClient(
  connectionString: string,
  options: { max?: number; maxLifetime?: number } = {},
): DbClient {
  const sql = postgres(connectionString, {
    prepare: false,
    max: options.max ?? 5,
    ...(options.maxLifetime === undefined
      ? {}
      : { max_lifetime: options.maxLifetime }),
  });

  return {
    async query<T>(
      text: string,
      params: readonly unknown[] = [],
    ): Promise<T[]> {
      const rows = await sql.unsafe(text, asParams(params));
      return rows as unknown as T[];
    },
    transaction<T>(fn: (exec: DbExecutor) => Promise<T>): Promise<T> {
      return sql.begin(async (tx) => {
        const executor: DbExecutor = {
          async query<U>(
            text: string,
            params: readonly unknown[] = [],
          ): Promise<U[]> {
            const rows = await tx.unsafe(text, asParams(params));
            return rows as unknown as U[];
          },
        };
        return fn(executor);
      }) as Promise<T>;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
