// Tests for check-prerequisites-merged.mjs's pure logic: extraction of
// declared prerequisites from both real phrasing variants found in this
// repo (see the script's own header), and the merged/unmerged decision via
// an injected candidate lookup (no network - `evaluatePrerequisites` takes
// `lookupCandidates` as a parameter precisely so this file never has to
// shell out to `gh`). Zero-dependency, run with `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractKeywordReferencedIssues,
  referencesIssue,
  resolvePrimaryIssue,
  extractPrerequisiteBlock,
  extractPrerequisiteNumbers,
  extractDeclaredPrerequisites,
  findResolvingPr,
  evaluatePrerequisites,
  buildUnresolvedMessage,
} from './check-prerequisites-merged.mjs';

describe('extractKeywordReferencedIssues / referencesIssue', () => {
  test('finds a plain Refs reference', () => {
    assert.deepEqual(extractKeywordReferencedIssues('Refs #406.'), [406]);
    assert.ok(referencesIssue('Refs #406.', 406));
  });

  test('ignores a bare #NNN with no keyword', () => {
    assert.deepEqual(extractKeywordReferencedIssues('See #406 for context.'), []);
  });

  test('ignores a cross-repo qualified reference', () => {
    assert.deepEqual(
      extractKeywordReferencedIssues('Refs apex-bridge/bugspotter-intelligence#48'),
      []
    );
  });

  test('does not let a keyword on one line match a #NNN on the next', () => {
    assert.deepEqual(extractKeywordReferencedIssues('Refs\n#406'), []);
  });

  test('dedupes repeated references to the same issue', () => {
    assert.deepEqual(extractKeywordReferencedIssues('Refs #367.\nAlso Refs #367 again.'), [367]);
  });

  test('finds every reference on a line with more than one', () => {
    assert.deepEqual(extractKeywordReferencedIssues('Closes #400, Refs #414'), [400, 414]);
  });

  test('a cross-repo reference earlier on the line does not swallow a same-repo one after it', () => {
    assert.deepEqual(
      extractKeywordReferencedIssues('Refs apex-bridge/bugspotter-intelligence#48, Closes #200'),
      [200]
    );
  });
});

describe('resolvePrimaryIssue', () => {
  test('reads the issue number out of the "spec(#NNN):" title convention', () => {
    assert.equal(resolvePrimaryIssue('spec(#406): SSO 4a/4: Login SSO status', 'Refs #999.'), 406);
  });

  test('reads "impl(#NNN):" and "adr(#NNN):" the same way', () => {
    assert.equal(resolvePrimaryIssue('impl(#394): some title', ''), 394);
    assert.equal(resolvePrimaryIssue('adr(#354): some title', ''), 354);
  });

  test('falls back to the first keyword reference in the body when the title has none', () => {
    assert.equal(resolvePrimaryIssue('chore: unrelated', 'Fixes #123 for real.'), 123);
  });

  test('returns null when neither the title nor the body resolves an issue', () => {
    assert.equal(resolvePrimaryIssue('chore: unrelated', 'no reference here'), null);
  });
});

