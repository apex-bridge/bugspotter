# Nginx Configuration Tests

This directory contains three types of tests for validating nginx configuration for the BugSpotter Admin UI.

## Test Types

### 1. ⭐ Config Validation Tests (NEW)

**File**: `config-validation.test.mjs` (23 tests)

**CRITICAL**: These tests **parse the actual nginx configuration files** and validate them.

**What it tests**:

- ✅ Reads real `nginx.conf`, `nginx.conf.template`, `nginx.dev.conf` files
- ✅ Validates critical directives exist (config.js cache prevention)
- ✅ Verifies CORS patterns in actual configs match expected regex
- ✅ Ensures Cache-Control headers match documentation exactly
- ✅ Tests configuration consistency across environments
- ✅ Validates location directive ordering (exact before regex)

**Real bugs this catches**:

- Missing `location = /config.js` directive
- Wrong Cache-Control header values (typos in actual file)
- CORS pattern syntax errors in nginx.conf
- Configuration drift between prod/dev/template
- Location directive ordering issues (exact after regex)

Run: `pnpm test:nginx:config`

### 2. CORS Pattern Tests

**File**: `cors-origin.test.mjs` (48 tests)

**Purpose**: Validates the **logic** of CORS domain validation patterns.

**What it tests**:

- Domain validation logic (what domains should/shouldn't match)
- Multi-level subdomain support for SaaS architecture
- Security test cases (domain hijacking, typosquatting)
- Edge cases (malformed URLs, protocols, ports)

**Limitation**: Tests the pattern logic but doesn't parse nginx files.

Run: `pnpm test:nginx:cors`

### 3. Cache Directive Tests

**File**: `cache-directives.test.mjs` (34 tests)

**Purpose**: **Simulates** nginx location matching behavior to document expected cache strategy.

**What it tests**:

- Nginx location precedence (exact → regex → prefix)
- Expected cache header values for different file types
- Location matching edge cases
- Documents expected behavior

**Limitation**: Simulates nginx logic but doesn't parse actual config files.

Run: `pnpm test:nginx:cache`

## Key Difference

| Test Type             | What It Tests            | Catches Real Config Bugs? | Purpose                          |
| --------------------- | ------------------------ | ------------------------- | -------------------------------- |
| **Config Validation** | **Actual nginx files**   | ✅ Yes                    | Catch typos, missing directives  |
| CORS Pattern          | Logic/pattern behavior   | ⚠️ Indirectly             | Document expected CORS behavior  |
| Cache Directives      | Simulated nginx behavior | ⚠️ Indirectly             | Document expected cache strategy |

**Critical Insight**: The **config validation tests are essential** for catching real bugs in production. The other tests document expected behavior but won't catch typos or missing directives in the actual nginx.conf files.

## Running Tests

```bash
# Run all nginx tests (config validation + CORS + cache)
pnpm test:nginx

# Run individual test suites
pnpm test:nginx:config    # Parse actual nginx files (23 tests)
pnpm test:nginx:cors      # CORS pattern logic (48 tests)
pnpm test:nginx:cache     # Cache directive simulation (34 tests)

# Or directly
node tests/nginx/config-validation.test.mjs
node tests/nginx/cors-origin.test.mjs
node tests/nginx/cache-directives.test.mjs
```

## Total Test Coverage

- **Config Validation**: 23 tests parsing actual files
- **CORS Patterns**: 48 tests for domain validation
- **Cache Directives**: 34 tests for cache strategy
- **Total**: **105 nginx tests**

## Config Validation Tests (NEW)

**What it validates in actual nginx files**:

1. **config.js Cache Prevention** (CRITICAL):

   ```nginx
   location = /config.js {
       expires -1;
       add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
   }
   ```

   - Exact location block exists
   - Cache-Control header exactly matches documentation
   - Location appears BEFORE wildcard `.js` pattern

2. **CORS Pattern Validation**:

   ```nginx
   map $http_origin $cors_origin {
       default "";
       "~^https?://([a-z0-9-]+\.)*bugspotter\.io$" $http_origin;
   }
   ```

   - Map directive exists in all configs
   - Pattern uses `*` (not `?`) for multi-level subdomains
   - Pattern identical across prod/dev/template

3. **Static Asset Caching**:

   ```nginx
   location ~* \.(js|css|...)$ {
       add_header Cache-Control "public, max-age=31536000, immutable";
   }
   ```

   - Cache-Control exactly matches documented value

4. **HTML Caching**:

   ```nginx
   location ~* \.html$ {
       add_header Cache-Control "public, max-age=300, must-revalidate";
   }
   ```

   - Short TTL with revalidation

5. **Consistency Checks**:
   - All three configs have identical critical directives
   - No drift between production/development/template

6. **Regression Protection**:
   - Prevents January 2025 config.js caching bug from recurring
   - Tests for exact symptom (missing location block)

## Cache Directive Tests

**File**: `cache-directives.test.mjs`

Tests nginx location block matching and `Cache-Control` headers to prevent production bugs.

### Critical Bug Prevention

**Problem this prevents**: In January 2025, we discovered `nginx.conf` was missing the `config.js` cache directive. Without it, the wildcard `*.js` rule would cache `config.js` for 1 year with `immutable`, breaking runtime configuration updates.

**Impact**: Runtime configuration changes (API URL updates) would not take effect without rebuilding Docker images.

### What it tests

1. **Runtime Configuration (config.js)**:
   - Matches exact location `/config.js` (not wildcard `.js` regex)
   - Has `no-store, no-cache` headers (prevents browser/CDN caching)
   - Includes `proxy-revalidate` (forces CDN revalidation)
   - max-age=0 (no caching duration)

2. **Static Assets (Immutable Cache)**:
   - Hashed assets (.js, .css, .woff2) cached for 1 year
   - Includes `immutable` directive (browser optimization)
   - Uses `public` directive (CDN caching allowed)
   - max-age=31536000 (1 year in seconds)

3. **HTML Files (Short TTL)**:
   - index.html cached for 5 minutes
   - Includes `must-revalidate` (forces revalidation when stale)
   - max-age=300 (5 minutes in seconds)

4. **Location Precedence (Critical)**:
   - Verifies config.js matches exact location BEFORE regex patterns
   - Tests that regular .js files still match wildcard pattern
   - Ensures HTML files match .html pattern (not generic `/`)

5. **Edge Cases**:
   - `/config.js.map` doesn't match exact `/config.js`
   - `/dist/config.js` matches `.js` pattern (not exact)
   - Query strings handled correctly

6. **Documentation Alignment**:
   - Validates Cache-Control matches CDN_DEPLOYMENT.md table
   - Ensures implementation matches documented behavior

### The Patterns

```nginx
# CRITICAL: Exact match (highest priority) - config.js must never be cached
location = /config.js {
    expires -1;
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
}

# Regex match - long-term caching for hashed static assets
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|webp|avif)$ {
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

# Regex match - short TTL for HTML
location ~* \.html$ {
    expires 5m;
    add_header Cache-Control "public, max-age=300, must-revalidate";
}
```

### Nginx Location Matching Order

Understanding nginx location precedence is **critical** for correct caching:

1. **Exact match** (`=`): Highest priority, stops searching
2. **Regex match** (`~*`): Processed in order, first match wins
3. **Prefix match** (no modifier): Lowest priority

**Why this matters**: If we removed the exact `location = /config.js` block, the wildcard `location ~* \.(js|...)$` would match first and apply 1-year caching to config.js!

### Implementation

These patterns are used in:

- `apps/admin/nginx.conf` (production)
- `apps/admin/nginx.conf.template` (Docker template)
- `apps/admin/nginx.dev.conf` (development)

All three configs must have the `config.js` directive or runtime configuration will be broken.

## CORS Origin Pattern Tests (48 tests)

**File**: `cors-origin.test.mjs`

Tests the CORS `Access-Control-Allow-Origin` regex pattern used in nginx map directive to validate `*.bugspotter.io` domains.

### Running the tests

```bash
# From repository root
node apps/admin/tests/nginx/cors-origin.test.mjs

# Or with npm/pnpm
cd apps/admin
pnpm test:nginx
```

### What it tests

1. **Valid Origins** (48 test cases total):
   - Root domain: `https://bugspotter.io`
   - Single-level subdomains: `https://app.bugspotter.io`
   - Multi-level subdomains: `https://acme-corp.kz.saas.bugspotter.io`
   - SaaS tenant URLs: `https://tenant.region.app.bugspotter.io`

2. **Invalid Origins** (should be blocked):
   - Wrong domains: `https://example.com`
   - Subdomain hijacking: `https://bugspotter.io.evil.com`
   - Typosquatting: `https://bugspotter.com`
   - Invalid protocols: `ftp://`, `ws://`
   - Paths and ports: `https://app.bugspotter.io:3000`

3. **Security Test Cases**:
   - Domain hijacking attempts
   - Partial domain matches
   - Query strings and fragments
   - User info in URLs

4. **Multi-tenant SaaS Test Cases**:
   - 2-level, 3-level, 4-level subdomains
   - Region-based tenant URLs

### The Pattern

```nginx
map $http_origin $cors_origin {
    default "";
    "~^https?://([a-z0-9-]+\.)*bugspotter\.io$" $http_origin;
}
```

**Pattern breakdown**:

- `^https?://` - Must start with http:// or https://
- `([a-z0-9-]+\.)*` - Zero or more subdomains (lowercase letters, numbers, hyphens)
- `bugspotter\.io$` - Must end with bugspotter.io

**Why `*` instead of `?`**:

- `?` matches 0 or 1 subdomain: `app.bugspotter.io` ✅, `acme.kz.saas.bugspotter.io` ❌
- `*` matches 0 or more subdomains: both work ✅

This supports multi-tenant SaaS architecture where customers get URLs like:

- `https://acme-corp.saas.bugspotter.io`
- `https://acme-corp.kz.saas.bugspotter.io` (with region)
- `https://team1.acme-corp.kz.saas.bugspotter.io` (with workspace)

### Implementation

The pattern is used in these nginx configs:

- `apps/admin/nginx.conf` (production)
- `apps/admin/nginx.conf.template` (Docker template)
- `apps/admin/nginx.dev.conf` (development)

When a request comes with an `Origin` header:

1. Nginx checks if it matches the pattern
2. If match: `$cors_origin` = the Origin value → CORS allowed
3. If no match: `$cors_origin` = empty string → CORS blocked

### Adding to CI/CD

Add to `package.json`:

```json
{
  "scripts": {
    "test:nginx": "node tests/nginx/cors-origin.test.mjs"
  }
}
```

Then run in CI pipeline before nginx deployment to catch regex issues early.
