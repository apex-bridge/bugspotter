import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShowApiKeyDialog } from '../../components/api-keys/show-api-key-dialog';
import type { ApiKeyResponse } from '../../types/api-keys';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('ShowApiKeyDialog', () => {
  const mockApiKey: ApiKeyResponse = {
    id: '123',
    name: 'Test API Key',
    api_key: 'bgs_test1234567890abcdefghijklmnopqrstuvwxyz',
    key_prefix: 'bgs_test12',
    allowed_projects: ['proj-1'],
    permission_scope: 'custom',
    permissions: ['reports:read', 'reports:write', 'sessions:read'],
    type: 'development',
    created_at: '2025-10-30T12:00:00Z',
  };

  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog with API key when open', () => {
    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'apiKeys.showDialog.title' })).toBeInTheDocument();
    expect(screen.getByDisplayValue(mockApiKey.api_key)).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(<ShowApiKeyDialog open={false} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should not render when apiKey is null', () => {
    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={null} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should display custom title and description', () => {
    render(
      <ShowApiKeyDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        apiKey={mockApiKey}
        title="Custom Title"
        description="Custom description text"
      />
    );

    expect(screen.getByRole('heading', { name: 'Custom Title' })).toBeInTheDocument();
    expect(screen.getByText('Custom description text')).toBeInTheDocument();
  });

  it('should display default title when title prop is undefined', () => {
    render(
      <ShowApiKeyDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        apiKey={mockApiKey}
        title={undefined}
      />
    );

    expect(screen.getByRole('heading', { name: 'apiKeys.showDialog.title' })).toBeInTheDocument();
  });

  it('should display "API Key Created" title when specified', () => {
    render(
      <ShowApiKeyDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        apiKey={mockApiKey}
        title="API Key Created"
      />
    );

    expect(screen.getByRole('heading', { name: 'API Key Created' })).toBeInTheDocument();
  });

  it('should display "API Key Rotated" title when specified', () => {
    render(
      <ShowApiKeyDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        apiKey={mockApiKey}
        title="API Key Rotated"
      />
    );

    expect(screen.getByRole('heading', { name: 'API Key Rotated' })).toBeInTheDocument();
  });

  it('should display security warning', () => {
    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    expect(screen.getByText('apiKeys.showDialog.securityWarningTitle')).toBeInTheDocument();
    expect(screen.getByText('apiKeys.showDialog.securityWarningDescription')).toBeInTheDocument();
  });

  it('should display API key details', () => {
    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    expect(screen.getByText('apiKeys.showDialog.name')).toBeInTheDocument();
    expect(screen.getByText(mockApiKey.name)).toBeInTheDocument();

    expect(screen.getByText('apiKeys.showDialog.keyPrefix')).toBeInTheDocument();
    expect(screen.getByText(`${mockApiKey.key_prefix}...`)).toBeInTheDocument();

    expect(screen.getByText('apiKeys.showDialog.permissions')).toBeInTheDocument();
    mockApiKey.permissions.forEach((permission) => {
      const permissionBadges = screen.getAllByText(permission);
      expect(permissionBadges.length).toBeGreaterThan(0);
    });
  });

  it('should copy API key to clipboard', async () => {
    const user = userEvent.setup();

    // Mock clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    });

    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    const copyButton = screen.getByRole('button', { name: 'apiKeys.showDialog.copyToClipboard' });
    await user.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockApiKey.api_key);

    // Should show success feedback
    await waitFor(() => {
      expect(screen.getByText('apiKeys.showDialog.copied')).toBeInTheDocument();
    });
  });

  it('should handle clipboard copy failure', async () => {
    const user = userEvent.setup();

    // Mock clipboard API to fail
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('Clipboard not available')),
      },
      writable: true,
    });

    const { toast } = await import('sonner');

    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    const copyButton = screen.getByRole('button', { name: 'apiKeys.showDialog.copyToClipboard' });
    await user.click(copyButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('errors.failedToCopyToClipboard');
    });
  });

  it('should close dialog when Close button is clicked', async () => {
    const user = userEvent.setup();

    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    const closeButton = screen.getByRole('button', { name: 'apiKeys.showDialog.close' });
    await user.click(closeButton);

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  it('should select input text when clicked', async () => {
    const user = userEvent.setup();

    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    const input = screen.getByDisplayValue(mockApiKey.api_key) as HTMLInputElement;
    await user.click(input);

    // Input should be focused and text selected
    expect(input).toHaveFocus();
  });

  it('should have proper ARIA attributes', () => {
    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'show-api-key-dialog-title');
  });

  it('should close dialog when auto-close timer expires', async () => {
    vi.useFakeTimers();

    render(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    // Fast-forward 30 seconds
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);

    vi.useRealTimers();
  });

  it('should clear copied state when dialog closes', async () => {
    const user = userEvent.setup();

    // Mock clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });

    const { rerender } = render(
      <ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />
    );

    // Click copy button
    const copyButton = screen.getByRole('button', { name: 'apiKeys.showDialog.copyToClipboard' });
    await user.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText('apiKeys.showDialog.copied')).toBeInTheDocument();
    });

    // Close and reopen dialog
    rerender(<ShowApiKeyDialog open={false} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    rerender(<ShowApiKeyDialog open={true} onOpenChange={mockOnOpenChange} apiKey={mockApiKey} />);

    // Copied state should be cleared
    expect(screen.queryByText('apiKeys.showDialog.copied')).not.toBeInTheDocument();
    expect(screen.getByText('apiKeys.showDialog.copy')).toBeInTheDocument();
  });
});
