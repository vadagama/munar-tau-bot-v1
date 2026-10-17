import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
/** Общий счётчик PostgreSQL: одинаковый предел для всех изолятов Edge API. */
export async function consumeRateLimit(
  exec: DbExecutor,
  profileId: string,
): Promise<void> {
  const rows = await exec.query(
    `insert into api_rate_limit(profile_id,window_at,count) values ($1,date_trunc('minute',now()),1)
 on conflict(profile_id) do update set
 count=case when api_rate_limit.window_at<date_trunc('minute',now()) then 1 else api_rate_limit.count+1 end,
 window_at=date_trunc('minute',now())
 where api_rate_limit.window_at<date_trunc('minute',now()) or api_rate_limit.count<100 returning count`,
    [profileId],
  );
  if (!rows.length) throw new ApiError("RATE_LIMITED");
}
