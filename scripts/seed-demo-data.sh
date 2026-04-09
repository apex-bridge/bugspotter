#!/bin/bash
set -e

# ============================================================================
# Seed realistic demo data for the BugSpotter cloud demo instance.
# Targets a remote API (cloud instance) or localhost.
#
# Usage:
#   ./scripts/seed-demo-data.sh
#
# Environment variables:
#   API_URL        - BugSpotter API base URL (default: http://localhost:3000)
#   ADMIN_EMAIL    - Admin email (default: admin@bugspotter.io)
#   ADMIN_PASSWORD - Admin password (default: admin123)
#   ORGANIZATION_ID - Organization ID for project creation (auto-detected if not set)
# ============================================================================

API_URL="${API_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@bugspotter.io}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

echo "============================================"
echo "  BugSpotter Demo Data Seeder"
echo "  Target: ${API_URL}"
echo "============================================"
echo ""

# Login and get access token
echo "[1/4] Logging in as ${ADMIN_EMAIL}..."
LOGIN_RESPONSE=$(curl -sf -X POST "${API_URL}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{email: $email, password: $password}')")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo "  FAILED - Could not authenticate. Check credentials."
  echo "  Response: $LOGIN_RESPONSE"
  exit 1
fi
echo "  OK - Authenticated"

# Auto-detect organization ID if not provided
if [ -z "${ORGANIZATION_ID:-}" ]; then
  ORGANIZATION_ID=$(curl -sf "${API_URL}/api/v1/projects" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
    | jq -r '[.data[]? | .organization_id | select(. != null)] | first // empty')
fi

if [ -z "${ORGANIZATION_ID:-}" ]; then
  echo "  WARN - No organization_id found. Project creation may fail on hub domain."
else
  echo "  Organization: ${ORGANIZATION_ID}"
fi

# Create or reuse demo projects
echo ""
echo "[2/4] Setting up demo projects..."

# Fetch existing projects to avoid creating duplicates on re-seed
EXISTING_PROJECTS=$(curl -sf "${API_URL}/api/v1/projects" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null || echo '{"data":[]}')

