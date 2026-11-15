// Tests for check-minio-image-tag.mjs. Zero-dependency: run with `node --test`.
// Wired into .github/workflows/ci.yml next to the check itself.
//
// Image references below are assembled from parts so this file does not count
// as a reference when the check scans the real repository.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, expectedTag } from './check-minio-image-tag.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-minio-image-tag.mjs');
const IMG = ['ghcr.io', 'apex-bridge', 'bugspotter', 'minio'].join('/');
const UPSTREAM = ['minio', 'minio'].join('/');
const REL = 'RELEASE.2024-10-13T13-34-11Z';
const DIRS = [];

after(() => DIRS.forEach((d) => rmSync(d, { recursive: true, force: true })));

const dockerfile = (rev = 3) =>
  `# header mentioning ${IMG}:<MINIO_RELEASE>-r<IMAGE_REVISION>\nARG IMAGE_REVISION=${rev}\nARG MINIO_RELEASE=${REL}\n`;

// Build a fake repo: { 'path/in/repo': 'contents' }.
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'minio-tag-'));
  DIRS.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

test('expectedTag combines MINIO_RELEASE and IMAGE_REVISION', () => {
  assert.equal(expectedTag(dockerfile(7)), `${IMG}:${REL}-r7`);
  assert.equal(expectedTag('ARG MINIO_RELEASE=x\n'), null);
});

test('passes when every reference matches', () => {
  const root = repo({
    'docker/minio/Dockerfile': dockerfile(),
    'docker-compose.yml': `    image: ${IMG}:${REL}-r3\n    image: ${IMG}:${REL}-r3 # same image\n`,
    'tests/a.test.ts': `new GenericContainer('${IMG}:${REL}-r3')\n`,
    'notes.md': 'source is https://github.com/minio/minio/tree/abc\n',
  });
  const r = check(root);
  assert.equal(r.ok, true, r.problems.join('\n'));
  assert.equal(r.refs, 3);
});

test('flags a stale revision with file and line', () => {
  const root = repo({
    'docker/minio/Dockerfile': dockerfile(3),
    'ci.yml': `ok\n  pull_image "${IMG}:${REL}-r2"\n`,
  });
  const r = check(root);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /^ci\.yml:2: .*-r2 \(expected .*-r3\)$/);
});

test('flags upstream minio/minio and minio/mc image references', () => {
  const root = repo({
    'docker/minio/Dockerfile': dockerfile(),
    'compose.yml': `    image: ${UPSTREAM}:${REL}\n    image: ${['minio', 'mc'].join('/')}:RELEASE.2024-10-08T09-37-26Z\n`,
    'hint.ts': `'docker run -p 9000:9000 ${UPSTREAM} server /data'\n`,
    'Dockerfile.x': `FROM ${IMG}:${REL}-r3\n`,
  });
  const r = check(root);
  assert.equal(r.problems.length, 3, r.problems.join('\n'));
  assert.ok(r.problems.every((p) => /no longer pullable/.test(p)));
});

test('ignores node_modules and fails when no reference exists at all', () => {
  const root = repo({
    'docker/minio/Dockerfile': dockerfile(),
    'node_modules/x/compose.yml': `image: ${IMG}:${REL}-r1\n`,
  });
  const r = check(root);
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /no references/);
});

test('CLI exits 0 / 1 and prints the mismatch', () => {
  const good = repo({ 'docker/minio/Dockerfile': dockerfile(), 'a.yml': `${IMG}:${REL}-r3\n` });
  assert.match(
    execFileSync('node', [SCRIPT, '--root', good], { encoding: 'utf8' }),
    /consistent: 1 reference/
  );

  const bad = repo({ 'docker/minio/Dockerfile': dockerfile(), 'a.yml': `${IMG}:${REL}-r1\n` });
  try {
    execFileSync('node', [SCRIPT, '--root', bad], { encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected exit 1');
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(e.stderr, /a\.yml:1/);
  }
});

test('does not flag prose or source URLs that mention upstream names', () => {
  const root = repo({
    'docker/minio/Dockerfile': `# Docker Hub ${UPSTREAM} and ${['minio', 'mc'].join('/')} are gone\n${dockerfile()}`,
    'a.yml': `${IMG}:${REL}-r3\n# built from https://github.com/${UPSTREAM}/tree/abc\n`,
  });
  const r = check(root);
  assert.equal(r.ok, true, r.problems.join('\n'));
});
