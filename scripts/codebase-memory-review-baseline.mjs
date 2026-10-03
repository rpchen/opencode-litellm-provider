// Replay the same real-Git regressions against reviewed historical commits.
// Adapt ONLY external I/O (repository metadata, native index and index service)
// to the fixture hooks. The old Git, waiting, verification and rename logic is
// preserved, and no test assertions are changed.
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { run } from './codebase-memory.mjs';
const revision = process.argv[2] ?? 'HEAD';
// The stale pre-lock snapshot defect was introduced after the original review
// baseline and removed by a later fix, and the commit that carries it differs
// per repository. The queued phase therefore needs an explicit revision:
// without it only the audit-baseline replay runs, and the queued controls are
// reported as skipped instead of silently passing against the wrong history.
const queuedRevision = process.argv[3];
const base = path.resolve('.tmp'); mkdirSync(base, { recursive: true });
const output = mkdtempSync(path.join(base, 'cbm-old-review-'));

// Replace exactly the api() function signature and body. Slicing up to a later
// function would also delete helpers (for example remaining()) that the old
// state machine calls, which previously masked the intended old defects with a
// ReferenceError instead of a real assertion failure.
function skipQuoted(code, index) {
  const quote = code[index];
  for (index++; index < code.length; index++) {
    if (code[index] === '\\') index++;
    else if (code[index] === quote) return index;
  }
  return index - 1;
}
function matchDelimiter(code, open, opener, closer) {
  let depth = 0;
  for (let index = open; index < code.length; index++) {
    const character = code[index];
    if (character === '"' || character === "'" || character === '`') { index = skipQuoted(code, index); continue; }
    if (character === opener) depth++;
    else if (character === closer && --depth === 0) return index;
  }
  return -1;
}
function replaceApi(code, name) {
  const match = /^function api\(/m.exec(code);
  if (!match) throw new Error(`Expected api() in the reviewed implementation at ${name}`);
  // The parameter list may itself contain an object pattern; the body brace is
  // the first '{' after the parameter list closes.
  const parameters = match.index + match[0].length - 1;
  const parametersEnd = matchDelimiter(code, parameters, '(', ')');
  if (parametersEnd < 0) throw new Error(`Cannot bound the api() parameter list at ${name}`);
  const open = code.indexOf('{', parametersEnd);
  if (open < 0) throw new Error(`Cannot bound the api() body at ${name}`);
  const end = matchDelimiter(code, open, '{', '}');
  if (end < 0) throw new Error(`Cannot bound the api() body at ${name}`);
  // Keep each revision's own parameter list and defaults exactly; only the
  // transport is replaced by the fixture hook. The forwarding options follow
  // the parameter names that revision actually declares.
  const signature = code.slice(match.index, parametersEnd + 1);
  const forwarded = ['method', 'deadline'].filter(name => new RegExp(`\\b${name}\\b`).test(signature));
  const options = forwarded.length ? `, { ${forwarded.join(', ')} }` : '';
  const body = ` { return globalThis.__cbmReview.request(endpoint, data${options}); }`;
  return code.slice(0, match.index) + signature + body + code.slice(end + 1);
}
function adapt(name) {
  let code = run('git', ['show', `${name}:scripts/codebase-memory-main.mjs`]);
  if (!code.includes('let snapshot;')) throw new Error(`Expected the reviewed implementation at ${name}`);
  code = replaceApi(code, name);
  code = code.replace(/repository\((cwd|original\.root)\)/g, 'globalThis.__cbmReview.repository($1)')
    .replace(/refresh\((original|repo)\)/g, 'globalThis.__cbmReview.activate($1)')
    .replace('receipt.releaseSnapshot = syncRelease(', 'receipt.releaseSnapshot = globalThis.__cbmReview.syncRelease(')
    .replace('snapshot = syncMain(expected,', 'snapshot = globalThis.__cbmReview.syncSnapshot(expected,')
    .replaceAll('run(binary,', 'globalThis.__cbmReview.execute(binary,')
    .replace('renameSync(staging, target);', '(globalThis.__cbmReview.install ?? renameSync)(staging, target);');
  code = code.replace(/if \(parent\) run\('gh',[^\n]+/, "if (parent) api(`repos/${repo.slug}/git/refs/heads/${INDEX_BRANCH}`, { sha: commit.sha, force: false });");
  return code;
}
function replay(label, name, pattern, expect) {
  const directory = path.join(output, label); mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'codebase-memory-main.mjs'), adapt(name));
  copyFileSync('scripts/codebase-memory.mjs', path.join(directory, 'codebase-memory.mjs'));
  copyFileSync('scripts/codebase-memory-git-api.fixture.mjs', path.join(directory, 'codebase-memory-git-api.fixture.mjs'));
  writeFileSync(path.join(directory, 'codebase-memory-main.yml'), run('git', ['show', `${name}:.github/workflows/codebase-memory-main.yml`]));
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', `--test-name-pattern=${pattern}`, 'scripts/codebase-memory-main.test.mjs'],
    { encoding: 'utf8', env: { ...process.env, CBM_REVIEW_BASELINE: path.join(directory, 'codebase-memory-main.mjs'), CBM_REVIEW_WORKFLOW: path.join(directory, 'codebase-memory-main.yml') }, windowsHide: true, timeout: 600000 });
  const log = (result.stdout ?? '') + (result.stderr ?? ''); writeFileSync(path.join(directory, 'result.log'), log);
  console.log(log); console.log(`Historical control: ${name} (${label}); evidence: ${directory}`);
  if (result.status !== 1 || !/fail [1-9]/.test(log)) throw new Error(`Historical defects were not reproduced at ${name}`);
  for (const expected of expect) if (!log.includes(expected)) throw new Error(`Expected ${expected} to fail against ${name}`);
}
replay('review', revision, 'CBM-RETARGET|CBM-CONCURRENT-CHECKOUT.*same-SHA|CBM-WAIT-MAIN|CBM-DIRTY-BUILD|CBM-NATIVE-BASIS|CBM-PARALLEL-CACHE|CBM-SHA-QUEUE', ['CBM-RETARGET', 'CBM-DIRTY-BUILD']);
if (queuedRevision) replay('queued', queuedRevision, 'CBM-QUEUED-LOCK|CBM-QUEUED-USER-CHANGE', ['CBM-QUEUED-LOCK', 'CBM-QUEUED-USER-CHANGE']);
else console.log('Queued replay skipped: pass the commit that carries the stale pre-lock snapshot as the second argument.');
