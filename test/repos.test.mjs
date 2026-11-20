import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {diskBytes, isClone, listClones, prepareClone, reclaim} from '../bin/repos.mjs';

const HOUR = 3600e3;
const bin = resolve('bin/github.mjs');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

// A remote with a 3 MiB directory (the stand-in for a data repository's records) and a small one.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ez-github-repos-'));
  const origin = join(root, 'origin.git'), seed = join(root, 'seed'), repos = join(root, 'repos');
  mkdirSync(repos);
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(origin, 'config', 'uploadpack.allowFilter', 'true');
  git(root, 'init', '-q', '-b', 'main', seed);
  mkdirSync(join(seed, 'bulk')); mkdirSync(join(seed, 'docs'));
  writeFileSync(join(seed, 'README.md'), 'root\n');
  writeFileSync(join(seed, '.gitignore'), 'out/\n');
  writeFileSync(join(seed, 'docs/a.md'), 'doc\n');
  writeFileSync(join(seed, 'bulk/blob.bin'), randomBytes(3 * 1024 * 1024));
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'seed'); git(seed, 'push', '-q', origin, 'main');
  const url = `file://${origin}`;
  const clone = name => { git(root, 'clone', '-q', url, join(repos, name)); return join(repos, name); };
  return {root, origin, url, repos, clone, cleanup: () => rmSync(root, {recursive: true, force: true})};
}
// Moves every file git touches for activity into the past, as if the clone had been idle.
const age = (path, hours) => {
  const when = new Date(Date.now() - hours * HOUR);
  for (const file of ['HEAD', 'index', 'logs/HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'packed-refs']) {
    try { utimesSync(join(path, '.git', file), when, when); } catch { /* absent */ }
  }
};
// One clone per situation an agent can leave behind.
function scenarios(f) {
  const done = f.clone('done');
  const pushedBranch = f.clone('pushed-branch');
  git(pushedBranch, 'switch', '-q', '-c', 'codex/topic');
  writeFileSync(join(pushedBranch, 'docs/new.md'), 'research\n');
  git(pushedBranch, 'add', '-A'); git(pushedBranch, 'commit', '-q', '-m', 'research'); git(pushedBranch, 'push', '-q', '-u', 'origin', 'codex/topic');
  writeFileSync(join(f.clone('dirty'), 'README.md'), 'edited\n');
  writeFileSync(join(f.clone('untracked'), 'scratch.txt'), 'x\n');
  const unpushed = f.clone('unpushed');
  writeFileSync(join(unpushed, 'docs/a.md'), 'local\n'); git(unpushed, 'commit', '-q', '-am', 'local only');
  const stashed = f.clone('stashed');
  writeFileSync(join(stashed, 'README.md'), 'wip\n'); git(stashed, 'stash', '-q');
  const detached = f.clone('detached');
  git(detached, 'checkout', '-q', '--detach'); writeFileSync(join(detached, 'docs/a.md'), 'd\n'); git(detached, 'commit', '-q', '-am', 'detached only');
  const local = join(f.repos, 'local-only');
  git(f.root, 'init', '-q', '-b', 'main', local); writeFileSync(join(local, 'x'), 'x'); git(local, 'add', '-A'); git(local, 'commit', '-q', '-m', 'no remote');
  mkdirSync(join(f.repos, 'notes')); writeFileSync(join(f.repos, 'notes/todo.txt'), 'not a clone\n');
  // Work that `git status` hides unless ignored files are counted, plus submodules and clones with no commits.
  const ignored = f.clone('ignored');
  mkdirSync(join(ignored, 'out')); writeFileSync(join(ignored, 'out/report.md'), 'research result, ignored by .gitignore\n');
  const nested = f.clone('nested');
  mkdirSync(join(nested, 'out')); git(f.root, 'init', '-q', '-b', 'main', join(nested, 'out/inner'));
  writeFileSync(join(nested, 'out/inner/x'), 'x'); git(join(nested, 'out/inner'), 'add', '-A'); git(join(nested, 'out/inner'), 'commit', '-q', '-m', 'inner, no remote');
  const withSub = f.clone('with-submodule');
  git(withSub, 'switch', '-q', '-c', 'with-sub'); git(withSub, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', f.url, 'sub');
  git(withSub, 'commit', '-q', '-m', 'add submodule'); git(withSub, 'push', '-q', '-u', 'origin', 'with-sub');
  git(f.root, 'init', '-q', '-b', 'main', join(f.repos, 'empty'));
  // A branch pushed, merged elsewhere and deleted on the remote: the usual end of a research branch.
  const merged = f.clone('merged-deleted');
  git(merged, 'switch', '-q', '-c', 'codex/merged'); writeFileSync(join(merged, 'docs/m.md'), 'm\n');
  git(merged, 'add', '-A'); git(merged, 'commit', '-q', '-m', 'merged'); git(merged, 'push', '-q', '-u', 'origin', 'codex/merged');
  git(f.origin, 'branch', '-q', '-D', 'codex/merged');
  return {done, pushedBranch};
}

test('reclaim removes finished, fully pushed clones and keeps dirty, unpushed or recent ones', async () => {
  const f = fixture();
  try {
    scenarios(f);
    const fresh = await reclaim(f.repos); // everything was just touched
    assert.deepEqual(fresh.removed, []);
    assert.ok(fresh.kept.every(item => item.reason === 'recent activity' || item.reason.startsWith('not a')));

    const later = Date.now() + 25 * HOUR;
    const result = await reclaim(f.repos, {now: later});
    assert.deepEqual(result.removed.map(item => item.name).sort(), ['done', 'merged-deleted', 'pushed-branch']);
    assert.ok(result.freedBytes > 3 * 3 * 1024 * 1024, 'all three 3 MiB trees counted');
    const kept = Object.fromEntries(result.kept.map(item => [item.name, item.reason]));
    assert.deepEqual(kept, {
      dirty: 'uncommitted, untracked or ignored files',
      untracked: 'uncommitted, untracked or ignored files',
      ignored: 'uncommitted, untracked or ignored files',
      nested: 'uncommitted, untracked or ignored files',
      'with-submodule': 'has submodules',
      empty: 'no commits yet',
      unpushed: 'has commits missing from the remote',
      stashed: 'has a stash',
      detached: 'has commits missing from the remote',
      'local-only': 'has commits missing from the remote',
      notes: 'not a git clone',
    });
    for (const name of ['done', 'pushed-branch', 'merged-deleted']) assert.ok(!existsSync(join(f.repos, name)));
    for (const name of Object.keys(kept)) assert.ok(existsSync(join(f.repos, name)), `${name} must survive`);
    assert.equal(existsSync(join(f.repos, 'dirty', 'README.md')), true);
    assert.equal(existsSync(join(f.repos, 'ignored', 'out/report.md')), true, 'ignored output is work too');
    assert.equal(existsSync(join(f.repos, 'nested', 'out/inner/x')), true);
    assert.deepEqual((await listClones(f.repos, {now: later})).filter(c => c.state === 'reclaimable'), []);
  } finally { f.cleanup(); }
});

test('reclaim looks again before removing, so work started after the first pass is kept', async () => {
  const f = fixture();
  try {
    const busy = f.clone('busy'), idle = f.clone('idle');
    age(busy, 30); age(idle, 30);
    const result = await reclaim(f.repos, {
      idleHours: 24,
      afterListing: async () => writeFileSync(join(busy, 'README.md'), 'edited after the first pass\n'),
    });
    assert.deepEqual(result.removed.map(item => item.name), ['idle']);
    assert.ok(result.kept.some(item => item.name === 'busy' && item.reason === 'uncommitted, untracked or ignored files'));
    assert.equal(existsSync(join(busy, 'README.md')), true);
  } finally { f.cleanup(); }
});

test('concurrent reclaims remove each clone once and neither fails', async () => {
  const f = fixture();
  try {
    for (const name of ['a', 'b', 'c', 'd']) age(f.clone(name), 30);
    const [one, two] = await Promise.all([reclaim(f.repos), reclaim(f.repos)]);
    const names = [...one.removed, ...two.removed].map(item => item.name).sort();
    assert.deepEqual(names, ['a', 'b', 'c', 'd']);
    assert.deepEqual(await listClones(f.repos), []);
  } finally { f.cleanup(); }
});

test('a clone younger than the idle limit is kept even when finished', async () => {
  const f = fixture();
  try {
    const young = f.clone('young'), old = f.clone('old');
    age(old, 30); age(young, 2);
    const result = await reclaim(f.repos, {idleHours: 24});
    assert.deepEqual(result.removed.map(item => item.name), ['old']);
    assert.ok(existsSync(young));
    assert.deepEqual((await reclaim(f.repos, {idleHours: 0, now: Date.now() + 1000})).removed.map(item => item.name), ['young']);
  } finally { f.cleanup(); }
});

test('listing and reclaiming never refresh the clones they inspect', async () => {
  const f = fixture();
  try {
    const keep = f.clone('keep');
    const now = new Date();
    utimesSync(join(keep, 'README.md'), now, now); // stat data differs, content does not: an optional-lock status would rewrite the index
    writeFileSync(join(keep, 'scratch.txt'), 'untracked keeps it\n');
    age(keep, 30);
    const before = (await listClones(f.repos))[0].lastActivity;
    await reclaim(f.repos);
    assert.equal((await listClones(f.repos))[0].lastActivity, before, 'status must not touch the index mtime');
  } finally { f.cleanup(); }
});

test('sizing tolerates paths a concurrent reclaim already removed', async () => {
  const f = fixture();
  try {
    const here = f.clone('here');
    assert.equal((await diskBytes(join(f.repos, 'gone'))).size, 0);
    const sizes = await diskBytes(join(f.repos, 'gone'), here);
    assert.deepEqual([...sizes.keys()], [here]);
    assert.ok(sizes.get(here) > 3 * 1024 * 1024);
  } finally { f.cleanup(); }
});

test('an interrupted removal is finished by the next run', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.repos, '.reclaim-old-1')); writeFileSync(join(f.repos, '.reclaim-old-1', 'x'), 'x');
    await reclaim(f.repos);
    assert.ok(!existsSync(join(f.repos, '.reclaim-old-1')));
  } finally { f.cleanup(); }
});