describe('extractPrerequisiteBlock', () => {
  test('returns null when no label is present', () => {
    assert.equal(extractPrerequisiteBlock('Just some unrelated PR body.'), null);
  });

  test('"Blocking prerequisites:" inline (older issue-body phrasing, #367/#368)', () => {
    const body =
      'Blocking prerequisites: #352 (SSO provider config repository/schema - already merged).';
    assert.deepEqual(extractPrerequisiteNumbers(extractPrerequisiteBlock(body)), [352]);
  });

  test('"Depends on" with no colon (#394/#395 phrasing)', () => {
    const body = 'Depends on #352 (already merged) for the oidc_idp_config repository.';
    assert.deepEqual(extractPrerequisiteNumbers(extractPrerequisiteBlock(body)), [352]);
  });

  test('"Depends on:" with a colon (#406-409/#414 phrasing)', () => {
    const body = 'Depends on: #414 (the sso-status endpoint) - blocking prerequisite.';
    assert.deepEqual(extractPrerequisiteNumbers(extractPrerequisiteBlock(body)), [414]);
  });

  test('is case-insensitive and tolerates bold markdown on the label', () => {
    assert.deepEqual(
      extractPrerequisiteNumbers(extractPrerequisiteBlock('**depends on:** #1 - x')),
      [1]
    );
    assert.deepEqual(
      extractPrerequisiteNumbers(extractPrerequisiteBlock('BLOCKING PREREQUISITES: #2 - y')),
      [2]
    );
  });

  test('spec-doc inline form: "**Blocking prerequisites:** #NNN - reason."', () => {
    const spec =
      '**Files touched:**\n\n- `a.ts`\n\n**Blocking prerequisites:** #414 - the endpoint this calls does not exist yet.\n\n## Problem\n';
    assert.deepEqual(extractPrerequisiteNumbers(extractPrerequisiteBlock(spec)), [414]);
  });

  test('spec-doc "none" form yields a block with zero issue numbers', () => {
    assert.deepEqual(
      extractPrerequisiteNumbers(extractPrerequisiteBlock('**Blocking prerequisites:** none.')),
      []
    );
  });

  test('the closing "**" after the colon does not get captured as the inline remainder', () => {
    // Regression: "**Blocking prerequisites:**" alone on its own line (the
    // bulleted-block header form) must resolve to an EMPTY inline remainder
    // so the bulleted scan below it runs - not a truthy "**" that looks like
    // non-empty inline text and skips the bullets entirely.
    const spec = ['**Blocking prerequisites:**', '', '- #1 - reason', ''].join('\n');
    const block = extractPrerequisiteBlock(spec);
    assert.ok(Array.isArray(block));
    assert.deepEqual(extractPrerequisiteNumbers(block), [1]);
  });

  test('spec-doc bulleted-block form (docs/specs/0367, docs/specs/0407 shape)', () => {
    const spec = [
      '**Blocking prerequisites:**',
      '',
      '- #352 - defines the SSO config shape',
      '- #353 - the GET/PUT endpoints this service/hook call must exist',
      '- #354 - those endpoints must already gate to tenant-admin server-side (already merged)',
      '',
      '## Problem',
    ].join('\n');
    const block = extractPrerequisiteBlock(spec);
    assert.deepEqual(extractPrerequisiteNumbers(block), [352, 353, 354]);
  });

  test('bulleted block stops at the next "##" heading, not the whole rest of the doc', () => {
    const spec = [
      '**Blocking prerequisites:**',
      '',
      '- #1 - reason',
      '',
      '## Problem',
      '',
      '- #999 unrelated',
    ].join('\n');
    assert.deepEqual(extractPrerequisiteNumbers(extractPrerequisiteBlock(spec)), [1]);
  });
});

describe('extractPrerequisiteNumbers', () => {
  test('single prerequisite', () => {
    assert.deepEqual(extractPrerequisiteNumbers('#414 - the endpoint does not exist yet.'), [414]);
  });

  test('multi-prerequisite "and" join (#395 real phrasing, label already stripped)', () => {
    const text =
      '#394 (guard + config must exist first) and #352 (already merged, the repository).';
    assert.deepEqual(extractPrerequisiteNumbers(text), [352, 394]);
  });

  test('multi-prerequisite two-sentence form (#395 spec-doc real phrasing)', () => {
    const text =
      '#394 — builds assertSsoNotEnforced/SsoEnforcedError in enforce-sso.ts; must merge and be implemented first. #352 (already merged) — the oidc_idp_config repository the guard reads from.';
    assert.deepEqual(extractPrerequisiteNumbers(text), [352, 394]);
  });

  test('null/empty block yields no prerequisites', () => {
    assert.deepEqual(extractPrerequisiteNumbers(null), []);
    assert.deepEqual(extractPrerequisiteNumbers(''), []);
  });

  test('"nothing"/"none" prose has no #NNN and yields no prerequisites', () => {
    assert.deepEqual(extractPrerequisiteNumbers('nothing - no blocking prerequisites.'), []);
  });

  test('a disclaimed sibling mid-sentence is not counted (not sentence-leading)', () => {
    const text =
      '#407 (creates useSsoConfig()/ssoService) - blocking prerequisite, do not merge before #411 lands.';
    assert.deepEqual(extractPrerequisiteNumbers(text), [407]);
  });

  test('"Independent of #NNN" disclaims that sentence entirely, even the numbers before the phrase', () => {
    const text =
      '#407 (creates useSsoConfig()/ssoService) - blocking prerequisite. Independent of #406/#408 (the login half of this feature).';
    assert.deepEqual(extractPrerequisiteNumbers(text), [407]);
  });

  test('a subject disclaimed by "unaffected by this dependency" is excluded even though it leads its own sentence', () => {
    // Real text from docs/specs/0406-sso-4a-login-sso-status-data-layer.md's
    // own "Blocking prerequisites" field - the bug this regression test
    // guards was found by running the script against the real, live PR
    // #410: a naive "every sentence-leading #NNN counts" rule still wrongly
    // added #354, because #354 IS the grammatical subject of a sentence
    // that explicitly disclaims it, not a new prerequisite declaration.
    const text =
      "#414 — the endpoint this slice's service method calls does not exist yet in the backend. It was split out into its own small, standalone issue (#414, PR #415) that this slice depends on instead. #354's server-side enforce_sso gating is already merged and unaffected by this dependency.";
    assert.deepEqual(extractPrerequisiteNumbers(text), [414]);
  });

  test('a PR number named alongside its issue in one parenthetical is not counted (real docs/specs/0406 shape)', () => {
    // "(#414, PR #415)" - #415 never leads a sentence and is never
    // "and"-joined to one, so it is excluded structurally with no dedicated
    // stripping rule needed for this exact shape.
    const text = 'issue (#414, PR #415) that this slice depends on instead.';
    assert.deepEqual(extractPrerequisiteNumbers(text), []);
  });

  test('strips a "#NNN (#MMM\'s spec)" PR back-reference as a unit (PR #413\'s real body)', () => {
    const text =
      "#407 (creates useSsoConfig()/ssoService) - blocking prerequisite, do not merge before #411 (#407's spec) lands and is implemented. Independent of #406/#408 (the login half of this feature).";
    assert.deepEqual(extractPrerequisiteNumbers(text), [407]);
  });

  test("the same back-reference shape from PR #412's real body", () => {
    const text =
      "#406 (creates authService.getSsoStatus()) - blocking prerequisite, do not merge before #410 (#406's spec) lands and is implemented. Independent of #407/#409 (the config-page half of this feature).";
    assert.deepEqual(extractPrerequisiteNumbers(text), [406]);
  });

  test('a back-reference joined with "and" does not leak the referenced PR number', () => {
    // Defensive: the PR-backreference strip runs BEFORE the "and #NNN" join
    // check specifically so a future body phrased with "and" around a
    // back-reference can't slip the outer PR number in as a second
    // dependency.
    const text = "#407 and #410 (#406's spec) both land first.";
    assert.deepEqual(extractPrerequisiteNumbers(text), [407]);
  });

  test('dedupes a number mentioned more than once', () => {
    const text = '#367 (login initiation) - the file #367 creates; #367 does not need X.';
    assert.deepEqual(extractPrerequisiteNumbers(text), [367]);
  });

  test('accepts a bare string as a single clause (not just an array)', () => {
    assert.deepEqual(extractPrerequisiteNumbers('#5 - reason'), [5]);
    assert.deepEqual(extractPrerequisiteNumbers(['#5 - reason']), [5]);
  });
});

