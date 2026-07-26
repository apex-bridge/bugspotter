/**
 * Nginx Security-Header Inheritance Tests (regression guard for #258)
 *
 * nginx does NOT inherit `add_header` directives into a `location` that defines
 * any `add_header` of its own. The admin config sets cache-control / CORS headers
 * per location, which silently strips the server-scope security headers (CSP,
 * HSTS, X-Frame-Options, ...) from every browser-facing response (HTML documents,
 * hashed assets, config.js) unless the security-header snippet is re-included in
 * each such location.
 *
 * These tests fail if any location defines its own add_header but does NOT
 * re-include the security-header snippet - i.e. they PROVE the header-drop bug
 * cannot silently return.
 *
 * Run with: node apps/admin/tests/nginx/security-headers.test.mjs
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ADMIN_DIR = join(__dirname, '../..');
const SNIPPETS_DIR = join(ADMIN_DIR, 'nginx-snippets');

// Each deployable config and the security-header snippet it must re-include.
const CONFIGS = [
  { name: 'nginx.conf.template', file: 'nginx.conf.template', snippet: 'security-headers.conf' },
  { name: 'nginx.conf', file: 'nginx.conf', snippet: 'security-headers-prod.conf' },
  { name: 'nginx.dev.conf', file: 'nginx.dev.conf', snippet: 'security-headers-dev.conf' },
];

/**
 * Extract every `location <spec> { ... }` block body via brace-depth matching.
 * (These configs do not nest locations, so first-level matching is sufficient.)
 * @returns {{spec: string, body: string}[]}
 */
function extractLocationBlocks(content) {
  const blocks = [];
  const re = /location\s+([^{]+?)\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const spec = m[1].trim();
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
      i++;
    }
    blocks.push({ spec, body: content.slice(start, i - 1) });
    re.lastIndex = i;
  }
  return blocks;
}

const includeLine = (snippet) => `include /etc/nginx/snippets/${snippet};`;

describe('Nginx security-header inheritance (#258 regression guard)', () => {
  for (const cfg of CONFIGS) {
    describe(cfg.name, () => {
      const content = readFileSync(join(ADMIN_DIR, cfg.file), 'utf-8');
      const wanted = includeLine(cfg.snippet);
      const locations = extractLocationBlocks(content);
      // Server scope = file with all location blocks removed.
      let serverScope = content;
      for (const loc of locations) {
        serverScope = serverScope.replace(loc.body, '');
      }

      it('applies the security-header snippet at server scope', () => {
        assert.ok(
          serverScope.includes(wanted),
          `${cfg.name} must include ${cfg.snippet} at server scope`
        );
      });

      it('re-applies the security-header snippet in EVERY location that sets its own add_header', () => {
        // Match actual `add_header` directives (line-start, optional indent), not
        // the substring - the location bodies carry comments that mention
        // "add_header" (e.g. "this location's add_header suppresses inheritance").
        const setsAddHeader = /^[ \t]*add_header\b/m;
        const offenders = locations
          .filter((loc) => setsAddHeader.test(loc.body))
          .filter((loc) => !loc.body.includes(wanted))
          .map((loc) => loc.spec);

        assert.deepStrictEqual(
          offenders,
          [],
          `These locations set add_header but drop the security headers (nginx does not ` +
            `inherit add_header into them) - re-include ${cfg.snippet}: ${offenders.join(', ')}`
        );
      });

      it('covers the browser-facing locations (config.js, assets, .html)', () => {
        // Guards against the offender list being trivially empty (e.g. locations renamed).
        const specs = locations.map((l) => l.spec);
        assert.ok(
          specs.some((s) => s.includes('/config.js')),
          `${cfg.name} should have a /config.js location`
        );
        assert.ok(
          specs.some((s) => s.includes('.html')),
          `${cfg.name} should have a .html location`
        );
        assert.ok(
          specs.some((s) => /\.\(js\|css/.test(s)),
          `${cfg.name} should have a static-asset location`
        );
      });
    });
  }

  describe('security-header snippets', () => {
    it('security-headers.conf.template carries the CSP with the envsubst fragment', () => {
      const snippet = readFileSync(join(SNIPPETS_DIR, 'security-headers.conf.template'), 'utf-8');
      assert.match(snippet, /Content-Security-Policy/, 'must define CSP');
      assert.match(snippet, /\$\{API_DOMAIN_CSP\}/, 'must keep the ${API_DOMAIN_CSP} fragment');
      assert.match(snippet, /style-src[^;]*'unsafe-inline'/, 'style-src must keep unsafe-inline');
    });

    it('every snippet carries a CSP with unsafe-inline for styles', () => {
      // Guards each snippet independently - deleting CSP from the prod or dev
      // snippet must not slip through on the template snippet's check alone.
      for (const snippet of [
        'security-headers.conf.template',
        'security-headers-prod.conf',
        'security-headers-dev.conf',
      ]) {
        const content = readFileSync(join(SNIPPETS_DIR, snippet), 'utf-8');
        assert.match(content, /Content-Security-Policy/, `${snippet} must define CSP`);
        assert.match(
          content,
          /style-src[^;]*'unsafe-inline'/,
          `${snippet} style-src must keep unsafe-inline`
        );
      }
    });

    it('every snippet umbrella pulls in the shared static headers', () => {
      for (const snippet of ['security-headers.conf.template', 'security-headers-prod.conf']) {
        const content = readFileSync(join(SNIPPETS_DIR, snippet), 'utf-8');
        for (const dep of [
          'security-headers-common.conf',
          'security-headers-hsts.conf',
          'security-headers-permissions.conf',
        ]) {
          assert.ok(content.includes(dep), `${snippet} must include ${dep}`);
        }
      }
      // Dev omits HSTS by design (runs on HTTP).
      const dev = readFileSync(join(SNIPPETS_DIR, 'security-headers-dev.conf'), 'utf-8');
      assert.ok(dev.includes('security-headers-common.conf'), 'dev must include common');
      assert.ok(dev.includes('security-headers-permissions.conf'), 'dev must include permissions');
      assert.ok(!dev.includes('security-headers-hsts.conf'), 'dev must NOT include HSTS');
    });
  });
});
