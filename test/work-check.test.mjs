import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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

test('filtered fields must be single-select or text and readable',()=>{
 const fields=[{name:'Executor',dataType:'SINGLE_SELECT'},{name:'Stage',dataType:'TEXT'},{name:'Points',dataType:'NUMBER'}];
 assert.equal(selectWork([item('A')],fields,[['Executor','RoleX'],['Stage','Ready']],false,now).count,1);
 assert.throws(()=>selectWork([item('A')],fields,[['Points','3']],false,now),/single-select or text/);
 const bad=item('B');bad.fieldValues.nodes[0]={field:{name:'Executor'}};
 assert.throws(()=>selectWork([bad],fields,[['Executor','RoleX']],false,now),/Unreadable value/);
 assert.equal(selectWork([bad],fields,[['Stage','Ready']],false,now).count,1);
});
test('over-long or malformed task identity blocks the queue',()=>{
 const long=item('A','RoleX','Ready',{schemaVersion:1,identity:'x'.repeat(201)});
 assert.throws(()=>selectWork([long],['Executor'],[],false,now),/Invalid task metadata/);
 const ok=item('B','RoleX','Ready',{schemaVersion:1,identity:'x'.repeat(200)});
 assert.equal(selectWork([ok],['Executor'],[],false,now).items[0].identity.length,200);
 const malformed=item('C');malformed.content.body='```ez-work\nnot json\n```';
 assert.throws(()=>selectWork([item('D'),malformed],['Executor'],[],false,now));
});
test('checkProject follows every items page and rejects bad cursors',async()=>{
 const page=(nodes,hasNextPage,endCursor)=>({stdout:JSON.stringify({data:{node:{fields:{nodes:[{name:'Executor',dataType:'SINGLE_SELECT'},{name:'Stage',dataType:'SINGLE_SELECT'}],pageInfo:{hasNextPage:false}},items:{nodes,pageInfo:{hasNextPage,endCursor}}}}})});
 const calls=[];
 const run=async(cmd,args)=>{calls.push(args);return args.includes('after=c1')?page([item('B')],false,null):page([item('A')],true,'c1');};
 const result=await checkProject('PVT_test',[['Executor','RoleX']],false,run);
 assert.equal(result.count,2);assert.equal(calls.length,2);assert.ok(!calls[0].some(a=>a.startsWith('after=')));
 await assert.rejects(()=>checkProject('PVT_test',[],false,async()=>page([item('A')],true,null)),/cursor/);
 await assert.rejects(()=>checkProject('PVT_test',[],false,async()=>page([item('A'),item('A')],false,null)),/Repeated/);
 await assert.rejects(()=>checkProject('PVT_test',[['Stage','Ready'],['Missing','x']],false,async()=>page([item('A')],false,null)),/unavailable/);
});
test('cli --help exits 0 and a bad project exits 1 with a message',()=>{
 const help=spawnSync(process.execPath,['bin/work-check.mjs','--help'],{encoding:'utf8'});
 assert.equal(help.status,0);assert.match(help.stdout,/ez github-work/);assert.match(help.stdout,/fail closed/);
 const bad=spawnSync(process.execPath,['bin/work-check.mjs','--project','nope'],{encoding:'utf8'});
 assert.equal(bad.status,1);assert.match(bad.stderr,/node ID/);assert.equal(bad.stdout,'');
});
test('checks of one tick share a single Project read; a later tick, a direct call and another Project read again',async t=>{
 const {mkdtempSync,rmSync,readdirSync,statSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const state=mkdtempSync(join(tmpdir(),'ez-github-work-'));process.env.EZ_GITHUB_STATE_DIR=state;
 t.after(()=>{delete process.env.EZ_GITHUB_STATE_DIR;rmSync(state,{recursive:true,force:true});});
 let board=[item('A','RoleX'),item('B','RoleY'),item('C','RoleX','Backlog')],reads=0;
 const run=async()=>{reads++;return {stdout:JSON.stringify({data:{node:{fields:{nodes:[{name:'Executor',dataType:'SINGLE_SELECT'},{name:'Stage',dataType:'SINGLE_SELECT'}],pageInfo:{hasNextPage:false}},items:{nodes:board,pageInfo:{hasNextPage:false,endCursor:null}}}}})};};
 const lanes=[[['Executor','RoleX'],['Stage','Ready']],[['Executor','RoleY'],['Stage','Ready']],[['Executor','RoleX'],['Stage','Backlog']],[['Executor','RoleZ']]];
 const receipt=({observedAt,...rest})=>rest;
 const alone=[];for(const filters of lanes) alone.push(await checkProject('PVT_test',filters,false,run));
 assert.equal(reads,4);assert.deepEqual(readdirSync(state),[],'a check without a tick keeps no snapshot');
 reads=0;const tick=new Date().toISOString(),shared=[];
 for(const filters of lanes) shared.push(await checkProject('PVT_test',filters,false,run,false,tick));
 assert.equal(reads,1,'one read serves every check of the tick');
 assert.deepEqual(shared.map(receipt),alone.map(receipt),'each check keeps its own eligibility, count, fingerprint and items');
 assert.deepEqual(shared.map(r=>r.count),[1,1,1,0]);assert.ok(shared.every(r=>r.observedAt===shared[0].observedAt && Date.parse(r.observedAt)>=Date.parse(tick)));
 assert.equal(statSync(join(state,'work-snapshots','PVT_test.json')).mode&0o777,0o600);
 // A card moved after the tick's read is never served to a later tick from the old snapshot.
 board=[item('A','RoleX'),item('B','RoleX'),item('C','RoleX','Backlog')];
 await new Promise(resolve=>setTimeout(resolve,5));const next=new Date().toISOString();
 const later=await checkProject('PVT_test',lanes[0],false,run,false,next);
 assert.equal(reads,2);assert.equal(later.count,2);assert.notEqual(later.fingerprint,shared[0].fingerprint);
 assert.equal((await checkProject('PVT_test',lanes[1],false,run,false,next)).count,0);assert.equal(reads,2);
 await checkProject('PVT_other',lanes[0],false,run,false,next);assert.equal(reads,3,'another Project has its own read');
 await checkProject('PVT_test',lanes[0],false,run);assert.equal(reads,4,'a direct call reads again');
 // A provider error is never replaced by an older snapshot.
 await assert.rejects(()=>checkProject('PVT_test',lanes[0],false,async()=>({stdout:JSON.stringify({errors:[{message:'denied'}]})}),false,new Date(Date.now()+1).toISOString()),/unavailable/);
});
