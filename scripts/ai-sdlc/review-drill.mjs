// Review drill: training PRs with one known defect.
//
// Why. Gate 3 is a human merging agent-written code, and nothing measures
// whether that review finds anything: a careful review and a skim both end in
// a merge. Airport X-ray screening has the same problem (real threats are
// rare, so attention decays unnoticed) and answers it with threat image
// projection: known test items shown to screeners, both to keep them looking
// and to measure how often they find one.
//
// How. A drill re-creates an already merged PR on top of the commit it was
// based on, so the diff is real code from this repo, and adds exactly one
// defect to the lines that PR introduced: one condition negated. The defect
// is kept only if the unit suite still passes with it ("surviving mutant"),
// so it is one only review can catch. The drill PR is labelled, says what it
// is, is never merged, and is closed by the reveal workflow after the first
// submitted human review, which also records whether the reviewer left an
// inline comment on (or within two lines of) the seeded line.
//
// The seed's location is an answer key: it is written to the private
// bugspotter-metrics repo before the PR opens and not printed in this public
// repo's logs until the reveal, the same way a quiz does not print its
// answers next to the questions.
//
// Limits, stated up front:
//   - A negated condition in dead or stub code can be an equivalent mutant
//     (no behaviour change); the reveal comment says so.
//   - The reviewer knows there is exactly one defect, which is not how real
//     review works. The drill measures attention to the diff, not realism.
//   - "Caught" needs an inline comment near the line. A reviewer who spotted
//     it but wrote only a summary comment is recorded as missed; the reveal
//     comment lets them say so.
//
// Modes (env-driven, like the other ai-sdlc scripts):
//   pick    GITHUB_TOKEN, REPO, [SOURCE_PR]      -> GITHUB_OUTPUT source_pr, merge_sha, title
//   seed    PARENT, DRILL_STATE, [SEED_TEST_CMD], [SEED_MAX_TRIES]   (cwd = drill work tree)
//   record  DRILL_STATE, DRILL_OUT, DRILL_BRANCH, SOURCE_PR, REPO, RUN_ID
//   reveal  DRILLS_FILE, OUTCOMES_FILE, COMMENTS_JSON, PR_JSON, REVIEW_JSON, REPO
//                                                -> GITHUB_OUTPUT act, outcome_row, comment_body

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomInt, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const MAX_SOURCE_LINES = 400;
export const NEAR_LINES = 2;
const SOURCE_WINDOW_DAYS = 180;

export const OPERATORS = [
  { id: 'eq-negate', from: ' === ', to: ' !== ' },
  { id: 'neq-negate', from: ' !== ', to: ' === ' },
  { id: 'and-to-or', from: ' && ', to: ' || ' },
  { id: 'or-to-and', from: ' || ', to: ' && ' },
  // Falsy-but-set values (0, '') take the default: the kind of bug #460 fixed.
  { id: 'nullish-to-or', from: ' ?? ', to: ' || ' },
  { id: 'lt-negate', from: ' < ', to: ' >= ', relational: true },
  { id: 'gt-negate', from: ' > ', to: ' <= ', relational: true },
  { id: 'lte-negate', from: ' <= ', to: ' > ', relational: true },
  { id: 'gte-negate', from: ' >= ', to: ' < ', relational: true },
  { id: 'return-true', from: 'return true;', to: 'return false;' },
  { id: 'return-false', from: 'return false;', to: 'return true;' },
];

const SOURCE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;
const TEST_FILE = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_ROOT = /^(packages|apps|scripts)\//;
const LOCK_FILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/;
// A drill PR must not carry workflow changes (they would run on the drill PR)
// or specs/ADRs (they would trip the Gate 1/2 guards on an old artifact).
const DISQUALIFYING = /^(\.github\/|docs\/specs\/|docs\/adr\/)/;

/** Source files a seed may go into: code under packages/, apps/ or scripts/, not tests. */
export function isEligibleFile(f) {
  return SOURCE_ROOT.test(f) && SOURCE_EXT.test(f) && !TEST_FILE.test(f) && !f.endsWith('.d.ts');
}

