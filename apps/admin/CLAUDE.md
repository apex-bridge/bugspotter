# @bugspotter/admin

Tenant admin dashboard. React 18 + Vite + react-i18next. Deployed behind nginx.

## Tenant routing

- Prod URL pattern: `https://[org].kz.bugspotter.io/...`
- The _subdomain_ resolves the tenant; don't hardcode org IDs or embed them in URLs — the backend's tenant middleware attaches `request.organizationId` based on the host.
- Auth flows through the refresh_token cookie set by `api.kz.bugspotter.io`. Requires `COOKIE_DOMAIN=.kz.bugspotter.io` on the backend env or cross-subdomain SSO doesn't work (see `packages/backend/CLAUDE.md`).

## i18n

- `react-i18next` with three locales: `en`, `ru`, `kk`. All JSON under `src/i18n/locales/`.
- Keep all three files in sync — CI runs `pnpm validate:i18n` and fails on missing keys.
- `pnpm test:i18n` runs the locale-sync unit test locally.
- Never inline English strings in JSX — use `t('key')`.

## Test configs (not interchangeable)

- `playwright.config.ts` — default E2E run.
- `playwright.seed.config.ts` — runs `seed-demo-bugs.spec.ts` to populate demo data.
- `playwright.video.config.ts` / `.video-extension.config.ts` — record walkthrough videos.

Pick the right one for the task:

```bash
pnpm test:e2e                # default (chromium)
pnpm test:e2e:ci             # CI preset — chromium only, retries=2
pnpm test:e2e:ui             # interactive UI mode for debugging
pnpm test:e2e:notifications  # targeted suite for notification-delivery
```

## Nginx tests

The admin ships its own nginx config (`nginx.conf.template`). `pnpm test:nginx` validates CORS, cache directives, and general config sanity. Run it when touching `nginx*.conf` or `docker-entrypoint.sh`.

## Commands

```bash
pnpm dev             # Vite on :5173
pnpm build           # tsc + vite build
pnpm test            # vitest (unit)
pnpm lint            # eslint, 0 warnings policy
pnpm validate:i18n   # fails CI if locales drift
```
