#!/usr/bin/env node
// Standalone repository tooling; no sibling checkout or runtime package dependency.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync, renameSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const CBM_VERSION = '0.11.0';
export const ASSETS = ['codebase-memory.graph.db.zst', 'codebase-memory.artifact.json', 'codebase-memory.release.json'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function binaryPath() {
  if (process.env.CBM_BINARY) return process.env.CBM_BINARY;
  if (process.platform === 'win32') {
    const candidates = [path.join(os.homedir(), '.local/bin/codebase-memory-mcp.exe'), path.join(process.env.APPDATA ?? '', 'npm/node_modules/codebase-memory-mcp/bin/codebase-memory-mcp.exe')];
    const found = candidates.find(existsSync);
    if (found) return found;
  }
  if (process.platform !== 'win32') {
    try { return run('which', ['codebase-memory-mcp']); } catch { /* CLI will report a missing installation. */ }
  }
  return 'codebase-memory-mcp';
}
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.error?.message ?? result.stderr?.trim() ?? result.status}`);
  return result.stdout.trim();
}
export function repository(cwd = process.cwd(), execute = run) {
  const root = execute('git', ['rev-parse', '--show-toplevel'], { cwd });
  // Stop at the nearest Git root: an unindexed child must not inherit a parent's graph.
  const artifactPath = path.join(root, '.codebase-memory', 'artifact.json');
  const selectionPath = path.join(root, '.codebase-memory', 'selection.json');
  if (!existsSync(artifactPath) && !existsSync(selectionPath)) throw new Error('Repository has no explicit codebase-memory selection; explicit indexing is required');
  const artifact = JSON.parse(readFileSync(existsSync(artifactPath) ? artifactPath : selectionPath, 'utf8'));
  const commit = execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  const origin = execute('git', ['remote', 'get-url', 'origin'], { cwd: root });
  const match = origin.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (!match || !/^[\w.-]+$/.test(artifact.project) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid GitHub repository, project, or commit');
  return { root, project: artifact.project, commit, slug: match[1] };
}
export function toolData(envelope) {
  if (envelope.isError || envelope.error) throw new Error('Index refresh failed');
  const data = envelope.structuredContent ?? JSON.parse(envelope.content?.find(item => item.type === 'text')?.text ?? '{}');
  if (!data || typeof data !== 'object') throw new Error('Index response is invalid');
  return data;
}
function index(repo, persistence, execute, binary) {
  const version = execute(binary, ['--version']);
  if (!version.includes(CBM_VERSION)) throw new Error(`Expected codebase-memory-mcp ${CBM_VERSION}, received ${version}`);
  const indexRoot = realpathSync(repo.root);
  // Working graphs use the native path-derived identity, exactly as MCP sessions do.
  // A portable release marker is not a local database key in a new clone.
  const indexed = JSON.parse(execute(binary, ['cli', '--quiet', '--json', 'index_repository', '--repo-path', indexRoot, ...(persistence ? ['--name', repo.project] : []), '--mode', 'full', '--persistence', String(persistence)], { cwd: indexRoot }));
  const indexedData = toolData(indexed);
  if (indexedData.status !== 'indexed' || !/^[\w.-]+$/.test(indexedData.project ?? '')) throw new Error('Index refresh did not return indexed status');
  const indexedProject = indexedData.project;
  const status = JSON.parse(execute(binary, ['cli', '--quiet', '--json', 'index_status', '--project', indexedProject, '--format', 'json'], { cwd: repo.root }));
  const data = toolData(status);
  if (data.status !== 'ready' || data.nodes <= 0) throw new Error('Index refresh failed');
  return data;
}
export function refresh(repo, { execute = run, binary = binaryPath() } = {}) { return index(repo, false, execute, binary); }
export function verify(directory, expected) {
  const graph = readFileSync(path.join(directory, ASSETS[0]));
  const metadataBytes = readFileSync(path.join(directory, ASSETS[1]));
  const artifact = JSON.parse(metadataBytes);
  const manifest = JSON.parse(readFileSync(path.join(directory, ASSETS[2]), 'utf8'));
  if (manifest.schema_version !== 1 || manifest.cbm_version !== CBM_VERSION || artifact.schema_version !== 2 ||
      !/^[a-f0-9]{40}$/.test(manifest.commit) || artifact.commit !== manifest.commit ||
      manifest.repository !== expected.slug || manifest.commit !== expected.commit || manifest.tag !== expected.tag ||
      !/^[\w.-]+$/.test(artifact.project ?? '') || manifest.project !== artifact.project || artifact.compressed_size !== graph.length || !Number.isInteger(artifact.nodes) || artifact.nodes <= 0 ||
      graph.subarray(0, 4).toString('hex') !== '28b52ffd' ||
      manifest.sha256?.[ASSETS[0]] !== sha256(graph) || manifest.sha256?.[ASSETS[1]] !== sha256(metadataBytes)) {
    throw new Error('Release index identity, SHA-256, or format verification failed');
  }
  return manifest;
}
export function build(repo, tag, destination, { execute = run, binary = binaryPath() } = {}) {
  if (!/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag ?? '')) throw new Error('Build requires a version tag');
  const tagCommit = execute('git', ['rev-parse', `${tag}^{commit}`], { cwd: repo.root });
  if (tagCommit !== repo.commit) throw new Error('Version tag does not match the checked-out commit');
  const dirty = execute('git', ['status', '--porcelain', '--untracked-files=normal', '--', '.', ':!.codebase-memory'], { cwd: repo.root });
  if (dirty) throw new Error('Release index requires a clean source checkout');
  index(repo, true, execute, binary);
  mkdirSync(destination, { recursive: true });
  copyFileSync(path.join(repo.root, '.codebase-memory', 'graph.db.zst'), path.join(destination, ASSETS[0]));
  copyFileSync(path.join(repo.root, '.codebase-memory', 'artifact.json'), path.join(destination, ASSETS[1]));
  const hashes = Object.fromEntries(ASSETS.slice(0, 2).map(name => [name, sha256(readFileSync(path.join(destination, name)))]));
  const exported = JSON.parse(readFileSync(path.join(destination, ASSETS[1]), 'utf8'));
  writeFileSync(path.join(destination, ASSETS[2]), JSON.stringify({ schema_version: 1, repository: repo.slug, tag, commit: repo.commit, project: exported.project, cbm_version: CBM_VERSION, sha256: hashes }, null, 2) + '\n');
  verify(destination, { ...repo, tag });
  return destination;
}
export function sync(repo, destination, { execute = run, tag } = {}) {
  // This never writes the checkout or moves branches/tags. Released snapshots are separate from the working graph.
  const release = JSON.parse(execute('gh', ['release', 'view', ...(tag ? [tag] : []), '--repo', repo.slug, '--json', 'tagName,assets'], { timeout: 10000 }));
  if (!/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(release.tagName)) throw new Error('Release must use a version tag');
  if (!ASSETS.every(name => release.assets.some(asset => asset.name === name))) throw new Error('Release does not contain a complete codebase-memory snapshot');
  const commit = execute('gh', ['api', `repos/${repo.slug}/commits/${encodeURIComponent(release.tagName)}`, '--jq', '.sha'], { timeout: 10000 });
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid released commit');
  const expected = { ...repo, commit, tag: release.tagName };
  const target = path.join(destination, repo.slug, commit);
  if (existsSync(path.join(target, ASSETS[2]))) {
    try { verify(target, expected); return target; }
    catch { renameSync(target, `${target}.invalid-${Date.now()}`); } // Preserve corrupt cache for inspection, then retry download.
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const staging = mkdtempSync(path.join(path.dirname(target), '.download-'));
  try {
    execute('gh', ['release', 'download', release.tagName, '--repo', repo.slug, '--dir', staging, ...ASSETS.flatMap(name => ['--pattern', name])], { timeout: 15000 });
    verify(staging, expected);
    // Multiple clients may start together. A completed, valid concurrent download wins.
    if (existsSync(path.join(target, ASSETS[2]))) { verify(target, expected); return target; }
    try { renameSync(staging, target); }
    catch (error) { if (!existsSync(path.join(target, ASSETS[2]))) throw error; verify(target, expected); }
    return target;
  } finally {
    if (!staging.startsWith(path.dirname(target) + path.sep)) throw new Error('Unsafe download staging path');
    rmSync(staging, { recursive: true, force: true });
  }
}
export async function main(args = process.argv.slice(2)) {
  const [action, value] = args;
  const repo = repository();
  if (action === 'build') console.log(build(repo, value ?? process.env.GITHUB_REF_NAME, path.resolve('.tmp/codebase-memory-release')));
  else if (action === 'verify') { verify(path.resolve(value ?? '.tmp/codebase-memory-release'), { ...repo, tag: process.env.GITHUB_REF_NAME }); console.log('Release index verified'); }
  else if (action === 'refresh') { const data = refresh(repo); console.log(`Working index refreshed: ${data.project ?? repo.project} at ${repo.commit}`); }
  else if (action === 'sync') { console.log(sync(repo, process.env.CBM_RELEASE_CACHE ?? path.join(os.homedir(), '.cache', 'codebase-memory-releases'), { tag: value })); }
  else throw new Error('Usage: node scripts/codebase-memory.mjs build <tag> | verify <directory> | refresh | sync [tag]');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
