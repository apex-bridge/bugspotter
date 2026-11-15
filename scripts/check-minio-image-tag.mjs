// Check that every reference to the self-built MinIO image uses the tag the
// Dockerfile defines, and that nothing still pulls upstream minio/minio or
// minio/mc (no longer publicly available - see docker/minio/Dockerfile).
//
// The tag is <MINIO_RELEASE>-r<IMAGE_REVISION> from docker/minio/Dockerfile and
// is repeated by hand in ci.yml, the compose files, testcontainers call sites
// and docs. A missed copy either fails on a tag that was never published or,
// worse, quietly keeps using an old image; this makes both fail fast.
//
// Usage: node scripts/check-minio-image-tag.mjs [--root <dir>]
// Exit 0 when consistent, 1 with a file:line list otherwise. Zero-dependency.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Assembled from parts so this file is not itself an untagged reference.
const IMAGE = ['ghcr.io', 'apex-bridge', 'bugspotter', 'minio'].join('/');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.next']);
const EXTENSIONS = /\.(ya?ml|[cm]?[jt]sx?|md|json|sh|env\.example)$/i;

function parseArgs(argv) {
  const i = argv.indexOf('--root');
  return i >= 0 ? argv[i + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');
}

export function expectedTag(dockerfileText) {
  const arg = (name) => dockerfileText.match(new RegExp(`^ARG ${name}=(\\S+)$`, 'm'))?.[1];
  const release = arg('MINIO_RELEASE');
  const revision = arg('IMAGE_REVISION');
  if (!release || !revision) {
    return null;
  }
  return `${IMAGE}:${release}-r${revision}`;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      yield* walk(path);
    } else if (
      st.isFile() &&
      (EXTENSIONS.test(name) || /^Dockerfile/.test(name)) &&
      st.size < 2_000_000
    ) {
      yield path;
    }
  }
}

export function check(root) {
  const dockerfile = join(root, 'docker', 'minio', 'Dockerfile');
  const want = expectedTag(readFileSync(dockerfile, 'utf8'));
  if (!want) {
    return {
      ok: false,
      problems: [`${relative(root, dockerfile)}: MINIO_RELEASE / IMAGE_REVISION not found`],
      refs: 0,
    };
  }

  const escaped = IMAGE.replaceAll('.', '\\.');
  const ref = new RegExp(`${escaped}:[A-Za-z0-9._-]+`, 'g');
  // Our image without a tag would pull :latest, which is never published.
  const ownUntagged = new RegExp(`${escaped}(?![:\\w/-])`, 'g');
  // Upstream images used as an image reference: tagged anywhere (optionally
  // registry-prefixed, e.g. quay.io/), quoted on their own (a GenericContainer
  // call whose image string sits on its own line), or untagged on a line that
  // pulls/runs an image. Prose ("minio/minio and minio/mc are gone") and
  // github.com/minio/... URLs are not references.
  const registry = '(?:(?:docker\\.io|quay\\.io|ghcr\\.io|public\\.ecr\\.aws)\\/)?';
  const upstreamTagged = new RegExp(`(?<![\\w./-])${registry}minio\\/(?:minio|mc):[\\w.-]+`, 'g');
  const upstreamQuoted = new RegExp(`(?<=["'\`])${registry}minio\\/(?:minio|mc)(?=["'\`])`, 'g');
  const upstreamBare = new RegExp(
    `(?<![\\w./-])${registry}minio\\/(?:minio|mc)(?=["'\\s\`]|$)`,
    'g'
  );
  const pullsImage = /\bimage:|\bdocker\s+(?:run|pull)\b|GenericContainer\(|\bFROM\s/;
  const problems = [];
  let refs = 0;
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const where = `${relative(root, file).replaceAll('\\', '/')}:${i + 1}`;
      for (const m of line.matchAll(ref)) {
        refs++;
        if (m[0] !== want) {
          problems.push(`${where}: ${m[0]} (expected ${want})`);
        }
      }
      for (const m of line.matchAll(ownUntagged)) {
        problems.push(`${where}: ${m[0]} has no tag (would pull :latest); use ${want}`);
      }
      const upstream = new Set(
        [...line.matchAll(upstreamTagged), ...line.matchAll(upstreamQuoted)].map((m) => m[0])
      );
      if (pullsImage.test(line)) {
        for (const m of line.matchAll(upstreamBare)) {
          upstream.add(m[0]);
        }
      }
      for (const m of upstream) {
        problems.push(`${where}: ${m} is no longer pullable; use ${want}`);
      }
    });
  }
  if (refs === 0) {
    problems.push(`no references to ${IMAGE} found - check the pattern in this script`);
  }
  return { ok: problems.length === 0, problems, refs, want };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = check(parseArgs(process.argv.slice(2)));
  if (result.ok) {
    console.log(`MinIO image tag consistent: ${result.refs} reference(s) to ${result.want}`);
  } else {
    console.error('MinIO image tag mismatch:');
    for (const p of result.problems) {
      console.error(`  ${p}`);
    }
    console.error('Update every reference to the tag defined in docker/minio/Dockerfile.');
    process.exit(1);
  }
}
