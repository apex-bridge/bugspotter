#!/usr/bin/env node
// Blocks a PR from being mergeable until every OTHER pull request it needs
// has actually merged - not "declared as a dependency in prose someone can
// skim past", structurally checked on the PR content itself.
//
// Two real incidents motivated this:
//   - PR #399 (impl for #395) was branched from PR #398's branch (impl for
//     #394, #395's own declared blocking prerequisite) before #398 merged.
//     Nothing stopped the stack from being reviewed/merged out of order; it
//     needed a manual cherry-pick cleanup after the fact.
//   - The SSO admin-UI split (#355 -> #406/#407/#408/#409/#414) has three
//     live cross-PR dependencies at once (#410 needs #415, #412 needs #410,
//     #413 needs #411) that a human merging in the wrong order could break
//     silently - nothing but a prose note in each issue says so today.
//
// Why issue-closed state is NOT the signal: issues in this repo do not close
// when their work merges (the house convention is "Refs #NNN", not "Closes
// #NNN" - see check-pr-link.mjs's warnOnClosingKeyword, added for exactly
// this reason) and are deliberately left open forever even once shipped -
// #352, #354, #367, #368, #394, #395 are all merged-and-deployed and still
// OPEN. The only real signal is: does a MERGED pull request exist that
// references the prerequisite issue via one of the keywords check-pr-link.mjs
// already treats as a qualifying reference?
//
// ---------------------------------------------------------------------------
// Real prerequisite-declaration phrasings (grepped across docs/specs/*.md and
// issue bodies #367/#368/#394/#395/#406-#409/#414 - not invented):
//
//   1. Issue or PR body, one free-prose line, no fixed markdown shape:
//        "Blocking prerequisites: #NNN (reason)."      (older - #367, #368)
//        "Depends on #NNN (reason)."                    (no colon - #394, #395)
//        "Depends on: #NNN (reason)."                   (with colon - #406-409, #414)
//        "Depends on #NNN (...) and #MMM (...)."        (multi-prerequisite - #395)
//        "Depends on: nothing - ..."                    (explicit no-dependency)
//      PR bodies sometimes restate the SAME declaration the linked issue
//      carries (PR #412, #413 both do) - not guaranteed, so this script reads
//      the PR body, the linked issue body, AND any spec doc the PR touches,
//      and unions whatever each one declares, rather than trusting one source.
//
//   2. Spec doc header field (docs/specs/TEMPLATE.md's own documented
//      convention): "**Blocking prerequisites:** #NNN - reason, or 'none'."
//      either inline on the label's own line, or - when a slice has several
//      independent prerequisites/notes - as a bulleted list under a bare
//      "**Blocking prerequisites:**" label line with nothing else on it (see
//      docs/specs/0367, docs/specs/0407).
//
// Both label words ("Blocking prerequisites" / "Depends on"), with or without
// the bold markdown and/or the colon, are accepted - real content mixes all
// four combinations and there is no value in picking one as "correct".
//
// Two exclusion rules extractPrerequisiteNumbers applies were both found by
// running this against PR #413's and #412's OWN real bodies, not invented:
// a naive "every #NNN on the declaration line" reading would have wrongly
// required PR #413 to also wait on #411/#406/#408, and PR #412 to also wait
// on #410/#407/#409, because both PRs' own prose mentions those numbers in
// the same sentence for context ("do not merge before #411 (#407's spec)
// lands", "Independent of #406/#408 (the login half of this feature)")
// without either one being an actual second dependency. See that function's
// own header for the two shapes and why each is excluded.
//
// ---------------------------------------------------------------------------
// Known limitation, found (not theorized) while validating this against the
// real open SSO PRs: an issue that was split into narrower child issues
// BEFORE its own spec PR ever merged (its spec PR was closed, not merged,
// once the split happened) never gets a qualifying keyword-reference from
// any merged PR of its own - the split children reference EACH OTHER, not
// the original epic number. #354 is the confirmed real instance: its combined
// spec PR (#392) was closed in favor of the #394/#395 split, both of which
// merged and reference #394/#395 respectively, but neither references "#354"
// with a qualifying keyword anywhere. docs/specs/0407-sso-4c-sso-config-data-
// layer.md still lists #354 as a "Blocking prerequisite" (annotated inline
// "already merged"), so this check currently reports #354 as unresolved for
// PR #411 - a false positive on an epic that split before merging, not a bug
// in the extraction. Filed as a known follow-up in the tracking issue rather
// than papered over with unverified "was this issue superseded" heuristics.
//
// ---------------------------------------------------------------------------
// Usage: PR_NUMBER=<n> [REPO=owner/repo] node scripts/ai-sdlc/check-prerequisites-merged.mjs
//   (REPO defaults to $GITHUB_REPOSITORY, then 'apex-bridge/bugspotter'.)
// Also accepts `--pr <n>` for manual/ad-hoc runs.
// Requires `gh` on PATH, authenticated with read access to the repo (issues,
// pull-requests, contents). Exits 1 (::error::) on any unresolved declared
// prerequisite OR on an infrastructure failure reading a source this check
// needs (fail-closed - a check that no-ops on a read it can't make isn't a
// gate, it's a trap door, same reasoning check-spec-scope.mjs's header
// states for the identical choice). Exits 0 when no prerequisites are
// declared, when none is (no line required - most PRs have none), or when
// every declared prerequisite already has a merged referencing PR.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Issue-reference matching - mirrors check-pr-link.mjs's own REFERENCE
// pattern and keyword list (Closes/Refs/Fixes/Tracks/Resolves/References,
// case-insensitive, optional "owner/repo#NNN" cross-repo prefix, letter-
// bounded lookarounds rather than \b for the same Cyrillic/underscore
// reasons documented there) exactly, matched one line at a time for the same
// reason check-pr-link.mjs's hasReference() does: \s+ must not be allowed to
// span a line break and match a keyword against a #NNN on the FOLLOWING
// line.
//
// Duplicated rather than imported: check-pr-link.mjs calls its main()
// unconditionally at module load, with no `import.meta.url === ...` guard
// (deliberately - see its own header: it is a Tier-1 required check and the
// guard did not want an importability refactor risking the one failure mode
// that matters there, a wrong guard meaning main() never runs and every PR
// passes silently). Importing it here would run its CLI and process.exit()
// as a side effect of loading this module. Keep this pattern in sync with
// check-pr-link.mjs's REFERENCE by hand if that one ever changes.
const ISSUE_KEYWORD_REF =
  /(?<!\p{L})(?:Closes|Refs|Fixes|Tracks|Resolves|References)\s+((?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?)#([0-9]+)(?![0-9\p{L}])/giu;

/** Every same-repo issue number a keyword reference in `text` points at, in first-seen order, deduped. Cross-repo ("owner/repo#NNN") references are excluded - a prerequisite in another repo can't be resolved against this repo's PR list. Scans every match on a line (not just the first), so a line carrying two references (or a cross-repo reference followed by a same-repo one) doesn't lose anything after the first match. */
export function extractKeywordReferencedIssues(text) {
  const found = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    for (const [, crossRepoPrefix, num] of line.matchAll(ISSUE_KEYWORD_REF)) {
      if (crossRepoPrefix) {
        continue;
      }
      const n = Number(num);
      if (!found.includes(n)) {
        found.push(n);
      }
    }
  }
  return found;
}

