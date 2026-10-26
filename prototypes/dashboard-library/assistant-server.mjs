import {deepseekAnswer} from './snapshot/source/core/src/domains/dashboard/assistant-provider.ts';

const sourcePaths=['/requests?dashboard_queue=new','/requests?dashboard_queue=attention','/registrations?kind=primary','/registrations?kind=binding','/tasks','/incidents'];
const counts=[{title:'Новые обращения',total:18},{title:'Требуют вашего действия',total:132},{title:'Регистрации',total:7},{title:'Привязки помещений',total:11},{title:'Задания: принятие и проверка',total:6},{title:'Аварии',total:2}];
const summary=counts.map((s,i)=>({...s,ref:`ref:q${i}`,items:i===0?[{title:'Обращение №120',ref:'ref:e1'}]:[]}));
const sources=[...counts.map((s,i)=>({...s,ref:`ref:q${i}`,href:sourcePaths[i]})),{title:'Обращение №120',ref:'ref:e1',href:'/requests?request=1&entity_page=1'}];
let used=0,busy=false;
export function assistantDemo(){return {name:'server-only-deepseek-demo',configureServer(server){server.middlewares.use('/__demo/assistant',async(req,res)=>{
 res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
 if(req.method==='GET' && req.headers['x-dashboard-demo']==='1'){res.end(JSON.stringify({state:used>=20?'limit':'enabled',remaining:20-used,daily_limit:20}));return;}
 if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:8770'||req.headers['x-dashboard-demo']!=='1'){res.statusCode=403;res.end('{}');return;}
 if(busy||used>=20){res.statusCode=429;res.end(JSON.stringify({error:'Лимит локальной демонстрации'}));return;}
 let data='';for await(const chunk of req){data+=chunk;if(data.length>12000){res.statusCode=400;res.end('{}');return;}}
 let question;try{question=JSON.parse(data).question;}catch{}
 if(typeof question!=='string'||!question.trim()||question.length>2000){res.statusCode=400;res.end('{}');return;}
 busy=true;used++;
 try{const key=process.env.DEEPSEEK_API_KEY;const result=key?await deepseekAnswer(key,question,summary,'ru'):{text:'Это демонстрационный ответ без подключения AI.\n\n| Очередь | Количество |\n| --- | ---: |\n| Новые обращения | 18 |\n| Требуют действия | 132 |\n\n[Открыть обращения](ref:q0)'};res.end(JSON.stringify({...result,remaining:20-used,generated_at:new Date().toISOString(),sources}));}
 catch{res.statusCode=503;res.end(JSON.stringify({error:'DeepSeek временно недоступен'}));}
 finally{busy=false;}
 });}};}
