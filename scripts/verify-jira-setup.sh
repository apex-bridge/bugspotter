#!/bin/bash
# Verify Jira E2E Test Setup
# Checks if Jira credentials are configured and working

set -e

echo " Checking Jira E2E Test Configuration..."
echo ""

# Load environment variables
if [ -f "packages/backend/.env.integration" ]; then
    echo " Found packages/backend/.env.integration"
    source packages/backend/.env.integration
elif [ -f ".env" ]; then
    echo " Found .env"
    source .env
else
    echo " No .env or .env.integration file found"
    echo "   Create packages/backend/.env.integration with Jira credentials"
    echo "   See apps/admin/JIRA_E2E_SETUP.md for instructions"
    exit 1
fi

# Check required variables
echo ""
echo " Checking environment variables..."

if [ -z "$JIRA_E2E_BASE_URL" ]; then
    echo " JIRA_E2E_BASE_URL not set"
    exit 1
else
    echo " JIRA_E2E_BASE_URL: $JIRA_E2E_BASE_URL"
fi

if [ -z "$JIRA_E2E_EMAIL" ]; then
    echo " JIRA_E2E_EMAIL not set"
    exit 1
else
    echo " JIRA_E2E_EMAIL: $JIRA_E2E_EMAIL"
fi

if [ -z "$JIRA_E2E_API_TOKEN" ]; then
    echo " JIRA_E2E_API_TOKEN not set"
    exit 1
else
    echo " JIRA_E2E_API_TOKEN: ${JIRA_E2E_API_TOKEN:0:10}..."
fi

if [ -z "$JIRA_E2E_PROJECT_KEY" ]; then
    echo "  JIRA_E2E_PROJECT_KEY not set (will use default: E2E)"
    JIRA_E2E_PROJECT_KEY="E2E"
else
    echo " JIRA_E2E_PROJECT_KEY: $JIRA_E2E_PROJECT_KEY"
fi

# Test connection
echo ""
echo " Testing Jira connection..."

RESPONSE=$(curl -s -w "\n%{http_code}" -u "${JIRA_E2E_EMAIL}:${JIRA_E2E_API_TOKEN}" \
    "${JIRA_E2E_BASE_URL}/rest/api/3/myself")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    DISPLAY_NAME=$(echo "$BODY" | jq -r '.displayName' 2>/dev/null || echo "Unknown")
    EMAIL=$(echo "$BODY" | jq -r '.emailAddress' 2>/dev/null || echo "Unknown")
    
    echo " Connection successful!"
    echo "   User: $DISPLAY_NAME"
    echo "   Email: $EMAIL"
else
    echo " Connection failed (HTTP $HTTP_CODE)"
    echo ""
    echo "Troubleshooting:"
    echo "1. Verify your API token is valid"
    echo "2. Check your email matches the token owner"
    echo "3. Ensure base URL is correct (no trailing slash)"
    echo ""
    echo "Response:"
    echo "$BODY" | head -5
    exit 1
fi

# Check project access
echo ""
echo " Checking project access..."

PROJECT_RESPONSE=$(curl -s -w "\n%{http_code}" -u "${JIRA_E2E_EMAIL}:${JIRA_E2E_API_TOKEN}" \
    "${JIRA_E2E_BASE_URL}/rest/api/3/project/${JIRA_E2E_PROJECT_KEY}")

PROJECT_HTTP_CODE=$(echo "$PROJECT_RESPONSE" | tail -n1)

if [ "$PROJECT_HTTP_CODE" = "200" ]; then
    PROJECT_NAME=$(echo "$PROJECT_RESPONSE" | head -n-1 | jq -r '.name' 2>/dev/null || echo "Unknown")
    echo " Project '$JIRA_E2E_PROJECT_KEY' accessible"
    echo "   Name: $PROJECT_NAME"
elif [ "$PROJECT_HTTP_CODE" = "404" ]; then
    echo "  Project '$JIRA_E2E_PROJECT_KEY' not found"
    echo "   Create a project with key '$JIRA_E2E_PROJECT_KEY' in Jira"
    echo "   Or update JIRA_E2E_PROJECT_KEY to match an existing project"
else
    echo "  Could not verify project access (HTTP $PROJECT_HTTP_CODE)"
fi

echo ""
echo " Jira E2E setup verification complete!"
echo ""
echo "Ready to run E2E tests:"
echo "  cd apps/admin"
echo "  pnpm test:e2e jira-integration.spec.ts"