/**
 * Whether a merged PR can be re-created as a drill.
 * @param {object} pr     GET /pulls/{n} or list item
 * @param {{filename: string, additions: number, deletions: number, status: string}[]} files
 */
export function isEligibleSource(pr, files, now = new Date()) {
  if (!pr?.merged_at || !pr.merge_commit_sha) {
    return false;
  }
  if (pr.head?.ref?.startsWith('drill/')) {
    return false;
  }
  if ((now - new Date(pr.merged_at)) / 86_400_000 > SOURCE_WINDOW_DAYS) {
    return false;
  }
  if (!files?.length || files.some((f) => DISQUALIFYING.test(f.filename))) {
    return false;
  }
  const lines = files
    .filter((f) => !LOCK_FILE.test(f.filename))
    .reduce((n, f) => n + (f.additions ?? 0) + (f.deletions ?? 0), 0);
  if (lines === 0 || lines > MAX_SOURCE_LINES) {
    return false;
  }
  return files.some((f) => isEligibleFile(f.filename) && f.status !== 'removed' && f.additions > 0);
}

/** Added (new-side) line numbers per file from `git diff -U0` output. */
export function parseAddedLines(diff) {
  const added = new Map();
  let file = null;
  let next = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (file && !added.has(file)) {
        added.set(file, new Set());
      }
      continue;
    }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      next = Number(h[1]);
      continue;
    }
    if (!file) {
      continue;
    }
    if (line.startsWith('+')) {
      added.get(file).add(next);
      next++;
    } else if (line.startsWith(' ')) {
      next++;
    }
  }
  return added;
}

function insideQuotes(line, index) {
  let single = 0;
  let double = 0;
  for (let i = 0; i < index; i++) {
    const c = line[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === "'" && double % 2 === 0) {
      single++;
    } else if (c === '"' && single % 2 === 0) {
      double++;
    }
  }
  return single % 2 === 1 || double % 2 === 1;
}

function skipLine(trimmed) {
  return (
    !trimmed ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('import ') ||
    /^export .* from /.test(trimmed) ||
    trimmed.includes('`') ||
    trimmed.includes('eslint-disable')
  );
}

/**
 * Places an operator could be applied in one file, optionally only on the
 * given (1-based) lines.
 */
export function findSites(file, content, onlyLines = null) {
  const sites = [];
  const tsx = file.endsWith('.tsx');
  const lines = content.split('\n');
  for (let n = 0; n < lines.length; n++) {
    if (onlyLines && !onlyLines.has(n + 1)) {
      continue;
    }
    const line = lines[n];
    if (skipLine(line.trim())) {
      continue;
    }
    for (const op of OPERATORS) {
      // JSX text and generic type arguments make bare < and > ambiguous in .tsx.
      if (op.relational && tsx) {
        continue;
      }
      let from = 0;
      let idx;
      while ((idx = line.indexOf(op.from, from)) !== -1) {
        from = idx + op.from.length;
        if (insideQuotes(line, idx)) {
          continue;
        }
        if (op.relational && (line[idx - 1] === '>' || line[idx - 1] === '<')) {
          continue;
        }
        sites.push({ file, line: n + 1, index: idx, op });
      }
    }
  }
  return sites;
}

export function applySite(content, site) {
  const lines = content.split('\n');
  const original = lines[site.line - 1];
  const mutated =
    original.slice(0, site.index) + site.op.to + original.slice(site.index + site.op.from.length);
  lines[site.line - 1] = mutated;
  return { content: lines.join('\n'), original, mutated };
}

/** Fisher-Yates with crypto randomness. */
export function shuffle(items, rand = randomInt) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Did a human reviewer flag the seeded line? A review comment counts when it
 * is on the seed's file and its line range is within NEAR_LINES of the seed.
 * @param {object} seed  answer key row
 * @param {{path: string, line?: number, start_line?: number, original_line?: number,
 *          side?: string, user?: {type?: string}}[]} comments  GET /pulls/{n}/comments
 */
