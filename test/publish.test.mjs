import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {publish} from '../bin/repos.mjs';

const sha1 = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const fail = (status, message) => Object.assign(Error(message), {status});

// A fake GitHub behind `gh api`: branches (name -> {file path -> bytes}), pull requests, and an optional hook per PUT.
function fakeGh({branches = {main: {'README.md': Buffer.from('root\n')}}, prs = [], onPut, corrupt} = {}) {
  const state = {branches: structuredClone(branches), prs: [...prs], puts: [], posts: []};
  for (const [name, files] of Object.entries(state.branches)) for (const path of Object.keys(files)) files[path] = Buffer.from(files[path]);
  const gh = async (args, input) => {
    const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
    const [route, query = ''] = args.find(a => a.startsWith('repos/')).split('?');
    const body = input ? JSON.parse(input) : null;
    let m;
    if (route === 'repos/o/r') return JSON.stringify({default_branch: 'main'});
    if ((m = /^repos\/o\/r\/git\/ref\/heads\/(.+)$/.exec(route))) {
      if (!state.branches[m[1]]) throw fail(404, 'Not Found (HTTP 404)');
      return JSON.stringify({object: {sha: `commit-of-${m[1]}`}});
    }
    if (route === 'repos/o/r/git/refs') {
      const from = /^commit-of-(.+)$/.exec(body.sha)[1];
      state.posts.push(body.ref);
      state.branches[body.ref.replace('refs/heads/', '')] = {...state.branches[from]};
      return '';
    }
    if ((m = /^repos\/o\/r\/contents\/(.+)$/.exec(route))) {
      const path = decodeURIComponent(m[1]), files = state.branches[new URLSearchParams(query).get('ref') ?? body.branch];
      if (method === 'PUT') {
        state.puts.push({path, ...body});
        onPut?.(path, body, state);
        const bytes = Buffer.from(body.content, 'base64');
        if (files[path] && body.sha !== sha1(files[path])) throw fail(409, 'does not match (HTTP 409)');
        state.branches[body.branch][path] = corrupt ? Buffer.from('tampered') : bytes;
        return '{}';
      }
      if (!files[path]) throw fail(404, 'Not Found (HTTP 404)');
      return JSON.stringify({sha: sha1(files[path]), encoding: 'base64', content: files[path].toString('base64')});
    }
    if (route === 'repos/o/r/pulls') {
      if (method === 'POST') { const pr = {html_url: `https://github.com/o/r/pull/${state.prs.length + 7}`, number: state.prs.length + 7, base: {ref: body.base}, head: body.head, body: body.body}; state.prs.push(pr); return JSON.stringify(pr); }
      return JSON.stringify(state.prs.filter(pr => `o:${pr.head}` === new URLSearchParams(query).get('head')));
    }
    throw Error(`unexpected gh ${args.join(' ')}`);
  };
  return {gh, state};
}
const bundle = files => JSON.stringify({files});
const ARGS = ['o/r', '--branch', 'topic', '--title', 'Add notes'];

test('publish creates the branch, writes text and binary files, reads them back and opens the pull request', async () => {
  const f = fakeGh();
  const png = Buffer.from([0, 255, 1, 254]);
  const result = await publish([...ARGS, '--body', 'why'], bundle([{path: 'docs/a b.md', content: 'héllo\n'}, {path: 'img.bin', content: png.toString('base64'), encoding: 'base64'}]), f.gh);
  assert.deepEqual(f.state.posts, ['refs/heads/topic']);
  assert.equal(f.state.puts.length, 2);
  assert.ok(f.state.puts.every(put => put.message === 'Add notes' && put.branch === 'topic' && !put.sha));
  assert.deepEqual(result, {url: 'https://github.com/o/r/pull/7', number: 7, created: true, branch: 'topic', base: 'main',
    files: [{path: 'docs/a b.md', sha: sha1(Buffer.from('héllo\n'))}, {path: 'img.bin', sha: sha1(png)}]});
  assert.equal(f.state.prs[0].body, 'why');
  assert.equal(f.state.branches.topic['img.bin'].equals(png), true);
  assert.equal(f.state.branches.main['docs/a b.md'], undefined, 'the base is untouched');
});

test('publish updates an existing branch, skips identical files and reuses the open pull request', async () => {
  const f = fakeGh({branches: {main: {'README.md': 'root\n'}, topic: {'README.md': 'root\n', 'a.md': 'old\n'}}, prs: [{html_url: 'https://github.com/o/r/pull/3', number: 3, base: {ref: 'main'}, head: 'topic'}]});
  const result = await publish(ARGS, bundle([{path: 'a.md', content: 'new\n'}, {path: 'README.md', content: 'root\n'}]), f.gh);
  assert.deepEqual(f.state.posts, [], 'the branch exists');
  assert.deepEqual(f.state.puts.map(put => [put.path, put.sha]), [['a.md', sha1(Buffer.from('old\n'))]], 'the changed file carries its current sha; the identical one is not rewritten');
  assert.equal(result.created, false);
  assert.equal(result.number, 3);
  assert.equal(f.state.prs.length, 1);
});

test('publish fails on a conflicting write, a readback difference and bad input', async () => {
  const conflict = fakeGh({branches: {main: {}, topic: {}}, onPut: (path, body, state) => { state.branches.topic[path] = Buffer.from('someone else\n'); }});
  await assert.rejects(publish(ARGS, bundle([{path: 'a.md', content: 'mine\n'}]), conflict.gh), /Conflict writing a\.md on topic.*nothing was retried/);
  assert.equal(conflict.state.prs.length, 0);

  const differs = fakeGh({corrupt: true});
  await assert.rejects(publish(ARGS, bundle([{path: 'a.md', content: 'mine\n'}]), differs.gh), /Readback of a\.md.*differs/);
  assert.equal(differs.state.prs.length, 0, 'no pull request over unverified bytes');

  const never = async () => { throw Error('gh must not run'); };
  for (const [args, stdin] of [[ARGS, 'not json'], [ARGS, bundle([])], [ARGS, bundle([{path: '../x', content: 'x'}])], [ARGS, bundle([{path: 'a', content: 'x'}, {path: 'a', content: 'y'}])], [['o/r', '--branch', 'b'], bundle([{path: 'a', content: 'x'}])], [['nope', '--branch', 'b', '--title', 't'], bundle([{path: 'a', content: 'x'}])]]) {
    await assert.rejects(publish(args, stdin, never));
  }
});

test('publish reads the bundle from stdin through the command and exits 1 on bad input', () => {
  const run = (input, ...args) => spawnSync(process.execPath, [resolve('bin/github.mjs'), 'repos', 'publish', ...args], {input, encoding: 'utf8'});
  const bad = run('nope', ...ARGS);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /JSON bundle/);
  assert.match(spawnSync(process.execPath, [resolve('bin/github.mjs'), 'repos', '--help'], {encoding: 'utf8'}).stdout, /repos publish OWNER\/REPO/);
});
