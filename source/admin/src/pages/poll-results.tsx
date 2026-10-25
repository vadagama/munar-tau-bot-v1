import { usePageRefresh } from "../lib/use-page-refresh";
import { useEffect,useRef,useState } from "react";
import { Alert,List,Space,Spin,Typography } from "antd";
import { DetailSection } from "../components/detail-section";
import { apiFetch } from "../lib/api";
import { pollDate,type PollSummary,type PollView } from "./poll-types";
export function PollResults({poll}:{poll:PollView}){
  const [result,setResult]=useState<PollSummary|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const generation=useRef(0);
  async function load(){
    const g=++generation.current;setBusy(true);setError(null);
    try{const next=await apiFetch<PollSummary>(`/v1/polls/${poll.id}/results`);if(g===generation.current)setResult(next);}
    catch(e){if(g===generation.current){setResult(null);setError(e instanceof Error?e.message:"Результаты недоступны");}}
    finally{if(g===generation.current)setBusy(false);}
  }
  usePageRefresh(load, () => !busy);
  useEffect(()=>{void load();return()=>{generation.current++;};},[poll.id]);
  return <DetailSection title="Сводные результаты">
    <Space wrap>{busy&&!result&&<Spin aria-label="Загрузка результатов"/>}</Space>
    {error&&<Alert role="alert" type="error" showIcon message={error}/>}
    {result&&<>
      <Typography.Paragraph strong>Ответили: {result.participants_count}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{result.final?"Окончательный итог":"Текущий подсчёт"} на {pollDate(result.as_of)} (Алматы)</Typography.Paragraph>
      {!result.participants_count&&<Typography.Paragraph>Ответов нет</Typography.Paragraph>}
      <List dataSource={result.distribution} renderItem={item=><List.Item>
        <Typography.Text>{poll.options.find(option=>option.key===item.option_key)?.label??"Вариант опроса"}</Typography.Text>
        <Typography.Text>{item.count} ({result.participants_count?Math.round(item.count/result.participants_count*100):0}%)</Typography.Text>
      </List.Item>}/>
      <Typography.Paragraph type="secondary">Показано только распределение. Имена и индивидуальные ответы недоступны.</Typography.Paragraph>
    </>}
  </DetailSection>;
}
