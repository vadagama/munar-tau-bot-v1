import type { DbExecutor } from "../../db/client.ts";

/** ADR-019: call first in a root transaction that can change eligibility.
 * A nested domain must reuse the executor; acquiring after row locks can deadlock. */
export async function lockAudience(exec: DbExecutor): Promise<void> {
  await exec.query("select public.audience_clock()");
}
