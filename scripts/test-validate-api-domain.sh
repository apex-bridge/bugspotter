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

# IMAGE_GIT_COMMIT precedence (#434). The baked value describes the code in the
# image; the runtime GIT_COMMIT is host configuration that has gone stale.
# Helper: run validate_git_commit with a given (baked, runtime) pair and
# assert the resulting GIT_COMMIT.
test_commit_precedence() {
    test_name="$1"
    baked="$2"
    runtime="$3"
    expected="$4"

    unset GIT_COMMIT IMAGE_GIT_COMMIT RAILWAY_GIT_COMMIT_SHA
    [ -n "$baked" ] && export IMAGE_GIT_COMMIT="$baked"
    [ -n "$runtime" ] && export GIT_COMMIT="$runtime"

    validate_git_commit > /dev/null 2>&1
    if [ "$GIT_COMMIT" = "$expected" ]; then
        echo "${GREEN}✓${NC} PASS: $test_name"
        PASSED=$((PASSED + 1))
    else
        echo "${RED}✗${NC} FAIL: $test_name (expected '$expected', got '$GIT_COMMIT')"
        FAILED=$((FAILED + 1))
    fi
    unset GIT_COMMIT IMAGE_GIT_COMMIT RAILWAY_GIT_COMMIT_SHA
}

# The bug itself: a stale host GIT_COMMIT must not win over the built image.
test_commit_precedence "Baked revision beats a stale runtime GIT_COMMIT" \
    "0c11a15" "cb02c35" "0c11a15"
test_commit_precedence "Baked revision used when no runtime GIT_COMMIT is set" \
    "0c11a15" "" "0c11a15"
# Back-compat: an image built without the build arg behaves exactly as before.
test_commit_precedence "Unbaked image still uses the runtime GIT_COMMIT" \
    "unknown" "cb02c35" "cb02c35"
test_commit_precedence "Absent IMAGE_GIT_COMMIT still uses the runtime GIT_COMMIT" \
    "" "cb02c35" "cb02c35"
test_commit_precedence "Unbaked image with nothing set falls back to unknown" \
    "unknown" "" "unknown"
# The baked value is injected into JavaScript like any other, so it goes
# through the same hex validation rather than being trusted for being baked.
test_commit_precedence "Malformed baked revision falls back to unknown, not injected" \
    "'; alert(1); //" "" "unknown"

# Railway's SHA must still win when the image bakes nothing.
unset GIT_COMMIT IMAGE_GIT_COMMIT
export IMAGE_GIT_COMMIT="unknown"
export RAILWAY_GIT_COMMIT_SHA="ABC1234567"
validate_git_commit > /dev/null 2>&1
if [ "$GIT_COMMIT" = "ABC1234567" ]; then
    echo "${GREEN}✓${NC} PASS: Railway fallback survives an unbaked image"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: Railway fallback broken by IMAGE_GIT_COMMIT"
    FAILED=$((FAILED + 1))
fi
unset GIT_COMMIT IMAGE_GIT_COMMIT RAILWAY_GIT_COMMIT_SHA

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
echo "${YELLOW}=== Testing validate_storage_domain() ===${NC}"

# validate_storage_domain() now cross-checks against S3_ENDPOINT. Clear it so
# an inherited value from the caller's shell cannot skew the cases below, which
# are about STORAGE_DOMAIN alone.
unset S3_ENDPOINT

# Valid STORAGE_DOMAIN hosts (bare host, no scheme; wildcard allowed)
test_valid "Wildcard host" "STORAGE_DOMAIN" "*.storage.yandexcloud.kz" "validate_storage_domain"
test_valid "Plain host" "STORAGE_DOMAIN" "s3.your-cloud.example" "validate_storage_domain"
test_valid "Host with port" "STORAGE_DOMAIN" "minio.internal:9000" "validate_storage_domain"

# An https:// scheme is preserved (not doubled into https://https://...)
export STORAGE_DOMAIN="https://s3.example.com"
validate_storage_domain > /dev/null 2>&1
if [ "$STORAGE_CSP" = " https://s3.example.com" ]; then
    echo "${GREEN}✓${NC} PASS: Leading https scheme is preserved, not doubled"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: Scheme handling produced '$STORAGE_CSP'"
    FAILED=$((FAILED + 1))
