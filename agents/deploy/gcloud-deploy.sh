#!/bin/bash
# LLM-Data-Vault: Google Cloud Functions Deployment Script
#
# This script deploys the Dataset Anonymization Agent as a Google Cloud Edge Function.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Project ID set (gcloud config set project <PROJECT_ID>)
#   - Required APIs enabled (Cloud Functions, Secret Manager, VPC Access)
#   - Service account created with appropriate permissions
#
# Usage:
#   ./deploy/gcloud-deploy.sh [environment]
#
# Environments:
#   - development (default)
#   - staging
#   - production

set -euo pipefail

# Configuration
ENVIRONMENT="${1:-development}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load environment-specific config
case "$ENVIRONMENT" in
  development)
    PROJECT_ID="${GCP_PROJECT_DEV:-agentics-dev}"
    REGION="${GCP_REGION:-us-central1}"
    MIN_INSTANCES=0
    MAX_INSTANCES=10
    MEMORY="256MB"
    ;;
  staging)
    PROJECT_ID="${GCP_PROJECT_STAGING:-agentics-staging}"
    REGION="${GCP_REGION:-us-central1}"
    MIN_INSTANCES=1
    MAX_INSTANCES=50
    MEMORY="512MB"
    ;;
  production)
    PROJECT_ID="${GCP_PROJECT_PROD:-agentics-prod}"
    REGION="${GCP_REGION:-us-central1}"
    MIN_INSTANCES=2
    MAX_INSTANCES=100
    MEMORY="512MB"
    ;;
  *)
    echo "Unknown environment: $ENVIRONMENT"
    echo "Valid environments: development, staging, production"
    exit 1
    ;;
esac

echo "=========================================="
echo "LLM-Data-Vault Agent Deployment"
echo "=========================================="
echo "Environment: $ENVIRONMENT"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "=========================================="

# Change to project root
cd "$PROJECT_ROOT"

# Build the project
echo "Building project..."
npm run build

# Verify build
if [[ ! -d "dist" ]]; then
  echo "Error: Build failed - dist directory not found"
  exit 1
fi

# Deploy the function
echo "Deploying anonymization function..."
gcloud functions deploy data-vault-anonymization \
  --gen2 \
  --runtime=nodejs20 \
  --region="$REGION" \
  --source=. \
  --entry-point=anonymizationFunction \
  --trigger-http \
  --allow-unauthenticated \
  --memory="$MEMORY" \
  --timeout=60s \
  --min-instances="$MIN_INSTANCES" \
  --max-instances="$MAX_INSTANCES" \
  --set-env-vars="NODE_ENV=$ENVIRONMENT,AGENT_ID=data-vault.anonymization.v1,AGENT_VERSION=0.1.0,LOG_LEVEL=info" \
  --set-secrets="RUVECTOR_SERVICE_API_KEY=ruvector-api-key:latest,RUVECTOR_SERVICE_ENDPOINT=ruvector-endpoint:latest" \
  --service-account="data-vault-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
  --labels="service=llm-data-vault,agent=anonymization,environment=$ENVIRONMENT" \
  --project="$PROJECT_ID"

# Get the function URL
FUNCTION_URL=$(gcloud functions describe data-vault-anonymization \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(serviceConfig.uri)")

echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo "Function URL: $FUNCTION_URL"
echo ""
echo "Endpoints:"
echo "  - Anonymize: POST $FUNCTION_URL/anonymize"
echo "  - Inspect:   POST $FUNCTION_URL/inspect"
echo "  - Health:    GET  $FUNCTION_URL/health"
echo "  - Metadata:  GET  $FUNCTION_URL/metadata"
echo "=========================================="

# Run smoke test
echo "Running smoke test..."
HEALTH_RESPONSE=$(curl -s "$FUNCTION_URL/health")
if echo "$HEALTH_RESPONSE" | grep -q '"status":"healthy"'; then
  echo "Smoke test passed!"
else
  echo "Warning: Smoke test may have failed"
  echo "Response: $HEALTH_RESPONSE"
fi

echo "Deployment finished!"
