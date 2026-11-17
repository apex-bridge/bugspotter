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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableInventory, DEFAULT_MIGRATIONS_DIR } from './table-inventory.mjs';

const DEFAULT_SECTIONS = ['context', 'decision', 'consequences', 'alternatives'];
// Notes about the author's own tooling ("I could not read the repo"), not
// domain prose ("workers do not have access to the request context").
const META_NOTES = [
  /\bno tools (?:are )?available\b/i,
  // The negation is followed directly by a tooling verb and a repo object:
  // "this ADR does not change access control" is a scope statement.
  /\bthis (?:ADR|draft|document)\b[^.\n]{0,40}?\b(?:do(?:es)? not|could not|cannot|can't|(?:is|was) unable to)\s+(?:(?:have\s+)?access(?:\s+to)?|run|read|verify|execute|inspect|open|check)\s+(?:[\w'`]+\s+){0,3}`?(?:repo(?:sitory)?|codebase|code|source(?: code)?|files?|tools?|tests?|commands?|grep)\b/i,
  // A bare "I" (not "Phase I") or the model, with a tooling verb.
  /(?<!\b(?:Phase|Stage|Step|Part|Slice|Tier|Level|Option|Type|Class|Appendix) )\b(?:I|[Tt]he (?:model|assistant))\b (?:do not|don't|did not|could not|cannot|can't|(?:am|was|is) unable to) (?:have access|access|run|read|verify|execute|inspect|open|check|browse|see)\b/,
  /\b(?:do(?:es)? not|don't|did not|could not|cannot|can't) (?:have )?access (?:to )?(?:the )?(?:repo(?:sitory)?|codebase|source(?: code)?|files|tools)\b/i,
  /\b(?:could not|cannot|can't|unable to) (?:run|execute|verify) (?:the )?(?:code|tests|commands|tools)\b/i,
];

// A match negated in its own clause ("we never link accounts by email alone",
// "we don't skip RLS") states the opposite, so it does not count. The clause
// starts after the last sentence end, comma or clause conjunction before the
// match ("Since IdPs do not send it, we link by email alone" is affirmed), and
// the negation must be among the last few words before it. Parentheticals are
// dropped first ("we do not, per client.ts, skip RLS" stays negated), and a
// "." ends a sentence only before a capital or the end, not in "ADR-0007.md".
const SENTENCE_END = /[.!?]+(?=\s+[A-Z"'`*_([]|\s*$)|[;:!?\n|]/g;
const CLAUSE_START =
  /,|\b(?:and|but|so|because|since|although|though|while|whereas|yet|which|when|if|then)\b/gi;
const NEGATOR =
  /^(?:not|never|no|nor|neither|without|cannot|reject(?:s|ed|ing)?|\w+n['’]t|rather_than|instead_of)$/i;
const NEGATION_WINDOW = 3; // words

function negatedBefore(before) {
  const sentence = before.slice(lastEnd(before, SENTENCE_END));
  const flat = sentence.replace(/\([^()]*\)/g, ' ').replace(/,[^,]{1,40},/g, ' ');
  const words = flat
    .slice(lastEnd(flat, CLAUSE_START))
    .replace(/\brather than\b/gi, 'rather_than')
    .replace(/\binstead of\b/gi, 'instead_of')
    .match(/[\w'’-]+/g);
  return (words ?? []).slice(-NEGATION_WINDOW).some((w) => NEGATOR.test(w));
}

// The other form puts the negation after the match, as its predicate:
// "skipping RLS for self-hosted is not an option / is out of scope / was
// rejected". At most two plain words may sit between ("... mode is not");
// a conjunction, relative pronoun or punctuation there means the negation
// belongs to another clause ("skips RLS when the org is not set").
const NEGATED_PREDICATE =
  /^\s+(?:(?!(?:and|but|so|because|since|when|if|while|which|that|who|where|unless|until)\b)[\w`'-]+\s+){0,2}(?:is|are|was|were|would be|remains?)\s+(?:(?:explicitly|also|therefore|simply|clearly)\s+)?(?:not\b|never\b|out of scope\b|rejected\b|ruled out\b|forbidden\b|disallowed\b|unacceptable\b|off the table\b)/i;

function lastEnd(text, re) {
  let end = 0;
  for (const m of text.matchAll(re)) {
    end = m.index + m[0].length;
  }
  return end;
}

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
  const firstSection = lines.findIndex((l) => /^## /.test(l));
  return {
    main,
    mainLines: main.split('\n').length,
    // Title, status and the "> **Decision:**" summary, before the first "## ".
    preamble: (firstSection < 0 ? lines : lines.slice(0, firstSection)).join('\n'),
    sections: new Map([...sections].map(([k, v]) => [k, v.join('\n')])),
  };
}

const anyMatch = (text, patterns) => patterns.some((p) => new RegExp(p, 'i').test(text));

// True when some match of a pattern is not negated within its clause. Every
// start position is tried: in "never a persisted value; persisting it is
// deferred" the negated first match must not swallow the affirmed second one.
export function anyAffirmed(text, patterns) {
  return patterns.some((p) => {
    const re = new RegExp(p, 'gi');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 120);
      if (!negatedBefore(text.slice(0, m.index)) && !NEGATED_PREDICATE.test(after)) {
        return true;
      }
      re.lastIndex = m.index + 1;
    }
    return false;
  });
}

// Body of the first heading (any level) whose title contains `name`, up to the
// next heading of the same or a higher level.
function headingBlock(text, name) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const h = l.match(/^(#{2,4})\s+(.*)$/);
    return h && h[2].toLowerCase().includes(name);
  });
  if (start < 0) {
    return '';
  }
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex(
    (l, i) => i > start && /^#+\s/.test(l) && l.match(/^#+/)[0].length <= level
  );
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

function listRepoFiles(repoDir) {
  try {
    return execFileSync('git', ['-C', repoDir, 'ls-files'], { encoding: 'utf8' }).split('\n');
  } catch {
    return [];
  }
}

const lineCount = (text) =>
  text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

// path:line references that resolve (by path suffix) to exactly one tracked file
// that exists and is long enough. A suffix matching several files cannot be
// verified, so it counts as bad ("ambiguous").
export function checkFileRefs(text, repoDir, files = listRepoFiles(repoDir)) {
  const refs = [...new Set(text.match(/[\w./-]+\.(?:ts|tsx|sql|ya?ml|mjs|js|json|md):\d+/g) ?? [])];
  const bad = [];
  for (const ref of refs) {
    const i = ref.lastIndexOf(':');
    const path = ref.slice(0, i).replace(/^\.?\//, '');
    const line = Number(ref.slice(i + 1));
    let hits = files.filter((f) => f && (f === path || f.endsWith(`/${path}`)));
    // "client.ts:603" after "packages/backend/src/db/client.ts:125": the
    // short name means the file the ADR cites in full.
    if (hits.length > 1) {
      const cited = hits.filter((h) => text.includes(h));
      if (cited.length === 1) {
        hits = cited;
      }
    }
    if (hits.length > 1) {
      bad.push(`${ref} (ambiguous)`);
      continue;
    }
    const file = hits[0] && join(repoDir, hits[0]);
    // git ls-files still lists a file deleted from the working tree.
    const lines =
      file && existsSync(file) && statSync(file).isFile()
        ? lineCount(readFileSync(file, 'utf8'))
        : 0;
    if (!lines || line < 1 || line > lines) {
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
  const { main, mainLines, preamble, sections } = splitAdr(text);
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
  add('no-meta-notes', 'structure', !META_NOTES.some((re) => re.test(main)));
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

  // What the ADR decides: the preamble (with the decision summary) and every
  // section except Alternatives, where rejected options are described, and the
  // appendices. Required facts must appear here, and forbidden statements
  // must not (unless negated). The title and the "- Refs:"-style metadata
  // lines are left out: they repeat the issue and spec titles ("show match
  // score + threshold"), so they would satisfy a fact the ADR never states.
  const decided = [
    preamble
      .split('\n')
      .filter((l) => !/^# |^- [\w ]+:/.test(l))
      .join('\n'),
    ...[...sections]
      .filter(([title]) => !title.startsWith('alternatives') && !title.startsWith('appendix'))
      .map(([, body]) => body),
  ].join('\n');
  // A required fact must be affirmed ("we do not use a nonce" is not the
  // nonce check). One that is itself a prohibition ("cross-tenant linking is
  // rejected") carries `prohibition: true` and is matched as written.
  for (const r of def.required ?? []) {
    const found = r.prohibition ? anyMatch(decided, r.any) : anyAffirmed(decided, r.any);
    add(r.id, 'required', found, r.note ?? '');
  }
  for (const f of def.forbidden ?? []) {
    add(f.id, 'forbidden', !anyAffirmed(decided, f.any), f.note ?? '');
  }

  if (def.testingStrategy) {
    // Any heading naming it: "## Testing strategy", "## Appendix B: Testing strategy".
    const ts = headingBlock(text, 'testing strategy');
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
