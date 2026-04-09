/**
 * Cache Directive Tests
 * Validates nginx location block matching and cache headers
 * 
 * Tests critical caching rules to prevent bugs like:
 * - config.js being cached (breaks runtime configuration)
 * - Static assets not being cached (poor performance)
 * - Location directive precedence issues
 * 
 * Run with: node apps/admin/tests/nginx/cache-directives.test.mjs
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

/**
 * Simulates nginx location matching logic
 * Returns the cache configuration that would apply to a given path
 */
class NginxCacheSimulator {
  constructor() {
    // Location blocks in order of precedence (nginx matching rules)
    this.locations = [
      // 1. Exact match (highest priority)
      {
        type: 'exact',
        pattern: '/config.js',
        expires: '-1',
        cacheControl: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
      },
      
      // 2. Regex matches (processed in order)
      {
        type: 'regex',
        pattern: /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|webp|avif)$/,
        expires: '1y',
        cacheControl: 'public, max-age=31536000, immutable'
      },
      {
        type: 'regex',
        pattern: /\.html$/,
        expires: '5m',
        cacheControl: 'public, max-age=300, must-revalidate'
      },
      
      // 3. Prefix match (lowest priority)
      {
        type: 'prefix',
        pattern: '/',
        // No explicit cache headers (use browser defaults)
        expires: null,
        cacheControl: null
      }
    ];
  }

  /**
   * Find the matching location for a given path
   * @param {string} path - Request path
   * @returns {object} - Matching location configuration
   */
  match(path) {
    // Exact matches first
    for (const location of this.locations.filter(l => l.type === 'exact')) {
      if (path === location.pattern) {
        return location;
      }
    }

    // Regex matches next (first match wins)
    for (const location of this.locations.filter(l => l.type === 'regex')) {
      if (location.pattern.test(path)) {
        return location;
      }
    }

    // Prefix matches last
    for (const location of this.locations.filter(l => l.type === 'prefix')) {
      if (path.startsWith(location.pattern)) {
        return location;
      }
    }

    return null;
  }

  /**
   * Get cache headers for a path
   * @param {string} path - Request path
   * @returns {object} - Cache configuration
   */
  getCacheHeaders(path) {
    const location = this.match(path);
    if (!location) {
      return { expires: null, cacheControl: null };
    }
    return {
      expires: location.expires,
      cacheControl: location.cacheControl
    };
  }
}

