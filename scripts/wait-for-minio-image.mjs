// Wait until the self-built MinIO image tag from docker/minio/Dockerfile can be
// pulled anonymously, so CI jobs that use it do not race minio-image.yml.
//
// A push that bumps the image starts ci.yml and minio-image.yml together; the
// image build takes minutes. ci.yml runs this in its own `minio-image-ready`
// job, which the integration and Admin E2E jobs depend on, so the wait does
// not eat their timeouts. When the tag already exists (every push that does
// not touch docker/minio/) it returns after one check.
//
// Only "not found yet" is retried. Permanent errors fail at once: a private
// package (unauthorized/denied), a missing docker CLI, or a malformed tag.
//
// Usage: node scripts/wait-for-minio-image.mjs [--timeout-min 35] [--interval-s 20]
// Exit 0 once the manifest resolves, 1 on timeout or a permanent error.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedTag } from './check-minio-image-tag.mjs';

function opt(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) {
    return fallback;
  }
  const value = Number(process.argv[i + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} needs a positive number, got '${process.argv[i + 1] ?? ''}'`);
    process.exit(1);
  }
  return value;
}
const timeoutMs = opt('--timeout-min', 35) * 60_000;
const intervalMs = opt('--interval-s', 20) * 1000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tag = expectedTag(readFileSync(join(root, 'docker', 'minio', 'Dockerfile'), 'utf8'));
if (!tag) {
  console.error('MINIO_RELEASE / IMAGE_REVISION not found in docker/minio/Dockerfile');
  process.exit(1);
}

const NOT_YET = /manifest unknown|not found|no such manifest/i;
const PERMANENT = /unauthorized|denied|forbidden|invalid reference format/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + timeoutMs;
for (let attempt = 1; ; attempt++) {
  let reason;
  try {
    execFileSync('docker', ['manifest', 'inspect', tag], { stdio: 'pipe' });
    console.log(`${tag} is available`);
    process.exit(0);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error('::error::docker CLI not found on PATH');
      process.exit(1);
    }
    reason = `${e.stderr || e.message}`.trim().split('\n')[0];
  }
  if (PERMANENT.test(reason)) {
    console.error(
      `::error::${tag} cannot be pulled anonymously (${reason}). If the package is private, an org admin must make it public: https://github.com/orgs/apex-bridge/packages/container/package/bugspotter%2Fminio`
    );
    process.exit(1);
  }
  if (Date.now() + intervalMs > deadline) {
    console.error(
      `::error::${tag} still not pullable after ${timeoutMs / 60_000} min (${reason}). ` +
        'Check the "MinIO image" workflow run for this commit.'
    );
    process.exit(1);
  }
  const label = NOT_YET.test(reason) ? 'not published yet' : 'registry error, retrying';
  console.log(`[${attempt}] ${tag} ${label} (${reason}); waiting for minio-image.yml`);
  await sleep(intervalMs);
}
