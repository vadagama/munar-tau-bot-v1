import type { RegistryDeps } from "../registry/service.ts";
import { notifyPerson } from "../registrations/notifications.ts";
import { templateNotice } from "../../templates/notice.ts";
import { fmtDate } from "../../bot/text.ts";
import type { Obligation } from "./obligations.ts";

/** Ограниченная порция; отправка outbox и отметки фиксируются одной транзакцией. */
export async function sweepDocumentObligations(deps: RegistryDeps, deadline = Date.now() + 30000): Promise<number> {
  let processed = 0;
  const visited: string[] = [];
  for (let i = 0; i < 20 && Date.now() + 1000 < deadline; i++) {
    const found = await deps.db.transaction(async exec => {
      const [row] = await exec.query<Obligation>(`select * from document_obligation where completed_at is null and due_at<=now()
        and (reminded_at is null or escalated_at is null) and id<>all($1::uuid[]) order by due_at,id for update skip locked limit 1`, [visited]);
      if (!row) return false;
      const options = { isTest: row.is_test, taskId: row.task_id ?? undefined, requestId: row.request_id ?? undefined, bot: "worker" as const, important: true };
      const notice = templateNotice("notices.documents.obligation", { due_at: fmtDate(row.due_at) });
      if (!row.reminded_at) {
        await notifyPerson(exec, row.prepared_by, notice, `document-obligation:${row.id}:${row.version}:overdue`, options);
        await exec.query("update document_obligation set reminded_at=now() where id=$1", [row.id]);
      }
      if (!row.escalated_at) {
        const chairs = await exec.query<{ id: string }>(`select distinct p.id from person p join staff_assignment a on a.person_id=p.id
          where p.status='active' and p.is_test=$1 and a.role='chairman' and a.status='active'
          and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())`, [row.is_test]);
        for (const chair of chairs) await notifyPerson(exec, chair.id, notice, `document-obligation:${row.id}:${row.version}:escalate:${chair.id}`, options);
        if (chairs.length) await exec.query("update document_obligation set escalated_at=now() where id=$1", [row.id]);
      }
      visited.push(row.id);
      return true;
    });
    if (!found) break;
    processed++;
  }
  return processed;
}
