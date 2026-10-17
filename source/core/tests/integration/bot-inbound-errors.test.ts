// Регрессия инцидента 17.10.2026: команда без номера уводила апдейт в 500
// (postgres.js UNDEFINED_VALUE), Telegram зацикливал повторную доставку,
// очередь обновлений блокировалась — «бот не выполняет команды».
// Проверки: валидация номера в find(), пометка bot_inbound.status='error'
// для неожиданных ошибок сценария (LLD-02), идемпотентность повторной доставки.
import { expect, it, vi } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { processInbound } from "../../src/bot/inbound.ts";
import { requestStep } from "../../src/bot/requests.ts";
import type { DbClient, DbExecutor } from "../../src/db/client.ts";
import type { RegistryDeps } from "../../src/domains/registry/service.ts";

const EXECUTOR = String(SEED.testExecutorTelegramId);

function privateUpdate(updateId: number, telegramId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: telegramId, is_bot: false, first_name: "Тест" },
      chat: { id: telegramId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

/** Обёртка, подменяющая один запрос внутри транзакции на бросок. */
function depsWithPoisonedDialogSelect(db: DbClient): RegistryDeps {
  return {
    audit: new SqlAuditRepo(),
    db: {
      ...db,
      transaction: <T>(fn: (exec: DbExecutor) => Promise<T>): Promise<T> =>
        db.transaction((exec) =>
          fn({
            query: (text, params) =>
              typeof text === "string" &&
                text.includes("select state from bot_dialog")
                ? Promise.reject(new Error("имитация сбоя сценария"))
                : exec.query(text as string, params),
          }),
        ),
    },
  };
}

describeWithDb("бот: ошибка сценария не блокирует очередь обновлений", (getDb) => {
  it("команда без номера отвечает подсказкой вместо 500 (postgres.js UNDEFINED_VALUE)", async () => {
    const deps: RegistryDeps = { db: getDb(), audit: new SqlAuditRepo() };
    for (const command of ["/request", "/say", "/rate"]) {
      await expect(requestStep(deps, EXECUTOR, command)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        message: expect.stringContaining("Укажите номер обращения"),
      });
    }
  });

  it("энд-то-энд: /request без номера обрабатывается с вежливым ответом, status='processed'", async () => {
    const db = getDb();
    const deps: RegistryDeps = { db, audit: new SqlAuditRepo() };
    const updateId = 910000000001;
    await expect(
      processInbound(deps, privateUpdate(updateId, SEED.testExecutorTelegramId, "/request")),
    ).resolves.toBe(true);
    const [row] = await db.query<{ status: string; error: string | null }>(
      "select status,error from bot_inbound where update_id=$1",
      [updateId],
    );
    expect(row!.status).toBe("processed");
    expect(row!.error).toBeNull();
    const [reply] = await db.query<{ text: string; channel: string }>(
      "select text,channel from notification where dedup_key=$1",
      [`update:${updateId}:reply`],
    );
    expect(reply!.text).toContain("Укажите номер обращения");
    // тестовая персона — канал simulator, наружу не отправляется
    expect(reply!.channel).toBe("simulator");
  });

  it("неожиданная ошибка сценария: status='error', извинение жителю, повтор доставки игнорируется", async () => {
    const db = getDb();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const updateId = 910000000002;
    try {
      await expect(
        processInbound(
          depsWithPoisonedDialogSelect(db),
          privateUpdate(updateId, SEED.testExecutorTelegramId, "/help"),
        ),
      ).resolves.toBe(true);
      const [row] = await db.query<{ status: string; error: string | null }>(
        "select status,error from bot_inbound where update_id=$1",
        [updateId],
      );
      expect(row!.status).toBe("error");
      expect(row!.error).toContain("имитация сбоя сценария");
      const [reply] = await db.query<{ text: string }>(
        "select text from notification where dedup_key=$1",
        [`update:${updateId}:reply`],
      );
      expect(reply!.text).toContain("Не удалось обработать сообщение");
      expect(errorSpy).toHaveBeenCalled();
      // идемпотентность (REQ-05): повторная доставка не обрабатывается снова
      await expect(
        processInbound(
          depsWithPoisonedDialogSelect(db),
          privateUpdate(updateId, SEED.testExecutorTelegramId, "/help"),
        ),
      ).resolves.toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