fi
unset STORAGE_DOMAIN STORAGE_CSP

# An operator-supplied http:// scheme must be PRESERVED, not forced to https —
# otherwise the admin CSP would block requests to an HTTP-only object store.
export STORAGE_DOMAIN="http://minio.internal:9000"
validate_storage_domain > /dev/null 2>&1
if [ "$STORAGE_CSP" = " http://minio.internal:9000" ]; then
    echo "${GREEN}✓${NC} PASS: http scheme is preserved (not rewritten to https)"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: http scheme should be preserved, got '$STORAGE_CSP'"
    FAILED=$((FAILED + 1))
fi
unset STORAGE_DOMAIN STORAGE_CSP

# A bare host (no scheme) still defaults to https
export STORAGE_DOMAIN="s3.your-cloud.example"
validate_storage_domain > /dev/null 2>&1
if [ "$STORAGE_CSP" = " https://s3.your-cloud.example" ]; then
    echo "${GREEN}✓${NC} PASS: bare host defaults to https"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: bare host should default to https, got '$STORAGE_CSP'"
    FAILED=$((FAILED + 1))
fi
unset STORAGE_DOMAIN STORAGE_CSP

# Adversarial: a newline must not let a well-formed line smuggle a second host
# past the per-line grep format check. BOTH lines here are individually valid
# hosts, so only the embedded newline distinguishes this value — without the
# control-character guard, grep -q would match line 1 and wrongly accept it.
export STORAGE_DOMAIN="$(printf 'good.com\nevil.com')"
(
    . ./scripts/shared/validate-api-domain.sh
    validate_storage_domain
) > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "${GREEN}✓${NC} PASS: Newline-injected value correctly blocked"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: Newline-injected value should be blocked"
    FAILED=$((FAILED + 1))
fi
unset STORAGE_DOMAIN STORAGE_CSP

# Invalid STORAGE_DOMAIN values (CSP injection attempts)
test_invalid "Space injection" "STORAGE_DOMAIN" "evil.com attacker.com" "validate_storage_domain"
test_invalid "Semicolon directive injection" "STORAGE_DOMAIN" "evil.com; script-src 'unsafe-inline'" "validate_storage_domain"
test_invalid "Single quote injection" "STORAGE_DOMAIN" "evil.com'" "validate_storage_domain"
test_invalid "Angle brackets" "STORAGE_DOMAIN" "evil.com<script>" "validate_storage_domain"
test_invalid "Parentheses injection" "STORAGE_DOMAIN" "evil.com()" "validate_storage_domain"
test_invalid "Path smuggling" "STORAGE_DOMAIN" "evil.com/path" "validate_storage_domain"

# Empty value: no storage source added to CSP
unset STORAGE_DOMAIN
validate_storage_domain > /dev/null 2>&1
if [ -z "$STORAGE_CSP" ]; then
    echo "${GREEN}✓${NC} PASS: Empty STORAGE_DOMAIN yields no CSP source"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: Empty STORAGE_DOMAIN should yield empty STORAGE_CSP"
    FAILED=$((FAILED + 1))
fi
unset STORAGE_CSP

echo ""
echo "${YELLOW}=== Testing storage CSP vs S3_ENDPOINT cross-check ===${NC}"

# Run the full validate_storage_domain() path in a subshell, since the guard
# exits rather than returning. Asserting through the public entry point also
# proves the cross-check is actually wired into it.
test_storage_pair() {
    local test_name="$1"
    local endpoint="$2"
    local domain="$3"
    local expect="$4"          # "pass" or "fail"
    # Default to the product's own default rather than to path-style, so a case
    # that omits these exercises what a real deployment does. "-" not ":-": an
    # explicitly passed empty path-style is itself a case under test.
    local path_style="${5-}" # unset => virtual-hosted, as the backend reads it
    local bucket="${6-}"

    (
        export S3_ENDPOINT="$endpoint"
        export STORAGE_DOMAIN="$domain"
        export S3_FORCE_PATH_STYLE="$path_style"
        export S3_BUCKET="$bucket"
        . ./scripts/shared/validate-api-domain.sh
        validate_storage_domain
    ) > /dev/null 2>&1
    local exit_code=$?

    if [ "$expect" = "pass" ] && [ $exit_code -eq 0 ]; then
        echo "${GREEN}✓${NC} PASS: $test_name"
        PASSED=$((PASSED + 1))
    elif [ "$expect" = "fail" ] && [ $exit_code -ne 0 ]; then
        echo "${GREEN}✓${NC} PASS: $test_name"
        PASSED=$((PASSED + 1))
    else
        echo "${RED}✗${NC} FAIL: $test_name (expected $expect, exit $exit_code)"
        FAILED=$((FAILED + 1))
    fi
}