# Helper: delete existing API keys matching a name (prevents accumulation on re-seed)
cleanup_api_keys() {
  local key_name=$1
  local existing_keys
  existing_keys=$(curl -sf "${API_URL}/api/v1/api-keys?limit=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null || echo '{"data":[]}')

  local key_ids
  key_ids=$(echo "$existing_keys" | jq -r --arg name "$key_name" '.data[]? | select(.name==$name) | .id' 2>/dev/null)

  for key_id in $key_ids; do
    curl -sf -X DELETE "${API_URL}/api/v1/api-keys/${key_id}" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" > /dev/null 2>&1 || true
  done
}

# Helper: create an API key for a project via /api/v1/api-keys
create_api_key() {
  local project_id=$1
  local key_name=$2
  local payload
  payload=$(jq -n \
    --arg name "$key_name" \
    --arg pid "$project_id" \
    '{name: $name, type: "development", allowed_projects: [$pid]}')

  local response
  response=$(curl -sf -X POST "${API_URL}/api/v1/api-keys" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d "$payload")

  echo "$response" | jq -r '.data.api_key'
}

# Look up existing projects by name
SDK_PROJECT_ID=$(echo "$EXISTING_PROJECTS" | jq -r '.data[]? | select(.name=="Demo Web App") | .id' | head -1)

if [ -n "$SDK_PROJECT_ID" ] && [ "$SDK_PROJECT_ID" != "null" ]; then
  echo "  Reusing: Demo Web App (ID: $SDK_PROJECT_ID)"
else
  PROJECT_SDK_BODY=$(jq -nc --arg name "Demo Web App" --arg org "${ORGANIZATION_ID:-}" \
    'if $org != "" then {name: $name, organization_id: $org} else {name: $name} end')
  PROJECT_SDK=$(curl -sf -X POST "${API_URL}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d "$PROJECT_SDK_BODY")
  SDK_PROJECT_ID=$(echo "$PROJECT_SDK" | jq -r '.data.id')
  if [ -n "$SDK_PROJECT_ID" ] && [ "$SDK_PROJECT_ID" != "null" ]; then
    echo "  Created: Demo Web App (ID: $SDK_PROJECT_ID)"
  else
    echo "  WARN - Could not create 'Demo Web App', trying to continue..."
  fi
fi

# Create API key for the SDK demo project (delete old ones first to prevent accumulation)
if [ -n "$SDK_PROJECT_ID" ] && [ "$SDK_PROJECT_ID" != "null" ]; then
  cleanup_api_keys "Demo Web App Key"
  SDK_PROJECT_KEY=$(create_api_key "$SDK_PROJECT_ID" "Demo Web App Key")
  if [ -n "$SDK_PROJECT_KEY" ] && [ "$SDK_PROJECT_KEY" != "null" ]; then
    echo "  API key created for Demo Web App"
  else
    echo "  WARN - Could not create API key for Demo Web App"
  fi
fi

EXT_PROJECT_ID=$(echo "$EXISTING_PROJECTS" | jq -r '.data[]? | select(.name=="Extension Reports") | .id' | head -1)

if [ -n "$EXT_PROJECT_ID" ] && [ "$EXT_PROJECT_ID" != "null" ]; then
  echo "  Reusing: Extension Reports (ID: $EXT_PROJECT_ID)"
else
  PROJECT_EXT_BODY=$(jq -nc --arg name "Extension Reports" --arg org "${ORGANIZATION_ID:-}" \
    'if $org != "" then {name: $name, organization_id: $org} else {name: $name} end')
  PROJECT_EXT=$(curl -sf -X POST "${API_URL}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d "$PROJECT_EXT_BODY")
  EXT_PROJECT_ID=$(echo "$PROJECT_EXT" | jq -r '.data.id')
  if [ -n "$EXT_PROJECT_ID" ] && [ "$EXT_PROJECT_ID" != "null" ]; then
    echo "  Created: Extension Reports (ID: $EXT_PROJECT_ID)"
  else
    echo "  WARN - Could not create 'Extension Reports', trying to continue..."
  fi
fi

# Create API key for the Extension demo project (delete old ones first to prevent accumulation)
if [ -n "$EXT_PROJECT_ID" ] && [ "$EXT_PROJECT_ID" != "null" ]; then
  cleanup_api_keys "Extension Reports Key"
  EXT_PROJECT_KEY=$(create_api_key "$EXT_PROJECT_ID" "Extension Reports Key")
  if [ -n "$EXT_PROJECT_KEY" ] && [ "$EXT_PROJECT_KEY" != "null" ]; then
    echo "  API key created for Extension Reports"
  else
    echo "  WARN - Could not create API key for Extension Reports"
  fi
fi

# Create or reuse a demo viewer account for the admin panel
DEMO_VIEWER_EMAIL="demo@bugspotter.io"
DEMO_VIEWER_PASSWORD="BugSpotter-Demo-2026"
echo ""
echo "  Setting up demo viewer account..."

# Check if user already exists by trying to login
DEMO_LOGIN=$(curl -sf -X POST "${API_URL}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg email "$DEMO_VIEWER_EMAIL" --arg password "$DEMO_VIEWER_PASSWORD" \
    '{email: $email, password: $password}')" 2>/dev/null || echo '{}')
DEMO_USER_TOKEN=$(echo "$DEMO_LOGIN" | jq -r '.data.access_token' 2>/dev/null)

if [ -n "$DEMO_USER_TOKEN" ] && [ "$DEMO_USER_TOKEN" != "null" ]; then
  echo "  Reusing: ${DEMO_VIEWER_EMAIL} (viewer)"
else
  # Create new viewer account via admin API
  DEMO_USER_BODY=$(jq -n \
    --arg email "$DEMO_VIEWER_EMAIL" \
    --arg password "$DEMO_VIEWER_PASSWORD" \
    '{email: $email, name: "Demo Viewer", role: "viewer", password: $password}')
  DEMO_USER_RESP=$(curl -sf -X POST "${API_URL}/api/v1/admin/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d "$DEMO_USER_BODY" 2>/dev/null || echo '{}')
  DEMO_USER_ID=$(echo "$DEMO_USER_RESP" | jq -r '.data.id' 2>/dev/null)
  if [ -n "$DEMO_USER_ID" ] && [ "$DEMO_USER_ID" != "null" ]; then
    echo "  Created: ${DEMO_VIEWER_EMAIL} (viewer)"
  else
    echo "  WARN - Could not create demo viewer account (may already exist with different password)"
  fi
fi

# Verify we have at least one usable key
if { [ -z "$SDK_PROJECT_KEY" ] || [ "$SDK_PROJECT_KEY" = "null" ]; } && \
   { [ -z "$EXT_PROJECT_KEY" ] || [ "$EXT_PROJECT_KEY" = "null" ]; }; then
  echo "  FAILED - No API keys available. Cannot seed reports."
  exit 1
fi

# Helper function to create a bug report (uses jq for safe JSON construction)
create_report() {
  local api_key=$1
  local title=$2
  local description=$3
  local priority=$4
  local url=$5
  local browser=$6
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

  local payload
  payload=$(jq -n \
    --arg title "$title" \
    --arg desc "$description" \
    --arg ua "Mozilla/5.0 ($browser)" \
    --arg url "$url" \
    --arg priority "$priority" \
    --arg ts "$timestamp" \
    '{
      title: $title,
      description: $desc,
      report: {
        console: [
          { level: "error", message: $title, timestamp: $ts },
          { level: "warn", message: "Possible performance issue detected", timestamp: $ts },
          { level: "info", message: "Page loaded in 2.3s", timestamp: $ts }
        ],
        network: [
          { url: ($url + "/api/data"), method: "GET", status: 500, duration: 1234 },
          { url: ($url + "/api/auth"), method: "POST", status: 200, duration: 89 }
        ],
        metadata: {
          userAgent: $ua,
          priority: $priority,
          url: $url
        }
      }
    }')

  curl -sf -X POST "${API_URL}/api/v1/reports" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${api_key}" \
    -d "$payload" > /dev/null 2>&1

  echo "   + ${title} (${priority})"
}

# Seed bug reports
echo ""
echo "[3/4] Creating realistic bug reports..."

if [ -n "$SDK_PROJECT_KEY" ] && [ "$SDK_PROJECT_KEY" != "null" ]; then
  echo ""
  echo "  Project: Demo Web App"
  create_report "$SDK_PROJECT_KEY" "Checkout form crashes on Safari 17" \
    "Users on Safari 17.2 see a blank screen when submitting the checkout form. No error in UI but console shows TypeError." \
    "critical" "https://app.example.com/checkout" "Macintosh; Intel Mac OS X 14_0; Safari/17.2"

  create_report "$SDK_PROJECT_KEY" "Dashboard charts fail to render after login" \
    "The main analytics dashboard shows 'Loading...' indefinitely. API calls return 200 but the chart library throws during render." \
    "high" "https://app.example.com/dashboard" "Windows NT 10.0; Win64; x64; Chrome/120.0.0.0"

  create_report "$SDK_PROJECT_KEY" "Search returns stale results after filter change" \
    "When switching from 'Active' to 'Archived' filter, search results still show active items until page refresh." \
    "medium" "https://app.example.com/search" "Windows NT 10.0; Win64; x64; Chrome/120.0.0.0"

  create_report "$SDK_PROJECT_KEY" "Mobile nav menu stays open after route change" \
    "On mobile viewport (<768px), the hamburger menu does not close when navigating to a new page. Requires manual close." \
    "medium" "https://app.example.com/settings" "Linux; Android 14; Pixel 8; Chrome/120.0.0.0"

  create_report "$SDK_PROJECT_KEY" "File upload fails for files over 10MB" \
    "Uploading attachments >10MB shows a generic 'Upload failed' error. The server returns 413 but the UI doesn't show a helpful message." \
    "high" "https://app.example.com/upload" "Macintosh; Intel Mac OS X 14_0; Chrome/120.0.0.0"

  create_report "$SDK_PROJECT_KEY" "Tooltip text cut off on small screens" \
    "Help tooltips in the settings page are truncated on screens narrower than 1024px. Text overflows the container." \
    "low" "https://app.example.com/settings" "Windows NT 10.0; Win64; x64; Firefox/121.0"

  create_report "$SDK_PROJECT_KEY" "API timeout on /users endpoint with 1000+ results" \
    "The user list page times out when the organization has over 1000 members. The API takes 30+ seconds and the frontend shows a loading spinner forever." \
    "critical" "https://app.example.com/admin/users" "Windows NT 10.0; Win64; x64; Chrome/120.0.0.0"

  create_report "$SDK_PROJECT_KEY" "Password reset email has wrong link" \
    "The password reset email contains a link to the old domain (app-v1.example.com) instead of the current domain." \
    "high" "https://app.example.com/forgot-password" "iPhone; CPU iPhone OS 17_0; Safari/605.1.15"

  create_report "$SDK_PROJECT_KEY" "Dark mode toggle doesn't persist across sessions" \
    "Selecting dark mode works during the session, but on page reload it reverts to light mode. localStorage check shows the preference is not saved." \
    "low" "https://app.example.com/settings/appearance" "Macintosh; Intel Mac OS X 14_0; Chrome/120.0.0.0"

  create_report "$SDK_PROJECT_KEY" "Export CSV generates empty file for large datasets" \
    "Exporting more than 5000 rows produces a CSV file with only headers. Smaller exports work correctly." \
    "medium" "https://app.example.com/reports/export" "Windows NT 10.0; Win64; x64; Chrome/120.0.0.0"
fi

if [ -n "$EXT_PROJECT_KEY" ] && [ "$EXT_PROJECT_KEY" != "null" ]; then
  echo ""
  echo "  Project: Extension Reports"
  create_report "$EXT_PROJECT_KEY" "Login page shows CORS error on staging" \
    "Staging environment login fails with CORS policy error. Production works fine. Likely a missing origin in the server config." \
    "high" "https://staging.example.com/login" "Windows NT 10.0; Win64; x64; Chrome/120.0.0.0"

  create_report "$EXT_PROJECT_KEY" "Third-party widget overlaps our footer" \
    "The Intercom chat widget overlaps with our sticky footer on mobile. z-index conflict." \
    "low" "https://www.example.com" "iPhone; CPU iPhone OS 17_0; Safari/605.1.15"

  create_report "$EXT_PROJECT_KEY" "Payment page SSL certificate warning" \
    "Chrome shows 'Not Secure' warning on the payment page. The certificate seems to have an intermediate chain issue." \
    "critical" "https://pay.example.com/checkout" "Windows NT 10.0; Win64; x64; Chrome/120.0.0.0"
fi

# Summary
echo ""
echo "[4/4] Done!"
echo ""
echo "============================================"
echo "  Demo data seeded successfully"
echo "============================================"
echo ""
echo "  Projects created:"
if [ -n "$SDK_PROJECT_KEY" ] && [ "$SDK_PROJECT_KEY" != "null" ]; then
  echo "    Demo Web App     API Key: ${SDK_PROJECT_KEY}"
fi
if [ -n "$EXT_PROJECT_KEY" ] && [ "$EXT_PROJECT_KEY" != "null" ]; then
  echo "    Extension Reports API Key: ${EXT_PROJECT_KEY}"
fi
echo ""
echo "  Bug reports: 13 total (10 + 3)"
echo ""
echo "  Demo viewer account:"
echo "    Email:    ${DEMO_VIEWER_EMAIL}"
echo "    Password: ${DEMO_VIEWER_PASSWORD}"
echo "    Role:     viewer (read-only)"
echo ""
echo "  Next steps:"
echo "    1. Set DEMO_API_KEY env var to the SDK project API key above"
echo "    2. Set DEMO_API_URL env var to ${API_URL}"
echo "    3. Set DEMO_ADMIN_URL env var to the admin panel URL"
echo "    4. Restart the demo container to pick up the new config"
echo "    5. Open the admin panel to verify: ${API_URL}"
echo ""