/** Does `text` carry a qualifying keyword-reference to issue `issueNumber`? */
export function referencesIssue(text, issueNumber) {
  return extractKeywordReferencedIssues(text).includes(issueNumber);
}

// ---------------------------------------------------------------------------
// Resolving which issue a PR is "about". This repo's PR titles consistently
// carry it directly ("spec(#406): ...", "impl(#394): ...", "adr(#354): ..."),
// which is both simpler and more reliable than picking "the first keyword
// reference in the body" - a spec PR's body routinely mentions several other
// issue numbers in the same paragraph (sibling slices, prior splits) before
// its own "Refs #NNN" line. The title is only a fallback source when that
// convention isn't followed.
const TITLE_ISSUE = /^(?:spec|impl|adr)\(#(\d+)\)/i;

export function resolvePrimaryIssue(prTitle, prBody) {
  const titleMatch = prTitle?.match(TITLE_ISSUE);
  if (titleMatch) {
    return Number(titleMatch[1]);
  }
  const refs = extractKeywordReferencedIssues(prBody ?? '');
  return refs.length ? refs[0] : null;
}

// ---------------------------------------------------------------------------
// Extracting declared prerequisites.

// The two `[*_]{0,2}` groups bracket the colon deliberately, not redundantly:
// real markdown closes the bold *after* the colon ("**Blocking prerequisites:**"),
// so a single group placed only before the colon leaves a stray "**" at the
// start of the captured remainder (and, worse, a bare "**Blocking
// prerequisites:**" bulleted-block header - see docs/specs/0367 - captures
// "**" as truthy "inline text" instead of empty, silently skipping the
// bulleted scan and losing every prerequisite in the block).
const LABEL_LINE =
  /^[*_]{0,2}(?:Blocking prerequisites|Depends on)[*_]{0,2}:?[*_]{0,2}[ \t]*(.*)$/i;

function isFieldOrHeadingLine(line) {
  return line.startsWith('**') || line.startsWith('##');
}

/**
 * The prerequisite clauses following a "Blocking prerequisites:"/"Depends
 * on:" label, wherever `text` carries one, as an ARRAY - one entry for the
 * single-line inline form (a free-prose paragraph), or one entry PER BULLET
 * for the spec doc's bulleted-list form (docs/specs/0367, docs/specs/0407),
 * which puts nothing on the label's own line and lists prerequisites/notes
 * as "- " bullets below it instead. Kept as separate entries (not joined
 * into one string) rather than one - see extractPrerequisiteNumbers' header
 * for why that separation is what makes it possible to tell "this is a new
 * declared prerequisite" from "this is mid-explanation prose that happens to
 * mention a number".
 *
 * When the label line's own remainder is empty, the bulleted block is
 * collected the same way extractDeclaredPaths' own block-scan works in
 * verify-spec-ownership.mjs (a blank line before the list is fine; a blank
 * line after it, or the next "**"/"##" field/heading, ends it). Returns null
 * when `text` has no such label at all.
 */
export function extractPrerequisiteBlock(text) {
  const lines = (text ?? '').split(/\r?\n/);
  const idx = lines.findIndex((l) => LABEL_LINE.test(l.trim()));
  if (idx === -1) {
    return null;
  }

  const inline = lines[idx].trim().match(LABEL_LINE)[1].trim();
  if (inline !== '') {
    return [inline];
  }

  const collected = [];
  let sawBullet = false;
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isFieldOrHeadingLine(line)) {
      break;
    }
    if (line === '') {
      if (sawBullet) {
        break;
      }
      continue;
    }
    if (!line.startsWith('- ') && !line.startsWith('* ')) {
      if (sawBullet) {
        break;
      }
      continue;
    }
    collected.push(line.replace(/^[-*]\s+/, ''));
    sawBullet = true;
  }
  return collected.length ? collected : null;
}

