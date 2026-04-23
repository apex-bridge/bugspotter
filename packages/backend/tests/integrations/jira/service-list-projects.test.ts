/**
 * JiraIntegrationService.listProjects unit tests.
 *
 * Exercises the wizard-flow path where caller-provided credentials
 * are normalized, a JiraClient is constructed, and its listProjects()
 * output is reshaped into the narrow {id, key, name} tuple the route
 * ships to the frontend. Mocks JiraClient at the module level to
 * avoid real HTTPS calls — consistent with tests/integration/
 * jira-integration-rules.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JiraIntegrationService } from '../../../src/integrations/jira/service.js';
import { ValidationError } from '../../../src/api/middleware/error.js';

const mockListProjects = vi.fn();

vi.mock('../../../src/integrations/jira/client.js', () => ({
  JiraClient: vi.fn().mockImplementation(() => ({
    listProjects: mockListProjects,
  })),
}));

function makeService(): JiraIntegrationService {
  // listProjects() doesn't touch repos/db/storage — pass stubs.
  return new JiraIntegrationService({} as never, {} as never, {} as never, {} as never);
}

describe('JiraIntegrationService.listProjects', () => {
  beforeEach(() => {
    mockListProjects.mockReset();
  });

  it('returns projects reshaped to {id, key, name}, dropping extra fields', async () => {
    mockListProjects.mockResolvedValueOnce([
      {
        id: '10000',
        key: 'ALPHA',
        name: 'Alpha',
        avatarUrls: { '48x48': 'https://example.atlassian.net/avatar.png' },
      },
      { id: '10001', key: 'BETA', name: 'Beta' },
    ]);

    const service = makeService();
    const result = await service.listProjects({
      instanceUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-xyz',
    });

    expect(result).toEqual([
      { id: '10000', key: 'ALPHA', name: 'Alpha' },
      { id: '10001', key: 'BETA', name: 'Beta' },
    ]);
    expect(mockListProjects).toHaveBeenCalledWith(undefined, undefined);
  });

  it('passes query and maxResults through to the client', async () => {
    mockListProjects.mockResolvedValueOnce([]);
    const service = makeService();

    await service.listProjects(
      {
        instanceUrl: 'https://example.atlassian.net',
        email: 'user@example.com',
        apiToken: 'token-xyz',
      },
      'alp',
      25
    );

    expect(mockListProjects).toHaveBeenCalledWith('alp', 25);
  });

  it('throws ValidationError when instanceUrl is missing', async () => {
    const service = makeService();
    await expect(
      service.listProjects({
        email: 'user@example.com',
        apiToken: 'token-xyz',
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockListProjects).not.toHaveBeenCalled();
  });

  it('throws ValidationError when email is missing', async () => {
    const service = makeService();
    await expect(
      service.listProjects({
        instanceUrl: 'https://example.atlassian.net',
        apiToken: 'token-xyz',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when apiToken is missing', async () => {
    const service = makeService();
    await expect(
      service.listProjects({
        instanceUrl: 'https://example.atlassian.net',
        email: 'user@example.com',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects whitespace-only fields as invalid (not merely missing)', async () => {
    const service = makeService();
    await expect(
      service.listProjects({
        instanceUrl: '   ',
        email: 'user@example.com',
        apiToken: 'token-xyz',
      })
    ).rejects.toThrowError(/invalid:.*instanceUrl/);
  });

  it('surfaces client errors to the caller without swallowing', async () => {
    mockListProjects.mockRejectedValueOnce(new Error('Jira API error: 401'));
    const service = makeService();

    await expect(
      service.listProjects({
        instanceUrl: 'https://example.atlassian.net',
        email: 'user@example.com',
        apiToken: 'bad-token',
      })
    ).rejects.toThrowError('Jira API error: 401');
  });

  it('accepts legacy `host` field when `instanceUrl` is absent', async () => {
    // Some stored integrations predate the `instanceUrl` rename and
    // still carry `host` — the shared helper falls back so that
    // `searchUsers` / `listProjects` on those rows do not 400 with
    // "instanceUrl missing" despite the URL being populated.
    mockListProjects.mockResolvedValueOnce([{ id: '10000', key: 'ALPHA', name: 'Alpha' }]);
    const service = makeService();

    const result = await service.listProjects({
      host: 'https://legacy.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-xyz',
    });

    expect(result).toEqual([{ id: '10000', key: 'ALPHA', name: 'Alpha' }]);
  });

  it('falls back to legacy `host` when `instanceUrl` is present but blank', async () => {
    // Guard against a subtle `??`-only fallback bug: `instanceUrl=""`
    // is not nullish, so naive `instanceUrl ?? host` would latch onto
    // the empty string and 400 even though `host` is valid. The helper
    // treats blank `instanceUrl` as absent for fallback purposes.
    mockListProjects.mockResolvedValueOnce([{ id: '10000', key: 'ALPHA', name: 'Alpha' }]);
    const service = makeService();

    const result = await service.listProjects({
      instanceUrl: '',
      host: 'https://legacy.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-xyz',
    });

    expect(result).toEqual([{ id: '10000', key: 'ALPHA', name: 'Alpha' }]);
  });

  it('falls back to legacy `host` when `instanceUrl` is whitespace', async () => {
    mockListProjects.mockResolvedValueOnce([{ id: '10000', key: 'ALPHA', name: 'Alpha' }]);
    const service = makeService();

    const result = await service.listProjects({
      instanceUrl: '   ',
      host: 'https://legacy.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-xyz',
    });

    expect(result).toEqual([{ id: '10000', key: 'ALPHA', name: 'Alpha' }]);
  });

  it('returns an empty array when the tenant has no projects', async () => {
    mockListProjects.mockResolvedValueOnce([]);
    const service = makeService();

    const result = await service.listProjects({
      instanceUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-xyz',
    });

    expect(result).toEqual([]);
  });
});
