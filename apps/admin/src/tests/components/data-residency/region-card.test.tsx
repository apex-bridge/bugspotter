/**
 * Unit tests for RegionCard component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegionCard } from '../../../components/data-residency/region-card';

// Mock translation hook
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('RegionCard', () => {
  const mockGlobalRegion = {
    id: 'global' as const,
    name: 'Global',
    allowCrossRegionBackup: true,
    allowCrossRegionProcessing: true,
    encryptionRequired: false,
    defaultStorageRegion: 'us-east-1' as const,
    storageRegions: ['us-east-1' as const],
  };

  const mockStrictRegion = {
    id: 'kz' as const,
    name: 'Kazakhstan',
    allowCrossRegionBackup: false,
    allowCrossRegionProcessing: false,
    encryptionRequired: true,
    defaultStorageRegion: 'kz-almaty' as const,
    storageRegions: ['kz-almaty' as const, 'kz-astana' as const],
  };

  it('should render region name', () => {
    render(<RegionCard region={mockGlobalRegion} isSelected={false} onSelect={vi.fn()} />);

    expect(screen.getByText('pages.data_residency.regions.global')).toBeInTheDocument();
  });

  it('should show Globe icon for global region', () => {
    render(<RegionCard region={mockGlobalRegion} isSelected={false} onSelect={vi.fn()} />);

    const globeIcon = document.querySelector('svg.lucide-globe');
    expect(globeIcon).toBeInTheDocument();
  });

  it('should show ShieldCheck icon for non-global regions', () => {
    render(<RegionCard region={mockStrictRegion} isSelected={false} onSelect={vi.fn()} />);

    const shieldIcon = document.querySelector('svg.lucide-shield-check');
    expect(shieldIcon).toBeInTheDocument();
  });

  it('should show "strict" badge for KZ and RF regions', () => {
    render(<RegionCard region={mockStrictRegion} isSelected={false} onSelect={vi.fn()} />);

    expect(screen.getByText('pages.data_residency.strict')).toBeInTheDocument();
  });

  it('should not show "strict" badge for global region', () => {
    render(<RegionCard region={mockGlobalRegion} isSelected={false} onSelect={vi.fn()} />);

    expect(screen.queryByText('pages.data_residency.strict')).not.toBeInTheDocument();
  });

  it('should apply selected styling when selected', () => {
    const { container } = render(
      <RegionCard region={mockGlobalRegion} isSelected={true} onSelect={vi.fn()} />
    );

    const button = container.querySelector('button');
    expect(button).toHaveClass('border-blue-600', 'bg-blue-50', 'shadow-md');
  });

  it('should apply unselected styling when not selected', () => {
    const { container } = render(
      <RegionCard region={mockGlobalRegion} isSelected={false} onSelect={vi.fn()} />
    );

    const button = container.querySelector('button');
    expect(button).toHaveClass('border-gray-200', 'bg-white');
  });

  it('should call onSelect when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<RegionCard region={mockGlobalRegion} isSelected={false} onSelect={onSelect} />);

    const button = screen.getByRole('button');
    await user.click(button);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('should display cross-region backup setting', () => {
    render(<RegionCard region={mockStrictRegion} isSelected={false} onSelect={vi.fn()} />);

    expect(screen.getByText(/data_residency\.cross_region_backup/i)).toBeInTheDocument();
    expect(screen.getByText(/common\.no/i)).toBeInTheDocument();
  });

  it('should display encryption requirement', () => {
    render(<RegionCard region={mockStrictRegion} isSelected={false} onSelect={vi.fn()} />);

    expect(screen.getByText(/data_residency\.encryption/i)).toBeInTheDocument();
    expect(screen.getByText(/common\.required/i)).toBeInTheDocument();
  });
});
