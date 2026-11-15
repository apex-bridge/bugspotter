// Picks the parts of a spec (docs/specs/TEMPLATE.md shape) that an ADR needs:
// the header lines, Problem, Out of scope, Constraints, Acceptance criteria and,
// from Changes, only the subsection for the ADR file itself. Tests, Verification
// and other files' changes are dropped: with the whole spec, generate-adr's
// model thought past its 420s timeout in 2 of 3 runs on #451 (#458).
//
// Headings inside ``` fences (e.g. an ADR outline in the spec) are content, not
// sections. Returns null when the spec has none of the expected sections, so
// the caller can fall back to the full text.

const KEEP = new Set(['problem', 'out of scope', 'constraints', 'acceptance criteria']);

// Split into blocks at "## " (and "### ") headings that are outside code fences.
function blocks(spec) {
  const out = [{ level: 0, title: '', lines: [] }];
  let fence = null;
  for (const line of spec.split(/\r?\n/)) {
    const f = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (f) {
      if (!fence) {
        fence = f[1];
      } else if (f[1][0] === fence[0] && f[1].length >= fence.length && /^[ \t]*$/.test(f[2])) {
        // CommonMark: a closing fence has only spaces or tabs after its marker.
        fence = null;
      }
    }
    const h = !fence && !f && line.match(/^(#{2,3})\s+(.*)$/);
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
 * @returns {string|null}
 */
export function specForAdr(spec, adrPath) {
  const kept = [];
  let section = '';
  let found = false;
  for (const b of blocks(spec)) {
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
    // The ADR's own subsection: named by the spec's path, or any numbered docs/adr/NNNN- heading
    // (a spec may write "ADR: pending" and name the eventual file only here).
    if (
      section === 'changes' &&
      ((adrPath && b.title.includes(adrPath)) || /docs\/adr\/\d{4}-/.test(b.title))
    ) {
      kept.push(`## Changes (ADR file only)\n${b.lines.join('\n')}`);
    } else if (KEEP.has(section)) {
      kept.push(b.lines.join('\n'));
    }
  }
  return found ? kept.join('\n').trim() : null;
}
