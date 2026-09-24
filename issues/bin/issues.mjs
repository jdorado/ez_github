#!/usr/bin/env node
import {readFileSync, writeFileSync, realpathSync, statSync} from 'node:fs';
import {resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export const REPOS = new Set(['jdorado/stocks', 'jdorado/ezstocks-plugin']);
const WORKSPACE = '/opt/stocks/ez-agent/mind';
const TOKEN_FILE = '/state/github-token';

export function parse(argv) {
  const [action, ...rest] = argv;
  if (action === '--version') return {action};
  if (!action || action === '--help') return {action: 'help'};
  if (action === 'auth' && rest.length === 1 && rest[0] === 'set') return {action: 'auth-set'};
  if (action === 'doctor' && rest.length === 0) return {action};
  if (!['list', 'view', 'create'].includes(action)) throw Error('Unsupported action');
  const allowed = action === 'create' ? ['repo', 'title', 'body-file'] : action === 'view' ? ['repo', 'number'] : ['repo'];
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.startsWith('--') ? rest[i].slice(2) : '';
    if (!allowed.includes(key) || values[key] || !rest[i + 1] || rest[i + 1].startsWith('--')) throw Error('Invalid arguments');
    values[key] = rest[i + 1];
  }
  if (!REPOS.has(values.repo) || allowed.some(key => !values[key])) throw Error('Allowed repositories: jdorado/stocks, jdorado/ezstocks-plugin');
  if (action === 'view' && !/^[1-9]\d*$/.test(values.number)) throw Error('Invalid issue number');
  if (action === 'create' && (values.title.length > 256 || !values.title.trim())) throw Error('Invalid title');
  return {action, ...values};
}

export function readBody(file, workspace = WORKSPACE) {
  const root = realpathSync(workspace);
  const path = realpathSync(resolve(file));
  if (!path.startsWith(root + sep) || !statSync(path).isFile()) throw Error('Body file must be inside the agent workspace');
  if (statSync(path).size > 20000) throw Error('Issue body exceeds 20 KB');
  const body = readFileSync(path, 'utf8');
  if (!body.trim()) throw Error('Issue body is empty');
  return body;
}

export async function api(method, path, token, body, fetchFn = fetch) {
  const response = await fetchFn(`https://api.github.com${path}`, {
    method,
    headers: {'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? {'Content-Type': 'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {})
  });
  const data = await response.json();
  if (!response.ok) throw Error(`GitHub ${response.status}: ${data.message || 'request failed'}`);
  return data;
}

export async function createIssue(repo, title, body, token, request = api) {
  const prefix = `/repos/${repo}/issues`;
  const created = await request('POST', prefix, token, {title, body});
  const readback = await request('GET', `${prefix}/${created.number}`, token);
  if (readback.title !== title || readback.body !== body) throw Error(`Created issue ${created.html_url}, but readback differs`);
  return {number: readback.number, url: readback.html_url, title: readback.title, verified: true};
}

async function main() {
  const input = parse(process.argv.slice(2));
  if (input.action === 'help') {
    console.log('ez github-issues doctor | list --repo OWNER/REPO | view --repo OWNER/REPO --number N | create --repo OWNER/REPO --title TITLE --body-file PATH | auth set\nAllowed: jdorado/stocks, jdorado/ezstocks-plugin. auth set reads a fine-grained GitHub token from stdin; never paste it into arguments.');
    return;
  }
  if (input.action === '--version') { console.log('0.1.0-beta.1'); return; }
  if (input.action === 'auth-set') {
    const token = readFileSync(0, 'utf8').trim();
    if (!/^github_pat_[A-Za-z0-9_]+$/.test(token)) throw Error('Expected a fine-grained GitHub token on stdin');
    for (const repo of REPOS) await api('GET', `/repos/${repo}/issues?state=open&per_page=1`, token);
    writeFileSync(TOKEN_FILE, token, {mode: 0o600});
    console.log(JSON.stringify({saved: true, repositories: [...REPOS], writeVerified: false}));
    return;
  }
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  if (input.action === 'doctor') {
    for (const repo of REPOS) await api('GET', `/repos/${repo}/issues?state=open&per_page=1`, token);
    console.log(JSON.stringify({authenticated: true, repositories: [...REPOS], writeVerified: false}));
    return;
  }
  const prefix = `/repos/${input.repo}/issues`;
  if (input.action === 'list') {
    const issues = await api('GET', `${prefix}?state=open&per_page=100`, token);
    console.log(JSON.stringify(issues.filter(item => !item.pull_request).map(({number, title, html_url, state}) => ({number, title, url: html_url, state}))));
  } else if (input.action === 'view') {
    const item = await api('GET', `${prefix}/${input.number}`, token);
    if (item.pull_request) throw Error('Requested number is a pull request');
    console.log(JSON.stringify({number: item.number, title: item.title, body: item.body, url: item.html_url, state: item.state}));
  } else {
    const body = readBody(input['body-file']);
    console.log(JSON.stringify(await createIssue(input.repo, input.title, body, token)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
