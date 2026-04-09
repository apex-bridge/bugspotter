#!/bin/bash

# Simple test script for User Management and Analytics APIs (no jq required)
API_URL="http://localhost:3000"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-your-secure-password}"

# WARNING: Do not commit real credentials to the repository!
# Set credentials via environment variables:
#   export ADMIN_EMAIL="your-admin@email.com"
#   export ADMIN_PASSWORD="your-secure-password"

echo " Step 1: Login as admin to get JWT token..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\"
  }")

echo "$LOGIN_RESPONSE"
echo ""

# Extract token using grep and sed (no jq needed)
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"access_token":"[^"]*"' | sed 's/"access_token":"//;s/"$//')

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Login failed! Make sure you've set up the admin account first."
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "Login successful! Token: ${ACCESS_TOKEN:0:30}..."
echo ""

# ==============================================================================
# USER MANAGEMENT TESTS
# ==============================================================================

echo "=============================================="
echo " Step 2: List all users (with pagination)..."
echo "=============================================="
curl -s "$API_URL/api/v1/admin/users?page=1&limit=10" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo ""
echo ""

echo "=============================================="
echo " Step 3: Create a new user..."
echo "=============================================="
CREATE_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/admin/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "name": "Test User",
    "password": "password123",
    "role": "user"
  }')

echo "$CREATE_RESPONSE"
USER_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"$//')
echo ""
echo " Created user with ID: $USER_ID"
echo ""

echo "=============================================="
echo " Step 4: Search users by email..."
echo "=============================================="
curl -s "$API_URL/api/v1/admin/users?email=test" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo ""
echo ""

echo "=============================================="
echo " Step 5: Update user details..."
echo "=============================================="
curl -s -X PATCH "$API_URL/api/v1/admin/users/$USER_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Test User"
  }'
echo ""
echo ""

echo "=============================================="
echo " Step 6: Filter users by role (admin only)..."
echo "=============================================="
curl -s "$API_URL/api/v1/admin/users?role=admin" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo ""
echo ""

# ==============================================================================
# ANALYTICS TESTS
# ==============================================================================

echo "=============================================="
echo " Step 7: Get dashboard overview metrics..."
echo "=============================================="
curl -s "$API_URL/api/v1/analytics/dashboard" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo ""
echo ""

echo "=============================================="
echo " Step 8: Get 7-day trend analysis..."
echo "=============================================="
curl -s "$API_URL/api/v1/analytics/reports/trend?days=7" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo ""
echo ""

echo "=============================================="
echo "  Step 9: Get per-project statistics..."
echo "=============================================="
curl -s "$API_URL/api/v1/analytics/projects/stats" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo ""
echo ""

# ==============================================================================
# CLEANUP
# ==============================================================================

echo "=============================================="
echo "  Step 10: Delete test user..."
echo "=============================================="
curl -s -X DELETE "$API_URL/api/v1/admin/users/$USER_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo ""
echo ""

echo " All tests completed!"
echo ""
echo " Tips:"
echo "  - User Management UI: http://localhost:3001/users"
echo "  - Analytics Dashboard: http://localhost:3001/dashboard"
echo "  - Login with: $ADMIN_EMAIL / $ADMIN_PASSWORD"