# The production regression this guard exists for: storage moved to a public
# host, STORAGE_DOMAIN stayed empty, and the admin served connect-src 'self'.
test_storage_pair "Public endpoint with empty STORAGE_DOMAIN is rejected" \
    "https://storage.kz.bugspotter.io" "" "fail"
test_storage_pair "Public endpoint covered by exact host" \
    "https://storage.kz.bugspotter.io" "storage.kz.bugspotter.io" "pass"
test_storage_pair "Unrelated STORAGE_DOMAIN is rejected" \
    "https://storage.kz.bugspotter.io" "s3.other-cloud.example" "fail"

# Wildcards follow plain CSP semantics against the host the browser is sent to.
test_storage_pair "Wildcard covers a subdomain of its base" \
    "https://bucket.s3.example.com" "*.s3.example.com" "pass"
test_storage_pair "Wildcard does not cover an unrelated host" \
    "https://s3.evil.example" "*.s3.example.com" "fail"

# Which host that is depends on the addressing style. Path-style keeps the
# bucket in the path, so "*.X" does NOT cover an endpoint of X - accepting it
# would pass a deployment the browser still blocks.
test_storage_pair "Path-style: wildcard does not cover the endpoint host" \
    "https://s3.example.com" "*.s3.example.com" "fail" "true" "bucket"
test_storage_pair "Path-style: exact endpoint host is covered" \
    "https://s3.example.com" "s3.example.com" "pass" "true" "bucket"

# Virtual-hosted-style moves the bucket in front of the host, so the reverse
# holds: the wildcard is required and the bare endpoint host is not enough.
test_storage_pair "Virtual-hosted: wildcard covers <bucket>.<endpoint>" \
    "https://s3.example.com" "*.s3.example.com" "pass" "false" "bucket"
test_storage_pair "Virtual-hosted: bare endpoint host is not enough" \
    "https://s3.example.com" "s3.example.com" "fail" "false" "bucket"
test_storage_pair "Virtual-hosted: the bucket subdomain itself is covered" \
    "https://s3.example.com" "bucket.s3.example.com" "pass" "false" "bucket"

# Anything other than the literal "true" means virtual-hosted, matching
# parseBooleanEnv on the backend side.
test_storage_pair "Unset path-style is treated as virtual-hosted" \
    "https://s3.example.com" "*.s3.example.com" "pass" "" "bucket"

# Without a bucket the real host cannot be built, so a wildcard on the endpoint
# host is accepted rather than failing on a value the container never got.
test_storage_pair "Virtual-hosted with no bucket accepts the endpoint wildcard" \
    "https://s3.example.com" "*.s3.example.com" "pass" "false" ""

# CSP matches hosts case-insensitively and the URL parser lowercases the host
# before the CSP is consulted, so a mixed-case endpoint is the same deployment.
test_storage_pair "Mixed-case endpoint matches a lowercase STORAGE_DOMAIN" \
    "https://STORAGE.Example.COM" "storage.example.com" "pass"
test_storage_pair "Mixed-case STORAGE_DOMAIN matches a lowercase endpoint" \
    "https://storage.example.com" "STORAGE.example.com" "pass"

# A CSP source expression only ever matches the IP literal 127.0.0.1 (CSP3),
# so storage addressed by a public IP cannot be unblocked by any value here.
test_storage_pair "Public IPv4 endpoint is rejected" \
    "https://198.51.100.10" "198.51.100.10" "fail"
test_storage_pair "Public IPv4 endpoint with a port is rejected" \
    "https://198.51.100.10:9000" "198.51.100.10:9000" "fail"
test_storage_pair "Public IPv6 endpoint is rejected" \
    "https://[2001:db8::1]" "storage.example.com" "fail"
