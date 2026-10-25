// SQL-реализация порта assistant (LLD-01 §3.6): postgres.js через DbExecutor,
// prepare: false. Доступ только из серверных функций (service_role, RLS-заслон
// в миграции). День/месяц расхода считает PostgreSQL по Asia/Almaty —
// единая граница суток для всех изолятов.

import type { DbExecutor } from "../../db/client.ts";
import type {
  AssistantRepo,
  AssistantSettingsPatch,
  AssistantSettingsRecord,
  AssistantStaffConfigRow,
  AssistantUsageInput,
  AssistantUsageSummary,
  AssistantUserConfigInput,
  AssistantUserConfigRecord,
} from "./port.ts";

interface SettingsSqlRow {
  provider: string;
  base_url: string;
  model_id: string;
  api_key_encrypted: string | null;
  api_key_mask: string | null;
  version: number;
  updated_at: string;
}

function settingsFromSql(row: SettingsSqlRow): AssistantSettingsRecord {
  return {
    provider: row.provider,
    baseUrl: row.base_url,
    modelId: row.model_id,
    apiKeyEncrypted: row.api_key_encrypted,
    apiKeyMask: row.api_key_mask,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

interface ConfigSqlRow {
  profile_id: string;
  enabled: boolean;
  daily_token_limit: number;
  monthly_token_limit: number;
  version: number;
  updated_at: string;
}

function configFromSql(row: ConfigSqlRow): AssistantUserConfigRecord {
  return {
    profileId: row.profile_id,
    enabled: row.enabled,
    dailyTokenLimit: row.daily_token_limit,
    monthlyTokenLimit: row.monthly_token_limit,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export class SqlAssistantRepo implements AssistantRepo {
  public async getSettings(exec: DbExecutor): Promise<AssistantSettingsRecord | null> {
    const [row] = await exec.query<SettingsSqlRow>(
      "select provider,base_url,model_id,api_key_encrypted,api_key_mask,version,updated_at from assistant_settings where id=1",
    );
    return row ? settingsFromSql(row) : null;
  }

  public async updateSettings(
    exec: DbExecutor,
    patch: AssistantSettingsPatch,
    expectedVersion: number,
  ): Promise<AssistantSettingsRecord | null> {
    const [row] = await exec.query<SettingsSqlRow>(
      `update assistant_settings set
        provider = coalesce($1, provider),
        base_url = coalesce($2, base_url),
        model_id = coalesce($3, model_id),
        api_key_encrypted = coalesce($4, api_key_encrypted),
        api_key_mask = coalesce($5, api_key_mask),
        version = version + 1,
        updated_at = now()
      where id = 1 and version = $6
      returning provider,base_url,model_id,api_key_encrypted,api_key_mask,version,updated_at`,
      [
        patch.provider ?? null,
        patch.baseUrl ?? null,
        patch.modelId ?? null,
        patch.apiKeyEncrypted ?? null,
        patch.apiKeyMask ?? null,
        expectedVersion,
      ],
    );
    return row ? settingsFromSql(row) : null;
  }

  public async listStaffConfigs(
    exec: DbExecutor,
    isTest: boolean,
  ): Promise<AssistantStaffConfigRow[]> {
    const rows = await exec.query<{
      person_id: string;
      profile_id: string | null;
      full_name: string;
      roles: string[] | null;
      telegram_username: string | null;
      enabled: boolean | null;
      daily_token_limit: number | null;
      monthly_token_limit: number | null;
      config_version: number | null;
    }>(
      `select p.id as person_id,
        (select pr.id from profile pr where pr.person_id = p.id and pr.archived_at is null order by pr.id desc limit 1) as profile_id,
        p.full_name,
        coalesce((select array_agg(distinct sa.role::text) from staff_assignment sa
          where sa.person_id = p.id and sa.status = 'active'
            and (sa.valid_from is null or sa.valid_from <= now())
            and (sa.valid_until is null or sa.valid_until > now())), array[]::text[]) as roles,
        (select pr.telegram_username from profile pr where pr.person_id = p.id and pr.archived_at is null order by pr.id desc limit 1) as telegram_username,
        c.enabled, c.daily_token_limit, c.monthly_token_limit, c.version as config_version
      from person p
      left join assistant_user_config c
        on c.profile_id = (select pr.id from profile pr where pr.person_id = p.id and pr.archived_at is null order by pr.id desc limit 1)
      where p.is_test = $1 and p.status = 'active'
      order by p.full_name, p.id limit 1000`,
      [isTest],
    );
    return rows.map((row) => ({
      personId: row.person_id,
      profileId: row.profile_id,
      fullName: row.full_name,
      roles: row.roles ?? [],
      telegramUsername: row.telegram_username,
      enabled: row.enabled ?? false,
      dailyTokenLimit: row.daily_token_limit ?? 0,
      monthlyTokenLimit: row.monthly_token_limit ?? 0,
      version: row.config_version,
    }));
  }

  public async getUserConfig(
    exec: DbExecutor,
    profileId: string,
  ): Promise<AssistantUserConfigRecord | null> {
    const [row] = await exec.query<ConfigSqlRow>(
      "select profile_id,enabled,daily_token_limit,monthly_token_limit,version,updated_at from assistant_user_config where profile_id=$1",
      [profileId],
    );
    return row ? configFromSql(row) : null;
  }

  public async upsertUserConfig(
    exec: DbExecutor,
    input: AssistantUserConfigInput,
    expectedVersion: number | null,
  ): Promise<AssistantUserConfigRecord | null> {
    if (expectedVersion === null) {
      const [row] = await exec.query<ConfigSqlRow>(
        `insert into assistant_user_config(profile_id,enabled,daily_token_limit,monthly_token_limit)
        values ($1,$2,$3,$4)
        on conflict (profile_id) do nothing
        returning profile_id,enabled,daily_token_limit,monthly_token_limit,version,updated_at`,
        [input.profileId, input.enabled, input.dailyTokenLimit, input.monthlyTokenLimit],
      );
      return row ? configFromSql(row) : null;
    }
    const [row] = await exec.query<ConfigSqlRow>(
      `update assistant_user_config set
        enabled = $2, daily_token_limit = $3, monthly_token_limit = $4,
        version = version + 1, updated_at = now()
      where profile_id = $1 and version = $5
      returning profile_id,enabled,daily_token_limit,monthly_token_limit,version,updated_at`,
      [
        input.profileId,
        input.enabled,
        input.dailyTokenLimit,
        input.monthlyTokenLimit,
        expectedVersion,
      ],
    );
    return row ? configFromSql(row) : null;
  }

  public async insertUsage(exec: DbExecutor, input: AssistantUsageInput): Promise<boolean> {
    const [row] = await exec.query<{ id: string }>(
      `insert into assistant_usage_ledger(profile_id,operation_id,prompt_tokens,completion_tokens,usage_day,usage_month)
      values ($1,$2,$3,$4,(now() at time zone 'Asia/Almaty')::date,(date_trunc('month', now() at time zone 'Asia/Almaty'))::date)
      on conflict (operation_id) do nothing returning id`,
      [input.profileId, input.operationId, input.promptTokens, input.completionTokens],
    );
    return row !== undefined;
  }

  public async sumUsage(
    exec: DbExecutor,
    profileId: string,
  ): Promise<AssistantUsageSummary> {
    const [row] = await exec.query<{
      day: string;
      month: string;
      day_tokens: number;
      month_tokens: number;
    }>(
      `select
        to_char((now() at time zone 'Asia/Almaty')::date, 'YYYY-MM-DD') as day,
        to_char(date_trunc('month', now() at time zone 'Asia/Almaty'), 'YYYY-MM') as month,
        coalesce(sum(prompt_tokens + completion_tokens) filter (
          where usage_day = (now() at time zone 'Asia/Almaty')::date), 0)::int as day_tokens,
        coalesce(sum(prompt_tokens + completion_tokens) filter (
          where usage_month = (date_trunc('month', now() at time zone 'Asia/Almaty'))::date), 0)::int as month_tokens
      from assistant_usage_ledger where profile_id = $1`,
      [profileId],
    );
    return {
      day: row?.day ?? "",
      month: row?.month ?? "",
      dayTokens: row?.day_tokens ?? 0,
      monthTokens: row?.month_tokens ?? 0,
    };
  }
}
