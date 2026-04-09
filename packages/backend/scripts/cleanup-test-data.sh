#!/bin/bash

# Cleanup script for test data directories
# Removes all test-uploads-* and test-e2e-uploads-* directories

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

echo " Cleaning up test data directories..."

# Count directories before cleanup
BEFORE=$(find . -maxdepth 1 -type d \( -name "test-uploads-*" -o -name "test-e2e-uploads-*" \) | wc -l)

if [ "$BEFORE" -eq 0 ]; then
  echo "No test directories found. Already clean!"
  exit 0
fi

echo "Found $BEFORE test directories to remove"

# Remove test directories
find . -maxdepth 1 -type d \( -name "test-uploads-*" -o -name "test-e2e-uploads-*" \) -exec rm -rf {} +

# Verify cleanup
AFTER=$(find . -maxdepth 1 -type d \( -name "test-uploads-*" -o -name "test-e2e-uploads-*" \) | wc -l)

if [ "$AFTER" -eq 0 ]; then
  echo " Successfully removed $BEFORE test directories"
else
  echo "  Warning: $AFTER directories still remain"
  exit 1
fi