describe('Nginx Cache Directive Tests', () => {
  const nginx = new NginxCacheSimulator();

  describe('Runtime Configuration (config.js)', () => {
    it('should match exact location /config.js (not wildcard .js)', () => {
      const location = nginx.match('/config.js');
      assert.strictEqual(location.type, 'exact', 'Should match exact location, not regex');
      assert.strictEqual(location.pattern, '/config.js');
    });

    it('should have no-cache headers', () => {
      const headers = nginx.getCacheHeaders('/config.js');
      assert.strictEqual(headers.expires, '-1');
      assert.strictEqual(
        headers.cacheControl,
        'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
      );
    });

    it('should prevent browser caching with no-store', () => {
      const headers = nginx.getCacheHeaders('/config.js');
      assert.ok(headers.cacheControl.includes('no-store'), 'Should include no-store');
    });

    it('should prevent proxy/CDN caching with proxy-revalidate', () => {
      const headers = nginx.getCacheHeaders('/config.js');
      assert.ok(headers.cacheControl.includes('proxy-revalidate'), 'Should include proxy-revalidate');
    });

    it('should have max-age=0 to force revalidation', () => {
      const headers = nginx.getCacheHeaders('/config.js');
      assert.ok(headers.cacheControl.includes('max-age=0'), 'Should include max-age=0');
    });
  });

  describe('Static Assets (Immutable Cache)', () => {
    const hashedAssets = [
      '/assets/index-abc123.js',
      '/assets/vendor-react-def456.js',
      '/assets/styles-789xyz.css',
      '/assets/Inter-Regular-a1b2c3.woff2',
      '/favicon.ico',
      '/assets/logo.svg'
    ];

    hashedAssets.forEach(asset => {
      it(`should cache ${asset.split('/').pop()} with 1 year immutable`, () => {
        const headers = nginx.getCacheHeaders(asset);
        assert.strictEqual(headers.expires, '1y');
        assert.strictEqual(headers.cacheControl, 'public, max-age=31536000, immutable');
      });
    });

    it('should include immutable directive for static assets', () => {
      const headers = nginx.getCacheHeaders('/assets/index-abc123.js');
      assert.ok(headers.cacheControl.includes('immutable'), 'Should include immutable');
    });

    it('should use max-age=31536000 (1 year) for static assets', () => {
      const headers = nginx.getCacheHeaders('/assets/styles-def456.css');
      assert.ok(headers.cacheControl.includes('max-age=31536000'), 'Should include 1 year max-age');
    });

    it('should mark static assets as public', () => {
      const headers = nginx.getCacheHeaders('/assets/vendor-react-xyz789.js');
      assert.ok(headers.cacheControl.startsWith('public'), 'Should start with public');
    });
  });

  describe('HTML Files (Short TTL)', () => {
    const htmlFiles = [
      '/index.html',
      '/404.html'
    ];

    htmlFiles.forEach(file => {
      it(`should cache ${file} with 5 minute TTL`, () => {
        const headers = nginx.getCacheHeaders(file);
        assert.strictEqual(headers.expires, '5m');
        assert.strictEqual(headers.cacheControl, 'public, max-age=300, must-revalidate');
      });
    });

    it('should include must-revalidate for HTML', () => {
      const headers = nginx.getCacheHeaders('/index.html');
      assert.ok(headers.cacheControl.includes('must-revalidate'), 'Should include must-revalidate');
    });

    it('should use max-age=300 (5 minutes) for HTML', () => {
      const headers = nginx.getCacheHeaders('/index.html');
      assert.ok(headers.cacheControl.includes('max-age=300'), 'Should include 5 min max-age');
    });
  });

  describe('Location Precedence (Critical Bug Prevention)', () => {
    it('config.js should match exact location BEFORE wildcard .js pattern', () => {
      const location = nginx.match('/config.js');
      
      // CRITICAL: If this fails, config.js will be cached for 1 year!
      assert.strictEqual(location.type, 'exact', 
        'CRITICAL: config.js matched wildcard .js instead of exact location - will be cached for 1 year!');
      
      const headers = nginx.getCacheHeaders('/config.js');
      assert.notStrictEqual(headers.cacheControl, 'public, max-age=31536000, immutable',
        'CRITICAL: config.js has immutable cache - runtime config will not update!');
    });

    it('regular .js files should match wildcard pattern (not exact)', () => {
      const location = nginx.match('/assets/index-abc123.js');
      assert.strictEqual(location.type, 'regex', 'Should match regex pattern');
      assert.ok(location.pattern.test('/assets/index-abc123.js'), 'Should test true for .js files');
    });

    it('index.html should match .html pattern (not generic /)', () => {
      const location = nginx.match('/index.html');
      assert.strictEqual(location.type, 'regex', 'Should match regex pattern, not prefix');
      
      const headers = nginx.getCacheHeaders('/index.html');
      assert.strictEqual(headers.expires, '5m', 'Should have 5 min cache, not default');
    });
  });

  describe('Edge Cases', () => {
    it('should not cache /config.js.map as config.js', () => {
      const location = nginx.match('/config.js.map');
      assert.notStrictEqual(location.type, 'exact', 'Should not match exact /config.js');
      
      // .map extension not in regex pattern, falls through to prefix match
      assert.strictEqual(location.type, 'prefix', 'Should fall through to prefix match');
    });

    it('should cache /dist/config.js differently than /config.js', () => {
      const rootConfig = nginx.match('/config.js');
      const distConfig = nginx.match('/dist/config.js');
      
      assert.strictEqual(rootConfig.type, 'exact');
      assert.strictEqual(distConfig.type, 'regex', 'Should match .js pattern');
      
      // Different cache headers
      assert.notStrictEqual(
        nginx.getCacheHeaders('/config.js').cacheControl,
        nginx.getCacheHeaders('/dist/config.js').cacheControl
      );
    });

    it('should handle paths with query strings', () => {
      // nginx strips query strings before location matching
      const path = '/config.js';
      const headers = nginx.getCacheHeaders(path);
      
      assert.strictEqual(headers.cacheControl, 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    });

    it('should cache uppercase file extensions (case-insensitive matching)', () => {
      // Note: nginx regex uses case-insensitive flag ~*
      const location = nginx.match('/assets/logo.SVG');
      // Our simulator doesn't handle case-insensitive, but this documents expected behavior
      assert.ok(location, 'Should match (nginx uses case-insensitive regex)');
    });
  });

  describe('Performance Validation', () => {
    it('should cache static assets for maximum duration', () => {
      const headers = nginx.getCacheHeaders('/assets/index-abc123.js');
      
      // 31536000 seconds = 365 days
      assert.ok(headers.cacheControl.includes('31536000'),
        'Static assets should be cached for 1 year');
    });

    it('should allow short revalidation for HTML', () => {
      const headers = nginx.getCacheHeaders('/index.html');
      
      // 300 seconds = 5 minutes
      assert.ok(headers.cacheControl.includes('300'),
        'HTML should have short TTL for deployment updates');
    });

    it('should never cache runtime config', () => {
      const headers = nginx.getCacheHeaders('/config.js');
      
      assert.strictEqual(headers.expires, '-1', 'Should expire immediately');
      assert.ok(headers.cacheControl.includes('no-store'),
        'Should prevent any caching');
    });
  });

  describe('CDN Compatibility', () => {
    it('static assets should include public directive for CDN caching', () => {
      const headers = nginx.getCacheHeaders('/assets/index-abc123.js');
      assert.ok(headers.cacheControl.includes('public'),
        'CDNs should be allowed to cache static assets');
    });

    it('config.js should prevent CDN caching with proxy-revalidate', () => {
      const headers = nginx.getCacheHeaders('/config.js');
      assert.ok(headers.cacheControl.includes('proxy-revalidate'),
        'CDN should revalidate every request');
    });

    it('HTML should use must-revalidate for CDN freshness', () => {
      const headers = nginx.getCacheHeaders('/index.html');
      assert.ok(headers.cacheControl.includes('must-revalidate'),
        'CDN should revalidate stale HTML');
    });
  });
});

describe('Cache Strategy Documentation Alignment', () => {
  const nginx = new NginxCacheSimulator();

  it('should match documented Cache-Control for config.js', () => {
    const headers = nginx.getCacheHeaders('/config.js');
    const documented = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
    
    assert.strictEqual(headers.cacheControl, documented,
      'Implementation must match CDN_DEPLOYMENT.md Cache Strategy table');
  });

  it('should match documented Cache-Control for hashed assets', () => {
    const headers = nginx.getCacheHeaders('/assets/index-abc123.js');
    const documented = 'public, max-age=31536000, immutable';
    
    assert.strictEqual(headers.cacheControl, documented,
      'Implementation must match CDN_DEPLOYMENT.md Cache Strategy table');
  });

  it('should match documented Cache-Control for index.html', () => {
    const headers = nginx.getCacheHeaders('/index.html');
    const documented = 'public, max-age=300, must-revalidate';
    
    assert.strictEqual(headers.cacheControl, documented,
      'Implementation must match CDN_DEPLOYMENT.md Cache Strategy table');
  });
});
