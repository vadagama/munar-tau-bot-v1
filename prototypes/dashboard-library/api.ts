import {dashboardPeriod} from '/snapshot/source/core/src/domains/dashboard/period.ts';
const items = Array.from({length:20},(_,i)=>({id:String(i+1),label:`№${120+i} · ${['Не работает освещение в подъезде','Вопрос о начислениях','Протечка в помещении'][i%3]}`,state:i%2?'in_work':'new',href:`/requests?request=${i+1}&entity_page=1`,overdue:i===0,building:{label:'Дом 12',href:'/registry/buildings?entity=b&entity_page=1'},premises:{label:`Квартира ${i+1}`,href:'/registry/premises?entity=p&entity_page=1'}}));
export async function apiFetch(path:string, options:any={}) {
 if(path==='/v1/dashboard/assistant'){const res=await fetch('/__demo/assistant',{method:'POST',headers:{'Content-Type':'application/json','x-dashboard-demo':'1'},body:JSON.stringify(options.body)});const data=await res.json();if(!res.ok)throw new Error(data.error??'Ошибка AI');return data;}
 await new Promise(resolve=>setTimeout(resolve,120));
 if(path==='/v1/dashboard')return {widgets:[['new','Новые обращения',18],['action','Требуют вашего действия',132],['registrations','Регистрации',7],['bindings','Привязки помещений',11],['tasks','Задания: принятие и проверка',6],['incidents','Аварии',2]].map(([id,title,total])=>({id,title,total,items,href:'/requests?dashboard_queue=attention'})),analytics:true,assistant:await (await fetch('/__demo/assistant',{headers:{'x-dashboard-demo':'1'}})).json()};
 if(path.startsWith('/v1/dashboard/analytics')) {const period=new URLSearchParams(path.split('?')[1]).get('period');const range=dashboardPeriod(period);return {...range,buckets:range.buckets.map((b,i)=>({...b,created:5+i*2,closed:3+i})),kinds:[{kind:'request',count:42},{kind:'question',count:12},{kind:'complaint',count:5},{kind:'emergency',count:2}]};}
 if(path==='/v1/dashboard/requests'||path==='/v1/requests/search')return {items:[],total:0};
 if(path==='/v1/requests/1')return {id:'1',number:120,state:'new',kind:'request',description:'Не работает освещение в подъезде. Демонстрационные данные.',author_name:'Тестовый житель',source:'web',created_at:new Date().toISOString(),version:1,participants:[],messages:[],attachments:[],log:[],tasks:[],can_comment:false,can_share:false};
 if(path==='/v1/requests/context')return {buildings:[],premises:[]};
 return {items:[],...options};
}
export class ApiClientError extends Error {}
