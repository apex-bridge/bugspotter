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

# Validate STORAGE_DOMAIN and build the CSP fragment for object storage.
# Security: STORAGE_CSP is interpolated into the admin Content-Security-Policy
# header, so an unvalidated value could inject additional CSP directives
# (e.g. "evil.com; script-src 'unsafe-inline'"). Mirror the API_DOMAIN checks.
validate_storage_domain() {
    if [ -n "$STORAGE_DOMAIN" ]; then
        # Reject control characters (newline, CR, tab, ...) up-front. The format
        # check below uses grep, which matches per-line, so a multi-line value
        # such as $'good.com\nevil.com' could otherwise sneak a second line past
        # the anchored ^...$ match (grep -q succeeds if ANY single line matches).
        # Strip all C0 control chars + DEL and compare: an octal tr range is
        # portable across busybox/dash sh, whereas a [[:cntrl:]] case glob is not.
        if [ "$STORAGE_DOMAIN" != "$(printf '%s' "$STORAGE_DOMAIN" | tr -d '\000-\037\177')" ]; then
            echo "ERROR: STORAGE_DOMAIN contains control characters" >&2
            echo "Newlines, tabs, and other control characters are not allowed (CSP injection risk)" >&2
            exit 1
        fi

        # Preserve an operator-supplied scheme so an HTTP-only object store is not
        # rewritten to https (the browser would then block the mismatched request).
        # The documented bare-host form (no scheme) defaults to https.
        case "$STORAGE_DOMAIN" in
            https://*) _storage_scheme="https://"; _storage_host="${STORAGE_DOMAIN#https://}" ;;
            http://*)  _storage_scheme="http://";  _storage_host="${STORAGE_DOMAIN#http://}" ;;
            *)         _storage_scheme="https://"; _storage_host="$STORAGE_DOMAIN" ;;
        esac

        # Critical security check: reject CSP-breaking characters. Spaces add extra
        # sources; semicolons/quotes/parens/angle brackets inject new directives;
        # slashes would smuggle a scheme or path into a host-source token.
        case "$_storage_host" in
            *\ *|*\'*|*\"*|*\;*|*\(*|*\)*|*\<*|*\>*|*/*)
                echo "ERROR: STORAGE_DOMAIN contains invalid characters: $STORAGE_DOMAIN" >&2
                echo "Set a bare host (optionally with http(s):// scheme) and no path, e.g. *.storage.yandexcloud.kz" >&2
                echo "Whitespace, quotes, semicolons, parentheses, angle brackets, and slashes are not allowed (CSP injection risk)" >&2
                exit 1
                ;;
        esac

        # Format check: optional "*." wildcard, dotted host labels, optional port.
        if ! echo "$_storage_host" | grep -qE '^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(:[0-9]+)?$'; then
            echo "ERROR: Invalid STORAGE_DOMAIN format: $STORAGE_DOMAIN" >&2
            echo "Example: *.storage.yandexcloud.kz or s3.your-cloud.example" >&2
            exit 1
        fi

        export STORAGE_CSP=" ${_storage_scheme}${_storage_host}"
        echo "STORAGE_DOMAIN validated: ${_storage_scheme}${_storage_host}"
    else
        export STORAGE_CSP=""
        echo "STORAGE_DOMAIN not set - only same-origin storage allowed in CSP"
    fi

    validate_storage_csp_covers_endpoint
}