test_storage_pair "Loopback IP is still skipped, not rejected" \
    "http://127.0.0.1:9000" "" "pass"
# Loopback is 127.0.0.0/8, not one address.
test_storage_pair "Any 127.0.0.0/8 address is skipped" \
    "http://127.0.0.2:9000" "" "pass"
# A host that merely starts with "127." is a DNS name, not loopback.
test_storage_pair "A DNS name starting with 127. is not treated as loopback" \
    "https://127.storage.example.com" "" "fail"

# The wildcard match is anchored on a label boundary: "*.s3.example.com" must
# not swallow "buckets3.example.com".
test_storage_pair "Wildcard does not match across a label boundary" \
    "https://buckets3.example.com" "*.s3.example.com" "fail"

# A CSP host-source with a scheme matches only that scheme, and a bare
# STORAGE_DOMAIN means https - so an HTTP-only store must say so.
test_storage_pair "Scheme mismatch is rejected" \
    "http://storage.example.com" "storage.example.com" "fail"
test_storage_pair "Matching http scheme is accepted" \
    "http://storage.example.com" "http://storage.example.com" "pass"

# Ports: the default port is implicit in a CSP host-source, a custom one is not.
test_storage_pair "Explicit default port matches an omitted one" \
    "https://storage.example.com:443" "storage.example.com" "pass"
test_storage_pair "Custom port must be declared" \
    "https://storage.example.com:9000" "storage.example.com" "fail"
test_storage_pair "Custom port declared on both sides" \
    "https://storage.example.com:9000" "storage.example.com:9000" "pass"

# A path on the endpoint is not part of the CSP host-source.
test_storage_pair "Endpoint path is ignored" \
    "https://storage.example.com/bucket" "storage.example.com" "pass"

# Userinfo is not part of a CSP host-source either, so an endpoint carrying one
# must still be recognised as covered rather than failing the deploy.
test_storage_pair "Endpoint userinfo is ignored" \
    "https://key:secret@storage.example.com" "storage.example.com" "pass"
test_storage_pair "Endpoint userinfo does not mask a real mismatch" \
    "https://key:secret@storage.example.com" "s3.other-cloud.example" "fail"

# ... and the diagnostics printed on that mismatch must not echo the secret:
# the entrypoint's output is readable to anyone with `docker logs`.
storage_leak_output=$(
    export S3_ENDPOINT="https://key:sup3rs3cret@storage.example.com"
    export STORAGE_DOMAIN="s3.other-cloud.example"
    . ./scripts/shared/validate-api-domain.sh
    # Inside the substitution, or the guard's stderr escapes to the terminal
    # and this assertion passes against empty output.
    validate_storage_domain 2>&1
)
case "$storage_leak_output" in
    *sup3rs3cret*)
        echo "${RED}✗${NC} FAIL: endpoint credentials leaked into the error output"
        FAILED=$((FAILED + 1))
        ;;
    *)
        echo "${GREEN}✓${NC} PASS: endpoint credentials are not echoed on mismatch"
        PASSED=$((PASSED + 1))
        ;;
esac
unset storage_leak_output

# Dev stacks must not be caught by this: a compose service name or loopback is
# unreachable from the browser whatever the CSP says.
test_storage_pair "Compose service endpoint is skipped" \
    "http://minio:9000" "" "pass"
test_storage_pair "localhost endpoint is skipped" \
    "http://localhost:9000" "" "pass"
test_storage_pair "127.0.0.1 endpoint is skipped" \
    "http://127.0.0.1:9000" "" "pass"

# Unset S3_ENDPOINT keeps the pre-existing behaviour exactly (local disk
# storage, or an admin container not given the endpoint).
(
    unset S3_ENDPOINT STORAGE_DOMAIN
    . ./scripts/shared/validate-api-domain.sh
    validate_storage_domain
) > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "${GREEN}✓${NC} PASS: No S3_ENDPOINT leaves the empty case untouched"
    PASSED=$((PASSED + 1))
else
    echo "${RED}✗${NC} FAIL: No S3_ENDPOINT should not fail validation"
    FAILED=$((FAILED + 1))
fi

unset S3_ENDPOINT STORAGE_DOMAIN STORAGE_CSP

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
