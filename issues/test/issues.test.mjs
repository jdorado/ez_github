import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse, readBody, api, createIssue} from '../bin/issues.mjs';

test('only issue operations in the two source repositories are accepted', () => {
  assert.deepEqual(parse(['list', '--repo', 'jdorado/stocks']), {action: 'list', repo: 'jdorado/stocks'});
  assert.deepEqual(parse(['view', '--repo', 'jdorado/ezstocks-plugin', '--number', '12']), {action: 'view', repo: 'jdorado/ezstocks-plugin', number: '12'});
  for (const args of [
    ['create', '--repo', 'jdorado/eztocks_data', '--title', 'X', '--body-file', '/tmp/x'],
    ['create', '--repo', 'jdorado/stocks', '--title', 'X', '--body-file', '/tmp/x', '--assignee', 'jdorado'],
    ['view', '--repo', 'jdorado/stocks', '--number', '../token'],
    ['gh', 'repo', 'clone', 'jdorado/stocks']
  ]) assert.throws(() => parse(args));
});

test('issue body must be a real workspace file, not an external path or symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'github-issues-'));
  try {
    const workspace = join(dir, 'mind');
    mkdirSync(workspace);
    const body = join(workspace, 'issue.md');
    writeFileSync(body, 'Observed defect');
    assert.equal(readBody(body, workspace), 'Observed defect');
    assert.throws(() => readBody(join(dir, 'outside'), workspace));
    symlinkSync(join(dir, 'secret'), join(workspace, 'link'));
    writeFileSync(join(dir, 'secret'), 'secret');
    assert.throws(() => readBody(join(workspace, 'link'), workspace));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('provider errors do not leak the token and API paths stay on GitHub', async () => {
  const requests = [];
  const fetchFn = async (url, options) => {
    requests.push({url, options});
    return {ok: false, status: 403, json: async () => ({message: 'Forbidden'})};
  };
  await assert.rejects(api('POST', '/repos/jdorado/stocks/issues', 'synthetic-token', {title: 'X'}, fetchFn), /GitHub 403: Forbidden/);
  assert.equal(requests[0].url, 'https://api.github.com/repos/jdorado/stocks/issues');
  assert.ok(!JSON.stringify(requests[0].url).includes('synthetic-token'));
});

test('creation requires provider readback of the exact issue', async () => {
  const calls = [];
  const request = async (method, path, token, body) => {
    calls.push({method, path, body});
    return method === 'POST'
      ? {number: 7, html_url: 'https://github.com/jdorado/stocks/issues/7'}
      : {number: 7, html_url: 'https://github.com/jdorado/stocks/issues/7', title: 'Observed defect', body: 'Evidence'};
  };
  assert.deepEqual(await createIssue('jdorado/stocks', 'Observed defect', 'Evidence', 'synthetic', request), {
    number: 7, url: 'https://github.com/jdorado/stocks/issues/7', title: 'Observed defect', verified: true
  });
  assert.deepEqual(calls.map(({method, path}) => [method, path]), [
    ['POST', '/repos/jdorado/stocks/issues'], ['GET', '/repos/jdorado/stocks/issues/7']
  ]);
  await assert.rejects(createIssue('jdorado/stocks', 'Different', 'Evidence', 'synthetic', request), /readback differs/);
});
