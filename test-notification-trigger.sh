#!/bin/bash

# Script to manually test notification triggering
# Follows the same steps as the E2E test

API_URL="http://localhost:3000"

echo "=== Testing Email Notification Trigger ==="
echo

# Step 1: Login
echo "1. Logging in as admin..."
TOKEN=$(curl -s -X POST "$API_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bugspotter.io","password":"admin123"}' \
  | jq -r '.data.access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo " Failed to login"
  exit 1
fi
echo " Logged in successfully"
echo "Token: ${TOKEN:0:20}..."
echo

# Step 2: Get or create project
echo "2. Getting/Creating project..."
PROJECT_ID=$(curl -s "$API_URL/api/v1/projects" \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data[0].id // empty')

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(curl -s -X POST "$API_URL/api/v1/projects" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Email Test Project","description":"Test project for email notifications"}' \
    | jq -r '.data.id')
fi

echo " Project ID: $PROJECT_ID"
echo

# Step 3: Create API key
echo "3. Creating API key..."
API_KEY=$(curl -s -X POST "$API_URL/api/v1/api-keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test API Key $(date +%s)\",\"type\":\"test\",\"allowed_projects\":[\"$PROJECT_ID\"]}" \
  | jq -r '.data.api_key')

echo " API Key: ${API_KEY:0:20}..."
echo

# Step 4: Create email channel
echo "4. Creating email notification channel..."
CHANNEL_ID=$(curl -s -X POST "$API_URL/api/v1/notifications/channels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"$PROJECT_ID\",
    \"name\": \"Test Email Channel\",
    \"type\": \"email\",
    \"active\": true,
    \"config\": {
      \"smtp_host\": \"${SMTP_HOST}\",
      \"smtp_port\": ${SMTP_PORT:-587},
      \"smtp_secure\": ${SMTP_SECURE:-false},
      \"smtp_user\": \"${SMTP_USER}\",
      \"smtp_pass\": \"${SMTP_PASS}\",
      \"from_address\": \"${EMAIL_FROM_ADDRESS:-$SMTP_USER}\",
      \"from_name\": \"BugSpotter Test\"
    }
  }" \
  | jq -r '.data.id')

echo " Channel ID: $CHANNEL_ID"
echo

# Step 5: Create email template
echo "5. Creating email template..."
TEMPLATE_ID=$(curl -s -X POST "$API_URL/api/v1/notifications/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Test Email Template $(date +%s)\",
    \"channel_type\": \"email\",
    \"trigger_type\": \"new_bug\",
    \"subject\": \" New Bug: {{bug.title}}\",
    \"body\": \"A new bug has been reported:\\n\\nTitle: {{bug.title}}\\nPriority: {{bug.priority}}\",
    \"recipients\": [\"${EMAIL_RECIPIENTS}\"]
  }" \
  | jq -r '.data.id')

echo " Template ID: $TEMPLATE_ID"
echo

# Step 6: Create notification rule
echo "6. Creating notification rule..."
RULE_ID=$(curl -s -X POST "$API_URL/api/v1/notifications/rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"$PROJECT_ID\",
    \"name\": \"Test Email Rule\",
    \"enabled\": true,
    \"triggers\": [
      {
        \"event\": \"new_bug\",
        \"params\": { \"priority\": \"critical\" }
      }
    ],
    \"channel_ids\": [\"$CHANNEL_ID\"]
  }" \
  | jq -r '.data.id')

echo " Rule ID: $RULE_ID"
echo

# Step 7: Create bug report with critical priority
TEST_ID="manual_test_$(date +%s)_$(openssl rand -hex 4)"
echo "7. Creating bug report to trigger notification..."
echo "Test ID: $TEST_ID"

BUG_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/reports" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Manual Test Bug - $TEST_ID\",
    \"description\": \"This is a manual test bug report with ID: $TEST_ID\",
    \"priority\": \"critical\",
    \"report\": {
      \"console\": [
        {
          \"level\": \"error\",
          \"message\": \"Manual test error\",
          \"timestamp\": $(date +%s)000
        }
      ],
      \"network\": [],
      \"metadata\": {
        \"browser\": \"Chrome\",
        \"os\": \"Linux\",
        \"url\": \"https://example.com/test\",
        \"userAgent\": \"Mozilla/5.0 (Manual Test)\",
        \"viewport\": { \"width\": 1920, \"height\": 1080 },
        \"timestamp\": $(date +%s)000,
        \"test_id\": \"$TEST_ID\"
      }
    }
  }")

BUG_ID=$(echo "$BUG_RESPONSE" | jq -r '.data.id')
echo " Bug Report ID: $BUG_ID"
echo

# Check backend logs for notification trigger
echo "8. Checking backend logs for notification trigger..."
docker-compose logs api --tail=20 | grep -i "notification\|trigger\|processNewBug"
echo

# Step 9: Check notification history
echo "9. Waiting and checking notification history..."
for i in {1..10}; do
  echo "Attempt $i: Checking notification history..."
  
  HISTORY=$(curl -s "$API_URL/api/v1/notifications/history?project_id=$PROJECT_ID&limit=50" \
    -H "Authorization: Bearer $TOKEN")
  
  FOUND=$(echo "$HISTORY" | jq -r ".data.history[] | select(.payload | tostring | contains(\"$TEST_ID\")) | .id // empty")
  
  if [ -n "$FOUND" ]; then
    echo " Notification found in history! ID: $FOUND"
    echo
    echo "Full notification details:"
    echo "$HISTORY" | jq ".data.history[] | select(.id==\"$FOUND\")"
    break
  else
    echo " Not found yet, waiting 3 seconds..."
    sleep 3
  fi
done

if [ -z "$FOUND" ]; then
  echo " Notification NOT found in history after 30 seconds"
  echo
  echo "Full history response:"
  echo "$HISTORY" | jq '.'
fi

echo
echo "=== Test complete ==="
echo "Test ID: $TEST_ID"
echo "Bug ID: $BUG_ID"
echo "Channel ID: $CHANNEL_ID"
echo "Rule ID: $RULE_ID"
