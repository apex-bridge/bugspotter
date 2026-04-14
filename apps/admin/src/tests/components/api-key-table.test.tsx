/**
 * API Key Table Component Tests
 * Tests for status badges, expiry display, and refactored component structure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiKeyTable } from '../../components/api-keys/api-key-table';
import type { ApiKey, Project } from '../../types';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ApiKeyTable', () => {
  const mockProjects: Project[] = [
    {
      id: 'proj-1',
      name: 'Project One',
      created_at: '2025-01-01T00:00:00Z',
      report_count: 0,
    },
    {
      id: 'proj-2',
      name: 'Project Two',
      created_at: '2025-01-01T00:00:00Z',
      report_count: 0,
    },
  ];

  const createMockApiKey = (overrides: Partial<ApiKey> = {}): ApiKey => ({
    id: 'key-1',
    name: 'Test API Key',
    type: 'production',
    allowed_projects: ['proj-1'],
    key_prefix: 'bgs_test12',
    permission_scope: 'custom',
    permissions: ['reports:read', 'reports:write'],
    status: 'active',
    expires_at: null,
    rotate_at: null,
    last_used_at: null,
    created_at: '2025-10-30T12:00:00Z',
    updated_at: '2025-10-30T12:00:00Z',
    created_by: 'user-1',
    ...overrides,
  });

  const mockHandlers = {
    onRevoke: vi.fn(),
    onRotate: vi.fn(),
    onViewUsage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Status Badge Display', () => {
    it('should display "Active" badge for active API keys', () => {
      const apiKeys = [createMockApiKey({ status: 'active' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const statusBadge = screen.getByRole('status', { name: /api key status: active/i });
      expect(statusBadge).toBeInTheDocument();
      expect(statusBadge).toHaveTextContent('Active');
      expect(statusBadge).toHaveClass('bg-green-100', 'text-green-800');
    });

    it('should display "Expiring Soon" badge with warning icon for expiring keys', () => {
      const apiKeys = [createMockApiKey({ status: 'expiring' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const statusBadge = screen.getByRole('status', { name: /api key status: expiring soon/i });
      expect(statusBadge).toBeInTheDocument();
      expect(statusBadge).toHaveTextContent('Expiring Soon');
      expect(statusBadge).toHaveClass('bg-yellow-100', 'text-yellow-800');
    });

    it('should display "Expired" badge for expired API keys', () => {
      const apiKeys = [createMockApiKey({ status: 'expired' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const statusBadge = screen.getByRole('status', { name: /api key status: expired/i });
      expect(statusBadge).toBeInTheDocument();
      expect(statusBadge).toHaveTextContent('Expired');
      expect(statusBadge).toHaveClass('bg-red-100', 'text-red-800');
    });

    it('should display "Revoked" badge for revoked API keys', () => {
      const apiKeys = [createMockApiKey({ status: 'revoked' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const statusBadge = screen.getByRole('status', { name: /api key status: revoked/i });
      expect(statusBadge).toBeInTheDocument();
      expect(statusBadge).toHaveTextContent('Revoked');
      expect(statusBadge).toHaveClass('bg-gray-100', 'text-gray-800');
    });
  });

  describe('Expiry Date Display', () => {
    it('should display "Never" when expires_at is null', () => {
      const apiKeys = [createMockApiKey({ expires_at: null, name: 'non-expiring-key' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      // ✅ GOOD: Query by table structure to verify "Never" is in the Expires column
      const row = screen.getByRole('row', { name: /non-expiring-key/i });
      const cells = within(row).getAllByRole('cell');

      // Expires column is the 6th cell (0-indexed: 5)
      const expiryCell = cells[5];
      expect(expiryCell).toHaveTextContent('Never');
    });

    it('should display formatted date when expires_at is set', () => {
      const expiryDate = '2025-12-31T23:59:59Z';
      const apiKeys = [createMockApiKey({ expires_at: expiryDate, name: 'expiring-key' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      // ✅ GOOD: Query by table structure - find the row, then verify expiry cell exists
      // The formatDate function includes time and may convert timezone, so we check for date/time format
      const row = screen.getByRole('row', { name: /expiring-key/i });
      const cells = within(row).getAllByRole('cell');

      // Expires column is the 6th cell (0-indexed: 5)
      const expiryCell = cells[5];
      expect(expiryCell).toHaveTextContent(/\d{1,2}\/\d{1,2}\/\d{4}/); // Matches MM/DD/YYYY format
    });
  });

  describe('Project Name Display', () => {
    it('should display correct project name from single allowed project', () => {
      const apiKeys = [createMockApiKey({ allowed_projects: ['proj-1'], name: 'test-key' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      // ✅ GOOD: Query by table structure
      const row = screen.getByRole('row', { name: /test-key/i });
      const cells = within(row).getAllByRole('cell');

      // Project column is the 4th cell (0-indexed: 3)
      const projectCell = cells[3];
      expect(projectCell).toHaveTextContent('Project One');
    });

    it('should display "All Projects" when allowed_projects is null', () => {
      const apiKeys = [createMockApiKey({ allowed_projects: null, name: 'global-key' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const row = screen.getByRole('row', { name: /global-key/i });
      const cells = within(row).getAllByRole('cell');

      const projectCell = cells[3];
      expect(projectCell).toHaveTextContent('All Projects');
    });

    it('should display "All Projects" when allowed_projects is empty array', () => {
      const apiKeys = [createMockApiKey({ allowed_projects: [], name: 'empty-key' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const row = screen.getByRole('row', { name: /empty-key/i });
      const cells = within(row).getAllByRole('cell');

      const projectCell = cells[3];
      expect(projectCell).toHaveTextContent('All Projects');
    });

    it('should display "Unknown" for non-existent project IDs', () => {
      const apiKeys = [
        createMockApiKey({ allowed_projects: ['non-existent-id'], name: 'orphaned-key' }),
      ];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const row = screen.getByRole('row', { name: /orphaned-key/i });
      const cells = within(row).getAllByRole('cell');

      const projectCell = cells[3];
      expect(projectCell).toHaveTextContent('Unknown');
    });

    it('should display multiple projects with count (first project +N)', () => {
      const apiKeys = [
        createMockApiKey({ allowed_projects: ['proj-1', 'proj-2'], name: 'multi-key' }),
      ];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const row = screen.getByRole('row', { name: /multi-key/i });
      const cells = within(row).getAllByRole('cell');

      const projectCell = cells[3];
      expect(projectCell).toHaveTextContent('Project One +1');
    });

    it('should handle mix of valid and invalid project IDs', () => {
      const apiKeys = [
        createMockApiKey({
          allowed_projects: ['proj-1', 'invalid-id', 'proj-2'],
          name: 'mixed-key',
        }),
      ];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const row = screen.getByRole('row', { name: /mixed-key/i });
      const cells = within(row).getAllByRole('cell');

      const projectCell = cells[3];
      // Should show only valid projects: "Project One +1" (2 valid projects)
      expect(projectCell).toHaveTextContent('Project One +1');
    });

    it('should display single project name when only one valid project in multiple IDs', () => {
      const apiKeys = [
        createMockApiKey({
          allowed_projects: ['proj-1', 'invalid-1', 'invalid-2'],
          name: 'partial-key',
        }),
      ];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const row = screen.getByRole('row', { name: /partial-key/i });
      const cells = within(row).getAllByRole('cell');

      const projectCell = cells[3];
      // Should show only the valid project name
      expect(projectCell).toHaveTextContent('Project One');
    });

    it('should display "Unknown" for non-existent project', () => {
      const apiKeys = [
        createMockApiKey({ allowed_projects: ['non-existent-id'], name: 'orphaned-key' }),
      ];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      // ✅ GOOD: Query by table structure
      const row = screen.getByRole('row', { name: /orphaned-key/i });
      const cells = within(row).getAllByRole('cell');

      // Project column is the 4th cell (0-indexed: 3)
      const projectCell = cells[3];
      expect(projectCell).toHaveTextContent('Unknown');
    });
  });

  describe('Permission Display', () => {
    // Helper to get the permissions cell content for a given key config
    function renderAndGetPermissionsCell(overrides: Partial<ApiKey>) {
      const name = overrides.name || 'test-key';
      const apiKeys = [createMockApiKey({ name, ...overrides })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );
      // Find permissions column index from headers (not hardcoded)
      const headers = screen.getAllByRole('columnheader');
      const permissionsColumnIndex = headers.findIndex((header) =>
        /permissions/i.test(header.textContent || '')
      );
      const row = screen.getByRole('row', { name: new RegExp(name, 'i') });
      const cells = within(row).getAllByRole('cell');
      return cells[permissionsColumnIndex];
    }

    describe('Resolved scope permissions (permissions always populated)', () => {
      it('should display wildcard for full scope key', () => {
        const cell = renderAndGetPermissionsCell({
          permission_scope: 'full',
          permissions: ['*'],
          name: 'full-scope-key',
        });
        expect(cell).toHaveTextContent('*');
      });

      it('should display read permissions for read scope key', () => {
        const cell = renderAndGetPermissionsCell({
          permission_scope: 'read',
          permissions: ['reports:read', 'sessions:read'],
          name: 'read-scope-key',
        });
        expect(cell).toHaveTextContent('reports:read');
        expect(cell).toHaveTextContent('sessions:read');
      });

      it('should display read + write permissions for write scope key', () => {
        const cell = renderAndGetPermissionsCell({
          permission_scope: 'write',
          permissions: ['reports:read', 'reports:write', 'sessions:read', 'sessions:write'],
          name: 'write-scope-key',
        });
        expect(cell).toHaveTextContent('reports:read');
        expect(cell).toHaveTextContent('reports:write');
        expect(cell).toHaveTextContent('sessions:read');
        expect(cell).toHaveTextContent('sessions:write');
      });
    });

    describe('Custom scope — individual permissions', () => {
      it.each([
        'reports:read',
        'reports:write',
        'reports:update',
        'reports:delete',
        'sessions:read',
        'sessions:write',
      ])('should display single custom permission "%s"', (permission) => {
        const safeName = permission.replace(':', '-');
        const cell = renderAndGetPermissionsCell({
          permission_scope: 'custom',
          permissions: [permission],
          name: `single-${safeName}`,
        });
        expect(cell).toHaveTextContent(permission);
      });
    });

    describe('Custom scope — permission combinations', () => {
      it('should display all 6 permissions at once', () => {
        const allPerms = [
          'reports:read',
          'reports:write',
          'reports:update',
          'reports:delete',
          'sessions:read',
          'sessions:write',
        ];
        const cell = renderAndGetPermissionsCell({
          permission_scope: 'custom',
          permissions: allPerms,
          name: 'combo-all',
        });
        for (const perm of allPerms) {
          expect(cell).toHaveTextContent(perm);
        }
      });

      it('should display mixed reports + sessions permissions', () => {
        const mixed = ['reports:write', 'sessions:read'];
        const cell = renderAndGetPermissionsCell({
          permission_scope: 'custom',
          permissions: mixed,
          name: 'combo-mixed',
        });
        for (const perm of mixed) {
          expect(cell).toHaveTextContent(perm);
        }
      });
    });

    describe('Badge rendering', () => {
      it('should render one badge per permission', () => {
        const perms = ['reports:read', 'reports:write', 'sessions:read'];
        const cell = renderAndGetPermissionsCell({
          permission_scope: 'custom',
          permissions: perms,
          name: 'badge-count',
        });
        const badges = cell.querySelectorAll('span');
        expect(badges).toHaveLength(perms.length);
      });

      it('should render no badges for empty permissions', () => {
        const cell = renderAndGetPermissionsCell({
          permission_scope: 'custom',
          permissions: [],
          name: 'empty-perms',
        });
        const badges = cell.querySelectorAll('span');
        expect(badges).toHaveLength(0);
      });
    });
  });

  describe('Empty State', () => {
    it('should display empty state when no API keys exist', () => {
      render(
        <ApiKeyTable apiKeys={[]} projects={mockProjects} isLoading={false} {...mockHandlers} />
      );

      expect(screen.getByText('No API Keys')).toBeInTheDocument();
      expect(screen.getByText('Create your first API key to get started')).toBeInTheDocument();
    });
  });

  describe('Multiple API Keys', () => {
    it('should render multiple API keys with different statuses', () => {
      const apiKeys = [
        createMockApiKey({ id: 'key-1', name: 'Active Key', status: 'active' }),
        createMockApiKey({ id: 'key-2', name: 'Expiring Key', status: 'expiring' }),
        createMockApiKey({ id: 'key-3', name: 'Expired Key', status: 'expired' }),
      ];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      // Verify key names
      expect(screen.getByText('Active Key')).toBeInTheDocument();
      expect(screen.getByText('Expiring Key')).toBeInTheDocument();
      expect(screen.getByText('Expired Key')).toBeInTheDocument();

      // Verify status badges using accessible queries
      expect(screen.getByRole('status', { name: /api key status: active/i })).toBeInTheDocument();
      expect(
        screen.getByRole('status', { name: /api key status: expiring soon/i })
      ).toBeInTheDocument();
      expect(screen.getByRole('status', { name: /api key status: expired/i })).toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('should render view usage, rotate, and revoke buttons for each key', () => {
      const apiKeys = [createMockApiKey()];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      expect(screen.getByLabelText(/view usage statistics/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/rotate api key/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/revoke api key/i)).toBeInTheDocument();
    });

    it('should call onViewUsage when view usage button is clicked', async () => {
      const user = userEvent.setup();
      const apiKeys = [createMockApiKey({ id: 'key-123' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const viewButton = screen.getByLabelText(/view usage statistics/i);
      await user.click(viewButton);

      expect(mockHandlers.onViewUsage).toHaveBeenCalledWith('key-123');
    });

    it('should disable rotate and revoke buttons when isLoading is true', () => {
      const apiKeys = [createMockApiKey()];
      render(
        <ApiKeyTable apiKeys={apiKeys} projects={mockProjects} isLoading={true} {...mockHandlers} />
      );

      expect(screen.getByLabelText(/rotate api key/i)).toBeDisabled();
      expect(screen.getByLabelText(/revoke api key/i)).toBeDisabled();
    });
  });

  describe('Accessibility', () => {
    it('should have accessible table with caption', () => {
      const apiKeys = [createMockApiKey()];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      // Screen reader only caption
      const caption = table.querySelector('caption');
      expect(caption).toHaveClass('sr-only');
      expect(caption?.textContent).toContain('API keys');
    });

    it('should have proper aria-labels on action buttons', () => {
      const apiKeys = [createMockApiKey({ name: 'Production Key' })];
      render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      expect(screen.getByLabelText('View usage statistics for Production Key')).toBeInTheDocument();
      expect(screen.getByLabelText('Rotate API key Production Key')).toBeInTheDocument();
      expect(screen.getByLabelText('Revoke API key Production Key')).toBeInTheDocument();
    });

    it('should have aria-hidden on decorative icons', () => {
      const apiKeys = [createMockApiKey({ status: 'expiring' })];
      const { container } = render(
        <ApiKeyTable
          apiKeys={apiKeys}
          projects={mockProjects}
          isLoading={false}
          {...mockHandlers}
        />
      );

      // All lucide icons should have aria-hidden
      const icons = container.querySelectorAll('svg[aria-hidden="true"]');
      expect(icons.length).toBeGreaterThan(0);
    });
  });
});
