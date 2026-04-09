#!/bin/bash
# Set environment variables for Docker builds
# Usage: source ./scripts/set-build-env.sh

# Get current git commit hash
export GIT_COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

echo "Build environment variables set:"
echo "  GIT_COMMIT_HASH=${GIT_COMMIT_HASH}"
