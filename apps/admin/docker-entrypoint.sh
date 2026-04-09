#!/bin/sh
# Standalone admin panel entrypoint
# Validates API_DOMAIN and starts nginx

set -e

# Source shared validation logic
. /app/scripts/shared/validate-api-domain.sh

# Validate all environment variables
validate_git_commit
validate_api_domain
validate_api_url

# Inject runtime configuration (git commit hash + API URL from environment)
echo "Injecting runtime configuration..."
cat > /usr/share/nginx/html/config.js << EOF
window.__RUNTIME_CONFIG__ = {
  gitCommit: '${GIT_COMMIT:-unknown}',
  apiUrl: '${API_URL:-}'
};
EOF
echo "Runtime config created with GIT_COMMIT=${GIT_COMMIT:-unknown}, API_URL=${API_URL:-}"

# Process nginx template for standalone deployment
envsubst '${API_DOMAIN_CSP}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

echo "=== Generated nginx configuration (standalone) ==="
grep "Content-Security-Policy" /etc/nginx/conf.d/default.conf
echo "====================================="

# Verify unsafe-inline is present in style-src
if grep -q "style-src.*'self'.*'unsafe-inline'" /etc/nginx/conf.d/default.conf; then
    echo "✓ CSP verified: style-src includes 'unsafe-inline'"
else
    echo "⚠️  WARNING: style-src missing 'unsafe-inline' - React inline styles will be blocked!"
fi

# Start nginx
exec nginx -g "daemon off;"
