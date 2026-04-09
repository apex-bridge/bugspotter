#!/bin/bash

# Backblaze B2 CDN Setup Script
# This script helps you set up Backblaze B2 for SDK CDN hosting

set -e

echo " Backblaze B2 CDN Setup for BugSpotter SDK"
echo "=============================================="
echo ""

# Check if b2 CLI is installed
if ! command -v b2 &> /dev/null; then
    echo " Installing Backblaze B2 CLI..."
    python3 -m pip install --upgrade b2
    echo " B2 CLI installed"
else
    echo " B2 CLI already installed"
fi

echo ""
echo " Please provide your Backblaze B2 credentials:"
echo "   (You can find these at: https://secure.backblaze.com/app_keys.htm)"
echo ""

read -p "B2 Application Key ID: " B2_KEY_ID
read -sp "B2 Application Key: " B2_KEY
echo ""
echo ""

# Authorize account
echo " Authorizing B2 account..."
b2 authorize-account "$B2_KEY_ID" "$B2_KEY"

# Get or create bucket
echo ""
read -p "Enter bucket name (e.g., cdn-bugspotter): " BUCKET_NAME

if b2 list-buckets | grep -q "$BUCKET_NAME"; then
    echo " Bucket '$BUCKET_NAME' already exists"
else
    echo " Creating bucket '$BUCKET_NAME'..."
    b2 create-bucket "$BUCKET_NAME" allPublic
    echo " Bucket created"
fi

# Get bucket info
echo ""
echo " Bucket Information:"
b2 list-buckets | grep "$BUCKET_NAME"

# Upload test file
echo ""
echo " Testing upload..."
echo "test" > /tmp/b2-test.txt
b2 upload-file --contentType "text/plain" "$BUCKET_NAME" /tmp/b2-test.txt test/test.txt
rm /tmp/b2-test.txt
echo " Test upload successful"

# Get download URL
echo ""
echo " Getting download URL..."
DOWNLOAD_URL=$(b2 get-download-url-with-auth "$BUCKET_NAME" test/test.txt)
echo " Test file URL: $DOWNLOAD_URL"

# Detect B2 region endpoint
echo ""
echo " Detecting B2 region endpoint..."
B2_INFO=$(b2 get-account-info 2>/dev/null || echo "")
if [[ "$B2_INFO" =~ s3\.([a-z0-9-]+)\.backblazeb2\.com ]]; then
    B2_REGION="${BASH_REMATCH[1]}"
    B2_ENDPOINT="https://${B2_REGION}.backblazeb2.com"
    echo " Detected endpoint: $B2_ENDPOINT"
else
    echo "  Could not auto-detect region, using default"
    B2_ENDPOINT="https://f003.backblazeb2.com"
fi

echo ""
echo " Your CDN URLs:"
echo "   B2 Origin format: ${B2_ENDPOINT}/file/$BUCKET_NAME/path/to/file"
echo "   Example SDK URL:  ${B2_ENDPOINT}/file/$BUCKET_NAME/sdk/bugspotter-0.1.0.min.js"

# GitHub Secrets instructions
echo ""
echo " GitHub Secrets Configuration"
echo "================================"
echo ""
echo "Add these 7 secrets to your GitHub repository:"
echo "  Settings  Secrets and variables  Actions  New repository secret"
echo ""
echo "Secret 1:"
echo "  Name:  B2_APPLICATION_KEY_ID"
echo "  Value: $B2_KEY_ID"
echo ""
echo "Secret 2:"
echo "  Name:  B2_APPLICATION_KEY"
echo "  Value: [Your application key - not shown for security]"
echo ""
echo "Secret 3:"
echo "  Name:  B2_BUCKET_NAME"
echo "  Value: $BUCKET_NAME"
# Custom domain setup
echo ""
echo " Custom Domain Setup with BunnyCDN (Recommended)"
echo "=================================================="
echo ""
echo "BunnyCDN provides better performance and caching than direct B2 access:"
echo ""
echo "1. Sign up at https://bunny.net"
echo ""
echo "2. Create a Pull Zone:"
echo "   - Origin URL: ${B2_ENDPOINT}/file/$BUCKET_NAME"
echo "   - Enable: CDN caching, compression"
echo ""
echo "3. Add custom hostname (optional):"
echo "   - Add CNAME: cdn.yourdomain.com  pullzone.b-cdn.net"
echo "   - Enable SSL certificate"
echo ""
echo "4. Get your Pull Zone ID and API Key from BunnyCDN dashboard"
echo ""
echo "5. Add to GitHub Secrets (see above)"
echo "  Value: [Your BunnyCDN pull zone ID - if using BunnyCDN]"
echo ""

# Cost estimate
echo ""
echo " Cost Estimate"
echo "================"
echo ""
echo "Based on typical SDK usage:"
echo "  Storage: ~1 MB per version  10 versions = 10 MB"
echo "  Egress:  ~100 KB  10,000 downloads/month = 1 GB/month"
echo ""
echo "Monthly cost: \$0 (within free tier of 10 GB storage + 1 GB/day egress)"
echo ""
echo "Backblaze B2 Free Tier:"
echo "  - 10 GB storage"
echo "  - 1 GB egress per day"
echo "  - Unlimited downloads via Cloudflare CDN"

echo ""
echo " Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add secrets to GitHub"
echo "  2. Enable workflow in sdk-cdn-deploy.yml"
echo "  3. Publish SDK to trigger deployment"
echo ""
