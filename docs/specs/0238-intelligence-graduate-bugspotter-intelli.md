# Spec: intelligence: graduate bugspotter-intelligence scaffold to production-ready service

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #238
ADR: n/a

**Files touched:**

- `packages/bugspotter-intelligence/package.json` (new)
- `packages/bugspotter-intelligence/tsconfig.json` (new)
- `packages/bugspotter-intelligence/vitest.config.ts` (new)
- `packages/bugspotter-intelligence/src/errors.ts` (new)
- `packages/bugspotter-intelligence/src/utils/threshold.ts`
- `packages/bugspotter-intelligence/src/routes/bugs/similar.ts`
- `packages/bugspotter-intelligence/src/routes/bugs/mitigations.ts`
- `packages/bugspotter-intelligence/tests/utils/threshold.test.ts`
- `packages/bugspotter-intelligence/tests/routes/bugs/similar.test.ts` (new)
- `packages/bugspotter-intelligence/tests/routes/bugs/mitigations.test.ts` (new)

**Blocking prerequisites:** none

## Problem

`packages/bugspotter-intelligence` was scaffolded in #226 but cannot be used in production: its routes return empty arrays instead of real results, accept every request without authentication or tenant-ownership verification (enabling cross-tenant data leakage), and the package has no `package.json`, `tsconfig.json`, or `vitest.config.ts`, so CI never discovers or runs the unit tests in `tests/`. `@sinclair/typebox` is imported by both route files but is absent from `pnpm-lock.yaml`, causing resolution failures at build time. `threshold.ts` contains two `TODO` comments and throws plain `Error` instead of `AppError`, bypassing Fastify's structured error handler and returning unformatted 500 responses to every out-of-range input.

## Out of scope

- Implementing the similarity or mitigation algorithms themselves — service implementations are consumed here, not defined in this package.
- Migrating or modifying existing backend intelligence routes under `packages/backend/src/api/routes/`.
- Adding integration or end-to-end tests that require a live database or external HTTP.
- Registering `@bugspotter/intelligence` as a mounted sub-app inside the backend server — that wiring is a follow-on task.

## Constraints

1. `@sinclair/typebox` must be declared as a direct dependency in `package.json` and `pnpm install` must be re-run to update `pnpm-lock.yaml` before routes can be type-checked or built; this step is a hard prerequisite for all subsequent steps.
2. `tsconfig.json` must extend the workspace root config (`"../../tsconfig.json"`) to inherit `strict: true` and the workspace `moduleResolution` setting.
3. The auth preHandler must verify that the bug ID in the URL parameter belongs to the authenticated caller's tenant before delegating to the service; omitting the ownership check is a security regression, not a simplification. The tenant identifier must be derived from a verified credential (via a decorated `authService.verifyToken(token)`, mirrored the same way `similarityService`/`mitigationService` are consumed, not implemented, in this package) — never compared directly against the raw bearer token string, which is a credential, not a tenant id.
4. `AppError` must be defined in a package-local `src/errors.ts`; the intelligence package must not import from `packages/backend` to avoid introducing a workspace circular reference.
5. All unit tests must pass without a live database, Redis, or external HTTP; every I/O boundary must be mocked using `vi.fn()`.
6. `vitest.config.ts` must set `include: ['tests/**/*.test.ts']` so both existing files under `tests/utils/` and the new route test files are discovered automatically without manual listing.
7. Route paths and response shapes exposed by this package must match the contract already consumed by `packages/backend/src/services/intelligence/intelligence-client.ts` and `types.ts` — the similar-bugs route is `GET /api/v1/bugs/:id/similar` returning a `SimilarBugsResponse` (`bug_id`, `is_duplicate`, `similar_bugs`, `threshold_used`), not a new `{ results }` shape mounted under a `/bugs` prefix.

## Acceptance criteria

