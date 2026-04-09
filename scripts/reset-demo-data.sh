#!/bin/bash
set -e

# ============================================================================
# Reset and re-seed demo data for the BugSpotter cloud demo instance.
# Designed to run as a daily/weekly cron job to keep the demo clean.
#
# Usage:
#   ./scripts/reset-demo-data.sh
#
# Cron example (daily at 3 AM):
#   0 3 * * * /path/to/bugspotter/scripts/reset-demo-data.sh >> /var/log/bugspotter-demo-reset.log 2>&1
#
# Environment variables:
#   API_URL        - BugSpotter API base URL
#   ADMIN_EMAIL    - Admin email
#   ADMIN_PASSWORD - Admin password
#   DEMO_PROJECT_IDS - Comma-separated project IDs to reset (optional — resets all if not set)
# ============================================================================

API_URL="${API_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@bugspotter.io}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Demo data reset started"
echo "  Target: ${API_URL}"

# Login
LOGIN_RESPONSE=$(curl -sf -X POST "${API_URL}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{email: $email, password: $password}')")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo "  FAILED - Authentication failed"
  exit 1
fi

# Get demo projects
echo "  Fetching projects..."
PROJECTS=$(curl -sf "${API_URL}/api/v1/projects" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

# Delete all reports in demo projects
echo "  Deleting existing demo reports..."

# If DEMO_PROJECT_IDS is set, use only those; otherwise discover from API
if [ -n "${DEMO_PROJECT_IDS:-}" ]; then
  echo "  Using explicit project IDs: ${DEMO_PROJECT_IDS}"
  PROJECT_IDS=$(echo "$DEMO_PROJECT_IDS" | tr ',' ' ')
else
  PROJECT_IDS=$(echo "$PROJECTS" | jq -r '.data[]? | .id')
fi

for PROJECT_ID in $PROJECT_IDS; do
  PROJECT_NAME=$(echo "$PROJECTS" | jq -r --arg pid "$PROJECT_ID" '.data[]? | select(.id==$pid) | .name')

  # Only reset projects with "Demo" or "Extension" in the name (safety guard)
  # Skip the check when using explicit DEMO_PROJECT_IDS — the user chose them
  if [ -z "${DEMO_PROJECT_IDS:-}" ]; then
    case "$PROJECT_NAME" in
      *Demo*|*Extension*|*demo*|*extension*) ;;
      *)
        echo "    Skipping: $PROJECT_NAME (not a demo project)"
        continue
        ;;
    esac
  fi

  echo "    Resetting: ${PROJECT_NAME:-$PROJECT_ID} ($PROJECT_ID)"

  # Fetch and delete all reports in this project (paginated, max 100 per request)
  TOTAL_DELETED=0
  PREV_BATCH_COUNT=-1
  STALE_ROUNDS=0
  while true; do
    REPORTS=$(curl -sf "${API_URL}/api/v1/reports?project_id=${PROJECT_ID}&limit=100" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null || echo '{"data":[]}')

    REPORT_IDS=$(echo "$REPORTS" | jq -r '.data[]? | .id' 2>/dev/null)
    BATCH_COUNT=$(echo "$REPORT_IDS" | grep -c . 2>/dev/null || echo "0")

    if [ "$BATCH_COUNT" -eq 0 ]; then
      break
    fi

    # Guard against infinite loop: if batch size unchanged for 3 rounds, bail out
    if [ "$BATCH_COUNT" -eq "$PREV_BATCH_COUNT" ]; then
      STALE_ROUNDS=$((STALE_ROUNDS + 1))
      if [ "$STALE_ROUNDS" -ge 3 ]; then
        echo "      WARN - deletion stalled ($BATCH_COUNT reports remain), breaking"
        break
      fi
    else
      STALE_ROUNDS=0
    fi
    PREV_BATCH_COUNT=$BATCH_COUNT

    # Bulk delete this batch (POST /api/v1/reports/bulk-delete accepts up to 100 IDs)
    BULK_BODY=$(printf '%s\n' $REPORT_IDS | jq -R . | jq -s '{ids: .}')
    curl -sf -X POST "${API_URL}/api/v1/reports/bulk-delete" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$BULK_BODY" > /dev/null 2>&1 || true

    TOTAL_DELETED=$((TOTAL_DELETED + BATCH_COUNT))
  done

  echo "      Deleted $TOTAL_DELETED reports"
done

# Re-seed
echo "  Re-seeding demo data..."
"${SCRIPT_DIR}/seed-demo-data.sh"

echo ""
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Demo data reset completed"
