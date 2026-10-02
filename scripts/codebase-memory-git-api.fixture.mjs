// GitHub Git API substitute backed by actual Git objects and a bare remote.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { run } from './codebase-memory.mjs';

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function gitApi(remote, barrier) {
  const git = (...args) => run('git', ['--git-dir', remote, ...args]);
  const gitBytes = (...args) => {
    const result = spawnSync('git', ['--git-dir', remote, ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('HTTP 404 missing Git object'); return result.stdout;
  };
  let attempted = false;
  return (endpoint, data) => {
    if (endpoint.endsWith('/commits/main')) return { sha: git('rev-parse', 'main') };
    if (endpoint.includes('/actions/workflows/')) {
      const sha = new URL('https://fixture/' + endpoint).searchParams.get('head_sha');
      return { workflow_runs: [{ id: 10, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] };
    }
    if (endpoint.includes('/git/ref/')) {
      try { return { object: { sha: git('rev-parse', 'codebase-memory-index') } }; } catch { throw new Error('HTTP 404 no index branch'); }
    }
    if (endpoint.includes('/contents/')) {
      const [directory, query] = endpoint.split('/contents/')[1].split('?'); const ref = new URLSearchParams(query).get('ref');
      const list = gitBytes('ls-tree', `${ref}:${directory}`).toString('utf8').trim();
      return list.split('\n').filter(Boolean).map(line => { const [, , type, sha, name] = line.match(/^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/); return { name, type: type === 'blob' ? 'file' : 'dir', sha }; });
    }
    if (endpoint.endsWith('/git/blobs') && data) {
      return { sha: run('git', ['--git-dir', remote, 'hash-object', '-w', '--stdin'], { input: Buffer.from(data.content, 'base64'), encoding: 'utf8' }) };
    }
    if (endpoint.includes('/git/blobs/')) { const sha = endpoint.split('/').at(-1); return { sha, encoding: 'base64', content: gitBytes('cat-file', 'blob', sha).toString('base64') }; }
    if (endpoint.endsWith('/git/trees')) {
      const indexFile = path.join(path.dirname(remote), `api-index-${process.pid}-${Math.random().toString(16).slice(2)}`);
      const env = { ...process.env, GIT_INDEX_FILE: indexFile };
      const execute = args => run('git', ['--git-dir', remote, ...args], { env });
      execute(['read-tree', data.base_tree ?? '--empty']);
      for (const entry of data.tree) execute(['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.sha},${entry.path}`]);
      return { sha: execute(['write-tree']) };
    }
    if (endpoint.includes('/git/commits/') && !data) return { tree: { sha: git('rev-parse', `${endpoint.split('/').at(-1)}^{tree}`) } };
    if (endpoint.endsWith('/git/commits')) return { sha: run('git', ['--git-dir', remote, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit-tree', data.tree, ...data.parents.flatMap(parent => ['-p', parent])], { input: data.message }) };
    if (endpoint.includes('/git/refs') && data) {
      if (data.force !== undefined && data.force !== false) throw new Error('Force publication forbidden');
      if (barrier && !attempted) {
        attempted = true; mkdirSync(barrier, { recursive: true }); writeFileSync(path.join(barrier, String(process.pid)), 'waiting');
        const began = Date.now();
        while (!existsSync(path.join(barrier, 'release'))) { if (Date.now() - began > 30000) throw new Error('Barrier timed out'); pause(10); }
      }
      const ref = data.ref ?? 'refs/heads/codebase-memory-index';
      let previous;
      try { previous = git('rev-parse', ref); } catch { previous = '0'.repeat(40); }
      if (!data.ref && spawnSync('git', ['--git-dir', remote, 'merge-base', '--is-ancestor', previous, data.sha], { windowsHide: true }).status !== 0) throw new Error('HTTP 422 non fast-forward publication');
      if (data.ref && previous !== '0'.repeat(40)) throw new Error('HTTP 422 branch exists');
      try { git('update-ref', ref, data.sha, previous); } catch { throw new Error('HTTP 409 ref conflict'); }
      return { object: { sha: data.sha } };
    }
    throw new Error(`Unexpected Git API endpoint: ${endpoint}`);
  };
}
if (process.argv[2] === 'worker') {
  const configuration = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const implementation = await import(process.env.CBM_REVIEW_BASELINE ? pathToFileURL(path.resolve(process.env.CBM_REVIEW_BASELINE)).href : './codebase-memory-main.mjs');
  const request = gitApi(configuration.remote, configuration.action === 'publish' ? configuration.barrier : undefined);
  const install = (staging, target) => {
    const barrier = configuration.barrier; mkdirSync(barrier, { recursive: true }); writeFileSync(path.join(barrier, String(process.pid)), 'waiting');
    const began = Date.now();
    while (!existsSync(path.join(barrier, 'release'))) { if (Date.now() - began > 30000) throw new Error('Cache barrier timed out'); pause(10); }
    try {
      renameSync(staging, target);
      if (configuration.damageWinner) { writeFileSync(path.join(target, 'graph.db.zst'), 'damaged winner'); writeFileSync(path.join(barrier, 'damaged'), 'yes'); }
    } catch (error) {
      if (configuration.damageWinner) while (!existsSync(path.join(barrier, 'damaged'))) { if (Date.now() - began > 30000) throw error; pause(10); }
      throw error;
    }
  };
  globalThis.__cbmReview = { request, install };
  const result = configuration.action === 'publish'
    ? implementation.publishMain(configuration.repo, configuration.snapshot, { request, cache: configuration.cache, checkCI: () => true })
    : implementation.syncMain(configuration.repo, configuration.cache, { request, install });
  console.log(JSON.stringify({ result, commit: implementation.verifyMain(result, configuration.repo).commit }));
}
