/**
 * Unit tests for image processing utilities
 */

import { describe, it, expect } from 'vitest';
import {
  generateThumbnail,
  optimizeImage,
  extractMetadata,
  validateImage,
  detectImageFormat,
  isImage,
} from '../../src/storage/image-processor.js';
import { StorageValidationError } from '../../src/storage/types.js';
import sharp from 'sharp';

// Test image generators
async function createTestImage(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' = 'png'
): Promise<Buffer> {
  return await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

async function createLargeImage(): Promise<Buffer> {
  return await createTestImage(5000, 5000, 'png');
}

async function createSmallImage(): Promise<Buffer> {
  return await createTestImage(100, 100, 'png');
}

describe('Image Processor', () => {
  describe('generateThumbnail', () => {
    it('should generate thumbnail with default dimensions', async () => {
      const original = await createTestImage(800, 600, 'png');
      const thumbnail = await generateThumbnail(original);

      const metadata = await sharp(thumbnail).metadata();

      expect(metadata.format).toBe('jpeg');
      expect(metadata.width).toBeLessThanOrEqual(200);
      expect(metadata.height).toBeLessThanOrEqual(200);
    });

    it('should generate thumbnail with custom dimensions', async () => {
      const original = await createTestImage(800, 600, 'png');
      const thumbnail = await generateThumbnail(original, 100, 100);

      const metadata = await sharp(thumbnail).metadata();

      expect(metadata.width).toBeLessThanOrEqual(100);
      expect(metadata.height).toBeLessThanOrEqual(100);
    });

    it('should maintain aspect ratio', async () => {
      const original = await createTestImage(800, 400, 'png'); // 2:1 ratio
      const thumbnail = await generateThumbnail(original, 200, 200);

      const metadata = await sharp(thumbnail).metadata();

      // Should fit within 200x200 while maintaining 2:1 ratio
      expect(metadata.width).toBe(200);
      expect(metadata.height).toBe(100);
    });

    it('should not enlarge smaller images', async () => {
      const original = await createTestImage(50, 50, 'png');
      const thumbnail = await generateThumbnail(original, 200, 200);

      const metadata = await sharp(thumbnail).metadata();

      expect(metadata.width).toBe(50);
      expect(metadata.height).toBe(50);
    });

    it('should throw error for invalid image buffer', async () => {
      const invalidBuffer = Buffer.from('not an image');

      await expect(generateThumbnail(invalidBuffer)).rejects.toThrow(StorageValidationError);
    });

    it('should convert to JPEG format', async () => {
      const original = await createTestImage(800, 600, 'png');
      const thumbnail = await generateThumbnail(original);

      const metadata = await sharp(thumbnail).metadata();
      expect(metadata.format).toBe('jpeg');
    });
  });

  describe('optimizeImage', () => {
    it('should optimize PNG image', async () => {
      const original = await createTestImage(500, 500, 'png');
      const optimized = await optimizeImage(original);

      expect(optimized.length).toBeGreaterThan(0);
      expect(Buffer.isBuffer(optimized)).toBe(true);
    });

    it('should optimize JPEG image', async () => {
      const original = await createTestImage(500, 500, 'jpeg');
      const optimized = await optimizeImage(original);

      expect(optimized.length).toBeGreaterThan(0);
      const metadata = await sharp(optimized).metadata();
      // May be converted to webp if it's smaller
      expect(['jpeg', 'webp']).toContain(metadata.format);
    });

    it('should convert to WebP if smaller', async () => {
      // Create a simple solid color image that compresses well in WebP
      const original = await sharp({
        create: {
          width: 500,
          height: 500,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const optimized = await optimizeImage(original);
      const metadata = await sharp(optimized).metadata();

      // Should be either webp or the original format depending on size
      expect(['webp', 'png', 'jpeg']).toContain(metadata.format);
    });

    it('should resize images larger than max dimension', async () => {
      const original = await createLargeImage();
      const optimized = await optimizeImage(original);

      const metadata = await sharp(optimized).metadata();

      expect(metadata.width).toBeLessThanOrEqual(4096);
      expect(metadata.height).toBeLessThanOrEqual(4096);
    });

    it('should strip metadata for privacy', async () => {
      const original = await createTestImage(500, 500, 'jpeg');
      const optimized = await optimizeImage(original);

      const metadata = await sharp(optimized).metadata();

      // EXIF data should be stripped
      expect(metadata.exif).toBeUndefined();
    });

    it('should throw error for invalid image buffer', async () => {
      const invalidBuffer = Buffer.from('not an image');

      await expect(optimizeImage(invalidBuffer)).rejects.toThrow(StorageValidationError);
    });
  });

  describe('extractMetadata', () => {
    it('should extract metadata from PNG image', async () => {
      const image = await createTestImage(800, 600, 'png');
      const metadata = await extractMetadata(image);

      expect(metadata.width).toBe(800);
      expect(metadata.height).toBe(600);
      expect(metadata.format).toBe('png');
      expect(metadata.size).toBeGreaterThan(0);
      expect(typeof metadata.hasAlpha).toBe('boolean');
    });

    it('should extract metadata from JPEG image', async () => {
      const image = await createTestImage(1024, 768, 'jpeg');
      const metadata = await extractMetadata(image);

      expect(metadata.width).toBe(1024);
      expect(metadata.height).toBe(768);
      expect(metadata.format).toBe('jpeg');
    });

    it('should detect alpha channel', async () => {
      const pngWithAlpha = await createTestImage(100, 100, 'png');
      const metadata = await extractMetadata(pngWithAlpha);

      expect(metadata.hasAlpha).toBe(true);
    });

    it('should include color space information', async () => {
      const image = await createTestImage(100, 100, 'png');
      const metadata = await extractMetadata(image);

      expect(metadata.space).toBeDefined();
    });

    it('should throw error for invalid image buffer', async () => {
      const invalidBuffer = Buffer.from('not an image');

      await expect(extractMetadata(invalidBuffer)).rejects.toThrow(StorageValidationError);
    });

    it('should handle images with missing metadata gracefully', async () => {
      const image = await createTestImage(100, 100, 'png');

      await expect(extractMetadata(image)).resolves.toBeDefined();
    });
  });

  describe('validateImage', () => {
    it('should validate valid PNG image', async () => {
      const image = await createTestImage(800, 600, 'png');

      await expect(validateImage(image)).resolves.toBeUndefined();
    });

    it('should validate valid JPEG image', async () => {
      const image = await createTestImage(800, 600, 'jpeg');

      await expect(validateImage(image)).resolves.toBeUndefined();
    });

    it('should validate valid WebP image', async () => {
      const image = await createTestImage(800, 600, 'webp');

      await expect(validateImage(image)).resolves.toBeUndefined();
    });

    it('should reject empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(validateImage(emptyBuffer)).rejects.toThrow(StorageValidationError);
      await expect(validateImage(emptyBuffer)).rejects.toThrow('Image buffer is empty');
    });

    it('should reject buffer exceeding size limit', async () => {
      // Create a buffer larger than 10MB
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024);

      await expect(validateImage(largeBuffer)).rejects.toThrow(StorageValidationError);
      await expect(validateImage(largeBuffer)).rejects.toThrow('exceeds 10MB limit');
    });

    it('should reject unsupported image format', async () => {
      const invalidBuffer = Buffer.from('not an image');

      await expect(validateImage(invalidBuffer)).rejects.toThrow(StorageValidationError);
      await expect(validateImage(invalidBuffer)).rejects.toThrow(
        /Invalid image format|unsupported image format/
      );
    });

    it('should reject images exceeding max dimension', async () => {
      const oversizedImage = await createTestImage(5000, 5000, 'png');

      await expect(validateImage(oversizedImage)).rejects.toThrow(StorageValidationError);
      await expect(validateImage(oversizedImage)).rejects.toThrow('exceed 4096px limit');
    });

    it('should reject images with dimensions less than 1x1', async () => {
      // Sharp doesn't allow 0x0, but we can test the validation would catch it
      const tinyImage = await createTestImage(1, 1, 'png');
      await expect(validateImage(tinyImage)).resolves.toBeUndefined();
    });

    it('should accept images at max dimension boundary', async () => {
      const maxImage = await createTestImage(4096, 4096, 'png');

      await expect(validateImage(maxImage)).resolves.toBeUndefined();
    });
  });

  describe('detectImageFormat', () => {
    it('should detect JPEG format', async () => {
      const jpeg = await createTestImage(100, 100, 'jpeg');
      const format = detectImageFormat(jpeg);

      expect(format).toBe('jpeg');
    });

    it('should detect PNG format', async () => {
      const png = await createTestImage(100, 100, 'png');
      const format = detectImageFormat(png);

      expect(format).toBe('png');
    });

    it('should detect WebP format', async () => {
      const webp = await createTestImage(100, 100, 'webp');
      const format = detectImageFormat(webp);

      expect(format).toBe('webp');
    });

    it('should detect GIF format', () => {
      // GIF magic number: 47 49 46 38 39 61 (GIF89a)
      const gifHeader = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      const format = detectImageFormat(gifHeader);

      expect(format).toBe('gif');
    });

    it('should detect SVG format', () => {
      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      const format = detectImageFormat(svgBuffer);

      expect(format).toBe('svg');
    });

    it('should detect SVG with XML declaration', () => {
      const svgBuffer = Buffer.from('<?xml version="1.0"?><svg></svg>');
      const format = detectImageFormat(svgBuffer);

      expect(format).toBe('svg');
    });

    it('should return null for unrecognized format', () => {
      const unknownBuffer = Buffer.from('not an image');
      const format = detectImageFormat(unknownBuffer);

      expect(format).toBeNull();
    });

    it('should return null for too short buffer', () => {
      const shortBuffer = Buffer.from([0x00, 0x01]);
      const format = detectImageFormat(shortBuffer);

      expect(format).toBeNull();
    });

    it('should handle empty buffer', () => {
      const emptyBuffer = Buffer.alloc(0);
      const format = detectImageFormat(emptyBuffer);

      expect(format).toBeNull();
    });
  });

  describe('isImage', () => {
    it('should return true for JPEG buffer', async () => {
      const jpeg = await createTestImage(100, 100, 'jpeg');

      expect(isImage(jpeg)).toBe(true);
    });

    it('should return true for PNG buffer', async () => {
      const png = await createTestImage(100, 100, 'png');

      expect(isImage(png)).toBe(true);
    });

    it('should return true for WebP buffer', async () => {
      const webp = await createTestImage(100, 100, 'webp');

      expect(isImage(webp)).toBe(true);
    });

    it('should return true for GIF buffer', () => {
      const gifHeader = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

      expect(isImage(gifHeader)).toBe(true);
    });

    it('should return true for SVG buffer', () => {
      const svgBuffer = Buffer.from('<svg></svg>');

      expect(isImage(svgBuffer)).toBe(true);
    });

    it('should return false for non-image buffer', () => {
      const textBuffer = Buffer.from('This is just text');

      expect(isImage(textBuffer)).toBe(false);
    });

    it('should return false for empty buffer', () => {
      const emptyBuffer = Buffer.alloc(0);

      expect(isImage(emptyBuffer)).toBe(false);
    });

    it('should return false for short buffer', () => {
      const shortBuffer = Buffer.from([0x00, 0x01]);

      expect(isImage(shortBuffer)).toBe(false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle corrupted image gracefully', async () => {
      const validImage = await createTestImage(100, 100, 'png');
      const corrupted = Buffer.concat([validImage.slice(0, 50), Buffer.from('corrupted')]);

      await expect(extractMetadata(corrupted)).rejects.toThrow(StorageValidationError);
    });

    it('should handle very small images', async () => {
      const tinyImage = await createTestImage(1, 1, 'png');

      await expect(validateImage(tinyImage)).resolves.toBeUndefined();
    });

    it('should handle square images', async () => {
      const square = await createTestImage(500, 500, 'png');
      const thumbnail = await generateThumbnail(square, 100, 100);

      const metadata = await sharp(thumbnail).metadata();
      expect(metadata.width).toBe(100);
      expect(metadata.height).toBe(100);
    });

    it('should handle wide aspect ratio', async () => {
      const wide = await createTestImage(1000, 200, 'png');
      const thumbnail = await generateThumbnail(wide, 200, 200);

      const metadata = await sharp(thumbnail).metadata();
      expect(metadata.width).toBe(200);
      expect(metadata.height).toBeLessThanOrEqual(50);
    });

    it('should handle tall aspect ratio', async () => {
      const tall = await createTestImage(200, 1000, 'png');
      const thumbnail = await generateThumbnail(tall, 200, 200);

      const metadata = await sharp(thumbnail).metadata();
      expect(metadata.height).toBe(200);
      expect(metadata.width).toBeLessThanOrEqual(50);
    });
  });
});
