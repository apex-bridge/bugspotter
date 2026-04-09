#!/bin/bash
# Cleanup all test integrations

# Get admin token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bugspotter.io","password":"admin123"}' \
  | jq -r '.data.access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "Failed to get admin token"
  exit 1
fi

echo "Got admin token"

# Get all integrations
INTEGRATIONS=$(curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/admin/integrations \
  | jq -r '.data[].type')

echo "Found integrations:"
echo "$INTEGRATIONS"

# Delete each integration (complete removal)
for type in $INTEGRATIONS; do
  echo "Deleting $type..."
  curl -s -X DELETE \
    -H "Authorization: Bearer $TOKEN" \
    "http://localhost:3000/api/v1/admin/integrations/$type"
  echo ""
done

echo "Cleanup complete"
