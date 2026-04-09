/**
 * Nginx Configuration File Validation Tests
 * Validates the ACTUAL nginx.conf files (not simulated behavior)
 *
 * This test parses the real nginx configuration files and verifies:
 * - Critical directives exist (config.js cache prevention)
 * - Regex patterns are correct (CORS validation)
 * - Cache-Control headers match documentation
 *
 * Run with: node apps/admin/tests/nginx/config-validation.test.mjs
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths to actual nginx config files
const NGINX_CONFIGS = {
  production: join(__dirname, '../../nginx.conf'),
  template: join(__dirname, '../../nginx.conf.template'),
  development: join(__dirname, '../../nginx.dev.conf'),
};

/**
 * Parse nginx config file and extract location blocks
 * @param {string} configPath - Path to nginx config file
 * @returns {object} - Parsed configuration data
 */
function parseNginxConfig(configPath) {
  const content = readFileSync(configPath, 'utf-8');

  return {
    raw: content,

    // Extract CORS map directive pattern
    getCorsPattern: () => {
      const mapMatch = content.match(/map\s+\$http_origin\s+\$cors_origin\s*\{[^}]*"~\^([^"]+)"/);
      return mapMatch ? mapMatch[1] : null;
    },

    // Check if exact location for config.js exists
    hasConfigJsLocation: () => {
      return /location\s*=\s*\/config\.js\s*\{/.test(content);
    },

    // Extract config.js cache headers
    getConfigJsCacheControl: () => {
      const locationMatch = content.match(/location\s*=\s*\/config\.js\s*\{([^}]*)\}/s);
      if (!locationMatch) {
        return null;
      }

      const locationBlock = locationMatch[1];
      const cacheControlMatch = locationBlock.match(/Cache-Control\s+"([^"]+)"/);
      return cacheControlMatch ? cacheControlMatch[1] : null;
    },

    // Extract static asset regex pattern
    getStaticAssetPattern: () => {
      const match = content.match(/location\s*~\*\s*\\\.([^$]+)\$\s*\{/);
      return match ? match[1] : null;
    },

    // Extract static asset cache headers
    getStaticAssetCacheControl: () => {
      const locationMatch = content.match(
        /location\s*~\*\s*\\\.\(js\|css[^}]+Cache-Control\s+"([^"]+)"/s
      );
      return locationMatch ? locationMatch[1] : null;
    },

    // Check if static assets have Vary: Origin header (critical for CDN caching with dynamic CORS)
    hasVaryOriginHeader: () => {
      const locationMatch = content.match(/location\s*~\*\s*\\\.\(js\|css[^}]+/s);
      if (!locationMatch) {
        return false;
      }

      const locationBlock = locationMatch[0];
      return /add_header\s+Vary\s+Origin/i.test(locationBlock);
    },

    // Extract HTML cache headers
    getHtmlCacheControl: () => {
      const locationMatch = content.match(
        /location\s*~\*\s*\\\.html\$[^}]+Cache-Control\s+"([^"]+)"/s
      );
      return locationMatch ? locationMatch[1] : null;
    },

    // Check if location exists before another location (precedence)
    locationPrecedence: (exact) => {
      const exactPos = content.indexOf(`location = ${exact}`);
      const regexPos = content.indexOf(`location ~*`);

      if (exactPos === -1) {
        return false;
      }
      return exactPos < regexPos; // Exact should come before regex
    },
  };
}

