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
validate_storage_domain

# Inject runtime configuration (git commit hash + API URL from environment)
echo "Injecting runtime configuration..."
cat > /usr/share/nginx/html/config.js << EOF
window.__RUNTIME_CONFIG__ = {
  gitCommit: '${GIT_COMMIT:-unknown}',
  apiUrl: '${API_URL:-}'
};
EOF
echo "Runtime config created with GIT_COMMIT=${GIT_COMMIT:-unknown}, API_URL=${API_URL:-}"

# STORAGE_CSP is built and validated by validate_storage_domain above
# (operator's object-storage host, e.g. "*.storage.yandexcloud.kz";
# empty => only 'self' is allowed for storage).
echo "Storage CSP fragment: '${STORAGE_CSP}'"

# Process nginx template for standalone deployment
envsubst '${API_DOMAIN_CSP} ${STORAGE_CSP}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# Render the security-headers snippet (CSP needs ${API_DOMAIN_CSP} filled in).
# The config includes /etc/nginx/snippets/security-headers.conf at server scope
# AND inside every location that sets its own add_header, so the security headers
# are not dropped from HTML documents, hashed assets, and config.js.
envsubst '${API_DOMAIN_CSP}' < /etc/nginx/snippets/security-headers.conf.template > /etc/nginx/snippets/security-headers.conf

echo "=== Generated nginx security headers ==="
grep "Content-Security-Policy" /etc/nginx/snippets/security-headers.conf
echo "====================================="

# Verify unsafe-inline is present in style-src
if grep -q "style-src.*'self'.*'unsafe-inline'" /etc/nginx/snippets/security-headers.conf; then
    echo "✓ CSP verified: style-src includes 'unsafe-inline'"
else
    echo "⚠️  WARNING: style-src missing 'unsafe-inline' - React inline styles will be blocked!"
fi

# Start nginx
exec nginx -g "daemon off;"
