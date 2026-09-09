import {test} from 'node:test';
import assert from 'node:assert/strict';
import {command} from '../bin/github.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
test('native arguments remain literal',()=>{
  assert.deepEqual(command(['git','commit','-m','$(touch /tmp/oops); spaces']),['git',['commit','-m','$(touch /tmp/oops); spaces']]);
});
test('subprocess preserves literal arguments, strips ambient tokens, and propagates failure',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ez-github-test-'));
  try {
    writeFileSync(join(dir,'gh'),'#!/usr/bin/env node\nconsole.log(JSON.stringify({args:process.argv.slice(2),tokens:[process.env.GH_TOKEN,process.env.GITHUB_TOKEN,process.env.GH_ENTERPRISE_TOKEN,process.env.GITHUB_ENTERPRISE_TOKEN]}));process.exit(17);\n',{mode:0o700});
    const args=['api','repos/a/b','--field','x=$(touch /tmp/should-not-exist); `id`'];
    const result=spawnSync(process.execPath,[resolve('bin/github.mjs'),'gh',...args],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,GH_TOKEN:'synthetic',GITHUB_TOKEN:'synthetic',GH_ENTERPRISE_TOKEN:'synthetic',GITHUB_ENTERPRISE_TOKEN:'synthetic'}});
    assert.equal(result.status,17);
    assert.deepEqual(JSON.parse(result.stdout),{args,tokens:[null,null,null,null]});
    assert.ok(!result.stdout.includes('synthetic'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('unknown command fails without executing',()=>{
  const result=spawnSync(process.execPath,[resolve('bin/github.mjs'),'sh','-c','exit 0'],{encoding:'utf8'});
  assert.equal(result.status,1);
});
test('termination reaches the native child',async()=>{
  const child=spawn(process.execPath,[resolve('bin/github.mjs'),'git','-c','alias.wait=!echo ready; sleep 30','wait'],{stdio:['ignore','pipe','pipe']});
  await once(child.stdout,'data');
  child.kill('SIGTERM');
  const deadline=setTimeout(()=>child.kill('SIGKILL'),4000);
  const [code]=await once(child,'close');clearTimeout(deadline);
  assert.equal(code,143);
});
test('no arbitrary executable or shell route',()=>{
  for(const tool of ['sh','bash','../git','execute']) assert.throws(()=>command([tool]));
});
