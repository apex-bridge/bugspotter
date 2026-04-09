/**
 * Unit tests for CurrentPolicyCard component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CurrentPolicyCard } from '../../../components/data-residency/current-policy-card';

// Mock translation hook
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('CurrentPolicyCard', () => {
  const mockPolicy = {
    region: 'kz' as const,
    storageRegion: 'kz-almaty' as const,
    allowCrossRegionBackup: false,
    allowCrossRegionProcessing: false,
    encryptionRequired: true,
    auditDataAccess: true,
  };

  it('should render card title', () => {
    render(<CurrentPolicyCard policy={mockPolicy} />);

    expect(screen.getByText('pages.data_residency.current_policy')).toBeInTheDocument();
  });

  it('should display region in uppercase', () => {
    render(<CurrentPolicyCard policy={mockPolicy} />);

    expect(screen.getByText('KZ')).toBeInTheDocument();
  });

  it('should display storage region', () => {
    render(<CurrentPolicyCard policy={mockPolicy} />);

    expect(screen.getByText('kz-almaty')).toBeInTheDocument();
  });

  it('should display all four policy details', () => {
    render(<CurrentPolicyCard policy={mockPolicy} />);

    expect(screen.getByText('pages.data_residency.region')).toBeInTheDocument();
    expect(screen.getByText('pages.data_residency.storage_region')).toBeInTheDocument();
    expect(screen.getByText('pages.data_residency.cross_region_backup')).toBeInTheDocument();
    expect(screen.getByText('pages.data_residency.encryption')).toBeInTheDocument();
  });

  it('should show "blocked" badge when cross-region backup not allowed', () => {
    render(<CurrentPolicyCard policy={mockPolicy} />);

    expect(screen.getByText('common.blocked')).toBeInTheDocument();
  });

  it('should show "allowed" badge when cross-region backup is allowed', () => {
    const allowedPolicy = { ...mockPolicy, allowCrossRegionBackup: true };
    render(<CurrentPolicyCard policy={allowedPolicy} />);

    expect(screen.getByText('common.allowed')).toBeInTheDocument();
  });

  it('should show "required" badge when encryption is required', () => {
    render(<CurrentPolicyCard policy={mockPolicy} />);

    expect(screen.getByText('common.required')).toBeInTheDocument();
  });

  it('should show "optional" badge when encryption is not required', () => {
    const optionalPolicy = { ...mockPolicy, encryptionRequired: false };
    render(<CurrentPolicyCard policy={optionalPolicy} />);

    expect(screen.getByText('common.optional')).toBeInTheDocument();
  });
});
