// Runs the current ADR generator on each eval case and scores the results.
//
// For every case in scripts/ai-sdlc/eval-adr-cases/: check out the case's
// historical commit (the repo as it was before its ADR existed) into a temporary
// git worktree, copy in the CURRENT generator files, run generate-adr.mjs N
// times with the real issue text (and spec, if the case has one), and score
// each draft with eval-adr.mjs against that historical repo state.
//
//   node scripts/ai-sdlc/run-adr-eval.mjs --out <dir> [--runs 3] [--cases 451-rls,227-match-score]
//
// Needs: git, gh (issue text), and the LLM credentials generate-adr.mjs needs
// (LLM_BACKEND=cli + CLAUDE_CODE_OAUTH_TOKEN, or ANTHROPIC_API_KEY). Every run is
// a real, billed model call (~$0.2-0.4 each on #451-sized inputs).

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAdr } from './eval-adr.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CASES_DIR = join(HERE, 'eval-adr-cases');
const REPO = 'apex-bridge/bugspotter';
const GENERATOR = 'scripts/ai-sdlc/generate-adr.mjs';
const GENERATOR_DATA = ['docs/adr/TEMPLATE.md'];

// The generator and every module it imports, directly or not (relative
// imports only), as repo-relative paths. Computed rather than listed: a
// hand-kept list missed markdown-fence.mjs once it was added (#459), and every
// run then failed before the model call.
export function generatorFiles(root = ROOT, entry = GENERATOR) {
  const seen = new Set();
  const queue = [entry];
  const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const src = readFileSync(join(root, file), 'utf8');
    for (const m of src.matchAll(IMPORT)) {
      queue.push(posix.join(posix.dirname(file), m[1]));
    }
  }
  return [...seen, ...GENERATOR_DATA];
}

function parseArgs(argv) {
  const out = { runs: 3, cases: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs') {
      out.runs = Number(argv[++i]);
    } else if (argv[i] === '--cases') {
      out.cases = argv[++i].split(',');
    } else if (argv[i] === '--out') {
      out.out = argv[++i];
    }
  }
  if (!out.out || !Number.isInteger(out.runs) || out.runs < 1) {
    console.error('usage: run-adr-eval.mjs --out <dir> [--runs N] [--cases id,id]');
    process.exit(2);
  }
  return out;
}

const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// "claude CLI: turns=1 wall=231s api=230s ttft=189s in=2 out=22644 thinking=17554 cost=$0.2962"
// One line per model call; a corrective retry adds a second, so sum them.
// llm-client.mjs writes each field only when the response carries it
// (thinking= is absent with thinking off), so every field is optional; the
// "still running after Ns" progress line is not a call.
export function metrics(log) {
  const calls = log
    .split('\n')
    .filter((l) => /claude CLI: (?:\w+=|no telemetry)/.test(l))
    .map((l) => ({
      wall: Number(l.match(/\bwall=(\d+)s/)?.[1] ?? 0),
      thinking: Number(l.match(/\bthinking=(\d+)/)?.[1] ?? 0),
      cost: Number(l.match(/\bcost=\$([\d.]+)/)?.[1] ?? 0),
    }));
  if (!calls.length) {
    return {};
  }
  const sum = (k) => calls.reduce((t, c) => t + c[k], 0);
  return {
    wallS: sum('wall'),
    thinking: sum('thinking'),
    costUsd: Math.round(sum('cost') * 10_000) / 10_000,
    calls: calls.length,
  };
}

