import { api } from '../../../lib/api-client';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_SEARCH_RESULTS = '10';

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: {
    '48x48'?: string;
    '24x24'?: string;
    '16x16'?: string;
    '32x32'?: string;
  };
}

export const jiraUserService = {
  /**
   * Search for Jira users by query (email or name)
   */
  searchUsers: async (projectId: string, query: string): Promise<JiraUser[]> => {
    const response = await api.get<{ data: { users: JiraUser[] } }>(
      `/api/v1/integrations/jira/${projectId}/users`,
      {
        params: { query, maxResults: MAX_SEARCH_RESULTS },
      }
    );
    return response.data.data.users;
  },
};
