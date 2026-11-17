// Picks the parts of a spec (docs/specs/TEMPLATE.md shape) that an ADR needs:
// the header lines, Problem, Out of scope, Constraints, Acceptance criteria and,
// from Changes, only the subsection for the ADR file itself. Tests, Verification
// and other files' changes are dropped to keep the model's thinking, and so
// its run time, down (#458).
//
// Headings inside ``` fences (e.g. an ADR outline in the spec) are content, not
// sections. Returns null unless the spec has both a Problem and a Constraints
// section, so the caller sends the full text instead of a part that lost them
// (an older spec says "Problem / motivation" and "Scope and constraints"), and
// also when Changes names the new ADR file but no subsection for it was kept,
// so an outline written another way is not lost.

import { fenceTracker } from './markdown-fence.mjs';

// Section kinds kept, matched at the start of the heading so "Problem /
// motivation" and "Scope and constraints" count but "Tests (one per
// constraint)", "Non-constraints" and "Problems found ..." do not.
const KEEP = [
  ['problem', (t) => /^problem\b/.test(t)],
  ['constraints', (t) => /^(?:scope and )?constraints?\b/.test(t)],
  ['out of scope', (t) => t.startsWith('out of scope')],
  ['acceptance criteria', (t) => t.startsWith('acceptance criteria')],
];
const keepKind = (title) => KEEP.find(([, match]) => match(title))?.[0] ?? null;
// Lenient like KEEP, so "Changes (per file)" and "Changes:" count.
const isChanges = (title) => title.startsWith('changes');

// Split into blocks at "## " (and "### ") headings that are outside code fences.
function blocks(spec) {
  const out = [{ level: 0, title: '', lines: [] }];
  const inCode = fenceTracker();
  for (const line of spec.split(/\r?\n/)) {
    const h = !inCode(line) && line.match(/^(#{2,3})\s+(.*)$/);
    if (h) {
      out.push({ level: h[1].length, title: h[2].trim(), lines: [line] });
    } else {
      out[out.length - 1].lines.push(line);
    }
  }
  return out;
}

/**
 * @param {string} spec  full spec text
 * @param {string} adrPath  e.g. "docs/adr/0045-postgres-row-level-security.md"
 * @param {{existingAdrs?: string[]}} [opts]  file names already in docs/adr
 * @returns {string|null}  null also when the ADR's subsection is ambiguous
 */
export function specForAdr(spec, adrPath, { existingAdrs = [] } = {}) {
  const all = blocks(spec);
  // Changes subsections, by the level-2 section they sit under.
  // Also: does Changes name the new ADR file anywhere (a heading, a bullet)?
  let current = '';
  const changesTitles = [];
  const newAdr = Boolean(adrPath) && !existingAdrs.some((f) => adrPath === `docs/adr/${f}`);
  let adrNamedInChanges = false;
  for (const b of all) {
    if (b.level === 2) {
      current = b.title.toLowerCase();
    } else if (b.level === 3 && isChanges(current)) {
      changesTitles.push(b.title);
    }
    if (newAdr && isChanges(current) && b.lines.some((l) => l.includes(adrPath))) {
      adrNamedInChanges = true;
    }
  }
  // The ADR's own subsection: the one naming the spec's path. Failing that
  // (a spec may write "ADR: pending" and name the file only here), the one
  // numbered docs/adr/NNNN- heading that is not an existing ADR. Several such
  // headings are ambiguous: return null so the caller sends the full spec
  // rather than guessing.
  const exact = Boolean(adrPath) && changesTitles.some((t) => t.includes(adrPath));
  const isNewNumbered = (t) =>
    /docs\/adr\/\d{4}-/.test(t) && !existingAdrs.some((f) => t.includes(`docs/adr/${f}`));
  if (!exact && changesTitles.filter(isNewNumbered).length > 1) {
    return null;
  }
  const isAdrSubsection = (title) => (exact ? title.includes(adrPath) : isNewNumbered(title));

  const kept = [];
  let section = '';
  const found = new Set();
  let changesHeading = false;
  for (const b of all) {
    if (b.level === 0) {
      kept.push(b.lines.join('\n'));
      continue;
    }
    if (b.level === 2) {
      section = b.title.toLowerCase();
      const kind = keepKind(section);
      if (kind) {
        found.add(kind);
        kept.push(b.lines.join('\n'));
      }
      continue;
    }
    if (isChanges(section) && isAdrSubsection(b.title)) {
      kept.push(
        changesHeading ? b.lines.join('\n') : `## Changes (ADR file only)\n${b.lines.join('\n')}`
      );
      changesHeading = true;
    } else if (keepKind(section)) {
      kept.push(b.lines.join('\n'));
    }
  }
  // The new ADR is named under Changes but none of it was kept: its outline is
  // written some other way, so send the full spec rather than lose it.
  if (adrNamedInChanges && !changesHeading) {
    return null;
  }
  return found.has('problem') && found.has('constraints') ? kept.join('\n').trim() : null;
}
