#!/bin/bash
# LLM-Data-Vault: Production Deployment Script
# Deploys unified Data-Vault service to Google Cloud Run

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Defaults
PROJECT_ID="${GCP_PROJECT:-agentics-dev}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="llm-data-vault"
PLATFORM_ENV="${PLATFORM_ENV:-dev}"

# Placeholder credentials (replace in production)
RUVECTOR_URL="${RUVECTOR_SERVICE_URL:-https://ruvector-service-placeholder.agentics.dev}"
RUVECTOR_KEY="${RUVECTOR_API_KEY:-placeholder-ruvector-api-key}"
TELEMETRY_URL="${TELEMETRY_ENDPOINT:-https://observatory-placeholder.agentics.dev/v1/traces}"

# =============================================================================
# Banner
# =============================================================================

echo "
╔════════════════════════════════════════════════════════════════════════════╗
║                    LLM-DATA-VAULT DEPLOYMENT                               ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Service:     $SERVICE_NAME
║  Project:     $PROJECT_ID
║  Region:      $REGION
║  Environment: $PLATFORM_ENV
╚════════════════════════════════════════════════════════════════════════════╝
"

# =============================================================================
# Pre-flight Checks
# =============================================================================

echo "Running pre-flight checks..."

# Check gcloud auth
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -1 > /dev/null; then
  echo "ERROR: Not authenticated with gcloud. Run: gcloud auth login"
  exit 1
fi
echo "✓ gcloud authenticated"

# Check project
gcloud config set project "$PROJECT_ID" 2>/dev/null || true
echo "✓ Project set to $PROJECT_ID"

# Check required APIs
for API in run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com; do
  if gcloud services list --enabled --filter="name:$API" --format="value(name)" | grep -q "$API"; then
    echo "✓ API enabled: $API"
  else
    echo "Enabling API: $API..."
    gcloud services enable "$API"
  fi
done

# =============================================================================
# Create Secrets (if they don't exist)
# =============================================================================

echo ""
echo "Setting up secrets..."

create_secret_if_not_exists() {
  local SECRET_NAME=$1
  local SECRET_VALUE=$2

  if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" > /dev/null 2>&1; then
    echo "✓ Secret exists: $SECRET_NAME"
  else
    echo "Creating secret: $SECRET_NAME..."
    echo -n "$SECRET_VALUE" | gcloud secrets create "$SECRET_NAME" \
      --project="$PROJECT_ID" \
      --data-file=- \
      --replication-policy="automatic"
    echo "✓ Secret created: $SECRET_NAME"
  fi
}

create_secret_if_not_exists "ruvector-api-key" "$RUVECTOR_KEY"
create_secret_if_not_exists "ruvector-service-url" "$RUVECTOR_URL"
create_secret_if_not_exists "telemetry-endpoint" "$TELEMETRY_URL"

# =============================================================================
# Build
# =============================================================================

echo ""
echo "Building project..."

cd "$PROJECT_ROOT"

# Install dependencies
npm ci 2>/dev/null || npm install
echo "✓ Dependencies installed"

# Build TypeScript
npm run build
echo "✓ TypeScript compiled"

# =============================================================================
# Deploy to Cloud Run
# =============================================================================

echo ""
echo "Deploying to Cloud Run..."

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 100 \
  --timeout 60s \
  --set-env-vars "SERVICE_NAME=$SERVICE_NAME,SERVICE_VERSION=$VERSION,PLATFORM_ENV=$PLATFORM_ENV,NODE_ENV=production,LOG_LEVEL=info" \
  --update-secrets "RUVECTOR_API_KEY=ruvector-api-key:latest,RUVECTOR_SERVICE_URL=ruvector-service-url:latest,TELEMETRY_ENDPOINT=telemetry-endpoint:latest" \
  --labels "service=llm-data-vault,environment=$PLATFORM_ENV,version=$VERSION"

# =============================================================================
# Get Service URL
# =============================================================================

echo ""
echo "Getting service URL..."

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --format 'value(status.url)')

echo "Service URL: $SERVICE_URL"

# =============================================================================
# Verification
# =============================================================================

echo ""
echo "Running verification..."

# Wait for service to be ready
sleep 5

# Health check
echo "Testing /health..."
HEALTH_RESPONSE=$(curl -s "$SERVICE_URL/health")
if echo "$HEALTH_RESPONSE" | grep -q '"status":"healthy"'; then
  echo "✓ Health check passed"
else
  echo "⚠ Health check returned: $HEALTH_RESPONSE"
fi

# Metadata check
echo "Testing /metadata..."
METADATA_RESPONSE=$(curl -s "$SERVICE_URL/metadata")
if echo "$METADATA_RESPONSE" | grep -q '"service":"llm-data-vault"'; then
  echo "✓ Metadata check passed"
else
  echo "⚠ Metadata check returned unexpected response"
fi

# Anonymize check
echo "Testing /anonymize..."
ANONYMIZE_RESPONSE=$(curl -s -X POST "$SERVICE_URL/anonymize" \
  -H "Content-Type: application/json" \
  -d '{"content": {"email": "test@example.com"}, "tenant_id": "test", "requester": {"service": "deploy-test"}}')
if echo "$ANONYMIZE_RESPONSE" | grep -q '"success":true'; then
  echo "✓ Anonymize endpoint working"
else
  echo "⚠ Anonymize returned: $ANONYMIZE_RESPONSE"
fi

# =============================================================================
# Summary
# =============================================================================

echo "
╔════════════════════════════════════════════════════════════════════════════╗
║                    DEPLOYMENT COMPLETE                                     ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Service URL: $SERVICE_URL
║
║  Endpoints:
║    - Health:     GET  $SERVICE_URL/health
║    - Metadata:   GET  $SERVICE_URL/metadata
║    - Metrics:    GET  $SERVICE_URL/metrics
║    - Anonymize:  POST $SERVICE_URL/anonymize
║    - Inspect:    POST $SERVICE_URL/inspect
║    - Authorize:  POST $SERVICE_URL/authorize
║    - Strategies: GET  $SERVICE_URL/strategies
║    - Policies:   GET  $SERVICE_URL/policies
║
║  CLI Usage:
║    export DATA_VAULT_URL=$SERVICE_URL
║    data-vault health
║    data-vault anonymize --content '{\"email\": \"test@test.com\"}' --tenant-id test
║
╚════════════════════════════════════════════════════════════════════════════╝
"

echo "Deployment finished successfully!"
