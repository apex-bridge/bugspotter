/**
 * Unit tests for `DefaultActionDispatcher`.
 *
 * Covers the dispatcher's contract:
 *  - `ticket.add_comment` / `ticket.transition` route through
 *    the capability service when one is available;
 *  - missing canonical, missing ticket, unsupported plugin all
 *    short-circuit with a false return (no throw);
 *  - capability call failures are caught, logged, and return false —
 *    the executor relies on this so one bad rule can't abort the loop;
 *  - `notify.email` / `notify.slack` / `notify.webhook` are recognised
 *    but no-op in this PR slice (PR-C2 wires email, PR-D wires the rest);
 *  - `resolveTarget` passes the firing rule's `projectId` to the
 *    canonical resolver (cross-tenant scoping).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { DefaultActionDispatcher } from '../../../src/services/rules/dispatcher.js';
import type {
  CanonicalTicketResolver,
  CapabilityServiceLookup,
} from '../../../src/services/rules/dispatcher.js';
import type { RuleEvalContext } from '../../../src/services/rules/types.js';
import type { ActionSpec } from '../../../src/integrations/dedup-rule.schema.js';
import type {
  CapabilityTarget,
  TicketIntegrationCapabilities,
} from '../../../src/integrations/capabilities.js';
import type { BugReport } from '../../../src/db/types.js';

const TARGET: CapabilityTarget = {
  externalId: 'JIRA-123',
  projectId: 'project-1',
  integrationId: 'integration-1',
};

function makeBug(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: 'bug-new',
    project_id: 'project-1',
    title: 't',
    description: null,
    screenshot_url: null,
    replay_url: null,
    metadata: {},
    status: 'open',
    priority: 'high',
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
    organization_id: null,
    duplicate_of: 'bug-canonical',
    created_at: new Date(),
    updated_at: new Date(),
    screenshot_key: null,
    thumbnail_key: null,
    replay_key: null,
    upload_status: 'completed',
    replay_upload_status: 'completed',
    ...overrides,
  } as BugReport;
}

function makeContext(overrides: Partial<RuleEvalContext> = {}): RuleEvalContext {
  return {
    bugReport: makeBug(),
    canonical: makeBug({ id: 'bug-canonical', duplicate_of: null }),
    projectId: 'project-1',
    resolved: new Map(),
    ...overrides,
  };
}

describe('DefaultActionDispatcher', () => {
  let resolver: { resolve: Mock };
  let lookup: Mock;
  let capabilityService: { addComment: Mock; transition: Mock; getStatus: Mock };
  let dispatcher: DefaultActionDispatcher;

  beforeEach(() => {
    resolver = { resolve: vi.fn().mockResolvedValue(TARGET) };
    capabilityService = {
      addComment: vi.fn().mockResolvedValue(undefined),
      transition: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue('closed'),
    };
    lookup = vi
      .fn()
      .mockResolvedValue(capabilityService as unknown as TicketIntegrationCapabilities);
    dispatcher = new DefaultActionDispatcher(
      resolver as unknown as CanonicalTicketResolver,
      lookup as CapabilityServiceLookup
    );
  });

  describe('ticket.add_comment', () => {
    it('resolves the canonical target then calls service.addComment', async () => {
      const ok = await dispatcher.dispatch(makeContext(), {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: 'hello',
      });
      expect(ok).toBe(true);
      expect(resolver.resolve).toHaveBeenCalledWith('bug-canonical', 'project-1');
      expect(capabilityService.addComment).toHaveBeenCalledWith(TARGET, 'hello');
    });

    it('passes context.projectId to the resolver (cross-tenant scoping)', async () => {
      // The resolver enforces the project_id scope in SQL; pinning the
      // arg means a future refactor that drops the scope shows up in
      // this test.
      const context = makeContext({ projectId: 'project-XYZ' });
      await dispatcher.dispatch(context, {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: 'hi',
      });
      expect(resolver.resolve).toHaveBeenCalledWith('bug-canonical', 'project-XYZ');
    });

    it('returns false (without throwing) when no canonical exists', async () => {
      const context = makeContext({ canonical: null, bugReport: makeBug({ duplicate_of: null }) });
      const ok = await dispatcher.dispatch(context, {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: 'hi',
      });
      expect(ok).toBe(false);
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(capabilityService.addComment).not.toHaveBeenCalled();
    });

    it('returns false when the resolver finds no external ticket', async () => {
      resolver.resolve.mockResolvedValueOnce(null);
      const ok = await dispatcher.dispatch(makeContext(), {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: 'hi',
      });
      expect(ok).toBe(false);
      expect(capabilityService.addComment).not.toHaveBeenCalled();
    });

    it('returns false when the lookup yields no service', async () => {
      lookup.mockResolvedValueOnce(null);
      const ok = await dispatcher.dispatch(makeContext(), {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: 'hi',
      });
      expect(ok).toBe(false);
    });

    it('returns false when the plugin lacks the addComment capability', async () => {
      // pluginSupports does a duck-type check; a service without
      // `addComment` is treated as not supporting it.
      lookup.mockResolvedValueOnce({
        transition: vi.fn(),
        getStatus: vi.fn(),
      } as unknown as TicketIntegrationCapabilities);
      const ok = await dispatcher.dispatch(makeContext(), {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: 'hi',
      });
      expect(ok).toBe(false);
    });

    it('catches addComment failures (executor relies on this to keep the loop alive)', async () => {
      capabilityService.addComment.mockRejectedValueOnce(new Error('jira 502'));
      const ok = await dispatcher.dispatch(makeContext(), {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: 'hi',
      });
      expect(ok).toBe(false);
    });

    it('falls back to bugReport.duplicate_of when context.canonical is null', async () => {
      const context = makeContext({ canonical: null }); // duplicate_of still set on bugReport
      await dispatcher.dispatch(context, {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: 'hi',
      });
      expect(resolver.resolve).toHaveBeenCalledWith('bug-canonical', 'project-1');
    });
  });

  describe('ticket.transition', () => {
    it('routes to service.transition with the requested status', async () => {
      const ok = await dispatcher.dispatch(makeContext(), {
        type: 'ticket.transition',
        target: 'canonical',
        to: 'in_progress',
      });
      expect(ok).toBe(true);
      expect(capabilityService.transition).toHaveBeenCalledWith(TARGET, 'in_progress');
    });

    it('returns false when the plugin lacks the transition capability', async () => {
      lookup.mockResolvedValueOnce({
        addComment: vi.fn(),
      } as unknown as TicketIntegrationCapabilities);
      const ok = await dispatcher.dispatch(makeContext(), {
        type: 'ticket.transition',
        target: 'canonical',
        to: 'closed',
      });
      expect(ok).toBe(false);
    });

    it('catches transition failures', async () => {
      capabilityService.transition.mockRejectedValueOnce(new Error('no valid transition'));
      const ok = await dispatcher.dispatch(makeContext(), {
        type: 'ticket.transition',
        target: 'canonical',
        to: 'open',
      });
      expect(ok).toBe(false);
    });
  });

  describe('canDispatch', () => {
    it('returns true for ticket.* actions', () => {
      expect(
        dispatcher.canDispatch({
          type: 'ticket.add_comment',
          target: 'canonical',
          body: 'x',
        })
      ).toBe(true);
      expect(
        dispatcher.canDispatch({
          type: 'ticket.transition',
          target: 'canonical',
          to: 'closed',
        })
      ).toBe(true);
    });

    it('returns false for notify.email when no EmailSender is wired', () => {
      // Dispatcher constructed without an emailSender (the default
      // 3-arg form used by other tests in this file). canDispatch
      // flips to true once the wiring helper provides one.
      expect(
        dispatcher.canDispatch({ type: 'notify.email', to: 'reporter', template: 'ack' })
      ).toBe(false);
    });

    it.each<ActionSpec>([
      { type: 'notify.slack', channel: '#x', message: 'hi' },
      { type: 'notify.webhook', url: 'https://example.com/hook' },
    ])('returns false for not-yet-wired %s', (action) => {
      // PR-D will flip these as the slack / webhook dispatchers
      // land. The executor relies on this to skip rate-limit-
      // consuming fires that would do zero work.
      expect(dispatcher.canDispatch(action)).toBe(false);
    });
  });

  describe('notify.slack / notify.webhook (not wired in PR-C2)', () => {
    // Pinning false here means a future PR that adds real wiring also
    // has to update this test, which is the signal we want.

    it.each<ActionSpec>([
      { type: 'notify.slack', channel: '#regressions', message: 'hit' },
      { type: 'notify.webhook', url: 'https://example.com/hook' },
    ])('returns false for %s without touching the resolver or lookup', async (action) => {
      const ok = await dispatcher.dispatch(makeContext(), action);
      expect(ok).toBe(false);
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('notify.email (wired with EmailSender)', () => {
    function buildEmailDispatcher() {
      const send: Mock = vi.fn().mockResolvedValue(true);
      const emailSender = { send };
      const d = new DefaultActionDispatcher(
        resolver as unknown as CanonicalTicketResolver,
        lookup as CapabilityServiceLookup,
        emailSender
      );
      return { dispatcher: d, send };
    }

    it('canDispatch returns true once an EmailSender is provided', () => {
      const { dispatcher: d } = buildEmailDispatcher();
      expect(d.canDispatch({ type: 'notify.email', to: 'reporter', template: 'dedup_ack' })).toBe(
        true
      );
    });

    it('dispatches to the EmailSender with projectId, resolved recipient, and template id', async () => {
      const { dispatcher: d, send } = buildEmailDispatcher();
      const ctx = makeContext({
        bugReport: makeBug({
          metadata: { metadata: { user: { email: 'reporter@example.com' } } },
        }),
      });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      const arg = send.mock.calls[0][0];
      expect(arg.projectId).toBe('project-1');
      expect(arg.to).toBe('reporter@example.com');
      expect(arg.templateId).toBe('dedup_ack');
      // Vars include the canonical-shaped projection expected by the
      // few-shot templates (`{{canonical.title}}` etc).
      expect(arg.vars).toMatchObject({
        bug: { id: ctx.bugReport.id, title: ctx.bugReport.title },
        canonical: { id: ctx.canonical?.id, title: ctx.canonical?.title },
      });
    });

    it('returns false when the recipient resolves to null (e.g. reporter email missing)', async () => {
      const { dispatcher: d, send } = buildEmailDispatcher();
      // No metadata.metadata.user — reporter resolution returns null.
      const ctx = makeContext({ bugReport: makeBug({ metadata: {} }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });
      expect(ok).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('returns false when the EmailSender reports failure (executor stays alive)', async () => {
      const { dispatcher: d, send } = buildEmailDispatcher();
      send.mockResolvedValueOnce(false);
      const ctx = makeContext({
        bugReport: makeBug({
          metadata: { metadata: { user: { email: 'reporter@example.com' } } },
        }),
      });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });
      expect(ok).toBe(false);
    });

    it('passes a literal email recipient straight through', async () => {
      const { dispatcher: d, send } = buildEmailDispatcher();
      await d.dispatch(makeContext(), {
        type: 'notify.email',
        to: 'ops@example.com',
        template: 'dedup_ack',
      });
      expect(send.mock.calls[0][0].to).toBe('ops@example.com');
    });
  });

  describe('notify.email — auth-bound reporter (SaaS)', () => {
    function buildVerifierDispatcher(verifyReporter: Mock) {
      const send: Mock = vi.fn().mockResolvedValue(true);
      const emailSender = { send };
      const d = new DefaultActionDispatcher(
        resolver as unknown as CanonicalTicketResolver,
        lookup as CapabilityServiceLookup,
        emailSender,
        verifyReporter as unknown as (orgId: string, email: string) => Promise<boolean>
      );
      return { dispatcher: d, send, verifyReporter };
    }

    const SAAS_CTX = (): RuleEvalContext =>
      makeContext({
        bugReport: makeBug({
          organization_id: 'org-1',
          metadata: { metadata: { user: { email: 'reporter@example.com' } } },
        }),
      });

    it('sends when verifier confirms the reporter is an org member', async () => {
      const verify = vi.fn().mockResolvedValue(true);
      const { dispatcher: d, send } = buildVerifierDispatcher(verify);

      const ok = await d.dispatch(SAAS_CTX(), {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(verify).toHaveBeenCalledWith('org-1', 'reporter@example.com');
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('skips when verifier returns false (reporter not in org)', async () => {
      const verify = vi.fn().mockResolvedValue(false);
      const { dispatcher: d, send } = buildVerifierDispatcher(verify);

      const ok = await d.dispatch(SAAS_CTX(), {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(false);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    });

    it('fails closed when verifier throws (does not propagate)', async () => {
      const verify = vi.fn().mockRejectedValue(new Error('db unreachable'));
      const { dispatcher: d, send } = buildVerifierDispatcher(verify);

      const ok = await d.dispatch(SAAS_CTX(), {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('fails closed in SaaS mode when no verifier is wired', async () => {
      const send: Mock = vi.fn().mockResolvedValue(true);
      const emailSender = { send };
      const d = new DefaultActionDispatcher(
        resolver as unknown as CanonicalTicketResolver,
        lookup as CapabilityServiceLookup,
        emailSender
        // verifyReporter intentionally omitted
      );

      const ok = await d.dispatch(SAAS_CTX(), {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('skips verifier entirely for selfhosted (organization_id is null)', async () => {
      const verify = vi.fn().mockResolvedValue(false);
      const { dispatcher: d, send } = buildVerifierDispatcher(verify);
      const ctx = makeContext({
        bugReport: makeBug({
          organization_id: null,
          metadata: { metadata: { user: { email: 'reporter@example.com' } } },
        }),
      });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(verify).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('does not invoke verifier for literal recipients', async () => {
      const verify = vi.fn().mockResolvedValue(false);
      const { dispatcher: d, send } = buildVerifierDispatcher(verify);
      const ctx = makeContext({
        bugReport: makeBug({ organization_id: 'org-1', metadata: {} }),
      });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'ops@example.com',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(verify).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].to).toBe('ops@example.com');
    });
  });

  describe('notify.email — literal-recipient allowlist (per-org)', () => {
    function buildAllowlistDispatcher(provider: Mock) {
      const send: Mock = vi.fn().mockResolvedValue(true);
      const emailSender = { send };
      const d = new DefaultActionDispatcher(
        resolver as unknown as CanonicalTicketResolver,
        lookup as CapabilityServiceLookup,
        emailSender,
        undefined,
        undefined,
        provider as unknown as (
          organizationId: string
        ) => Promise<readonly string[] | null | undefined>
      );
      return { dispatcher: d, send };
    }

    // Regression scaffold: an admin (or a compromised admin path)
    // writes a rule with `notify.email.to = 'attacker@evil.com'`.
    // Without an allowlist this used to ship bug data straight out;
    // with a configured allowlist the literal is rejected before
    // `emailSender.send` is ever called.
    it('skips literal recipients not in the org allowlist', async () => {
      const provider = vi.fn().mockResolvedValue(['ops@bugspotter.io']);
      const { dispatcher: d, send } = buildAllowlistDispatcher(provider);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: 'org-1' }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'attacker@evil.com',
        template: 'dedup_ack',
      });

      expect(ok).toBe(false);
      expect(provider).toHaveBeenCalledWith('org-1');
      expect(send).not.toHaveBeenCalled();
    });

    it('sends when the literal recipient matches an entry on the allowlist', async () => {
      const provider = vi.fn().mockResolvedValue(['ops@bugspotter.io']);
      const { dispatcher: d, send } = buildAllowlistDispatcher(provider);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: 'org-1' }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'ops@bugspotter.io',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('matches the allowlist case-insensitively (and tolerates surrounding whitespace)', async () => {
      const provider = vi.fn().mockResolvedValue([' Ops@BugSpotter.io ']);
      const { dispatcher: d, send } = buildAllowlistDispatcher(provider);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: 'org-1' }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'ops@bugspotter.io',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('preserves legacy behaviour when the allowlist is empty or unset', async () => {
      const provider = vi.fn().mockResolvedValue([]);
      const { dispatcher: d, send } = buildAllowlistDispatcher(provider);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: 'org-1' }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'ops@bugspotter.io',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);

      // null also counts as "no allowlist configured" — legacy soft path.
      provider.mockResolvedValueOnce(null);
      send.mockClear();
      const ok2 = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'anywhere@example.com',
        template: 'dedup_ack',
      });
      expect(ok2).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('does not consult the allowlist for the `reporter` token', async () => {
      const provider = vi.fn().mockResolvedValue(['only-this@example.com']);
      const send: Mock = vi.fn().mockResolvedValue(true);
      const emailSender = { send };
      // Wire the reporter verifier too so the reporter path doesn't
      // fail-closed on the missing verifier in SaaS mode.
      const verify = vi.fn().mockResolvedValue(true);
      const d = new DefaultActionDispatcher(
        resolver as unknown as CanonicalTicketResolver,
        lookup as CapabilityServiceLookup,
        emailSender,
        verify as unknown as (orgId: string, email: string) => Promise<boolean>,
        undefined,
        provider as unknown as (
          organizationId: string
        ) => Promise<readonly string[] | null | undefined>
      );
      const ctx = makeContext({
        bugReport: makeBug({
          organization_id: 'org-1',
          metadata: { metadata: { user: { email: 'alice@example.com' } } },
        }),
      });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(provider).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('skips the allowlist entirely on the selfhosted path (organization_id is null)', async () => {
      const provider = vi.fn().mockResolvedValue(['only-this@example.com']);
      const { dispatcher: d, send } = buildAllowlistDispatcher(provider);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: null }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'anywhere@example.com',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(provider).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('fails closed when the provider throws', async () => {
      const provider = vi.fn().mockRejectedValue(new Error('db gone'));
      const { dispatcher: d, send } = buildAllowlistDispatcher(provider);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: 'org-1' }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'ops@bugspotter.io',
        template: 'dedup_ack',
      });

      expect(ok).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('notify.email — per-recipient rate limiter', () => {
    function buildLimitedDispatcher(limiter: Mock, verifyReporter?: Mock) {
      const send: Mock = vi.fn().mockResolvedValue(true);
      const emailSender = { send };
      const d = new DefaultActionDispatcher(
        resolver as unknown as CanonicalTicketResolver,
        lookup as CapabilityServiceLookup,
        emailSender,
        verifyReporter as unknown as (orgId: string, email: string) => Promise<boolean>,
        { check: limiter } as unknown as {
          check: (recipient: string, organizationId: string | null) => Promise<boolean>;
        }
      );
      return { dispatcher: d, send };
    }

    it('sends when the limiter reserves a slot', async () => {
      const limiter = vi.fn().mockResolvedValue(true);
      const verify = vi.fn().mockResolvedValue(true);
      const { dispatcher: d, send } = buildLimitedDispatcher(limiter, verify);
      const ctx = makeContext({
        bugReport: makeBug({
          organization_id: 'org-1',
          metadata: { metadata: { user: { email: 'alice@example.com' } } },
        }),
      });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(limiter).toHaveBeenCalledWith('alice@example.com', 'org-1');
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('skips when the limiter denies (recipient hit the window cap)', async () => {
      const limiter = vi.fn().mockResolvedValue(false);
      const verify = vi.fn().mockResolvedValue(true);
      const { dispatcher: d, send } = buildLimitedDispatcher(limiter, verify);
      const ctx = makeContext({
        bugReport: makeBug({
          organization_id: 'org-1',
          metadata: { metadata: { user: { email: 'alice@example.com' } } },
        }),
      });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(false);
      expect(limiter).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    });

    // Regression scaffold for the spam-vector described in
    // C2 carry-over #2: same recipient, N different canonicals, no
    // per-(rule, canonical) cap. Without a per-recipient limiter, all
    // N would land. With the limiter capped at 2, only the first two
    // do — and the third skips with `send` never called.
    it('caps fan-out across multiple canonicals to one recipient', async () => {
      let allowed = 0;
      const cap = 2;
      const limiter = vi.fn().mockImplementation(async () => {
        if (allowed >= cap) {
          return false;
        }
        allowed += 1;
        return true;
      });
      const verify = vi.fn().mockResolvedValue(true);
      const { dispatcher: d, send } = buildLimitedDispatcher(limiter, verify);

      const results: boolean[] = [];
      for (let i = 0; i < 3; i++) {
        const ctx = makeContext({
          bugReport: makeBug({
            id: `dup-${i}`,
            organization_id: 'org-1',
            metadata: { metadata: { user: { email: 'alice@example.com' } } },
          }),
          canonical: makeBug({ id: `canonical-${i}`, duplicate_of: null }),
        });
        results.push(
          await d.dispatch(ctx, {
            type: 'notify.email',
            to: 'reporter',
            template: 'dedup_ack',
          })
        );
      }

      expect(results).toEqual([true, true, false]);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('runs the verifier first — denied recipients do not consume the budget', async () => {
      const limiter = vi.fn().mockResolvedValue(true);
      const verify = vi.fn().mockResolvedValue(false);
      const { dispatcher: d, send } = buildLimitedDispatcher(limiter, verify);
      const ctx = makeContext({
        bugReport: makeBug({
          organization_id: 'org-1',
          metadata: { metadata: { user: { email: 'alice@example.com' } } },
        }),
      });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(false);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(limiter).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('passes recipient and null organization_id through on the selfhosted path', async () => {
      const limiter = vi.fn().mockResolvedValue(true);
      const { dispatcher: d, send } = buildLimitedDispatcher(limiter);
      const ctx = makeContext({
        bugReport: makeBug({
          organization_id: null,
          metadata: { metadata: { user: { email: 'alice@example.com' } } },
        }),
      });

      const ok = await d.dispatch(ctx, {
        type: 'notify.email',
        to: 'reporter',
        template: 'dedup_ack',
      });

      expect(ok).toBe(true);
      expect(limiter).toHaveBeenCalledWith('alice@example.com', null);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe('notify.telegram', () => {
    function buildTelegramDispatcher(sender: Mock, tokenResolver: Mock) {
      const d = new DefaultActionDispatcher(
        resolver as unknown as CanonicalTicketResolver,
        lookup as CapabilityServiceLookup,
        undefined,
        undefined,
        undefined,
        undefined,
        { send: sender } as unknown as {
          send: (req: { token: string; chatId: string; text: string }) => Promise<boolean>;
        },
        tokenResolver as unknown as (organizationId: string | null) => Promise<string | null>
      );
      return { dispatcher: d, sender };
    }

    it('canDispatch returns true once a TelegramSender is wired', () => {
      const sender = vi.fn().mockResolvedValue(true);
      const tokens = vi.fn().mockResolvedValue('bot-token');
      const { dispatcher: d } = buildTelegramDispatcher(sender, tokens);
      expect(d.canDispatch({ type: 'notify.telegram', chat_id: '@chan', message: 'hi' })).toBe(
        true
      );
    });

    it('canDispatch returns false when no sender is wired', () => {
      expect(
        dispatcher.canDispatch({ type: 'notify.telegram', chat_id: '@chan', message: 'hi' })
      ).toBe(false);
    });

    it('sends the message via the sender with the resolved token, chat_id, text', async () => {
      const sender = vi.fn().mockResolvedValue(true);
      const tokens = vi.fn().mockResolvedValue('bot:token-abc');
      const { dispatcher: d } = buildTelegramDispatcher(sender, tokens);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: 'org-1' }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.telegram',
        chat_id: '@kz_engineering',
        message: 'New duplicate: bug-123',
      });

      expect(ok).toBe(true);
      expect(tokens).toHaveBeenCalledWith('org-1');
      expect(sender).toHaveBeenCalledWith({
        token: 'bot:token-abc',
        chatId: '@kz_engineering',
        text: 'New duplicate: bug-123',
      });
    });

    it('skips when no bot token is configured for the org', async () => {
      const sender = vi.fn().mockResolvedValue(true);
      const tokens = vi.fn().mockResolvedValue(null);
      const { dispatcher: d } = buildTelegramDispatcher(sender, tokens);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: 'org-1' }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.telegram',
        chat_id: '@chan',
        message: 'hi',
      });

      expect(ok).toBe(false);
      expect(sender).not.toHaveBeenCalled();
    });

    it('returns false when the sender reports a failure', async () => {
      const sender = vi.fn().mockResolvedValue(false);
      const tokens = vi.fn().mockResolvedValue('bot:tok');
      const { dispatcher: d } = buildTelegramDispatcher(sender, tokens);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: 'org-1' }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.telegram',
        chat_id: '@chan',
        message: 'hi',
      });

      expect(ok).toBe(false);
    });

    it('fails closed when the token resolver throws', async () => {
      const sender = vi.fn().mockResolvedValue(true);
      const tokens = vi.fn().mockRejectedValue(new Error('db gone'));
      const { dispatcher: d } = buildTelegramDispatcher(sender, tokens);
      const ctx = makeContext({ bugReport: makeBug({ organization_id: 'org-1' }) });

      const ok = await d.dispatch(ctx, {
        type: 'notify.telegram',
        chat_id: '@chan',
        message: 'hi',
      });

      expect(ok).toBe(false);
      expect(sender).not.toHaveBeenCalled();
    });
  });
});