# Split "http(s)://[userinfo@]host[:port][/path]" into _origin_scheme +
# _origin_host, dropping a default port so https://x and https://x:443 compare
# equal. A bare host defaults to https, matching how STORAGE_DOMAIN is
# documented.
_split_origin() {
    case "$1" in
        https://*) _origin_scheme="https://"; _origin_host="${1#https://}" ;;
        http://*)  _origin_scheme="http://";  _origin_host="${1#http://}" ;;
        *)         _origin_scheme="https://"; _origin_host="$1" ;;
    esac

    _origin_host="${_origin_host%%/*}"

    # Drop userinfo. A CSP host-source never carries one, so keeping it would
    # fail an otherwise-correct endpoint, and it is the one part of an
    # S3_ENDPOINT that can hold a secret - these values are echoed into the
    # container log on mismatch. Strip through the LAST "@": a host cannot
    # contain one, so greedy is right even for an unencoded password.
    _origin_host="${_origin_host##*@}"

    if [ "$_origin_scheme" = "https://" ]; then
        _origin_host="${_origin_host%:443}"
    else
        _origin_host="${_origin_host%:80}"
    fi

    # CSP matches hosts ASCII case-insensitively, and the URL parser lowercases
    # a URL's host before the CSP is consulted, so "STORAGE.example.com" and
    # "storage.example.com" are one host. Shell comparison is case-sensitive;
    # without this a working deployment fails the check below.
    _origin_host=$(printf '%s' "$_origin_host" | tr 'A-Z' 'a-z')
}

