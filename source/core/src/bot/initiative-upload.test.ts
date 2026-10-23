import { afterEach,expect,it,vi } from "vitest";
import { processRequestUploads } from "./request-files.ts";
import { initiativeUploadActor,advanceInitiativePhotos } from "../domains/initiatives/files.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { DbClient } from "../db/client.ts";
import { ApiError } from "../errors/api.ts";
vi.mock("../domains/initiatives/files.ts",async original=>({...await original<typeof import("../domains/initiatives/files.ts")>(),initiativeUploadActor:vi.fn(),advanceInitiativePhotos:vi.fn()}));
afterEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
function fixture(){let claimed=false,complete=false,stored=false;const notices:Record<string,unknown>[]=[];
 const job={attachment_id:"photo",person_id:"author",telegram_file_id:"tg",owner_type:"initiative",owner_id:"idea",bot:"resident",bucket:"resident",storage_path:"idea/photo",filename:"photo.jpg",size_bytes:3,mime:"image/jpeg",attempts:1};
 const db:DbClient={async query<T>(sql:string,p:readonly unknown[]=[]):Promise<T[]>{let rows:unknown[]=[];
  if(sql.startsWith("select j.*")){if(!claimed)rows=[job];claimed=true;}
  else if(sql.includes("set state='processing'"))rows=[{attempts:1}];
  else if(sql.includes("set state='complete'"))rows=[{attachment_id:"photo"}];
  else if(sql.startsWith("update attachment"))complete=true;
  else if(sql.startsWith("insert into outbox"))notices.push(JSON.parse(String(p[0])));
  return rows as T[];
 },transaction:fn=>fn(db),close:async()=>{}};
 const storage={put:vi.fn(async()=>{stored=true;}),info:async()=>{if(!stored)throw new Error("missing");return {size:3,mime:"image/jpeg"};},sign:async()=>"unused"};
 const fetch=vi.fn(async(url:string)=>url.endsWith("getFile")?Response.json({ok:true,result:{file_path:"photos/x.jpg",file_size:3}}):new Response(new Uint8Array([255,216,255])));vi.stubGlobal("fetch",fetch);
 return {deps:{db} as RegistryDeps,storage,fetch,notices,complete:()=>complete};
}
it("потеря доступа перед скачиванием не вызывает Telegram/Storage",async()=>{
 const h=fixture();vi.mocked(initiativeUploadActor).mockRejectedValue(new ApiError("NOT_FOUND"));await processRequestUploads(h.deps,h.storage,{resident:"fake",worker:"fake"});expect(h.fetch).not.toHaveBeenCalled();expect(h.storage.put).not.toHaveBeenCalled();expect(h.complete()).toBe(false);
});
it("перед завершением доступ проверяется повторно, подтверждения об успехе при отзыве нет",async()=>{
 const h=fixture();vi.mocked(initiativeUploadActor).mockResolvedValueOnce({actor:{},row:{},attachment:{status:"incomplete"}} as never).mockRejectedValueOnce(new ApiError("NOT_FOUND"));await processRequestUploads(h.deps,h.storage,{resident:"fake",worker:"fake"});expect(h.fetch).toHaveBeenCalledTimes(2);expect(h.complete()).toBe(false);expect(h.notices).toHaveLength(0);
});
it("сохранение фото, версия и уведомление с ссылкой на инициативу завершаются вместе",async()=>{
 const h=fixture();vi.mocked(initiativeUploadActor).mockResolvedValue({actor:{},row:{id:"idea"},attachment:{status:"incomplete"}} as never);await processRequestUploads(h.deps,h.storage,{resident:"fake",worker:"fake"});expect(h.complete()).toBe(true);expect(advanceInitiativePhotos).toHaveBeenCalledOnce();expect(h.notices[0]).toMatchObject({initiativeId:"idea",bot:"resident"});
});
