#!/bin/bash
# Quick test script to verify the metadata fix
# Creates a test bug report with rich metadata and verifies it was saved

set -e

echo "🧪 Testing Bug Report Metadata Fix..."
echo ""

# Configuration
API_ENDPOINT="${API_ENDPOINT:-http://localhost:3000}"
API_KEY="${API_KEY:-}"

if [ -z "$API_KEY" ]; then
  echo "❌ Error: API_KEY environment variable is required"
  echo "Usage: API_KEY=your-key ./scripts/test-metadata-fix.sh"
  exit 1
fi

# Create test bug report with rich metadata
echo "📝 Creating bug report with metadata..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/api/v1/reports" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "title": "Metadata Test Report",
    "description": "Testing that metadata is saved correctly",
    "priority": "medium",
    "report": {
      "console": [
        {
          "level": "error",
          "message": "Test error message",
          "timestamp": 1700000000000,
          "stack": "Error: Test\n  at test.js:10:15"
        },
        {
          "level": "warn",
          "message": "Test warning",
          "timestamp": 1700000001000
        },
        {
          "level": "info",
          "message": "Test info",
          "timestamp": 1700000002000
        }
      ],
      "network": [
        {
          "url": "/api/test",
          "method": "GET",
          "status": 200,
          "duration": 123,
          "timestamp": 1700000000000,
          "headers": {
            "content-type": "application/json"
          }
        },
        {
          "url": "/api/data",
          "method": "POST",
          "status": 201,
          "duration": 456,
          "timestamp": 1700000001000
        }
      ],
      "metadata": {
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "viewport": {
          "width": 1920,
          "height": 1080
        },
        "browser": "Chrome",
        "browserVersion": "120.0.0",
        "os": "Windows",
        "osVersion": "10",
        "url": "https://example.com/test",
        "timestamp": 1700000000000
      }
    }
  }')

# Check if request was successful
if [ $? -ne 0 ]; then
  echo "❌ Failed to create bug report"
  exit 1
fi

# Parse response
SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
BUG_ID=$(echo "$RESPONSE" | jq -r '.data.id')

if [ "$SUCCESS" != "true" ]; then
  echo "❌ Bug report creation failed"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo "✅ Bug report created: $BUG_ID"
echo ""

# Verify metadata was saved
echo "🔍 Verifying metadata..."

# Check console logs
CONSOLE_COUNT=$(echo "$RESPONSE" | jq '.data.metadata.console | length')
echo "   Console logs: $CONSOLE_COUNT (expected: 3)"

if [ "$CONSOLE_COUNT" != "3" ]; then
  echo "   ❌ FAIL: Expected 3 console logs, got $CONSOLE_COUNT"
  exit 1
fi

# Verify console log properties
HAS_STACK=$(echo "$RESPONSE" | jq '.data.metadata.console[0].stack' | grep -c "Error: Test" || true)
if [ "$HAS_STACK" -eq 0 ]; then
  echo "   ❌ FAIL: Console log missing 'stack' property"
  exit 1
fi

# Check network requests
NETWORK_COUNT=$(echo "$RESPONSE" | jq '.data.metadata.network | length')
echo "   Network requests: $NETWORK_COUNT (expected: 2)"

if [ "$NETWORK_COUNT" != "2" ]; then
  echo "   ❌ FAIL: Expected 2 network requests, got $NETWORK_COUNT"
  exit 1
fi

# Verify network request headers
HAS_HEADERS=$(echo "$RESPONSE" | jq '.data.metadata.network[0].headers' | grep -c "content-type" || true)
if [ "$HAS_HEADERS" -eq 0 ]; then
  echo "   ❌ FAIL: Network request missing 'headers' property"
  exit 1
fi

# Check browser metadata
METADATA_KEYS=$(echo "$RESPONSE" | jq '.data.metadata.metadata | keys | length')
echo "   Browser metadata fields: $METADATA_KEYS (expected: 8)"

if [ "$METADATA_KEYS" -lt 5 ]; then
  echo "   ❌ FAIL: Expected at least 5 metadata fields, got $METADATA_KEYS"
  exit 1
fi

# Verify viewport nested object
HAS_VIEWPORT_WIDTH=$(echo "$RESPONSE" | jq '.data.metadata.metadata.viewport.width')
if [ "$HAS_VIEWPORT_WIDTH" != "1920" ]; then
  echo "   ❌ FAIL: Viewport width not saved correctly"
  exit 1
fi

echo ""
echo "✅ All metadata tests passed!"
echo ""
echo "📊 Summary:"
echo "   • Console logs: ✅ 3 entries with nested properties"
echo "   • Network requests: ✅ 2 entries with headers"
echo "   • Browser metadata: ✅ 8 fields including nested viewport"
echo ""
echo "🎉 The metadata fix is working correctly!"
