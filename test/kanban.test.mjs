import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {kanban,main,parseBoard,pairs,exitCodeFor,CLAIM_MARKER} from '../bin/kanban.mjs';

const field=(id,name,dataType,options)=>({id,name,dataType,...(options?{options:options.map((n,i)=>({id:`${id}o${i}`,name:n}))}:{})});
const FIELDS=[field('F1','Status','SINGLE_SELECT',['Backlog','Ready','Done']),field('F2','Due date','DATE'),field('F3','Role','TEXT'),field('F4','Title','TEXT'),field('F5','Points','NUMBER')];
const value=(name,v)=>({...v,field:{name}});
const item=(id,number,fields,extra={})=>({id,isArchived:false,...extra,
  content:{__typename:'Issue',number,title:`Task ${number}`,url:`https://github.com/o/r/issues/${number}`,state:'OPEN',repository:{nameWithOwner:'o/r'}},
  fieldValues:{nodes:[value('Title',{text:`Task ${number}`}),...fields]}});

// A fake gh: two board pages, item-edit/item-add/issue calls recorded and applied.
function fakeGh(items) {
  const calls=[],inputs=[],state=structuredClone(items);
  const gh=async(args,input)=>{
    calls.push(args);if(input!==undefined) inputs.push(input);
    if(args[0]==='api'&&args[1]==='repos/o/r/issues/comments/5') return JSON.stringify({html_url:'https://github.com/o/r/issues/1#issuecomment-5'});
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
      if(args.includes('--number')) {
        assert.match(args.at(-1),/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/,'native gh requires a decimal float argument');
        it.fieldValues.nodes.push(value(f.name,{number:Number(args.at(-1))}));
      }
      return '{}';
    }
    if(args[0]==='issue'&&args[1]==='create') return 'Creating issue\nhttps://github.com/o/r/issues/9\n';
    if(args[0]==='project'&&args[1]==='item-add') {state.push(item('PVTI_9',9,[]));return JSON.stringify({id:'PVTI_9'});}
    if(args[0]==='issue'&&args[1]==='view') return JSON.stringify({body:'Do it',comments:[{author:{login:'a'},createdAt:'2026-10-16T00:00:00Z',body:'hi',url:'u'}]});
    if(args[0]==='issue'&&args[1]==='comment') return 'https://github.com/o/r/issues/1#issuecomment-5\n';
    throw Error(`unexpected gh ${args.join(' ')}`);
  };
  return {gh,calls,inputs,state};
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
  const {gh,calls}=board(),k=kanban({gh});
  const shown=await k.show({board:'o/2'},['o/r#1']);
  assert.equal(shown.body,'Do it');assert.equal(shown.comments[0].author,'a');
  assert.deepEqual(await k.comment({board:'o/2',body:'Done: see PR'},['PVTI_1']),{card:'PVTI_1',ref:'o/r#1',comment:'https://github.com/o/r/issues/1#issuecomment-5'});
  const write=calls.findIndex(a=>a[0]==='issue'&&a[1]==='comment');
  assert.deepEqual(calls[write+1],['api','repos/o/r/issues/comments/5']);
  await assert.rejects(k.comment({board:'o/2'},['PVTI_1']),/--body/);
});
test('argument errors and help',async()=>{
  assert.throws(()=>parseBoard('o'),/OWNER\/NUMBER/);
  assert.throws(()=>pairs(['x']),/NAME=VALUE/);
  assert.match(await main([],async()=>''),/ez kanban/);
  await assert.rejects(main(['delete','--board','o/2'],async()=>''),/Unknown command delete/);
  await assert.rejects(main(['list'],async()=>''),/--board/);
});

test('invalid add options and values cause no writes',async()=>{
  for(const options of [
    {column:'Typo'},
    {set:['Status=Typo']},
    {set:['Due date=tomorrow']},
    {set:['Due date=2026-02-31']},
    {set:['Points=nope']},
    {set:['Points= ']},
    {set:['Nope=1']},
  ]) {
    const {gh,calls}=board();
    await assert.rejects(kanban({gh}).add({board:'o/2',repo:'o/r',title:'New',...options}));
    assert.equal(calls.filter(a=>a[0]!=='api').length,0);
  }
});
test('set validates the whole batch before its first write',async()=>{
  const {gh,calls}=board();
  await assert.rejects(kanban({gh}).set({board:'o/2'},['o/r#1','Role=Researcher','Status=Typo']),/not an option/);
  assert.equal(calls.filter(a=>a[0]!=='api').length,0);
});
test('number readback accepts canonical values and clearing',async()=>{
  const {gh}=board(),k=kanban({gh});
  for(const [input,expected] of [['1.0',1],['1e2',100],['0',0],[' 1 ',1],['0x10',16]]) {
    const out=await k.set({board:'o/2'},['o/r#1',`Points=${input}`]);
    assert.equal(out.fields.Points,expected);
  }
  assert.equal((await k.set({board:'o/2'},['o/r#1','Points='])).fields.Points,undefined);
});
test('comment fails when provider readback does not match',async()=>{
  const fake=board();
  const gh=async args=>args[0]==='api'&&args[1]==='repos/o/r/issues/comments/5'
    ?JSON.stringify({html_url:'https://github.com/o/r/issues/1#issuecomment-6'}):fake.gh(args);
  await assert.rejects(kanban({gh}).comment({board:'o/2',body:'Done'},['o/r#1']),/Comment readback/);
});

