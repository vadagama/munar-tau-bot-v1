// In-memory фейк репозитория assistant: повторяет контракт порта — версии,
// append-only ledger с уникальностью operation_id, границы дня/месяца по
// Asia/Almaty. Состояние открыто тестам для подготовки.

import type { DbExecutor } from "../db/client.ts";
import type {
  AssistantRepo,
  AssistantSettingsPatch,
  AssistantSettingsRecord,
  AssistantStaffConfigRow,
  AssistantUsageGranularity,
  AssistantUsageHistoryRow,
  AssistantUsageInput,
  AssistantUsageSummary,
  AssistantUserConfigInput,
  AssistantUserConfigRecord,
} from "../domains/assistant/port.ts";

/** Дата YYYY-MM-DD по Asia/Almaty (локаль sv-SE даёт ISO-порядок). */
export function almatyDate(at: Date): string {
  return at.toLocaleDateString("sv-SE", { timeZone: "Asia/Almaty" });
}

interface UsageRow extends AssistantUsageInput {
  day: string;
  month: string;
}

/** Фейк домена assistant. */
export class MemoryAssistantRepo implements AssistantRepo {
  public settings: AssistantSettingsRecord | null = {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-chat",
    apiKeyEncrypted: null,
    apiKeyMask: null,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  public readonly configs = new Map<string, AssistantUserConfigRecord>();
  /** Фикстура сотрудников для listStaffConfigs (в SQL — join person/profile/assignment). */
  public readonly staff: Array<AssistantStaffConfigRow & { isTest: boolean }> = [];
  public readonly usage: UsageRow[] = [];

  public async getSettings(_exec: DbExecutor): Promise<AssistantSettingsRecord | null> {
    return this.settings ? { ...this.settings } : null;
  }

  public async updateSettings(
    _exec: DbExecutor,
    patch: AssistantSettingsPatch,
    expectedVersion: number,
  ): Promise<AssistantSettingsRecord | null> {
    const current = this.settings;
    if (!current || current.version !== expectedVersion) return null;
    const next: AssistantSettingsRecord = {
      ...current,
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
      ...(patch.modelId !== undefined ? { modelId: patch.modelId } : {}),
      ...(patch.apiKeyEncrypted !== undefined
        ? { apiKeyEncrypted: patch.apiKeyEncrypted }
        : {}),
      ...(patch.apiKeyMask !== undefined ? { apiKeyMask: patch.apiKeyMask } : {}),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.settings = next;
    return { ...next };
  }

  public async listStaffConfigs(
    _exec: DbExecutor,
    isTest: boolean,
  ): Promise<AssistantStaffConfigRow[]> {
    return this.staff
      .filter((row) => row.isTest === isTest)
      .map((row) => ({ ...row }));
  }

  public async getUserConfig(
    _exec: DbExecutor,
    profileId: string,
  ): Promise<AssistantUserConfigRecord | null> {
    const config = this.configs.get(profileId);
    return config ? { ...config } : null;
  }

  public async upsertUserConfig(
    _exec: DbExecutor,
    input: AssistantUserConfigInput,
    expectedVersion: number | null,
  ): Promise<AssistantUserConfigRecord | null> {
    const existing = this.configs.get(input.profileId);
    if (expectedVersion === null) {
      if (existing) return null;
      const created: AssistantUserConfigRecord = {
        ...input,
        epoch: 1,
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      this.configs.set(input.profileId, created);
      return { ...created };
    }
    if (!existing || existing.version !== expectedVersion) return null;
    const updated: AssistantUserConfigRecord = {
      ...existing,
      ...input,
      // Эпоху PUT конфига не меняет — только bumpUserConfigEpoch.
      epoch: existing.epoch,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.configs.set(input.profileId, updated);
    return { ...updated };
  }

  public async bumpUserConfigEpoch(_exec: DbExecutor, profileId: string): Promise<number | null> {
    const config = this.configs.get(profileId);
    if (!config) return null;
    const utcDay = Math.floor(new Date().getTime() / 86_400_000);
    const next: AssistantUserConfigRecord = {
      ...config,
      epoch: Math.max(config.epoch, utcDay) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.configs.set(profileId, next);
    return next.epoch;
  }

  public async insertUsage(_exec: DbExecutor, input: AssistantUsageInput): Promise<boolean> {
    if (this.usage.some((row) => row.operationId === input.operationId)) return false;
    const now = new Date();
    this.usage.push({
      ...input,
      day: almatyDate(now),
      month: almatyDate(now).slice(0, 7),
    });
    return true;
  }

  public async sumUsage(_exec: DbExecutor, profileId: string): Promise<AssistantUsageSummary> {
    const now = almatyDate(new Date());
    const month = now.slice(0, 7);
    const rows = this.usage.filter((row) => row.profileId === profileId);
    return {
      day: now,
      month,
      dayTokens: rows
        .filter((row) => row.day === now)
        .reduce((sum, row) => sum + row.promptTokens + row.completionTokens, 0),
      monthTokens: rows
        .filter((row) => row.day.startsWith(month))
        .reduce((sum, row) => sum + row.promptTokens + row.completionTokens, 0),
    };
  }

  public async listUsageHistory(
    _exec: DbExecutor,
    profileId: string,
    granularity: AssistantUsageGranularity,
    limit: number,
  ): Promise<AssistantUsageHistoryRow[]> {
    // Свёртка по колонке ledger: день — usage_day, месяц — префикс YYYY-MM.
    const sums = new Map<string, { promptTokens: number; completionTokens: number }>();
    for (const row of this.usage) {
      if (row.profileId !== profileId) continue;
      const period = granularity === "month" ? row.month : row.day;
      const bucket = sums.get(period) ?? { promptTokens: 0, completionTokens: 0 };
      bucket.promptTokens += row.promptTokens;
      bucket.completionTokens += row.completionTokens;
      sums.set(period, bucket);
    }
    return [...sums.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .slice(0, limit)
      .map(([period, bucket]) => ({
        period,
        promptTokens: bucket.promptTokens,
        completionTokens: bucket.completionTokens,
        totalTokens: bucket.promptTokens + bucket.completionTokens,
      }));
  }
}
