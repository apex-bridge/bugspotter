// Picks the parts of a spec (docs/specs/TEMPLATE.md shape) that an ADR needs:
// the header lines, Problem, Out of scope, Constraints, Acceptance criteria and,
// from Changes, only the subsection for the ADR file itself. Tests, Verification
// and other files' changes are dropped to keep the model's thinking, and so
// its run time, down (#458).
//
// Headings inside ``` fences (e.g. an ADR outline in the spec) are content, not
// sections. Returns null when the spec has none of the expected sections, so
// the caller can fall back to the full text.

import { fenceTracker } from './markdown-fence.mjs';

const KEEP = new Set(['problem', 'out of scope', 'constraints', 'acceptance criteria']);

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
  let current = '';
  const changesTitles = [];
  for (const b of all) {
    if (b.level === 2) {
      current = b.title.toLowerCase();
    } else if (b.level === 3 && current === 'changes') {
      changesTitles.push(b.title);
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
  let found = false;
  let changesHeading = false;
  for (const b of all) {
    if (b.level === 0) {
      kept.push(b.lines.join('\n'));
      continue;
    }
    if (b.level === 2) {
      section = b.title.toLowerCase();
      if (KEEP.has(section)) {
        found = true;
        kept.push(b.lines.join('\n'));
      }
      continue;
    }
    if (section === 'changes' && isAdrSubsection(b.title)) {
      kept.push(
        changesHeading ? b.lines.join('\n') : `## Changes (ADR file only)\n${b.lines.join('\n')}`
      );
      changesHeading = true;
    } else if (KEEP.has(section)) {
      kept.push(b.lines.join('\n'));
    }
  }
  return found ? kept.join('\n').trim() : null;
}