describe('extractDeclaredPrerequisites (union across sources)', () => {
  test('unions prerequisites declared in different sources, deduped', () => {
    const texts = [
      'Refs #406.\n\nno prerequisite line here.',
      'Depends on: #414 (endpoint) - blocking.',
      '',
    ];
    assert.deepEqual(extractDeclaredPrerequisites(texts), [414]);
  });

  test('empty when no source carries the label', () => {
    assert.deepEqual(extractDeclaredPrerequisites(['Refs #1.', 'some issue body', '']), []);
  });

  test('a prerequisite declared in only the spec doc is still found', () => {
    const prBody = 'Refs #409.\n\nno dependency line in the PR body itself.';
    const issueBody = 'Depends on: #407 (useSsoConfig()) - blocking prerequisite.';
    const specDoc = '**Blocking prerequisites:** #407 (Slice 3) must land first.';
    assert.deepEqual(extractDeclaredPrerequisites([prBody, issueBody, specDoc]), [407]);
  });
});

describe('findResolvingPr', () => {
  test('resolved when a merged candidate keyword-references the issue', () => {
    const candidates = [
      { number: 415, state: 'MERGED', body: 'Refs #414.' },
      { number: 400, state: 'OPEN', body: 'unrelated' },
    ];
    const result = findResolvingPr(414, candidates);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvingPr, 415);
  });

  test('not resolved when the only referencing PR is still open', () => {
    const candidates = [{ number: 411, state: 'OPEN', body: 'Refs #407.' }];
    const result = findResolvingPr(407, candidates);
    assert.equal(result.resolved, false);
    assert.equal(result.resolvingPr, null);
    assert.equal(result.referencing.length, 1);
  });

  test('not resolved when no candidate actually references the issue (bare mention only)', () => {
    // PR #410's real body mentions "#407" in prose with no keyword attached.
    const candidates = [
      {
        number: 410,
        state: 'MERGED',
        body: 'Refs #406.\n\n#407 (Slice 3 - SSO config data layer, independent of this).',
      },
    ];
    const result = findResolvingPr(407, candidates);
    assert.equal(result.resolved, false);
    assert.equal(result.referencing.length, 0);
  });

  test('not resolved with zero candidates at all', () => {
    const result = findResolvingPr(999, []);
    assert.equal(result.resolved, false);
    assert.equal(result.resolvingPr, null);
  });
});

