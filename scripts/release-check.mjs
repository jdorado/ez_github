// Read-only package boundary check; no credentials or provider access.
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const pkg = readJson('package.json');
const manifest = readJson('ez-plugin.json');
const deployment = readJson('ez-deployment.json');

assert.match(pkg.version, /^\d+\.\d+\.\d+-beta\.\d+$/);
assert.equal(pkg.private, undefined);
assert.deepEqual(pkg.publishConfig, {access: 'public', tag: 'latest'});
assert.equal(pkg.version, manifest.version);
assert.equal(manifest.id, 'github');
assert.deepEqual(manifest.commands.github, {
  executable: 'bin/github.mjs',
  args: [],
  exposure: {
    receivesExternalContent: true,
    sendsExternally: true,
    changesRecords: true,
    requiresReview: true,
  },
});
assert.deepEqual(manifest.skills, ['skills/github/SKILL.md']);
assert.deepEqual(deployment.commands.github.argv, ['node', '/app/bin/github.mjs']);
assert.deepEqual(deployment.services.plugin.healthcheck, ['node', '/app/bin/github.mjs', '--version']);

const version = spawnSync(process.execPath, ['bin/github.mjs', '--version'], {encoding: 'utf8'});
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), `ez-github ${pkg.version}`);

const readme = readFileSync('README.md', 'utf8');
assert.match(readme, new RegExp(`@jc_stack/ez-github@${pkg.version.replaceAll('.', '\\.')}`));

const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {encoding: 'utf8'}));
const files = pack.files.map(file => file.path);
for (const required of [
  'bin/github.mjs',
  'scripts/release-check.mjs',
  'skills/github/SKILL.md',
  'test/cli.test.mjs',
  'Dockerfile',
  '.dockerignore',
  'ez-plugin.json',
  'ez-deployment.json',
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
]) assert.ok(files.includes(required), `Missing ${required}`);
for (const entry of pkg.files) {
  assert.ok(files.includes(entry) || files.some(file => file.startsWith(`${entry}/`)), `Declared package entry missing: ${entry}`);
}
for (const file of files) {
  assert.doesNotMatch(file, /(^|\/)(node_modules|\.git|\.env|state|repos)(\/|$)/, `Private package entry: ${file}`);
}

console.log(JSON.stringify({name: pkg.name, version: pkg.version, files, unpackedSize: pack.unpackedSize}, null, 2));
