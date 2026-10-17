import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, List, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { apiFetch } from "../lib/api";
import { useCabinetIdentity } from "../lib/identity";
import { TASK_STATE_TEXT, TASK_ACTION_TEXT } from "../../../core/src/locales/tasks";
type Row = Record<string, unknown>;
interface Task extends Row { id:string;number:string;title:string;instruction:string;state:string;version:number;due_at:string;request_id:string;can_manage?:boolean;can_execute?:boolean;log?:Row[] }
const message = (e:unknown) => e instanceof Error ? e.message : "Ошибка запроса";
const required = [{required:true,message:"Заполните поле"}];
export function TasksPage() {
  const {identity,roles} = useCabinetIdentity();
  const manager = roles.some(r=>["chairman","administrator","deputy"].includes(r));
  const [rows,setRows] = useState<Task[]>([]),[card,setCard] = useState<Task|null>(null);
  const [loading,setLoading] = useState(false),[saving,setSaving] = useState(false),[error,setError] = useState<string|null>(null);
  const [requests,setRequests] = useState<Row[]>([]),[people,setPeople] = useState<Row[]>([]);
  const [creating,setCreating] = useState(false),[action,setAction] = useState<string|null>(null);
  const [createForm] = Form.useForm(),[actionForm] = Form.useForm();
  const generation = useRef(0), key = useRef(crypto.randomUUID());
  const requestId = Form.useWatch("request_id",createForm);
  async function refresh() {
    const current = ++generation.current;
    setLoading(true); setError(null); setCard(null);
    try { const result = await apiFetch<{items:Task[]}>("/v1/tasks"); if(current===generation.current)setRows(result.items); }
    catch(e) { if(current===generation.current){setRows([]);setError(message(e));} }
    finally {if(current===generation.current)setLoading(false);}
  }
  useEffect(()=>{setCreating(false);setAction(null);setRequests([]);setPeople([]);void refresh();return()=>{generation.current++;};},[identity?.me.person.id]);
  useEffect(()=>{
    let active=true; setPeople([]);createForm.setFieldValue("assignee_person_id",undefined);
    if(requestId)void apiFetch<{items:Row[]}>(`/v1/requests/${requestId}/task-assignees`).then(r=>{if(active)setPeople(r.items);}).catch(e=>{if(active)setError(message(e));});
    return()=>{active=false;};
  },[requestId,createForm]);
  async function open(id:string) {
    const current=++generation.current;setCard(null);setError(null);setLoading(true);
    try {const result=await apiFetch<Task>(`/v1/tasks/${id}`);if(current===generation.current)setCard(result);}
    catch(e){if(current===generation.current)setError(message(e));}
    finally {if(current===generation.current)setLoading(false);}
  }
  async function newTask() {
    setError(null);setLoading(true);
    try {
      const result=await apiFetch<{items:Row[]}>("/v1/requests");
      setRequests(result.items.filter(r=>r.can_manage && !["draft","closed","canceled","rejected","awaiting_confirmation"].includes(String(r.state))));
      createForm.resetFields();key.current=crypto.randomUUID();setCreating(true);
    } catch(e){setError(message(e));}finally{setLoading(false);}
  }
  async function beginAction(value:string) {
    setError(null);actionForm.resetFields();key.current=crypto.randomUUID();setAction(value);
    if(value==="assign" && card) {
      setPeople([]);
      try {setPeople((await apiFetch<{items:Row[]}>(`/v1/requests/${card.request_id}/task-assignees`)).items);}
      catch(e){setError(message(e));}
    }
  }
  async function save(values:Row) {
    if(saving)return;setSaving(true);setError(null);
    try {
      const body={...values};
      for(const date of ["due_at","next_action_at"])if(body[date])body[date]=new Date(String(body[date])).toISOString();
      const result = creating
        ? await apiFetch<Task>("/v1/tasks",{method:"POST",body,idempotencyKey:key.current})
        : await apiFetch<Task>(`/v1/tasks/${card!.id}/transitions`,{method:"POST",body:{...body,action,version:card!.version},idempotencyKey:key.current});
      setCreating(false);setAction(null);await refresh();await open(result.id);
    }catch(e){setError(message(e));}finally{setSaving(false);}
  }
  const workerActions = card?.can_execute ? ({awaiting_acceptance:["accept","decline"],accepted:["start"],rework:["start"]} as Record<string,string[]>)[card.state] ?? [] : [];
  const adminActions = card?.can_manage ? [...(card.state==="created"?["assign"]:[]),...(["accepted","in_progress"].includes(card.state)?["suspend"]:[]),...(card.state==="suspended"?["resume"]:[]),...(!["accepted_admin","canceled","created"].includes(card.state)?["reassign"]:[])] : [];
  const reasonNeeded = action && ["decline","suspend","resume","reassign"].includes(action);
  return <Space direction="vertical" size="middle" style={{width:"100%"}}>
    <Typography.Title level={2}>Задания</Typography.Title>
    {error && <Alert type="error" showIcon message={error}/>}
    <Space wrap><Button onClick={()=>void refresh()} loading={loading}>Обновить</Button>{manager&&<Button type="primary" onClick={()=>void newTask()} disabled={loading}>Создать задание</Button>}</Space>
    <Table<Task> loading={loading} rowKey="id" dataSource={rows} locale={{emptyText:"Доступных заданий нет"}} scroll={{x:650}} columns={[
      {title:"Номер",dataIndex:"number",render:(n:string,r:Task)=><Button type="link" onClick={()=>void open(r.id)}>{n}</Button>},
      {title:"Работа",dataIndex:"title"},{title:"Состояние",dataIndex:"state",render:(s:string)=><Tag>{TASK_STATE_TEXT[s]??s}</Tag>},
      {title:"Срок",dataIndex:"due_at",render:(v:string)=>new Date(v).toLocaleString("ru-RU")},
    ]}/>
    {card&&<Card title={`${card.number} — ${card.title}`}>
      <Descriptions column={1} items={[{key:"state",label:"Состояние",children:TASK_STATE_TEXT[card.state]},
        {key:"instruction",label:"Инструкция",children:card.instruction},{key:"due",label:"Срок",children:new Date(card.due_at).toLocaleString("ru-RU")} ]}/>
      <Space wrap>{[...workerActions,...adminActions].map(a=><Button key={a} onClick={()=>void beginAction(a)}>{TASK_ACTION_TEXT[a]}</Button>)}</Space>
      <Typography.Title level={3}>История задания</Typography.Title>
      <List dataSource={card.log??[]} locale={{emptyText:"Событий пока нет"}} renderItem={item=><List.Item>{new Date(String(item.at)).toLocaleString("ru-RU")} — {TASK_STATE_TEXT[String(item.to_state)]}{item.reason?`: ${String(item.reason)}`:""}</List.Item>}/>
    </Card>}
    <Modal title="Новое задание" open={creating} onCancel={()=>{if(!saving)setCreating(false);}} footer={null} destroyOnHidden>
      <Form form={createForm} layout="vertical" onFinish={v=>void save(v)} onValuesChange={()=>{key.current=crypto.randomUUID();}} initialValues={{is_required:true}}>
        <Form.Item name="request_id" label="Обращение" rules={required}><Select showSearch optionFilterProp="label" options={requests.map(r=>({value:r.id,label:`${r.number} — ${r.description}`}))}/></Form.Item>
        <Form.Item name="title" label="Объём работы" rules={required}><Input maxLength={300}/></Form.Item>
        <Form.Item name="instruction" label="Инструкция" rules={required}><Input.TextArea rows={3}/></Form.Item>
        <Form.Item name="due_at" label="Срок (местное время)" rules={required}><Input type="datetime-local"/></Form.Item>
        <Form.Item name="assignee_person_id" label="Исполнитель"><Select allowClear options={people.map(p=>({value:p.id,label:String(p.full_name)}))}/></Form.Item>
        <Form.Item name="is_required" valuePropName="checked"><Checkbox>Обязательно для результата обращения</Checkbox></Form.Item>
        <Button htmlType="submit" type="primary" loading={saving}>Создать</Button>
      </Form>
    </Modal>
    <Modal title={action?TASK_ACTION_TEXT[action]:"Действие"} open={!!action} onCancel={()=>{if(!saving)setAction(null);}} footer={null} destroyOnHidden>
      <Form form={actionForm} layout="vertical" onFinish={v=>void save(v)} onValuesChange={()=>{key.current=crypto.randomUUID();}}>
        {action==="assign"&&<Form.Item name="assignee_person_id" label="Исполнитель" rules={required}><Select options={people.map(p=>({value:p.id,label:String(p.full_name)}))}/></Form.Item>}
        {reasonNeeded&&<Form.Item name="reason" label="Причина / основание" rules={required}><Input.TextArea/></Form.Item>}
        {action==="suspend"&&<><Form.Item name="next_action" label="Следующее действие" rules={required}><Input/></Form.Item><Form.Item name="next_action_at" label="Дата следующего действия" rules={required}><Input type="datetime-local"/></Form.Item></>}
        <Button htmlType="submit" type="primary" loading={saving}>{action?TASK_ACTION_TEXT[action]:"Подтвердить"}</Button>
      </Form>
    </Modal>
  </Space>;
}
