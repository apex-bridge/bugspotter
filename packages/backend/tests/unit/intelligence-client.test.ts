/**
 * Unit tests for IntelligenceClient — verifies ?threshold forwarding behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntelligenceClient } from '../../src/services/intelligence/intelligence-client.js';

describe('IntelligenceClient', () => {
  const BASE_URL = 'http://intelligence:8000';
  let client: IntelligenceClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new IntelligenceClient(BASE_URL);
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getSimilarBugs', () => {
    it('appends ?threshold when org setting is present', async () => {
      await client.getSimilarBugs('bug-123', { similarityThreshold: 0.7 });

      expect(fetchMock).toHaveBeenCalledOnce();
      const calledUrl: string = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toBe('http://intelligence:8000/api/v1/bugs/bug-123/similar?threshold=0.7');
    });

    it('omits ?threshold when org setting is absent (undefined)', async () => {
      await client.getSimilarBugs('bug-123', {});

      const calledUrl: string = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toBe('http://intelligence:8000/api/v1/bugs/bug-123/similar');
      expect(calledUrl).not.toContain('threshold');
    });

    it('omits ?threshold when no options supplied', async () => {
      await client.getSimilarBugs('bug-456');

      const calledUrl: string = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('threshold');
    });

    it('URL-encodes the bugId in the path', async () => {
      await client.getSimilarBugs('bug/with/slashes', { similarityThreshold: 0.8 });

      const calledUrl: string = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('bug%2Fwith%2Fslashes');
    });
  });

  describe('getMitigations', () => {
    it('appends ?threshold when similarityThreshold is provided', async () => {
      await client.getMitigations('bug-123', { similarityThreshold: 0.65 });

      const calledUrl: string = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toBe(
        'http://intelligence:8000/api/v1/bugs/bug-123/mitigations?threshold=0.65'
      );
    });

    it('omits ?threshold when similarityThreshold is absent', async () => {
      await client.getMitigations('bug-123');

      const calledUrl: string = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('threshold');
    });
  });
});
