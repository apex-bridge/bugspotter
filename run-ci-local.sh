#!/bin/bash
# ============================================================================
# run-ci-local.sh - Run GitHub Actions CI locally using act
# ============================================================================
# Prerequisites:
#   1. Install act: curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
#   2. Install Docker (act runs workflows in containers)
#   3. Copy .env.act.example to .env.act and customize
#
# Usage:
#   ./run-ci-local.sh [job-name] [options]
#
# Examples:
#   ./run-ci-local.sh                    # Run all jobs
#   ./run-ci-local.sh lint              # Run only lint job
#   ./run-ci-local.sh playwright-admin  # Run admin E2E tests
#   ./run-ci-local.sh --list            # List available jobs
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if act is installed
if ! command -v act &> /dev/null; then
    echo -e "${RED}Error: act is not installed${NC}"
    echo ""
    echo "Install act with:"
    echo "  curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash"
    echo ""
    echo "Or on macOS with Homebrew:"
    echo "  brew install act"
    echo ""
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo -e "${RED}Error: Docker is not running${NC}"
    echo "Please start Docker and try again."
    exit 1
fi

# Check if .env.act exists
if [ ! -f .env.act ]; then
    echo -e "${YELLOW}Warning: .env.act not found${NC}"
    echo "Creating from .env.act.example..."
    cp .env.act.example .env.act
    echo -e "${GREEN} Created .env.act${NC}"
    echo ""
    echo "Edit .env.act if you need custom values."
    echo ""
fi

# Parse arguments
JOB_NAME=""
ACT_ARGS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --list|-l)
            echo -e "${BLUE}Available jobs in CI workflow:${NC}"
            act -l
            exit 0
            ;;
        --help|-h)
            echo "Usage: $0 [job-name] [act-options]"
            echo ""
            echo "Examples:"
            echo "  $0                    # Run all jobs"
            echo "  $0 lint              # Run only lint job"
            echo "  $0 test              # Run test job"
            echo "  $0 test-backend      # Run backend tests"
            echo "  $0 playwright        # Run SDK browser tests"
            echo "  $0 playwright-admin  # Run admin E2E tests"
            echo "  $0 build             # Run build job"
            echo "  $0 --list            # List all available jobs"
            echo ""
            echo "act options are passed through (e.g., --dryrun, --verbose)"
            exit 0
            ;;
        -*)
            ACT_ARGS+=("$1")
            ;;
        *)
            JOB_NAME="$1"
            ;;
    esac
    shift
done

# Build act command
ACT_CMD="act"

if [ -n "$JOB_NAME" ]; then
    ACT_CMD="$ACT_CMD -j $JOB_NAME"
fi

# Add extra args
if [ ${#ACT_ARGS[@]} -gt 0 ]; then
    ACT_CMD="$ACT_CMD ${ACT_ARGS[*]}"
fi

# Display what we're running
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Running CI locally with act${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
if [ -n "$JOB_NAME" ]; then
    echo -e "Job: ${GREEN}$JOB_NAME${NC}"
else
    echo -e "Job: ${GREEN}all${NC}"
fi
echo -e "Command: ${YELLOW}$ACT_CMD${NC}"
echo ""

# Warning for playwright-admin job
if [ "$JOB_NAME" = "playwright-admin" ]; then
    echo -e "${YELLOW}  Note: playwright-admin requires Docker-in-Docker${NC}"
    echo -e "${YELLOW}   This may take 10-15 minutes on first run${NC}"
    echo ""
fi

# Run act
echo -e "${BLUE}Starting...${NC}"
echo ""

eval "$ACT_CMD"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN} CI run completed successfully${NC}"
else
    echo -e "${RED} CI run failed with exit code $EXIT_CODE${NC}"
fi

exit $EXIT_CODE
