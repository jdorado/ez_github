#!/usr/bin/env node
// Basic kanban for agents: board, list, show, add, move, set, comment.
// The verbs are tracker-neutral; this adapter stores the board in a GitHub
// Project (v2) through the private gh profile. Another tracker can provide the
// same verbs and output shape. No workflow rules, gates or routing live here.
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

const ITEM=`fragment I on ProjectV2Item{id isArchived updatedAt content{__typename ...on Issue{number title url state repository{nameWithOwner}} ...on PullRequest{number title url prState:state repository{nameWithOwner}} ...on DraftIssue{title}} fieldValues(first:100){pageInfo{hasNextPage} nodes{
...on ProjectV2ItemFieldSingleSelectValue{name field{...on ProjectV2FieldCommon{name}}}
...on ProjectV2ItemFieldTextValue{text field{...on ProjectV2FieldCommon{name}}}
...on ProjectV2ItemFieldDateValue{date field{...on ProjectV2FieldCommon{name}}}
...on ProjectV2ItemFieldNumberValue{number field{...on ProjectV2FieldCommon{name}}}
...on ProjectV2ItemFieldIterationValue{title field{...on ProjectV2FieldCommon{name}}}}}}`;
const PROJECT=`fragment P on ProjectV2{id title fields(first:100){pageInfo{hasNextPage} nodes{...on ProjectV2FieldCommon{id name dataType} ...on ProjectV2SingleSelectField{options{id name}}}} items(first:100,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{...I}}}`;
const BOARD=`query($owner:String!,$number:Int!,$after:String){repositoryOwner(login:$owner){...on User{projectV2(number:$number){...P}} ...on Organization{projectV2(number:$number){...P}}}} ${PROJECT} ${ITEM}`;
const NODE=`query($id:ID!){node(id:$id){...I}} ${ITEM}`;
export const HELP=`ez kanban <command> --board OWNER/NUMBER [options]
  board                         columns and fields
  list [--column C] [--field NAME=VALUE]...   {read,totalCount,count,items}: cards (no bodies)
  show CARD                     card with body and comments
  add --repo OWNER/REPO --title T [--body T | --body-file F|-] [--column C] [--set NAME=VALUE]...
  move CARD COLUMN              change the card's column, read back
  set CARD NAME=VALUE...        change fields (text, date YYYY-MM-DD, number, option); NAME= clears
  comment CARD (--body T | --body-file F|-)
  claim CARD --by WHO --from COLUMN --to COLUMN [--note T]   take a card; exactly one concurrent claimant wins
CARD is the card id from list, OWNER/REPO#N or the issue/PR URL. --column-field
names the column field (default Status). --body-file is read by this command (a missing, unreadable or
empty file is an error; F must be a path this command can see, - reads stdin), so a long body needs no argument.
Reading a board fails (exit 1) unless
the items read equal the Project's totalCount. Output is JSON; errors exit 1. claim exits 3 when another
worker holds the card ({"claimed":false}): leave that card alone and pick another. A lost claim
reports winnerAgeSeconds, how long ago the winning claim was posted.`;

