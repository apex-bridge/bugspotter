# ADR-0042: Agent identity - scoped GitHub App, not a user account

- Status: Accepted
- Area: AI-SDLC / security
- Date: 2026-07-09
- Refs: AI-SDLC Phase 0 (#199-#208); ADR-0041 (AI-factory adaptation)

## Context

The AI-SDLC pipeline uses agent sessions (Claude Code, Claude API) to draft
specs, write code, and open PRs. Each agent run must be identifiable in the
git and GitHub audit trail. Three identity options were considered:

1. **Personal user account** - share an owner or team member's GitHub token
   with the agent.
2. **Dedicated user account** - create a `bugspotter-bot` GitHub user, give it
   org membership, issue it a PAT.
3. **GitHub App (scoped)** - install an App on the org with only the permissions
   the agent actually needs; the App generates short-lived installation tokens.

The parallel question: should the agent identity be allowed to approve pull
requests or trigger deployments?

## Decision

Use a **GitHub App with the minimum required permission scope**. The App's
installation token is what the agent uses for all GitHub API calls (opening
PRs, commenting, pushing to feature branches). The App is **never granted**
`pull-requests: write` in the approve/merge sense, and is never added to the
branch-protection allow-list.

**Agents never hold merge or deploy rights.** Branch protection on `main`
requires 1 human review (`enforce_admins:true`); no App identity can satisfy
that review. Deploy triggers are owner-only. These are structural constraints
in GitHub config, not policy text - they cannot be overridden by a prompt.

The `Assisted-by: <model> (agent)` trailer in every PR body (enforced by the
`Commit Trailers` required check, #203/#205) is the attribution record within
git history.

## Rejected alternatives

**Personal user account:** leaks human identity into agent actions; revocation
requires rotating the owner's token; scope cannot be narrowed below the user's
full permissions.

**Dedicated user account:** GitHub's ToS discourages bot accounts sharing the
user-account model; PATs are long-lived and hard to rotate; the account would
need org membership (over-scoped for the task).

## Consequences

### Positive

- Short-lived installation tokens (1-hour TTL) limit blast radius if a token
  leaks; rotation is automatic.
- App permissions are additive and minimal - start with `contents: write` and
  `pull-requests: write` (open/comment only), add nothing else until needed.
- Agent actions appear in the GitHub audit log under the App name, not a human
  identity.
- The hard structural constraint (branch protection + required human review)
  means the agent literally cannot merge its own work regardless of what it is
  instructed to do.

### Negative / residual

- App setup requires an owner action (create App, install on org, store the
  private key and App ID as secrets). One-time cost.
- Agent still needs a way to push to feature branches; the `contents: write`
  scope on the App token covers this. The push-protection and required checks
  on `main` still apply.
- PR approval by the App (even if accidentally granted) would satisfy the
  numeric review count but not the spirit. Mitigated by explicitly not granting
  the approve permission and by keeping `enforce_admins:true` with a 2-admin
  setup where at least one human must approve.
