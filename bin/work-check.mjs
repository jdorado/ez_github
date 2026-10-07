#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

const query=`query($project:ID!,$after:String){node(id:$project){...on ProjectV2{fields(first:100){nodes{...on ProjectV2FieldCommon{name}}pageInfo{hasNextPage}}items(first:100,after:$after){nodes{id isArchived updatedAt fieldValues(first:100){nodes{...on ProjectV2ItemFieldSingleSelectValue{name field{...on ProjectV2FieldCommon{name}}}...on ProjectV2ItemFieldTextValue{text field{...on ProjectV2FieldCommon{name}}}}pageInfo{hasNextPage}}content{...on Issue{body state updatedAt}...on DraftIssue{body updatedAt}...on PullRequest{body state updatedAt}}}pageInfo{hasNextPage endCursor}}}}}`;
export function selectWork(items,fields,filters,requireMetadata=false,now=Date.now()) {
 if(filters.some(([name])=>!fields.includes(name))) throw Error('Configured Project field is unavailable');
 const candidates=[];
 for(const item of items) {
  if(item.fieldValues?.pageInfo?.hasNextPage) throw Error('Incomplete item field coverage');
  if(item.isArchived || item.content?.state==='CLOSED') continue;
  const values=Object.fromEntries(item.fieldValues.nodes.filter(v=>v.field).map(v=>[v.field.name,v.name??v.text]));
  if(!filters.every(([name,value])=>values[name]===value)) continue;
  let metadata;
  const blocks=[...(item.content?.body??'').matchAll(/```ez-work\s*\n([\s\S]*?)\n```/g)];
  if(blocks.length>1) throw Error('Ambiguous task metadata');
  if(blocks.length) {
   metadata=JSON.parse(blocks[0][1]);
   if(metadata.schemaVersion!==1 || typeof metadata.identity!=='string' || !metadata.identity.trim()) throw Error('Invalid task metadata');
   for(const key of ['notBefore','freshUntil']) if(metadata[key]!==undefined && (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(metadata[key]) || !Number.isFinite(Date.parse(metadata[key])))) throw Error('Invalid task clock');
  }
  if(requireMetadata && (!metadata || !metadata.freshUntil)) continue;
  if(metadata?.notBefore && Date.parse(metadata.notBefore)>now) continue;
  if(metadata?.freshUntil && Date.parse(metadata.freshUntil)<now) continue;
  candidates.push({id:item.id,updatedAt:item.updatedAt,contentUpdatedAt:item.content?.updatedAt,fields:values,...(metadata ? {identity:metadata.identity,notBefore:metadata.notBefore,freshUntil:metadata.freshUntil} : {})});
 }
 candidates.sort((a,b)=>a.id.localeCompare(b.id));
 return {schemaVersion:1,eligible:candidates.length>0,count:candidates.length,observedAt:new Date(now).toISOString(),fingerprint:createHash('sha256').update(JSON.stringify(candidates)).digest('hex'),items:candidates.map(i=>({id:i.id,...(i.identity?{identity:i.identity}:{})}))};
}
export async function checkProject(project,filters,requireMetadata,run=promisify(execFile)) {
 if(typeof project!=='string' || !/^PVT_[A-Za-z0-9_-]+$/.test(project)) throw Error('Supply the exact Project node ID');
 const env={...process.env};for(const key of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN'])delete env[key];
 const items=[],seen=new Set();let after,fields;
 do {
  const args=['api','graphql','-f',`query=${query}`,'-f',`project=${project}`,...(after?['-f',`after=${after}`]:[])];
  const {stdout}=await run('gh',args,{env,maxBuffer:16*1024*1024,timeout:30000});const value=JSON.parse(stdout),node=value.data?.node;
  if(value.errors?.length || !node?.items || node.fields.pageInfo.hasNextPage) throw Error('Project read incomplete or unavailable');
  fields=node.fields.nodes.map(f=>f.name);for(const item of node.items.nodes){if(seen.has(item.id))throw Error('Repeated Project item');seen.add(item.id);items.push(item);}
  if(!node.items.pageInfo.hasNextPage)break;
  const next=node.items.pageInfo.endCursor;if(!next || next===after)throw Error('Invalid Project cursor');after=next;
 }while(true);
 return selectWork(items,fields,filters,requireMetadata);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const {values:v}=parseArgs({options:{project:{type:'string'},field:{type:'string',multiple:true},'require-metadata':{type:'boolean'},help:{type:'boolean'}}});
  if(v.help)console.log('ez github-work --project PROJECT_NODE_ID [--field NAME=VALUE] [--require-metadata]\nRead-only complete Project queue preflight. Emits schemaVersion, eligible, count, fingerprint, observedAt and item IDs. Task metadata is optional fenced ez-work JSON: schemaVersion:1, identity, notBefore, freshUntil. --require-metadata requires freshUntil; expired/future tasks are ineligible. Errors never mean empty queue.');
  else {
   const filters=(v.field??[]).map(s=>{const at=s.indexOf('=');if(at<1 || at===s.length-1)throw Error('Use --field NAME=VALUE');return [s.slice(0,at),s.slice(at+1)];});
   console.log(JSON.stringify(await checkProject(v.project,filters,v['require-metadata'])));
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
