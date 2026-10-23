import { useEffect,useRef,useState } from "react";
import { Alert,Button,List,Space } from "antd";
import { apiFetch } from "../lib/api";
import { DetailSection } from "../components/detail-section";
import { transitionNames } from "./initiative-types";
import { pollDate } from "./poll-types";
export function InitiativeHistory({id,version}:{id:string;version:number}){
 const [rows,setRows]=useState<{version:number;action:string;reason:string;at:string}[]>([]),[offset,setOffset]=useState(0),[more,setMore]=useState(false),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),generation=useRef(0);
 async function load(){const g=++generation.current;setBusy(true);setError(null);try{const result=await apiFetch<{items:typeof rows;has_more:boolean}>(`/v1/initiatives/${id}/history`,{query:{offset:String(offset)}});if(g===generation.current){setRows(result.items);setMore(result.has_more);}}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:"История недоступна");}finally{if(g===generation.current)setBusy(false);}}
 useEffect(()=>{void load();return()=>{generation.current++;};},[id,version,offset]);
 return <DetailSection title="История инициативы">{error&&<Alert role="alert" type="error" message={error} action={<Button onClick={()=>void load()}>Обновить историю</Button>}/>}<List loading={busy} dataSource={rows} renderItem={r=><List.Item>{pollDate(r.at)} · {transitionNames[r.action]??"Подача"}: {r.reason}</List.Item>}/><Space><Button disabled={busy||!offset} onClick={()=>setOffset(Math.max(0,offset-20))}>Ранее</Button><Button disabled={busy||!more} onClick={()=>setOffset(offset+20)}>Далее по истории</Button></Space></DetailSection>;
}
