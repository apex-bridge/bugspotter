/**
 * Jira User Service Tests
 * Tests based on actual API response structure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jiraUserService } from '../../integrations/jira/services/jira-user-service';
import * as apiClient from '../../lib/api-client';

vi.mock('../../lib/api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('jiraUserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchUsers', () => {
    const mockProjectId = 'proj-123';
    const mockQuery = 'alex';

    it('should search for users and return array of JiraUser objects', async () => {
      // Actual API response structure from production
      const mockApiResponse = {
        data: {
          success: true,
          data: {
            users: [
              {
                accountId: '712020:266bd5ce-fc2d-4871-bdea-76d6a30fdeea',
                displayName: 'Alex Budanov',
                emailAddress: 'demo@bugspotter.io',
                avatarUrls: {
                  '48x48':
                    'https://secure.gravatar.com/avatar/9fe43271a13a0291d2bb6883f98b942d?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FAB-0.png',
                  '24x24':
                    'https://secure.gravatar.com/avatar/9fe43271a13a0291d2bb6883f98b942d?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FAB-0.png',
                  '16x16':
                    'https://secure.gravatar.com/avatar/9fe43271a13a0291d2bb6883f98b942d?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FAB-0.png',
                  '32x32':
                    'https://secure.gravatar.com/avatar/9fe43271a13a0291d2bb6883f98b942d?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FAB-0.png',
                },
              },
              {
                accountId: '5dd64082af96bc0efbe55103',
                displayName: 'Alert Integration',
                emailAddress: '',
                avatarUrls: {
                  '48x48':
                    'https://secure.gravatar.com/avatar/675673c3f473815508441d00933b1752?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FAI-3.png',
                  '24x24':
                    'https://secure.gravatar.com/avatar/675673c3f473815508441d00933b1752?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FAI-3.png',
                  '16x16':
                    'https://secure.gravatar.com/avatar/675673c3f473815508441d00933b1752?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FAI-3.png',
                  '32x32':
                    'https://secure.gravatar.com/avatar/675673c3f473815508441d00933b1752?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FAI-3.png',
                },
              },
            ],
          },
          timestamp: '2026-01-02T08:29:25.422Z',
        },
      };

      vi.mocked(apiClient.api.get).mockResolvedValue(mockApiResponse);

      const result = await jiraUserService.searchUsers(mockProjectId, mockQuery);

      // Verify API call
      expect(apiClient.api.get).toHaveBeenCalledWith(
        `/api/v1/integrations/jira/${mockProjectId}/users`,
        {
          params: { query: mockQuery, maxResults: '10' },
        }
      );

      // Verify response structure
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        accountId: '712020:266bd5ce-fc2d-4871-bdea-76d6a30fdeea',
        displayName: 'Alex Budanov',
        emailAddress: 'demo@bugspotter.io',
        avatarUrls: expect.objectContaining({
          '48x48': expect.stringContaining('gravatar'),
          '24x24': expect.stringContaining('gravatar'),
        }),
      });
    });

    it('should handle users with empty email addresses', async () => {
      const mockApiResponse = {
        data: {
          success: true,
          data: {
            users: [
              {
                accountId: '5dd64082af96bc0efbe55103',
                displayName: 'Alert Integration',
                emailAddress: '', // Empty email
                avatarUrls: {
                  '24x24': 'https://example.com/avatar.png',
                },
              },
            ],
          },
          timestamp: '2026-01-02T08:29:25.422Z',
        },
      };

      vi.mocked(apiClient.api.get).mockResolvedValue(mockApiResponse);

      const result = await jiraUserService.searchUsers(mockProjectId, mockQuery);

      expect(result).toHaveLength(1);
      expect(result[0].emailAddress).toBe('');
      expect(result[0].displayName).toBe('Alert Integration');
    });

    it('should handle users with missing optional fields', async () => {
      const mockApiResponse = {
        data: {
          success: true,
          data: {
            users: [
              {
                accountId: 'user-456',
                displayName: 'John Doe',
                // emailAddress and avatarUrls are optional
              },
            ],
          },
          timestamp: '2026-01-02T08:29:25.422Z',
        },
      };

      vi.mocked(apiClient.api.get).mockResolvedValue(mockApiResponse);

      const result = await jiraUserService.searchUsers(mockProjectId, mockQuery);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        accountId: 'user-456',
        displayName: 'John Doe',
      });
    });

    it('should return empty array when no users found', async () => {
      const mockApiResponse = {
        data: {
          success: true,
          data: {
            users: [],
          },
          timestamp: '2026-01-02T08:29:25.422Z',
        },
      };

      vi.mocked(apiClient.api.get).mockResolvedValue(mockApiResponse);

      const result = await jiraUserService.searchUsers(mockProjectId, 'nonexistent');

      expect(result).toEqual([]);
    });

    it('should pass correct query parameters', async () => {
      const mockApiResponse = {
        data: {
          success: true,
          data: { users: [] },
          timestamp: '2026-01-02T08:29:25.422Z',
        },
      };

      vi.mocked(apiClient.api.get).mockResolvedValue(mockApiResponse);

      const customQuery = 'test@example.com';
      await jiraUserService.searchUsers(mockProjectId, customQuery);

      expect(apiClient.api.get).toHaveBeenCalledWith(
        `/api/v1/integrations/jira/${mockProjectId}/users`,
        {
          params: {
            query: customQuery,
            maxResults: '10',
          },
        }
      );
    });

    it('should handle API errors gracefully', async () => {
      const mockError = new Error('Network error');
      vi.mocked(apiClient.api.get).mockRejectedValue(mockError);

      await expect(jiraUserService.searchUsers(mockProjectId, mockQuery)).rejects.toThrow(
        'Network error'
      );
    });

    it('should verify all avatar size variations are preserved', async () => {
      const mockApiResponse = {
        data: {
          success: true,
          data: {
            users: [
              {
                accountId: 'user-789',
                displayName: 'Test User',
                avatarUrls: {
                  '16x16': 'https://example.com/16.png',
                  '24x24': 'https://example.com/24.png',
                  '32x32': 'https://example.com/32.png',
                  '48x48': 'https://example.com/48.png',
                },
              },
            ],
          },
          timestamp: '2026-01-02T08:29:25.422Z',
        },
      };

      vi.mocked(apiClient.api.get).mockResolvedValue(mockApiResponse);

      const result = await jiraUserService.searchUsers(mockProjectId, mockQuery);

      expect(result[0].avatarUrls).toEqual({
        '16x16': 'https://example.com/16.png',
        '24x24': 'https://example.com/24.png',
        '32x32': 'https://example.com/32.png',
        '48x48': 'https://example.com/48.png',
      });
    });
  });
});