test('a clone is refused loudly over budget, and an idle finished clone is reclaimed first', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.clone('dirty'), 'README.md'), 'edited\n'); age(join(f.repos, 'dirty'), 30);
    const run = (budget, target) => spawnSync(process.execPath, [bin, 'git', 'clone', '-q', f.url, join(f.repos, target)], {
      encoding: 'utf8', env: {...process.env, EZ_GITHUB_REPOS_DIR: f.repos, EZ_GITHUB_REPOS_BUDGET_GIB: budget},
    });
    const refused = run('0.001', 'blocked'); // 1 MiB, the dirty clone alone is over it
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /over its 1\.0 MiB budget/);
    assert.match(refused.stderr, /dirty .*uncommitted, untracked or ignored files/);
    assert.ok(!existsSync(join(f.repos, 'blocked')));

    const finished = f.clone('finished'); age(finished, 30);
    const ok = run('1', 'allowed');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stderr, /reclaimed 1 finished clone/);
    assert.ok(existsSync(join(f.repos, 'allowed', 'README.md')));
    assert.ok(!existsSync(finished));
    assert.ok(existsSync(join(f.repos, 'dirty')));
  } finally { f.cleanup(); }
});

test('prepareClone ignores a missing repositories directory and rejects a bad budget', async () => {
  await prepareClone(join(tmpdir(), 'ez-github-does-not-exist'), {budget: 1});
  const bad = spawnSync(process.execPath, [bin, 'git', 'clone', 'x'], {encoding: 'utf8', env: {...process.env, EZ_GITHUB_REPOS_DIR: tmpdir(), EZ_GITHUB_REPOS_BUDGET_GIB: 'lots'}});
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /positive number/);
});

