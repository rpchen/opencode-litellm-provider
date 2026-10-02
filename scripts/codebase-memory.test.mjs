import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ASSETS, build, repository, sync, verify } from './codebase-memory.mjs';

const commit = 'a'.repeat(40), slug = 'example/indexed-repo', tag = 'v1.2.3', project = 'indexed-repo';
const base = path.resolve('.tmp/codebase-memory-tests');
mkdirSync(base, { recursive: true });
function fixture() {
  const dir = mkdtempSync(path.join(base, 'case-'));
  const root = path.join(dir, 'repo'), output = path.join(dir, 'assets');
  mkdirSync(path.join(root, '.codebase-memory'), { recursive: true });
  const graph = Buffer.concat([Buffer.from('28b52ffd', 'hex'), Buffer.from('example graph')]);
  const metadata = { schema_version: 2, project, commit, nodes: 2, edges: 1, compressed_size: graph.length };
  function exportGraph() { writeFileSync(path.join(root, '.codebase-memory/graph.db.zst'), graph); writeFileSync(path.join(root, '.codebase-memory/artifact.json'), JSON.stringify(metadata)); }
  exportGraph();
  const repo = { root, slug, commit, project };
  const calls = [];
  function execute(command, args) {
    calls.push([command, args]);
    if (command === 'git') {
      if (args[0] === 'status') return '';
      if (args.includes('--show-toplevel')) return root;
      if (args[0] === 'remote') return `https://github.com/${slug}.git`;
      return commit;
    }
    if (args[0] === '--version') return 'codebase-memory-mcp 0.11.0';
    if (args.includes('index_repository')) { exportGraph(); return JSON.stringify({ structuredContent: { status: 'indexed', project }, isError: false }); }
    if (args.includes('index_status')) return '{"structuredContent":{"status":"ready","nodes":2},"isError":false}';
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  }
  return { dir, root, output, repo, calls, execute, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
test('[CBM-OPT-IN] nearest unindexed repository never triggers indexing', () => {
  const f = fixture();
  try {
    const child = path.join(f.root, 'new-repo'); mkdirSync(child);
    assert.throws(() => repository(child, () => child), /explicit indexing/);
    assert.equal(f.calls.length, 0);
    assert.equal(repository(f.root, f.execute).slug, slug);
  } finally { f.cleanup(); }
});
test('[CBM-RELEASE] clean immutable tag builds and verifies snapshot end to end', () => {
  const f = fixture();
  try {
    build(f.repo, tag, f.output, { execute: f.execute, binary: 'cbm-test' });
    assert.equal(verify(f.output, { ...f.repo, tag }).commit, commit);
    assert.ok(f.calls.some(([, args]) => args.includes('full') && args.includes('true')));
    assert.deepEqual(ASSETS.filter(name => existsSync(path.join(f.output, name))), ASSETS);
  } finally { f.cleanup(); }
});
test('[CBM-FAIL-CLOSED] dirty source, wrong tag, wrong runtime and index errors fail before publication', () => {
  const f = fixture();
  try {
    for (const [needle, response] of [['status', ' M src/example.ts'], ['rev-parse', 'b'.repeat(40)], ['--version', '0.10.0'], ['index_repository', '{"isError":true}'], ['index_status', '{"structuredContent":{"status":"indexing","nodes":2}}']]) {
      const execute = (command, args) => args.includes(needle) ? response : f.execute(command, args);
      assert.throws(() => build(f.repo, tag, f.output, { execute, binary: 'cbm-test' }));
      assert.equal(existsSync(path.join(f.output, ASSETS[2])), false);
    }
  } finally { f.cleanup(); }
});
test('[CBM-INTEGRITY] corrupted graph, identity and schema are rejected', () => {
  const f = fixture();
  try {
    build(f.repo, tag, f.output, { execute: f.execute, binary: 'cbm-test' });
    for (const change of [{ commit: 'b'.repeat(40) }, { slug: 'other/repo' }, { tag: 'v9.0.0' }]) assert.throws(() => verify(f.output, { ...f.repo, tag, ...change }), /verification failed/);
    const releasePath = path.join(f.output, ASSETS[2]);
    const releaseBytes = readFileSync(releasePath);
    const release = JSON.parse(releaseBytes); release.project = 'wrong'; writeFileSync(releasePath, JSON.stringify(release));
    assert.throws(() => verify(f.output, { ...f.repo, tag }), /verification failed/);
    writeFileSync(releasePath, releaseBytes);
    const original = readFileSync(path.join(f.output, ASSETS[0]));
    writeFileSync(path.join(f.output, ASSETS[0]), Buffer.from(original).fill(0, 4, 5));
    assert.throws(() => verify(f.output, { ...f.repo, tag }), /verification failed/);
    writeFileSync(path.join(f.output, ASSETS[0]), original);
    const artifact = JSON.parse(readFileSync(path.join(f.output, ASSETS[1]), 'utf8'));
    artifact.schema_version = 1; writeFileSync(path.join(f.output, ASSETS[1]), JSON.stringify(artifact));
    assert.throws(() => verify(f.output, { ...f.repo, tag }), /verification failed/);
  } finally { f.cleanup(); }
});

test('[CBM-DEGRADED] degraded, unknown and missing native status cannot publish a manifest', () => {
  const f = fixture();
  try {
    for (const status of ['degraded', 'error', 'aborted_previous_preserved', 'persist_failed', 'cancelled', 'unknown', undefined]) {
      for (const format of ['structuredContent', 'content']) {
        const data = { status, project, nodes: 2, expected_nodes: 200 };
        const response = format === 'structuredContent' ? { structuredContent: data, isError: false } : { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false };
        const execute = (command, args) => args.includes('index_repository') ? JSON.stringify(response) : f.execute(command, args);
        assert.throws(() => build(f.repo, tag, f.output, { execute, binary: 'cbm-test' }), /Index/);
        assert.equal(existsSync(path.join(f.output, ASSETS[2])), false);
      }
    }
  } finally { f.cleanup(); }
});
test('[CBM-SYNC] release download validates tag SHA, retains checkout, and supports repeated startup', () => {
  const f = fixture();
  try {
    build(f.repo, tag, f.output, { execute: f.execute, binary: 'cbm-test' });
    const original = readFileSync(path.join(f.root, '.codebase-memory/artifact.json'));
    let downloads = 0;
    const execute = (_command, args) => {
      if (args[0] === 'api') return commit;
      if (args[1] === 'view') return JSON.stringify({ tagName: tag, assets: ASSETS.map(name => ({ name })) });
      if (args[1] === 'download') { downloads++; const dir = args[args.indexOf('--dir') + 1]; for (const name of ASSETS) copyFileSync(path.join(f.output, name), path.join(dir, name)); return ''; }
      throw new Error('unexpected remote request');
    };
    const cache = path.join(f.dir, 'cache');
    const expected = sync({ ...f.repo, commit: 'c'.repeat(40) }, cache, { execute });
    assert.equal(verify(expected, { ...f.repo, tag }).commit, commit);
    assert.equal(sync(f.repo, cache, { execute }), expected);
    assert.equal(downloads, 1);
    writeFileSync(path.join(expected, ASSETS[0]), 'damaged cache');
    assert.equal(sync(f.repo, cache, { execute }), expected);
    assert.equal(downloads, 2);
    assert.equal(verify(expected, { ...f.repo, tag }).commit, commit);
    assert.deepEqual(readFileSync(path.join(f.root, '.codebase-memory/artifact.json')), original);
    assert.throws(() => sync(f.repo, cache, { execute: () => { throw new Error('offline'); } }), /offline/);
    assert.throws(() => sync(f.repo, cache, { execute: () => JSON.stringify({ tagName: tag, assets: [] }) }), /complete/);
    assert.throws(() => sync(f.repo, cache, { execute: (_c, args) => args[0] === 'api' ? '../escape' : execute(_c, args) }), /Invalid released commit/);
  } finally { f.cleanup(); }
});
