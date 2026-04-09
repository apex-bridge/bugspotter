/**
 * RBAC UI Gating Tests
 * Verifies that frontend components correctly disable/enable actions based on permissions
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BugReportList } from '../../components/bug-reports/bug-report-list';
import { ApiKeyTable } from '../../components/api-keys/api-key-table';
import type { BugReport, Project, ApiKey } from '../../types';

// ============================================================================
// TEST DATA
// ============================================================================

const mockProject: Project = {
  id: 'project-1',
  name: 'Test Project',
  created_at: '2024-01-01T00:00:00Z',
  report_count: 5,
};

const mockReport: BugReport = {
  id: 'report-1',
  project_id: 'project-1',
  title: 'Test Bug',
  description: 'A test bug',
  screenshot_url: null,
  screenshot_key: null,
  replay_url: null,
  replay_key: null,
  replay_upload_status: 'none',
  metadata: {},
  status: 'open',
  priority: 'medium',
  duplicate_of: null,
  deleted_at: null,
  deleted_by: null,
  legal_hold: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

const mockApiKey: ApiKey = {
  id: 'key-1',
  name: 'Test Key',
  key_prefix: 'bgs_test',
  type: 'development',
  permissions: ['read', 'write'],
  allowed_projects: ['project-1'],
  status: 'active',
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  last_used_at: null,
  expires_at: null,
  rotate_at: null,
};

// ============================================================================
// BUG REPORT LIST — readOnly prop
// ============================================================================

describe('BugReportList — readOnly gating', () => {
  const defaultProps = {
    reports: [mockReport],
    projects: [mockProject],
    onViewDetails: vi.fn(),
    onDelete: vi.fn(),
    isDeleting: false,
  };

  it('should enable delete button when readOnly is false', () => {
    render(<BugReportList {...defaultProps} readOnly={false} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    for (const btn of deleteButtons) {
      expect(btn).not.toBeDisabled();
    }
  });

  it('should disable delete button when readOnly is true', () => {
    render(<BugReportList {...defaultProps} readOnly={true} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    for (const btn of deleteButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it('should keep view button enabled when readOnly is true', () => {
    render(<BugReportList {...defaultProps} readOnly={true} />);

    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    for (const btn of viewButtons) {
      expect(btn).not.toBeDisabled();
    }
  });

  it('should disable delete even when not readOnly if legal_hold is true', () => {
    const legalHoldReport = { ...mockReport, legal_hold: true };
    render(<BugReportList {...defaultProps} reports={[legalHoldReport]} readOnly={false} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    for (const btn of deleteButtons) {
      expect(btn).toBeDisabled();
    }
  });
});

// ============================================================================
// API KEY TABLE — readOnly prop
// ============================================================================

describe('ApiKeyTable — readOnly gating', () => {
  const defaultProps = {
    apiKeys: [mockApiKey],
    projects: [mockProject],
    onRevoke: vi.fn(),
    onRotate: vi.fn(),
    onViewUsage: vi.fn(),
    isLoading: false,
  };

  it('should enable rotate and revoke buttons when readOnly is false', () => {
    render(<ApiKeyTable {...defaultProps} readOnly={false} />);

    const rotateButton = screen.getByRole('button', {
      name: /rotate/i,
    });
    const revokeButton = screen.getByRole('button', {
      name: /revoke/i,
    });

    expect(rotateButton).not.toBeDisabled();
    expect(revokeButton).not.toBeDisabled();
  });

  it('should disable rotate and revoke buttons when readOnly is true', () => {
    render(<ApiKeyTable {...defaultProps} readOnly={true} />);

    const rotateButton = screen.getByRole('button', {
      name: /rotate/i,
    });
    const revokeButton = screen.getByRole('button', {
      name: /revoke/i,
    });

    expect(rotateButton).toBeDisabled();
    expect(revokeButton).toBeDisabled();
  });

  it('should keep view usage button enabled when readOnly is true', () => {
    render(<ApiKeyTable {...defaultProps} readOnly={true} />);

    const viewUsageButton = screen.getByRole('button', {
      name: /usage/i,
    });

    expect(viewUsageButton).not.toBeDisabled();
  });
});
