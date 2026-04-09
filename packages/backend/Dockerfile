# ============================================================================
# BugSpotter Backend - Multi-Stage Docker Build
# ============================================================================
# Stage 1: Dependencies - Install all dependencies including dev dependencies
# Stage 2: Builder - Build TypeScript code
# Stage 3: Production - Minimal runtime image with only production dependencies
# ============================================================================

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd AS dependencies

# Install pnpm (pin to project version) and build tools required for native modules
RUN npm install -g pnpm@9.14.4 && \
    # Install python & build tools for native addons (will not be present in final image)
    apk add --no-cache python3 make g++ build-base

# Set working directory
WORKDIR /app

# Copy workspace configuration and npmrc (enable build scripts for native modules)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./

# Copy package.json files for all packages
COPY packages/backend/package.json ./packages/backend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/message-broker/package.json ./packages/message-broker/
COPY packages/billing/package.json ./packages/billing/

# Install all dependencies (including dev dependencies for build)
RUN pnpm install --frozen-lockfile && pnpm store prune

# ============================================================================
# Stage 2: Builder
# ============================================================================
FROM node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd AS builder

# Set CI environment variable for pnpm
ENV CI=true

# Install pnpm and keep build deps available for compilation
RUN npm install -g pnpm@9.14.4 && \
    apk add --no-cache python3 make g++ build-base

WORKDIR /app

# Copy workspace configuration and npmrc (enable build scripts for native modules)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/packages ./packages

# Copy source code and TypeScript configurations
COPY tsconfig.json ./
COPY packages/backend/tsconfig.json ./packages/backend/
COPY packages/backend/src ./packages/backend/src
COPY packages/backend/scripts/copy-migrations.mjs ./packages/backend/scripts/copy-migrations.mjs
COPY packages/types/tsconfig.json ./packages/types/
COPY packages/types/src ./packages/types/src
COPY packages/utils/tsconfig.json ./packages/utils/
COPY packages/utils/src ./packages/utils/src
COPY packages/message-broker/tsconfig.json ./packages/message-broker/
COPY packages/message-broker/src ./packages/message-broker/src
COPY packages/billing/tsconfig.json ./packages/billing/
COPY packages/billing/src ./packages/billing/src

# Build all packages (types and utils first, then message-broker and billing, then backend)
RUN pnpm --filter @bugspotter/types build
RUN pnpm --filter @bugspotter/utils build
RUN pnpm --filter @bugspotter/message-broker build
RUN pnpm --filter @bugspotter/billing build
RUN pnpm --filter @bugspotter/backend build

# Rebuild all native modules to ensure they're compiled for Alpine architecture
# This is critical for modules like isolated-vm, bcrypt, sharp that require platform-specific binaries
RUN pnpm rebuild

# Install production dependencies only (removes dev dependencies)
# This must run after rebuild to preserve the compiled native modules
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

# ============================================================================
# Stage 3: Production
# ============================================================================
FROM node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd AS production

# Install minimal utilities (no pnpm needed - dependencies already installed and code built)
# Install dumb-init for proper signal handling, curl for health checks, netcat for wait-for scripts
RUN apk add --no-cache dumb-init curl netcat-openbsd

# Create non-root user
RUN addgroup -g 1001 -S bugspotter && \
    adduser -S -u 1001 -G bugspotter bugspotter

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files
COPY packages/backend/package.json ./packages/backend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/message-broker/package.json ./packages/message-broker/
COPY packages/billing/package.json ./packages/billing/

# Copy compiled node_modules from builder (includes native modules like isolated-vm)
# pnpm strict mode requires each package's node_modules for ESM resolution
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=builder /app/packages/billing/node_modules ./packages/billing/node_modules
COPY --from=builder /app/packages/message-broker/node_modules ./packages/message-broker/node_modules

# Copy built artifacts from builder stage (includes SQL files from build step)
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=builder /app/packages/message-broker/dist ./packages/message-broker/dist
COPY --from=builder /app/packages/billing/dist ./packages/billing/dist
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist

# Copy entrypoint script
COPY packages/backend/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create data directory for local storage (if used)
RUN mkdir -p /app/data/uploads && \
    chown -R bugspotter:bugspotter /app

# Switch to non-root user
USER bugspotter

# Expose API port
EXPOSE 3000

# Health check - uses /ready endpoint to verify database connectivity
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://127.0.0.1:3000/ready || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command (can be overridden to 'worker')
CMD ["docker-entrypoint.sh", "api"]
