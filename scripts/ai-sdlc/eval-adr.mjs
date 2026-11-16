// Scores a generated ADR against a case rubric (scripts/ai-sdlc/eval-adr-cases/).
// Deterministic, no LLM: structure, required facts, forbidden statements,
// file:line references that exist, length, and optional spec checks.
//
// The spec's own checks (B/C/F for #451) passed on drafts that still left out a
// required part or cited a non-existent path (#458); this catches those.
//
//   node scripts/ai-sdlc/eval-adr.mjs --case <case.json> --adr <file> [--adr <file>...]
//        [--repo <dir>]   repo state the references are checked against (default .)
//        [--json]
//
// Zero-dependency.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableInventory, DEFAULT_MIGRATIONS_DIR } from './table-inventory.mjs';

const DEFAULT_SECTIONS = ['context', 'decision', 'consequences', 'alternatives'];
const META_NOTE =
  /\b(do(es)? not have access|cannot run|could not (run|read)|unable to (run|read)|no tools available)\b/i;

// "## Heading" -> body, lowercased titles; main body = everything before "## Appendix".
export function splitAdr(text) {
  const lines = text.split(/\r?\n/);
  const appendixAt = lines.findIndex((l) => /^## Appendix/i.test(l));
  const main = (appendixAt < 0 ? lines : lines.slice(0, appendixAt)).join('\n');
  const sections = new Map();
  let current = null;
  for (const line of lines) {
    const h = line.match(/^## (.*)$/);
    if (h) {
      current = h[1].trim().toLowerCase();
      sections.set(current, []);
    } else if (current) {
      sections.get(current).push(line);
    }
  }
  return {
    main,
    mainLines: main.split('\n').length,
    sections: new Map([...sections].map(([k, v]) => [k, v.join('\n')])),
  };
}

const anyMatch = (text, patterns) => patterns.some((p) => new RegExp(p, 'i').test(text));

function listRepoFiles(repoDir) {
  try {
    return execFileSync('git', ['-C', repoDir, 'ls-files'], { encoding: 'utf8' }).split('\n');
  } catch {
    return [];
  }
}

// path:line references that resolve (by path suffix) to a tracked file long enough.
export function checkFileRefs(text, repoDir, files = listRepoFiles(repoDir)) {
  const refs = [...new Set(text.match(/[\w./-]+\.(?:ts|tsx|sql|ya?ml|mjs|js|json|md):\d+/g) ?? [])];
  const bad = [];
  for (const ref of refs) {
    const i = ref.lastIndexOf(':');
    const path = ref.slice(0, i).replace(/^\.?\//, '');
    const line = Number(ref.slice(i + 1));
    const hit = files.find((f) => f === path || f.endsWith(`/${path}`));
    const lines = hit ? readFileSync(join(repoDir, hit), 'utf8').split('\n').length : 0;
    if (!hit || line < 1 || line > lines) {
      bad.push(ref);
    }
  }
  return { total: refs.length, bad };
}

/**
 * @param {string} text  ADR markdown
 * @param {object} def   case rubric (see eval-adr-cases/*.json)
 * @param {{repoDir?: string, files?: string[]}} [opts]
 */
export function evaluateAdr(text, def, opts = {}) {
  const repoDir = opts.repoDir ?? '.';
  const { main, mainLines, sections } = splitAdr(text);
  const checks = [];
  const add = (id, kind, pass, detail = '') => checks.push({ id, kind, pass, detail });

  add('header', 'structure', /^# ADR-\d{4}: \S/m.test(text));
  add('status-proposed', 'structure', /^- Status: Proposed\s*$/m.test(text));
  add('decision-summary', 'structure', /^> \*\*Decision:\*\*/m.test(text));
  const titles = [...sections.keys()];
  const order = (def.sections ?? DEFAULT_SECTIONS).map((s) =>
    titles.findIndex((t) => t.startsWith(s))
  );
  add(
    'sections-in-order',
    'structure',
    order.every((i) => i >= 0) && order.every((i, k) => k === 0 || i > order[k - 1]),
    order.some((i) => i < 0)
      ? `missing: ${(def.sections ?? DEFAULT_SECTIONS).filter((_, k) => order[k] < 0).join(', ')}`
      : ''
  );
  const maxLines = def.maxMainLines ?? 150;
  add('length', 'structure', mainLines <= maxLines, `${mainLines}/${maxLines} main-body lines`);
  add('no-meta-notes', 'structure', !META_NOTE.test(main));
  if (def.requireDiagram) {
    add('diagram', 'structure', /^```mermaid/m.test(main));
  }

  const refs = checkFileRefs(main, repoDir, opts.files);
  add(
    'file-refs-exist',
    'facts',
    refs.bad.length === 0,
    refs.bad.length ? `bad: ${refs.bad.join(', ')}` : `${refs.total} ok`
  );

  for (const r of def.required ?? []) {
    add(r.id, 'required', anyMatch(main, r.any), r.note ?? '');
  }
  // Forbidden statements count outside "Alternatives", where a rejected option
  // is legitimately described.
  const notAlternatives = [...sections]
    .filter(([title]) => !title.startsWith('alternatives') && !title.startsWith('appendix'))
    .map(([, body]) => body)
    .join('\n');
  for (const f of def.forbidden ?? []) {
    add(f.id, 'forbidden', !anyMatch(notAlternatives, f.any), f.note ?? '');
  }

  if (def.testingStrategy) {
    const ts = sections.get('testing strategy') ?? '';
    const missing = def.testingStrategy.filter((c) => !ts.toLowerCase().includes(c.toLowerCase()));
    add(
      'testing-strategy-names',
      'spec',
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : ''
    );
  }
  if (def.inventory) {
    const migrations = join(repoDir, DEFAULT_MIGRATIONS_DIR);
    const tables = existsSync(migrations) ? tableInventory(migrations).map((r) => r.table) : [];
    const inv = text.split(/^### Table inventory\s*$/m)[1]?.split(/^##\s/m)[0] ?? '';
    const unclassified = tables.filter(
      (t) =>
        !new RegExp(`^\\| *\`?${t}\`? *\\| *(org-scoped|project-scoped|global) *\\|`, 'mi').test(
          inv
        )
    );
    const noReason = (inv.match(/^\| *[^|]+\| *global *\| *(\| *)?$/gim) ?? []).length;
    const missingReason = (inv.match(/REASON MISSING/g) ?? []).length;
    add(
      'inventory-complete',
      'spec',
      tables.length > 0 && unclassified.length === 0 && noReason === 0 && missingReason === 0,
      `${tables.length - unclassified.length}/${tables.length} classified${missingReason ? `, ${missingReason} reasons missing` : ''}`
    );
  }

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length, mainLines };
}

function parseArgs(argv) {
  const out = { adrs: [], repo: '.', json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--case') {
      out.case = argv[++i];
    } else if (argv[i] === '--adr') {
      out.adrs.push(argv[++i]);
    } else if (argv[i] === '--repo') {
      out.repo = argv[++i];
    } else if (argv[i] === '--json') {
      out.json = true;
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.case || !args.adrs.length) {
    console.error(
      'usage: eval-adr.mjs --case <case.json> --adr <file> [--adr ...] [--repo <dir>] [--json]'
    );
    process.exit(2);
  }
  const def = JSON.parse(readFileSync(args.case, 'utf8'));
  const files = listRepoFiles(args.repo);
  const results = args.adrs.map((adr) => ({
    adr,
    ...evaluateAdr(readFileSync(adr, 'utf8'), def, { repoDir: args.repo, files }),
  }));
  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      const failed = r.checks.filter((c) => !c.pass);
      console.log(
        `${r.adr}: ${r.passed}/${r.total}${failed.length ? ` | failed: ${failed.map((c) => `${c.id}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}` : ''}`
      );
    }
  }
}
