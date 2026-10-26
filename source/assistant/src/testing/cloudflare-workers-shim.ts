// Тестовый шим модуля `cloudflare:workers` для Node/vitest: в рантайме Workers
// модуль даёт настоящий базовый класс DurableObject, в Node его нет — тестам
// достаточно пустого класса с теми же полями состояния.

export class DurableObject {
  readonly ctx: unknown;
  readonly env: unknown;

  constructor(ctx?: unknown, env?: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}

export default DurableObject;