const plain=item=>{
  const c=item.content??{},fields={};
  for(const v of item.fieldValues?.nodes??[]) if(v?.field?.name && v.field.name!=='Title') fields[v.field.name]=v.name??v.text??v.date??v.number??v.title??null;
  return {card:item.id,type:c.__typename==='DraftIssue'?'draft':c.__typename==='PullRequest'?'pr':'issue',
    ref:c.repository?`${c.repository.nameWithOwner}#${c.number}`:null,url:c.url??null,title:c.title??null,
    state:(c.state??c.prState)?.toLowerCase()??null,archived:!!item.isArchived,...(item.updatedAt?{updatedAt:item.updatedAt}:{}),fields};
};
export function parseBoard(text) {
  const m=/^([A-Za-z0-9-]+)\/(\d+)$/.exec(text??'');
  if(!m) throw Error('Use --board OWNER/NUMBER');
  return {owner:m[1],number:Number(m[2])};
}
// A claim is a comment carrying this marker. Comment ids only grow, so of all claims made since the card last
// changed, the lowest id is the winner whichever order the claimants read back in.
export const CLAIM_MARKER='<!-- ez-kanban-claim -->';
export const readStdin=async()=>{let text='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin) text+=chunk;return text;};
export function kanban({gh,columnField='Status',stdin=readStdin}) {
  const json=async args=>JSON.parse(await gh(args));
  const gql=async(query,vars)=>{
    const value=await json(['api','graphql','-f',`query=${query}`,...Object.entries(vars).flatMap(([k,v])=>[typeof v==='number'?'-F':'-f',`${k}=${v}`])]);
    if(value.errors?.length) throw Error(`GitHub: ${value.errors[0].message}`);
    return value.data;
  };
  const read=async board=>{
    const {owner,number}=parseBoard(board);let after,project,items=[],totalCount;
    do {
      const data=await gql(BOARD,{owner,number,...(after?{after}:{})});
      project=data.repositoryOwner?.projectV2;
      if(!project) throw Error(`Board ${board} not found or not readable`);
      items.push(...project.items.nodes);totalCount=project.items.totalCount;
      after=project.items.pageInfo.hasNextPage?project.items.pageInfo.endCursor:null;
    } while(after);
    // Never hand back part of a board as the whole: the items read must equal the Project's own count.
    if(items.length!==totalCount) throw Error(`Board ${board}: read ${items.length} of ${totalCount} items`);
    if(project.fields.pageInfo.hasNextPage) throw Error(`Board ${board} has more than 100 fields; not all were read`);
    const over=items.find(x=>x?.fieldValues?.pageInfo?.hasNextPage);
    if(over) throw Error(`Board ${board}: item ${over.id} has more than 100 field values; not all were read`);
    const fields=project.fields.nodes.filter(f=>f?.name);
    return {owner,number,id:project.id,title:project.title,totalCount,fields,items:items.map(plain)};
  };
  const field=(b,name)=>{const f=b.fields.find(x=>x.name.toLowerCase()===name.toLowerCase());if(!f) throw Error(`No field "${name}" on this board`);return f;};
  const find=(b,ref)=>{
    const url=/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/.exec(ref??'');
    const key=url?`${url[1]}#${url[2]}`:ref;
    const card=b.items.find(x=>x.card===ref||x.ref?.toLowerCase()===key?.toLowerCase());
    if(!card) throw Error(`Card ${ref} is not on this board`);
    return card;
  };
  const readback=async id=>plain((await gql(NODE,{id})).node);
  const editArgs=(b,name,value)=>{
    const f=field(b,name),base=['--field-id',f.id];
    if(value==='') return [...base,'--clear'];
    if(f.dataType==='SINGLE_SELECT') {
      const o=f.options.find(x=>x.name.toLowerCase()===value.toLowerCase());
      if(!o) throw Error(`"${value}" is not an option of ${f.name}: ${f.options.map(x=>x.name).join(', ')}`);
      return [...base,'--single-select-option-id',o.id];
    }
    if(f.dataType==='DATE' && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)) throw Error(`${f.name} takes a date YYYY-MM-DD`);
    if(f.dataType==='NUMBER' && (!value.trim()||!Number.isFinite(Number(value)))) throw Error(`${f.name} takes a number`);
    const flag={TEXT:'--text',DATE:'--date',NUMBER:'--number'}[f.dataType];
    if(!flag) throw Error(`${f.name} (${f.dataType}) cannot be set here`);
    return [...base,flag,f.dataType==='NUMBER'?String(Number(value)):value];
  };
  const setAll=async(b,card,pairs)=>{
    const edits=pairs.map(([name,value])=>editArgs(b,name,value));
    for(const args of edits) await gh(['project','item-edit','--id',card,'--project-id',b.id,...args]);
    const after=await readback(card);
    for(const [name,value] of pairs) {
      const f=field(b,name),got=after.fields[f.name]??'';
      const matches=f.dataType==='NUMBER'&&value!==''?typeof got==='number'&&got===Number(value):String(got).toLowerCase()===String(value).toLowerCase();
      if(!matches) throw Error(`Readback: ${name} is "${got}", expected "${value}"`);
    }
    return after;
  };
  // --body is passed as is. --body-file is read here, never handed to gh as a path: gh runs where the caller's
  // file may not exist. The text goes to gh on stdin, so its length is not an argument.
  const body=async o=>{
    const file=o['body-file'];
    if(o.body!==undefined||file===undefined) return o.body!==undefined?{args:['--body',o.body]}:null;
    const name=file==='-'?'stdin':file;
    let text;
    try {text=file==='-'?await stdin():await readFile(file,'utf8');} catch(error) {throw Error(`Cannot read --body-file ${name}: ${error.message}`);}
    if(!text.trim()) throw Error(`--body-file ${name} is empty`);
    return {args:['--body-file','-'],input:text};
  };
  return {
    async board(o) {const b=await read(o.board);return {board:o.board,title:b.title,read:b.items.length,totalCount:b.totalCount,columns:field(b,columnField).options?.map(x=>x.name)??[],fields:b.fields.map(f=>({name:f.name,type:f.dataType.toLowerCase(),...(f.options?{options:f.options.map(x=>x.name)}:{})}))};},
    async list(o) {
      const b=await read(o.board),filters=pairs(o.field);
      if(o.column) filters.push([columnField,o.column]);
      const items=b.items.filter(x=>!x.archived&&filters.every(([n,v])=>String(x.fields[field(b,n).name]??'').toLowerCase()===v.toLowerCase()));
      return {read:b.items.length,totalCount:b.totalCount,count:items.length,items};
    },
    async show(o,[ref]) {
      const card=find(await read(o.board),ref);
      if(card.type==='draft') return card;
      const detail=await json([card.type==='pr'?'pr':'issue','view',card.url,'--json','body,comments']);
      return {...card,body:detail.body,comments:(detail.comments??[]).map(c=>({author:c.author?.login??null,at:c.createdAt,body:c.body,url:c.url}))};
    },
    async add(o) {
      if(!/^[\w.-]+\/[\w.-]+$/.test(o.repo??'')||!o.title) throw Error('add needs --repo OWNER/REPO and --title');
      const text=await body(o);
      const b=await read(o.board);
      const pre=[...(o.column?[[columnField,o.column]]:[]),...pairs(o.set)];
      for(const [name,value] of pre) editArgs(b,name,value);
      const url=(await gh(['issue','create','--repo',o.repo,'--title',o.title,...(text?.args??['--body',''])],text?.input)).trim().split('\n').pop();
      const {id}=await json(['project','item-add',String(b.number),'--owner',b.owner,'--url',url,'--format','json']);
      return pre.length?setAll(b,id,pre):readback(id);
    },
    async move(o,[ref,column]) {
      if(!ref||!column) throw Error('move needs CARD and COLUMN');
      const b=await read(o.board);return setAll(b,find(b,ref).card,[[columnField,column]]);
    },
    async set(o,[ref,...rest]) {
      const list=pairs(rest);if(!ref||!list.length) throw Error('set needs CARD and NAME=VALUE');
      const b=await read(o.board);return setAll(b,find(b,ref).card,list);
    },
    async comment(o,[ref]) {
      const text=await body(o);if(!text) throw Error('comment needs --body or --body-file');
      const card=find(await read(o.board),ref);
      if(card.type==='draft') throw Error('Draft cards take no comments; convert it to an issue');
      const url=(await gh([card.type==='pr'?'pr':'issue','comment',card.url,...text.args],text.input)).trim();
      const id=/#issuecomment-(\d+)$/.exec(url)?.[1];
      if(!id) throw Error('Comment write returned no comment id');
      const saved=await json(['api',`repos/${card.ref.split('#')[0]}/issues/comments/${id}`]);
      if(saved.html_url!==url) throw Error('Comment readback did not match the created comment');
      return {card:card.card,ref:card.ref,comment:saved.html_url};
    },
    // GitHub has no compare-and-set on Project fields, so the claim is decided by the comment thread: post a
    // claim, read the claims made since the card last changed, and only the lowest comment id moves the card.
    async claim(o,[ref]) {
      const {by,from,to,note}=o;
      if(!ref||!by?.trim()||!from||!to) throw Error('claim needs CARD, --by, --from and --to');
      const b=await read(o.board),card=find(b,ref);
      if(card.type==='draft') throw Error('Draft cards take no comments; convert it to an issue');
      editArgs(b,columnField,from);editArgs(b,columnField,to);
      const column=card.fields[field(b,columnField).name]??null;
      if(String(column??'').toLowerCase()!==from.toLowerCase()) return {claimed:false,reason:'not-in-column',card:card.card,ref:card.ref,column};
      const [repo,number]=card.ref.split('#'),comments=`repos/${repo}/issues/${number}/comments`;
      const mine=await json(['api',comments,'-f',`body=Claimed by ${by.trim()} at ${new Date().toISOString()}.${note?`\n\n${note}`:''}\n\n${CLAIM_MARKER}`]);
      const since=card.updatedAt??'1970-01-01T00:00:00Z';
      const claims=(await json(['api',`${comments}?per_page=100&since=${since}`])).filter(c=>c.body?.includes(CLAIM_MARKER)&&Date.parse(c.created_at)>=Date.parse(since)).sort((x,y)=>x.id-y.id);
      if(!claims.some(c=>c.id===mine.id)) throw Error('Claim readback did not find the claim comment');
      // The winner's age is read on GitHub's clock (our comment was created just now), so no local clock is involved.
      if(claims[0].id!==mine.id) return {claimed:false,reason:'lost',card:card.card,ref:card.ref,winner:claims[0].html_url,winnerAgeSeconds:Math.max(0,Math.round((Date.parse(mine.created_at)-Date.parse(claims[0].created_at))/1000)),comment:mine.html_url};
      return {claimed:true,comment:mine.html_url,...await setAll(b,card.card,[[columnField,to]])};
    },
  };
}
export function pairs(values=[]) {
  return values.map(s=>{const at=s.indexOf('=');if(at<1) throw Error(`Use NAME=VALUE, not "${s}"`);return [s.slice(0,at),s.slice(at+1)];});
}
export const exitCodeFor=text=>{try {return JSON.parse(text).claimed===false?3:0;} catch {return 0;}};
export async function main(argv,gh) {
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{
    board:{type:'string'},column:{type:'string'},'column-field':{type:'string'},field:{type:'string',multiple:true},
    set:{type:'string',multiple:true},by:{type:'string'},from:{type:'string'},to:{type:'string'},note:{type:'string'},repo:{type:'string'},title:{type:'string'},body:{type:'string'},'body-file':{type:'string'},help:{type:'boolean'}}});
  const [verb,...rest]=positionals;
  if(values.help||!verb) return HELP;
  const k=kanban({gh,columnField:values['column-field']});
  if(!Object.hasOwn(k,verb)) throw Error(`Unknown command ${verb}. ${HELP}`);
  return JSON.stringify(await k[verb](values,rest),null,2);
}
export function nativeGh() {
  const env={...process.env};
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN']) delete env[key];
  const run=promisify(execFile);
  return async(args,input)=>{
    try {
      const call=run('gh',args,{env,maxBuffer:32*1024*1024,timeout:60000});
      if(input!==undefined) call.child.stdin.end(input);
      return (await call).stdout;
    }
    catch(error) {throw Error((error.stderr||error.message||'gh failed').toString().trim().split('\n').pop());}
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {const out=await main(process.argv.slice(2),nativeGh());console.log(out);process.exitCode=exitCodeFor(out);}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
