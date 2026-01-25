# LLM-Data-Vault: Cloud Run Deploy Template

## Phase 7 Deployment Configuration

This document provides deployment commands for the LLM-Data-Vault agent service.

---

## Prerequisites

1. **GCP Project configured:**
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **Secrets created in Secret Manager:**
   ```bash
   # Create secrets (if not exists)
   gcloud secrets create ruvector-api-key --replication-policy="automatic"
   gcloud secrets create ruvector-service-url --replication-policy="automatic"
   gcloud secrets create telemetry-endpoint --replication-policy="automatic"

   # Set secret values
   echo -n "YOUR_API_KEY" | gcloud secrets versions add ruvector-api-key --data-file=-
   echo -n "https://ruvector-service.agentics.dev" | gcloud secrets versions add ruvector-service-url --data-file=-
   echo -n "https://telemetry.agentics.dev" | gcloud secrets versions add telemetry-endpoint --data-file=-
   ```

3. **Service account created with permissions:**
   ```bash
   gcloud iam service-accounts create llm-data-vault \
     --display-name="LLM Data Vault Agent"

   # Grant Secret Manager access
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:llm-data-vault@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

---

## Deploy Commands

### Option 1: Source-based deployment (recommended for dev)

```bash
gcloud run deploy llm-data-vault \
  --source ./agents \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 100 \
  --timeout 60s \
  --set-secrets RUVECTOR_API_KEY=ruvector-api-key:latest,RUVECTOR_SERVICE_URL=ruvector-service-url:latest,TELEMETRY_ENDPOINT=telemetry-endpoint:latest \
  --set-env-vars AGENT_PHASE=phase7,AGENT_LAYER=layer2,AGENT_DOMAIN=data-vault,AGENT_NAME=llm-data-vault,NODE_ENV=production \
  --service-account llm-data-vault@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --labels service=llm-data-vault,environment=production,phase=phase7,layer=layer2
```

### Option 2: Image-based deployment (CI/CD)

```bash
# Build and push image first
docker build -t gcr.io/YOUR_PROJECT_ID/llm-data-vault:latest -f agents/Dockerfile agents/
docker push gcr.io/YOUR_PROJECT_ID/llm-data-vault:latest

# Deploy from image
gcloud run deploy llm-data-vault \
  --image gcr.io/YOUR_PROJECT_ID/llm-data-vault:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 100 \
  --timeout 60s \
  --set-secrets RUVECTOR_API_KEY=ruvector-api-key:latest,RUVECTOR_SERVICE_URL=ruvector-service-url:latest,TELEMETRY_ENDPOINT=telemetry-endpoint:latest \
  --set-env-vars AGENT_PHASE=phase7,AGENT_LAYER=layer2,AGENT_DOMAIN=data-vault,AGENT_NAME=llm-data-vault,NODE_ENV=production \
  --service-account llm-data-vault@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --labels service=llm-data-vault,environment=production,phase=phase7,layer=layer2
```

---

## Environment Variables Reference

| Variable | Source | Description |
|----------|--------|-------------|
| `RUVECTOR_API_KEY` | Secret | API key for ruvector-service authentication |
| `RUVECTOR_SERVICE_URL` | Secret | Endpoint URL for ruvector-service |
| `TELEMETRY_ENDPOINT` | Secret | OTLP endpoint for telemetry export |
| `AGENT_PHASE` | Env | Deployment phase identifier (`phase7`) |
| `AGENT_LAYER` | Env | Architecture layer (`layer2` - specialized agents) |
| `AGENT_DOMAIN` | Env | Domain classification (`data-vault`) |
| `AGENT_NAME` | Env | Service name (`llm-data-vault`) |
| `NODE_ENV` | Env | Runtime environment (`production`) |

---

## Verification

After deployment, verify the service:

```bash
# Get service URL
SERVICE_URL=$(gcloud run services describe llm-data-vault --region=us-central1 --format='value(status.url)')

# Health check
curl -s "$SERVICE_URL/health" | jq .

# Expected healthy response:
# {
#   "status": "healthy",
#   "service": "llm-data-vault",
#   "dependencies": {
#     "ruvector_service": { "healthy": true, "latency_ms": <number> }
#   }
# }

# Metadata check
curl -s "$SERVICE_URL/metadata" | jq .

# Ready check
curl -s "$SERVICE_URL/ready" | jq .
```

---

## Cloud Build Trigger

To use Cloud Build for automated deployments:

```bash
gcloud builds submit --config=agents/cloudbuild.yaml .
```

The `cloudbuild.yaml` is pre-configured with all Phase 7 environment variables.

---

## Rollback

To rollback to a previous revision:

```bash
# List revisions
gcloud run revisions list --service=llm-data-vault --region=us-central1

# Rollback to specific revision
gcloud run services update-traffic llm-data-vault \
  --region=us-central1 \
  --to-revisions=REVISION_NAME=100
```

---

## Troubleshooting

### Service not starting

1. Check logs:
   ```bash
   gcloud run services logs read llm-data-vault --region=us-central1 --limit=50
   ```

2. Verify secrets are accessible:
   ```bash
   gcloud secrets versions access latest --secret=ruvector-api-key
   ```

3. Check service account permissions:
   ```bash
   gcloud projects get-iam-policy YOUR_PROJECT_ID \
     --flatten="bindings[].members" \
     --filter="bindings.members:llm-data-vault@"
   ```

### Health check failing

The health endpoint returns 503 if ruvector-service is unavailable. Verify:

```bash
# Test ruvector-service directly
curl -H "Authorization: Bearer $RUVECTOR_API_KEY" \
  "https://ruvector-service.agentics.dev/health"
```
