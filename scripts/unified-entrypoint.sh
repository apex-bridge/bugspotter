#!/bin/sh
# Unified Docker deployment entrypoint
# Validates API_DOMAIN and GIT_COMMIT, then starts supervisord (manages nginx + API + worker)

set -e

# Source shared validation logic
. /app/scripts/shared/validate-api-domain.sh

# Validate GIT_COMMIT before injecting into JavaScript
validate_git_commit

# Inject runtime configuration (git commit hash from environment)
echo "Injecting runtime configuration..."
cat > /usr/share/nginx/html/config.js << EOF
window.__RUNTIME_CONFIG__ = {
  gitCommit: '${GIT_COMMIT:-unknown}'
};
EOF
echo "Runtime config created with GIT_COMMIT=${GIT_COMMIT:-unknown}"

# Set CSP domain defaults if not provided
export CDN_DOMAIN="${CDN_DOMAIN:-https://cdn.bugspotter.io}"
export STORAGE_DOMAIN="${STORAGE_DOMAIN:-https://*.r2.cloudflarestorage.com}"
export APP_DOMAIN="${APP_DOMAIN:-https://*.demo.bugspotter.io}"

# Process nginx security headers template for unified deployment
envsubst '${API_DOMAIN_CSP} ${CDN_DOMAIN} ${STORAGE_DOMAIN} ${APP_DOMAIN}' < /etc/nginx/snippets/security-headers.conf.template > /etc/nginx/snippets/security-headers.conf

echo "=== Generated nginx CSP configuration (unified) ==="
grep "Content-Security-Policy" /etc/nginx/snippets/security-headers.conf
echo "====================================="

# Start supervisord (manages nginx + API + worker processes)
exec /usr/bin/supervisord -c /etc/supervisord.conf
