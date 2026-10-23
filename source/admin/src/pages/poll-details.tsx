import { Alert,Descriptions,List,Tag,Typography } from "antd";
import { DetailSection } from "../components/detail-section";
import { pollDate,pollStates,type PollBase } from "./poll-types";
export function PollDetails({poll}:{poll:PollBase}){
  return <DetailSection title="Параметры опроса">
    <Typography.Paragraph strong>{poll.question}</Typography.Paragraph>
    <Descriptions column={1} size="small" items={[
      {key:"state",label:"Состояние",children:<Tag>{pollStates[poll.state]}</Tag>},
      {key:"end",label:"Окончание, Алматы",children:pollDate(poll.closes_at)},
      {key:"scope",label:"Аудитория",children:poll.building_ids.map(id=>poll.buildings?.find(b=>b.id===id)?.label??"Удалённое здание").join(", ")},
    ]}/>
    <List size="small" aria-label="Варианты опроса" dataSource={poll.options} renderItem={option=><List.Item>{option.label}</List.Item>}/>
    {poll.state==="canceled"&&<Alert type="warning" showIcon message="Опрос отменён" description={poll.cancel_reason}/>}
  </DetailSection>;
}