- [ ] `pnpm --filter @bugspotter/intelligence test` exits 0 in CI — verified by all test cases in `threshold.test.ts`, `similar.test.ts`, and `mitigations.test.ts`.
- [ ] GET `/api/v1/bugs/:id/similar` without an `Authorization` header returns HTTP 401 — verified by test case A in `similar.test.ts`.
- [ ] GET `/api/v1/bugs/:id/mitigations` without an `Authorization` header returns HTTP 401 — verified by test case A in `mitigations.test.ts`.
- [ ] GET `/api/v1/bugs/:id/similar` for a bug whose `tenantId` does not match the tenant derived from the verified credential returns HTTP 403 — verified by test case B in `similar.test.ts`.
- [ ] GET `/api/v1/bugs/:id/similar` with a valid credential and matching tenant returns the `SimilarBugsResponse` produced by the service — verified by test case C in `similar.test.ts`.
- [ ] GET `/api/v1/bugs/:id/mitigations` with a valid credential and matching tenant returns the `MitigationResponse` produced by the service — verified by test case B in `mitigations.test.ts`.
- [ ] `threshold.ts` throws an instance of `AppError` (not base `Error`) for out-of-range inputs — verified by the updated assertions in `threshold.test.ts`.
- [ ] Zero `TODO` comments remain in any file under `packages/bugspotter-intelligence/`.

## Changes

### `packages/bugspotter-intelligence/package.json`

New file — makes the package addressable by pnpm filter and declares all runtime and dev dependencies including the previously unresolved `@sinclair/typebox`.

```json
{
  "name": "@bugspotter/intelligence",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "build": "tsc"
  },
  "dependencies": {
    "fastify": "^5.8.5",
    "@sinclair/typebox": "^0.34.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "vitest": "^3.2.4"
  }
}
```

### `packages/bugspotter-intelligence/tsconfig.json`

New file — extends workspace root, scopes compilation to `src/`.

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

### `packages/bugspotter-intelligence/vitest.config.ts`

New file — mirrors the `packages/utils` vitest config pattern (`globals: true`, `environment: 'node'`, v8 coverage), scoped to `tests/`.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
});
```

### `packages/bugspotter-intelligence/src/errors.ts`

New file — package-local structured error class so routes and utilities can throw HTTP-aware errors without importing from `packages/backend`. Signature matches the existing `AppError` at `packages/backend/src/api/middleware/error.ts:13` (`message` first, `statusCode` second) so the two stay drop-in compatible.

```ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

### `packages/bugspotter-intelligence/src/utils/threshold.ts`

Add `AppError` import and replace both `throw new Error(...)` / TODO blocks with `throw new AppError(<message>, 422)`.

```ts
// Prepend before all existing imports:
import { AppError } from '../errors.js';

// Replace first TODO site — old form:
//   throw new Error('<message>'); // TODO: use AppError
// New form:
throw new AppError('<existing message text>', 422);

// Replace second TODO site — old form:
//   throw new Error('<message>'); // TODO: use AppError
// New form:
throw new AppError('<existing message text>', 422);
```

### `packages/bugspotter-intelligence/src/routes/bugs/similar.ts`

Add `AppError` import, add a `preHandler` that enforces authentication and tenant ownership, and replace the `results = []` stub with a real service call. The route keeps its existing literal path (`/api/v1/bugs/:id/similar`) and the response shape stays `SimilarBugsResponse` — both match what `packages/backend/src/services/intelligence/intelligence-client.ts` (`getSimilarBugs`, line 111-117) already calls and expects; a `/:id/similar` route mounted under a `/bugs` prefix and a `{ results }` envelope would be incompatible with that consumer.

```ts
// Append after existing imports:
import { AppError } from '../../errors.js';

// Replace the existing bare route registration with:
fastify.get(
  '/api/v1/bugs/:id/similar',
  {
    preHandler: async (request) => {
      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : undefined;
      if (!token) {
        throw new AppError('Unauthorized', 401);
      }
      let tenantId: string;
      try {
        ({ tenantId } = request.server.authService.verifyToken(token));
      } catch {
        throw new AppError('Unauthorized', 401);
      }
      const bug = await request.server.similarityService.getBugById(
        (request.params as { id: string }).id
      );
      if (!bug || bug.tenantId !== tenantId) {
        throw new AppError('Forbidden', 403);
      }
    },
  },
  async (request, reply) => {
    // Replace: const results = [];
    // findSimilar already returns a SimilarBugsResponse-shaped object
    // (bug_id, is_duplicate, similar_bugs, threshold_used) — forward it as-is.
    const response = await request.server.similarityService.findSimilar(
      (request.params as { id: string }).id
    );
    return reply.send(response);
  }
);
```

