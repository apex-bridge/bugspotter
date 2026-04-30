import { describe, it, expect } from 'vitest';
import {
  mapJiraError,
  ATLASSIAN_API_TOKEN_DOCS,
} from '../../components/integrations/jira-error-friendly';

describe('mapJiraError', () => {
  it('maps 401 to unauthorized with token docs link', () => {
    const r = mapJiraError('Unauthorized', 401);
    expect(r.titleKey).toBe('integrationConfig.jiraErrors.unauthorized.title');
    expect(r.hintKey).toBe('integrationConfig.jiraErrors.unauthorized.hint');
    expect(r.docHref).toBe(ATLASSIAN_API_TOKEN_DOCS);
  });

  it('detects 401 from message text when status is missing', () => {
    const r = mapJiraError('Request failed with status code 401');
    expect(r.titleKey).toBe('integrationConfig.jiraErrors.unauthorized.title');
  });

  it('maps 403 to forbidden (no docs link)', () => {
    const r = mapJiraError('Forbidden', 403);
    expect(r.titleKey).toBe('integrationConfig.jiraErrors.forbidden.title');
    expect(r.docHref).toBeUndefined();
  });

  it('maps 404 to notFound', () => {
    const r = mapJiraError('Not Found', 404);
    expect(r.titleKey).toBe('integrationConfig.jiraErrors.notFound.title');
  });

  it('maps DNS / TLS errors to unreachable', () => {
    expect(mapJiraError('getaddrinfo ENOTFOUND foo.atlassian.net').titleKey).toBe(
      'integrationConfig.jiraErrors.unreachable.title'
    );
    expect(mapJiraError('connect ECONNREFUSED').titleKey).toBe(
      'integrationConfig.jiraErrors.unreachable.title'
    );
    expect(mapJiraError('unable to verify the first certificate').titleKey).toBe(
      'integrationConfig.jiraErrors.unreachable.title'
    );
  });

  it('maps 429 to rateLimited', () => {
    expect(mapJiraError('Too Many Requests', 429).titleKey).toBe(
      'integrationConfig.jiraErrors.rateLimited.title'
    );
  });

  it('maps 5xx to upstream', () => {
    expect(mapJiraError('Internal Server Error', 500).titleKey).toBe(
      'integrationConfig.jiraErrors.upstream.title'
    );
    expect(mapJiraError('Bad Gateway', 502).titleKey).toBe(
      'integrationConfig.jiraErrors.upstream.title'
    );
  });

  it('falls back to generic for unrecognized errors', () => {
    const r = mapJiraError('Some weird thing happened');
    expect(r.titleKey).toBe('integrationConfig.jiraErrors.generic.title');
    expect(r.hintKey).toBe('integrationConfig.jiraErrors.generic.hint');
  });

  it('always preserves the raw message for the details toggle', () => {
    const raw = 'Request failed: original opaque error';
    const r = mapJiraError(raw, 500);
    expect(r.raw).toBe(raw);
  });

  it('handles empty / null raw message gracefully', () => {
    expect(() => mapJiraError('', 500)).not.toThrow();
    // @ts-expect-error testing defensive handling
    expect(() => mapJiraError(null)).not.toThrow();
    // @ts-expect-error testing defensive handling
    expect(() => mapJiraError(undefined)).not.toThrow();
  });
});
