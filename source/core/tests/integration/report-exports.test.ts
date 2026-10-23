import { expect,it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
describeWithDb("VS-8 очередь экспортов: неизменяемость и lease",getDb=>{
 it("зафиксированный intent не редактируется, lease нельзя перехватить до истечения, failed окончателен",async()=>{
  const db=getDb(),[profile]=await db.query<{id:string}>("select id from profile where person_id=$1 and archived_at is null limit 1",[SEED.testAdminPersonId]);expect(profile).toBeTruthy();
  const [job]=await db.query<{id:string}>(`insert into report_export_job(kind,requested_by_person_id,requested_by_profile_id,real_person_id,real_profile_id,is_test,filters,permission_snapshot,scope_snapshot,as_of)
   values('tasks',$1,$2,$1,$2,true,'{}','{"is_test":true,"roles":[]}','{}',clock_timestamp()) returning id`,[SEED.testAdminPersonId,profile!.id]);
  await expect(db.query("update report_export_job set as_of=as_of+interval '1 second' where id=$1",[job!.id])).rejects.toThrow();
  await db.query("update report_export_job set state='running',attempts=1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute' where id=$1",[job!.id]);
  await expect(db.query("update report_export_job set attempts=2,lease_token=gen_random_uuid() where id=$1",[job!.id])).rejects.toThrow();
  await db.query("update report_export_job set state='failed',last_error='ACCESS_REVOKED',lease_token=null,lease_until=null,finished_at=clock_timestamp() where id=$1",[job!.id]);
  await expect(db.query("update report_export_job set state='pending',finished_at=null where id=$1",[job!.id])).rejects.toThrow();
 },240000);
});
