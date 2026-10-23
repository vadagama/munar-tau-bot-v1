import { useEffect,useRef,useState } from "react";
import { Alert,Button,Select,Space,Spin } from "antd";
import { apiFetch } from "../lib/api";
interface Doc {id:string;title:string;kind:string}
export function InitiativeDocumentPicker({value,onChange,disabled}:{value?:string;onChange?:(value:string|undefined)=>void;disabled?:boolean}){
 const [docs,setDocs]=useState<Doc[]>([]),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[selected,setSelected]=useState<string>();
 const [versions,setVersions]=useState<{id:string;version:number;state:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const generation=useRef(0),selection=useRef(0);
 async function load(at=0){const g=++generation.current;setBusy(true);setError(null);try{const result=await apiFetch<{items:Doc[];total:number}>("/v1/documents",{query:{offset:String(at),limit:"50"}});if(g===generation.current){setDocs(old=>at?[...old,...result.items]:result.items);setTotal(result.total);setOffset(at+result.items.length);}}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"Не удалось загрузить документы");}finally{if(g===generation.current)setBusy(false);}}
 useEffect(()=>{void load();return()=>{generation.current++;selection.current++;};},[]);
 async function choose(id:string){const g=++selection.current;setSelected(id);setVersions([]);onChange?.(undefined);setBusy(true);setError(null);try{const doc=await apiFetch<{versions:{id:string;version:number;state:string}[]}>(`/v1/documents/${id}`);if(g===selection.current)setVersions(doc.versions.filter(v=>v.state==="approved"));}catch(e){if(g===selection.current)setError(e instanceof Error?e.message:"Версии недоступны");}finally{if(g===selection.current)setBusy(false);}}
 return <Space direction="vertical" size="small">
  {error&&<Alert role="alert" type="error" message={error} action={<Button onClick={()=>void (selected?choose(selected):load())}>Повторить</Button>}/>}
  {busy&&<Spin aria-label="Загрузка решений"/>}
  <Select aria-label="Документ решения" disabled={disabled||busy} placeholder="Выберите документ решения" value={selected} options={docs.filter(d=>d.kind==="decision_basis").map(d=>({value:d.id,label:d.title}))} onChange={id=>void choose(id)}/>
  {offset<total&&<Button disabled={disabled||busy} onClick={()=>void load(offset)}>Ещё документы</Button>}
  <Select aria-label="Проверенная версия решения" disabled={disabled||busy} placeholder="Выберите проверенную версию" value={value} onChange={onChange}
   options={[...versions.map(v=>({value:v.id,label:`Проверенная версия ${v.version}`})),...(value&&!versions.some(v=>v.id===value)?[{value,label:"Ранее выбранная версия"}]:[])]}/>
 </Space>;
}