// Claim races: a fake comment thread with ever-growing ids, on top of the board fake.
function claimBoard(comments=[]) {
  const fake=fakeGh([item('PVTI_2',2,[value('Status',{name:'Ready'})],{updatedAt:'2026-10-16T00:00:00Z'})]),thread=[...comments];let id=100;
  const gh=async args=>{
    if(args[0]==='api'&&args[1]==='repos/o/r/issues/2/comments') {
      const created=new Date(Date.parse('2026-10-16T01:00:00Z')+thread.length*1000).toISOString(),body=args.find(a=>a.startsWith('body=')).slice(5);
      const c={id:++id,body,created_at:created,html_url:`https://github.com/o/r/issues/2#issuecomment-${id}`};thread.push(c);return JSON.stringify(c);
    }
    if(args[0]==='api'&&args[1].startsWith('repos/o/r/issues/2/comments?')) return JSON.stringify(thread.filter(c=>c.created_at>=new URL('http://x/'+args[1]).searchParams.get('since')));
    return fake.gh(args);
  };
  return {gh,thread,calls:fake.calls};
}
const claim={board:'o/2',by:'lane-5 (Claude)',from:'Ready',to:'Done'};
const moves=calls=>calls.filter(a=>a[1]==='item-edit').length;

test('two workers racing for one card: exactly one claims, the other sees it lost',async()=>{
  const {gh,calls}=claimBoard(),k=kanban({gh});
  const results=await Promise.all([k.claim(claim,['o/r#2']),k.claim({...claim,by:'lane-5 (Codex)'},['o/r#2'])]);
  const won=results.filter(r=>r.claimed),lost=results.filter(r=>!r.claimed);
  assert.equal(won.length,1);assert.equal(lost.length,1);
  assert.equal(won[0].fields.Status,'Done');assert.equal(lost[0].reason,'lost');
  assert.equal(lost[0].winner,won[0].comment);assert.equal(typeof lost[0].winnerAgeSeconds,'number');
  assert.equal(moves(calls),1);
});
test('claim ignores a stale claim from before the card was released and leaves a card already taken',async()=>{
  const stale={id:7,body:`Claimed by old.\n\n${CLAIM_MARKER}`,created_at:'2026-10-10T00:00:00Z',html_url:'https://github.com/o/r/issues/2#issuecomment-7'};
  const {gh,calls,thread}=claimBoard([stale]),k=kanban({gh});
  const out=await k.claim(claim,['o/r#2']);
  assert.equal(out.claimed,true);assert.equal(moves(calls),1);
  assert.match(thread.at(-1).body,/^Claimed by lane-5 \(Claude\) at \d{4}-.*\.\n\n<!-- ez-kanban-claim -->$/);
  const again=await kanban({gh}).claim(claim,['o/r#2']);
  assert.deepEqual([again.claimed,again.reason,again.column],[false,'not-in-column','Done']);
  assert.equal(moves(calls),1);
  assert.equal(thread.length,2);
});
test('a claim that lost to an old winner reports the winner\'s age and moves nothing',async()=>{
  const dead={id:7,body:`Claimed by dead worker.\n\n${CLAIM_MARKER}`,created_at:'2026-10-16T00:30:00Z',html_url:'https://github.com/o/r/issues/2#issuecomment-7'};
  const {gh,calls}=claimBoard([dead]);
  const out=await kanban({gh}).claim(claim,['o/r#2']);
  assert.deepEqual([out.claimed,out.reason,out.winner,out.winnerAgeSeconds],[false,'lost',dead.html_url,1801]);
  assert.equal(moves(calls),0);
});
test('claim validates its arguments before any write; a lost claim exits 3',async()=>{
  const {gh,calls}=claimBoard();
  await assert.rejects(kanban({gh}).claim({board:'o/2',from:'Ready',to:'Done'},['o/r#2']),/--by/);
  await assert.rejects(kanban({gh}).claim({...claim,to:'Doing'},['o/r#2']),/not an option of Status/);
  assert.equal(calls.filter(a=>a[0]!=='api').length,0);
  assert.equal(exitCodeFor('{"claimed":false}'),3);assert.equal(exitCodeFor('{"claimed":true}'),0);assert.equal(exitCodeFor('usage'),0);
});

test('--body-file is read by the plugin and sent to gh on stdin; stdin works with -; an unreadable or empty body writes nothing',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'kanban-'));
  const file=join(dir,'brief.md'),empty=join(dir,'empty.md'),long='x'.repeat(200000);
  await writeFile(file,long);await writeFile(empty,' \n');
  const {gh,calls,inputs}=board();
  const k=kanban({gh,stdin:async()=>'From stdin'});
  await k.add({board:'o/2',repo:'o/r',title:'New','body-file':file});
  assert.deepEqual(calls.find(a=>a[1]==='create'),['issue','create','--repo','o/r','--title','New','--body-file','-']);
  assert.equal(inputs[0],long);
  await k.comment({board:'o/2','body-file':'-'},['PVTI_1']);
  assert.deepEqual(calls.find(a=>a[1]==='comment').slice(-2),['--body-file','-']);
  assert.equal(inputs[1],'From stdin');
  const before=calls.length;
  for(const [options,message] of [[{'body-file':join(dir,'missing.md')},/Cannot read --body-file .*missing\.md/],[{'body-file':empty},/empty\.md is empty/]]) {
    await assert.rejects(k.comment({board:'o/2',...options},['PVTI_1']),message);
    await assert.rejects(k.add({board:'o/2',repo:'o/r',title:'X',...options}),message);
  }
  await assert.rejects(kanban({gh,stdin:async()=>''}).comment({board:'o/2','body-file':'-'},['PVTI_1']),/stdin is empty/);
  assert.equal(calls.length,before);
});