describe('evaluatePrerequisites', () => {
  test('passes trivially when the PR declares no prerequisites (most PRs)', () => {
    const result = evaluatePrerequisites({
      prTitle: 'spec(#411): SSO - add GET /api/v1/auth/sso-status endpoint',
      prBody: 'Refs #414.\n\nnothing else relevant here.',
      issueBody: 'Depends on: nothing - no blocking prerequisites.',
      specTexts: ['**Blocking prerequisites:** none.'],
      lookupCandidates: () => {
        throw new Error('should not be called when there are no prerequisites');
      },
    });
    assert.equal(result.passed, true);
    assert.deepEqual(result.prerequisites, []);
  });

  test("passes trivially when no linked issue can be resolved (not this check's job)", () => {
    const result = evaluatePrerequisites({
      prTitle: 'chore: bump a dependency',
      prBody: 'no issue reference here',
      issueBody: '',
      lookupCandidates: () => {
        throw new Error('should not be called');
      },
    });
    assert.equal(result.passed, true);
    assert.equal(result.issueNumber, null);
    assert.equal(result.skipReason, 'no resolvable linked issue');
  });

  test('passes when the declared prerequisite has a merged referencing PR', () => {
    const result = evaluatePrerequisites({
      prTitle: 'spec(#406): SSO 4a/4: Login SSO status - data layer',
      prBody: 'Refs #406.',
      issueBody: 'Depends on: #414 (the sso-status endpoint) - blocking prerequisite.',
      specTexts: [],
      lookupCandidates: (n) =>
        n === 414 ? [{ number: 415, state: 'MERGED', body: 'Refs #414.' }] : [],
    });
    assert.equal(result.passed, true);
    assert.deepEqual(result.prerequisites, [414]);
    assert.equal(result.results[0].resolvingPr, 415);
  });

  test('fails when the declared prerequisite has no merged referencing PR yet', () => {
    const result = evaluatePrerequisites({
      prTitle: 'spec(#409): SSO 4d/4: SSO config page + route',
      prBody:
        "Depends on #407 (creates useSsoConfig()) - blocking prerequisite, do not merge before #411 (#407's spec) lands and is implemented. Independent of #406/#408 (the login half of this feature).",
      issueBody: 'Depends on: #407 (SSO 4c/4, useSsoConfig()) - blocking prerequisite.',
      specTexts: ['**Blocking prerequisites:** #407 (Slice 3) must land and be implemented first.'],
      lookupCandidates: (n) =>
        n === 407 ? [{ number: 411, state: 'OPEN', body: 'Refs #407.' }] : [],
    });
    assert.equal(result.passed, false);
    assert.deepEqual(result.prerequisites, [407]);
    assert.equal(result.results[0].resolved, false);
  });

  test('fails and reports every unresolved prerequisite when there is more than one', () => {
    const result = evaluatePrerequisites({
      prTitle: 'spec(#407): SSO 4c/4: SSO config data layer',
      prBody: 'Refs #407.',
      issueBody: 'Depends on: nothing.',
      specTexts: [
        '**Blocking prerequisites:**\n\n- #352 - already merged\n- #353 - endpoints\n- #354 - server-side gating (already merged)\n',
      ],
      lookupCandidates: (n) => {
        if (n === 352) {
          return [{ number: 358, state: 'MERGED', body: 'Refs #352.' }];
        }
        if (n === 353) {
          return [{ number: 363, state: 'MERGED', body: 'Refs #353.' }];
        }
        return []; // #354: the real, confirmed no-qualifying-reference case
      },
    });
    assert.equal(result.passed, false);
    assert.deepEqual(
      result.results.filter((r) => !r.resolved).map((r) => r.issueNumber),
      [354]
    );
  });
});

describe('buildUnresolvedMessage', () => {
  test('mentions the issue, that it is unresolved, and why issue state is not the signal', () => {
    const msg = buildUnresolvedMessage(413, 407, 1);
    assert.match(msg, /#413/);
    assert.match(msg, /#407/);
    assert.match(msg, /not.*resolved/i);
    assert.match(msg, /do not close on merge/i);
  });

  test('distinguishes "a PR exists but is unmerged" from "no PR exists yet"', () => {
    assert.match(
      buildUnresolvedMessage(1, 2, 1),
      /1 PR\(s\) reference it, but none has merged yet/
    );
    assert.match(buildUnresolvedMessage(1, 2, 0), /no PR referencing it/);
  });
});