### `packages/bugspotter-intelligence/src/routes/bugs/mitigations.ts`

Mirror the same `preHandler` guard (including the verified-credential tenant check above) and replace the `results = []` stub with a real service call. Keep the route's existing literal path (`/api/v1/bugs/:id/mitigations`), for the same reason as `similar.ts`.

```ts
// Append after existing imports:
import { AppError } from '../../errors.js';

// Replace the existing bare route registration with:
fastify.get(
  '/api/v1/bugs/:id/mitigations',
  {
    preHandler: async (request) => {
      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : undefined;
      if (!token) {
        throw new AppError('Unauthorized', 401);
      }
      let tenantId: string;
      try {
        ({ tenantId } = request.server.authService.verifyToken(token));
      } catch {
        throw new AppError('Unauthorized', 401);
      }
      const bug = await request.server.mitigationService.getBugById(
        (request.params as { id: string }).id
      );
      if (!bug || bug.tenantId !== tenantId) {
        throw new AppError('Forbidden', 403);
      }
    },
  },
  async (request, reply) => {
    // Replace: const results = [];
    // findMitigations already returns a MitigationResponse-shaped object
    // (bug_id, mitigation_suggestion, based_on_similar_bugs) — forward it as-is.
    const response = await request.server.mitigationService.findMitigations(
      (request.params as { id: string }).id
    );
    return reply.send(response);
  }
);
```

## Tests

### `packages/bugspotter-intelligence/tests/utils/threshold.test.ts`

**Mock/fixture updates required:**

Add `AppError` import. Update every existing `expect(...).toThrow(Error)` assertion to `expect(...).toThrow(AppError)` so the test verifies the concrete class, not just the base `Error`.

```ts
// Append after existing imports:
import { AppError } from '../../src/errors.js';

// Replace each instance of:
//   expect(() => resolveThreshold(...)).toThrow(Error);
// with:
//   expect(() => resolveThreshold(...)).toThrow(AppError);
```