test('every clone route is recognised and other git and gh commands are not', () => {
  for (const args of [['git', 'clone', 'u'], ['git', '-c', 'a=b', 'clone', 'u'], ['git', '-C', '/repos', 'clone', 'u'], ['git', '--git-dir', 'x', 'clone', 'u'], ['gh', 'repo', 'clone', 'O/R'], ['gh', 'repo', 'fork', 'O/R', '--clone'], ['gh', 'repo', 'create', 'N', '--private', '-c']]) assert.equal(isClone(args), true, args.join(' '));
  for (const args of [['git', 'commit', '-m', 'clone'], ['git', '-C', '/repos/clone', 'status'], ['git', 'log', '--', 'clone'], ['gh', 'repo', 'view', 'O/R'], ['gh', 'repo', 'fork', 'O/R'], ['gh', 'pr', 'clone'], ['doctor'], []]) assert.equal(isClone(args), false, args.join(' '));
});

test('repos clone is partial and sparse, and the add-only research flow pushes without the big directory', () => {
  const f = fixture();
  try {
    const repos = (...args) => spawnSync(process.execPath, [bin, 'repos', ...args], {encoding: 'utf8', env: {...process.env, EZ_GITHUB_REPOS_DIR: f.repos}});
    const result = repos('clone', f.url, 'research');
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout), root = join(f.repos, 'research');
    assert.equal(receipt.branch, 'main');
    assert.ok(receipt.bytes < 1024 * 1024, `sparse clone is ${receipt.bytes} bytes`);
    assert.ok(existsSync(join(root, 'README.md')));
    assert.ok(!existsSync(join(root, 'bulk')) && !existsSync(join(root, 'docs')));
    assert.equal(git(root, 'config', 'remote.origin.promisor').trim(), 'true');
    assert.equal(git(root, 'config', 'remote.origin.partialclonefilter').trim(), 'blob:none');

    git(root, 'switch', '-q', '-c', 'codex/topic');
    mkdirSync(join(root, 'bulk'), {recursive: true});
    writeFileSync(join(root, 'bulk/2026-11-20_topic.md'), 'new research\n');
    git(root, 'add', '--sparse', 'bulk/2026-11-20_topic.md');
    git(root, 'commit', '-q', '-m', 'research');
    git(root, 'push', '-q', '-u', 'origin', 'codex/topic');
    assert.equal(git(f.origin, 'log', '-1', '--format=%s', 'codex/topic').trim(), 'research');
    assert.ok(!existsSync(join(root, 'bulk/blob.bin')), 'the 3 MiB file was never downloaded');

    const listed = JSON.parse(repos('list').stdout);
    assert.equal(listed.clones[0].name, 'research');
    assert.equal(listed.clones[0].state, 'keep');
    assert.equal(listed.budgetBytes, 16 * 1024 ** 3);

    const withPath = JSON.parse(repos('clone', f.url, 'with-docs', '--path', 'docs').stdout);
    assert.deepEqual(withPath.sparsePaths, ['docs']);
    assert.ok(existsSync(join(f.repos, 'with-docs/docs/a.md')) && !existsSync(join(f.repos, 'with-docs/bulk')));
    const full = join(f.root, 'full'); git(f.root, 'clone', '-q', f.url, full);
    assert.ok(existsSync(join(full, 'bulk/blob.bin')), 'a plain clone materialises everything');
  } finally { f.cleanup(); }
});

