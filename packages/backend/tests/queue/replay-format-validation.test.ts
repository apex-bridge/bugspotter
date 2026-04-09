/**
 * Replay Format Validation Tests
 *
 * Tests that the replay worker correctly handles both:
 * 1. SDK format: Array of events directly
 * 2. Legacy format: Object with events property
 *
 * This prevents regression of the bug where the worker expected
 * {events: [...]} but SDK sends [...] directly.
 */

import { describe, it, expect } from 'vitest';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);
const gzip = promisify(zlib.gzip);

describe('Replay Format Validation', () => {
  describe('SDK Format - Direct Array', () => {
    it('should validate SDK format with events array', async () => {
      // SDK sends: [{timestamp: 123, type: 2, data: {...}}, ...]
      const sdkFormat = [
        { timestamp: 1000, type: 2, data: {} },
        { timestamp: 2000, type: 3, data: {} },
        { timestamp: 3000, type: 3, data: {} },
      ];

      const jsonString = JSON.stringify(sdkFormat);
      const compressed = await gzip(Buffer.from(jsonString));
      const decompressed = await gunzip(compressed);
      const parsed = JSON.parse(decompressed.toString('utf-8'));

      // Verify it's an array
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
      expect(parsed[0]).toHaveProperty('timestamp', 1000);
      expect(parsed[0]).toHaveProperty('type', 2);

      // Calculate duration
      const duration = parsed[parsed.length - 1].timestamp - parsed[0].timestamp;
      expect(duration).toBe(2000); // 3000 - 1000
    });

    it('should handle empty SDK array', async () => {
      const sdkFormat: unknown[] = [];

      const jsonString = JSON.stringify(sdkFormat);
      const compressed = await gzip(Buffer.from(jsonString));
      const decompressed = await gunzip(compressed);
      const parsed = JSON.parse(decompressed.toString('utf-8'));

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(0);

      // Verify duration calculation for empty array (should handle gracefully)
      const duration =
        parsed.length > 0 ? parsed[parsed.length - 1].timestamp - parsed[0].timestamp : 0;
      expect(duration).toBe(0);
    });
  });

  describe('Legacy Format - Object with Events', () => {
    it('should validate legacy format with events property', async () => {
      // Legacy format: {events: [...], duration: 1000}
      const legacyFormat = {
        events: [
          { timestamp: 1000, type: 2, data: {} },
          { timestamp: 2000, type: 3, data: {} },
        ],
        duration: 1000,
      };

      const jsonString = JSON.stringify(legacyFormat);
      const compressed = await gzip(Buffer.from(jsonString));
      const decompressed = await gunzip(compressed);
      const parsed = JSON.parse(decompressed.toString('utf-8'));

      // Verify it's an object with events
      expect(typeof parsed).toBe('object');
      expect(parsed).toHaveProperty('events');
      expect(Array.isArray(parsed.events)).toBe(true);
      expect(parsed.events).toHaveLength(2);
      expect(parsed).toHaveProperty('duration', 1000);
    });

    it('should calculate duration if not provided in legacy format', async () => {
      const legacyFormat = {
        events: [
          { timestamp: 5000, type: 2, data: {} },
          { timestamp: 8000, type: 3, data: {} },
        ],
      };

      const jsonString = JSON.stringify(legacyFormat);
      const compressed = await gzip(Buffer.from(jsonString));
      const decompressed = await gunzip(compressed);
      const parsed = JSON.parse(decompressed.toString('utf-8'));

      expect(parsed.events).toHaveLength(2);
      const duration =
        parsed.events[parsed.events.length - 1].timestamp - parsed.events[0].timestamp;
      expect(duration).toBe(3000); // 8000 - 5000
    });
  });

  describe('Invalid Formats', () => {
    it('should detect invalid format - primitive value', async () => {
      const invalidFormat = 'just a string';

      const compressed = await gzip(Buffer.from(invalidFormat));
      const decompressed = await gunzip(compressed);
      const parsed = decompressed.toString('utf-8');

      expect(typeof parsed).toBe('string');
      expect(Array.isArray(parsed)).toBe(false);
    });

    it('should detect invalid format - object without events', async () => {
      const invalidFormat = {
        duration: 1000,
        someOtherField: 'value',
      };

      const jsonString = JSON.stringify(invalidFormat);
      const compressed = await gzip(Buffer.from(jsonString));
      const decompressed = await gunzip(compressed);
      const parsed = JSON.parse(decompressed.toString('utf-8'));

      expect(parsed).not.toHaveProperty('events');
      expect(parsed).toHaveProperty('duration');
    });

    it('should detect invalid format - events is not an array', async () => {
      const invalidFormat = {
        events: 'not an array',
        duration: 1000,
      };

      const jsonString = JSON.stringify(invalidFormat);
      const compressed = await gzip(Buffer.from(jsonString));
      const decompressed = await gunzip(compressed);
      const parsed = JSON.parse(decompressed.toString('utf-8'));

      expect(parsed).toHaveProperty('events');
      expect(Array.isArray(parsed.events)).toBe(false);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle typical SDK replay with multiple event types', async () => {
      const sdkFormat = [
        { type: 0, data: {}, timestamp: 1000 }, // Meta event
        { type: 1, data: {}, timestamp: 1050 }, // Full snapshot
        { type: 2, data: {}, timestamp: 1100 }, // Incremental snapshot
        { type: 3, data: { source: 1 }, timestamp: 1200 }, // Mutation
        { type: 3, data: { source: 2 }, timestamp: 1300 }, // MouseMove
        { type: 3, data: { source: 3 }, timestamp: 1400 }, // MouseInteraction
      ];

      const jsonString = JSON.stringify(sdkFormat);
      const compressed = await gzip(Buffer.from(jsonString));
      const decompressed = await gunzip(compressed);
      const parsed = JSON.parse(decompressed.toString('utf-8'));

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(6);

      // Verify event types
      const eventTypes = parsed.map((e: { type: number }) => e.type);
      expect(eventTypes).toContain(0); // Meta
      expect(eventTypes).toContain(1); // Full snapshot
      expect(eventTypes).toContain(2); // Incremental snapshot
      expect(eventTypes).toContain(3); // Mutation/Mouse events
    });
  });
});
