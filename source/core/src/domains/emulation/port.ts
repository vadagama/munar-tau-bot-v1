// Порт эмуляции (пилот, HLD 10.8): тестовые персоны (is_test) и сеансы
// эмуляции. Реализации: SQL — repo.ts, in-memory — core/src/testing/memory.ts.

import type { DbExecutor } from "../../db/client.ts";
import type { PersonRecord, ProfileRecord } from "../admin/port.ts";

/** Тестовая персона: персона + действующий профиль. */
export interface TestPersonRecord {
  person: PersonRecord;
  profile: ProfileRecord;
}

/** Сеанс эмуляции (LLD-02 §13): не более одного активного на техадмина. */
export interface EmulationSessionRecord {
  id: string;
  techAdminProfileId: string;
  emulatedProfileId: string;
  startedAt: string;
  endedAt: string | null;
  state: "active" | "ended";
}

export interface EmulationRepo {
  listTestPersons(exec: DbExecutor): Promise<TestPersonRecord[]>;
  /** Создаёт персону is_test с синтетическими telegram/телефоном (миграция 0003). */
  createTestPerson(exec: DbExecutor, input: { fullName: string }): Promise<TestPersonRecord>;
  getActiveSessionByTechProfile(
    exec: DbExecutor,
    techAdminProfileId: string,
  ): Promise<EmulationSessionRecord | null>;
  getSession(exec: DbExecutor, sessionId: string): Promise<EmulationSessionRecord | null>;
  startSession(
    exec: DbExecutor,
    input: { techAdminProfileId: string; emulatedProfileId: string },
    now: Date,
  ): Promise<EmulationSessionRecord>;
  /** Завершает активный сеанс; null — не найден или уже завершён. */
  endSession(exec: DbExecutor, sessionId: string, now: Date): Promise<EmulationSessionRecord | null>;
}