describe('Nginx Configuration File Validation', () => {
  describe('Production nginx.conf', () => {
    const config = parseNginxConfig(NGINX_CONFIGS.production);

    it('should exist and be readable', () => {
      assert.ok(config.raw.length > 0, 'nginx.conf should not be empty');
    });

    it('should have CORS map directive with bugspotter.io pattern', () => {
      const pattern = config.getCorsPattern();
      assert.ok(pattern, 'CORS map directive should exist');
      assert.match(pattern, /bugspotter\\\.io/, 'Should validate bugspotter.io domain');
    });

    it('CORS pattern should use * quantifier for multi-level subdomains', () => {
      const pattern = config.getCorsPattern();
      assert.match(
        pattern,
        /\(\[a-z0-9-\]\+\\\.\)\*/,
        'Should use * (not ?) for multi-level subdomain support'
      );
    });

    it('should have exact location block for /config.js', () => {
      assert.ok(
        config.hasConfigJsLocation(),
        'CRITICAL: Missing exact location = /config.js block - config will be cached!'
      );
    });

    it('config.js should have no-cache Cache-Control headers', () => {
      const cacheControl = config.getConfigJsCacheControl();
      assert.ok(cacheControl, 'config.js location should have Cache-Control header');
      assert.match(cacheControl, /no-store/, 'Should include no-store');
      assert.match(cacheControl, /no-cache/, 'Should include no-cache');
      assert.match(cacheControl, /must-revalidate/, 'Should include must-revalidate');
      assert.match(cacheControl, /proxy-revalidate/, 'Should include proxy-revalidate');
      assert.match(cacheControl, /max-age=0/, 'Should include max-age=0');
    });

    it('config.js exact location should appear BEFORE wildcard .js location', () => {
      assert.ok(
        config.locationPrecedence('/config.js'),
        'CRITICAL: config.js exact location must appear before regex to prevent caching!'
      );
    });

    it('static assets should have immutable cache headers', () => {
      const cacheControl = config.getStaticAssetCacheControl();
      assert.ok(cacheControl, 'Static assets should have Cache-Control header');
      assert.match(cacheControl, /public/, 'Should include public');
      assert.match(cacheControl, /max-age=31536000/, 'Should include 1 year max-age');
      assert.match(cacheControl, /immutable/, 'Should include immutable');
    });

    it('HTML files should have short TTL cache headers', () => {
      const cacheControl = config.getHtmlCacheControl();
      assert.ok(cacheControl, 'HTML files should have Cache-Control header');
      assert.match(cacheControl, /public/, 'Should include public');
      assert.match(cacheControl, /max-age=300/, 'Should include 5 min max-age');
      assert.match(cacheControl, /must-revalidate/, 'Should include must-revalidate');
    });

    it('static assets MUST have Vary: Origin header to prevent CDN caching issues', () => {
      assert.ok(
        config.hasVaryOriginHeader(),
        'CRITICAL: Missing Vary: Origin header! CDN will cache wrong CORS headers causing random CORS failures.'
      );
    });
  });

  describe('Template nginx.conf.template', () => {
    const config = parseNginxConfig(NGINX_CONFIGS.template);

    it('should exist and be readable', () => {
      assert.ok(config.raw.length > 0, 'nginx.conf.template should not be empty');
    });

    it('should have exact location block for /config.js', () => {
      assert.ok(config.hasConfigJsLocation(), 'Template should have config.js location block');
    });

    it('config.js should have no-cache Cache-Control headers', () => {
      const cacheControl = config.getConfigJsCacheControl();
      assert.ok(cacheControl, 'config.js location should have Cache-Control header');
      assert.match(cacheControl, /no-store/, 'Should include no-store');
      assert.match(cacheControl, /no-cache/, 'Should include no-cache');
    });

    it('should have CORS map directive', () => {
      const pattern = config.getCorsPattern();
      assert.ok(pattern, 'CORS map directive should exist');
    });

    it('static assets MUST have Vary: Origin header', () => {
      assert.ok(
        config.hasVaryOriginHeader(),
        'Template missing Vary: Origin header for CDN caching'
      );
    });
  });

  describe('Development nginx.dev.conf', () => {
    const config = parseNginxConfig(NGINX_CONFIGS.development);

    it('should exist and be readable', () => {
      assert.ok(config.raw.length > 0, 'nginx.dev.conf should not be empty');
    });

    it('should have exact location block for /config.js', () => {
      assert.ok(config.hasConfigJsLocation(), 'Dev config should have config.js location block');
    });

    it('config.js should have no-cache Cache-Control headers', () => {
      const cacheControl = config.getConfigJsCacheControl();
      assert.ok(cacheControl, 'config.js location should have Cache-Control header');
      assert.match(cacheControl, /no-store/, 'Should include no-store');
      assert.match(cacheControl, /no-cache/, 'Should include no-cache');
    });

    it('static assets MUST have Vary: Origin header', () => {
      assert.ok(
        config.hasVaryOriginHeader(),
        'Dev config missing Vary: Origin header for CDN caching'
      );
    });
  });

  describe('Configuration Consistency Across Environments', () => {
    const prodConfig = parseNginxConfig(NGINX_CONFIGS.production);
    const templateConfig = parseNginxConfig(NGINX_CONFIGS.template);
    const devConfig = parseNginxConfig(NGINX_CONFIGS.development);

    it('all configs should have config.js exact location', () => {
      assert.ok(prodConfig.hasConfigJsLocation(), 'Production missing config.js location');
      assert.ok(templateConfig.hasConfigJsLocation(), 'Template missing config.js location');
      assert.ok(devConfig.hasConfigJsLocation(), 'Development missing config.js location');
    });

    it('config.js Cache-Control headers should be identical', () => {
      const prodHeaders = prodConfig.getConfigJsCacheControl();
      const templateHeaders = templateConfig.getConfigJsCacheControl();
      const devHeaders = devConfig.getConfigJsCacheControl();

      assert.strictEqual(
        prodHeaders,
        templateHeaders,
        'Production and template config.js headers should match'
      );
      assert.strictEqual(
        prodHeaders,
        devHeaders,
        'Production and dev config.js headers should match'
      );
    });

    it('all configs should have CORS map directive', () => {
      assert.ok(prodConfig.getCorsPattern(), 'Production missing CORS map');
      assert.ok(templateConfig.getCorsPattern(), 'Template missing CORS map');
      assert.ok(devConfig.getCorsPattern(), 'Development missing CORS map');
    });

    it('CORS patterns should be identical across configs', () => {
      const prodPattern = prodConfig.getCorsPattern();
      const templatePattern = templateConfig.getCorsPattern();
      const devPattern = devConfig.getCorsPattern();

      assert.strictEqual(
        prodPattern,
        templatePattern,
        'Production and template CORS patterns should match'
      );
      assert.strictEqual(prodPattern, devPattern, 'Production and dev CORS patterns should match');
    });
  });

  describe('Documentation Alignment', () => {
    const config = parseNginxConfig(NGINX_CONFIGS.production);

    it('config.js Cache-Control should match CDN_DEPLOYMENT.md', () => {
      const cacheControl = config.getConfigJsCacheControl();
      const documented = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';

      assert.strictEqual(
        cacheControl,
        documented,
        'config.js headers must match CDN_DEPLOYMENT.md Cache Strategy table'
      );
    });

    it('static assets Cache-Control should match CDN_DEPLOYMENT.md', () => {
      const cacheControl = config.getStaticAssetCacheControl();
      const documented = 'public, max-age=31536000, immutable';

      assert.strictEqual(
        cacheControl,
        documented,
        'Static asset headers must match CDN_DEPLOYMENT.md Cache Strategy table'
      );
    });

    it('HTML Cache-Control should match CDN_DEPLOYMENT.md', () => {
      const cacheControl = config.getHtmlCacheControl();
      const documented = 'public, max-age=300, must-revalidate';

      assert.strictEqual(
        cacheControl,
        documented,
        'HTML headers must match CDN_DEPLOYMENT.md Cache Strategy table'
      );
    });
  });
});

describe('Regression Protection', () => {
  const config = parseNginxConfig(NGINX_CONFIGS.production);

  it('should prevent config.js caching bug (January 2025 incident)', () => {
    // This test prevents the exact bug we discovered
    assert.ok(
      config.hasConfigJsLocation(),
      'CRITICAL REGRESSION: Missing config.js location block!'
    );

    const cacheControl = config.getConfigJsCacheControl();
    assert.notStrictEqual(
      cacheControl,
      'public, max-age=31536000, immutable',
      'CRITICAL REGRESSION: config.js has immutable cache headers!'
    );

    assert.ok(
      config.locationPrecedence('/config.js'),
      'CRITICAL REGRESSION: config.js location appears after wildcard pattern!'
    );
  });
});
