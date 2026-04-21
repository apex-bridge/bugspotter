# @bugspotter/admin

Tenant admin dashboard. React 18 + Vite + react-i18next. Deployed behind nginx.

## Tenant routing + cross-subdomain auth

- Prod URL pattern: `https://[org].kz.bugspotter.io/...`. The _subdomain_ resolves the tenant — don't hardcode org IDs in URLs; the backend's tenant middleware attaches `request.organizationId` based on the host.
- Auth is JWT in a refresh-token cookie set by `api.kz.bugspotter.io`. For the wizard → tenant UI handoff to work, the backend must run with `COOKIE_DOMAIN=.kz.bugspotter.io` so the cookie carries a `Domain` attribute and `SameSite=Lax`; otherwise it stays host-scoped and each subdomain prompts for login.

## i18n (en / ru / kk, kept in sync)

- `react-i18next`, JSON under `src/i18n/locales/`. Three locales; drift fails CI.
- `pnpm validate:i18n` (root) or `pnpm test:i18n` (local unit test) checks key sync.
- Never inline English strings in JSX — always `t('key')`.

## Tests

- Unit (vitest): `pnpm test`.
- E2E (Playwright) lives in `src/tests/e2e/`, driven by `playwright.config.ts`. Useful commands:
  ```bash
  pnpm test:e2e                # full suite, chromium
  pnpm test:e2e:ci             # CI preset — chromium only, retries=2
  pnpm test:e2e:ui              # interactive debug mode
  pnpm test:e2e:notifications   # targeted: notification-delivery spec only
  ```
- The admin ships its own nginx config (`nginx.conf.template`); `pnpm test:nginx` validates CORS/cache directives. Run it when editing `nginx*.conf` or `docker-entrypoint.sh`.

## Commands

```bash
pnpm dev             # Vite on :5173
pnpm build           # tsc + vite build
pnpm lint            # eslint, 0 warnings policy
pnpm validate:i18n   # fails CI if locales drift
```
