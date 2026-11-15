// Wait until the self-built MinIO image tag from docker/minio/Dockerfile can be
// pulled anonymously, so CI jobs that use it do not race minio-image.yml.
//
// A push that bumps the image starts ci.yml and minio-image.yml together; the
// image build takes minutes, and without this the integration / E2E jobs fail
// with "not found" on the new tag. When the tag already exists (every push that
// does not touch docker/minio/) this returns after one check.
//
// Usage: node scripts/wait-for-minio-image.mjs [--timeout-min 30] [--interval-s 20]
// Exit 0 once the manifest resolves, 1 on timeout. Needs the docker CLI.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedTag } from './check-minio-image-tag.mjs';

const opt = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const timeoutMs = opt('--timeout-min', 30) * 60_000;
const intervalMs = opt('--interval-s', 20) * 1000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tag = expectedTag(readFileSync(join(root, 'docker', 'minio', 'Dockerfile'), 'utf8'));
if (!tag) {
  console.error('MINIO_RELEASE / IMAGE_REVISION not found in docker/minio/Dockerfile');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + timeoutMs;
for (let attempt = 1; ; attempt++) {
  try {
    execFileSync('docker', ['manifest', 'inspect', tag], { stdio: 'pipe' });
    console.log(`${tag} is available`);
    process.exit(0);
  } catch (e) {
    const reason = `${e.stderr || e.message}`.trim().split('\n')[0];
    if (Date.now() + intervalMs > deadline) {
      console.error(
        `::error::${tag} still not pullable after ${timeoutMs / 60_000} min (${reason}). ` +
          'Check the "MinIO image" workflow run for this commit.'
      );
      process.exit(1);
    }
    console.log(`[${attempt}] ${tag} not available yet (${reason}); waiting for minio-image.yml`);
    await sleep(intervalMs);
  }
}
