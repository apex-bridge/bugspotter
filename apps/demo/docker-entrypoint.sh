#!/bin/sh
set -e

# Inject runtime configuration from environment variables into config.js
# This allows the same Docker image to be pointed at any BugSpotter instance.
echo "Injecting demo runtime configuration..."

# Use jq -c to safely construct a compact JSON object (handles special chars)
CONFIG_JSON=$(jq -nc \
  --arg endpoint "${DEMO_API_URL:-}" \
  --arg apiKey "${DEMO_API_KEY:-}" \
  --arg adminUrl "${DEMO_ADMIN_URL:-}" \
  --arg extensionUrl "${DEMO_EXTENSION_URL:-}" \
  --arg viewerEmail "${DEMO_VIEWER_EMAIL:-}" \
  --arg viewerPassword "${DEMO_VIEWER_PASSWORD:-}" \
  --arg magicToken "${DEMO_MAGIC_TOKEN:-}" \
  '{endpoint: $endpoint, apiKey: $apiKey, adminUrl: $adminUrl, extensionUrl: $extensionUrl, viewerEmail: $viewerEmail, viewerPassword: $viewerPassword, magicToken: $magicToken}')

printf 'window.__BUGSPOTTER_DEMO_CONFIG__ = %s;\n' "$CONFIG_JSON" \
  > /usr/share/nginx/html/config.js

echo "Demo config: API_URL=${DEMO_API_URL:-<not set>}, ADMIN_URL=${DEMO_ADMIN_URL:-<not set>}"

# Start nginx
exec nginx -g "daemon off;"
