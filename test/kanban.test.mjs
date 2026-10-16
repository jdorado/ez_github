import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kanban,main,parseBoard,pairs} from '../bin/kanban.mjs';

const field=(id,name,dataType,options)=>({id,name,dataType,...(options?{options:options.map((n,i)=>({id:`${id}o${i}`,name:n}))}:{})});
const FIELDS=[field('F1','Status','SINGLE_SELECT',['Backlog','Ready','Done']),field('F2','Due date','DATE'),field('F3','Role','TEXT'),field('F4','Title','TEXT')];
const value=(name,v)=>({...v,field:{name}});
const item=(id,number,fields,extra={})=>({id,isArchived:false,...extra,
  content:{__typename:'Issue',number,title:`Task ${number}`,url:`https://github.com/o/r/issues/${number}`,state:'OPEN',repository:{nameWithOwner:'o/r'}},
  fieldValues:{nodes:[value('Title',{text:`Task ${number}`}),...fields]}});

// A fake gh: two board pages, item-edit/item-add/issue calls recorded and applied.
function fakeGh(items) {
  const calls=[],state=structuredClone(items);
  const gh=async args=>{
    calls.push(args);
    if(args[0]==='api') {
      const query=args.find(a=>a.startsWith('query=')),after=args.find(a=>a.startsWith('after='));
      if(query.includes('node(id:')) {const id=args.find(a=>a.startsWith('id=')).slice(3);return JSON.stringify({data:{node:state.find(x=>x.id===id)}});}
      const page=after?state.slice(1):state.slice(0,1);
      return JSON.stringify({data:{repositoryOwner:{projectV2:{id:'PVT_1',title:'Board',fields:{nodes:FIELDS},items:{pageInfo:{hasNextPage:!after&&state.length>1,endCursor:'c1'},nodes:page}}}}});
    }
    if(args[0]==='project'&&args[1]==='item-edit') {
      const it=state.find(x=>x.id===args[args.indexOf('--id')+1]),f=FIELDS.find(x=>x.id===args[args.indexOf('--field-id')+1]);
      it.fieldValues.nodes=it.fieldValues.nodes.filter(v=>v.field.name!==f.name);
      if(args.includes('--single-select-option-id')) it.fieldValues.nodes.push(value(f.name,{name:f.options.find(o=>o.id===args.at(-1)).name}));
      if(args.includes('--date')) it.fieldValues.nodes.push(value(f.name,{date:args.at(-1)}));
      if(args.includes('--text')) it.fieldValues.nodes.push(value(f.name,{text:args.at(-1)}));
      return '{}';
    }
    if(args[0]==='issue'&&args[1]==='create') return 'Creating issue\nhttps://github.com/o/r/issues/9\n';
    if(args[0]==='project'&&args[1]==='item-add') {state.push(item('PVTI_9',9,[]));return JSON.stringify({id:'PVTI_9'});}
    if(args[0]==='issue'&&args[1]==='view') return JSON.stringify({body:'Do it',comments:[{author:{login:'a'},createdAt:'2026-10-16T00:00:00Z',body:'hi',url:'u'}]});
    if(args[0]==='issue'&&args[1]==='comment') return 'https://github.com/o/r/issues/1#issuecomment-5\n';
    throw Error(`unexpected gh ${args.join(' ')}`);
  };
  return {gh,calls,state};
}
const board=()=>fakeGh([item('PVTI_1',1,[value('Status',{name:'Backlog'}),value('Due date',{date:'2026-10-16'}),value('Role',{text:'CIO'})]),item('PVTI_2',2,[value('Status',{name:'Ready'})])]);

test('list reads every page and filters by column and field',async()=>{
  const {gh}=board(),k=kanban({gh});
  assert.equal((await k.list({board:'o/2'})).length,2);
  const ready=await k.list({board:'o/2',column:'ready'});
  assert.deepEqual(ready.map(x=>x.ref),['o/r#2']);
  const cio=await k.list({board:'o/2',field:['Role=CIO']});
  assert.deepEqual(cio[0],{card:'PVTI_1',type:'issue',ref:'o/r#1',url:'https://github.com/o/r/issues/1',title:'Task 1',state:'open',archived:false,fields:{Status:'Backlog','Due date':'2026-10-16',Role:'CIO'}});
});
test('board lists columns and fields',async()=>{
  const out=await kanban({gh:board().gh}).board({board:'o/2'});
  assert.deepEqual(out.columns,['Backlog','Ready','Done']);
  assert.deepEqual(out.fields.find(f=>f.name==='Due date'),{name:'Due date',type:'date'});
});
test('move resolves the card by ref or URL and reads back',async()=>{
  const {gh,calls}=board(),k=kanban({gh});
  const moved=await k.move({board:'o/2'},['https://github.com/o/r/issues/1','Ready']);
  assert.equal(moved.fields.Status,'Ready');
  assert.ok(calls.some(a=>a.includes('--single-select-option-id')&&a.includes('F1o1')));
  await assert.rejects(k.move({board:'o/2'},['o/r#1','Doing']),/not an option of Status: Backlog, Ready, Done/);
  await assert.rejects(k.move({board:'o/2'},['o/r#7','Ready']),/not on this board/);
});
test('set changes date and text fields and clears with NAME=',async()=>{
  const {gh}=board(),k=kanban({gh});
  const out=await k.set({board:'o/2'},['o/r#1','Due date=2026-10-20','Role=Researcher']);
  assert.equal(out.fields['Due date'],'2026-10-20');assert.equal(out.fields.Role,'Researcher');
  await assert.rejects(k.set({board:'o/2'},['o/r#1','Due date=tomorrow']),/YYYY-MM-DD/);
  await assert.rejects(k.set({board:'o/2'},['o/r#1','Priority=1']),/No field "Priority"/);
});
test('add creates the issue, puts it on the board and sets fields',async()=>{
  const {gh,calls}=board(),k=kanban({gh});
  const out=await k.add({board:'o/2',repo:'o/r',title:'New',body:'Why',column:'Backlog',set:['Due date=2026-10-17']});
  assert.equal(out.card,'PVTI_9');assert.equal(out.fields.Status,'Backlog');assert.equal(out.fields['Due date'],'2026-10-17');
  assert.deepEqual(calls.find(a=>a[1]==='create'),['issue','create','--repo','o/r','--title','New','--body','Why']);
  await assert.rejects(k.add({board:'o/2',repo:'o/r',title:'X',set:['Nope=1']}),/No field "Nope"/);
  assert.equal(calls.filter(a=>a[1]==='create').length,1);
});
test('show and comment use the issue',async()=>{
  const k=kanban({gh:board().gh});
  const shown=await k.show({board:'o/2'},['o/r#1']);
  assert.equal(shown.body,'Do it');assert.equal(shown.comments[0].author,'a');
  assert.deepEqual(await k.comment({board:'o/2',body:'Done: see PR'},['PVTI_1']),{card:'PVTI_1',ref:'o/r#1',comment:'https://github.com/o/r/issues/1#issuecomment-5'});
  await assert.rejects(k.comment({board:'o/2'},['PVTI_1']),/--body/);
});
test('argument errors and help',async()=>{
  assert.throws(()=>parseBoard('o'),/OWNER\/NUMBER/);
  assert.throws(()=>pairs(['x']),/NAME=VALUE/);
  assert.match(await main([],async()=>''),/ez kanban/);
  await assert.rejects(main(['delete','--board','o/2'],async()=>''),/Unknown command delete/);
  await assert.rejects(main(['list'],async()=>''),/--board/);
});
