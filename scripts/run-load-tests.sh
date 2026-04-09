#!/bin/bash
#
# BugSpotter Load & Resilience Test Runner
#
# Usage:
#   ./scripts/run-load-tests.sh [test-type]
#
# Test types:
#   vitest-load      - Run Vitest load tests (default)
#   vitest-resilience - Run Vitest resilience tests
#   k6-load          - Run k6 load test
#   k6-stress        - Run k6 stress test
#   k6-spike         - Run k6 spike test
#   k6-soak          - Run k6 soak test (2 hours)
#   all              - Run all Vitest tests
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}     BugSpotter Load & Resilience Tests         ${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Function to check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    # Check if pnpm is available
    if ! command -v pnpm &> /dev/null; then
        echo -e "${RED}Error: pnpm is not installed${NC}"
        exit 1
    fi

    # Check if API is running for k6 tests
    if [[ "$1" == k6-* ]]; then
        if ! curl -s "$BASE_URL/health" > /dev/null 2>&1; then
            echo -e "${RED}Error: API not running at $BASE_URL${NC}"
            echo "Start the API with: docker-compose up -d"
            exit 1
        fi
        echo -e "${GREEN}API is running at $BASE_URL${NC}"

        # Check if k6 is available
        if ! command -v k6 &> /dev/null; then
            echo -e "${YELLOW}Warning: k6 is not installed${NC}"
            echo "Install k6: https://k6.io/docs/getting-started/installation/"
            echo "Or run via Docker: docker run -i grafana/k6 run - <script.js"
            exit 1
        fi
    fi

    echo -e "${GREEN}Prerequisites OK${NC}"
    echo ""
}

# Function to run Vitest load tests
run_vitest_load() {
    echo -e "${BLUE}Running Vitest Load Tests...${NC}"
    cd "$PROJECT_ROOT"
    pnpm --filter @bugspotter/backend test:load
}

# Function to run Vitest resilience tests
run_vitest_resilience() {
    echo -e "${BLUE}Running Vitest Resilience Tests...${NC}"
    cd "$PROJECT_ROOT"
    pnpm --filter @bugspotter/backend vitest run --config packages/backend/vitest.resilience.config.ts
}

# Function to run k6 tests
run_k6_test() {
    local test_name=$1
    local test_file="$PROJECT_ROOT/packages/backend/tests/k6/${test_name}.js"

    if [ ! -f "$test_file" ]; then
        echo -e "${RED}Error: Test file not found: $test_file${NC}"
        exit 1
    fi

    echo -e "${BLUE}Running k6 $test_name test...${NC}"
    echo "Base URL: $BASE_URL"
    echo ""

    k6 run \
        -e BASE_URL="$BASE_URL" \
        -e API_KEY="$API_KEY" \
        "$test_file"
}

# Main logic
TEST_TYPE="${1:-vitest-load}"

check_prerequisites "$TEST_TYPE"

case "$TEST_TYPE" in
    vitest-load)
        run_vitest_load
        ;;
    vitest-resilience)
        run_vitest_resilience
        ;;
    k6-load)
        run_k6_test "load-test"
        ;;
    k6-stress)
        run_k6_test "stress-test"
        ;;
    k6-spike)
        run_k6_test "spike-test"
        ;;
    k6-soak)
        echo -e "${YELLOW}Warning: Soak test runs for 2+ hours${NC}"
        read -p "Continue? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            run_k6_test "soak-test"
        fi
        ;;
    all)
        run_vitest_load
        run_vitest_resilience
        ;;
    *)
        echo -e "${RED}Unknown test type: $TEST_TYPE${NC}"
        echo ""
        echo "Available test types:"
        echo "  vitest-load       - Run Vitest load tests"
        echo "  vitest-resilience - Run Vitest resilience tests"
        echo "  k6-load          - Run k6 load test"
        echo "  k6-stress        - Run k6 stress test"
        echo "  k6-spike         - Run k6 spike test"
        echo "  k6-soak          - Run k6 soak test (2 hours)"
        echo "  all              - Run all Vitest tests"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}     Tests completed successfully!              ${NC}"
echo -e "${GREEN}================================================${NC}"
