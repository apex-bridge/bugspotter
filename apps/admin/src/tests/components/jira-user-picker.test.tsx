/**
 * JiraUserPicker Component Tests
 * Tests for user search, selection, and display functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JiraUserPicker } from '../../integrations/jira/components/jira-user-picker';
import * as jiraUserService from '../../integrations/jira/services/jira-user-service';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

// Mock jira user service
vi.mock('../../integrations/jira/services/jira-user-service', () => ({
  jiraUserService: {
    searchUsers: vi.fn(),
  },
}));

describe('JiraUserPicker', () => {
  const mockProjectId = 'proj-123';
  const mockOnChange = vi.fn();

  const mockUsers: jiraUserService.JiraUser[] = [
    {
      accountId: 'acc-1',
      displayName: 'John Doe',
      emailAddress: 'john@example.com',
      avatarUrls: {
        '48x48': 'https://example.com/avatar1.png',
      },
    },
    {
      accountId: 'acc-2',
      displayName: 'Jane Smith',
      emailAddress: 'jane@example.com',
      avatarUrls: {
        '48x48': 'https://example.com/avatar2.png',
      },
    },
  ];

  // Helper to render with QueryClientProvider
  const renderWithQueryClient = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render input field', () => {
    renderWithQueryClient(
      <JiraUserPicker projectId={mockProjectId} value={null} onChange={mockOnChange} />
    );

    expect(screen.getByPlaceholderText(/search by email or name/i)).toBeInTheDocument();
  });

  it('should not search with less than 3 characters', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(
      <JiraUserPicker projectId={mockProjectId} value={null} onChange={mockOnChange} />
    );

    const input = screen.getByPlaceholderText(/search by email or name/i);
    await user.type(input, 'ab'); // 2 characters should not trigger search

    // Wait for debounce
    await waitFor(() => {
      expect(jiraUserService.jiraUserService.searchUsers).not.toHaveBeenCalled();
    });
  });

  it('should search users with 3+ characters after debounce', async () => {
    const user = userEvent.setup();

    vi.mocked(jiraUserService.jiraUserService.searchUsers).mockResolvedValue(mockUsers);

    renderWithQueryClient(
      <JiraUserPicker projectId={mockProjectId} value={null} onChange={mockOnChange} />
    );

    const input = screen.getByPlaceholderText(/search by email or name/i);
    await user.type(input, 'john');

    // Wait for debounced search to be called
    await waitFor(
      () => {
        expect(jiraUserService.jiraUserService.searchUsers).toHaveBeenCalledWith(
          mockProjectId,
          'john'
        );
      },
      { timeout: 1000 }
    );
  });

  it('should display search results with avatars', async () => {
    const user = userEvent.setup();

    vi.mocked(jiraUserService.jiraUserService.searchUsers).mockResolvedValue(mockUsers);

    renderWithQueryClient(
      <JiraUserPicker projectId={mockProjectId} value={null} onChange={mockOnChange} />
    );

    const input = screen.getByPlaceholderText(/search by email or name/i);
    await user.type(input, 'john');

    // Wait for results to appear
    await waitFor(
      () => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      },
      { timeout: 1000 }
    );

    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('should select user and call onChange with JSON value', async () => {
    const user = userEvent.setup();

    vi.mocked(jiraUserService.jiraUserService.searchUsers).mockResolvedValue(mockUsers);

    renderWithQueryClient(
      <JiraUserPicker projectId={mockProjectId} value={null} onChange={mockOnChange} />
    );

    const input = screen.getByPlaceholderText(/search by email or name/i);
    await user.type(input, 'john');

    // Wait for results to appear
    await waitFor(
      () => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      },
      { timeout: 1000 }
    );

    // Click on first user
    await user.click(screen.getByText('John Doe'));

    expect(mockOnChange).toHaveBeenCalledWith(
      JSON.stringify({
        accountId: 'acc-1',
        displayName: 'John Doe',
        emailAddress: 'john@example.com',
        avatarUrls: {
          '48x48': 'https://example.com/avatar1.png',
        },
      })
    );
  });

  it('should display selected user as chip', () => {
    const value = '{"accountId":"acc-1"}';

    vi.mocked(jiraUserService.jiraUserService.searchUsers).mockResolvedValue(mockUsers);

    renderWithQueryClient(
      <JiraUserPicker projectId={mockProjectId} value={value} onChange={mockOnChange} />
    );

    // Should display user chip (not the input)
    expect(screen.getByText('acc-1')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search by email or name/i)).not.toBeInTheDocument();
  });

  it('should clear selected user when X button clicked', async () => {
    const user = userEvent.setup();
    const value = '{"accountId":"acc-1"}';

    renderWithQueryClient(
      <JiraUserPicker projectId={mockProjectId} value={value} onChange={mockOnChange} />
    );

    // Find and click clear button (X icon)
    const clearButton = screen.getByRole('button', { name: /clear/i });
    await user.click(clearButton);

    expect(mockOnChange).toHaveBeenCalledWith(null);
  });

  it('should handle search errors gracefully', async () => {
    const user = userEvent.setup();

    vi.mocked(jiraUserService.jiraUserService.searchUsers).mockRejectedValue(
      new Error('Network error')
    );

    renderWithQueryClient(
      <JiraUserPicker projectId={mockProjectId} value={null} onChange={mockOnChange} />
    );

    const input = screen.getByPlaceholderText(/search by email or name/i);
    await user.type(input, 'john');

    // Wait for search to be called
    await waitFor(
      () => {
        expect(jiraUserService.jiraUserService.searchUsers).toHaveBeenCalled();
      },
      { timeout: 1000 }
    );

    // Should not crash and should show no results
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
  });

  it('should show "no users found" message when search returns empty', async () => {
    const user = userEvent.setup();

    vi.mocked(jiraUserService.jiraUserService.searchUsers).mockResolvedValue([]);

    renderWithQueryClient(
      <JiraUserPicker projectId={mockProjectId} value={null} onChange={mockOnChange} />
    );

    const input = screen.getByPlaceholderText(/search by email or name/i);
    await user.type(input, 'nonexistent');

    // Wait for "no users found" message
    await waitFor(
      () => {
        expect(screen.getByText(/no users found/i)).toBeInTheDocument();
      },
      { timeout: 1000 }
    );
  });
});
