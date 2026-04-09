import type { JiraConfig } from '../types';

/**
 * Type guard to safely validate if a config object matches JiraConfig structure
 *
 * Performs comprehensive validation including:
 * - Basic structure validation (object type, required fields exist)
 * - Authentication object structure and type validation
 * - Authentication type-specific field validation (presence check, not empty string validation)
 *
 * Note: This validates that fields exist and are strings/objects, but allows them to be
 * empty strings to support progressive configuration in the UI. Use validateJiraConfig()
 * for stricter validation that requires non-empty values.
 *
 * @param config - The configuration object to validate
 * @returns True if the config matches JiraConfig structure, false otherwise
 *
 * @example
 * ```typescript
 * if (isJiraConfig(localConfig)) {
 *   // localConfig is now safely typed as JiraConfig with validated structure
 *   console.log(localConfig.instanceUrl);
 *   if (localConfig.authentication.type === 'basic') {
 *     // email and apiToken fields are guaranteed to exist (may be empty)
 *     console.log(localConfig.authentication.email);
 *   }
 * }
 * ```
 */
export function isJiraConfig(config: unknown): config is JiraConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }

  const c = config as Record<string, unknown>;

  // Check required top-level fields exist
  if (typeof c.instanceUrl !== 'string') {
    return false;
  }

  // projectKey is required for Jira
  if (typeof c.projectKey !== 'string') {
    return false;
  }

  // Check authentication object structure
  if (typeof c.authentication !== 'object' || c.authentication === null) {
    return false;
  }

  const auth = c.authentication as Record<string, unknown>;

  // Validate authentication type
  if (typeof auth.type !== 'string' || !['basic', 'oauth2', 'pat'].includes(auth.type)) {
    return false;
  }

  // Validate authentication type-specific required fields exist
  switch (auth.type) {
    case 'basic':
      // Basic auth requires email and apiToken fields to exist
      if (typeof auth.email !== 'string') {
        return false;
      }
      if (typeof auth.apiToken !== 'string') {
        return false;
      }
      break;

    case 'oauth2':
    case 'pat':
      // OAuth2 and PAT require accessToken field to exist
      if (typeof auth.accessToken !== 'string') {
        return false;
      }
      break;

    default:
      // Should never reach here due to type check above, but TypeScript safety
      return false;
  }

  return true;
}

/**
 * Validates JiraConfig with strict non-empty value requirements
 *
 * Use this for final validation before API calls. Unlike isJiraConfig, this
 * requires all values to be non-empty strings.
 *
 * @param config - The configuration object to validate
 * @returns Error message if invalid, null if valid
 *
 * @example
 * ```typescript
 * const error = validateJiraConfig(localConfig);
 * if (error) {
 *   toast.error(error);
 *   return;
 * }
 * // Safe to submit config
 * ```
 */
export function validateJiraConfig(config: JiraConfig): string | null {
  if (!config.instanceUrl?.trim()) {
    return 'Instance URL is required';
  }

  if (!config.projectKey?.trim()) {
    return 'Project key is required';
  }

  if (!config.authentication) {
    return 'Authentication is required';
  }

  const auth = config.authentication;

  switch (auth.type) {
    case 'basic':
      if (!auth.email?.trim()) {
        return 'Email is required for basic authentication';
      }
      if (!auth.apiToken?.trim()) {
        return 'API token is required for basic authentication';
      }
      break;

    case 'oauth2':
    case 'pat':
      if (!auth.accessToken?.trim()) {
        return `Access token is required for ${auth.type} authentication`;
      }
      break;

    default:
      return 'Invalid authentication type';
  }

  return null;
}

/**
 * Safely casts a generic config to JiraConfig after validation
 * Throws an error if validation fails
 *
 * @param config - The configuration object to cast
 * @returns The validated JiraConfig object
 * @throws Error if config doesn't match JiraConfig structure
 *
 * @example
 * ```typescript
 * const jiraConfig = assertJiraConfig(localConfig);
 * console.log(jiraConfig.instanceUrl); // Type-safe access
 * ```
 */
export function assertJiraConfig(config: unknown): JiraConfig {
  if (!isJiraConfig(config)) {
    throw new Error(
      'Invalid Jira configuration structure. Required fields: instanceUrl, authentication, projectKey'
    );
  }
  return config;
}
