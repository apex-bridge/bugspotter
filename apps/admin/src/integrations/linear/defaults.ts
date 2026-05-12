/**
 * Default LinearConfig seed used when a fresh Linear integration is
 * being configured for the first time. Mirrors the Jira default seed
 * pattern in `useIntegrationConfig` (all-empty-strings rather than
 * undefined so React inputs remain controlled from the first render).
 */

import type { LinearConfig } from './types';

export const defaultLinearConfig: LinearConfig = {
  apiKey: '',
  teamId: '',
  teamKey: '',
};
