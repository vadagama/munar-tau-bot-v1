import type { RegistryDeps } from "../registry/service.ts";
import { recipientActor } from "../notifications/service.ts";
import {
  broadcastPublication,
  type Publication,
  publicationLog,
  releaseChecks,
  requirePublication,
} from "./service.ts";
export async function publishScheduled(
  deps: RegistryDeps,
  deadline = Date.now() + 10000,
) {
  let count = 0;
  const rows = await deps.db.query<{ id: string }>(
    "select id from publication where state='scheduled' and publish_at<=now() order by publish_at limit 20",
  );
  for (const item of rows) {
    if (Date.now() >= deadline) break;
    await deps.db.transaction(async (exec) => {
      const [row] = await exec.query<Publication>(
        "select * from publication where id=$1 and state='scheduled' for update",
        [item.id],
      );
      if (!row) return;
      const actor = await recipientActor(exec, row.created_by);
      try {
        if (!actor) throw new Error("AUTHOR_UNAVAILABLE");
        await requirePublication(exec, actor, row.id, "publication.manage");
        await releaseChecks(exec, row);
      } catch {
        // Отозванные полномочия/изменённый комплект не обходятся планировщиком.
        await exec.query(
          "update publication set state='draft',publish_at=null,version=version+1 where id=$1",
          [row.id],
        );
        await exec.query(
          "insert into publication_log(publication_id,action,version,snapshot) values($1,'schedule_blocked',$2,$3::text::jsonb)",
          [
            row.id,
            row.version + 1,
            JSON.stringify({ reason: "RELEASE_CONDITIONS_CHANGED" }),
          ],
        );
        return;
      }
      const [updated] = await exec.query<Publication>(
        "update publication set state='published',published_at=now(),version=version+1 where id=$1 returning *",
        [row.id],
      );
      const { scope } = await requirePublication(
        exec,
        actor!,
        row.id,
        "publication.manage",
      );
      await publicationLog(
        deps,
        exec,
        actor!,
        updated!,
        scope.map((s) => s.building_id),
        "published",
      );
      await broadcastPublication(exec, updated!);
      count++;
    });
  }
  return count;
}
