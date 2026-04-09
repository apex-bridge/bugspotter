# ============================================================================
# BugSpotter Unified Deployment - API + Worker + Admin Panel
# Runs API (port 3000), Background Worker, and Admin Panel (port 3001) in single container
# ============================================================================

# ============================================================================
# Stage 1: Base - Common setup for dependency installation stages
# ============================================================================
FROM node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd AS base

# Install pnpm v9 - avoids v10's default build script blocking (v10+ requires explicit whitelisting)
# Using v9.14.4 for simpler native module builds (isolated-vm, bcrypt, sharp) with .npmrc whitelist
RUN npm install -g pnpm@9.14.4

# Install build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    build-base

WORKDIR /app

# Copy workspace configuration and npmrc (enable build scripts for native modules)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./

# Copy all package.json files
COPY packages/backend/package.json ./packages/backend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/message-broker/package.json ./packages/message-broker/
COPY apps/admin/package.json ./apps/admin/

# ============================================================================
# Stage 2: Dependencies - Install all dependencies (including devDependencies)
# ============================================================================
FROM base AS dependencies

# Install all dependencies - using pnpm v9 with .npmrc whitelist for native module builds
# v9 allows build scripts with .npmrc configuration; v10+ blocks them by default
# Native modules (isolated-vm, bcrypt, sharp) compile successfully
RUN pnpm install --frozen-lockfile

# ============================================================================
# Stage 3: Production Dependencies (only prod deps, preserves native binaries)
# ============================================================================
FROM base AS prod-dependencies

# Install ONLY production dependencies (excludes devDependencies)
# Native modules compile via .npmrc whitelist, preserving compiled binaries
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

# ============================================================================
# Stage 4: Build Types Package (shared by backend and admin)
# ============================================================================
FROM dependencies AS types-builder

# Copy types package source
COPY tsconfig.json ./
COPY packages/types/tsconfig.json ./packages/types/
COPY packages/types/src ./packages/types/src

# Build types package
RUN pnpm --filter @bugspotter/types build

# ============================================================================
# Stage 5: Build Utils Package (shared utilities for backend)
# ============================================================================
FROM dependencies AS utils-builder

# Copy utils package source
COPY tsconfig.json ./
COPY packages/utils/tsconfig.json ./packages/utils/
COPY packages/utils/src ./packages/utils/src

# Build utils package
RUN pnpm --filter @bugspotter/utils build

# ============================================================================
# Stage 6: Build Message Broker Package
# ============================================================================
FROM dependencies AS message-broker-builder

# Copy message-broker source
COPY tsconfig.json ./
COPY packages/message-broker/tsconfig.json ./packages/message-broker/
COPY packages/message-broker/src ./packages/message-broker/src

# Build message-broker package
RUN pnpm --filter @bugspotter/message-broker build

# ============================================================================
# Stage 6b: Build Billing Package
# ============================================================================
FROM dependencies AS billing-builder

# Copy billing source code
COPY tsconfig.json ./
COPY packages/billing/tsconfig.json ./packages/billing/
COPY packages/billing/src ./packages/billing/src

# Build billing package
RUN pnpm --filter @bugspotter/billing build

# ============================================================================
# Stage 7: Build Backend
# ============================================================================
FROM dependencies AS backend-builder

# Copy types build artifacts
COPY --from=types-builder /app/packages/types/dist ./packages/types/dist
COPY --from=types-builder /app/packages/types/tsconfig.json ./packages/types/

# Copy utils build artifacts
COPY --from=utils-builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=utils-builder /app/packages/utils/tsconfig.json ./packages/utils/

# Copy message-broker build artifacts
COPY --from=message-broker-builder /app/packages/message-broker/dist ./packages/message-broker/dist
COPY --from=message-broker-builder /app/packages/message-broker/tsconfig.json ./packages/message-broker/

# Copy billing build artifacts
COPY --from=billing-builder /app/packages/billing/dist ./packages/billing/dist
COPY --from=billing-builder /app/packages/billing/tsconfig.json ./packages/billing/

# Copy backend source code
COPY tsconfig.json ./
COPY packages/backend/tsconfig.json ./packages/backend/
COPY packages/backend/src ./packages/backend/src
COPY packages/backend/scripts/copy-migrations.mjs ./packages/backend/scripts/copy-migrations.mjs

# Build backend (types, utils, and message-broker already built)
RUN pnpm --filter @bugspotter/backend build

# ============================================================================
# Stage 8: Build Admin Panel
# ============================================================================
FROM dependencies AS admin-builder

# Build admin panel
# VITE_API_URL can be overridden via build arg (defaults to /api for same-domain)
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

# Copy types build artifacts (already compiled)
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

# Build admin (types already built)
RUN pnpm --filter @bugspotter/admin build

# ============================================================================
# Stage 9: Production Runtime - Combined API + Worker + Admin
# ============================================================================
FROM node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd AS production

# Image metadata
LABEL org.opencontainers.image.title="BugSpotter Unified" \
      org.opencontainers.image.description="BugSpotter API + Worker + Admin Panel" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.vendor="BugSpotter" \
      org.opencontainers.image.source="https://github.com/apex-bridge/bugspotter"

# Install runtime dependencies and create user in single layer
# Note: pnpm not needed - dependencies already installed and code already built
RUN apk add --no-cache \
    dumb-init \
    curl \
    nginx \
    supervisor \
    gettext && \
    addgroup -g 1001 -S bugspotter && \
    adduser -S -u 1001 -G bugspotter bugspotter

WORKDIR /app

# Set ownership before copying files
RUN chown bugspotter:bugspotter /app