// A PR number standing in for "the PR that delivers issue #M", parenthesized
// right after another issue reference - e.g. "#411 (#407's spec)" in PR
// #413's own body, "#410 (#406's spec)" in PR #412's own body. Stripped as a
// whole span so neither number in it is miscounted as a second, independent
// dependency: the outer number is a PR, not an issue, and the inner one was
// already captured (if it's a real prerequisite) from its own earlier
// mention in the same clause.
const PR_BACKREFERENCE = /#\d+\s*\(#\d+(?:['’]s)?\s*(?:spec|pr|implementation)\)/gi;

// An explicit disclaimer that the numbers in THIS sentence are not a
// dependency - "Independent of #406/#408 (the login half of this feature)."
// (PR #413's own body) and "#354's server-side enforce_sso gating is already
// merged and unaffected by this dependency." (docs/specs/0406's own real
// text) are both real, found sentences whose whole point is "this number
// does not block". A sentence matching this is skipped entirely (not just
// truncated from the phrase onward), because in the #354 case the disclaimed
// number is the SENTENCE'S OWN SUBJECT, appearing *before* the phrase that
// disclaims it.
const DISCLAIMER = /\b(?:independent of|unaffected by this dependency)\b/i;

const LEAD_NUMBER = /^#([0-9]+)\b/;
// "#394 (...) and #352 (...)." (issue #395's real phrasing) - a second
// prerequisite joined to the first within the same sentence/bullet.
const AND_JOIN = /\band\s+#([0-9]+)\b/gi;

