#!/bin/sh
# ============================================================================
# MinIO Bucket Initialization Script
# ============================================================================
# Creates the BugSpotter storage bucket with private access (secure by default)
# Creates a dedicated service account with least-privilege access
# Usage: Executed automatically by minio-init container on startup
# ============================================================================

set -e  # Exit on any error

# Configuration from environment variables
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
MINIO_ROOT_USER="${MINIO_ROOT_USER}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD}"
BUCKET_NAME="${MINIO_BUCKET:-bugspotter}"

# Service account credentials (application-level, not root)
MINIO_APP_ACCESS_KEY="${MINIO_APP_ACCESS_KEY:-bugspotter-app-user}"
MINIO_APP_SECRET_KEY="${MINIO_APP_SECRET_KEY}"

# Validate required credentials
if [ -z "$MINIO_ROOT_USER" ] || [ -z "$MINIO_ROOT_PASSWORD" ]; then
  echo "Error: MINIO_ROOT_USER and MINIO_ROOT_PASSWORD must be set"
  echo "Please define these in your .env file"
  exit 1
fi

if [ -z "$MINIO_APP_SECRET_KEY" ]; then
  echo "Error: MINIO_APP_SECRET_KEY must be set"
  echo "Please define this in your .env file (use a strong random password)"
  exit 1
fi

echo "Initializing MinIO bucket: ${BUCKET_NAME}"

# Wait for MinIO IAM subsystem to be fully ready
# The healthcheck only verifies HTTP endpoint - IAM can lag by a few seconds
echo "Waiting for MinIO admin API..."
for i in $(seq 1 10); do
  mc admin info minio > /dev/null 2>&1 && break
  echo "  Attempt $i/10 - waiting 3s..."
  sleep 3
done

# Configure MinIO client alias
echo "Configuring MinIO client..."
mc alias set minio "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}"

# Create bucket if it doesn't exist
echo "Creating bucket (if not exists)..."
mc mb --ignore-existing "minio/${BUCKET_NAME}"

# Create least-privilege policy for the application
echo "Creating application access policy..."
cat > /tmp/bugspotter-app-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload"
      ],
      "Resource": [
        "arn:aws:s3:::${BUCKET_NAME}",
        "arn:aws:s3:::${BUCKET_NAME}/*"
      ]
    }
  ]
}
EOF

# Create policy (mc admin policy create for mc >= RELEASE.2023-03-20)
# This replaces the deprecated 'mc admin policy set' command
echo "Creating policy definition..."
mc admin policy create minio bugspotter-app-policy /tmp/bugspotter-app-policy.json

# Ensure service account exists with current credentials
# mc admin user add is idempotent - creates or updates password
echo "Ensuring application service account '${MINIO_APP_ACCESS_KEY}' exists..."
mc admin user add minio "${MINIO_APP_ACCESS_KEY}" "${MINIO_APP_SECRET_KEY}"

# Attach policy to user (always run to ensure correct permissions)
echo "Attaching policy to user..."
mc admin policy attach minio bugspotter-app-policy --user "${MINIO_APP_ACCESS_KEY}"

# Verify bucket was created
if mc ls "minio/${BUCKET_NAME}" > /dev/null 2>&1; then
  echo "MinIO bucket '${BUCKET_NAME}' initialized successfully (private access)"
else
  echo "Failed to verify bucket creation"
  exit 1
fi

echo "MinIO initialization complete"
echo "Service account '${MINIO_APP_ACCESS_KEY}' created with least-privilege access"
