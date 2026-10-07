// Packed-image regression for private Ez snapshot modes; no credentials/provider calls.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'ez-github-runtime-'));
const image = `ez-github-runtime-${process.pid}`;
const run = (command, args) => execFileSync(command, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
try {
  const [pack] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root]));
  run('tar', ['-xzf', join(root, pack.filename), '-C', root]);
  const source = join(root, 'package');
  chmodSync(join(source, 'bin'), 0o700);
  chmodSync(join(source, 'bin/github.mjs'), 0o600);
  run('docker', ['build', '--target', 'runtime', '-t', image, source]);
  const cli = (...args) => run('docker', ['run', '--rm', image, 'node', '/app/bin/github.mjs', ...args]);
  assert.match(run('docker', ['run', '--rm', image, 'id', '-u']), /^1000\s*$/);
  assert.match(cli('--version'), /^ez-github /);
  assert.match(cli('git', '--version'), /^git version /);
  assert.match(cli('gh', '--version'), /^gh version /);
  assert.match(cli('gh', 'project', '--help'), /project/i);
  console.log('PASS: packed private-mode runtime, non-root CLI, Git, gh and Projects.');
} finally {
  try { run('docker', ['image', 'rm', image]); }
  finally { rmSync(root, {recursive: true, force: true}); }
}
