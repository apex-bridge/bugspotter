/**
 * Share Token Manager Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareTokenManager } from '../../components/bug-reports/share-token-manager';
import { shareTokenService, type ShareToken } from '../../services/share-token-service';
import { toast } from 'sonner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../services/share-token-service', () => ({
  shareTokenService: {
    getActive: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('ShareTokenManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state with proper ARIA attributes', async () => {
    // Mock slow response to ensure loading state is visible
    vi.mocked(shareTokenService.getActive).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(null), 500))
    );

    render(<ShareTokenManager bugReportId="bug-123" hasReplay={true} />, {
      wrapper: createWrapper(),
    });

    // Verify loading state element has proper accessibility attributes
    // Note: The loading div has role="status" but the text "Loading..." is not in the accessible name
    const loadingDiv = screen.getByRole('status');
    expect(loadingDiv).toHaveAttribute('aria-live', 'polite');
    expect(loadingDiv).toHaveTextContent('Loading...');

    // Wait for loading to complete and form to appear
    await waitFor(() => {
      expect(screen.getByLabelText(/Expires In/i)).toBeInTheDocument();
    });

    // Loading state should be gone
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('should show message when no replay available', () => {
    render(<ShareTokenManager bugReportId="bug-123" hasReplay={false} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByText('Public Replay Sharing')).toBeInTheDocument();
    expect(screen.getByText('No session replay available for this bug report')).toBeInTheDocument();
  });

  it('should show create form when no active share token', async () => {
    vi.mocked(shareTokenService.getActive).mockResolvedValue(null);

    render(<ShareTokenManager bugReportId="bug-123" hasReplay={true} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Expires In/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Create Share Link/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Password protect/i)).toBeInTheDocument();
  });

  it('should display active share token with details', async () => {
    const mockShareToken: ShareToken = {
      id: 'token-uuid',
      token: 'abc123token',
      expires_at: '2025-12-31T23:59:59Z',
      share_url: 'https://app.bugspotter.com/shared/abc123token',
      password_protected: true,
      view_count: 10,
      created_by: 'user-uuid',
      created_at: '2025-01-01T00:00:00Z',
    };

    vi.mocked(shareTokenService.getActive).mockResolvedValue(mockShareToken);

    render(<ShareTokenManager bugReportId="bug-123" hasReplay={true} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText('Active Share Link')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue(mockShareToken.share_url)).toBeInTheDocument();
    expect(screen.getByText('10 views')).toBeInTheDocument();
    expect(screen.getByText('Protected')).toBeInTheDocument();
  });

  it('should create share token with default settings', async () => {
    vi.mocked(shareTokenService.getActive).mockResolvedValue(null);
    vi.mocked(shareTokenService.create).mockResolvedValue({
      token: 'new-token-123',
      expires_at: '2025-01-02T00:00:00Z',
      share_url: 'https://app.bugspotter.com/shared/new-token-123',
      password_protected: false,
    });

    const user = userEvent.setup();
    render(<ShareTokenManager bugReportId="bug-456" hasReplay={true} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Share Link/i })).toBeInTheDocument();
    });

    const createButton = screen.getByRole('button', { name: /Create Share Link/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(shareTokenService.create).toHaveBeenCalledWith('bug-456', {
        expires_in_hours: 24,
        password: undefined,
      });
    });
  });

  it('should create password-protected share token', async () => {
    vi.mocked(shareTokenService.getActive).mockResolvedValue(null);
    vi.mocked(shareTokenService.create).mockResolvedValue({
      token: 'protected-token',
      expires_at: '2025-01-02T00:00:00Z',
      share_url: 'https://app.bugspotter.com/shared/protected-token',
      password_protected: true,
    });

    const user = userEvent.setup();
    render(<ShareTokenManager bugReportId="bug-789" hasReplay={true} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Password protect/i)).toBeInTheDocument();
    });

    // Enable password protection
    const passwordToggle = screen.getByLabelText(/Password protect/i);
    await user.click(passwordToggle);

    // Enter password
    const passwordInput = screen.getByPlaceholderText('Enter password');
    await user.type(passwordInput, 'securepass123');

    // Change expiration
    const expiresInput = screen.getByLabelText(/Expires In/i);
    await user.clear(expiresInput);
    await user.type(expiresInput, '48');

    // Create
    const createButton = screen.getByRole('button', { name: /Create Share Link/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(shareTokenService.create).toHaveBeenCalledWith('bug-789', {
        expires_in_hours: 48,
        password: 'securepass123',
      });
    });
  });

  it('should validate expiration hours range', async () => {
    vi.mocked(shareTokenService.getActive).mockResolvedValue(null);

    const user = userEvent.setup();
    render(<ShareTokenManager bugReportId="bug-validate" hasReplay={true} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Expires In/i)).toBeInTheDocument();
    });

    // Try invalid expiration (too high)
    const expiresInput = screen.getByLabelText(/Expires In/i);
    await user.clear(expiresInput);
    await user.type(expiresInput, '1000');

    const createButton = screen.getByRole('button', { name: /Create Share Link/i });
    await user.click(createButton);

    expect(toast.error).toHaveBeenCalledWith('errors.expirationRange');
    expect(shareTokenService.create).not.toHaveBeenCalled();
  });

  it('should validate password length', async () => {
    vi.mocked(shareTokenService.getActive).mockResolvedValue(null);

    const user = userEvent.setup();
    render(<ShareTokenManager bugReportId="bug-pw-validate" hasReplay={true} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Password protect/i)).toBeInTheDocument();
    });

    // Enable password protection
    const passwordToggle = screen.getByLabelText(/Password protect/i);
    await user.click(passwordToggle);

    // Enter short password
    const passwordInput = screen.getByPlaceholderText('Enter password');
    await user.type(passwordInput, 'short');

    const createButton = screen.getByRole('button', { name: /Create Share Link/i });
    await user.click(createButton);

    expect(toast.error).toHaveBeenCalledWith('errors.passwordMinLength');
    expect(shareTokenService.create).not.toHaveBeenCalled();
  });

  it('should revoke share token with confirmation', async () => {
    const mockShareToken: ShareToken = {
      id: 'revoke-token-uuid',
      token: 'revoke-me',
      expires_at: '2025-12-31T23:59:59Z',
      share_url: 'https://app.bugspotter.com/shared/revoke-me',
      password_protected: false,
      view_count: 5,
      created_by: null,
      created_at: '2025-01-01T00:00:00Z',
    };

    vi.mocked(shareTokenService.getActive).mockResolvedValue(mockShareToken);
    vi.mocked(shareTokenService.revoke).mockResolvedValue();

    const user = userEvent.setup();
    render(<ShareTokenManager bugReportId="bug-revoke" hasReplay={true} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText('Active Share Link')).toBeInTheDocument();
    });

    // Click revoke button
    const buttons = screen.getAllByRole('button');
    const revokeButton = buttons.find(
      (btn) => btn.querySelector('svg.lucide-trash2') && btn.className.includes('destructive')
    );
    expect(revokeButton).toBeDefined();
    await user.click(revokeButton!);

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('Revoke Share Link')).toBeInTheDocument();

    // Click confirm button in dialog
    const confirmButton = screen.getByRole('button', { name: /^Revoke$/i });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(shareTokenService.revoke).toHaveBeenCalledWith('revoke-me');
    });
  });

  it('should cancel revoke if user declines confirmation', async () => {
    const mockShareToken: ShareToken = {
      id: 'cancel-revoke-uuid',
      token: 'dont-revoke-me',
      expires_at: '2025-12-31T23:59:59Z',
      share_url: 'https://app.bugspotter.com/shared/dont-revoke-me',
      password_protected: false,
      view_count: 3,
      created_by: null,
      created_at: '2025-01-01T00:00:00Z',
    };

    vi.mocked(shareTokenService.getActive).mockResolvedValue(mockShareToken);

    const user = userEvent.setup();
    render(<ShareTokenManager bugReportId="bug-cancel" hasReplay={true} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText('Active Share Link')).toBeInTheDocument();
    });

    // Click revoke button
    const buttons = screen.getAllByRole('button');
    const revokeButton = buttons.find(
      (btn) => btn.querySelector('svg.lucide-trash2') && btn.className.includes('destructive')
    );
    await user.click(revokeButton!);

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Click cancel button in dialog
    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    await user.click(cancelButton);

    // Dialog should close and revoke should not be called
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(shareTokenService.revoke).not.toHaveBeenCalled();
  });
});
