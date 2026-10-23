import { expect,it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { requestCycles,recordReportResponse,type RequestReportEvent } from "../../src/domains/reports/history.ts";
describeWithDb("VS-8 REP-06 факты и циклы",getDb=>{
 it("сохраняет наблюдавшиеся переходы атомарно и не перезаписывает цикл/первый ответ",async()=>{
  const db=getDb(),id=crypto.randomUUID();await db.query("insert into request(id,number,state,author_person_id,created_by,description,source,is_test,open_at) values($1,'REP-1','new',$2,$2,'Двор','web',true,now())",[id,SEED.testAdminPersonId]);
  await db.query("insert into request_log(request_id,from_state,to_state,actor_person_id,actor_role,meta,at) values($1,null,'new',$2,'administrator','{\"action\":\"created\",\"version\":1}','2026-10-23T03:00:00Z')",[id,SEED.testAdminPersonId]);
  await db.transaction(async exec=>{
   await exec.query("update request set state='awaiting_confirmation',version=version+1 where id=$1",[id]);
   await exec.query("insert into request_log(request_id,from_state,to_state,actor_person_id,actor_role,meta,at) values($1,'new','awaiting_confirmation',$2,'administrator','{\"action\":\"submit_result\"}','2026-10-23T04:00:00Z')",[id,SEED.testAdminPersonId]);
  });
  const [message]=await db.query<{id:string}>("insert into message(request_id,channel,author_person_id,text,source) values($1,'resident',$2,'Содержательный ответ','web') returning id",[id,SEED.testAdminPersonId]);await recordReportResponse(db,id,message!.id);await recordReportResponse(db,id,message!.id);
  expect(await db.query("select id from report_request_event where request_id=$1 and kind='response'",[id])).toHaveLength(1);
  const rows=await db.query<RequestReportEvent>("select id::text,at::text,kind,from_state,to_state,action,confirmation_version from report_request_event where request_id=$1 order by at,id",[id]);expect(requestCycles(rows,"2026-10-23T05:00:00Z").cycles[0]!.wait.map(w=>({from:new Date(w.from).toISOString(),to:w.to}))).toEqual([{from:"2026-10-23T04:00:00.000Z",to:"2026-10-23T05:00:00Z"}]);
  await expect(db.query("update report_request_event set action='Подмена' where request_id=$1",[id])).rejects.toMatchObject({code:"42501"});
  await expect(db.transaction(async exec=>{await exec.query("insert into request_log(request_id,from_state,to_state,actor_person_id,actor_role,meta) values($1,'awaiting_confirmation','closed',$2,'administrator','{\"action\":\"confirm_result\"}')",[id,SEED.testAdminPersonId]);throw new Error("rollback");})).rejects.toThrow("rollback");
  expect(await db.query("select id from report_request_event where request_id=$1 and to_state='closed'",[id])).toHaveLength(0);
 },240000);
 it("KPI сохраняет прошедшее окно без DML на границах и дедуплицирует две связи человека",async()=>{
  const db=getDb();const [launch]=await db.query<{id:string}>("insert into report_launch(launched_on,created_by,reason) values((clock_timestamp() at time zone 'Asia/Almaty')::date,$1,'Тест') returning id",[SEED.testAdminPersonId]);
  await db.query(`with stamp as materialized(select clock_timestamp() as at),people as materialized(select gen_random_uuid() as person_id from generate_series(1,100)),rows as(select person_id from people union all select person_id from people limit 101)
   insert into audience_connection_event(connection_id,person_id,premises_id,building_id,is_test,enabled,effective_at,valid_from,valid_until)
   select gen_random_uuid(),person_id,gen_random_uuid(),$1,false,true,stamp.at,stamp.at+interval '1 millisecond',stamp.at+interval '2 milliseconds' from rows cross join stamp`,[SEED.building1]);
  await db.query("select pg_sleep(0.01)");await db.query("select public.capture_report_kpi()");
  expect(await db.query("select people_count from report_kpi_achievement where launch_id=$1",[launch!.id])).toEqual([{people_count:100}]);await db.query("select public.capture_report_kpi()");expect(await db.query("select launch_id from report_kpi_achievement where launch_id=$1",[launch!.id])).toHaveLength(1);
 });
 it("KPI не складывает непересекающиеся окна на общей конечной границе",async()=>{
  const db=getDb();await db.query("insert into report_launch(launched_on,created_by,reason) values((clock_timestamp() at time zone 'Asia/Almaty')::date,$1,'Тест')",[SEED.testAdminPersonId]);
  await db.query(`with stamp as materialized(select clock_timestamp() as at)
   insert into audience_connection_event(connection_id,person_id,premises_id,building_id,is_test,enabled,effective_at,valid_from,valid_until)
   select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$1,false,true,at,at+(case when n=100 then interval '2 milliseconds' else interval '1 millisecond' end),at+(case when n=100 then interval '3 milliseconds' else interval '2 milliseconds' end) from generate_series(1,100) n cross join stamp`,[SEED.building1]);
  await db.query("select pg_sleep(0.01)");await db.query("select public.capture_report_kpi()");expect(await db.query("select launch_id from report_kpi_achievement")).toHaveLength(0);
 });

});
