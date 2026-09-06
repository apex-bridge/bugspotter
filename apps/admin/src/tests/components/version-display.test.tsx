import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { VersionDisplay } from '../../components/version-display';

// Mock the version module. `commitDate` is deliberately a different day from
// `buildDate`: a build touching no frontend source reuses the cached bundle, so
// the two genuinely diverge and the tooltip must show both.
vi.mock('../../lib/version', () => ({
  APP_VERSION: {
    version: '0.1.0',
    commit: '991e9df1234567890abcdef1234567890abcdef',
    commitDate: '20260120',
    buildDate: '2026-01-15T10:30:00.000Z',
  },
  getVersionString: () => 'v0.1.0 (991e9df, 2026-01-20)',
  formatCommitDate: (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
}));

describe('VersionDisplay', () => {
  it('should render version string', () => {
    render(<VersionDisplay />);

    expect(screen.getByText('v0.1.0 (991e9df, 2026-01-20)')).toBeInTheDocument();
  });

  it('should show tooltip with full version info on hover', async () => {
    const user = userEvent.setup();
    render(<VersionDisplay />);

    const versionText = screen.getByText('v0.1.0 (991e9df, 2026-01-20)');

    // Hover over version text to show tooltip
    await user.hover(versionText);

    // Wait for tooltip to appear - use getAllByText since tooltip is duplicated for accessibility
    const versionLabels = await screen.findAllByText(/Version:/);
    expect(versionLabels.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0\.1\.0/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/991e9df/).length).toBeGreaterThan(0);
    // Commit date and build date are separate facts and both must show.
    expect(screen.getAllByText(/Committed:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026-01-20/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Built:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026-01-15/).length).toBeGreaterThan(0);
  });

  it('should have proper accessibility attributes', () => {
    render(<VersionDisplay />);

    const versionText = screen.getByText('v0.1.0 (991e9df, 2026-01-20)');

    // Should be keyboard accessible
    expect(versionText).toHaveClass('cursor-help');
  });
});