export function judge(seed, comments) {
  const human = (comments ?? []).filter((c) => c?.user?.type !== 'Bot' && c.side !== 'LEFT');
  const near = human.filter((c) => {
    if (c.path !== seed.file) {
      return false;
    }
    const end = c.line ?? c.original_line;
    if (typeof end !== 'number') {
      return false;
    }
    const start = c.start_line ?? end;
    return start - NEAR_LINES <= seed.line && seed.line <= end + NEAR_LINES;
  });
  return { outcome: near.length > 0 ? 'caught' : 'missed', comments: human.length };
}

/** Lines per hour for the review, or null when it cannot be computed. */
export function inspectionRate(pr, review) {
  const lines = (pr?.additions ?? 0) + (pr?.deletions ?? 0);
  const minutes = (new Date(review?.submitted_at) - new Date(pr?.created_at)) / 60_000;
  if (!lines || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  return Math.round((lines / minutes) * 60);
}

export function answerKeyRow(state, { branch, sourcePr, repo, runId, now = new Date() }) {
  return {
    schema: 1,
    recorded_at: now.toISOString(),
    repo,
    branch,
    source_pr: Number(sourcePr),
    run_id: String(runId),
    file: state.file,
    line: state.line,
    operator: state.operator,
    original: state.original,
    mutated: state.mutated,
  };
}

export function outcomeRow({ seed, pr, review, judgement, now = new Date() }) {
  return {
    schema: 1,
    recorded_at: now.toISOString(),
    repo: seed.repo,
    pr: pr.number,
    branch: seed.branch,
    source_pr: seed.source_pr,
    outcome: judgement.outcome,
    inline_comments: judgement.comments,
    lines_changed: (pr.additions ?? 0) + (pr.deletions ?? 0),
    review_minutes: Math.max(
      0,
      Math.round((new Date(review.submitted_at) - new Date(pr.created_at)) / 60_000)
    ),
  };
}

export function revealComment(seed, judgement, rate) {
  const verdict =
    judgement.outcome === 'caught'
      ? '**Caught.** You left an inline comment on or next to the seeded line.'
      : '**Missed.** No inline comment on or within ' +
        `${NEAR_LINES} lines of the seeded line (you left ${judgement.comments} inline comment(s) in total).`;
  const pace =
    rate === null
      ? ''
      : `\n\nReview pace: about ${rate} changed lines per hour. Defect discovery drops noticeably above ~500 lines per hour.`;
  return (
    '<!-- review-drill:reveal -->\n' +
    `**Review drill result.** The seeded defect was at \`${seed.file}:${seed.line}\` (${seed.operator}):\n\n` +
    '```diff\n- ' +
    seed.original.trim() +
    '\n+ ' +
    seed.mutated.trim() +
    '\n```\n\n' +
    verdict +
    pace +
    '\n\nIf the line could not change behaviour (dead or stub code), the seed was an equivalent ' +
    'mutant and the result says nothing about the review. If you spotted it but only said so in a ' +
    'summary comment, reply here. This PR is now closed; it was never meant to merge.'
  );
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
  return r.stdout;
}

/** Seeds one surviving mutant into the staged changes. Returns false if none survived. */
export function seed({ parent, statePath, testCmd, maxTries }) {
  const added = parseAddedLines(git(['diff', '--cached', '-U0', parent]));
  const candidates = [];
  for (const [file, lines] of added) {
    if (isEligibleFile(file) && existsSync(file)) {
      candidates.push(...findSites(file, readFileSync(file, 'utf8'), lines));
    }
  }
  for (const site of shuffle(candidates).slice(0, maxTries)) {
    const originalContent = readFileSync(site.file, 'utf8');
    const m = applySite(originalContent, site);
    writeFileSync(site.file, m.content, 'utf8');
    const ok = spawnSync(testCmd, { shell: true, stdio: 'ignore' }).status === 0;
    if (ok) {
      writeFileSync(
        statePath,
        JSON.stringify({
          file: site.file,
          line: site.line,
          operator: site.op.id,
          original: m.original,
          mutated: m.mutated,
        }),
        'utf8'
      );
      return true;
    }
    writeFileSync(site.file, originalContent, 'utf8');
  }
  return false;
}

async function gh(path, token) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) {
    throw new Error(`GitHub API ${path} -> ${r.status}`);
  }
  return r.json();
}

