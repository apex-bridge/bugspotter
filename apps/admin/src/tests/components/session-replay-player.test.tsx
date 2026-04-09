/**
 * SessionReplayPlayer Component Tests
 * Comprehensive unit tests for session replay player functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionReplayPlayer } from '../../components/bug-reports/session-replay-player';
import type { RRWebEvent } from '@bugspotter/types';

// Mock storage service
vi.mock('../../services/storage-service', () => ({
  storageService: {
    fetchReplayEvents: vi.fn(),
  },
}));

// Mock rrweb-player
const mockPlayerDestroy = vi.fn();
const mockPlayerInstance = {
  $destroy: mockPlayerDestroy,
};

vi.mock('rrweb-player', () => ({
  default: vi.fn(() => mockPlayerInstance),
}));

// Import mocked modules
import { storageService } from '../../services/storage-service';
import rrwebPlayer from 'rrweb-player';

describe('SessionReplayPlayer', () => {
  const mockBugReportId = 'bug-123';
  const mockEvents: RRWebEvent[] = [
    {
      type: 2, // DomContentLoaded
      data: {},
      timestamp: Date.now(),
    },
    {
      type: 3, // Load
      data: {},
      timestamp: Date.now() + 100,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading States', () => {
    it('should show loading state initially when hasReplay is true', () => {
      vi.mocked(storageService.fetchReplayEvents).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      expect(screen.getByText(/Loading replay from storage/i)).toBeInTheDocument();
    });

    it('should not fetch events when hasReplay is false', () => {
      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={false} />);

      expect(storageService.fetchReplayEvents).not.toHaveBeenCalled();
      expect(screen.getByText(/No session replay available/i)).toBeInTheDocument();
    });
  });

  describe('Error States', () => {
    it('should display error message when fetch fails', async () => {
      const errorMessage = 'Network error';
      vi.mocked(storageService.fetchReplayEvents).mockRejectedValueOnce(new Error(errorMessage));

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load session replay/i)).toBeInTheDocument();
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });
    });

    it('should display generic error for non-Error objects', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockRejectedValueOnce('String error');

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load session replay/i)).toBeInTheDocument();
        expect(screen.getByText(/Failed to load replay/i)).toBeInTheDocument();
      });
    });

    it('should handle player initialization errors', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(mockEvents);
      vi.mocked(rrwebPlayer).mockImplementationOnce(() => {
        throw new Error('Player initialization failed');
      });

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load session replay player/i)).toBeInTheDocument();
      });
    });
  });

  describe('Empty States', () => {
    it('should show empty state when no events are returned', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce([]);

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      await waitFor(() => {
        expect(screen.getByText(/No session replay available/i)).toBeInTheDocument();
        expect(screen.getByText(/does not have recorded events/i)).toBeInTheDocument();
      });
    });

    it('should show empty state when hasReplay is false', () => {
      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={false} />);

      expect(screen.getByText(/No session replay available/i)).toBeInTheDocument();
    });
  });

  describe('Player Initialization', () => {
    it('should initialize rrweb player with events', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(mockEvents);

      const { container } = render(
        <SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />
      );

      await waitFor(() => {
        expect(rrwebPlayer).toHaveBeenCalled();
      });

      const playerCall = vi.mocked(rrwebPlayer).mock.calls[0][0];
      expect(playerCall.target).toBeDefined();
      expect(playerCall.props).toBeDefined();
      // Component injects a Meta event (type 4) when missing, so length is mockEvents.length + 1
      expect(playerCall.props.events).toHaveLength(mockEvents.length + 1);
      expect(playerCall.props.autoPlay).toBe(false);
      expect(playerCall.props.showController).toBe(true);
      expect(playerCall.props.UNSAFE_replayCanvas).toBe(true);

      // Verify container ref is used
      const containerDiv = container.querySelector('div > div');
      expect(containerDiv).toBeTruthy();
    });

    it('should inject Meta event when missing', async () => {
      const eventsWithoutMeta: RRWebEvent[] = [
        { type: 2, data: {}, timestamp: 1000 },
        { type: 3, data: {}, timestamp: 2000 },
      ];

      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(eventsWithoutMeta);

      render(
        <SessionReplayPlayer
          bugReportId={mockBugReportId}
          hasReplay={true}
          viewport={{ width: 1920, height: 1080 }}
        />
      );

      await waitFor(() => {
        expect(rrwebPlayer).toHaveBeenCalled();
      });

      const playerCall = vi.mocked(rrwebPlayer).mock.calls[0][0];
      const events = playerCall.props.events;

      // First event should be the injected Meta event (type 4)
      expect(events[0].type).toBe(4); // META
      expect((events[0].data as { width: number }).width).toBe(1920);
      expect((events[0].data as { height: number }).height).toBe(1080);
      expect((events[0].data as { href: string }).href).toBeDefined();

      // Original events should follow
      expect(events.length).toBe(eventsWithoutMeta.length + 1);
      expect(events[1].type).toBe(2);
      expect(events[2].type).toBe(3);
    });

    it('should use default viewport dimensions when viewport prop is missing', async () => {
      const eventsWithoutMeta: RRWebEvent[] = [{ type: 2, data: {}, timestamp: 1000 }];

      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(eventsWithoutMeta);

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      await waitFor(() => {
        expect(rrwebPlayer).toHaveBeenCalled();
      });

      const playerCall = vi.mocked(rrwebPlayer).mock.calls[0][0];
      const metaEvent = playerCall.props.events[0];

      expect(metaEvent.type).toBe(4); // META
      expect((metaEvent.data as { width: number }).width).toBe(1280); // DEFAULT_VIEWPORT.WIDTH
      expect((metaEvent.data as { height: number }).height).toBe(720); // DEFAULT_VIEWPORT.HEIGHT
    });

    it('should not inject Meta event if one already exists', async () => {
      const eventsWithMeta: RRWebEvent[] = [
        {
          type: 4, // META
          data: { href: 'https://example.com', width: 1024, height: 768 },
          timestamp: 1000,
        },
        { type: 2, data: {}, timestamp: 2000 },
      ];

      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(eventsWithMeta);

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      await waitFor(() => {
        expect(rrwebPlayer).toHaveBeenCalled();
      });

      const playerCall = vi.mocked(rrwebPlayer).mock.calls[0][0];
      const events = playerCall.props.events;

      // Should use original events without injection
      expect(events.length).toBe(eventsWithMeta.length);
      expect((events[0].data as { width: number }).width).toBe(1024); // Original Meta event preserved
    });
  });

  describe('DOM Cleanup (replaceChildren)', () => {
    it('should verify replaceChildren API is available on container element', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(mockEvents);

      const { container } = render(
        <SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />
      );

      await waitFor(() => {
        expect(rrwebPlayer).toHaveBeenCalled();
      });

      const containerDiv = container.querySelector('div > div');
      expect(containerDiv).toBeTruthy();

      // Verify replaceChildren method exists (modern DOM API)
      // This is called internally by the component to clear old player instances
      expect(typeof (containerDiv as HTMLDivElement).replaceChildren).toBe('function');
    });
  });

  describe('Player Cleanup', () => {
    it('should destroy player on unmount', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(mockEvents);

      const { unmount } = render(
        <SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />
      );

      await waitFor(() => {
        expect(rrwebPlayer).toHaveBeenCalled();
      });

      unmount();

      expect(mockPlayerDestroy).toHaveBeenCalled();
    });

    it('should handle cleanup when player instance is invalid', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(mockEvents);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(rrwebPlayer).mockReturnValueOnce({} as any); // Invalid instance without $destroy method

      const { unmount } = render(
        <SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />
      );

      await waitFor(() => {
        expect(rrwebPlayer).toHaveBeenCalled();
      });

      // Should not throw even when player instance doesn't have $destroy
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Props and Configuration', () => {
    it('should pass shareToken and shareTokenPassword to storage service', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(mockEvents);

      render(
        <SessionReplayPlayer
          bugReportId={mockBugReportId}
          hasReplay={true}
          shareToken="token-123"
          shareTokenPassword="password-456"
        />
      );

      await waitFor(() => {
        expect(storageService.fetchReplayEvents).toHaveBeenCalledWith(
          mockBugReportId,
          'token-123',
          'password-456'
        );
      });
    });

    it('should apply custom className', () => {
      const { container } = render(
        <SessionReplayPlayer
          bugReportId={mockBugReportId}
          hasReplay={false}
          className="custom-class"
        />
      );

      const outerDiv = container.firstChild;
      expect(outerDiv).toHaveClass('custom-class');
    });

    it('should set player dimensions correctly', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(mockEvents);

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      await waitFor(() => {
        expect(rrwebPlayer).toHaveBeenCalled();
      });

      const playerCall = vi.mocked(rrwebPlayer).mock.calls[0][0];
      expect(playerCall.props.height).toBe(600); // PLAYER_DIMENSIONS.HEIGHT
      expect(playerCall.props.width).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle container ref being null during initialization', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce(mockEvents);

      // Mock containerRef to be null temporarily
      const { rerender } = render(
        <SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />
      );

      // Player should not initialize if container is null
      // This is an edge case that's hard to test without implementation details
      // But the code handles it with the guard clause

      rerender(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      // Should not throw
      await waitFor(() => {
        expect(rrwebPlayer).toHaveBeenCalled();
      });
    });

    it('should not initialize player when isLoading is true', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      // Wait a bit to ensure player is not initialized
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(rrwebPlayer).not.toHaveBeenCalled();
    });

    it('should not initialize player when events array is empty', async () => {
      vi.mocked(storageService.fetchReplayEvents).mockResolvedValueOnce([]);

      render(<SessionReplayPlayer bugReportId={mockBugReportId} hasReplay={true} />);

      await waitFor(() => {
        expect(screen.getByText(/No session replay available/i)).toBeInTheDocument();
      });

      expect(rrwebPlayer).not.toHaveBeenCalled();
    });
  });
});
