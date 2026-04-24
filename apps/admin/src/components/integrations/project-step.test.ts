/**
 * Unit tests for the credential-extraction helper used by ProjectStep.
 *
 * The helper decides whether the searchable project picker should
 * fire a POST to `/integrations/jira/projects` (all three fields
 * present and non-empty) or fall back to the manual-entry input.
 * Keeping these rules pure makes them cheap to test — the component
 * itself is covered by E2E.
 */

import { describe, it, expect } from 'vitest';
import { buildProjectSearchConfig } from './project-step';
import type { JiraConfig } from '../../types';

describe('buildProjectSearchConfig', () => {
  const fullConfig: JiraConfig = {
    instanceUrl: 'https://example.atlassian.net',
    authentication: {
      type: 'basic',
      email: 'user@example.com',
      apiToken: 'tok-xyz',
    },
    projectKey: '',
  };

  it('returns a flat { instanceUrl, email, apiToken } when all three are present', () => {
    expect(buildProjectSearchConfig(fullConfig)).toEqual({
      instanceUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'tok-xyz',
    });
  });

  it('trims whitespace from all three fields', () => {
    const result = buildProjectSearchConfig({
      ...fullConfig,
      instanceUrl: '  https://example.atlassian.net  ',
      authentication: {
        type: 'basic',
        email: '  user@example.com  ',
        apiToken: '  tok-xyz  ',
      },
    });
    expect(result).toEqual({
      instanceUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'tok-xyz',
    });
  });

  it('returns null when instanceUrl is missing', () => {
    expect(buildProjectSearchConfig({ ...fullConfig, instanceUrl: undefined })).toBeNull();
  });

  it('returns null when email is missing', () => {
    expect(
      buildProjectSearchConfig({
        ...fullConfig,
        authentication: { type: 'basic', apiToken: 'tok-xyz' },
      })
    ).toBeNull();
  });

  it('returns null when apiToken is missing', () => {
    expect(
      buildProjectSearchConfig({
        ...fullConfig,
        authentication: { type: 'basic', email: 'user@example.com' },
      })
    ).toBeNull();
  });

  it('returns null when authentication object is absent', () => {
    expect(buildProjectSearchConfig({ ...fullConfig, authentication: undefined })).toBeNull();
  });

  it('treats whitespace-only values as missing (fallback to manual entry)', () => {
    expect(
      buildProjectSearchConfig({
        ...fullConfig,
        instanceUrl: '   ',
      })
    ).toBeNull();
    expect(
      buildProjectSearchConfig({
        ...fullConfig,
        authentication: { type: 'basic', email: '  ', apiToken: 'tok-xyz' },
      })
    ).toBeNull();
  });
});
