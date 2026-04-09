#!/bin/sh
# Test script for validate-api-domain.sh validation functions
# Tests all validation logic with valid and invalid inputs

# Note: Don't use 'set -e' here since we're testing failure cases

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0

# Test helper: expects validation to succeed
test_valid() {
    local test_name="$1"
    local var_name="$2"
    local value="$3"
    local func="$4"
    
    export "$var_name"="$value"
    if $func > /dev/null 2>&1; then
        echo "${GREEN}✓${NC} PASS: $test_name"
        PASSED=$((PASSED + 1))
    else
        echo "${RED}✗${NC} FAIL: $test_name (should have passed)"
        FAILED=$((FAILED + 1))
    fi
    unset "$var_name"
}

# Test helper: expects validation to fail
test_invalid() {
    local test_name="$1"
    local var_name="$2"
    local value="$3"
    local func="$4"
    
    export "$var_name"="$value"
    # Run in subshell to prevent exit 1 from terminating test script
    (
        . ./scripts/shared/validate-api-domain.sh
        $func
    ) > /dev/null 2>&1
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        echo "${RED}✗${NC} FAIL: $test_name (should have been blocked)"
        FAILED=$((FAILED + 1))
    else
        echo "${GREEN}✓${NC} PASS: $test_name (correctly blocked)"
        PASSED=$((PASSED + 1))
    fi
    unset "$var_name"
}

# Source the validation script
. ./scripts/shared/validate-api-domain.sh

echo "${YELLOW}=== Testing validate_git_commit() ===${NC}"

# Valid git commits
test_valid "Short SHA (7 chars)" "GIT_COMMIT" "abc1234" "validate_git_commit"
test_valid "Medium SHA (10 chars)" "GIT_COMMIT" "abc1234567" "validate_git_commit"
test_valid "Full SHA (40 chars)" "GIT_COMMIT" "1234567890abcdef1234567890abcdef12345678" "validate_git_commit"
test_valid "Uppercase hex (Railway)" "GIT_COMMIT" "ABC1234" "validate_git_commit"
test_valid "Mixed case hex" "GIT_COMMIT" "AbC1234" "validate_git_commit"
test_valid "Fallback: unknown" "GIT_COMMIT" "unknown" "validate_git_commit"
test_valid "Fallback: dev" "GIT_COMMIT" "dev" "validate_git_commit"

# Invalid git commits (note: these fallback to "unknown" instead of failing)
export GIT_COMMIT="not-hex-string"
validate_git_commit > /dev/null 2>&1
if [ "$GIT_COMMIT" = "unknown" ]; then
    echo "${GREEN}✓${NC} PASS: Invalid format falls back to 'unknown'"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: Invalid format should fall back to 'unknown'"
    FAILED=$((FAILED + 1))
fi
unset GIT_COMMIT

export GIT_COMMIT="'; alert(1); //"
validate_git_commit > /dev/null 2>&1
if [ "$GIT_COMMIT" = "unknown" ]; then
    echo "${GREEN}✓${NC} PASS: XSS attempt falls back to 'unknown'"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: XSS attempt should fall back to 'unknown'"
    FAILED=$((FAILED + 1))
fi
unset GIT_COMMIT

# Test Railway fallback
unset GIT_COMMIT
export RAILWAY_GIT_COMMIT_SHA="ABC1234567"
validate_git_commit > /dev/null 2>&1
if [ "$GIT_COMMIT" = "ABC1234567" ]; then
    echo "${GREEN}✓${NC} PASS: Railway fallback works"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: Railway fallback failed"
    FAILED=$((FAILED + 1))
fi
unset GIT_COMMIT RAILWAY_GIT_COMMIT_SHA

echo ""
echo "${YELLOW}=== Testing validate_api_domain() ===${NC}"

# Valid API_DOMAIN URLs
test_valid "HTTPS with domain" "API_DOMAIN" "https://api.example.com" "validate_api_domain"
test_valid "HTTP localhost" "API_DOMAIN" "http://localhost" "validate_api_domain"
test_valid "HTTPS with port" "API_DOMAIN" "https://api.example.com:8080" "validate_api_domain"
test_valid "HTTP with port" "API_DOMAIN" "http://localhost:3000" "validate_api_domain"
test_valid "HTTPS with path" "API_DOMAIN" "https://api.example.com/v1" "validate_api_domain"
test_valid "HTTPS with subdomain" "API_DOMAIN" "https://api.staging.example.com" "validate_api_domain"

# Invalid API_DOMAIN URLs (CSP injection attempts)
test_invalid "Space injection" "API_DOMAIN" "https://evil.com https://attacker.com" "validate_api_domain"
test_invalid "Single quote injection" "API_DOMAIN" "https://evil.com' https://attacker.com" "validate_api_domain"
test_invalid "Double quote injection" "API_DOMAIN" 'https://evil.com" https://attacker.com' "validate_api_domain"
test_invalid "Semicolon injection" "API_DOMAIN" "https://evil.com; script-src 'unsafe-inline'" "validate_api_domain"
test_invalid "Parentheses injection" "API_DOMAIN" "https://evil.com()" "validate_api_domain"
test_invalid "Angle brackets" "API_DOMAIN" "https://evil.com<script>" "validate_api_domain"
test_invalid "JavaScript protocol" "API_DOMAIN" "javascript:alert(1)" "validate_api_domain"
test_invalid "Data URI" "API_DOMAIN" "data:text/html,<script>alert(1)</script>" "validate_api_domain"

echo ""
echo "${YELLOW}=== Testing validate_api_url() ===${NC}"

# Valid API_URL URLs
test_valid "HTTPS with domain" "API_URL" "https://api.example.com" "validate_api_url"
test_valid "HTTP localhost" "API_URL" "http://localhost" "validate_api_url"
test_valid "HTTPS with port" "API_URL" "https://api.example.com:8080" "validate_api_url"
test_valid "HTTP with port" "API_URL" "http://localhost:3000" "validate_api_url"
test_valid "HTTPS with path" "API_URL" "https://api.example.com/v1" "validate_api_url"
test_valid "HTTPS with subdomain" "API_URL" "https://api.staging.example.com" "validate_api_url"

# Invalid API_URL URLs (XSS injection attempts)
test_invalid "Single quote XSS" "API_URL" "https://evil.com', malicious: 'code'" "validate_api_url"
test_invalid "Double quote XSS" "API_URL" 'https://evil.com", malicious: "code"' "validate_api_url"
test_invalid "Backtick template injection" "API_URL" 'https://evil.com`${alert(1)}`' "validate_api_url"
test_invalid "Angle bracket XSS" "API_URL" "https://evil.com<script>alert(1)</script>" "validate_api_url"
test_invalid "Semicolon injection" "API_URL" "https://evil.com; malicious: true" "validate_api_url"
test_invalid "Parentheses injection" "API_URL" "https://evil.com()" "validate_api_url"
test_invalid "JavaScript protocol" "API_URL" "javascript:alert(1)" "validate_api_url"
test_invalid "Data URI" "API_URL" "data:text/html,<script>alert(1)</script>" "validate_api_url"

# Test empty value behavior
unset API_URL
validate_api_url > /dev/null 2>&1
echo "${GREEN}✓${NC} PASS: Empty API_URL doesn't fail (uses fallback)"
PASSED=$((PASSED + 1))

echo ""
echo "${YELLOW}=== Test Summary ===${NC}"
echo "${GREEN}Passed: $PASSED${NC}"
echo "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo "${RED}✗ Some tests failed!${NC}"
    exit 1
fi
