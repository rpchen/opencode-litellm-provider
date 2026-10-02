// Replay the same real-Git regressions against a reviewed historical commit.
// Adapt ONLY external I/O (repository metadata, native index and index service)
// to the fixture hooks. The old Git, waiting, verification and rename logic is
// preserved, and no test assertions are changed.
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { run } from './codebase-memory.mjs';
const revision = process.argv[2] ?? 'HEAD';
const base = path.resolve('.tmp'); mkdirSync(base, { recursive: true });
const output = mkdtempSync(path.join(base, 'cbm-old-review-'));
let code = run('git', ['show', `${revision}:scripts/codebase-memory-main.mjs`]);
const begin = code.indexOf('function api('), end = code.indexOf('\nfunction missing', begin);
if (begin < 0 || end < 0 || !code.includes('let snapshot;')) throw new Error('Expected the pre-review implementation');
code = code.slice(0, begin) + 'function api(endpoint, data) { return globalThis.__cbmReview.request(endpoint, data); }' + code.slice(end);
code = code.replace(/repository\((cwd|original\.root)\)/g, 'globalThis.__cbmReview.repository($1)')
  .replace(/refresh\((original|repo)\)/g, 'globalThis.__cbmReview.activate($1)')
  .replace('receipt.releaseSnapshot = syncRelease(', 'receipt.releaseSnapshot = globalThis.__cbmReview.syncRelease(')
  .replace('snapshot = syncMain(expected,', 'snapshot = globalThis.__cbmReview.syncSnapshot(expected,')
  .replaceAll('run(binary,', 'globalThis.__cbmReview.execute(binary,')
  .replace('renameSync(staging, target);', '(globalThis.__cbmReview.install ?? renameSync)(staging, target);');
code = code.replace(/if \(parent\) run\('gh',[^\n]+/, "if (parent) api(`repos/${repo.slug}/git/refs/heads/${INDEX_BRANCH}`, { sha: commit.sha, force: false });");
writeFileSync(path.join(output, 'codebase-memory-main.mjs'), code);
copyFileSync('scripts/codebase-memory.mjs', path.join(output, 'codebase-memory.mjs'));
writeFileSync(path.join(output, 'codebase-memory-main.yml'), run('git', ['show', `${revision}:.github/workflows/codebase-memory-main.yml`]));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-name-pattern=CBM-RETARGET|CBM-CONCURRENT-CHECKOUT.*same-SHA|CBM-WAIT-MAIN|CBM-DIRTY-BUILD|CBM-NATIVE-BASIS|CBM-PARALLEL-CACHE|CBM-SHA-QUEUE|CBM-QUEUED-LOCK', 'scripts/codebase-memory-main.test.mjs'],
  { encoding: 'utf8', env: { ...process.env, CBM_REVIEW_BASELINE: path.join(output, 'codebase-memory-main.mjs'), CBM_REVIEW_WORKFLOW: path.join(output, 'codebase-memory-main.yml') }, windowsHide: true, timeout: 600000 });
const log = (result.stdout ?? '') + (result.stderr ?? ''); writeFileSync(path.join(output, 'result.log'), log);
console.log(log); console.log(`Historical control: ${revision}; evidence: ${output}`);
if (result.status !== 1 || !/fail [1-9]/.test(log) || !/CBM-RETARGET/.test(log) || !/CBM-DIRTY-BUILD/.test(log)) throw new Error('Historical defects were not reproduced');
