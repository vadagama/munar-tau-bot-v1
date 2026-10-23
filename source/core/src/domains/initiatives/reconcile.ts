import type { RegistryDeps } from "../registry/service.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { initiativeRow,initiativeAudience } from "./access.ts";
import { initiativeSupportState,persistInitiativeExclusions } from "./support-state.ts";
/** Не более десяти инициатив, ротация отдельно от версии карточки/личной формы. */
export async function reconcileInitiativeSupport(deps:RegistryDeps,deadline=Date.now()+30000):Promise<number> {
 if(Date.now()>=deadline)return 0;
 const rows=await deps.db.query<{id:string}>(`select i.id from initiative i left join initiative_reconciliation r on r.initiative_id=i.id
  where i.publication_state='published' and i.stage not in ('completed','rejected') order by r.checked_at nulls first,i.created_at,i.id limit 10`);
 let processed=0;
 for(const {id} of rows){if(Date.now()+1000>=deadline)break;
  const done=await deps.db.transaction(async exec=>{await lockAudience(exec);if(Date.now()>=deadline)return false;
   const row=await initiativeRow(exec,id,true);if(row.publication_state!=="published"||["completed","rejected"].includes(row.stage??""))return false;
   const clock=await initiativeAudience(exec,row.author_person_id,row.is_test),support=await initiativeSupportState(exec,row,Number(clock.us));
   await persistInitiativeExclusions(exec,id,support.excluded);
   await exec.query(`insert into initiative_reconciliation(initiative_id,checked_at) values($1,$2)
    on conflict(initiative_id) do update set checked_at=excluded.checked_at`,[id,clock.at_text]);return true;
  });if(done)processed++;
 }
 return processed;
}
