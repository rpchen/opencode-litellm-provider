#!/usr/bin/env node
// Immutable main snapshots and safe task boundaries, shared by all repositories.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync, renameSync, rmSync, rmdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CBM_VERSION, binaryPath, repository, run, toolData, refresh, sync as syncRelease } from './codebase-memory.mjs';

export const INDEX_BRANCH = 'codebase-memory-index';
export const MAIN_ASSETS = ['graph.db.zst', 'artifact.json', 'manifest.json'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const oid = value => /^[a-f0-9]{40}$/.test(value ?? '');
const taskContext = new AsyncLocalStorage();
function boundedRun(command, args, options = {}) {
  try { return run(command, args, { ...options, timeout: remaining(taskContext.getStore()?.deadline, options.timeout ?? 120000) }); }
  catch (error) {
    if (error.code === 'ETIMEDOUT' || /ETIMEDOUT|timed out/.test(error.message)) throw new Error('Index preparation timed out');
    throw error;
  }
}
const git = (root, ...args) => boundedRun('git', args, { cwd: root });
const assert = (value, message) => { if (!value) throw new Error(message); };
function api(endpoint, data, { method = 'POST', deadline = taskContext.getStore()?.deadline } = {}) {
  const args = ['api', endpoint, ...(data ? ['--method', 'POST', '--input', '-'] : [])];
  if (data) args[args.indexOf('POST')] = method;
  return JSON.parse(run('gh', args, { ...(data ? { input: JSON.stringify(data) } : {}), maxBuffer: 80 * 1024 * 1024, timeout: remaining(deadline, 30000) }));
}
function remaining(deadline, maximum = 120000) {
  if (!deadline) return maximum;
  assert(Date.now() < deadline, 'Index preparation timed out');
  return Math.max(1, Math.min(maximum, deadline - Date.now()));
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
    artifact.project === manifest.project && artifact.reconcile_basis === 'git-clean-head' &&
    manifest.source?.kind === 'isolated-git' && manifest.source.commit === manifest.commit && manifest.source.tree === manifest.tree && manifest.source.clean === true &&
    /^[\w.-]+$/.test(manifest.project ?? '') && Number.isInteger(artifact.nodes) && artifact.nodes > 0 &&
    artifact.compressed_size === bytes['graph.db.zst'].length && bytes['graph.db.zst'].subarray(0, 4).toString('hex') === '28b52ffd' &&
    MAIN_ASSETS.slice(0, 2).every(name => digest(bytes[name]) === manifest.sha256?.[name]), 'Main index identity or integrity verification failed');
  return manifest;
}
export function buildMain(repo, destination, { execute = run, binary = binaryPath() } = {}) {
  assert(oid(repo.commit) && git(repo.root, 'rev-parse', 'HEAD') === repo.commit, 'Source HEAD changed before indexing');
  assert(!sourceDirty(repo.root), 'Main index requires clean source');
  const chosen = selection(repo.root);
  // Never overwrite a live working database while producing a portable snapshot.
  const project = `${chosen?.project ?? repo.slug.replace('/', '-')}-main-${repo.commit}`;
  const original = checkoutState(repo.root);
  const isolation = mkdtempSync(path.join(os.tmpdir(), 'cbm-main-source-'));
  const root = path.join(isolation, 'source');
  let manifestWritten = false;
  try {
    git(repo.root, 'clone', '--no-hardlinks', '--no-checkout', '--quiet', repo.root, root);
    git(root, 'checkout', '--quiet', '--detach', repo.commit);
    const fixed = checkoutState(root);
    assert(!fixed.dirty && fixed.head === repo.commit && fixed.tree === original.tree, 'Isolated source is not the requested clean commit');
    assert(execute(binary, ['--version']).includes(CBM_VERSION), 'Unexpected native index runtime');
    const indexed = toolData(JSON.parse(execute(binary, ['cli', '--quiet', '--json', 'index_repository', '--repo-path', root, '--name', project, '--mode', 'full', '--persistence', 'true'], { cwd: root })));
    assert(indexed.status === 'indexed', 'Native indexing did not explicitly succeed');
    const status = toolData(JSON.parse(execute(binary, ['cli', '--quiet', '--json', 'index_status', '--project', indexed.project, '--format', 'json'], { cwd: root })));
    assert(status.status === 'ready' && status.nodes > 0 && indexed.project === project && status.project === project && realpathSync(status.root_path) === realpathSync(root), 'Native index is not ready for the isolated source');
    assertState(root, fixed);
    assertState(repo.root, original);
    mkdirSync(destination, { recursive: true });
    for (const name of MAIN_ASSETS.slice(0, 2)) copyFileSync(path.join(root, '.codebase-memory', name), path.join(destination, name));
    const artifact = JSON.parse(readFileSync(path.join(destination, 'artifact.json'), 'utf8'));
    assert(artifact.nodes === status.nodes && artifact.edges === status.edges && artifact.commit === fixed.head && artifact.project === project && artifact.reconcile_basis === 'git-clean-head', 'Exported graph counts or source differ from the indexed database');
    const tree = git(repo.root, 'rev-parse', `${repo.commit}^{tree}`);
    const sha256 = Object.fromEntries(MAIN_ASSETS.slice(0, 2).map(name => [name, digest(readFileSync(path.join(destination, name)))]));
    assertState(root, fixed); assertState(repo.root, original);
    writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ schema_version: 1, kind: 'merged-main', repository: repo.slug, commit: repo.commit, tree, project: artifact.project, cbm_version: CBM_VERSION, source: { kind: 'isolated-git', commit: fixed.head, tree: fixed.tree, clean: true }, sha256 }, null, 2) + '\n');
    manifestWritten = true;
    verifyMain(destination, { ...repo, tree });
    assertState(root, fixed); assertState(repo.root, original);
    return destination;
  } catch (error) {
    if (manifestWritten) rmSync(path.join(destination, 'manifest.json'), { force: true });
    throw error;
  } finally {
    assert(path.dirname(isolation) === os.tmpdir() && path.basename(isolation).startsWith('cbm-main-source-'), 'Unsafe isolation cleanup path');
    rmSync(isolation, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
function branchHead(slug, request = api) {
  try { return request(`repos/${slug}/git/ref/heads/${INDEX_BRANCH}`).object.sha; }
  catch (error) { if (missing(error)) return undefined; throw error; }
}
function remoteFiles(repo, branch, request = api) {
  assert(oid(branch), 'Invalid remote index branch');
  const files = request(`repos/${repo.slug}/contents/snapshots/${repo.commit}?ref=${branch}`);
  assert(Array.isArray(files) && MAIN_ASSETS.every(name => files.some(file => file.name === name && file.type === 'file' && oid(file.sha))), 'Remote index is incomplete');
  return Object.fromEntries(MAIN_ASSETS.map(name => [name, files.find(file => file.name === name)]));
}
function blob(slug, sha, request = api) {
  const value = request(`repos/${slug}/git/blobs/${sha}`);
  assert(value.encoding === 'base64' && value.sha === sha, 'Invalid remote blob');
  const bytes = Buffer.from(value.content, 'base64');
  const computed = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert(computed === sha, 'Remote blob checksum mismatch');
  return bytes;
}
export function syncMain(repo, cache = process.env.CBM_MAIN_CACHE ?? path.join(os.homedir(), '.cache/codebase-memory-main'), { checkRemote = false, request = api, install = renameSync } = {}) {
  assert(oid(repo.commit) && /^[\w.-]+\/[\w.-]+$/.test(repo.slug), 'Invalid snapshot identity');
  const target = path.join(cache, repo.slug, repo.commit);
  if (existsSync(path.join(target, 'manifest.json')) && !checkRemote) { verifyMain(target, repo); return target; }
  const head = branchHead(repo.slug, request);
  assert(head, 'Remote index publication is pending: index branch is absent');
  let files;
  try { files = remoteFiles(repo, head, request); }
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
    for (const name of MAIN_ASSETS) writeFileSync(path.join(staging, name), blob(repo.slug, files[name].sha, request));
    verifyMain(staging, repo);
    const winner = () => {
      verifyMain(target, repo);
      assert(MAIN_ASSETS.every(name => {
        const bytes = readFileSync(path.join(target, name));
        return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === files[name].sha;
      }), 'Concurrent cache winner differs from remote');
    };
    if (existsSync(path.join(target, 'manifest.json'))) { winner(); return target; }
    for (let attempt = 0; ; attempt++) {
      remaining(taskContext.getStore()?.deadline);
      try { install(staging, target); break; }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        if (existsSync(target)) { winner(); break; }
        // Windows scanners can briefly hold the private staging directory.
        // Retry only a sharing/permission error with no winner, and stay bounded.
        if (!['EPERM', 'EACCES'].includes(error.code) || attempt === 7) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(remaining(taskContext.getStore()?.deadline), 200, 50 * (attempt + 1)));
      }
    }
    winner();
    return target;
  } finally {
    assert(staging.startsWith(path.dirname(target) + path.sep), 'Unsafe staging cleanup path');
    rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
export function publishMain(repo, directory, { request = api, cache, checkCI = verifyMainCI } = {}) {
  verifyMain(directory, repo);
  checkCI(repo, { request });
  for (let attempt = 0; attempt < 12; attempt++) {
    const parent = branchHead(repo.slug, request);
    if (parent) {
      try { remoteFiles(repo, parent, request); return syncMain(repo, cache, { checkRemote: true, request }); }
      catch (error) { if (!missing(error)) throw error; }
    }
    const baseTree = parent ? request(`repos/${repo.slug}/git/commits/${parent}`).tree.sha : undefined;
    const entries = MAIN_ASSETS.map(name => {
      const bytes = readFileSync(path.join(directory, name));
      const created = request(`repos/${repo.slug}/git/blobs`, { content: bytes.toString('base64'), encoding: 'base64' });
      return { path: `snapshots/${repo.commit}/${name}`, mode: '100644', type: 'blob', sha: created.sha };
    });
    const tree = request(`repos/${repo.slug}/git/trees`, { ...(baseTree ? { base_tree: baseTree } : {}), tree: entries });
    const commit = request(`repos/${repo.slug}/git/commits`, { message: `chore: publish main index ${repo.commit}`, tree: tree.sha, parents: parent ? [parent] : [] });
    try {
      if (parent) request(`repos/${repo.slug}/git/refs/heads/${INDEX_BRANCH}`, { sha: commit.sha, force: false }, { method: 'PATCH' });
      else request(`repos/${repo.slug}/git/refs`, { ref: `refs/heads/${INDEX_BRANCH}`, sha: commit.sha });
      return syncMain(repo, cache, { checkRemote: true, request });
    } catch (error) {
      if (!/HTTP (409|422)/.test(error.message) || attempt === 11) throw error;
      // Retry against the new branch parent; avoid synchronized publishers
      // repeatedly racing each other. No ref is ever updated with force=true.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(1000, 50 * 2 ** attempt) + Math.floor(Math.random() * 100));
    }
  }
}
function sourceDirty(root) {
  return git(root, 'status', '--porcelain', '--untracked-files=all', '--', '.', ':!.codebase-memory/artifact.json', ':!.codebase-memory/graph.db.zst', ':!.codebase-memory/task.lock', ':!.codebase-memory/ready.json');
}
export function checkoutState(root) {
  const main = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/main'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: remaining(taskContext.getStore()?.deadline) });
  if (main.error?.code === 'ETIMEDOUT') throw new Error('Index preparation timed out');
  assert(!main.error && [0, 1].includes(main.status), 'Cannot read local main identity');
  return { branch: git(root, 'branch', '--show-current'), head: git(root, 'rev-parse', 'HEAD'),
    tree: git(root, 'rev-parse', 'HEAD^{tree}'), main: main.status === 0 ? main.stdout.trim() : '', dirty: sourceDirty(root) };
}
function assertState(root, expected) {
  assert(JSON.stringify(checkoutState(root)) === JSON.stringify(expected), 'Checkout changed during preparation/indexing; branch and source are preserved');
}
function fetchMain(root, deadline) {
  run('git', ['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main'], { cwd: root, timeout: remaining(deadline) });
  return { commit: git(root, 'rev-parse', 'origin/main'), verified_at: new Date().toISOString() };
}
function ancestor(root, older, newer) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd: root, windowsHide: true, timeout: remaining(taskContext.getStore()?.deadline) });
  if (result.error?.code === 'ETIMEDOUT') throw new Error('Index preparation timed out');
  if (result.error || ![0, 1].includes(result.status)) throw new Error('Cannot prove Git ancestry');
  return result.status === 0;
}
export function branchWasMerged(repo, branch, target, { request = api } = {}) {
  if (ancestor(repo.root, repo.commit, target)) return true;
  if (!branch || branch === 'main') return false;
  // Squash merges do not preserve feature-head ancestry. Require GitHub's
  // merged record for this exact head and a merge commit on the current main.
  const head = encodeURIComponent(`${repo.slug.split('/')[0]}:${branch}`);
  const pulls = request(`repos/${repo.slug}/pulls?state=closed&base=main&head=${head}&per_page=100`);
  assert(Array.isArray(pulls), 'Cannot verify merged branch identity');
  return pulls.some(pull => pull.merged_at && pull.head?.sha === repo.commit && pull.base?.ref === 'main' && oid(pull.merge_commit_sha) && ancestor(repo.root, pull.merge_commit_sha, target));
}
async function prepareUnlocked(cwd, { mode = 'new', waitMs = 0, deadline, services = {} } = {}) {
  assert(['new', 'resume', 'finish'].includes(mode) && Number.isInteger(waitMs) && waitMs >= 0 && waitMs <= 120000, 'Invalid preparation mode or wait duration');
  // This function runs only while holding the repository lock; the identity
  // and checkout state are read here, from the live checkout.
  const identify = services.repository ?? (value => repository(value, boundedRun));
  const original = identify(cwd);
  if (!selection(original.root)) return { status: 'legacy', root: original.root, commit: original.commit };
  const fetch = () => (services.fetchMain ?? fetchMain)(original.root, deadline);
  let state = checkoutState(original.root);
  assert(state.head === original.commit, 'Checkout changed before preparation; branch and source are preserved');
  let remote = fetch();
  assertState(original.root, state);
  const { branch, dirty } = state;
  const merged = dirty ? false : branchWasMerged(original, branch, remote.commit, { request: services.request });
  if (dirty || !merged || !branch) {
    assert(mode === 'resume', `New task cannot use current checkout: ${dirty ? 'uncommitted source changes' : 'unfinished branch or detached HEAD'}. Existing work is preserved.`);
    const status = (services.activate ?? (repo => refresh(repo, { execute: boundedRun })))(original);
    return { status: 'working', root: original.root, branch, commit: original.commit, project: status.project, reason: 'existing work preserved' };
  }
  // One deadline covers lock acquisition, retargeting and every network wait.
  // waitMs=0 allows one immediate attempt but never a publication wait.
  for (;;) {
    remaining(deadline);
    assertState(original.root, state);
    const target = remote.commit;
    const expected = { ...original, commit: target, tree: git(original.root, 'rev-parse', `${target}^{tree}`) };
    let snapshot;
    try { snapshot = await (services.syncSnapshot ?? syncMain)(expected, undefined, { checkRemote: true, deadline, request: (endpoint, data, options) => api(endpoint, data, { ...options, deadline }) }); }
    catch (error) {
      if (!/publication is pending/.test(error.message) || !waitMs) throw error;
      remaining(deadline);
      assertState(original.root, state);
      const latest = fetch();
      if (latest.commit !== target) { remote = latest; continue; }
      await new Promise(resolve => setTimeout(resolve, Math.min(2000, remaining(deadline))));
      remote = fetch();
      continue;
    }
    const manifest = verifyMain(snapshot, expected);
    // The target may have advanced while its index was awaited/downloaded.
    remote = fetch();
    assertState(original.root, state);
    if (remote.commit !== target) { assert(waitMs > 0, 'Remote main changed; immediate preparation has no remaining wait budget'); continue; }
    assert(ancestor(original.root, state.main, target), 'Local main has unpushed commits');
    const otherMain = git(original.root, 'worktree', 'list', '--porcelain').split('\n\n').some(entry =>
      entry.split('\n').includes('branch refs/heads/main') && path.resolve(entry.split('\n').find(line => line.startsWith('worktree '))?.slice(9) ?? '') !== path.resolve(original.root));
    assert(!otherMain, 'Main belongs to another worktree');
    // Never merge through symbolic HEAD: another same-SHA branch must not be
    // advanced. Git protects the checkout; explicit main updates use old-OID CAS.
    if (state.head !== target || state.branch !== 'main') {
      assertState(original.root, state);
      git(original.root, 'switch', '--detach', target);
      state = { ...state, branch: '', head: target, tree: expected.tree };
      assertState(original.root, state);
      git(original.root, 'update-ref', '--no-deref', 'refs/heads/main', target, state.main);
      state = { ...state, main: target };
      assertState(original.root, state);
      git(original.root, 'switch', 'main');
      state = { ...state, branch: 'main' };
      assertState(original.root, state);
    }
    assertState(original.root, state);
    git(original.root, 'branch', '--set-upstream-to=origin/main', 'main');
    assertState(original.root, state);
    for (const name of MAIN_ASSETS.slice(0, 2)) copyFileSync(path.join(snapshot, name), path.join(original.root, '.codebase-memory', name));
    const repo = identify(original.root);
    const status = await (services.activate ?? ((value) => refresh(value, { execute: (command, argv, options) => run(command, argv, { ...options, timeout: remaining(deadline) }) })))(repo);
    const active = JSON.parse(readFileSync(path.join(repo.root, '.codebase-memory/artifact.json'), 'utf8'));
    assert(active.commit === target && active.project === status.project && realpathSync(status.root_path) === realpathSync(repo.root), 'Activated working index does not match source/root/project');
    assertState(repo.root, state);
    verifyMain(snapshot, expected);
    const snapshotSha256 = Object.fromEntries(MAIN_ASSETS.map(name => [name, digest(readFileSync(path.join(snapshot, name)))]));
    let releaseSnapshot;
    try {
      releaseSnapshot = (services.syncRelease ?? syncRelease)(repo, process.env.CBM_RELEASE_CACHE ?? path.join(os.homedir(), '.cache/codebase-memory-releases'),
        { execute: (command, argv, options) => run(command, argv, { ...options, timeout: remaining(deadline) }) });
    } catch { /* Older optional Release data never substitutes for main readiness. */ }
    remote = fetch();
    assertState(repo.root, state);
    if (remote.commit !== target) { assert(waitMs > 0, 'Remote main changed; immediate preparation has no remaining wait budget'); continue; }
    remaining(deadline);
    const actual = checkoutState(repo.root);
    remaining(deadline);
    assert(actual.branch === 'main' && actual.head === target && actual.tree === manifest.tree && !actual.dirty, 'Final checkout is not verified main');
    const receipt = { schema_version: 1, status: 'ready', repository: repo.slug, root: repo.root, branch: actual.branch, commit: actual.head,
      index_commit: manifest.commit, tree: actual.tree, remote_verified_at: remote.verified_at, snapshot, project: status.project, sha256: manifest.sha256,
      snapshot_sha256: snapshotSha256, ...(releaseSnapshot ? { releaseSnapshot } : {}) };
    writeFileSync(path.join(repo.root, '.codebase-memory/ready.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  }
}
export async function prepareMain(cwd, options = {}) {
  const started = Date.now();
  const deadline = options.waitMs > 0 ? started + options.waitMs : undefined;
  return taskContext.run({ deadline }, () => prepareLocked(cwd, { ...options, started, deadline }));
}
async function prepareLocked(cwd, options) {
  const { started, deadline } = options;
  const identify = options.services?.repository ?? (value => repository(value, boundedRun));
  // Before the lock, read only the stable repository location needed to take
  // the correct lock. HEAD, branch and working-tree state are re-read inside
  // the lock: a queued client must never act on a snapshot taken while
  // another client still owned the checkout.
  const locate = identify(cwd);
  if (!selection(locate.root)) return { status: 'legacy', root: locate.root, commit: locate.commit };
  // All worktrees and all four clients share the same repository mutex.
  const lock = path.join(path.resolve(locate.root, git(locate.root, 'rev-parse', '--git-common-dir')), 'codebase-memory-task.lock');
  const ownerFile = path.join(lock, 'owner.json');
  const token = randomUUID();
  const lockDeadline = Math.min(deadline ?? Infinity, started + 30000);
  let acquired = false;
  while (!acquired) {
    remaining(deadline);
    try { mkdirSync(lock); acquired = true; writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, token })); }
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
      assert(Date.now() < lockDeadline, 'Another client is preparing this repository; wait timed out and existing work is preserved');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  try {
    // Everything inside the lock re-reads the live checkout. A queued
    // predecessor may legitimately have advanced main and written a fresh
    // receipt; this client must prepare that state, not its stale snapshot.
    return await prepareUnlocked(cwd, { ...options, deadline });
  }
  catch (error) {
    // A failed attempt leaves no receipt claiming readiness: the checkout may
    // have half-advanced, or diverged from what any older receipt described.
    // Removal never masks the original failure.
    try { rmSync(path.join(locate.root, '.codebase-memory/ready.json'), { force: true }); } catch { /* Receipt removal is best effort on failure. */ }
    throw error;
  }
  finally {
    const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
    assert(path.basename(lock) === 'codebase-memory-task.lock' && owner.pid === process.pid && owner.token === token, 'Task lock ownership changed');
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
export function verifyMainCI(repo, { request = api } = {}) {
  git(repo.root, 'fetch', '--no-tags', 'origin', 'refs/heads/main');
  const remote = request(`repos/${repo.slug}/commits/main`).sha;
  assert(ancestor(repo.root, repo.commit, remote), 'Index source is not part of remote main');
  const runs = request(`repos/${repo.slug}/actions/workflows/ci.yml/runs?head_sha=${repo.commit}&event=push&per_page=100`).workflow_runs;
  const latest = runs.filter(item => item.head_sha === repo.commit && item.head_branch === 'main' && item.event === 'push').sort((a, b) => b.id - a.id)[0];
  assert(latest?.status === 'completed' && latest.conclusion === 'success', 'Exact main commit has not passed complete CI');
  return latest.id;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
