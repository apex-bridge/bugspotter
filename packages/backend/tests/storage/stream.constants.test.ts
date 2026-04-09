/**
 * Unit tests for stream constants and file signature detection
 */

import { describe, it, expect } from 'vitest';
import {
  STREAM_LIMITS,
  FILE_SIGNATURES,
  isWebPFormat,
  type FileSignature,
} from '../../src/storage/stream-constants.js';

describe('STREAM_LIMITS', () => {
  it('should define MAX_BUFFER_SIZE as 10MB', () => {
    expect(STREAM_LIMITS.MAX_BUFFER_SIZE).toBe(10 * 1024 * 1024);
    expect(STREAM_LIMITS.MAX_BUFFER_SIZE).toBe(10485760);
  });

  it('should define DEFAULT_CHUNK_SIZE as 5MB', () => {
    expect(STREAM_LIMITS.DEFAULT_CHUNK_SIZE).toBe(5 * 1024 * 1024);
    expect(STREAM_LIMITS.DEFAULT_CHUNK_SIZE).toBe(5242880);
  });

  it('should define MIN_BUFFER_CHECK as 2 bytes', () => {
    expect(STREAM_LIMITS.MIN_BUFFER_CHECK).toBe(2);
  });

  it('should define TEXT_PREVIEW_SIZE as 100 bytes', () => {
    expect(STREAM_LIMITS.TEXT_PREVIEW_SIZE).toBe(100);
  });

  it('should be immutable (readonly)', () => {
    expect(() => {
      // @ts-expect-error - Testing immutability
      STREAM_LIMITS.MAX_BUFFER_SIZE = 999;
    }).toThrow();
  });
});

describe('FILE_SIGNATURES', () => {
  it('should have JPEG signature', () => {
    const jpeg = FILE_SIGNATURES.find((sig) => sig.mimeType === 'image/jpeg');
    expect(jpeg).toBeDefined();
    expect(jpeg?.signature).toEqual([0xff, 0xd8, 0xff]);
  });

  it('should have PNG signature', () => {
    const png = FILE_SIGNATURES.find((sig) => sig.mimeType === 'image/png');
    expect(png).toBeDefined();
    expect(png?.signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('should have GIF signature', () => {
    const gif = FILE_SIGNATURES.find((sig) => sig.mimeType === 'image/gif');
    expect(gif).toBeDefined();
    expect(gif?.signature).toEqual([0x47, 0x49, 0x46]);
  });

  it('should have WebP signature', () => {
    const webp = FILE_SIGNATURES.find((sig) => sig.mimeType === 'image/webp');
    expect(webp).toBeDefined();
    expect(webp?.signature).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  it('should have PDF signature', () => {
    const pdf = FILE_SIGNATURES.find((sig) => sig.mimeType === 'application/pdf');
    expect(pdf).toBeDefined();
    expect(pdf?.signature).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('should have gzip signature', () => {
    const gzip = FILE_SIGNATURES.find((sig) => sig.mimeType === 'application/gzip');
    expect(gzip).toBeDefined();
    expect(gzip?.signature).toEqual([0x1f, 0x8b]);
  });

  it('should have ZIP signature', () => {
    const zip = FILE_SIGNATURES.find((sig) => sig.mimeType === 'application/zip');
    expect(zip).toBeDefined();
    expect(zip?.signature).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('should contain at least 7 file signatures', () => {
    expect(FILE_SIGNATURES.length).toBeGreaterThanOrEqual(7);
  });

  it('should be immutable (readonly array)', () => {
    expect(() => {
      // @ts-expect-error - Testing immutability
      FILE_SIGNATURES.push({ signature: [0x00], mimeType: 'test' });
    }).toThrow();
  });

  it('should have readonly signature arrays', () => {
    const jpeg = FILE_SIGNATURES[0];
    expect(() => {
      // @ts-expect-error - Testing immutability
      jpeg.signature[0] = 0x00;
    }).toThrow();
  });
});

describe('isWebPFormat', () => {
  it('should detect valid WebP format', () => {
    // WebP: RIFF....WEBP
    const webp = Buffer.from([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x00,
      0x00,
      0x00,
      0x00, // Size (placeholder)
      0x57,
      0x45,
      0x42,
      0x50, // WEBP
    ]);

    expect(isWebPFormat(webp)).toBe(true);
  });

  it('should reject buffer with RIFF but no WEBP', () => {
    const notWebp = Buffer.from([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x00,
      0x00,
      0x00,
      0x00,
      0x41,
      0x56,
      0x49,
      0x20, // AVI (not WEBP)
    ]);

    expect(isWebPFormat(notWebp)).toBe(false);
  });

  it('should reject buffer without RIFF header', () => {
    const noRiff = Buffer.from([
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x57,
      0x45,
      0x42,
      0x50, // WEBP without RIFF
    ]);

    expect(isWebPFormat(noRiff)).toBe(false);
  });

  it('should reject buffer too short (less than 12 bytes)', () => {
    const tooShort = Buffer.from([0x52, 0x49, 0x46, 0x46]);

    expect(isWebPFormat(tooShort)).toBe(false);
  });

  it('should reject empty buffer', () => {
    const empty = Buffer.alloc(0);

    expect(isWebPFormat(empty)).toBe(false);
  });

  it('should handle buffer with correct length but wrong content', () => {
    const wrongContent = Buffer.alloc(12, 0xff);

    expect(isWebPFormat(wrongContent)).toBe(false);
  });
});

describe('FileSignature type', () => {
  it('should have correct structure', () => {
    const testSig: FileSignature = {
      signature: [0x00, 0x01],
      mimeType: 'test/type',
    };

    expect(testSig).toHaveProperty('signature');
    expect(testSig).toHaveProperty('mimeType');
    expect(testSig.offset).toBeUndefined();
  });

  it('should support optional offset property', () => {
    const testSigWithOffset: FileSignature = {
      signature: [0x00],
      mimeType: 'test/type',
      offset: 10,
    };

    expect(testSigWithOffset.offset).toBe(10);
  });
});
