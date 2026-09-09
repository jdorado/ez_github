import {test} from 'node:test';
import assert from 'node:assert/strict';
import {command} from '../bin/github.mjs';
test('native arguments remain literal',()=>{
  assert.deepEqual(command(['git','commit','-m','$(touch /tmp/oops); spaces']),['git',['commit','-m','$(touch /tmp/oops); spaces']]);
});
test('no arbitrary executable or shell route',()=>{
  for(const tool of ['sh','bash','../git','execute']) assert.throws(()=>command([tool]));
});
