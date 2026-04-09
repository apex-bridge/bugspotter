/**
 * Polyfill for File and Blob globals required by undici in Node 18
 * https://github.com/nodejs/undici/issues/1650
 *
 * This must run before any code that imports undici (like testcontainers)
 */

import { Blob as NodeBlob } from 'node:buffer';

// Ensure Blob is available globally
if (typeof globalThis.Blob === 'undefined') {
  // @ts-expect-error - Polyfilling Blob for Node 18
  globalThis.Blob = NodeBlob;
}

// Add File polyfill for Node 18
if (typeof globalThis.File === 'undefined') {
  // Use the now-available global Blob or fallback to NodeBlob
  const BlobBase = globalThis.Blob || NodeBlob;

  // Create File class that extends Blob
  class FilePolyfill extends BlobBase {
    public readonly name: string;
    public readonly lastModified: number;

    constructor(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag) {
      super(fileBits, options);
      this.name = fileName;
      this.lastModified = options?.lastModified ?? Date.now();
    }

    // Add any missing File-specific properties
    get [Symbol.toStringTag]() {
      return 'File';
    }
  }

  // @ts-expect-error - Polyfilling File for Node 18
  globalThis.File = FilePolyfill;
}

export {};