**Test case — AppError statusCode on out-of-range input (AC #7):**

```ts
import { describe, it, expect } from 'vitest';
import { AppError } from '../../src/errors.js';
import { resolveThreshold } from '../../src/utils/threshold.js';

describe('threshold — error type', () => {
  it('throws AppError with statusCode 422 for an out-of-range value', () => {
    let caught: unknown;
    try {
      resolveThreshold(-1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).statusCode).toBe(422);
  });
});
```

### `packages/bugspotter-intelligence/tests/routes/bugs/similar.test.ts`

**Mock/fixture updates required:**

Construct a minimal Fastify instance with `similarityService` and `authService` decorated onto it. All stubbed keys must exist on the decorated services before `app.ready()` is called; Fastify will throw at decoration time if either service object is missing a key the route reads. The route registers its own literal `/api/v1/bugs/:id/similar` path, so `buildApp` registers the plugin with no prefix and tests hit that literal URL.

```ts
import Fastify, { FastifyInstance } from 'fastify';
import { vi, type Mock } from 'vitest';

interface MockSimilarityService {
  getBugById: Mock;
  findSimilar: Mock;
}

interface MockAuthService {
  verifyToken: Mock;
}

function buildApp(
  serviceOverrides: Partial<MockSimilarityService> = {},
  authOverrides: Partial<MockAuthService> = {}
): FastifyInstance {
  const app = Fastify();
  const similarityService: MockSimilarityService = {
    getBugById: vi.fn(),
    findSimilar: vi.fn(),
    ...serviceOverrides,
  };
  const authService: MockAuthService = {
    verifyToken: vi.fn(),
    ...authOverrides,
  };
  app.decorate('similarityService', similarityService);
  app.decorate('authService', authService);
  app.register(import('../../../src/routes/bugs/similar.js'));
  return app;
}
```

**Test case A — no Authorization header returns 401 (AC #2):**

```ts
import { describe, it, expect, vi } from 'vitest';

describe('GET /api/v1/bugs/:id/similar', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/bugs/bug-123/similar' });

    expect(res.statusCode).toBe(401);
  });
```

**Test case B — cross-tenant bug returns 403 (AC #4):**

```ts
it('returns 403 when the bug belongs to a different tenant', async () => {
  const app = buildApp(
    { getBugById: vi.fn().mockResolvedValue({ id: 'bug-123', tenantId: 'tenant-b' }) },
    { verifyToken: vi.fn().mockReturnValue({ tenantId: 'tenant-a' }) }
  );
  await app.ready();

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/bugs/bug-123/similar',
    headers: { authorization: 'Bearer opaque-credential' },
  });

  expect(res.statusCode).toBe(403);
});
```

**Test case C — matching tenant returns the service's SimilarBugsResponse (AC #5):**

```ts
  it('returns similarity results for an authorised, same-tenant request', async () => {
    const mockResponse = {
      bug_id: 'bug-123',
      is_duplicate: false,
      similar_bugs: [
        {
          bug_id: 'bug-456',
          title: 'Login button unresponsive on Safari',
          description: null,
          status: 'open',
          resolution: null,
          similarity: 0.91,
        },
      ],
      threshold_used: 0.8,
    };
    const app = buildApp(
      {
        getBugById: vi.fn().mockResolvedValue({ id: 'bug-123', tenantId: 'tenant-a' }),
        findSimilar: vi.fn().mockResolvedValue(mockResponse),
      },
      { verifyToken: vi.fn().mockReturnValue({ tenantId: 'tenant-a' }) }
    );
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bugs/bug-123/similar',
      headers: { authorization: 'Bearer opaque-credential' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(mockResponse);
  });
});
```

### `packages/bugspotter-intelligence/tests/routes/bugs/mitigations.test.ts`

**Mock/fixture updates required:**

Mirror the `buildApp` helper from `similar.test.ts`, replacing `similarityService` with `mitigationService` and stubbing `getBugById` and `findMitigations`, plus the same `authService` decoration. All keys must be present on the stub objects before `app.ready()` is called. The route registers its own literal `/api/v1/bugs/:id/mitigations` path, so `buildApp` registers with no prefix.

```ts
import Fastify, { FastifyInstance } from 'fastify';
import { vi, type Mock } from 'vitest';

interface MockMitigationService {
  getBugById: Mock;
  findMitigations: Mock;
}

interface MockAuthService {
  verifyToken: Mock;
}

function buildApp(
  serviceOverrides: Partial<MockMitigationService> = {},
  authOverrides: Partial<MockAuthService> = {}
): FastifyInstance {
  const app = Fastify();
  const mitigationService: MockMitigationService = {
    getBugById: vi.fn(),
    findMitigations: vi.fn(),
    ...serviceOverrides,
  };
  const authService: MockAuthService = {
    verifyToken: vi.fn(),
    ...authOverrides,
  };
  app.decorate('mitigationService', mitigationService);
  app.decorate('authService', authService);
  app.register(import('../../../src/routes/bugs/mitigations.js'));
  return app;
}
```

**Test case A — no Authorization header returns 401 (AC #3):**

```ts
import { describe, it, expect } from 'vitest';

describe('GET /api/v1/bugs/:id/mitigations', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/bugs/bug-123/mitigations' });

    expect(res.statusCode).toBe(401);
  });
```

**Test case B — matching tenant returns the service's MitigationResponse (AC #6):**

```ts
  it('returns mitigation results for an authorised, same-tenant request', async () => {
    const mockResponse = {
      bug_id: 'bug-123',
      mitigation_suggestion: 'Sanitize user input before passing to query builder',
      based_on_similar_bugs: true,
    };
    const app = buildApp(
      {
        getBugById: vi.fn().mockResolvedValue({ id: 'bug-123', tenantId: 'tenant-a' }),
        findMitigations: vi.fn().mockResolvedValue(mockResponse),
      },
      { verifyToken: vi.fn().mockReturnValue({ tenantId: 'tenant-a' }) }
    );
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bugs/bug-123/mitigations',
      headers: { authorization: 'Bearer opaque-credential' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(mockResponse);
  });
});
```

## Verification

```bash
pnpm install
pnpm --filter @bugspotter/intelligence build
pnpm --filter @bugspotter/intelligence test
```

Rollback: n/a — all steps are additive (new package files, no schema migrations, no shared infrastructure changes). Reverting the PR removes the package from the workspace and reverts the lockfile update.
