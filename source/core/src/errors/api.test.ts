import { describe, expect, it } from "vitest";

import { ApiError, toErrorResponse } from "./api.ts";

describe("ApiError", () => {
  it.each([
    ["UNAUTHENTICATED", 401],
    ["NO_PROFILE", 401],
    ["SESSION_EXPIRED", 401],
    ["FORBIDDEN", 403],
    ["PRIVILEGED_REQUIRED", 403],
    ["NOT_FOUND", 404],
    ["VALIDATION_FAILED", 400],
    ["INVALID_TRANSITION", 409],
    ["CONCURRENT_MODIFICATION", 409],
    ["IDEMPOTENCY_CONFLICT", 409],
    ["FILE_LIMIT", 413],
    ["RULE_LEGAL_BOUNDARY", 422],
    ["RATE_LIMITED", 429],
    ["INTERNAL", 500],
  ] as const)("%s → %i", (code, status) => {
    const error = new ApiError(code);
    expect(error.status).toBe(status);
  });

  it("тело ошибки совпадает с контрактом LLD-03 §1.1", () => {
    const error = new ApiError(
      "INVALID_TRANSITION",
      "Недопустимый переход для текущего состояния",
      { current_state: "in_work", allowed: ["on_review"] },
      "01J-trace",
    );
    expect(error.toBody()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "Недопустимый переход для текущего состояния",
        details: { current_state: "in_work", allowed: ["on_review"] },
        trace_id: "01J-trace",
      },
    });
  });

  it("без details поле details в тело не попадает", () => {
    const body = new ApiError("NOT_FOUND").toBody();
    expect(body.error.code).toBe("NOT_FOUND");
    expect("details" in body.error).toBe(false);
  });

  it("trace_id генерируется, если не передан", () => {
    const body = new ApiError("FORBIDDEN").toBody();
    expect(body.error.trace_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("toErrorResponse", () => {
  it("ApiError сохраняет код, статус и details", () => {
    const { status, body } = toErrorResponse(new ApiError("RATE_LIMITED"));
    expect(status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it.each([
    ["строка-ошибка"],
    [new Error("boom")],
    [undefined],
    [{ unexpected: true }],
  ])("неизвестная ошибка (%p) → 500 INTERNAL без деталей", (cause) => {
    const { status, body } = toErrorResponse(cause);
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect("details" in body.error).toBe(false);
    // Сообщение фиксированное — причина не утекает в ответ
    expect(body.error.message).not.toContain("boom");
  });
});
