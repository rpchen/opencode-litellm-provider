#!/usr/bin/env node
// Immutable main snapshots and safe task boundaries, shared by all repositories.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CBM_VERSION, binaryPath, repository, run, toolData, refresh, sync as syncRelease } from './codebase-memory.mjs';

export const INDEX_BRANCH = 'codebase-memory-index';
export const MAIN_ASSETS = ['graph.db.zst', 'artifact.json', 'manifest.json'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const oid = value => /^[a-f0-9]{40}$/.test(value ?? '');
const git = (root, ...args) => run('git', args, { cwd: root });
const assert = (value, message) => { if (!value) throw new Error(message); };
function api(endpoint, data) {
  const args = ['api', endpoint, ...(data ? ['--method', 'POST', '--input', '-'] : [])];
  return JSON.parse(run('gh', args, { ...(data ? { input: JSON.stringify(data) } : {}), maxBuffer: 80 * 1024 * 1024, timeout: 30000 }));
}
function missing(error) { return /HTTP 404/.test(error.message); }
export function selection(root) {
  const file = path.join(root, '.codebase-memory/selection.json');
  if (!existsSync(file)) return undefined;
  const value = JSON.parse(readFileSync(file, 'utf8'));
  assert(value.schema_version === 1 && value.distribution === 'merged-main' && value.index_branch === INDEX_BRANCH && /^[\w.-]+$/.test(value.project ?? ''), 'Invalid explicit index selection');
  return value;
}
export function verifyMain(directory, expected) {
  const bytes = Object.fromEntries(MAIN_ASSETS.map(name => [name, readFileSync(path.join(directory, name))]));
  const artifact = JSON.parse(bytes['artifact.json']);
  const manifest = JSON.parse(bytes['manifest.json']);
  assert(manifest.schema_version === 1 && manifest.kind === 'merged-main' && manifest.cbm_version === CBM_VERSION &&
    manifest.repository === expected.slug && manifest.commit === expected.commit && oid(manifest.commit) && oid(manifest.tree) &&
    (!expected.tree || manifest.tree === expected.tree) && artifact.schema_version === 2 && artifact.commit === manifest.commit &&
    artifact.project === manifest.project && /^[\w.-]+$/.test(manifest.project ?? '') && Number.isInteger(artifact.nodes) && artifact.nodes > 0 &&
    artifact.compressed_size === bytes['graph.db.zst'].length && bytes['graph.db.zst'].subarray(0, 4).toString('hex') === '28b52ffd' &&
    MAIN_ASSETS.slice(0, 2).every(name => digest(bytes[name]) === manifest.sha256?.[name]), 'Main index identity or integrity verification failed');
  return manifest;
}
export function buildMain(repo, destination) {
  assert(oid(repo.commit) && git(repo.root, 'rev-parse', 'HEAD') === repo.commit, 'Source HEAD changed before indexing');
  assert(!sourceDirty(repo.root), 'Main index requires clean source');
  const chosen = selection(repo.root);
  // Never overwrite a live working database while producing a portable snapshot.
  const project = `${chosen?.project ?? repo.slug.replace('/', '-')}-main-${repo.commit}`;
  const binary = binaryPath();
  assert(run(binary, ['--version']).includes(CBM_VERSION), 'Unexpected native index runtime');
  const indexed = toolData(JSON.parse(run(binary, ['cli', '--quiet', '--json', 'index_repository', '--repo-path', repo.root, '--name', project, '--mode', 'full', '--persistence', 'true'], { cwd: repo.root })));
  assert(indexed.status === 'indexed', 'Native indexing did not explicitly succeed');
  const status = toolData(JSON.parse(run(binary, ['cli', '--quiet', '--json', 'index_status', '--project', indexed.project, '--format', 'json'], { cwd: repo.root })));
  assert(status.status === 'ready' && status.nodes > 0, 'Native index is not ready');
  mkdirSync(destination, { recursive: true });
  for (const name of MAIN_ASSETS.slice(0, 2)) copyFileSync(path.join(repo.root, '.codebase-memory', name), path.join(destination, name));
  const artifact = JSON.parse(readFileSync(path.join(destination, 'artifact.json'), 'utf8'));
  assert(artifact.nodes === status.nodes && artifact.edges === status.edges, 'Exported graph counts differ from the indexed database');
  const tree = git(repo.root, 'rev-parse', `${repo.commit}^{tree}`);
  const sha256 = Object.fromEntries(MAIN_ASSETS.slice(0, 2).map(name => [name, digest(readFileSync(path.join(destination, name)))]));
  writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ schema_version: 1, kind: 'merged-main', repository: repo.slug, commit: repo.commit, tree, project: artifact.project, cbm_version: CBM_VERSION, sha256 }, null, 2) + '\n');
  verifyMain(destination, { ...repo, tree });
  assert(git(repo.root, 'rev-parse', 'HEAD') === repo.commit, 'Source HEAD changed during indexing');
  return destination;
}
function branchHead(slug) {
  try { return api(`repos/${slug}/git/ref/heads/${INDEX_BRANCH}`).object.sha; }
  catch (error) { if (missing(error)) return undefined; throw error; }
}
function remoteFiles(repo, branch) {
  assert(oid(branch), 'Invalid remote index branch');
  const files = api(`repos/${repo.slug}/contents/snapshots/${repo.commit}?ref=${branch}`);
  assert(Array.isArray(files) && MAIN_ASSETS.every(name => files.some(file => file.name === name && file.type === 'file' && oid(file.sha))), 'Remote index is incomplete');
  return Object.fromEntries(MAIN_ASSETS.map(name => [name, files.find(file => file.name === name)]));
}
function blob(slug, sha) {
  const value = api(`repos/${slug}/git/blobs/${sha}`);
  assert(value.encoding === 'base64' && value.sha === sha, 'Invalid remote blob');
  const bytes = Buffer.from(value.content, 'base64');
  const computed = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert(computed === sha, 'Remote blob checksum mismatch');
  return bytes;
}
export function syncMain(repo, cache = process.env.CBM_MAIN_CACHE ?? path.join(os.homedir(), '.cache/codebase-memory-main'), { checkRemote = false } = {}) {
  assert(oid(repo.commit) && /^[\w.-]+\/[\w.-]+$/.test(repo.slug), 'Invalid snapshot identity');
  const target = path.join(cache, repo.slug, repo.commit);
  if (existsSync(path.join(target, 'manifest.json')) && !checkRemote) { verifyMain(target, repo); return target; }
  const head = branchHead(repo.slug);
  assert(head, 'Remote index publication is pending: index branch is absent');
  let files;
  try { files = remoteFiles(repo, head); }
  catch (error) { if (missing(error)) throw new Error(`Remote index publication is pending for ${repo.commit}`); throw error; }
  if (existsSync(path.join(target, 'manifest.json'))) {
    verifyMain(target, repo);
    assert(MAIN_ASSETS.every(name => {
      const bytes = readFileSync(path.join(target, name));
      return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === files[name].sha;
    }), 'Local immutable snapshot differs from remote');
    return target;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const staging = mkdtempSync(path.join(path.dirname(target), '.download-'));
  try {
    for (const name of MAIN_ASSETS) writeFileSync(path.join(staging, name), blob(repo.slug, files[name].sha));
    verifyMain(staging, repo);
    if (existsSync(path.join(target, 'manifest.json'))) { verifyMain(target, repo); return syncMain(repo, cache, { checkRemote: true }); }
    renameSync(staging, target);
    return target;
  } finally {
    assert(staging.startsWith(path.dirname(target) + path.sep), 'Unsafe staging cleanup path');
    rmSync(staging, { recursive: true, force: true });
  }
}
export function publishMain(repo, directory) {
  verifyMain(directory, repo);
  verifyMainCI(repo);
  for (let attempt = 0; attempt < 3; attempt++) {
    const parent = branchHead(repo.slug);
    if (parent) {
      try { remoteFiles(repo, parent); return syncMain(repo, undefined, { checkRemote: true }); }
      catch (error) { if (!missing(error)) throw error; }
    }
    const baseTree = parent ? api(`repos/${repo.slug}/git/commits/${parent}`).tree.sha : undefined;
    const entries = MAIN_ASSETS.map(name => {
      const bytes = readFileSync(path.join(directory, name));
      const created = api(`repos/${repo.slug}/git/blobs`, { content: bytes.toString('base64'), encoding: 'base64' });
      return { path: `snapshots/${repo.commit}/${name}`, mode: '100644', type: 'blob', sha: created.sha };
    });
    const tree = api(`repos/${repo.slug}/git/trees`, { ...(baseTree ? { base_tree: baseTree } : {}), tree: entries });
    const commit = api(`repos/${repo.slug}/git/commits`, { message: `chore: publish main index ${repo.commit}`, tree: tree.sha, parents: parent ? [parent] : [] });
    try {
      if (parent) run('gh', ['api', `repos/${repo.slug}/git/refs/heads/${INDEX_BRANCH}`, '--method', 'PATCH', '--input', '-'], { input: JSON.stringify({ sha: commit.sha, force: false }), timeout: 30000 });
      else api(`repos/${repo.slug}/git/refs`, { ref: `refs/heads/${INDEX_BRANCH}`, sha: commit.sha });
      return syncMain(repo, undefined, { checkRemote: true });
    } catch (error) { if (!/HTTP (409|422)/.test(error.message) || attempt === 2) throw error; }
  }
}
function sourceDirty(root) {
  return git(root, 'status', '--porcelain', '--untracked-files=normal', '--', '.', ':!.codebase-memory/artifact.json', ':!.codebase-memory/graph.db.zst', ':!.codebase-memory/task.lock', ':!.codebase-memory/ready.json');
}
function ancestor(root, older, newer) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd: root, windowsHide: true });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('Cannot prove Git ancestry');
  return result.status === 0;
}
export function branchWasMerged(repo, branch, target) {
  if (ancestor(repo.root, repo.commit, target)) return true;
  if (!branch || branch === 'main') return false;
  // Squash merges do not preserve feature-head ancestry. Require GitHub's
  // merged record for this exact head and a merge commit on the current main.
  const head = encodeURIComponent(`${repo.slug.split('/')[0]}:${branch}`);
  const pulls = api(`repos/${repo.slug}/pulls?state=closed&base=main&head=${head}&per_page=100`);
  assert(Array.isArray(pulls), 'Cannot verify merged branch identity');
  return pulls.some(pull => pull.merged_at && pull.head?.sha === repo.commit && pull.base?.ref === 'main' && oid(pull.merge_commit_sha) && ancestor(repo.root, pull.merge_commit_sha, target));
}
async function prepareUnlocked(cwd, { mode = 'new', waitMs = 0 } = {}) {
  assert(['new', 'resume', 'finish'].includes(mode) && Number.isInteger(waitMs) && waitMs >= 0 && waitMs <= 120000, 'Invalid preparation mode or wait duration');
  const original = repository(cwd);
  if (!selection(original.root)) return { status: 'legacy', root: original.root, commit: original.commit };
  git(original.root, 'fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
  const target = git(original.root, 'rev-parse', 'origin/main');
  const branch = git(original.root, 'branch', '--show-current');
  const dirty = sourceDirty(original.root);
  const merged = dirty ? false : branchWasMerged(original, branch, target);
  if (dirty || !merged || !branch) {
    assert(mode === 'resume', `New task cannot use current checkout: ${dirty ? 'uncommitted source changes' : 'unfinished branch or detached HEAD'}. Existing work is preserved.`);
    const status = refresh(original);
    return { status: 'working', root: original.root, branch, commit: original.commit, project: status.project, reason: 'existing work preserved' };
  }
  const expected = { ...original, commit: target, tree: git(original.root, 'rev-parse', `${target}^{tree}`) };
  let snapshot;
  const deadline = Date.now() + waitMs;
  while (!snapshot) {
    try { snapshot = syncMain(expected, undefined, { checkRemote: mode === 'finish' }); }
    catch (error) {
      if (!/publication is pending/.test(error.message) || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(2000, Math.max(1, deadline - Date.now()))));
    }
  }
  // A network wait must not turn edits made by another client into checkout loss.
  assert(git(original.root, 'rev-parse', 'HEAD') === original.commit && !sourceDirty(original.root), 'Checkout changed during preparation; preserved without switching');
  if (branch === 'main') git(original.root, 'merge', '--ff-only', target);
  else {
    const main = git(original.root, 'rev-parse', 'refs/heads/main');
    assert(ancestor(original.root, main, target), 'Local main has unpushed commits');
    assert(!git(original.root, 'worktree', 'list', '--porcelain').includes('branch refs/heads/main'), 'Main belongs to another worktree');
    git(original.root, 'update-ref', 'refs/heads/main', target, main);
    git(original.root, 'switch', 'main');
  }
  git(original.root, 'branch', '--set-upstream-to=origin/main', 'main');
  for (const name of MAIN_ASSETS.slice(0, 2)) copyFileSync(path.join(snapshot, name), path.join(original.root, '.codebase-memory', name));
  const repo = repository(original.root);
  const status = refresh(repo);
  const active = JSON.parse(readFileSync(path.join(repo.root, '.codebase-memory/artifact.json'), 'utf8'));
  assert(active.commit === target && active.project === status.project && path.resolve(status.root_path) === path.resolve(repo.root), 'Activated working index does not match source/root/project');
  const manifest = verifyMain(snapshot, expected);
  assert(git(repo.root, 'rev-parse', 'HEAD') === target && !sourceDirty(repo.root), 'Checkout changed while activating index');
  const receipt = { schema_version: 1, status: 'ready', repository: repo.slug, root: repo.root, branch: 'main', commit: target, tree: expected.tree, snapshot, project: status.project, sha256: manifest.sha256 };
  try { receipt.releaseSnapshot = syncRelease(repo, process.env.CBM_RELEASE_CACHE ?? path.join(os.homedir(), '.cache/codebase-memory-releases')); }
  catch { /* A missing older Release does not weaken the verified main snapshot. */ }
  writeFileSync(path.join(repo.root, '.codebase-memory/ready.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
export async function prepareMain(cwd, options = {}) {
  const repo = repository(cwd);
  if (!selection(repo.root)) return { status: 'legacy', root: repo.root, commit: repo.commit };
  const lock = path.resolve(repo.root, '.codebase-memory/task.lock');
  const ownerFile = path.join(lock, 'owner.json');
  const deadline = Date.now() + 30000;
  let acquired = false;
  while (!acquired) {
    try { mkdirSync(lock); acquired = true; writeFileSync(ownerFile, JSON.stringify({ pid: process.pid })); }
    catch (error) {
      if (acquired || error.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
          let live = true;
          try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') live = false; }
          if (!live) { rmSync(ownerFile); rmdirSync(lock); continue; }
        }
      } catch { /* An active owner may still be creating its receipt. */ }
      assert(Date.now() < deadline, 'Another client is preparing this repository; existing work is preserved');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  try { return await prepareUnlocked(cwd, options); }
  finally {
    assert(path.dirname(lock) === path.resolve(repo.root, '.codebase-memory') && JSON.parse(readFileSync(ownerFile, 'utf8')).pid === process.pid, 'Task lock ownership changed');
    rmSync(ownerFile); rmdirSync(lock);
  }
}
export async function main(args = process.argv.slice(2)) {
  const [action, supplied] = args;
  const repo = repository();
  const destination = path.resolve(supplied ?? '.tmp/codebase-memory-main');
  if (action === 'check-ci') console.log(`Verified CI ${verifyMainCI(repo)} for ${repo.commit}`);
  else if (action === 'build') console.log(buildMain(repo, destination));
  else if (action === 'publish') console.log(publishMain(repo, destination));
  else if (action === 'sync') console.log(syncMain(repo, undefined, { checkRemote: true }));
  else if (action === 'prepare' || action === 'finish') console.log(JSON.stringify(await prepareMain(repo.root, { mode: action === 'finish' ? 'finish' : 'new', waitMs: Number(process.env.CBM_INDEX_WAIT_MS ?? 120000) }), null, 2));
  else throw new Error('Usage: codebase-memory-main.mjs build | publish | sync | prepare | finish');
}
export function verifyMainCI(repo) {
  git(repo.root, 'fetch', '--no-tags', 'origin', 'refs/heads/main');
  const remote = api(`repos/${repo.slug}/commits/main`).sha;
  assert(ancestor(repo.root, repo.commit, remote), 'Index source is not part of remote main');
  const runs = api(`repos/${repo.slug}/actions/workflows/ci.yml/runs?head_sha=${repo.commit}&event=push&per_page=100`).workflow_runs;
  const latest = runs.filter(item => item.head_sha === repo.commit && item.head_branch === 'main' && item.event === 'push').sort((a, b) => b.id - a.id)[0];
  assert(latest?.status === 'completed' && latest.conclusion === 'success', 'Exact main commit has not passed complete CI');
  return latest.id;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