/**
 * Issue numbers a "Blocking prerequisites"/"Depends on" block actually
 * declares as blocking, given its clauses (extractPrerequisiteBlock's
 * return value - a bare string is also accepted and treated as a single
 * clause, for convenience when a caller already has one).
 *
 * A naive "every #NNN anywhere in the block" reading breaks on real content
 * in both directions, both found by running this against currently-open PRs
 * rather than invented:
 *   - PR #413's own body ("...do not merge before #411 (#407's spec) lands
 *     ... Independent of #406/#408 (the login half of this feature).") would
 *     wrongly add #411, #406, #408 to #407's own real, single declared
 *     dependency.
 *   - docs/specs/0406's own real "Blocking prerequisites" field ("#414 - ...
 *     it has been split out into its own small, standalone issue (#414, PR
 *     #415) that this slice depends on instead. #354's server-side
 *     enforce_sso gating is already merged and unaffected by this
 *     dependency.") would wrongly add #415 and #354 to #406's own real,
 *     single declared dependency (#414).
 *
 * The fix isn't a truncation point (a fixed cutoff - e.g. "stop at the first
 * dash" - breaks #395's own two-prerequisite spec-doc line, "#394 - ... #352
 * - ..."). Instead, each clause is split into ". "-delimited sentences, and
 * only two shapes count as a declared number: one leading its own sentence
 * (or bullet - each bullet is its own clause, see extractPrerequisiteBlock),
 * and one joined to a leading one via "and #NNN" in the same sentence (the
 * #395 issue-body shape, "#394 (...) and #352 (...)."). A parenthetical PR
 * back-reference ("#411 (#407's spec)") is stripped before sentence-
 * splitting so it never becomes a false "and #NNN" join either. Any sentence
 * containing a DISCLAIMER phrase contributes nothing at all, lead or joined.
 *
 * Returns a deduped, ascending list; [] when the block declares none. This
 * never special-cases the literal words "none"/"nothing" - a block with zero
 * "#NNN" tokens in it means zero prerequisites either way, which is the same
 * "none" docs/specs/TEMPLATE.md documents, so no separate detection is
 * needed for it.
 */
