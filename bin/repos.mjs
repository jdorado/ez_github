// Plugin-owned bound on /repos: sparse partial clones, reclaim of finished clones, size budget.
import {execFile} from 'node:child_process';
import {readdir, rename, rm, stat} from 'node:fs/promises';
import {basename, join, posix} from 'node:path';
import {promisify, parseArgs} from 'node:util';

const run = promisify(execFile);
const GIB = 1024 ** 3, HOUR = 3600e3;
export const DEFAULT_IDLE_HOURS = 24, DEFAULT_BUDGET_GIB = 16;
const TOKENS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];
// Files git touches on commit, checkout, add, fetch and pull; the newest mtime is the clone's last activity.
const ACTIVITY = ['HEAD', 'index', 'logs/HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'packed-refs'];
// Ignored directories that a build or script recreates; every other ignored file is treated as work.
const REGENERABLE = new Set(['__pycache__', '.pytest_cache', 'node_modules', '.venv']);

export const reposDir = () => process.env.EZ_GITHUB_REPOS_DIR || '/repos';
export function cleanEnv() {
  const env = {...process.env};
  for (const key of TOKENS) delete env[key];
  return env;
}
export function budgetBytes(env = process.env) {
  const raw = env.EZ_GITHUB_REPOS_BUDGET_GIB;
  const gib = raw === undefined || raw === '' ? DEFAULT_BUDGET_GIB : Number(raw);
  if (!Number.isFinite(gib) || gib <= 0) throw Error('EZ_GITHUB_REPOS_BUDGET_GIB must be a positive number');
  return gib * GIB;
}
const fmt = bytes => bytes >= GIB ? `${(bytes / GIB).toFixed(1)} GiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
const idleHoursOf = value => {
  const hours = value === undefined ? DEFAULT_IDLE_HOURS : Number(value);
  if (!Number.isFinite(hours) || hours < 0) throw Error('--idle-hours must be a number of hours, 0 or more');
  return hours;
};

// True for any command that creates a clone: git [global options] clone, gh repo clone.
export function isClone(args) {
  const [tool, ...rest] = args;
  if (tool === 'gh') return rest[0] === 'repo' && (rest[1] === 'clone' || (['fork', 'create'].includes(rest[1]) && rest.some(arg => arg === '--clone' || arg === '--clone=true' || arg === '-c')));
  if (tool !== 'git') return false;
  const withValue = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
  let i = 0;
  while (rest[i]?.startsWith('-')) i += withValue.has(rest[i]) ? 2 : 1;
  return rest[i] === 'clone';
}

// Inspection never writes: no optional locks, so status cannot refresh the index and look like activity.
// GIT_NO_LAZY_FETCH only exists from git 2.44; status.renames is off so a partial clone never fetches blobs to detect renames.
const inspectGit = (path, ...args) => run('git', ['--no-optional-locks', '-C', path, ...args], {
  env: {...cleanEnv(), GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0'}, maxBuffer: 64 * 1024 * 1024, timeout: 120e3, // a wedged clone is kept, never waited on forever
});
const succeeds = promise => promise.then(() => true, () => false);

async function lastActivity(path) {
  let newest = 0;
  for (const file of ACTIVITY) {
    try { newest = Math.max(newest, (await stat(join(path, '.git', file))).mtimeMs); } catch { /* absent */ }
  }
  return newest;
}

async function inspect(path, now, idleMs) {
  const keep = (reason, active) => ({state: 'keep', reason, lastActivity: active ? new Date(active).toISOString() : null});
  try {
    if (!(await stat(join(path, '.git'))).isDirectory()) return keep('not a standalone git clone');
  } catch { return keep('not a git clone'); }
  const active = await lastActivity(path);
  if (now - active < idleMs) return keep('recent activity', active);
  try {
    if ((await readdir(join(path, '.git', 'worktrees')).catch(() => [])).length) return keep('has linked worktrees', active);
    if (!(await succeeds(inspectGit(path, 'rev-parse', '-q', '--verify', 'HEAD')))) return keep('no commits yet', active); // also a clone still being created
    // Commits inside a submodule or an embedded repository (a gitlink in the index) are not checked, so keep the clone.
    if ((await readdir(join(path, '.git', 'modules')).catch(() => [])).length || /^160000 /m.test((await inspectGit(path, 'ls-files', '--stage')).stdout)) return keep('has submodules or embedded repositories', active);
    // Ignored files count: build output, notes and .env files are work that exists nowhere else. Regenerable caches do not.
    const status = (await inspectGit(path, '-c', 'status.renames=false', 'status', '--porcelain', '--ignored', '--untracked-files=normal')).stdout;
    if (status.split('\n').filter(Boolean).some(line => !(line.startsWith('!! ') && line.slice(3).split('/').some(part => REGENERABLE.has(part))))) return keep('uncommitted, untracked or ignored files', active);
    if (await succeeds(inspectGit(path, 'rev-parse', '-q', '--verify', 'refs/stash'))) return keep('has a stash', active);
    // "On a remote" means a remote-tracking ref records it. The remote is not asked again: merged branches are routinely deleted there.
    const unpushed = (await inspectGit(path, 'rev-list', '--max-count=1', '--branches', 'HEAD', '--not', '--remotes')).stdout.trim();
    if (unpushed) return keep('has commits missing from the remote', active);
    return {state: 'reclaimable', reason: null, lastActivity: new Date(active).toISOString()};
  } catch (error) {
    return keep(`could not inspect: ${error.message.split('\n')[0]}`, active);
  }
}

export async function diskBytes(...paths) {
  const sizes = new Map();
  if (!paths.length) return sizes;
  let stdout;
  try { ({stdout} = await run('du', ['-sk', ...paths], {maxBuffer: 16 * 1024 * 1024})); } catch (error) {
    if (error.stdout) stdout = error.stdout; // unreadable entries: report what du could count
    else if (!(await Promise.all(paths.map(path => stat(path).then(() => true, () => false)))).some(Boolean)) return sizes; // all removed by a concurrent reclaim
    else throw error;
  }
  for (const line of stdout.split('\n').filter(Boolean)) {
    const tab = line.indexOf('\t');
    sizes.set(line.slice(tab + 1), Number(line.slice(0, tab)) * 1024);
  }
  return sizes;
}

export async function listClones(dir, {now = Date.now(), idleHours = DEFAULT_IDLE_HOURS} = {}) {
  const entries = await readdir(dir, {withFileTypes: true}).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const clones = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    clones.push({name: entry.name, path, ...await inspect(path, now, idleHours * HOUR)});
  }
  return clones;
}

// Removes clones that are idle, clean (ignored files too), stash-free and fully on a remote. Anything uncertain is kept.
export async function reclaim(dir, {now = Date.now(), idleHours = DEFAULT_IDLE_HOURS, afterListing} = {}) {
  for (const entry of await readdir(dir).catch(() => [])) { // finish a removal that was interrupted
    if (entry.startsWith('.reclaim-')) await rm(join(dir, entry), {recursive: true, force: true}).catch(() => {});
  }
  const clones = await listClones(dir, {now, idleHours});
  await afterListing?.(); // test seam: lets a test act between the first pass and the removals
  const removed = [], kept = clones.filter(clone => clone.state !== 'reclaimable');
  for (const clone of clones.filter(item => item.state === 'reclaimable')) {
    // The pass above can take minutes on many large clones: look again right before removing, so work started meanwhile is kept.
    const again = await inspect(clone.path, now, idleHours * HOUR);
    if (again.state !== 'reclaimable') { kept.push({...clone, ...again}); continue; }
    const trash = join(dir, `.reclaim-${clone.name}-${process.pid}`);
    try { await rename(clone.path, trash); } catch (error) {
      if (error.code === 'ENOENT') continue; // a concurrent reclaim took it
      throw error;
    }
    removed.push({name: clone.name, bytes: (await diskBytes(trash)).get(trash) ?? 0});
    await rm(trash, {recursive: true, force: true});
  }
  return {
    idleHours,
    removed,
    freedBytes: removed.reduce((sum, item) => sum + item.bytes, 0),
    kept: kept.map(({name, reason}) => ({name, reason})),
  };
}

// Runs before every clone through this plugin: reclaim first, then refuse loudly when /repos is over budget.
export async function prepareClone(dir = reposDir(), {budget = budgetBytes(), now, idleHours} = {}) {
  if (!(await stat(dir).catch(() => null))) return;
  const result = await reclaim(dir, {now, idleHours});
  if (result.removed.length) console.error(`ez-github: reclaimed ${result.removed.length} finished clone(s), freed ${fmt(result.freedBytes)}`);
  const used = (await diskBytes(dir)).get(dir);
  if (used === undefined) throw Error(`Could not measure ${dir}`);
  if (used <= budget) return;
  const sizes = await diskBytes(...result.kept.map(clone => join(dir, clone.name)));
  const largest = result.kept
    .map(clone => ({...clone, bytes: sizes.get(join(dir, clone.name)) ?? 0}))
    .sort((a, b) => b.bytes - a.bytes).slice(0, 5)
    .map(clone => `${clone.name} ${fmt(clone.bytes)} (${clone.reason})`).join('; ');
  throw Error(`${dir} uses ${fmt(used)}, over its ${fmt(budget)} budget, and no clone is reclaimable. Largest kept: ${largest || 'none'}. Push or discard work in them; use "ez github repos reclaim --idle-hours 0" for pushed clones that are still recent; clone with "ez github repos clone" to keep new clones small.`);
}

const safePath = path => {
  const normal = posix.normalize(path);
  return path && !path.startsWith('-') && !normal.startsWith('/') && normal !== '.' && !normal.split('/').includes('..');
};

export async function cloneRepo(argv, dir = reposDir()) {
  const {values, positionals} = parseArgs({args: argv, allowPositionals: true, options: {path: {type: 'string', multiple: true}, branch: {type: 'string'}}});
  const [source, given, extra] = positionals;
  if (!source || extra !== undefined) throw Error('Use: repos clone OWNER/REPO|URL [NAME] [--path DIR]... [--branch BRANCH]');
  const url = /^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source;
  if (!/^(https|file):\/\//.test(url)) throw Error('Source must be OWNER/REPO or an https:// URL');
  const name = given ?? basename(url).replace(/\.git$/, '');
  if (!/^[A-Za-z0-9][\w.-]*$/.test(name) || name.includes('..')) throw Error('NAME must be a plain directory name');
  const paths = values.path ?? [];
  if (!paths.every(safePath)) throw Error('--path must be a relative directory inside the repository');
  if (values.branch?.startsWith('-')) throw Error('--branch must be a branch or tag name');
  const target = join(dir, name);
  if (await stat(target).catch(() => null)) throw Error(`${target} already exists`);
  await prepareClone(dir);
  const env = {...cleanEnv(), GIT_TERMINAL_PROMPT: '0'};
  const git = (...args) => run('git', args, {env, maxBuffer: 64 * 1024 * 1024});
  await git('clone', '--quiet', '--filter=blob:none', '--sparse', ...(values.branch ? ['--branch', values.branch] : []), '--', url, target);
  if (paths.length) await git('-C', target, 'sparse-checkout', 'set', ...paths);
  const branch = (await git('-C', target, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim();
  return {name, path: target, source: url, branch, sparsePaths: paths, bytes: (await diskBytes(target)).get(target) ?? 0};
}

export const HELP = `ez github repos clone OWNER/REPO|URL [NAME] [--path DIR]... [--branch BRANCH]
  Partial, sparse clone into /repos/NAME: history without file contents, and a working tree of the root files plus each --path directory. Contents download when a path is added or needed.
  New files outside the checkout: git add --sparse FILE. More directories: git sparse-checkout add DIR. Use plain git clone only when the whole tree is needed.
ez github repos list [--idle-hours N]
  JSON: budget, usage and every clone's size, last activity and state (reclaimable, or keep with the reason).
ez github repos reclaim [--idle-hours N]
  Removes clones idle for N hours (default ${DEFAULT_IDLE_HOURS}) with no uncommitted, untracked or ignored files (regenerable caches excepted), no stash, no submodules or embedded repositories, and every local branch commit (and HEAD) reachable from a remote-tracking ref. The remote is not re-checked, so a branch deleted there after its push still counts as pushed. Tags are not considered. Anything else is kept.
Every git clone and gh repo clone through this plugin first reclaims, then fails when /repos is over its budget (default ${DEFAULT_BUDGET_GIB} GiB, EZ_GITHUB_REPOS_BUDGET_GIB).`;

export async function repos(args, dir = reposDir()) {
  const [sub, ...rest] = args;
  const print = value => console.log(JSON.stringify(value));
  if (!sub || sub === '--help') return console.log(HELP);
  if (sub === 'clone') return print(await cloneRepo(rest, dir));
  if (sub === 'list' || sub === 'reclaim') {
    const {values} = parseArgs({args: rest, options: {'idle-hours': {type: 'string'}}});
    const idleHours = idleHoursOf(values['idle-hours']);
    if (sub === 'reclaim') return print(await reclaim(dir, {idleHours}));
    const clones = await listClones(dir, {idleHours});
    const sizes = await diskBytes(...clones.map(clone => clone.path)); // du counts nested arguments once, so the total is its own call
    return print({
      reposDir: dir, usedBytes: (await diskBytes(dir)).get(dir) ?? 0, budgetBytes: budgetBytes(), idleHours,
      clones: clones.map(({name, path, state, reason, lastActivity: active}) => ({name, bytes: sizes.get(path) ?? 0, lastActivity: active, state, ...(reason ? {reason} : {})})),
    });
  }
  throw Error('Use repos clone, list or reclaim; see --help');
}
