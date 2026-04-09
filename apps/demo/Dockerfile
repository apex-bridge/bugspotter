# ============================================================================
# BugSpotter Demo App — Static Site served by nginx
# ============================================================================
# Build: docker build -t bugspotter-demo apps/demo
# Run:   docker run -p 3003:80 \
#          -e DEMO_API_URL=https://api.bugspotter.io \
#          -e DEMO_API_KEY=bgs_your_api_key \
#          -e DEMO_ADMIN_URL=https://admin.bugspotter.io \
#          -e DEMO_EXTENSION_URL=https://demo.kz.bugspotter.io/extension \
#          bugspotter-demo
# ============================================================================
FROM nginx:alpine

# Install curl for healthcheck, jq for config injection (before COPY for better layer caching)
RUN apk add --no-cache curl jq

# Download SDK from npm (no need to bundle in repo)
RUN curl -fsSL "https://unpkg.com/@bugspotter/sdk@latest/dist/bugspotter.min.js" \
    -o /usr/share/nginx/html/bugspotter.min.js

# Copy static files
COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY demo.js /usr/share/nginx/html/demo.js
COPY buggy-app.html /usr/share/nginx/html/buggy-app.html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint (injects runtime config.js from env vars)
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:80/ || exit 1

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
