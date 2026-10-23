import { useEffect,useRef,useState } from "react";
import { Alert,Button,Input,List,Space,Typography } from "antd";
import { DetailSection } from "../components/detail-section";
import { apiFetch } from "../lib/api";
import type { InitiativeView } from "./initiative-types";
type Photo={id:string;filename:string;status:string;size_bytes:number};
export function InitiativePhotos({item,onChanged}:{item:InitiativeView;onChanged:()=>void}){
 const [photos,setPhotos]=useState<Photo[]>([]),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[file,setFile]=useState<File|null>(null);
 const generation=useRef(0),staged=useRef<{file:File;id:string}|null>(null);
 const fail=(e:unknown)=>e instanceof Error?e.message:"Не удалось сохранить фотографию";
 async function load(){const g=++generation.current;try{const r=await apiFetch<{items:Photo[]}>(`/v1/initiatives/${item.id}/photos`);if(g===generation.current){setPhotos(r.items);return true;}}catch(e){if(g===generation.current)setError(fail(e));}return false;}
 useEffect(()=>{void load();return()=>{generation.current++;};},[item.id,item.version]);
 async function upload(existing?:Photo){if(!file||busy)return;const g=generation.current;setBusy(true);setError(null);try{
  if(existing){
   if(existing.filename!==file.name||existing.size_bytes!==file.size)throw new Error("Выберите исходную фотографию с тем же именем и размером");
   await apiFetch(`/v1/files/${existing.id}/retry`,{method:"POST"});if(g!==generation.current)return;staged.current={file,id:existing.id};
  }
  if(staged.current?.file!==file){const p=await apiFetch<{attachment_id:string}>("/v1/files/upload-url",{method:"POST",body:{owner_type:"initiative",owner_id:item.id,expected_version:item.version,filename:file.name,size:file.size,mime:file.type}});if(g!==generation.current)return;staged.current={file,id:p.attachment_id};}
  const id=staged.current!.id;
  await apiFetch(`/v1/files/${id}/upload`,{method:"POST",file});if(g!==generation.current)return;await apiFetch(`/v1/files/${id}/complete`,{method:"POST"});
  if(g===generation.current){staged.current=null;setFile(null);if(await load())onChanged();}
 }catch(e){if(g===generation.current){setError(fail(e));onChanged();}}finally{setBusy(false);}}
 async function discard(photo:Photo){if(busy)return;const g=generation.current;setBusy(true);setError(null);try{await apiFetch(`/v1/initiatives/${item.id}/photos/${photo.id}/discard`,{method:"POST",idempotencyKey:crypto.randomUUID(),body:{expected_version:item.version}});if(g===generation.current){if(staged.current?.id===photo.id)staged.current=null;if(await load())onChanged();}}catch(e){if(g===generation.current)setError(fail(e));}finally{setBusy(false);}}
 async function open(photo:Photo){const g=generation.current;try{const r=await apiFetch<{url:string}>(`/v1/files/${photo.id}/url`);if(g===generation.current)window.open(r.url,"_blank","noopener,noreferrer");}catch(e){if(g===generation.current)setError(fail(e));}}
 return <DetailSection title="Фотографии инициативы">
 {error&&<Alert role="alert" type="error" message={error}/>}
 <List dataSource={photos} locale={{emptyText:"Фотографий нет"}} renderItem={photo=><List.Item><Space wrap><Typography.Text>{photo.filename}</Typography.Text>{photo.status==="complete"?<Button onClick={()=>void open(photo)}>Открыть фотографию</Button>:<><Typography.Text>Ещё не сохранена</Typography.Text>{item.can_attach&&<Button disabled={busy||!file} onClick={()=>void upload(photo)}>Продолжить загрузку</Button>}</>}{item.can_attach&&<Button danger disabled={busy} onClick={()=>void discard(photo)}>Исключить фотографию</Button>}</Space></List.Item>}/>
 {item.can_attach&&<><Typography.Paragraph>До 10 фотографий по 20 МиБ. После публикации состав изменить нельзя. Незавершённую загрузку нужно закончить или исключить.</Typography.Paragraph><Input aria-label="Фотография инициативы" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)}/><Button loading={busy} disabled={!file} onClick={()=>void upload()}>Сохранить фотографию</Button></>}
 </DetailSection>;
}
