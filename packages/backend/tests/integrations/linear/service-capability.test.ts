/**
 * Unit tests for the Linear capability methods on `LinearIntegrationService`.
 *
 * Focused on the externalId-vs-UUID resolution path, because that's where
 * the integration silently failed before review caught it: Linear stores
 * the human-readable identifier ("ENG-123") in `external_ticket_id`, but
 * the GraphQL mutations (`commentCreate`, `issueUpdate`) reject anything
 * other than the issue UUID. The capability methods must resolve the
 * identifier → UUID via `getIssue(...)` before issuing mutations.
 *
 * Everything below the service layer (config manager, LinearClient) is
 * mocked. The test exercises the contract:
 *
 *   addComment(target)   →  getIssue(externalId) → commentCreate(issue.id, body)
 *   transition(target)   →  getIssue → getTeamStates → issueUpdateState(issue.id, state.id)
 *   getStatus(target)    →  getIssue (which accepts identifier or UUID, no resolve needed)
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { LinearIntegrationService } from '../../../src/integrations/linear/service.js';
import type { CapabilityTarget } from '../../../src/integrations/capabilities.js';
import type { LinearConfig, LinearIssueDetail } from '../../../src/integrations/linear/types.js';

// Mock the LinearClient entirely so we don't make HTTP calls. Each test
// re-binds the methods through this single shared mock — the service
// constructs LinearClient via `new LinearClient(apiKey)` so we intercept
// the constructor.
const mockClientInstance = {
  getIssue: vi.fn(),
  commentCreate: vi.fn(),
  getTeamStates: vi.fn(),
  issueUpdateState: vi.fn(),
};
vi.mock('../../../src/integrations/linear/client.js', () => ({
  LinearClient: vi.fn().mockImplementation(() => mockClientInstance),
}));

// Encryption / config-manager stubs — the service calls
// `configManager.getConfigByIntegrationId(id, projectId)`; we return a
// minimal-but-realistic LinearConfig.
const FAKE_CONFIG: LinearConfig = {
  apiKey: 'lin_api_test',
  teamId: 'team-uuid',
  teamKey: 'ENG',
  enabled: true,
};

const FAKE_TARGET: CapabilityTarget = {
  externalId: 'ENG-123', // identifier, NOT UUID — the realistic shape
  projectId: 'project-1',
  integrationId: 'integration-1',
};

const FAKE_ISSUE: LinearIssueDetail = {
  id: 'issue-uuid-aaaa-bbbb', // The resolved UUID — what mutations require
  identifier: 'ENG-123',
  state: { id: 'state-uuid', name: 'In Progress', type: 'started' },
  team: { id: 'team-uuid', name: 'Engineering' },
};

describe('LinearIntegrationService — capability methods', () => {
  let service: LinearIntegrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.getIssue.mockResolvedValue(FAKE_ISSUE);
    mockClientInstance.commentCreate.mockResolvedValue(undefined);
    mockClientInstance.getTeamStates.mockResolvedValue([
      { id: 'state-done-uuid', name: 'Done', type: 'completed' },
    ]);
    mockClientInstance.issueUpdateState.mockResolvedValue(undefined);

    // Build a minimal service whose configManager returns our stub config.
    service = new LinearIntegrationService(
      {} as never,
      {
        // ProjectIntegrationRepository is only accessed via configManager,
        // which we stub below.
      } as never,
      {} as never,
      {} as never
    );

    // Stomp the configManager with one that always returns FAKE_CONFIG.
    (service as unknown as { configManager: { getConfigByIntegrationId: Mock } }).configManager = {
      getConfigByIntegrationId: vi.fn().mockResolvedValue(FAKE_CONFIG),
    };
  });

  describe('addComment', () => {
    it('resolves identifier → UUID via getIssue before calling commentCreate', async () => {
      await service.addComment(FAKE_TARGET, 'hello');

      expect(mockClientInstance.getIssue).toHaveBeenCalledWith('ENG-123');
      expect(mockClientInstance.commentCreate).toHaveBeenCalledWith(
        'issue-uuid-aaaa-bbbb', // UUID, NOT 'ENG-123'
        'hello'
      );
    });

    it('passes the projectId scope to the config manager', async () => {
      await service.addComment(FAKE_TARGET, 'hello');
      const cm = (service as unknown as { configManager: { getConfigByIntegrationId: Mock } })
        .configManager;
      expect(cm.getConfigByIntegrationId).toHaveBeenCalledWith('integration-1', 'project-1');
    });
  });

  describe('transition', () => {
    it('uses the resolved issue.id (UUID), not the identifier, for issueUpdateState', async () => {
      await service.transition(FAKE_TARGET, 'closed');

      expect(mockClientInstance.getIssue).toHaveBeenCalledWith('ENG-123');
      expect(mockClientInstance.getTeamStates).toHaveBeenCalledWith('team-uuid');
      expect(mockClientInstance.issueUpdateState).toHaveBeenCalledWith(
        'issue-uuid-aaaa-bbbb', // UUID
        'state-done-uuid'
      );
    });

    it('throws when no state of the requested type exists', async () => {
      // Team only has an `in_progress` state — request for `closed` fails.
      mockClientInstance.getTeamStates.mockResolvedValueOnce([
        { id: 'state-todo', name: 'Todo', type: 'unstarted' },
      ]);
      await expect(service.transition(FAKE_TARGET, 'closed')).rejects.toThrow(
        /No Linear state for canonical status 'closed'/
      );
      expect(mockClientInstance.issueUpdateState).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('returns the canonical mapping of issue.state.type', async () => {
      const status = await service.getStatus(FAKE_TARGET);
      expect(status).toBe('in_progress'); // FAKE_ISSUE.state.type === 'started'
      // No UUID-resolve hop needed for a read — Linear's issue(id) query
      // accepts identifier directly. We expect exactly one getIssue call.
      expect(mockClientInstance.getIssue).toHaveBeenCalledTimes(1);
    });
  });
});