function runCase(def, runs, outDir) {
  const work = mkdtempSync(join(tmpdir(), `adr-eval-${def.id}-`));
  rmSync(work, { recursive: true, force: true });
  const commit = def.repoCommit === 'HEAD' ? git(['rev-parse', 'HEAD']) : def.repoCommit;
  git(['worktree', 'add', '--detach', work, commit]);
  const results = [];
  try {
    for (const f of generatorFiles()) {
      mkdirSync(dirname(join(work, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(work, f));
    }
    const issue = JSON.parse(
      execFileSync(
        'gh',
        ['issue', 'view', String(def.issue), '--repo', REPO, '--json', 'title,body'],
        {
          encoding: 'utf8',
        }
      )
    );
    const spec =
      def.spec && existsSync(join(work, def.spec))
        ? readFileSync(join(work, def.spec), 'utf8')
        : '';
    const files = git(['ls-files'], work).split('\n');
    for (let i = 1; i <= runs; i++) {
      const started = Date.now();
      const r = spawnSync(process.execPath, ['scripts/ai-sdlc/generate-adr.mjs'], {
        cwd: work,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 15 * 60_000,
        env: {
          ...process.env,
          ISSUE_NUMBER: String(def.issue),
          ISSUE_TITLE: issue.title,
          ISSUE_BODY: issue.body ?? '',
          ...(spec ? { SPEC_CONTENT: spec } : {}),
          GITHUB_OUTPUT: '',
        },
      });
      const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
      const tag = `${def.id}-${i}`;
      writeFileSync(join(outDir, `${tag}.log`), log);
      const adrRel = log.match(/^adr_file=(.+)$/m)?.[1]?.trim();
      const row = {
        case: def.id,
        run: i,
        exit: r.status,
        elapsedS: Math.round((Date.now() - started) / 1000),
        ...metrics(log),
      };
      if (r.status === 0 && adrRel && existsSync(join(work, adrRel))) {
        const text = readFileSync(join(work, adrRel), 'utf8');
        writeFileSync(join(outDir, `${tag}.md`), text);
        rmSync(join(work, adrRel));
        const score = evaluateAdr(text, def, { repoDir: work, files });
        Object.assign(row, {
          score: `${score.passed}/${score.total}`,
          passed: score.passed,
          total: score.total,
          failed: score.checks.filter((c) => !c.pass).map((c) => c.id),
        });
      } else {
        Object.assign(row, { score: 'no ADR', failed: ['generation'] });
      }
      results.push(row);
      console.log(
        `${tag}: exit=${row.exit} ${row.wallS ?? row.elapsedS}s thinking=${row.thinking ?? '?'} $${row.costUsd ?? '?'} score=${row.score}${row.failed.length ? ` failed=${row.failed.join(',')}` : ''}`
      );
    }
  } catch (err) {
    if (!results.length) {
      throw err;
    }
    console.error(`${def.id}: stopped after ${results.length} run(s): ${err.message}`);
    results.push({
      case: def.id,
      run: '-',
      score: 'case error',
      failed: ['case-setup'],
      error: err.message,
    });
  } finally {
    git(['worktree', 'remove', '--force', work]);
  }
  return results;
}

function summary(rows) {
  const lines = [
    '| Case | Run | Wall (s) | Thinking | Cost ($) | Score | Failed checks |',
    '| ---- | --- | -------- | -------- | -------- | ----- | ------------- |',
    ...rows.map(
      (r) =>
        `| ${r.case} | ${r.run} | ${r.wallS ?? r.elapsedS} | ${r.thinking ?? ''} | ${r.costUsd ?? ''} | ${r.score} | ${r.failed.join(', ')} |`
    ),
  ];
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });
  const defs = readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')))
    .filter((d) => !args.cases || args.cases.includes(d.id));
  // A failing case (gh, worktree, copy) is recorded and the others still run,
  // so already-billed runs always reach results.json.
  const rows = defs.flatMap((d) => {
    try {
      return runCase(d, args.runs, args.out);
    } catch (err) {
      console.error(`${d.id}: case failed: ${err.message}`);
      return [
        { case: d.id, run: '-', score: 'case error', failed: ['case-setup'], error: err.message },
      ];
    }
  });
  writeFileSync(join(args.out, 'results.json'), JSON.stringify(rows, null, 2));
  writeFileSync(join(args.out, 'results.md'), summary(rows));
  console.log(`\n${summary(rows)}`);
}
