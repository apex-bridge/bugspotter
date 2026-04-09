import { useEffect, useRef, useState } from 'react';
import { storageService } from '../../services/storage-service';
import type { RRWebEvent } from '@bugspotter/types';
import 'rrweb-player/dist/style.css';

// rrweb event types - https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb/src/types.ts
const RRWEB_EVENT_TYPE = {
  META: 4, // Meta event with viewport dimensions
} as const;

// Default dimensions for fallback Meta event when viewport is not available
const DEFAULT_VIEWPORT = {
  WIDTH: 1280,
  HEIGHT: 720,
} as const;

// Player display dimensions
const PLAYER_DIMENSIONS = {
  DEFAULT_WIDTH: 800,
  HEIGHT: 600,
} as const;

interface SessionReplayPlayerProps {
  bugReportId: string;
  hasReplay: boolean;
  viewport?: { width: number; height: number };
  className?: string;
  shareToken?: string;
  shareTokenPassword?: string;
}

export function SessionReplayPlayer({
  bugReportId,
  hasReplay,
  viewport,
  className = '',
  shareToken,
  shareTokenPassword,
}: SessionReplayPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<RRWebEvent[]>([]);

  useEffect(() => {
    if (!hasReplay) {
      setIsLoading(false);
      return;
    }

    // Fetch replay events directly from storage
    const fetchReplay = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const replayEvents = await storageService.fetchReplayEvents(
          bugReportId,
          shareToken,
          shareTokenPassword
        );
        setEvents(replayEvents);
      } catch (err) {
        console.error('Failed to fetch replay from storage:', err);
        setError(err instanceof Error ? err.message : 'Failed to load replay');
      } finally {
        setIsLoading(false);
      }
    };

    fetchReplay();
  }, [bugReportId, hasReplay]);

  useEffect(() => {
    if (!containerRef.current || events.length === 0 || isLoading) {
      return;
    }

    // Dynamically import rrweb-player to avoid SSR issues
    const loadPlayer = async () => {
      try {
        const rrwebPlayer = await import('rrweb-player');
        const { default: rrwebPlayerDefault } = rrwebPlayer;

        // Clear previous player using modern replaceChildren() API (more performant than loop)
        if (containerRef.current) {
          containerRef.current.replaceChildren();
        }

        const containerWidth = containerRef.current?.offsetWidth || PLAYER_DIMENSIONS.DEFAULT_WIDTH;

        // CRITICAL FIX: Ensure Meta event (type 4) exists
        // rrweb-player requires a Meta event with viewport dimensions to render
        // If missing, the canvas will be blank even though controls show
        let replayEvents = [...events];
        const hasMetaEvent = events.some((e) => e.type === RRWEB_EVENT_TYPE.META);
        if (!hasMetaEvent) {
          const metaEvent = {
            type: RRWEB_EVENT_TYPE.META,
            data: {
              href: window.location.href,
              width: viewport?.width || DEFAULT_VIEWPORT.WIDTH,
              height: viewport?.height || DEFAULT_VIEWPORT.HEIGHT,
            },
            timestamp: events[0]?.timestamp || Date.now(),
          };
          replayEvents = [metaEvent, ...events];
        }

        // Create player instance and store reference for cleanup
        playerRef.current = new rrwebPlayerDefault({
          target: containerRef.current!,
          props: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            events: replayEvents as any,
            width: containerWidth,
            height: PLAYER_DIMENSIONS.HEIGHT,
            autoPlay: false,
            showController: true,
            skipInactive: true,
            speed: 1,
            // CRITICAL FIX: Allow iframe to run scripts for replay rendering
            // Without this, browser sandboxes the iframe and blocks script execution
            // Error: "Blocked script execution because document's frame is sandboxed"
            UNSAFE_replayCanvas: true,
          },
        });
      } catch (err) {
        console.error('Failed to load rrweb player:', err);
        setError('Failed to load session replay player');
      }
    };

    loadPlayer();

    // Cleanup function to prevent memory leaks
    return () => {
      if (
        playerRef.current &&
        typeof playerRef.current === 'object' &&
        '$destroy' in playerRef.current
      ) {
        (playerRef.current as { $destroy: () => void }).$destroy();
        playerRef.current = null;
      }
    };
  }, [events, isLoading]);

  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`}
        style={{ height: `${PLAYER_DIMENSIONS.HEIGHT}px` }}
      >
        <div className="text-center text-gray-500">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-sm">Loading replay from storage...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`}
        style={{ height: `${PLAYER_DIMENSIONS.HEIGHT}px` }}
      >
        <div className="text-center text-gray-500">
          <p className="mb-2">❌ Failed to load session replay</p>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!hasReplay || events.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`}
        style={{ height: `${PLAYER_DIMENSIONS.HEIGHT}px` }}
      >
        <div className="text-center text-gray-500">
          <p className="mb-2">📹 No session replay available</p>
          <p className="text-sm">This bug report does not have recorded events</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div ref={containerRef} className="rounded-lg overflow-hidden shadow-inner" />
    </div>
  );
}
