import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosResponse } from 'axios';
import { userService } from '../../services/user-service';

// Mock the API client
vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

import { api } from '../../lib/api-client';

describe('userService.getAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The service exposes `organizationId` (camelCase) on its public
  // signature for parity with project-service / api-key-service /
  // bug-report-service, but maps to the snake_case `organization_id`
  // wire name expected by the Fastify schema. These tests pin that
  // mapping so a future refactor can't silently revert to either
  // exposing snake_case or sending camelCase.

  it('serialises organizationId as `organization_id` for the wire', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { users: [], total: 0 } },
    } as AxiosResponse);

    await userService.getAll({ page: 1, limit: 20, organizationId: 'org-123' });

    const params = vi.mocked(api.get).mock.calls[0][1]?.params as Record<string, unknown>;
    expect(params.organization_id).toBe('org-123');
    expect(params).not.toHaveProperty('organizationId');
  });

  it('omits organization_id when organizationId is not provided', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { users: [], total: 0 } },
    } as AxiosResponse);

    await userService.getAll({ page: 1, limit: 20 });

    const params = vi.mocked(api.get).mock.calls[0][1]?.params as Record<string, unknown>;
    expect(params).not.toHaveProperty('organization_id');
    expect(params).not.toHaveProperty('organizationId');
  });

  it('preserves other params alongside the org id mapping', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { users: [], total: 0 } },
    } as AxiosResponse);

    await userService.getAll({
      page: 2,
      limit: 50,
      role: 'admin',
      email: 'a@b.com',
      organizationId: 'org-x',
    });

    const params = vi.mocked(api.get).mock.calls[0][1]?.params as Record<string, unknown>;
    expect(params).toEqual({
      page: 2,
      limit: 50,
      role: 'admin',
      email: 'a@b.com',
      organization_id: 'org-x',
    });
  });
});
