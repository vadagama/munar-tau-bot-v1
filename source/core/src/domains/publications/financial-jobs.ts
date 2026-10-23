import type { RegistryDeps } from "../registry/service.ts";
import { notifyPerson } from "../registrations/notifications.ts";
import { templateNotice } from "../../templates/notice.ts";
import { fmtDate } from "../../bot/text.ts";
import type { FinancialObligation } from "./financial-obligations.ts";

/** Ошибка текущего выпущенного комплекта открывает ту же обязанность с прежним сроком. */
export async function reopenFinancialObligations(deps: RegistryDeps, deadline = Date.now() + 30000) {
  let count = 0;
  for (let i = 0; i < 20 && Date.now() + 1000 < deadline; i++) {
    const changed = await deps.db.transaction(async exec => {
      const [publication] = await exec.query<{ id: string }>(`select p.id from publication p where exists (
        select 1 from financial_obligation o join financial_package_document part on part.financial_version_id=o.active_version_id
        join document_version v on v.id=part.document_version_id where o.publication_id=p.id and v.state='needs_fix'
        and not exists(select 1 from financial_issue i where i.financial_version_id=o.active_version_id and i.document_version_id=v.id))
        order by p.id for update skip locked limit 1`);
      if (!publication) return false;
      const [version] = await exec.query<{ id: string; obligation_id: string }>(`select f.id,f.obligation_id from financial_publication_version f
        join financial_obligation o on o.active_version_id=f.id where f.publication_id=$1 and f.published_at is not null for update of f`, [publication.id]);
      if (!version) return false;
      await exec.query(`select d.id from document d where d.id in (select v.document_id from financial_package_document part
        join document_version v on v.id=part.document_version_id where part.financial_version_id=$1) order by d.id for update`, [version.id]);
      const invalid = await exec.query<{ id: string }>(`select v.id from document_version v join financial_package_document part on part.document_version_id=v.id
        where part.financial_version_id=$1 and v.state='needs_fix'`, [version.id]);
      const [duty] = await exec.query<{ active_version_id: string }>("select active_version_id from financial_obligation where id=$1 for update", [version.obligation_id]);
      if (duty?.active_version_id !== version.id) return false;
      let added = 0;
      for (const document of invalid) {
        const issues = await exec.query("insert into financial_issue(financial_version_id,document_version_id) values($1,$2) on conflict(financial_version_id,document_version_id) do nothing returning id", [version.id, document.id]);
        added += issues.length;
      }
      if (!added) return false;
      await exec.query("update financial_obligation set completed_at=null,reminded_at=null,escalated_at=null,version=version+1 where id=$1", [version.obligation_id]);
      return true;
    });
    if (!changed) break;
    count++;
  }
  return count;
}

export async function sweepFinancialObligations(deps: RegistryDeps, deadline = Date.now() + 30000) {
  let count = 0;
  const visited: string[] = [];
  for (let i = 0; i < 20 && Date.now() + 1000 < deadline; i++) {
    const found = await deps.db.transaction(async exec => {
      const [row] = await exec.query<FinancialObligation>(`select * from financial_obligation where completed_at is null and due_at<=now()
        and (reminded_at is null or escalated_at is null) and id<>all($1::uuid[]) order by due_at,id for update skip locked limit 1`, [visited]);
      if (!row) return false;
      const notice = templateNotice("notices.financial.obligation", { due_at: fmtDate(row.due_at) });
      const options = { financialObligationId: row.id, isTest: row.is_test, bot: "worker" as const, important: true };
      const send = (personId: string) => notifyPerson(exec, personId, notice, `financial-obligation:${row.id}:${row.version}:overdue:${personId}`, options);
      if (!row.reminded_at) {
        for (const personId of new Set([row.prepared_by, row.reviewer_id, row.publisher_id])) await send(personId);
        await exec.query("update financial_obligation set reminded_at=now() where id=$1", [row.id]);
      }
      if (!row.escalated_at) {
        const chairs = await exec.query<{ id: string }>(`select distinct p.id from person p join staff_assignment a on a.person_id=p.id
          where p.status='active' and p.is_test=$1 and a.role='chairman' and a.status='active'
          and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())`, [row.is_test]);
        for (const chair of chairs) await send(chair.id);
        if (chairs.length) await exec.query("update financial_obligation set escalated_at=now() where id=$1", [row.id]);
      }
      visited.push(row.id);
      return true;
    });
    if (!found) break;
    count++;
  }
  return count;
}