# Copy workspace configuration files (needed for pnpm workspace structure)
COPY --chown=bugspotter:bugspotter pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --chown=bugspotter:bugspotter packages/backend/package.json ./packages/backend/
COPY --chown=bugspotter:bugspotter packages/types/package.json ./packages/types/
COPY --chown=bugspotter:bugspotter packages/utils/package.json ./packages/utils/
COPY --chown=bugspotter:bugspotter packages/message-broker/package.json ./packages/message-broker/
COPY --chown=bugspotter:bugspotter packages/billing/package.json ./packages/billing/

# Copy ONLY production node_modules with native bindings from prod-dependencies stage
# This excludes devDependencies while preserving compiled binaries (isolated-vm, bcrypt, sharp)
# Note: types/utils have no production deps - their dependencies are hoisted to root
COPY --from=prod-dependencies --chown=bugspotter:bugspotter /app/node_modules ./node_modules
COPY --from=prod-dependencies --chown=bugspotter:bugspotter /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=prod-dependencies --chown=bugspotter:bugspotter /app/packages/message-broker/node_modules ./packages/message-broker/node_modules
COPY --from=prod-dependencies --chown=bugspotter:bugspotter /app/packages/billing/node_modules ./packages/billing/node_modules

# Copy backend build artifacts with proper ownership
COPY --from=backend-builder --chown=bugspotter:bugspotter /app/packages/types/dist ./packages/types/dist
COPY --from=backend-builder --chown=bugspotter:bugspotter /app/packages/utils/dist ./packages/utils/dist
COPY --from=message-broker-builder --chown=bugspotter:bugspotter /app/packages/message-broker/dist ./packages/message-broker/dist
COPY --from=billing-builder --chown=bugspotter:bugspotter /app/packages/billing/dist ./packages/billing/dist
COPY --from=backend-builder --chown=bugspotter:bugspotter /app/packages/backend/dist ./packages/backend/dist
COPY --chown=bugspotter:bugspotter packages/backend/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Copy admin build artifacts (nginx runs as root, so keep root ownership)
COPY --from=admin-builder /app/apps/admin/dist /usr/share/nginx/html

# Create data directory with proper ownership and setup nginx directories
RUN mkdir -p /app/data/uploads /etc/nginx/http.d /etc/nginx/snippets /var/log/supervisor && \
    chown -R bugspotter:bugspotter /app/data && \
    chmod 755 /var/log/supervisor && \
    rm -f /etc/nginx/http.d/default.conf

# Create security headers template for dynamic CSP configuration
COPY <<'EOF' /etc/nginx/snippets/security-headers.conf.template
# Security headers
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Content Security Policy - PRODUCTION (Dynamic)
# Environment variables set by startup script:
# - API_DOMAIN_CSP: Added to connect-src (based on API_DOMAIN env var)
# - CDN_DOMAIN: CDN for static assets (default: https://cdn.bugspotter.io)
# - STORAGE_DOMAIN: R2/S3 storage domain (default: https://*.r2.cloudflarestorage.com)
# - APP_DOMAIN: Application domain pattern for cross-origin resources (default: https://*.demo.bugspotter.io)
# NOTE: React/Vite requires 'unsafe-inline' for dynamic inline styles
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${CDN_DOMAIN} ${STORAGE_DOMAIN} ${APP_DOMAIN}; font-src 'self' data: ${APP_DOMAIN}; connect-src 'self' ${STORAGE_DOMAIN}${API_DOMAIN_CSP}; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests;" always;
EOF

# Copy shared validation script and unified entrypoint
COPY scripts/shared/validate-api-domain.sh /app/scripts/shared/validate-api-domain.sh
COPY scripts/unified-entrypoint.sh /usr/local/bin/startup.sh
RUN chmod +x /app/scripts/shared/validate-api-domain.sh /usr/local/bin/startup.sh

COPY <<'EOF' /etc/nginx/http.d/admin.conf
server {
    listen 3001;
    listen [::]:3001;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Include security headers
    include /etc/nginx/snippets/security-headers.conf;

    # API proxy - forward /api requests to API server on port 3000
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    # Explicitly serve SPA routes (prevent confusion with backend /health endpoint)
    # These are React Router routes that must serve index.html
    location ~ ^/(system-health|dashboard|projects|settings|bug-reports|users|audit-logs|integrations|notifications)(/.*)?$ {
        try_files $uri /index.html;
    }

    # SPA routing - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        # Re-add security headers (nginx doesn't inherit add_header in location blocks)
        include /etc/nginx/snippets/security-headers.conf;
    }

    # Don't cache index.html
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        # Re-add security headers (nginx doesn't inherit add_header in location blocks)
        include /etc/nginx/snippets/security-headers.conf;
    }

    # Disable access to hidden files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
EOF

# Create supervisord configuration to run all three services (API, worker, nginx)
COPY <<'EOF' /etc/supervisord.conf
[supervisord]
nodaemon=true
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid

[program:api]
command=/usr/local/bin/docker-entrypoint.sh api
directory=/app
user=bugspotter
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=HOME="/home/bugspotter"

[program:worker]
command=/usr/local/bin/docker-entrypoint.sh worker
directory=/app
user=bugspotter
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=HOME="/home/bugspotter"

[program:nginx]
command=nginx -g "daemon off;"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
EOF


# Expose both ports
EXPOSE 3000 3001

# Health check - verify both API and Admin are responding (worker has no HTTP endpoint)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://127.0.0.1:3000/ready && curl -f http://127.0.0.1:3001/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start via startup script (processes CSP template, then starts supervisord)
CMD ["/usr/local/bin/startup.sh"]
