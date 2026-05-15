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

  describe('notify.* (not wired in PR-C)', () => {
    // The action types parse and dispatch, but the dispatcher
    // intentionally logs+returns false until PR-C2 (email) / PR-D
    // (slack, webhook). Pinning false here means a future PR that
    // adds real wiring also has to update this test, which is the
    // signal we want.

    it.each<ActionSpec>([
      { type: 'notify.email', to: 'reporter', template: 'dedup_ack' },
      { type: 'notify.slack', channel: '#regressions', message: 'hit' },
      { type: 'notify.webhook', url: 'https://example.com/hook' },
    ])('returns false for %s without touching the resolver or lookup', async (action) => {
      const ok = await dispatcher.dispatch(makeContext(), action);
      expect(ok).toBe(false);
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    });
  });
});
