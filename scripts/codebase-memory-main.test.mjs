import { test as integrationTest } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync, cpSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { run } from './codebase-memory.mjs';
import { gitApi } from './codebase-memory-git-api.fixture.mjs';
// Real Git process startup takes longer than Bun's default five-second unit
// test limit on Windows. This harness limit never changes the asserted product
// timeout/deadline; those have their own bounded regression below.
const test = (name, fn) => integrationTest(name, { timeout: 120000 }, fn);

const implementation = await import(process.env.CBM_REVIEW_BASELINE ? pathToFileURL(path.resolve(process.env.CBM_REVIEW_BASELINE)).href : './codebase-memory-main.mjs');
const { prepareMain, buildMain, syncMain, publishMain, verifyMain, verifyMainCI } = implementation;
const assets = ['graph.db.zst', 'artifact.json', 'manifest.json'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const g = (cwd, ...args) => run('git', args, { cwd });
const commit = root => { g(root, 'add', '.'); g(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture'); return g(root, 'rev-parse', 'HEAD'); };
function fixture() {
  const base = path.resolve('.tmp'); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, 'cbm-main-git-'));
  const remote = path.join(dir, 'remote.git'), writer = path.join(dir, 'writer'), root = path.join(dir, 'checkout');
  g(dir, 'init', '--bare', '-b', 'main', remote); g(dir, 'init', '-b', 'main', writer);
  mkdirSync(path.join(writer, '.codebase-memory'));
  writeFileSync(path.join(writer, '.codebase-memory/selection.json'), JSON.stringify({ schema_version: 1, project: 'fixture', distribution: 'merged-main', index_branch: 'codebase-memory-index' }));
  writeFileSync(path.join(writer, '.gitignore'), '.codebase-memory/*\n!.codebase-memory/selection.json\n.tmp/\n');
  writeFileSync(path.join(writer, 'source.ts'), 'export const source = "A";\n');
  const A = commit(writer); g(writer, 'remote', 'add', 'origin', remote); g(writer, 'push', '-q', 'origin', 'main');
  g(dir, 'clone', '-q', remote, root);
  const identify = cwd => { const actual = g(cwd, 'rev-parse', '--show-toplevel'); return { root: actual, commit: g(actual, 'rev-parse', 'HEAD'), slug: 'example/fixture', project: 'fixture' }; };
  function advance() { writeFileSync(path.join(writer, 'source.ts'), 'export const source = "B";\n'); const B = commit(writer); g(writer, 'push', '-q', 'origin', 'main'); return B; }
  function snapshot(sha, output = path.join(dir, 'snapshots', sha), basis = 'git-clean-head') {
    mkdirSync(output, { recursive: true });
    const graph = Buffer.concat([Buffer.from('28b52ffd', 'hex'), Buffer.from(sha)]);
    const artifact = { schema_version: 2, project: `fixture-main-${sha}`, commit: sha, nodes: 2, edges: 1, compressed_size: graph.length, reconcile_basis: basis };
    const tree = g(writer, 'rev-parse', `${sha}^{tree}`);
    writeFileSync(path.join(output, assets[0]), graph); writeFileSync(path.join(output, assets[1]), JSON.stringify(artifact));
    const sha256 = Object.fromEntries(assets.slice(0, 2).map(name => [name, hash(readFileSync(path.join(output, name)))]));
    writeFileSync(path.join(output, assets[2]), JSON.stringify({ schema_version: 1, kind: 'merged-main', repository: 'example/fixture', commit: sha, tree, project: artifact.project, cbm_version: '0.11.0', source: { kind: 'isolated-git', commit: sha, tree, clean: true }, sha256 }));
    return output;
  }
  function activate(repo) {
    const marker = { schema_version: 2, project: 'native-fixture', commit: repo.commit, nodes: 2, edges: 1 };
    writeFileSync(path.join(repo.root, '.codebase-memory/artifact.json'), JSON.stringify(marker));
    return { status: 'ready', project: marker.project, root_path: repo.root, nodes: 2, edges: 1 };
  }
  function state(cwd = root) { return { branch: g(cwd, 'branch', '--show-current'), head: g(cwd, 'rev-parse', 'HEAD'), main: g(cwd, 'rev-parse', 'main'), status: g(cwd, 'status', '--porcelain'), staged: g(cwd, 'diff', '--cached'), source: readFileSync(path.join(cwd, 'source.ts'), 'utf8') }; }
  const services = { repository: identify, activate, syncRelease: () => undefined, syncSnapshot: expected => snapshot(expected.commit), request: endpoint => { if (endpoint.includes('/pulls?')) return []; throw new Error(`Unexpected fixture request: ${endpoint}`); } };
  return { dir, root, remote, writer, A, advance, snapshot, identify, services, state, cleanup() { assert.ok(dir.startsWith(base + path.sep)); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}
async function prepare(f, options = {}) {
  const services = { ...f.services, ...options.services };
  // Only used by the archived implementation's I/O adapter in the negative control.
  globalThis.__cbmReview = services;
  return prepareMain(f.root, { waitMs: 120000, ...options, services });
}

for (const mode of ['new', 'finish']) {
  test(`[CBM-RETARGET] ${mode} follows main A -> B during index download and reports actual checkout`, async () => {
    const f = fixture();
    try {
      let B, downloads = [];
      const receipt = await prepare(f, { mode, services: { syncSnapshot: expected => {
        downloads.push(expected.commit); if (!B) B = f.advance(); return f.snapshot(expected.commit);
      } } });
      assert.equal(receipt.commit, B); assert.equal(receipt.index_commit, B); assert.equal(receipt.branch, f.state().branch);
      assert.equal(f.state().head, B); assert.equal(f.state().main, B); assert.equal(f.state().status, '');
      assert.deepEqual(downloads, [f.A, B]); assert.ok(Number.isFinite(Date.parse(receipt.remote_verified_at)));
      assert.deepEqual(receipt.sha256, verifyMain(receipt.snapshot, { ...f.identify(f.root), commit: B }).sha256);
    } finally { f.cleanup(); }
  });
  test(`[CBM-WAIT-MAIN] ${mode} does not wait forever for superseded missing A`, async () => {
    const f = fixture();
    try {
      let B;
      const receipt = await prepare(f, { mode, services: { syncSnapshot: expected => {
        if (!B) { B = f.advance(); throw new Error('Remote index publication is pending'); }
        assert.equal(expected.commit, B); return f.snapshot(B);
      } } });
      assert.equal(receipt.commit, B); assert.equal(f.state().head, B);
    } finally { f.cleanup(); }
  });
}

for (const change of ['same-SHA branch', 'tracked', 'untracked', 'staged', 'commit']) {
  test(`[CBM-CONCURRENT-CHECKOUT] download preserves ${change} and never returns ready`, async () => {
    const f = fixture();
    try {
      const B = f.advance(); let changed;
      await assert.rejects(prepare(f, { services: { syncSnapshot: () => {
        if (change === 'same-SHA branch') g(f.root, 'switch', '-qc', 'user-branch');
        else if (change === 'untracked') writeFileSync(path.join(f.root, 'user.txt'), 'keep untracked');
        else { writeFileSync(path.join(f.root, 'source.ts'), 'keep modified'); if (change === 'staged') g(f.root, 'add', 'source.ts'); if (change === 'commit') commit(f.root); }
        changed = f.state(); return f.snapshot(B);
      } } }), /Checkout changed/);
      assert.deepEqual(f.state(), changed); assert.equal(existsSync(path.join(f.root, '.codebase-memory/ready.json')), false);
      if (change === 'untracked') assert.equal(readFileSync(path.join(f.root, 'user.txt'), 'utf8'), 'keep untracked');
    } finally { f.cleanup(); }
  });
}

for (const existing of ['unfinished branch', 'unique main', 'tracked', 'untracked', 'staged']) {
  test(`[CBM-PRESERVE-WORK] existing ${existing} is preserved byte for byte`, async () => {
    const f = fixture();
    try {
      if (existing === 'unfinished branch') g(f.root, 'switch', '-qc', 'unfinished');
      if (existing === 'unfinished branch' || existing === 'unique main') { writeFileSync(path.join(f.root, 'source.ts'), 'unique commit'); commit(f.root); }
      else if (existing === 'untracked') writeFileSync(path.join(f.root, 'user.txt'), 'untracked');
      else { writeFileSync(path.join(f.root, 'source.ts'), 'user edit'); if (existing === 'staged') g(f.root, 'add', 'source.ts'); }
      const before = f.state(); await assert.rejects(prepare(f), /Existing work is preserved/); assert.deepEqual(f.state(), before);
      const resumed = await prepare(f, { mode: 'resume' }); assert.equal(resumed.status, 'working'); assert.deepEqual(f.state(), before);
      if (existing === 'untracked') assert.equal(readFileSync(path.join(f.root, 'user.txt'), 'utf8'), 'untracked');
    } finally { f.cleanup(); }
  });
}

for (const failure of ['pending', 'checksum', 'network', 'timeout']) {
  test(`[CBM-NOT-READY] ${failure} cannot return ready or change checkout`, async () => {
    const f = fixture();
    try {
      f.advance(); const before = f.state();
      await assert.rejects(prepare(f, { waitMs: failure === 'timeout' ? 700 : 0, services: { syncSnapshot: expected => {
        if (failure === 'pending' || failure === 'timeout') throw new Error('Remote index publication is pending');
        if (failure === 'network') throw new Error('network unavailable');
        const snapshot = f.snapshot(expected.commit); writeFileSync(path.join(snapshot, 'graph.db.zst'), 'corrupt'); return snapshot;
      } } }));
      assert.deepEqual(f.state(), before); assert.equal(existsSync(path.join(f.root, '.codebase-memory/ready.json')), false);
    } finally { f.cleanup(); }
  });
}
test('[CBM-TOTAL-BUDGET] repeated main changes do not reset the original deadline', async () => {
  const f = fixture();
  try {
    let calls = 0; const began = Date.now();
    const budget = process.platform === 'win32' ? 22000 : 1700;
    await assert.rejects(prepare(f, { waitMs: budget, services: { syncSnapshot: async (expected, _cache, { deadline } = {}) => {
      calls++;
      const execute = args => {
        assert.ok(Date.now() < deadline, 'Index preparation timed out');
        try { return run('git', args, { cwd: f.writer, timeout: Math.max(1, deadline - Date.now()) }); }
        catch (error) { if (/ETIMEDOUT/.test(error.message)) throw new Error('Index preparation timed out'); throw error; }
      };
      await new Promise(resolve => setTimeout(resolve, Math.min(deadline - Date.now(), process.platform === 'win32' ? 5000 : 350)));
      assert.ok(Date.now() < deadline, 'Index preparation timed out');
      writeFileSync(path.join(f.writer, 'source.ts'), `advance ${calls}`); execute(['add', '.']); execute(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture']); execute(['push', '-q', 'origin', 'main']); return f.snapshot(expected.commit);
    } } }), /timed out/);
    assert.ok(calls >= 2, 'The deadline must survive multiple target changes'); assert.ok(Date.now() - began < budget + 4000); assert.equal(f.state().head, f.A); assert.equal(existsSync(path.join(f.root, '.codebase-memory/ready.json')), false);
  } finally { f.cleanup(); }
});
test('[CBM-COMMON-MUTEX] linked worktrees share a lock while one client is downloading', async () => {
  const f = fixture(); let release, first;
  try {
    const linked = path.join(f.dir, 'linked'); g(f.root, 'worktree', 'add', '-q', '-b', 'other-client', linked, f.A);
    const before = f.state(linked); let entered;
    const downloading = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    first = prepare(f, { services: { syncSnapshot: async expected => { entered(); await held; return f.snapshot(expected.commit); } } });
    await downloading;
    assert.equal(path.resolve(linked, g(linked, 'rev-parse', '--git-common-dir')), path.join(f.root, '.git'));
    assert.equal(existsSync(path.join(f.root, '.git/codebase-memory-task.lock/owner.json')), true);
    await assert.rejects(prepareMain(linked, { waitMs: 5000, services: f.services }), /timed out/);
    assert.deepEqual(f.state(linked), before); assert.equal(f.state().head, f.A);
    release(); assert.equal((await first).status, 'ready');
    assert.equal(existsSync(path.join(f.root, '.git/codebase-memory-task.lock')), false);
  } finally { release?.(); await first?.catch(() => {}); f.cleanup(); }
});

test('[CBM-FINAL-REMOTE] main advancing during activation is rechecked before ready', async () => {
  const f = fixture();
  try {
    let B; const receipt = await prepare(f, { services: { activate: repo => { const value = f.services.activate(repo); if (!B) B = f.advance(); return value; } } });
    assert.equal(receipt.commit, B); assert.equal(f.state().head, B);
  } finally { f.cleanup(); }
});

function native(f, mutate) {
  return (command, args, options) => {
    if (command === 'git') return run(command, args, options);
    if (args[0] === '--version') return '0.11.0';
    const root = options.cwd, sha = g(root, 'rev-parse', 'HEAD');
    if (args.includes('index_repository')) {
      const name = args[args.indexOf('--name') + 1];
      mutate?.(root); const out = f.snapshot(sha, path.join(root, '.codebase-memory'), g(root, 'status', '--porcelain') ? 'dirty' : 'git-clean-head');
      const metadata = JSON.parse(readFileSync(path.join(out, 'artifact.json'))); metadata.project = name;
      writeFileSync(path.join(out, 'artifact.json'), JSON.stringify(metadata));
      return JSON.stringify({ structuredContent: { status: 'indexed', project: name } });
    }
    const project = args[args.indexOf('--project') + 1];
    return JSON.stringify({ structuredContent: { status: 'ready', nodes: 2, edges: 1, project, root_path: root } });
  };
}
test('[CBM-FIXED-SOURCE] builds use a separate fixed clean checkout', () => {
  const f = fixture();
  try {
    const output = path.join(f.dir, 'build'); let indexedRoot;
    const execute = native(f, root => { indexedRoot = root; assert.notEqual(path.resolve(root), path.resolve(f.root)); assert.equal(readFileSync(path.join(root, 'source.ts'), 'utf8'), f.state().source); });
    globalThis.__cbmReview = { execute };
    buildMain(f.identify(f.root), output, { execute, binary: 'fixture-native' });
    assert.equal(verifyMain(output, f.identify(f.root)).source.clean, true); assert.equal(existsSync(indexedRoot), false);
  } finally { f.cleanup(); }
});
for (const contaminated of ['original', 'isolated']) {
  test(`[CBM-DIRTY-BUILD] uncommitted edits in ${contaminated} source cannot produce a publishable manifest`, () => {
    const f = fixture();
    try {
      const output = path.join(f.dir, 'build');
      const execute = native(f, root => writeFileSync(path.join(contaminated === 'original' ? f.root : root, 'source.ts'), 'not committed'));
      globalThis.__cbmReview = { execute };
      assert.throws(() => buildMain(f.identify(f.root), output, { execute, binary: 'fixture-native' }), /changed|source|clean/);
      assert.equal(existsSync(path.join(output, 'manifest.json')), false);
      if (contaminated === 'original') assert.equal(readFileSync(path.join(f.root, 'source.ts'), 'utf8'), 'not committed');
    } finally { f.cleanup(); }
  });
}
test('[CBM-NATIVE-BASIS] verify rejects a dirty native source marker even with matching checksums', () => {
  const f = fixture();
  try { assert.throws(() => verifyMain(f.snapshot(f.A, undefined, 'dirty'), f.identify(f.root)), /verification/); }
  finally { f.cleanup(); }
});

function readApi(f, snapshot) {
  const blobs = Object.fromEntries(assets.map(name => { const bytes = readFileSync(path.join(snapshot, name)); const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); return [sha, bytes]; }));
  return endpoint => {
    if (endpoint.includes('/git/ref/')) return { object: { sha: 'f'.repeat(40) } };
    if (endpoint.includes('/contents/')) return assets.map(name => { const bytes = readFileSync(path.join(snapshot, name)); return { name, type: 'file', sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') }; });
    const sha = endpoint.split('/').at(-1); return { encoding: 'base64', sha, content: blobs[sha].toString('base64') };
  };
}
for (const winner of ['valid', 'damaged', 'wrong identity']) {
  test(`[CBM-CACHE-RACE] actual ENOTEMPTY install competition accepts only ${winner} winner`, () => {
    const f = fixture();
    try {
      const snapshot = f.snapshot(f.A), request = readApi(f, snapshot), cache = path.join(f.dir, 'cache');
      const install = (staging, target) => {
        cpSync(staging, target, { recursive: true });
        if (winner === 'damaged') writeFileSync(path.join(target, 'graph.db.zst'), 'damaged');
        if (winner === 'wrong identity') { const file = path.join(target, 'manifest.json'); const value = JSON.parse(readFileSync(file)); value.repository = 'wrong/repo'; writeFileSync(file, JSON.stringify(value)); }
        renameSync(staging, target); // Real directory collision, not a synthetic success.
      };
      globalThis.__cbmReview = { request, install };
      if (winner === 'valid') { const result = syncMain(f.identify(f.root), cache, { request, install }); assert.equal(verifyMain(result, f.identify(f.root)).commit, f.A); }
      else assert.throws(() => syncMain(f.identify(f.root), cache, { request, install }), /verification|ENOENT/);
    } finally { f.cleanup(); }
  });
}

test('[CBM-CACHE-RETRY] transient permission failure without a winner retries a bounded private install', () => {
  const f = fixture();
  try {
    const snapshot = f.snapshot(f.A), request = readApi(f, snapshot), cache = path.join(f.dir, 'cache'); let attempts = 0;
    const install = (staging, target) => {
      assert.equal(existsSync(target), false);
      if (++attempts < 3) throw Object.assign(new Error('Transient Windows sharing violation'), { code: 'EPERM' });
      renameSync(staging, target);
    };
    globalThis.__cbmReview = { request, install };
    const result = syncMain(f.identify(f.root), cache, { request, install });
    assert.equal(attempts, 3); assert.equal(verifyMain(result, f.identify(f.root)).commit, f.A);
    assert.throws(() => syncMain({ ...f.identify(f.root), commit: f.A }, path.join(f.dir, 'never-cache'), { request, install: () => { throw Object.assign(new Error('Permanent denial'), { code: 'EACCES' }); } }), /Permanent denial/);
  } finally { f.cleanup(); }
});

test('[CBM-SHA-QUEUE] late old CI cannot evict a different main SHA publisher', () => {
  const workflow = readFileSync(process.env.CBM_REVIEW_WORKFLOW ?? new URL('../.github/workflows/codebase-memory-main.yml', import.meta.url), 'utf8');
  assert.match(workflow, /group:.*github\.event\.workflow_run\.head_sha.*github\.sha/);
  const pending = new Map(), running = new Set();
  const submit = sha => { const key = `publish-${sha}`; if (running.has(key)) pending.set(key, sha); else running.add(key); };
  submit('running'); submit('B'); submit('A'); assert.equal(running.has('publish-B'), true); assert.equal(running.has('publish-A'), true);
});

function worker(f, configuration, suffix) {
  const file = path.join(f.dir, `worker-${suffix}.json`); writeFileSync(file, JSON.stringify(configuration));
  const child = spawn(process.execPath, [path.resolve('scripts/codebase-memory-git-api.fixture.mjs'), 'worker', file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', value => output += value); child.stderr.on('data', value => error += value);
  return new Promise(resolve => { child.on('error', value => resolve({ code: 1, error: value.message })); child.on('close', code => resolve({ code, output, error })); });
}
async function release(barrier, count) {
  const began = Date.now();
  while (!existsSync(barrier) || readdirSync(barrier).filter(name => /^\d+$/.test(name)).length < count) {
    assert.ok(Date.now() - began < 30000, 'All independent processes must reach the actual collision');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  writeFileSync(path.join(barrier, 'release'), 'go');
}
test('[CBM-PUBLISH-RACE] out-of-order A/B/C publishers preserve every SHA, retry Git ref conflicts and are idempotent', async () => {
  const f = fixture();
  try {
    const A = f.A, B = f.advance(); writeFileSync(path.join(f.writer, 'source.ts'), 'C'); const C = commit(f.writer); g(f.writer, 'push', '-q', 'origin', 'main');
    const barrier = path.join(f.dir, 'publish-barrier'), cache = path.join(f.dir, 'publication-cache');
    const options = sha => ({ action: 'publish', remote: f.remote, barrier, cache, repo: { ...f.identify(f.writer), commit: sha }, snapshot: f.snapshot(sha) });
    // New B and C publishers are already queued/running when old A CI arrives.
    const pending = [worker(f, options(B), 'B'), worker(f, options(C), 'C'), worker(f, options(A), 'late-A')];
    await release(barrier, 3); const result = await Promise.all(pending); assert.deepEqual(result.map(value => value.code), [0, 0, 0], JSON.stringify(result));
    const request = gitApi(f.remote);
    for (const sha of [A, B, C]) assert.equal(verifyMain(syncMain({ ...f.identify(f.writer), commit: sha }, cache, { request, checkRemote: true }), { slug: 'example/fixture', commit: sha }).commit, sha);
    const head = g(f.remote, 'rev-parse', 'codebase-memory-index');
    const existing = publishMain({ ...f.identify(f.writer), commit: B }, f.snapshot(B), { request, cache, checkCI: () => true });
    assert.equal(verifyMain(existing, { slug: 'example/fixture', commit: B }).commit, B); assert.equal(g(f.remote, 'rev-parse', 'codebase-memory-index'), head);
    assert.equal(g(f.remote, 'rev-parse', 'main'), C);
  } finally { f.cleanup(); }
});
test('[CBM-CI-ORDER] exact old/main CI success is independent of completion order and failed CI is blocked', () => {
  const f = fixture();
  try {
    const B = f.advance(), request = gitApi(f.remote);
    globalThis.__cbmReview = { request };
    assert.equal(verifyMainCI({ ...f.identify(f.writer), commit: B }, { request }), 10);
    assert.equal(verifyMainCI({ ...f.identify(f.writer), commit: f.A }, { request }), 10);
    const failed = endpoint => endpoint.includes('/actions/workflows/') ? { workflow_runs: [{ id: 11, head_sha: B, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'failure' }] } : request(endpoint);
    globalThis.__cbmReview = { request: failed };
    assert.throws(() => verifyMainCI({ ...f.identify(f.writer), commit: B }, { request: failed }), /not passed/);
  } finally { f.cleanup(); }
});
for (const damaged of [false, true]) {
  test(`[CBM-PARALLEL-CACHE] two independent checkouts reuse only a complete ${damaged ? 'damaged' : 'valid'} winning cache`, async () => {
    const f = fixture();
    try {
      const request = gitApi(f.remote), snapshot = f.snapshot(f.A);
      globalThis.__cbmReview = { request };
      publishMain(f.identify(f.writer), snapshot, { request, cache: path.join(f.dir, 'seed-cache'), checkCI: () => true });
      const second = path.join(f.dir, 'independent-checkout'); g(f.dir, 'clone', '-q', f.remote, second);
      const barrier = path.join(f.dir, 'cache-barrier'), cache = path.join(f.dir, 'shared-cache');
      const config = root => ({ action: 'sync', remote: f.remote, barrier, cache, damageWinner: damaged, repo: f.identify(root) });
      const pending = [worker(f, config(f.root), 'one'), worker(f, config(second), 'two')];
      await release(barrier, 2); const result = await Promise.all(pending);
      if (damaged) { assert.deepEqual(result.map(value => value.code), [1, 1]); assert.ok(result.every(value => /verification/.test(value.error))); }
      else { assert.deepEqual(result.map(value => value.code), [0, 0], JSON.stringify(result)); assert.equal(JSON.parse(result[0].output).result, JSON.parse(result[1].output).result); }
      assert.equal(g(f.root, 'rev-parse', 'HEAD'), f.A); assert.equal(g(second, 'rev-parse', 'HEAD'), f.A);
    } finally { f.cleanup(); }
  });
}