test('repos clone rejects unsafe names, paths and sources before touching the disk', () => {
  const f = fixture();
  try {
    const repos = (...args) => spawnSync(process.execPath, [bin, 'repos', ...args], {encoding: 'utf8', env: {...process.env, EZ_GITHUB_REPOS_DIR: f.repos}});
    for (const args of [['clone', f.url, '../escape'], ['clone', f.url, '.hidden'], ['clone', f.url, 'x', '--path', '../up'], ['clone', f.url, 'x', '--path', '/abs'], ['clone', f.url, 'x', '--path', '-flag'], ['clone', '--upload-pack=x'], ['clone', 'not-a-source'], ['clone'], ['nope']]) {
      const result = repos(...args);
      assert.equal(result.status, 1, args.join(' '));
    }
    assert.deepEqual(spawnSync('ls', ['-A', f.repos], {encoding: 'utf8'}).stdout, '');
  } finally { f.cleanup(); }
});

test('help documents the three commands and the budget', () => {
  const help = spawnSync(process.execPath, [bin, 'repos', '--help'], {encoding: 'utf8'});
  assert.equal(help.status, 0);
  for (const word of ['repos clone', 'repos list', 'repos reclaim', 'git add --sparse', 'EZ_GITHUB_REPOS_BUDGET_GIB']) assert.ok(help.stdout.includes(word), word);
});