async function pick({ token, repo, sourcePr }) {
  if (sourcePr) {
    const pr = await gh(`/repos/${repo}/pulls/${Number(sourcePr)}`, token);
    const files = await gh(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`, token);
    if (!isEligibleSource(pr, files)) {
      throw new Error(
        `PR #${pr.number} cannot be a drill: it must be merged in the last ${SOURCE_WINDOW_DAYS} days, ` +
          `change at most ${MAX_SOURCE_LINES} lines, add code under packages/, apps/ or scripts/, and not touch ` +
          '.github/, docs/specs/ or docs/adr/.'
      );
    }
    return pr;
  }
  const closed = [];
  for (const page of [1, 2]) {
    closed.push(
      ...(await gh(
        `/repos/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=${page}`,
        token
      ))
    );
  }
  const merged = shuffle(closed.filter((p) => p.merged_at && !p.head?.ref?.startsWith('drill/')));
  for (const pr of merged.slice(0, 15)) {
    const files = await gh(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`, token);
    if (isEligibleSource(pr, files)) {
      return pr;
    }
  }
  throw new Error('No eligible merged PR found among 15 tries; dispatch again or name source_pr.');
}

function readJsonl(path) {
  if (!path || !existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

function output(lines) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  }
}

async function main() {
  const mode = process.argv[2];
  const env = process.env;
  if (mode === 'pick') {
    const pr = await pick({
      token: env.GITHUB_TOKEN,
      repo: env.REPO,
      sourcePr: env.SOURCE_PR?.trim(),
    });
    console.log(`Source PR: #${pr.number} ${pr.title}`);
    const delim = `EOF_${randomBytes(8).toString('hex')}`;
    output([
      `source_pr=${pr.number}`,
      `merge_sha=${pr.merge_commit_sha}`,
      `title<<${delim}`,
      pr.title,
      delim,
    ]);
    return;
  }
  if (mode === 'seed') {
    const tries = Number.parseInt(env.SEED_MAX_TRIES ?? '', 10);
    const ok = seed({
      parent: env.PARENT,
      statePath: env.DRILL_STATE,
      testCmd: env.SEED_TEST_CMD || 'pnpm test:unit',
      maxTries: Number.isInteger(tries) && tries > 0 ? tries : 3,
    });
    // The answer key stays out of this public log.
    console.log(ok ? 'Seeded one defect.' : 'No surviving mutant in this PR.');
    process.exit(ok ? 0 : 3);
  }
  if (mode === 'record') {
    const state = JSON.parse(readFileSync(env.DRILL_STATE, 'utf8'));
    const row = answerKeyRow(state, {
      branch: env.DRILL_BRANCH,
      sourcePr: env.SOURCE_PR,
      repo: env.REPO,
      runId: env.RUN_ID,
    });
    appendFileSync(env.DRILL_OUT, JSON.stringify(row) + '\n', 'utf8');
    return;
  }
  if (mode === 'reveal') {
    const pr = JSON.parse(readFileSync(env.PR_JSON, 'utf8'));
    const review = JSON.parse(readFileSync(env.REVIEW_JSON, 'utf8'));
    const seedRow = readJsonl(env.DRILLS_FILE)
      .filter((r) => r.branch === pr.head.ref && r.repo === env.REPO)
      .pop();
    const done = readJsonl(env.OUTCOMES_FILE).some(
      (r) => r.branch === pr.head.ref && r.repo === env.REPO
    );
    if (!seedRow || done || pr.state !== 'open') {
      console.log(!seedRow ? 'No answer key for this branch.' : 'Drill already finished.');
      output(['act=false']);
      return;
    }
    const judgement = judge(seedRow, JSON.parse(readFileSync(env.COMMENTS_JSON, 'utf8')));
    const rate = inspectionRate(pr, review);
    console.log(`Drill result: ${judgement.outcome}.`);
    const delim = `EOF_${randomBytes(8).toString('hex')}`;
    output([
      'act=true',
      `outcome_row=${JSON.stringify(outcomeRow({ seed: seedRow, pr, review, judgement }))}`,
      `comment_body<<${delim}`,
      revealComment(seedRow, judgement, rate),
      delim,
    ]);
    return;
  }
  console.error('Usage: review-drill.mjs pick|seed|record|reveal');
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await main();
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
