// @munar/core — общее серверное ядро (используется всеми функциями-входами).
// Модули добавляются по мере срезов: config, errors, pdp, fsm, tim, outbox, jobs,
// notify, telegram, bot, storage, audit, idempotency, domains (см. LLD-01, раздел 3–4).
export * from "./config/env.ts";
export * from "./errors/api.ts";