export function extractPrerequisiteNumbers(clauses) {
  if (!clauses) {
    return [];
  }
  const list = Array.isArray(clauses) ? clauses : [clauses];
  const numbers = new Set();
  for (const rawClause of list) {
    const stripped = rawClause.replace(PR_BACKREFERENCE, '');
    for (const sentence of stripped.split(/\.\s+/)) {
      const trimmed = sentence.trim();
      if (!trimmed || DISCLAIMER.test(trimmed)) {
        continue;
      }
      const lead = trimmed.match(LEAD_NUMBER);
      if (lead) {
        numbers.add(Number(lead[1]));
      }
      for (const m of trimmed.matchAll(AND_JOIN)) {
        numbers.add(Number(m[1]));
      }
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * Every prerequisite issue number declared across one or more source texts
 * (PR body, linked issue body, any spec doc the PR touches - whichever of
 * them actually carries the label; real PRs are inconsistent about which
 * source has it, see the file header). Deduped and sorted; union rather than
 * "first source wins", so a prerequisite declared in only one source is
 * never missed.
 */
export function extractDeclaredPrerequisites(texts) {
  const all = new Set();
  for (const text of texts) {
    for (const n of extractPrerequisiteNumbers(extractPrerequisiteBlock(text))) {
      all.add(n);
    }
  }
  return [...all].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Deciding whether one declared prerequisite is resolved, given an already-
// fetched candidate list (pure - the candidate list itself is I/O, fetched
// in main() via `gh pr list --search`).

/**
 * @param {number} issueNumber
 * @param {{number: number, state: string, body: string|null}[]} candidatePrs
 * @returns {{resolved: boolean, resolvingPr: number|null, referencing: object[]}}
 */
export function findResolvingPr(issueNumber, candidatePrs) {
  const referencing = candidatePrs.filter((pr) => referencesIssue(pr.body ?? '', issueNumber));
  const merged = referencing.find((pr) => pr.state === 'MERGED');
  return { resolved: Boolean(merged), resolvingPr: merged?.number ?? null, referencing };
}

/**
 * Full pure evaluation for one PR: resolve its linked issue, extract its
 * declared prerequisites from whichever sources are supplied, and check each
 * one against `lookupCandidates(issueNumber) -> candidatePrs[]` (injected so
 * this is testable without touching the network - main() supplies a real
 * `gh`-backed one).
 */
export function evaluatePrerequisites({
  prTitle,
  prBody,
  issueBody,
  specTexts = [],
  lookupCandidates,
}) {
  const issueNumber = resolvePrimaryIssue(prTitle, prBody);
  if (issueNumber === null) {
    // Not this check's job - check-pr-link.mjs already requires every PR to
    // reference an issue or ADR. If that hasn't run yet or was bypassed,
    // failing here with a different message would just be confusing, not
    // additionally protective.
    return {
      issueNumber: null,
      prerequisites: [],
      results: [],
      passed: true,
      skipReason: 'no resolvable linked issue',
    };
  }

  const prerequisites = extractDeclaredPrerequisites([prBody ?? '', issueBody ?? '', ...specTexts]);
  if (prerequisites.length === 0) {
    return { issueNumber, prerequisites: [], results: [], passed: true, skipReason: null };
  }

  const results = prerequisites.map((issueNum) => {
    const candidates = lookupCandidates(issueNum) ?? [];
    const { resolved, resolvingPr, referencing } = findResolvingPr(issueNum, candidates);
    return { issueNumber: issueNum, resolved, resolvingPr, referencingCount: referencing.length };
  });

  return {
    issueNumber,
    prerequisites,
    results,
    passed: results.every((r) => r.resolved),
    skipReason: null,
  };
}

export function buildUnresolvedMessage(prNumber, issueNumber, referencingCount) {
  const seen =
    referencingCount > 0
      ? `${referencingCount} PR(s) reference it, but none has merged yet`
      : 'no PR referencing it (via Closes/Refs/Fixes/Tracks/Resolves/References) has been opened yet';
  return (
    `PR #${prNumber} declares issue #${issueNumber} as a blocking prerequisite, but it is not ` +
    `resolved: ${seen}. Issues in this repo do not close on merge (Refs, not Closes, is the ` +
    `house convention) and are deliberately left open forever even once shipped, so issue state ` +
    `cannot be the signal here - only a merged, referencing PR can. Merge the PR that delivers ` +
    `#${issueNumber} first, then re-run this check (push a new commit, or re-request review) ` +
    'once it has merged.'
  );
}

// ---------------------------------------------------------------------------
// I/O - the only part of this file that touches the network. Thin on
// purpose: every decision above is made by the pure functions.

function sh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

function ghJson(args) {
  return JSON.parse(sh(args));
}

function resolveRepo() {
  return process.env.REPO || process.env.GITHUB_REPOSITORY || 'apex-bridge/bugspotter';
}

function fetchPr(repo, prNumber) {
  return ghJson([
    'pr',
    'view',
    String(prNumber),
    '--repo',
    repo,
    '--json',
    'number,title,body,headRefOid,files',
  ]);
}

function fetchIssueBody(repo, issueNumber) {
  return (
    ghJson(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'body']).body ?? ''
  );
}

function fetchSpecFileContent(repo, path, ref) {
  const b64 = sh(['api', `repos/${repo}/contents/${path}?ref=${ref}`, '-q', '.content']);
  return Buffer.from(b64, 'base64').toString('utf8');
}

// GitHub's Search API hard-caps any single query at 1000 results (10 pages
// of 100), no matter how high a limit is requested - `gh` paginates
// automatically up to whatever cap it's given. 1000 is passed here (not a
// smaller number like the previous 50) because a low cap silently drops
// real candidates once a heavily cross-referenced issue number accumulates
// enough merged-PR body mentions to fill it - confirmed against this repo's
// own history: a same-digit search for "1 in:body" already returns 83
// merged PRs today, well past 50, even though no currently declared
// prerequisite number is that collision-prone yet.
const GH_SEARCH_RESULT_CAP = 1000;

function searchPrsByBodyNumber(repo, issueNumber, state, limit) {
  const rows = ghJson([
    'pr',
    'list',
    '--repo',
    repo,
    '--search',
    `${issueNumber} in:body`,
    '--state',
    state,
    '--json',
    'number,state,body',
    '--limit',
    String(limit),
  ]);
  return rows.map((r) => ({ number: r.number, state: r.state, body: r.body ?? '' }));
}

/**
 * Broad-then-narrow: GitHub's numeric search is a candidate filter, not the
 * source of truth - it matches "#407" appearing ANYWHERE in a PR body,
 * including prose that merely mentions the number (see PR #410's body, which
 * mentions #407/#408/#409 as sibling slices with no keyword attached, and
 * would otherwise false-positive as "referencing" every one of them). The
 * real decision is findResolvingPr's local, keyword-anchored regex over
 * these candidates' bodies - this only narrows which PRs are worth fetching.
 *
 * Queried as two separate searches, not one `--state all` search: the
 * all-state search result is capped at `--limit`, and unrelated open/closed
 * PRs that merely mention the number can fill that cap before the one
 * merged, actually-resolving PR is reached, making a genuinely resolved
 * prerequisite look unresolved. The merged-only search can't be crowded out
 * by non-merged noise, so it is the one findResolvingPr's resolution check
 * relies on; the all-state search still runs (and is merged into the
 * result) purely so buildUnresolvedMessage's "N PR(s) reference it" count
 * stays representative of open/closed referencing PRs too.
 */
function findCandidatePrsViaGh(repo, issueNumber) {
  const merged = searchPrsByBodyNumber(repo, issueNumber, 'merged', GH_SEARCH_RESULT_CAP);
  const all = searchPrsByBodyNumber(repo, issueNumber, 'all', GH_SEARCH_RESULT_CAP);
  const byNumber = new Map();
  for (const pr of [...merged, ...all]) {
    byNumber.set(pr.number, pr);
  }
  return [...byNumber.values()];
}

function parsePrNumberArg() {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf('--pr');
  if (flagIdx !== -1 && args[flagIdx + 1]) {
    return args[flagIdx + 1];
  }
  return process.env.PR_NUMBER;
}

function main() {
  const prNumber = parsePrNumberArg();
  if (!prNumber) {
    console.error('Usage: PR_NUMBER=<n> node scripts/ai-sdlc/check-prerequisites-merged.mjs');
    console.error('       node scripts/ai-sdlc/check-prerequisites-merged.mjs --pr <n>');
    process.exit(2);
  }
  const repo = resolveRepo();

  let pr;
  try {
    pr = fetchPr(repo, prNumber);
  } catch (err) {
    console.error(
      `::error::Prerequisite-merge check could not fetch PR #${prNumber} from ${repo}: ${err.message}`
    );
    process.exit(1);
  }

  const issueNumberProbe = resolvePrimaryIssue(pr.title, pr.body);
  let issueBody = '';
  if (issueNumberProbe !== null) {
    try {
      issueBody = fetchIssueBody(repo, issueNumberProbe);
    } catch (err) {
      // Fail closed: a gate that no-ops on a read it can't make isn't a
      // gate. See check-spec-scope.mjs's header for the identical reasoning.
      console.error(
        `::error::Prerequisite-merge check could not read issue #${issueNumberProbe} ` +
          `(linked from PR #${prNumber}): ${err.message}. Failing closed rather than silently skipping.`
      );
      process.exit(1);
    }
  }

  const specPaths = (pr.files ?? [])
    // Deleted spec files don't exist at pr.headRefOid, so fetching their
    // content 404s - that's an expected deletion, not an infra failure the
    // fail-closed read below should trip on. Only added/modified/renamed
    // paths can actually be read at the head commit.
    .filter((f) => f.changeType !== 'DELETED')
    .map((f) => f.path)
    .filter((p) => p.startsWith('docs/specs/') && p.endsWith('.md'));
  const specTexts = [];
  for (const specPath of specPaths) {
    try {
      specTexts.push(fetchSpecFileContent(repo, specPath, pr.headRefOid));
    } catch (err) {
      // Fail closed: same reasoning as the issue-body read above. A spec doc
      // the PR touches is a source this check needs (it may be the only
      // place a prerequisite is declared - see the file header), so a read
      // failure here must not silently drop it and pass anyway.
      console.error(
        `::error::Prerequisite-merge check could not read ${specPath} at ${pr.headRefOid} ` +
          `(touched by PR #${prNumber}): ${err.message}. Failing closed rather than silently skipping.`
      );
      process.exit(1);
    }
  }

  let searchFailure = null;
  const lookupCandidates = (issueNumber) => {
    try {
      return findCandidatePrsViaGh(repo, issueNumber);
    } catch (err) {
      searchFailure = { issueNumber, message: err.message };
      return [];
    }
  };

  const evaluation = evaluatePrerequisites({
    prTitle: pr.title,
    prBody: pr.body,
    issueBody,
    specTexts,
    lookupCandidates,
  });

  if (searchFailure) {
    console.error(
      `::error::Prerequisite-merge check could not search for PRs referencing #${searchFailure.issueNumber}: ${searchFailure.message}`
    );
    process.exit(1);
  }

  if (evaluation.issueNumber === null) {
    console.log(
      `Prerequisite-merge check: PR #${prNumber} has no resolvable linked issue - that's ` +
        "check-pr-link.mjs's job, not this check's. Nothing to verify; passing."
    );
    process.exit(0);
  }

  if (evaluation.prerequisites.length === 0) {
    console.log(
      `Prerequisite-merge check: PR #${prNumber} (issue #${evaluation.issueNumber}) declares no prerequisites. Passing.`
    );
    process.exit(0);
  }

  console.log(
    `Prerequisite-merge check: PR #${prNumber} (issue #${evaluation.issueNumber}) declares ` +
      `${evaluation.prerequisites.length} prerequisite issue(s): ${evaluation.prerequisites.map((n) => `#${n}`).join(', ')}.`
  );
  for (const r of evaluation.results) {
    console.log(
      r.resolved
        ? `  #${r.issueNumber}: resolved (merged PR #${r.resolvingPr}).`
        : `  #${r.issueNumber}: NOT resolved (${r.referencingCount} referencing PR(s) found, none merged).`
    );
  }

  if (!evaluation.passed) {
    console.error('');
    console.error(
      `::error::Prerequisite-merge check FAILED for PR #${prNumber} (issue #${evaluation.issueNumber}).`
    );
    for (const r of evaluation.results.filter((x) => !x.resolved)) {
      console.error(buildUnresolvedMessage(prNumber, r.issueNumber, r.referencingCount));
    }
    process.exit(1);
  }

  console.log(
    `Prerequisite-merge check passed: all ${evaluation.prerequisites.length} declared prerequisite(s) have a merged referencing PR.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
