// Разделение двух Telegram-ботов (ADR-009): маршрут webhook по суффиксу пути
// и переменные среды токенов/секретов для resident и worker.

import { describe, expect, it } from "vitest";
import {
  botFromPath,
  botTokenEnv,
  botWebhookSecretEnv,
  RESIDENT_TOKEN_ENV,
  RESIDENT_WEBHOOK_SECRET_ENV,
  WORKER_TOKEN_ENV,
  WORKER_WEBHOOK_SECRET_ENV,
} from "./bots.ts";

describe("botFromPath", () => {
  it("базовый путь и /resident — бот жителей (совместимость со старым webhook)", () => {
    expect(botFromPath("/functions/v1/bot-webhook")).toBe("resident");
    expect(botFromPath("/functions/v1/bot-webhook/resident")).toBe("resident");
  });

  it("/worker — бот сотрудников", () => {
    expect(botFromPath("/functions/v1/bot-webhook/worker")).toBe("worker");
  });

  it("завершающий слэш не мешает разбору", () => {
    expect(botFromPath("/functions/v1/bot-webhook/worker/")).toBe("worker");
  });

  it("неизвестный суффикс — null (404)", () => {
    expect(botFromPath("/functions/v1/bot-webhook/other")).toBeNull();
    expect(botFromPath("/functions/v1/api")).toBeNull();
  });
});

describe("переменные среды ботов", () => {
  it("токены", () => {
    expect(botTokenEnv("resident")).toBe(RESIDENT_TOKEN_ENV);
    expect(RESIDENT_TOKEN_ENV).toBe("TELEGRAM_BOT_TOKEN");
    expect(botTokenEnv("worker")).toBe(WORKER_TOKEN_ENV);
    expect(WORKER_TOKEN_ENV).toBe("TELEGRAM_WORKER_BOT_TOKEN");
  });

  it("секреты webhook", () => {
    expect(botWebhookSecretEnv("resident")).toBe(RESIDENT_WEBHOOK_SECRET_ENV);
    expect(RESIDENT_WEBHOOK_SECRET_ENV).toBe("TELEGRAM_WEBHOOK_SECRET");
    expect(botWebhookSecretEnv("worker")).toBe(WORKER_WEBHOOK_SECRET_ENV);
    expect(WORKER_WEBHOOK_SECRET_ENV).toBe("TELEGRAM_WORKER_WEBHOOK_SECRET");
  });
});
