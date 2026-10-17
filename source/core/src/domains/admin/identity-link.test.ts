import { expect, it } from "vitest";
import { findProfileForAuth } from "./actor-service.ts";
import { MemoryAdminRepo, MemoryDb } from "../../testing/memory.ts";
const verifiedProfile = {
  id: "profile",
  personId: "person",
  telegramUserId: "123",
  supabaseUserId: "auth",
  language: "ru" as const,
  isTest: false,
  archivedAt: null,
};
it("связывает существующий профиль только после серверной проверки identity", async () => {
  const repo = Object.assign(new MemoryAdminRepo(), {
    linkProfileFromVerifiedIdentity: () => Promise.resolve(verifiedProfile),
  });
  expect(await findProfileForAuth(repo, new MemoryDb(), "auth")).toBe(
    verifiedProfile,
  );
});
it("не создаёт профиль при отсутствии проверенного Telegram identity", async () => {
  const repo = Object.assign(new MemoryAdminRepo(), {
    linkProfileFromVerifiedIdentity: () => Promise.resolve(null),
  });
  await expect(
    findProfileForAuth(repo, new MemoryDb(), "auth"),
  ).rejects.toMatchObject({ code: "NO_PROFILE" });
});
