#!/usr/bin/env node
// Basic kanban for agents: board, list, show, add, move, set, comment.
// The verbs are tracker-neutral; this adapter stores the board in a GitHub
// Project (v2) through the private gh profile. Another tracker can provide the
// same verbs and output shape. No workflow rules, gates or routing live here.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

const ITEM=`fragment I on ProjectV2Item{id isArchived content{__typename ...on Issue{number title url state repository{nameWithOwner}} ...on PullRequest{number title url prState:state repository{nameWithOwner}} ...on DraftIssue{title}} fieldValues(first:50){nodes{
...on ProjectV2ItemFieldSingleSelectValue{name field{...on ProjectV2FieldCommon{name}}}
...on ProjectV2ItemFieldTextValue{text field{...on ProjectV2FieldCommon{name}}}
...on ProjectV2ItemFieldDateValue{date field{...on ProjectV2FieldCommon{name}}}
...on ProjectV2ItemFieldNumberValue{number field{...on ProjectV2FieldCommon{name}}}
...on ProjectV2ItemFieldIterationValue{title field{...on ProjectV2FieldCommon{name}}}}}}`;
const PROJECT=`fragment P on ProjectV2{id title fields(first:100){nodes{...on ProjectV2FieldCommon{id name dataType} ...on ProjectV2SingleSelectField{options{id name}}}} items(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{...I}}}`;
const BOARD=`query($owner:String!,$number:Int!,$after:String){repositoryOwner(login:$owner){...on User{projectV2(number:$number){...P}} ...on Organization{projectV2(number:$number){...P}}}} ${PROJECT} ${ITEM}`;
const NODE=`query($id:ID!){node(id:$id){...I}} ${ITEM}`;
export const HELP=`ez kanban <command> --board OWNER/NUMBER [options]
  board                         columns and fields
  list [--column C] [--field NAME=VALUE]...   cards (no bodies)
  show CARD                     card with body and comments
  add --repo OWNER/REPO --title T [--body T | --body-file F] [--column C] [--set NAME=VALUE]...
  move CARD COLUMN              change the card's column, read back
  set CARD NAME=VALUE...        change fields (text, date YYYY-MM-DD, number, option); NAME= clears
  comment CARD (--body T | --body-file F)
CARD is the card id from list, OWNER/REPO#N or the issue/PR URL. --column-field
names the column field (default Status). Output is JSON; errors exit 1.`;

const plain=item=>{
  const c=item.content??{},fields={};
  for(const v of item.fieldValues?.nodes??[]) if(v?.field?.name && v.field.name!=='Title') fields[v.field.name]=v.name??v.text??v.date??v.number??v.title??null;
  return {card:item.id,type:c.__typename==='DraftIssue'?'draft':c.__typename==='PullRequest'?'pr':'issue',
    ref:c.repository?`${c.repository.nameWithOwner}#${c.number}`:null,url:c.url??null,title:c.title??null,
    state:(c.state??c.prState)?.toLowerCase()??null,archived:!!item.isArchived,fields};
};
export function parseBoard(text) {
  const m=/^([A-Za-z0-9-]+)\/(\d+)$/.exec(text??'');
  if(!m) throw Error('Use --board OWNER/NUMBER');
  return {owner:m[1],number:Number(m[2])};
}
export function kanban({gh,columnField='Status'}) {
  const json=async args=>JSON.parse(await gh(args));
  const gql=async(query,vars)=>{
    const value=await json(['api','graphql','-f',`query=${query}`,...Object.entries(vars).flatMap(([k,v])=>[typeof v==='number'?'-F':'-f',`${k}=${v}`])]);
    if(value.errors?.length) throw Error(`GitHub: ${value.errors[0].message}`);
    return value.data;
  };
  const read=async board=>{
    const {owner,number}=parseBoard(board);let after,project,items=[];
    do {
      const data=await gql(BOARD,{owner,number,...(after?{after}:{})});
      project=data.repositoryOwner?.projectV2;
      if(!project) throw Error(`Board ${board} not found or not readable`);
      items.push(...project.items.nodes);
      after=project.items.pageInfo.hasNextPage?project.items.pageInfo.endCursor:null;
    } while(after);
    const fields=project.fields.nodes.filter(f=>f?.name);
    return {owner,number,id:project.id,title:project.title,fields,items:items.map(plain)};
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
  const body=o=>o.body!==undefined?['--body',o.body]:o['body-file']!==undefined?['--body-file',o['body-file']]:null;
  return {
    async board(o) {const b=await read(o.board);return {board:o.board,title:b.title,columns:field(b,columnField).options?.map(x=>x.name)??[],fields:b.fields.map(f=>({name:f.name,type:f.dataType.toLowerCase(),...(f.options?{options:f.options.map(x=>x.name)}:{})}))};},
    async list(o) {
      const b=await read(o.board),filters=pairs(o.field);
      if(o.column) filters.push([columnField,o.column]);
      return b.items.filter(x=>!x.archived&&filters.every(([n,v])=>String(x.fields[field(b,n).name]??'').toLowerCase()===v.toLowerCase()));
    },
    async show(o,[ref]) {
      const card=find(await read(o.board),ref);
      if(card.type==='draft') return card;
      const detail=await json([card.type==='pr'?'pr':'issue','view',card.url,'--json','body,comments']);
      return {...card,body:detail.body,comments:(detail.comments??[]).map(c=>({author:c.author?.login??null,at:c.createdAt,body:c.body,url:c.url}))};
    },
    async add(o) {
      if(!/^[\w.-]+\/[\w.-]+$/.test(o.repo??'')||!o.title) throw Error('add needs --repo OWNER/REPO and --title');
      const b=await read(o.board);
      const pre=[...(o.column?[[columnField,o.column]]:[]),...pairs(o.set)];
      for(const [name,value] of pre) editArgs(b,name,value);
      const url=(await gh(['issue','create','--repo',o.repo,'--title',o.title,...(body(o)??['--body',''])])).trim().split('\n').pop();
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
      const text=body(o);if(!text) throw Error('comment needs --body or --body-file');
      const card=find(await read(o.board),ref);
      if(card.type==='draft') throw Error('Draft cards take no comments; convert it to an issue');
      const url=(await gh([card.type==='pr'?'pr':'issue','comment',card.url,...text])).trim();
      const id=/#issuecomment-(\d+)$/.exec(url)?.[1];
      if(!id) throw Error('Comment write returned no comment id');
      const saved=await json(['api',`repos/${card.ref.split('#')[0]}/issues/comments/${id}`]);
      if(saved.html_url!==url) throw Error('Comment readback did not match the created comment');
      return {card:card.card,ref:card.ref,comment:saved.html_url};
    },
  };
}
export function pairs(values=[]) {
  return values.map(s=>{const at=s.indexOf('=');if(at<1) throw Error(`Use NAME=VALUE, not "${s}"`);return [s.slice(0,at),s.slice(at+1)];});
}
export async function main(argv,gh) {
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{
    board:{type:'string'},column:{type:'string'},'column-field':{type:'string'},field:{type:'string',multiple:true},
    set:{type:'string',multiple:true},repo:{type:'string'},title:{type:'string'},body:{type:'string'},'body-file':{type:'string'},help:{type:'boolean'}}});
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
  return async args=>{
    try {return (await run('gh',args,{env,maxBuffer:32*1024*1024,timeout:60000})).stdout;}
    catch(error) {throw Error((error.stderr||error.message||'gh failed').toString().trim().split('\n').pop());}
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {console.log(await main(process.argv.slice(2),nativeGh()));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
