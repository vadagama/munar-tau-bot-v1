// @munar/core — общее серверное ядро (используется всеми функциями-входами).
// Модули добавляются по мере срезов (см. LLD-01, разделы 3–4).
export * from "./config/env.ts";
export * from "./errors/api.ts";
export * from "./pdp/index.ts";
export * from "./auth/index.ts";
export * from "./db/client.ts";
export * from "./bot/registry.ts";
export * from "./domains/admin/index.ts";
export * from "./domains/audit/index.ts";
export * from "./domains/emulation/index.ts";
