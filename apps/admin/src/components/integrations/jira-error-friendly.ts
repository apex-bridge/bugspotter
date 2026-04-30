/**
 * Maps raw Jira / Atlassian API errors to friendly, actionable hints.
 *
 * The backend's `/api/v1/integrations/:platform/test` proxies the raw
 * Atlassian response, which is often opaque to non-developer users
 * ("401 Unauthorized" with no further context). This mapper recognizes
 * the most common misconfigurations from the surface text and returns
 * an i18n key for a short title + hint, plus an optional doc link.
 *
 * The render site composes these via t(); the mapper itself is pure
 * (no hook dependencies) so it can be unit-tested without a provider.
 */

export interface FriendlyJiraError {
  /** i18n key for the short headline ("Authentication failed", etc.) */
  titleKey: string;
  /** i18n key for the actionable hint ("Check your email + API token...") */
  hintKey: string;
  /** Optional URL to documentation that helps resolve this error */
  docHref?: string;
  /** Raw server message for the "Show details" toggle, never shown by default */
  raw: string;
}

/**
 * Atlassian's official documentation for creating API tokens.
 * Keep in sync with the link surfaced from the auth-failure mapping.
 */
export const ATLASSIAN_API_TOKEN_DOCS =
  'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/';

export function mapJiraError(rawMessage: string, statusCode?: number): FriendlyJiraError {
  // String() cast guards against a non-string slipping past the
  // type system (e.g. a JS-side caller passing a raw Error object).
  // The signature still says `string` for the well-typed path; this
  // is defense-in-depth, not a workaround.
  const safe = String(rawMessage || '');
  const m = safe.toLowerCase();
  const raw = safe;

  // Network-level — DNS/TLS — usually means the site URL is wrong.
  // Atlassian sites are <name>.atlassian.net; users sometimes paste the
  // bare org name or copy the wiki/confluence URL by mistake.
  if (
    m.includes('enotfound') ||
    m.includes('getaddrinfo') ||
    m.includes('econnrefused') ||
    m.includes('certificate') ||
    m.includes('self signed') ||
    m.includes('socket hang up')
  ) {
    return {
      titleKey: 'integrationConfig.jiraErrors.unreachable.title',
      hintKey: 'integrationConfig.jiraErrors.unreachable.hint',
      raw,
    };
  }

  // 401 — almost always wrong/expired token or email/token pairing
  // mismatch. Send them straight to Atlassian's token-mgmt docs.
  if (statusCode === 401 || m.includes('unauthorized') || /\b401\b/.test(m)) {
    return {
      titleKey: 'integrationConfig.jiraErrors.unauthorized.title',
      hintKey: 'integrationConfig.jiraErrors.unauthorized.hint',
      docHref: ATLASSIAN_API_TOKEN_DOCS,
      raw,
    };
  }

  // 403 — auth was OK but the user doesn't have the required Jira
  // permissions (typically "Browse projects" + "Create issues").
  if (statusCode === 403 || m.includes('forbidden') || /\b403\b/.test(m)) {
    return {
      titleKey: 'integrationConfig.jiraErrors.forbidden.title',
      hintKey: 'integrationConfig.jiraErrors.forbidden.hint',
      raw,
    };
  }

  // 404 — site URL points at a valid Atlassian host but the path/site
  // doesn't exist for this account. Often happens when users paste
  // someone else's site URL.
  if (statusCode === 404 || /\b404\b/.test(m) || m.includes('site not found')) {
    return {
      titleKey: 'integrationConfig.jiraErrors.notFound.title',
      hintKey: 'integrationConfig.jiraErrors.notFound.hint',
      raw,
    };
  }

  // 429 — rate limit. Self-explanatory; just tell them to wait.
  if (statusCode === 429 || /\b429\b/.test(m) || m.includes('too many requests')) {
    return {
      titleKey: 'integrationConfig.jiraErrors.rateLimited.title',
      hintKey: 'integrationConfig.jiraErrors.rateLimited.hint',
      raw,
    };
  }

  // 5xx — Atlassian-side problem, retry later.
  if ((statusCode !== undefined && statusCode >= 500) || /\b5\d\d\b/.test(m)) {
    return {
      titleKey: 'integrationConfig.jiraErrors.upstream.title',
      hintKey: 'integrationConfig.jiraErrors.upstream.hint',
      raw,
    };
  }

  // Fallback — show the raw message verbatim so a developer can copy
  // it. Title is the same generic "test failed".
  return {
    titleKey: 'integrationConfig.jiraErrors.generic.title',
    hintKey: 'integrationConfig.jiraErrors.generic.hint',
    raw,
  };
}
