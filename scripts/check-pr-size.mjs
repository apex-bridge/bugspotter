// Advisory PR size check: warns when a PR changes more than PR_SIZE_WARN
// lines (default 400) once lock files and generated output are left out.
// Never blocks.
//
// Why 400. Review effectiveness drops with the size of what is reviewed: the
// SmartBear/Cisco code review study found defect discovery falls off past
// 200-400 lines at a time. bugspotter-metrics shows the gap here: the 6-file
// cap on specs (check-spec-scope.mjs) holds, but there is no line limit, and
// about a quarter of merged PRs (38 of 151, as of 2026-11-17) changed more
// than 400 lines, an agent impl PR up to 1717.
//
// Why advisory. Tests legitimately inflate a diff, and 151 PRs are not enough
// to calibrate a hard limit honestly. The warning says how many of the lines
// are tests, so the reviewer can judge whether to ask for a split.
//
// Counts additions + deletions per file from GET /pulls/{n}/files. Excluded:
// lock files and generated output (see EXCLUDE). Everything else counts,
// including specs and docs: a 600-line spec is also a large review.
//
// Usage: PR_FILES_JSON=<path to a JSON array of {filename, additions,
// deletions}> [PR_SIZE_WARN=400] node scripts/check-pr-size.mjs
// Writes over/changed/comment_body to GITHUB_OUTPUT when set. Exit 0 always,
// except a missing or unreadable PR_FILES_JSON (exit 1: a check that reads
// nothing would report every PR as small).

import { readFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const DEFAULT_WARN = 400;
export const MARKER = '<!-- pr-size -->';

export const EXCLUDE = [
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock)$/,
  /(^|\/)(dist|build|coverage)\//,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.generated\.[^/]+$/,
];

const TEST = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export function isExcluded(filename) {
  return EXCLUDE.some((re) => re.test(filename));
}

export function isTest(filename) {
  return TEST.test(filename);
}

/** Parses PR_SIZE_WARN; anything that is not a positive integer means the default. */
export function resolveThreshold(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const n = Number(trimmed);
  return trimmed && Number.isInteger(n) && n > 0 ? n : DEFAULT_WARN;
}

/**
 * @param {{filename: string, additions?: number, deletions?: number}[]} files
 * @param {number} threshold
 */
export function measure(files, threshold = DEFAULT_WARN) {
  let changed = 0;
  let tests = 0;
  let excluded = 0;
  const counted = [];
  for (const f of files) {
    const n = (f.additions ?? 0) + (f.deletions ?? 0);
    if (isExcluded(f.filename)) {
      excluded += n;
      continue;
    }
    changed += n;
    if (isTest(f.filename)) {
      tests += n;
    }
    counted.push({ filename: f.filename, lines: n });
  }
  counted.sort((a, b) => b.lines - a.lines);
  return {
    changed,
    tests,
    excluded,
    threshold,
    over: changed > threshold,
    largest: counted.slice(0, 5),
  };
}

export function commentBody(m) {
  if (!m.over) {
    return (
      `${MARKER}\n**PR size:** ${m.changed} changed lines, within the ${m.threshold}-line ` +
      'review guideline now.'
    );
  }
  const rows = m.largest.map((f) => `| \`${f.filename}\` | ${f.lines} |`).join('\n');
  const testsPart = m.tests ? `, ${m.tests} of them in tests` : '';
  const excludedPart = m.excluded
    ? ` (${m.excluded} more in lock files or generated output, not counted)`
    : '';
  return (
    `${MARKER}\n**PR size:** ${m.changed} changed lines${testsPart}${excludedPart}. ` +
    `That is over the ${m.threshold}-line guideline: past that size reviews find ` +
    'noticeably fewer defects. Consider splitting it, or review it in parts.\n\n' +
    `| Largest files | Lines |\n|---|---|\n${rows}\n\n` +
    '_Advisory only, never blocks merge (scripts/check-pr-size.mjs)._'
  );
}

function main() {
  const { PR_FILES_JSON, PR_SIZE_WARN, GITHUB_OUTPUT } = process.env;
  if (!PR_FILES_JSON) {
    console.error('Missing PR_FILES_JSON');
    process.exit(1);
  }
  let files;
  try {
    files = JSON.parse(readFileSync(PR_FILES_JSON, 'utf8'));
    if (!Array.isArray(files)) {
      throw new Error('not a JSON array');
    }
  } catch (err) {
    console.error(`::error::PR size check: could not read ${PR_FILES_JSON}: ${err.message}`);
    process.exit(1);
  }
  const m = measure(files, resolveThreshold(PR_SIZE_WARN));
  const line = `PR size: ${m.changed} changed lines (${m.tests} in tests, ${m.excluded} excluded), guideline ${m.threshold}.`;
  if (m.over) {
    console.log(`::warning::${line} Consider splitting it.`);
  } else {
    console.log(line);
  }
  if (GITHUB_OUTPUT) {
    const delim = `EOF_PR_SIZE_${randomBytes(8).toString('hex')}`;
    appendFileSync(
      GITHUB_OUTPUT,
      [
        `over=${m.over}`,
        `changed=${m.changed}`,
        `comment_body<<${delim}`,
        commentBody(m),
        delim,
      ].join('\n') + '\n'
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
