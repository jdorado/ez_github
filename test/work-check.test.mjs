import test from 'node:test';
import assert from 'node:assert/strict';
import {selectWork,checkProject} from '../bin/work-check.mjs';
const now=Date.parse('2026-10-07T12:00:00Z');
const item=(id,role='RoleX',status='Ready',metadata)=>({id,isArchived:false,updatedAt:'2026-10-07T10:00:00Z',content:{state:'OPEN',body:metadata?'```ez-work\n'+JSON.stringify(metadata)+'\n```':''},fieldValues:{pageInfo:{hasNextPage:false},nodes:[{field:{name:'Executor'},name:role},{field:{name:'Stage'},name:status}]}});
test('generic role/status selection and exact freshness gate',()=>{
 const meta={schemaVersion:1,identity:'flow:object:occurrence',notBefore:'2026-10-07T11:00:00Z',freshUntil:'2026-10-08T12:00:00Z'};
 const all=[item('A','RoleX','Ready',meta),item('B','RoleY'),item('C','RoleX','Ready',{...meta,freshUntil:'2026-10-06T12:00:00Z'}),item('D')];
 const result=selectWork(all,['Executor','Stage'],[['Executor','RoleX'],['Stage','Ready']],true,now);
 assert.equal(result.count,1);assert.deepEqual(result.items,[{id:'A',identity:meta.identity}]);assert.equal(result.eligible,true);
 assert.equal(selectWork([],['Executor'],[['Executor','RoleX']],false,now).eligible,false);
 assert.throws(()=>selectWork(all,['Executor'],[['Missing','x']],false,now),/unavailable/);
 assert.throws(()=>selectWork([{...all[0],fieldValues:{...all[0].fieldValues,pageInfo:{hasNextPage:true}}}],['Executor'],[],false,now),/Incomplete/);
});
test('provider errors never turn into an empty-success response',async()=>{
 await assert.rejects(()=>checkProject('PVT_test',[],false,async()=>({stdout:JSON.stringify({errors:[{message:'denied'}]})})),/unavailable/);
 await assert.rejects(()=>checkProject('wrong',[],false),/node ID/);
});

test('coordination observes all states without treating them as queue assignments',()=>{
 const future=item('future','RoleX','Backlog',{schemaVersion:1,identity:'x',notBefore:'2030-01-01T00:00:00Z'});
 const closed={...item('closed'),isArchived:true,content:{state:'CLOSED',body:'```ez-work\ninvalid\n```'}};
 const result=selectWork([future,closed],['Executor','Stage'],[],false,now,true);
 assert.equal(result.count,2);assert.equal(result.eligible,true);
 const changed=selectWork([{...future,updatedAt:'2026-10-07T11:59:00Z'},closed],['Executor','Stage'],[],false,now,true);
 assert.notEqual(result.fingerprint,changed.fingerprint);
 assert.equal(selectWork([],[],[],false,now,true).eligible,true);
 assert.throws(()=>selectWork([],['Executor'],[['Executor','x']],false,now,true),/cannot filter/);
});
