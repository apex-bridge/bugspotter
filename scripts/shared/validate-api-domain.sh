#!/bin/sh
# Shared validation logic for environment variables
# Used by both standalone admin and unified Docker deployments

# Validate GIT_COMMIT to prevent XSS injection
# Security: Ensure GIT_COMMIT only contains safe characters before embedding in JavaScript
validate_git_commit() {
    # Use Railway's built-in commit SHA if GIT_COMMIT not explicitly set
    if [ -z "$GIT_COMMIT" ] && [ -n "$RAILWAY_GIT_COMMIT_SHA" ]; then
        export GIT_COMMIT="$RAILWAY_GIT_COMMIT_SHA"
        echo "Using RAILWAY_GIT_COMMIT_SHA: $GIT_COMMIT"
    fi

    if [ -n "$GIT_COMMIT" ]; then
        # Git commit hashes are hex: 7-40 chars (short or full SHA)
        # Also allow fallback values: "unknown", "dev"
        # Note: Railway provides uppercase hex in RAILWAY_GIT_COMMIT_SHA
        if ! echo "$GIT_COMMIT" | grep -qiE '^[0-9a-f]{7,40}$|^(unknown|dev)$'; then
            echo "ERROR: Invalid GIT_COMMIT format: $GIT_COMMIT" >&2
            echo "GIT_COMMIT must be a 7-40 character hex string, 'unknown', or 'dev'" >&2
            echo "Example: abc1234, 44ab08a (7 chars), or full 40-char SHA" >&2
            # Return sanitized fallback instead of failing deployment
            export GIT_COMMIT="unknown"
            echo "WARNING: Using fallback value 'unknown' for invalid GIT_COMMIT" >&2
            return 0
        fi
        echo "GIT_COMMIT validated: $GIT_COMMIT"
    else
        export GIT_COMMIT="unknown"
        echo "GIT_COMMIT not set - using 'unknown'"
    fi
}

# Validate and prepare API_DOMAIN for CSP formatting
# Security: Validate API_DOMAIN to prevent CSP injection attacks
validate_api_domain() {
    if [ -n "$API_DOMAIN" ]; then
        # Validate URL format: must be https:// or http:// followed by valid domain
        # Allow: https://a.com, http://localhost, https://api.example.com:8080
        # Block: javascript:, data:, spaces, quotes, semicolons (CSP injection vectors)
        if ! echo "$API_DOMAIN" | grep -qE '^https?://[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(:[0-9]+)?(/[^[:space:]]*)?$'; then
            echo "ERROR: Invalid API_DOMAIN format: $API_DOMAIN" >&2
            echo "API_DOMAIN must be a valid HTTP(S) URL without special characters" >&2
            echo "Example: https://api.example.com or http://localhost:3000" >&2
            exit 1
        fi
        
        # Critical security check: reject URLs with whitespace or CSP-breaking characters
        # Spaces allow CSP injection: "https://evil.com https://attacker.com" would add both domains
        # Quotes/semicolons allow directive injection: "https://evil.com; script-src 'unsafe-inline'"
        # Use case statement for reliable character matching (no regex escaping issues)
        case "$API_DOMAIN" in
            *\ *|*\'*|*\"*|*\;*|*\(*|*\)*|*\<*|*\>*)
                echo "ERROR: API_DOMAIN contains invalid characters: $API_DOMAIN" >&2
                echo "Whitespace, quotes, semicolons, parentheses, and angle brackets are not allowed (CSP injection risk)" >&2
                exit 1
                ;;
        esac
        
        export API_DOMAIN_CSP=" $API_DOMAIN"
        echo "API_DOMAIN validated: $API_DOMAIN"
    else
        export API_DOMAIN_CSP=""
        echo "API_DOMAIN not set - using same-domain configuration"
    fi
}

# Validate API_URL to prevent JavaScript injection
# Security: Ensure API_URL only contains safe characters before embedding in JavaScript
validate_api_url() {
    if [ -n "$API_URL" ]; then
        # Validate URL format: must be https:// or http:// followed by valid domain
        # Allow: https://a.com, http://localhost, https://api.example.com:8080
        # Block: javascript:, data:, quotes, backticks (XSS injection vectors)
        if ! echo "$API_URL" | grep -qE '^https?://[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(:[0-9]+)?(/[^[:space:]]*)?$'; then
            echo "ERROR: Invalid API_URL format: $API_URL" >&2
            echo "API_URL must be a valid HTTP(S) URL without special characters" >&2
            echo "Example: https://api.example.com or http://localhost:3000" >&2
            exit 1
        fi
        
        # Critical security check: reject URLs with quotes, backticks, or other XSS vectors
        # Single quotes allow breaking out of JavaScript string: apiUrl: 'https://evil.com', malicious: 'code'
        # Backticks allow template injection: apiUrl: `${maliciousCode()}`
        # Use case statement for reliable character matching (no regex escaping issues)
        case "$API_URL" in
            *\'*|*\"*|*\`*|*\<*|*\>*|*\;*|*\(*|*\)*)
                echo "ERROR: API_URL contains invalid characters: $API_URL" >&2
                echo "Quotes, backticks, angle brackets, semicolons, and parentheses are not allowed (XSS injection risk)" >&2
                exit 1
                ;;
        esac
        
        echo "API_URL validated: $API_URL"
    else
        echo "API_URL not set - will use VITE_API_URL fallback in browser"
    fi
}
