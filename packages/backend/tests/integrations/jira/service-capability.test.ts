/**
 * Unit tests for the Jira capability methods on `JiraIntegrationService`.
 *
 * Mirrors `linear/service-capability.test.ts` — both plugins implement the
 * same `TicketIntegrationCapabilities` contract, so the assertions are
 * shaped identically. The job of this suite is to pin two contracts at the
 * service dispatch layer that aren't covered by the client / config tests:
 *
 *   1. Every capability call resolves the client through the configManager
 *      with BOTH `integrationId` AND `projectId` — the cross-tenant guard
 *      lives in `getConfigByIntegrationId` and is meaningless if a future
 *      refactor drops the projectId scope from any call site.
 *   2. Disabled integrations cause `addComment` / `transition` / `getStatus`
 *      to reject before any HTTP call is issued.
 *
 * Everything below the service (`JiraClient`, `configManager`) is mocked.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { JiraIntegrationService } from '../../../src/integrations/jira/service.js';
import type { CapabilityTarget } from '../../../src/integrations/capabilities.js';
import type {
  JiraConfig,
  JiraIssue,
  JiraTransition,
} from '../../../src/integrations/jira/types.js';

// Mock the JiraClient entirely so we don't make HTTP calls. The service
// constructs `new JiraClient(config)`; intercept the constructor and
// return a shared instance whose methods are spies.
const mockClientInstance = {
  getIssue: vi.fn(),
  addComment: vi.fn(),
  getTransitions: vi.fn(),
  transitionIssue: vi.fn(),
};
vi.mock('../../../src/integrations/jira/client.js', () => ({
  JiraClient: vi.fn().mockImplementation(() => mockClientInstance),
}));

// Minimal-but-realistic config returned by the stubbed configManager.
const FAKE_CONFIG: JiraConfig = {
  host: 'https://example.atlassian.net',
  email: 'svc@example.com',
  apiToken: 'tok_test',
  projectKey: 'ENG',
  enabled: true,
};

const FAKE_TARGET: CapabilityTarget = {
  externalId: 'ENG-123',
  projectId: 'project-1',
  integrationId: 'integration-1',
};

const FAKE_ISSUE: JiraIssue = {
  id: 'issue-id',
  key: 'ENG-123',
  self: 'https://example.atlassian.net/rest/api/3/issue/issue-id',
  fields: {
    summary: 'something',
    description: '',
    status: {
      name: 'In Progress',
      statusCategory: { key: 'indeterminate', name: 'In Progress' },
    },
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  },
};

const TRANSITION_TO_DONE: JiraTransition = {
  id: 'tr-done',
  name: 'Done',
  to: {
    id: 'state-done',
    name: 'Done',
    statusCategory: { key: 'done', name: 'Done' },
  },
};

describe('JiraIntegrationService — capability methods', () => {
  let service: JiraIntegrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.getIssue.mockResolvedValue(FAKE_ISSUE);
    mockClientInstance.addComment.mockResolvedValue(undefined);
    mockClientInstance.getTransitions.mockResolvedValue([TRANSITION_TO_DONE]);
    mockClientInstance.transitionIssue.mockResolvedValue(undefined);

    service = new JiraIntegrationService({} as never, {} as never, {} as never, {} as never);

    // Stomp the configManager with one that always returns FAKE_CONFIG.
    // The capability methods go through `resolveClient` → `validateAndLoadConfig`
    // → `configManager.getConfigByIntegrationId(integrationId, projectId)`.
    (service as unknown as { configManager: { getConfigByIntegrationId: Mock } }).configManager = {
      getConfigByIntegrationId: vi.fn().mockResolvedValue(FAKE_CONFIG),
    };
  });

  describe('addComment', () => {
    it('passes (integrationId, projectId) to the config manager', async () => {
      // The reason this test exists: the cross-tenant guard lives in
      // `getConfigByIntegrationId`'s SQL (`WHERE id=$1 AND project_id=$2`).
      // If a future refactor drops the projectId arg at this call site,
      // the guard silently turns off. Lock the contract.
      await service.addComment(FAKE_TARGET, 'hello');
      const cm = (service as unknown as { configManager: { getConfigByIntegrationId: Mock } })
        .configManager;
      expect(cm.getConfigByIntegrationId).toHaveBeenCalledWith('integration-1', 'project-1');
    });

    it('delegates to JiraClient.addComment with the externalId', async () => {
      await service.addComment(FAKE_TARGET, 'hello');
      expect(mockClientInstance.addComment).toHaveBeenCalledWith('ENG-123', 'hello');
    });
  });

  describe('transition', () => {
    it('passes (integrationId, projectId) to the config manager', async () => {
      await service.transition(FAKE_TARGET, 'closed');
      const cm = (service as unknown as { configManager: { getConfigByIntegrationId: Mock } })
        .configManager;
      expect(cm.getConfigByIntegrationId).toHaveBeenCalledWith('integration-1', 'project-1');
    });

    it('picks a transition whose `to.statusCategory` matches and dispatches it', async () => {
      await service.transition(FAKE_TARGET, 'closed');
      expect(mockClientInstance.getTransitions).toHaveBeenCalledWith('ENG-123');
      expect(mockClientInstance.transitionIssue).toHaveBeenCalledWith('ENG-123', 'tr-done');
    });

    it('throws when no transition lands in the requested canonical category', async () => {
      mockClientInstance.getTransitions.mockResolvedValueOnce([]);
      await expect(service.transition(FAKE_TARGET, 'closed')).rejects.toThrow(
        /No Jira transition leads to canonical status 'closed'/
      );
      expect(mockClientInstance.transitionIssue).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('passes (integrationId, projectId) to the config manager', async () => {
      await service.getStatus(FAKE_TARGET);
      const cm = (service as unknown as { configManager: { getConfigByIntegrationId: Mock } })
        .configManager;
      expect(cm.getConfigByIntegrationId).toHaveBeenCalledWith('integration-1', 'project-1');
    });

    it('returns the canonical mapping of issue.status.statusCategory.key', async () => {
      const status = await service.getStatus(FAKE_TARGET);
      // FAKE_ISSUE has statusCategory.key === 'indeterminate' → 'in_progress'
      expect(status).toBe('in_progress');
      expect(mockClientInstance.getIssue).toHaveBeenCalledWith('ENG-123');
    });
  });

  describe('disabled / missing integration', () => {
    // Mirror of the same case in linear/service-capability.test.ts. The
    // capability layer must refuse to operate on disabled integrations
    // — symmetry with the legacy `validateAndLoadConfig` path — and must
    // do so BEFORE issuing any HTTP call.

    it('rejects addComment when configManager returns null (missing/disabled/wrong project)', async () => {
      (service as unknown as { configManager: { getConfigByIntegrationId: Mock } }).configManager =
        {
          getConfigByIntegrationId: vi.fn().mockResolvedValue(null),
        };
      await expect(service.addComment(FAKE_TARGET, 'hi')).rejects.toThrow();
      expect(mockClientInstance.addComment).not.toHaveBeenCalled();
    });

    it('rejects transition when configManager returns null', async () => {
      (service as unknown as { configManager: { getConfigByIntegrationId: Mock } }).configManager =
        {
          getConfigByIntegrationId: vi.fn().mockResolvedValue(null),
        };
      await expect(service.transition(FAKE_TARGET, 'closed')).rejects.toThrow();
      expect(mockClientInstance.getTransitions).not.toHaveBeenCalled();
      expect(mockClientInstance.transitionIssue).not.toHaveBeenCalled();
    });

    it('rejects getStatus when configManager returns null', async () => {
      (service as unknown as { configManager: { getConfigByIntegrationId: Mock } }).configManager =
        {
          getConfigByIntegrationId: vi.fn().mockResolvedValue(null),
        };
      await expect(service.getStatus(FAKE_TARGET)).rejects.toThrow();
      expect(mockClientInstance.getIssue).not.toHaveBeenCalled();
    });
  });
});
