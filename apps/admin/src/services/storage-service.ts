/**
 * Storage Service
 * Handles fetching presigned URLs directly from storage for screenshots and replays
 */

import { api } from '../lib/api-client';
import pako from 'pako';
import type { RRWebEvent } from '@bugspotter/types';

export type StorageResourceType = 'screenshot' | 'replay' | 'thumbnail';

export interface StorageUrlResponse {
  url: string;
  key: string;
  expiresIn: number;
  generatedAt: string;
}

export interface BatchStorageUrlResponse {
  urls: Record<
    string,
    {
      screenshot?: string | null;
      replay?: string | null;
      thumbnail?: string | null;
    }
  >;
  generatedAt: string;
}

export const storageService = {
  /**
   * Get a fresh presigned URL for a specific resource
   * @param bugReportId - Bug report ID
   * @param type - Resource type (screenshot, replay, thumbnail)
   * @param shareToken - Optional share token for public access
   * @param shareTokenPassword - Optional password for protected shares
   * @returns Fresh presigned URL with metadata
   */
  getPresignedUrl: async (
    bugReportId: string,
    type: StorageResourceType,
    shareToken?: string,
    shareTokenPassword?: string
  ): Promise<StorageUrlResponse> => {
    // Use POST for password-protected shares (secure), GET for public shares
    if (shareToken && shareTokenPassword) {
      // POST: Password in request body (not exposed in URL/logs/history)
      const response = await api.post<StorageUrlResponse>(
        `/api/v1/storage/url/${bugReportId}/${type}`,
        {
          shareToken,
          shareTokenPassword,
        }
      );
      return response.data;
    }

    // GET: Token-only (public shares) or authenticated access
    const params = new URLSearchParams();
    if (shareToken) {
      params.append('shareToken', shareToken);
    }
    const queryString = params.toString();
    const url = `/api/v1/storage/url/${bugReportId}/${type}${queryString ? `?${queryString}` : ''}`;

    const response = await api.get<StorageUrlResponse>(url);
    return response.data;
  },

  /**
   * Download a resource directly from storage
   * Opens a new window/tab with the presigned URL
   * @param bugReportId - Bug report ID
   * @param type - Resource type
   * @param filename - Optional filename for download
   */
  downloadResource: async (
    bugReportId: string,
    type: StorageResourceType,
    filename?: string
  ): Promise<void> => {
    const { url } = await storageService.getPresignedUrl(bugReportId, type);

    // Create a temporary anchor element to trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `${type}-${bugReportId}`;
    link.target = '_blank';
    link.click();
  },

  /**
   * Fetch and decompress replay data directly from storage
   * @param bugReportId - Bug report ID
   * @param shareToken - Optional share token for public access
   * @param shareTokenPassword - Optional password for protected shares
   * @returns Decompressed replay events ready for rrweb player
   */
  fetchReplayEvents: async (
    bugReportId: string,
    shareToken?: string,
    shareTokenPassword?: string
  ): Promise<RRWebEvent[]> => {
    // Get presigned URL for the replay
    const { url } = await storageService.getPresignedUrl(
      bugReportId,
      'replay',
      shareToken,
      shareTokenPassword
    );

    // Fetch the compressed replay file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch replay: ${response.statusText}`);
    }

    // Get the compressed data as ArrayBuffer
    const compressedData = await response.arrayBuffer();

    // Decompress using pako
    const decompressed = pako.ungzip(new Uint8Array(compressedData), { to: 'string' });

    // Parse JSON
    const replayData = JSON.parse(decompressed);

    // Handle two formats:
    // 1. SDK format: Array of events directly
    // 2. Legacy format: Object with events property
    if (Array.isArray(replayData)) {
      return replayData as RRWebEvent[];
    } else if (replayData && typeof replayData === 'object' && 'events' in replayData) {
      return (replayData as { events: RRWebEvent[] }).events;
    }

    throw new Error('Invalid replay data format');
  },

  /**
   * Batch fetch presigned URLs for multiple bug reports
   * @param bugReportIds - Array of bug report IDs
   * @param types - Array of resource types to fetch
   * @returns Map of bug report IDs to resource URLs
   */
  getBatchPresignedUrls: async (
    bugReportIds: string[],
    types: StorageResourceType[]
  ): Promise<BatchStorageUrlResponse> => {
    const response = await api.post<BatchStorageUrlResponse>('/api/v1/storage/urls/batch', {
      bugReportIds,
      types,
    });
    return response.data;
  },
};
