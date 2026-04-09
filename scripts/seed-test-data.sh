#!/bin/bash
set -e

# Seed test data for E2E tests
# This script creates projects and bug reports for testing

API_URL="${API_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@bugspotter.io}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

echo " Seeding test data..."

# Login and get access token
echo " Logging in as admin..."
LOGIN_RESPONSE=$(curl -sf -X POST "${API_URL}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo "Failed to get access token"
  exit 1
fi

echo " Logged in successfully"

# Create test projects
echo " Creating test projects..."

PROJECT_1=$(curl -sf -X POST "${API_URL}/api/v1/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -d '{"name":"E2E Test Project 1","description":"Test project for E2E tests"}')

PROJECT_1_ID=$(echo "$PROJECT_1" | jq -r '.data.id')
PROJECT_1_KEY=$(echo "$PROJECT_1" | jq -r '.data.api_key')

if [ -z "$PROJECT_1_ID" ] || [ "$PROJECT_1_ID" = "null" ]; then
  echo " Failed to create project 1"
  echo "$PROJECT_1"
  exit 1
fi

echo " Created project 1: $PROJECT_1_ID"

PROJECT_2=$(curl -sf -X POST "${API_URL}/api/v1/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -d '{"name":"E2E Test Project 2","description":"Second test project"}')

PROJECT_2_ID=$(echo "$PROJECT_2" | jq -r '.data.id')
PROJECT_2_KEY=$(echo "$PROJECT_2" | jq -r '.data.api_key')

echo " Created project 2: $PROJECT_2_ID"

# Create bug reports with different statuses and priorities
echo " Creating bug reports..."

# Helper function to create a bug report
create_bug_report() {
  local project_key=$1
  local title=$2
  local status=$3
  local priority=$4
  local legal_hold=$5
  
  local metadata="{\"status\":\"${status}\",\"priority\":\"${priority}\""
  if [ "$legal_hold" = "true" ]; then
    metadata="${metadata},\"legal_hold\":true"
  fi
  metadata="${metadata}}"
  
  curl -sf -X POST "${API_URL}/api/v1/reports" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${project_key}" \
    -d "{
      \"title\":\"${title}\",
      \"description\":\"Test bug report for E2E testing\",
      \"user_agent\":\"Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0\",
      \"url\":\"https://app.example.com/test\",
      \"metadata\":${metadata},
      \"console_logs\":[
        {\"level\":\"error\",\"message\":\"Test error message\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}
      ],
      \"network_logs\":[],
      \"custom_data\":{}
    }" > /dev/null
  
  echo "   Created: $title"
}

# Project 1 - Various statuses
create_bug_report "$PROJECT_1_KEY" "Login page crashes on submit" "open" "critical" "false"
create_bug_report "$PROJECT_1_KEY" "Dashboard loads slowly" "open" "high" "false"
create_bug_report "$PROJECT_1_KEY" "Search filter not working" "open" "medium" "false"
create_bug_report "$PROJECT_1_KEY" "Typo in footer text" "open" "low" "false"
create_bug_report "$PROJECT_1_KEY" "Cannot upload large files" "in_progress" "high" "false"
create_bug_report "$PROJECT_1_KEY" "Mobile menu not closing" "in_progress" "medium" "false"
create_bug_report "$PROJECT_1_KEY" "Email validation too strict" "resolved" "low" "false"
create_bug_report "$PROJECT_1_KEY" "Password reset link expired" "resolved" "medium" "false"
create_bug_report "$PROJECT_1_KEY" "Profile picture upload issue" "closed" "low" "false"

# Project 1 - One with legal hold
create_bug_report "$PROJECT_1_KEY" "Security vulnerability in auth" "open" "critical" "true"

# Project 2 - Fewer reports
create_bug_report "$PROJECT_2_KEY" "API timeout on large requests" "open" "high" "false"
create_bug_report "$PROJECT_2_KEY" "Cache invalidation issue" "in_progress" "medium" "false"
create_bug_report "$PROJECT_2_KEY" "Memory leak in worker process" "resolved" "critical" "false"

echo ""
echo " Test data seeding completed!"
echo ""
echo " Summary:"
echo "  - Projects: 2"
echo "  - Bug reports: 13 (10 in project 1, 3 in project 2)"
echo "  - Statuses: open, in_progress, resolved, closed"
echo "  - Priorities: low, medium, high, critical"
echo "  - Legal hold reports: 1"
echo ""
echo " Ready for E2E tests!"
