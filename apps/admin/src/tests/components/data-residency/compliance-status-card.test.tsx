/**
 * Unit tests for ComplianceStatusCard component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComplianceStatusCard } from '../../../components/data-residency/compliance-status-card';

// Mock translation hook
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ComplianceStatusCard', () => {
  const mockPolicy = {
    region: 'global' as const,
    storageRegion: 'us-east-1',
    allowCrossRegionBackup: true,
    allowCrossRegionProcessing: true,
    encryptionRequired: false,
    auditDataAccess: true,
  };

  const mockCompliantSummary = {
    projectId: 'project-123',
    isCompliant: true,
    policy: mockPolicy,
    storageAvailable: true,
    violations: {
      count: 0,
      recent: [],
    },
    auditEntries: {
      count: 25,
    },
  };

  const mockNonCompliantSummary = {
    projectId: 'project-123',
    isCompliant: false,
    policy: mockPolicy,
    storageAvailable: true,
    violations: {
      count: 3,
      recent: [
        {
          id: '1',
          type: 'Cross-Region Access',
          description: 'Unauthorized region access attempt',
          createdAt: '2026-01-25T12:00:00Z',
          blocked: true,
        },
        {
          id: '2',
          type: 'Encryption Violation',
          description: 'Data not encrypted at rest',
          createdAt: '2026-01-25T11:00:00Z',
          blocked: false,
        },
      ],
    },
    auditEntries: {
      count: 50,
    },
  };

  it('should render compliant status with CheckCircle icon', () => {
    render(<ComplianceStatusCard summary={mockCompliantSummary} />);

    expect(screen.getByText('pages.data_residency.compliance_status')).toBeInTheDocument();
    const checkIcon = document.querySelector('svg.text-green-600');
    expect(checkIcon).toBeInTheDocument();
  });

  it('should render non-compliant status with AlertTriangle icon', () => {
    render(<ComplianceStatusCard summary={mockNonCompliantSummary} />);

    const alertIcon = document.querySelector('svg.lucide-triangle-alert');
    expect(alertIcon).toBeInTheDocument();
    expect(alertIcon).toHaveClass('text-yellow-600');
  });

  it('should display violation count', () => {
    render(<ComplianceStatusCard summary={mockNonCompliantSummary} />);

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should display audit entries count', () => {
    render(<ComplianceStatusCard summary={mockCompliantSummary} />);

    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('should render recent violations when present', () => {
    render(<ComplianceStatusCard summary={mockNonCompliantSummary} />);

    expect(screen.getByText('pages.data_residency.recent_violations')).toBeInTheDocument();
    expect(screen.getByText('Cross-Region Access')).toBeInTheDocument();
    expect(screen.getByText('Encryption Violation')).toBeInTheDocument();
  });

  it('should not render violations section when no recent violations', () => {
    render(<ComplianceStatusCard summary={mockCompliantSummary} />);

    expect(screen.queryByText('pages.data_residency.recent_violations')).not.toBeInTheDocument();
  });

  it('should render all three metric cards', () => {
    render(<ComplianceStatusCard summary={mockCompliantSummary} />);

    expect(screen.getByText('pages.data_residency.status')).toBeInTheDocument();
    expect(screen.getByText('pages.data_residency.violations_24h')).toBeInTheDocument();
    expect(screen.getByText('pages.data_residency.audit_entries_24h')).toBeInTheDocument();
  });
});
