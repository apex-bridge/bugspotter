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

# Verify template has unsafe-inline in CSP
RUN echo "=== Verifying nginx template CSP ===" && \
    grep "style-src.*unsafe-inline" /etc/nginx/conf.d/default.conf.template || \
    (echo "ERROR: unsafe-inline missing from template!" && exit 1) && \
    echo "✓ Template verified: unsafe-inline present in style-src"

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

# Use custom entrypoint that processes template
ENTRYPOINT ["/docker-entrypoint.sh"]