# Cross-check the storage CSP against the endpoint the browser is actually sent
# to, and refuse to start when it is not covered.
#
# The admin never proxies object storage: it asks the API for a presigned URL
# and the browser talks to the store directly, so the CSP must name that host
# in img-src (screenshots) and connect-src (the replay fetch). That makes
# STORAGE_DOMAIN and S3_ENDPOINT two settings for one fact, and a host
# migration moves only S3_ENDPOINT. Production drifted exactly that way: the
# admin served "connect-src 'self'" against storage.kz.bugspotter.io, so the
# replay player showed a bare "Failed to fetch" and screenshots rendered blank
# while every health check stayed green. A CSP-blocked fetch rejects with an
# opaque TypeError, so nothing in the logs points at the CSP - hence failing
# here, at deploy time, where the operator is still watching.
#
# Only public endpoints are checked. A compose service name or a loopback
# address is unreachable from the browser whatever the CSP says (that is the
# separate failure docker-compose.storage.yml documents), so dev stacks running
# S3_ENDPOINT=http://minio:9000 are left alone.
validate_storage_csp_covers_endpoint() {
    [ -n "$S3_ENDPOINT" ] || return 0

    _split_origin "$S3_ENDPOINT"
    _endpoint_scheme="$_origin_scheme"
    _endpoint_host="$_origin_host"

    case "$_endpoint_host" in
        localhost|localhost:*|127.0.0.1|127.0.0.1:*|\[::1\]|\[::1\]:*) return 0 ;;
        # An IPv6 literal is bracketed and carries no dot, so it has to be
        # matched before the dotted-host test or it reads as a bare service name
        # and is skipped instead of rejected below.
        \[*\]|\[*\]:*) ;;
        *.*) ;;
        *) return 0 ;;
    esac

    # CSP cannot express a public IP literal. The grammar accepts one, but
    # matching is defined so that "only 127.0.0.1 will actually match a URL when
    # used in a source expression" (CSP3, host-part matching) - so no
    # STORAGE_DOMAIN value can unblock storage addressed by IP, and accepting
    # one here would pass a deployment the browser still breaks. Loopback is
    # already returned above.
    if _is_ip_literal "$_endpoint_host"; then
        echo "ERROR: S3_ENDPOINT addresses storage by IP (${_endpoint_scheme}${_endpoint_host})" >&2
        echo "A CSP source expression only ever matches the IP literal 127.0.0.1, so no" >&2
        echo "STORAGE_DOMAIN can allow this host and screenshots and replay stay blocked." >&2
        echo "Give the object store a DNS hostname and point S3_ENDPOINT at that." >&2
        exit 1
    fi

    # Which host the browser is actually sent to depends on the addressing
    # style, so the CSP has to be checked against that host, not the endpoint.
    # Path-style keeps the bucket in the path and leaves the host alone;
    # virtual-hosted-style moves the bucket in front of it. Mirrors the
    # backend's parsing: only the literal "true" enables path style
    # (parseBooleanEnv in packages/backend/src/config/validators.ts), and
    # forcePathStyle defaults to false.
    _request_host="$_endpoint_host"
    _wildcard_covers_base="no"
    if [ "$S3_FORCE_PATH_STYLE" != "true" ]; then
        if [ -n "$S3_BUCKET" ]; then
            _request_host="${S3_BUCKET}.${_endpoint_host}"
        else
            # Virtual-hosted, but the bucket was not passed in, so the real host
            # cannot be built. Accept a wildcard on the endpoint host, which is
            # what would cover <bucket>.<endpoint>, rather than fail a
            # deployment on a value this container was never given.
            _wildcard_covers_base="yes"
        fi
    fi

    if [ -z "$STORAGE_DOMAIN" ]; then
        echo "ERROR: S3_ENDPOINT is ${_endpoint_scheme}${_endpoint_host} but STORAGE_DOMAIN is empty" >&2
        echo "The admin CSP would allow same-origin storage only: session replay fails with a bare" >&2
        echo "'Failed to fetch' and screenshots render blank, with nothing failing server-side." >&2
        echo "Set STORAGE_DOMAIN=${_request_host} (or the wildcard covering it, e.g. *.${_request_host#*.})." >&2
        echo "Storage served from the admin's own origin is the one case to set it to that host too." >&2
        exit 1
    fi

    _split_origin "$STORAGE_DOMAIN"
    _csp_scheme="$_origin_scheme"
    _csp_host="$_origin_host"

    # A CSP host-source carrying a scheme only matches that scheme, so an
    # http:// source against an https:// endpoint blocks every request.
    if [ "$_csp_scheme" != "$_endpoint_scheme" ]; then
        echo "ERROR: STORAGE_DOMAIN scheme ($_csp_scheme) does not match S3_ENDPOINT ($_endpoint_scheme)" >&2
        # Report the parsed origin, never the raw endpoint: userinfo is stripped
        # by then, and the log is readable to anyone with `docker logs`.
        echo "endpoint=${_endpoint_scheme}${_endpoint_host}, STORAGE_DOMAIN=$STORAGE_DOMAIN" >&2
        echo "A CSP host-source with a scheme matches only that scheme, so the admin would block" >&2
        echo "every screenshot and replay request. Set STORAGE_DOMAIN=${_endpoint_scheme}${_csp_host}." >&2
        exit 1
    fi

    case "$_request_host" in
        "$_csp_host") return 0 ;;
    esac

    # Plain CSP wildcard semantics: "*.X" covers a subdomain of X, not X itself.
    # The one exception is the unknown-bucket case above, where "*.X" is the
    # correct value for a host this container cannot construct.
    case "$_csp_host" in
        \*.*)
            _csp_base="${_csp_host#\*.}"
            case "$_request_host" in
                *".$_csp_base") return 0 ;;
            esac
            if [ "$_wildcard_covers_base" = "yes" ] && [ "$_request_host" = "$_csp_base" ]; then
                return 0
            fi
            ;;
    esac

    echo "ERROR: STORAGE_DOMAIN does not cover the host presigned URLs point at" >&2
    echo "endpoint=${_endpoint_scheme}${_endpoint_host}, request host=${_request_host}, STORAGE_DOMAIN=$STORAGE_DOMAIN" >&2
    if [ "$_request_host" != "$_endpoint_host" ]; then
        echo "S3_FORCE_PATH_STYLE is not true, so the bucket is addressed as a subdomain." >&2
    fi
    echo "The admin CSP would block screenshots (img-src) and the replay fetch (connect-src)," >&2
    echo "which surfaces in the browser as 'Failed to fetch' and nowhere else." >&2
    echo "Set STORAGE_DOMAIN=${_request_host} or a wildcard that covers it." >&2
    exit 1
}

# True when the host (with any port or IPv6 brackets) is an IP literal rather
# than a DNS name. IPv4 only needs the dotted-quad shape; anything in brackets
# is an IPv6 literal by URL syntax.
_is_ip_literal() {
    case "$1" in
        \[*\]|\[*\]:*) return 0 ;;
    esac

    printf '%s' "${1%%:*}" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
}
