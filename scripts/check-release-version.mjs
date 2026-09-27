import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateReleaseVersion } from './release-version.mjs';

const valid = {
  refType: 'tag', refName: 'v0.2.0',
  packageVersion: '0.2.0', lockVersion: '0.2.0', rootVersion: '0.2.0',
};

test('release accepts an existing tag with all three package versions aligned', () => {
  assert.equal(validateReleaseVersion(valid), 'v0.2.0');
});
test('manual dispatch on main is rejected', () => {
  assert.throws(() => validateReleaseVersion({ ...valid, refType: 'branch', refName: 'main' }), /existing version tag/);
});
test('a branch named like a version tag is still rejected', () => {
  assert.throws(() => validateReleaseVersion({ ...valid, refType: 'branch' }), /existing version tag/);
});
test('missing ref type is rejected', () => {
  assert.throws(() => validateReleaseVersion({ ...valid, refType: undefined }), /existing version tag/);
});
test('tag and manifest mismatch is rejected', () => {
  assert.throws(() => validateReleaseVersion({ ...valid, refName: 'v0.1.4' }), /Tag does not match/);
});
test('stale top-level lockfile version is rejected', () => {
  assert.throws(() => validateReleaseVersion({ ...valid, lockVersion: '0.1.2' }), /Lockfile root versions/);
});
test('stale root package lockfile version is rejected', () => {
  assert.throws(() => validateReleaseVersion({ ...valid, rootVersion: '0.1.3' }), /Lockfile root versions/);
});
test('missing root package version is rejected', () => {
  assert.throws(() => validateReleaseVersion({ ...valid, rootVersion: undefined }), /Lockfile root versions/);
});
test('missing or empty manifest version is rejected', () => {
  for (const packageVersion of [undefined, '']) {
    assert.throws(() => validateReleaseVersion({ ...valid, packageVersion }), /Package version is missing/);
  }
});
