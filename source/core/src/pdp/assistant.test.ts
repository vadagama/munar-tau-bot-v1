// Матрица доступа assistant.* (ADR-021): privileged — вне эмуляции целиком;
// use — chairman/administrator; настройки — chairman/tech_admin; свой расход —
// allowOwn, чужой — chairman/tech_admin.

import { describe, expect, it } from "vitest";
import { can } from "./evaluate.ts";
import { makeTestActor } from "../testing/actors.ts";

const emulated = (actor: ReturnType<typeof makeTestActor>) => ({
  ...actor,
  emulation: {
    sessionId: "s-emu",
    realPersonId: "real-person",
    realProfileId: "real-profile",
  },
});

describe("PDP: действия assistant", () => {
  it("председатель: use, настройки и чужой расход разрешены", () => {
    const chair = makeTestActor("chairman", []);
    expect(can(chair, "assistant.use").allow).toBe(true);
    expect(can(chair, "assistant.settings.read").allow).toBe(true);
    expect(can(chair, "assistant.settings.edit").allow).toBe(true);
    expect(can(chair, "assistant.usage.read").allow).toBe(true);
  });

  it("техадмин: настройки и чужой расход, но не use", () => {
    const tech = makeTestActor("tech_admin", []);
    expect(can(tech, "assistant.use").allow).toBe(false);
    expect(can(tech, "assistant.settings.read").allow).toBe(true);
    expect(can(tech, "assistant.settings.edit").allow).toBe(true);
    expect(can(tech, "assistant.usage.read").allow).toBe(true);
  });

  it("администратор: use, свой расход; настройки и чужой расход — нет", () => {
    const admin = makeTestActor("administrator", []);
    expect(can(admin, "assistant.use").allow).toBe(true);
    expect(can(admin, "assistant.settings.read").allow).toBe(false);
    expect(can(admin, "assistant.settings.edit").allow).toBe(false);
    expect(
      can(admin, "assistant.usage.read", { profileId: admin.profile.id }).allow,
    ).toBe(true);
    expect(can(admin, "assistant.usage.read", { profileId: "other" }).allow).toBe(false);
  });

  it("остальные роли: use и настройки запрещены", () => {
    for (const role of ["deputy", "duty", "finance", "executor", "doc_reviewer"] as const) {
      const actor = makeTestActor(role, []);
      expect(can(actor, "assistant.use").allow, role).toBe(false);
      expect(can(actor, "assistant.settings.read").allow, role).toBe(false);
      expect(
        can(actor, "assistant.usage.read", { profileId: actor.profile.id }).allow,
        role,
      ).toBe(true);
    }
  });

  it("в эмуляции все assistant.* запрещены (условие 3 ADR)", () => {
    const chair = emulated(makeTestActor("chairman", []));
    expect(can(chair, "assistant.use").allow).toBe(false);
    expect(can(chair, "assistant.settings.read").allow).toBe(false);
    expect(can(chair, "assistant.settings.edit").allow).toBe(false);
    expect(
      can(chair, "assistant.usage.read", { profileId: chair.profile.id }).allow,
    ).toBe(false);
  });
});
