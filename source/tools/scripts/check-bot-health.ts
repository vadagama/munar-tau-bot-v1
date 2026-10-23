// Проверка здоровья ботов ОСИ (ADR-009): Telegram-вебхуки, очередь уведомлений,
// ошибки входящих обновлений. Только чтение. Замена недоступным логам Edge
// Functions: упавшее обновление остаётся в bot_inbound со status='error'
// (см. bot-webhook/index.ts) — здесь оно и видно.
//
// Из source/: deno run --env-file=.env.local --allow-env --allow-net tools/scripts/check-bot-health.ts
//
// Требует токены обоих ботов; секция БД (SUPABASE_PROJECT_ID +
// SUPABASE_ACCESS_TOKEN) — опциональна, без них проверяется только Telegram.
// Код выхода 1 — есть проблемы (для cron/CI), 0 — здоровы.

import {
  botTokenEnv,
  type BotKind,
} from "../../core/src/bot/bots.ts";

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
}

const BOTS: { kind: BotKind; label: string }[] = [
  { kind: "resident", label: "бот жителей" },
  { kind: "worker", label: "бот сотрудников" },
];

/** Ошибка считается активной, только если моложе этого возраста (мс). */
const ACTIVE_ERROR_MS = 10 * 60 * 1000;
/** Ошибки входящих обновлений за последние N часов. */
const INBOUND_ERROR_HOURS = 24;
/** Порог очереди на проблемную. */
const QUEUE_ALERT = 50;

let problems = 0;
const flag = (message: string) => {
  console.error(`  ⚠ ${message}`);
  problems++;
};

for (const bot of BOTS) {
  const tokenEnv = botTokenEnv(bot.kind);
  const token = Deno.env.get(tokenEnv);
  if (!token) {
    console.warn(`[пропуск] ${bot.label}: ${tokenEnv} не задан`);
    continue;
  }
  const call = async (method: string) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`);
    return (await response.json()) as {
      ok: boolean;
      result?: WebhookInfo & { username?: string };
      description?: string;
    };
  };
  console.log(`=== ${bot.label} ===`);
  const me = await call("getMe");
  if (!me.ok) {
    flag(`getMe: ${me.description}`);
    continue;
  }
  const info = (await call("getWebhookInfo")).result;
  if (!info) {
    flag("getWebhookInfo: пустой результат");
    continue;
  }
  console.log(
    `  @${me.result?.username} | pending: ${info.pending_update_count ?? 0} | allowed: ${
      (info.allowed_updates ?? []).join(",")
    }`,
  );
  console.log(`  url: ${info.url ?? "—"}`);
  if (!info.url) flag("webhook не установлен");
  const pending = info.pending_update_count ?? 0;
  const errorAge = info.last_error_date
    ? Date.now() - info.last_error_date * 1000
    : Infinity;
  // Telegram помнит последнюю ошибку ретраев неделями — признак активной
  // проблемы: застрявшие обновления либо ошибка моложе ACTIVE_ERROR_MS.
  if (pending > 0) {
    flag(
      `застряли обновления: ${pending}${
        info.last_error_message ? ` (${info.last_error_message})` : ""
      }`,
    );
  } else if (info.last_error_message && errorAge < ACTIVE_ERROR_MS) {
    flag(
      `свежая ошибка (${Math.round(errorAge / 60000)} мин назад): ${info.last_error_message}`,
    );
  }
}

// ── БД: очередь уведомлений и ошибки входящих ──────────────────────────────

const ref = Deno.env.get("SUPABASE_PROJECT_ID");
const access = Deno.env.get("SUPABASE_ACCESS_TOKEN");
if (!ref || !access) {
  console.warn("[пропуск] БД: SUPABASE_PROJECT_ID/SUPABASE_ACCESS_TOKEN не заданы");
} else {
  const query = async (sql: string): Promise<string> => {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/database/query`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      },
    );
    return await response.text();
  };

  console.log("=== Очередь уведомлений ===");
  try {
    const states = JSON.parse(await query(
      "select bot, state, count(*) as n from notification where state in ('queued','sending','failed') and next_attempt_at<=now()+interval '1 hour' group by bot, state order by bot, state",
    )) as { bot: string; state: string; n: number }[];
    if (!states.length) console.log("  пусто");
    for (const row of states) {
      console.log(`  ${row.bot}/${row.state}: ${row.n}`);
      if (row.state === "queued" && row.n > QUEUE_ALERT) {
        flag(`очередь ${row.bot}: ${row.n} (> ${QUEUE_ALERT})`);
      }
    }
  } catch (error) {
    flag(`очередь недоступна: ${(error as Error).message}`);
  }

  console.log(
    `=== Ошибки входящих обновлений (bot_inbound, ${INBOUND_ERROR_HOURS} ч) ===`,
  );
  try {
    const errors = JSON.parse(await query(
      `select bot, update_id, left(coalesce(error,''),120) as error, received_at
       from bot_inbound
       where status='error' and received_at>now()-interval '${INBOUND_ERROR_HOURS} hours'
       order by received_at desc limit 10`,
    )) as { bot: string; update_id: number; error: string; received_at: string }[];
    if (!errors.length) console.log("  пусто");
    for (const row of errors) {
      console.log(`  ${row.bot} #${row.update_id} ${row.received_at}: ${row.error}`);
    }
    const latest = errors[0];
    if (
      latest &&
      Date.now() - new Date(latest.received_at).getTime() < ACTIVE_ERROR_MS
    ) {
      flag(`свежая ошибка обработки: ${latest.error}`);
    }
  } catch (error) {
    flag(`bot_inbound недоступен: ${(error as Error).message}`);
  }

  // Анкеты в ожидании, у этапа которых нет ни одного доступного решателя
  // (роль этапа либо председатель/техадмин того же мира is_test) — они висят
  // бессрочно: в кабинете их никто не увидит, заявителю бот молчит (REG-14).
  // Упрощение: доменная область (scope_building_ids) не учитывается.
  console.log("=== Очередь регистрации ===");
  try {
    const stages = JSON.parse(await query(
      `select r.is_test, r.review_stage, count(*) as n, min(r.created_at) as oldest,
        (select count(distinct a.person_id) from staff_assignment a join person p on p.id=a.person_id
         where a.status='active' and p.status='active' and p.is_test=r.is_test
           and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())
           and (a.role::text=r.review_stage or a.role::text in ('chairman','tech_admin'))) as reviewers
       from registration r
       where r.superseded_by is null and r.state in ('pending_review','need_clarification','disputed')
         and r.review_stage in ('administrator','deputy','chairman')
       group by r.is_test, r.review_stage order by r.is_test, r.review_stage`,
    )) as {
      is_test: boolean;
      review_stage: string;
      n: number;
      oldest: string;
      reviewers: number;
    }[];
    if (!stages.length) console.log("  пусто");
    for (const row of stages) {
      const age = Math.round((Date.now() - new Date(row.oldest).getTime()) / 3600000);
      console.log(
        `  ${row.review_stage} (is_test=${row.is_test}): ${row.n} анкет, решателей ${row.reviewers}, старейшая ${age} ч`,
      );
      if (row.reviewers === 0) {
        flag(
          `этап ${row.review_stage} (is_test=${row.is_test}): ${row.n} анкет без решателей — назначьте активную роль (administrator/deputy/chairman)`,
        );
      }
    }
  } catch (error) {
    flag(`очередь регистрации недоступна: ${(error as Error).message}`);
  }
}

console.log(problems ? `\nИТОГ: проблем — ${problems}` : "\nИТОГ: здоровы");
Deno.exit(problems ? 1 : 0);
