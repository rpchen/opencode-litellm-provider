import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Validate only release metadata; never resolve core/main or create a tag. */
export function validateReleaseVersion({ refType, refName, packageVersion, lockVersion, rootVersion }) {
  if (refType !== 'tag') throw new Error('Release requires an existing version tag, not a branch.');
  if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
    throw new Error('Package version is missing.');
  }
  if (refName !== `v${packageVersion}`) throw new Error('Tag does not match package version.');
  if (lockVersion !== packageVersion || rootVersion !== packageVersion) {
    throw new Error('Lockfile root versions do not match package version.');
  }
  return refName;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const tag = validateReleaseVersion({
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    packageVersion: manifest.version,
    lockVersion: lock.version,
    rootVersion: lock.packages?.['']?.version,
  });
  console.log(`Release metadata verified: ${tag}`);
}
