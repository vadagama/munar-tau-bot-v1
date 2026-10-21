import {expect,it,vi} from 'vitest';
import type {RegistryDeps} from '../registry/service.ts';
import type {DbExecutor} from '../../db/client.ts';
import {makeTestActor,B1} from '../../testing/actors.ts';
import {proposeVisit} from './visits.ts';
vi.mock('./access.ts',async original=>({...await original<typeof import('./access.ts')>(),requireTask:async()=>({id:'t',request_id:'r',number:'З-1',version:5,state:'in_progress',building_ids:[B1],is_test:true})}));
it('a stale proposal cannot replace an intervening confirmed visit',async()=>{
 const mutations:string[]=[];
 const query:DbExecutor['query']=async<T>(sql:string)=>{
  if(sql.startsWith('update ')||sql.startsWith('insert '))mutations.push(sql);
  return (sql.startsWith('select * from request')?[{id:'r',premises_id:'p',state:'in_work'}]:[]) as T[];
 };
 const deps={db:{query,transaction:fn=>fn({query})}} as RegistryDeps;
 await expect(proposeVisit(deps,makeTestActor('administrator',[B1],{isTest:true}),{task_id:'t',expected_version:4,interval_start:'2099-01-01T10:00:00Z',interval_end:'2099-01-01T12:00:00Z',note:'Осмотр'},'key')).rejects.toMatchObject({code:'CONCURRENT_MODIFICATION'});
 expect(mutations).toEqual([]);
});
