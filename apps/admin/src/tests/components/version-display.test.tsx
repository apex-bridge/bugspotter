import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { VersionDisplay } from '../../components/version-display';

// Mock the version module
vi.mock('../../lib/version', () => ({
  APP_VERSION: {
    version: '0.1.0',
    commit: '991e9df1234567890abcdef1234567890abcdef',
    buildDate: '2026-01-15T10:30:00.000Z',
  },
  getVersionString: () => 'v0.1.0 (991e9df)',
}));

describe('VersionDisplay', () => {
  it('should render version string', () => {
    render(<VersionDisplay />);

    expect(screen.getByText('v0.1.0 (991e9df)')).toBeInTheDocument();
  });

  it('should show tooltip with full version info on hover', async () => {
    const user = userEvent.setup();
    render(<VersionDisplay />);

    const versionText = screen.getByText('v0.1.0 (991e9df)');

    // Hover over version text to show tooltip
    await user.hover(versionText);

    // Wait for tooltip to appear - use getAllByText since tooltip is duplicated for accessibility
    const versionLabels = await screen.findAllByText(/Version:/);
    expect(versionLabels.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0\.1\.0/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/991e9df/).length).toBeGreaterThan(0);
  });

  it('should have proper accessibility attributes', () => {
    render(<VersionDisplay />);

    const versionText = screen.getByText('v0.1.0 (991e9df)');

    // Should be keyboard accessible
    expect(versionText).toHaveClass('cursor-help');
  });
});
