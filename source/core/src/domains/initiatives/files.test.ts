import { transitionInitiative } from "./service.ts";
import { expect,it,vi } from "vitest";
import { fixture,id } from "./service.test-support.ts";
import { prepareFile,uploadFile,completeFile,fileUrl,retryFile,type FileStorage } from "../requests/files.ts";
import { initiativeUploadActor,listInitiativePhotos,discardInitiativePhoto } from "./files.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { Row } from "../registry/validation.ts";
import { makeTestActor,B1 } from "../../testing/actors.ts";
function setup(){
 const h=fixture(),photos=new Map<string,Row>(),base=h.deps.db;
 const wrap=(exec:DbExecutor):DbExecutor=>({async query<T>(sql:string,p:readonly unknown[]=[]):Promise<T[]>{let rows:unknown[]=[];
  if(sql.startsWith("select * from file_policy"))rows=[{max_bytes:20971520,max_per_message:10,extensions:["jpg","pdf"]}];
  else if(sql.startsWith("select count(*)::text n from attachment"))rows=[{n:String([...photos.values()].filter(a=>!a.discarded_at).length)}];
  else if(sql.startsWith("insert into attachment(")){photos.set(String(p[0]),{id:p[0],request_id:p[1],owner_type:p[3],owner_id:p[4],bucket:p[5],storage_path:p[6],filename:p[7],size_bytes:p[8],mime:p[9],uploaded_by:p[10],status:"incomplete",upload_expires_at:new Date(Date.now()+300000).toISOString(),discarded_at:null});}
  else if(sql.startsWith("select * from attachment where id="))rows=photos.has(String(p[0]))?[photos.get(String(p[0]))!]:[];
  else if(sql.startsWith("select id,filename,size_bytes,mime,status from attachment"))rows=[...photos.values()].filter(a=>!a.discarded_at);
  else if(sql.startsWith("select id from attachment where owner_type='initiative'"))rows=[...photos.values()].filter(a=>!a.discarded_at&&a.status!=="complete");
  else if(sql.startsWith("update attachment set upload_expires_at"))photos.get(String(p[0]))!.upload_expires_at=new Date(Date.now()+300000).toISOString();
  else if(sql.startsWith("update attachment set status='complete'"))photos.get(String(p[0]))!.status="complete";
  else if(sql.startsWith("update attachment set discarded_at"))photos.get(String(p[0]))!.discarded_at="now";
  else if(sql.startsWith("update initiative set version=")){h.s.row!.version++;rows=[structuredClone(h.s.row)];}
  else return exec.query<T>(sql,p);return rows as T[];
 }});
 h.deps.db={...base,...wrap(base),transaction:fn=>base.transaction(async exec=>{const old=structuredClone(photos);try{return await fn(wrap(exec));}catch(e){photos.clear();old.forEach((v,k)=>photos.set(k,v));throw e;}})};
 const storage:FileStorage={put:vi.fn(async()=>{}),info:vi.fn(async()=>({size:3,mime:"image/jpeg"})),sign:vi.fn(async()=>"https://private.invalid/signed")};
 const prepare=()=>prepareFile(h.deps,h.actor,{owner_type:"initiative",owner_id:id,expected_version:h.s.row!.version,filename:"photo.jpg",size:3,mime:"image/jpeg"});
 return {...h,photos,storage,prepare};
}
it("фото приватно: подготовка/сохранение меняют версию, чужой UUID и другой режим не получают ссылку",async()=>{
 const h=setup();await h.submit();const p=await h.prepare(),file=String(p.attachment_id);expect(h.s.row!.version).toBe(2);
 await uploadFile(h.deps,h.storage,h.actor,file,new Uint8Array([255,216,255]));await completeFile(h.deps,h.storage,h.actor,file);expect(h.s.row!.version).toBe(3);
 expect(await fileUrl(h.deps,h.storage,h.actor,file)).toMatchObject({expires_in:300});
 const foreign=makeTestActor("executor",[B1]);foreign.assignments=[];
 await expect(fileUrl(h.deps,h.storage,foreign,file)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(fileUrl(h.deps,h.storage,makeTestActor("chairman",[],{isTest:true}),file)).rejects.toMatchObject({code:"NOT_FOUND"});expect(h.storage.sign).toHaveBeenCalledTimes(1);
});
it("после публикации фото доступны аудитории, изменения запрещены; потеря связи закрывает ссылку",async()=>{
 const h=setup();await h.submit();const p=await h.prepare();await completeFile(h.deps,h.storage,h.actor,String(p.attachment_id));h.s.row!.publication_state="published";h.s.row!.approved_building_ids=[B1];h.s.row!.stage="collecting";
 const reader=makeTestActor("executor",[B1]);reader.assignments=[];expect(await listInitiativePhotos(h.deps,reader,id)).toHaveLength(1);
 await expect(h.prepare()).rejects.toMatchObject({code:"NOT_FOUND"});h.s.members=[];await expect(fileUrl(h.deps,h.storage,reader,String(p.attachment_id))).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("исключённый файл не скачивается и освобождает лимит, версия защищает решение",async()=>{
 const h=setup();await h.submit();const p=await h.prepare();await expect(discardInitiativePhoto(h.deps,h.actor,id,String(p.attachment_id),{expected_version:1},"old")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
 await discardInitiativePhoto(h.deps,h.actor,id,String(p.attachment_id),{expected_version:2},"discard");expect(h.s.row!.version).toBe(3);expect(await listInitiativePhotos(h.deps,h.actor,id)).toHaveLength(0);await expect(fileUrl(h.deps,h.storage,h.actor,String(p.attachment_id))).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("только фото, до 20 МиБ и десяти вложений; неуспешная попытка не меняет версию",async()=>{
 const h=setup();await h.submit();await expect(prepareFile(h.deps,h.actor,{owner_type:"initiative",owner_id:id,expected_version:1,filename:"a.pdf",size:3,mime:"application/pdf"})).rejects.toMatchObject({code:"FILE_LIMIT"});
 for(let n=0;n<10;n++)await h.prepare();const version=h.s.row!.version;await expect(h.prepare()).rejects.toMatchObject({code:"FILE_LIMIT"});expect(h.s.row!.version).toBe(version);
});

it("retry сохраняет порядок блокировок, не оживляет исключённое; jobs отказывает тестовому file_id",async()=>{
 const h=setup();await h.submit();const p=await h.prepare(),file=String(p.attachment_id);await expect(retryFile(h.deps,h.actor,file)).resolves.toMatchObject({attachment_id:file});
 h.s.row!.is_test=true;await expect(initiativeUploadActor(h.deps.db,file,h.actor.person.id)).rejects.toMatchObject({code:"FORBIDDEN"});h.s.row!.is_test=false;
 await discardInitiativePhoto(h.deps,h.actor,id,file,{expected_version:2},"discard");await expect(retryFile(h.deps,h.actor,file)).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("публикация требует завершить или исключить подготовленные фото",async()=>{
 const h=setup();await h.submit();await h.prepare();await expect(transitionInitiative(h.deps,h.actor,id,"publish",{expected_version:2,reason:"Проверено",building_ids:[B1]},"publish")).rejects.toMatchObject({code:"INVALID_TRANSITION"});expect(h.s.row!.publication_state).toBe("submitted");
});
