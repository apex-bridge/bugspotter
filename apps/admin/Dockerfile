# ============================================================================
# BugSpotter Admin UI image
# ============================================================================
# Adding a COPY from the build context here also requires a matching entry in
# the `paths:` filter of .github/workflows/deploy-admin.yml. That filter is what
# decides whether a change republishes this image; a build input missing from it
# means the registry copy silently keeps the old file (#303). Nothing checks the
# two agree - see #310.
# ============================================================================

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd AS dependencies

WORKDIR /app

# Install pnpm (pinned to project version)
RUN npm install -g pnpm@9.14.4

# Install build tools for native modules
RUN apk add --no-cache python3 make g++ build-base

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY apps/admin/package.json ./apps/admin/

# Install dependencies
RUN pnpm install --frozen-lockfile && pnpm store prune

# ============================================================================
# Stage 2: Build Types Package
# ============================================================================
FROM dependencies AS types-builder

# Copy types source
COPY tsconfig.json ./
COPY packages/types/tsconfig.json ./packages/types/
COPY packages/types/src ./packages/types/src

# Build types package
RUN pnpm --filter @bugspotter/types build

# ============================================================================
# Stage 3: Build Admin Panel
# ============================================================================
FROM dependencies AS admin-builder

# Accept build-time environment variable for API URL
# For production with separate domains: VITE_API_URL=https://demo.api.bugspotter.io
# For same-domain deployment with nginx proxy: VITE_API_URL=/api (or empty)
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

# Copy types build artifacts
COPY --from=types-builder /app/packages/types/dist ./packages/types/dist
COPY --from=types-builder /app/packages/types/tsconfig.json ./packages/types/

# Copy root tsconfig (needed for project references)
COPY tsconfig.json ./

# Copy admin configuration files (these change less frequently - better caching)
COPY apps/admin/package.json ./apps/admin/
COPY apps/admin/tsconfig.json ./apps/admin/
COPY apps/admin/tsconfig.node.json ./apps/admin/
COPY apps/admin/vite.config.ts ./apps/admin/
COPY apps/admin/postcss.config.js ./apps/admin/
COPY apps/admin/tailwind.config.js ./apps/admin/
COPY apps/admin/index.html ./apps/admin/

# Copy admin source code (this changes most frequently - last layer)
COPY apps/admin/src ./apps/admin/src
COPY apps/admin/public ./apps/admin/public

# Build the application (types already built)
RUN pnpm --filter @bugspotter/admin build

# ============================================================================
# Stage 4: Production Runtime
# ============================================================================
FROM nginx:alpine

# Force cache invalidation - increment this number when nginx config changes
RUN echo "nginx-config-version: 2" > /tmp/config-version

# Copy nginx config template (will be processed by entrypoint)
COPY apps/admin/nginx.conf.template /etc/nginx/conf.d/default.conf.template

# Copy nginx snippets (DRY: reusable security headers)
COPY apps/admin/nginx-snippets /etc/nginx/snippets

# Verify the security-headers snippet template has unsafe-inline in CSP
# (the CSP lives in security-headers.conf.template, rendered by the entrypoint)
RUN echo "=== Verifying nginx CSP snippet ===" && \
    grep "style-src.*unsafe-inline" /etc/nginx/snippets/security-headers.conf.template || \
    (echo "ERROR: unsafe-inline missing from security-headers snippet!" && exit 1) && \
    echo "✓ Snippet verified: unsafe-inline present in style-src"

# Create directory for scripts
RUN mkdir -p /app/scripts/shared

# Copy shared validation script and entrypoint
COPY scripts/shared/validate-api-domain.sh /app/scripts/shared/validate-api-domain.sh
COPY apps/admin/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /app/scripts/shared/validate-api-domain.sh /docker-entrypoint.sh

# Copy built assets from builder
COPY --from=admin-builder /app/apps/admin/dist /usr/share/nginx/html

# Install curl and gettext (for envsubst)
RUN apk add --no-cache curl gettext

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:80/ || exit 1

# Expose port
EXPOSE 80

# The revision this image was built from. Set by deploy-admin.yml
# (`build-args: IMAGE_GIT_COMMIT=${{ github.sha }}`); left "unknown" by a plain
# local `docker build`, which falls back to the runtime GIT_COMMIT exactly as
# before. The entrypoint prefers this over the runtime value because the host's
# GIT_COMMIT is deploy-time configuration that has gone stale (#434) - see
# validate_git_commit() in scripts/shared/validate-api-domain.sh.
#
# Deliberately the last thing in the stage: its value changes on every commit,
# so anything below it would be rebuilt on every single build.
ARG IMAGE_GIT_COMMIT=unknown
ENV IMAGE_GIT_COMMIT=${IMAGE_GIT_COMMIT}

# Use custom entrypoint that processes template
ENTRYPOINT ["/docker-entrypoint.sh"]
