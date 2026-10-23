import type { RegistryDeps } from "../registry/service.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { pollRow, serverClock } from "./access.ts";
import { aggregatePoll } from "./aggregate.ts";
import { persistExclusions } from "./jobs.ts";

/** Ротация порций по отдельному checkpoint не меняет версию личной формы. */
export async function reconcileOpenPolls(deps: RegistryDeps, deadline = Date.now() + 30000): Promise<number> {
  if (Date.now() >= deadline) return 0;
  const rows = await deps.db.query<{id:string}>(`select p.id from poll p
    left join poll_reconciliation r on r.poll_id=p.id
    where p.state='open' and p.closes_at>clock_timestamp()
    order by r.checked_at nulls first,p.created_at,p.id limit 10`);
  let processed = 0;
  for (const { id } of rows) {
    if (Date.now() + 1000 >= deadline) break;
    const changed = await deps.db.transaction(async exec => {
      await lockAudience(exec);
      if (Date.now() >= deadline) return false;
      const row = await pollRow(exec, id, true), clock = await serverClock(exec);
      if (row.state !== "open" || clock.us >= Number(row.closes_us)) return false;
      const result = await aggregatePoll(exec, row, clock.us);
      await persistExclusions(exec, id, result.excluded);
      await exec.query(`insert into poll_reconciliation(poll_id,checked_at) values($1,$2)
        on conflict(poll_id) do update set checked_at=excluded.checked_at`, [id, clock.at]);
      return true;
    });
    if (changed) processed++;
  }
  return processed;
}
