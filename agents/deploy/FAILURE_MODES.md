# LLM-Data-Vault Failure Modes & Rollback

## Common Deployment Failures

### 1. Build Failures

| Failure | Detection | Resolution |
|---------|-----------|------------|
| TypeScript compile error | Cloud Build step fails | Fix TS errors, re-run build |
| Missing dependencies | npm ci fails | Check package.json, clear cache |
| Docker build fails | Image build step fails | Check Dockerfile, base image |

### 2. Deployment Failures

| Failure | Detection | Resolution |
|---------|-----------|------------|
| IAM permissions | Deploy step fails | Check service account permissions |
| Secret not found | Deploy fails with secret error | Create secret in Secret Manager |
| Region unavailable | Deploy fails | Use alternate region |
| Quota exceeded | Deploy fails with quota error | Request quota increase |

### 3. Runtime Failures

| Failure | Detection | Resolution |
|---------|-----------|------------|
| Health check fails | `/health` returns 503 | Check ruvector-service connectivity |
| Timeout errors | Requests timeout | Increase timeout, check dependencies |
| Memory exhaustion | OOM errors in logs | Increase memory allocation |
| Cold start issues | High latency on first request | Increase min-instances |

## Detection Signals

### Policy Mismatches
```bash
# Check for policy errors
gcloud logging read 'resource.labels.service_name="llm-data-vault" AND "policy" AND ("error" OR "mismatch" OR "invalid")' --limit=20
```

**Signals:**
- `POLICY_NOT_FOUND` errors
- `POLICY_VERSION_MISMATCH` errors
- Unexpected deny decisions

### Anonymization Errors
```bash
# Check for anonymization errors
gcloud logging read 'resource.labels.service_name="llm-data-vault" AND "anonymiz" AND "error"' --limit=20
```

**Signals:**
- `PII_DETECTION_FAILED` errors
- `STRATEGY_NOT_SUPPORTED` errors
- Incomplete anonymization (PII in output)

### Missing Telemetry
```bash
# Check telemetry emission
gcloud logging read 'resource.labels.service_name="llm-data-vault" AND "telemetry"' --limit=20 --format=json | jq 'length'
```

**Signals:**
- Zero telemetry events
- Missing `agent_invocation` events
- OTLP connection errors

### RuVector Service Issues
```bash
# Check ruvector connectivity
gcloud logging read 'resource.labels.service_name="llm-data-vault" AND "ruvector" AND ("error" OR "timeout" OR "failed")' --limit=20
```

**Signals:**
- Connection timeout errors
- Authentication failures
- `PERSIST_FAILED` errors

## Rollback Procedure

### Immediate Rollback (Traffic Shift)

```bash
# 1. List revisions
gcloud run revisions list --service=llm-data-vault --region=us-central1

# 2. Identify last known good revision
GOOD_REVISION="llm-data-vault-00002-abc"

# 3. Shift 100% traffic to good revision
gcloud run services update-traffic llm-data-vault \
  --region=us-central1 \
  --to-revisions=$GOOD_REVISION=100

# 4. Verify rollback
curl -s "$(gcloud run services describe llm-data-vault --region=us-central1 --format='value(status.url)')/health"
```

### Full Rollback (Redeploy Previous Image)

```bash
# 1. Find previous image
PREV_IMAGE=$(gcloud run revisions describe $GOOD_REVISION \
  --region=us-central1 \
  --format='value(spec.containers[0].image)')

# 2. Redeploy with previous image
gcloud run deploy llm-data-vault \
  --image=$PREV_IMAGE \
  --region=us-central1 \
  --platform=managed

# 3. Verify
curl -s "$(gcloud run services describe llm-data-vault --region=us-central1 --format='value(status.url)')/health"
```

## Safe Redeploy Strategy

### Pre-Deploy Checks

```bash
#!/bin/bash
# pre-deploy-checks.sh

set -e

echo "Running pre-deploy checks..."

# 1. Verify build succeeds locally
npm run build
echo "✓ Build successful"

# 2. Run contract tests
npm run test:contracts
echo "✓ Contract tests passed"

# 3. Verify secrets exist
gcloud secrets versions access latest --secret=ruvector-api-key > /dev/null
echo "✓ Secrets accessible"

# 4. Check current service health
SERVICE_URL=$(gcloud run services describe llm-data-vault --region=us-central1 --format='value(status.url)' 2>/dev/null || echo "")
if [ -n "$SERVICE_URL" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/health")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ Current service healthy"
  else
    echo "⚠ Current service unhealthy (HTTP $HTTP_CODE)"
  fi
fi

echo "Pre-deploy checks complete"
```

### Gradual Rollout

```bash
# 1. Deploy new revision without traffic
gcloud run deploy llm-data-vault \
  --image=gcr.io/$PROJECT_ID/llm-data-vault:$NEW_TAG \
  --region=us-central1 \
  --no-traffic

# 2. Get new revision name
NEW_REVISION=$(gcloud run revisions list --service=llm-data-vault --region=us-central1 --limit=1 --format='value(metadata.name)')

# 3. Shift 10% traffic
gcloud run services update-traffic llm-data-vault \
  --region=us-central1 \
  --to-revisions=$NEW_REVISION=10

# 4. Monitor for 5 minutes
echo "Monitoring for 5 minutes..."
sleep 300

# 5. Check error rate
ERROR_COUNT=$(gcloud logging read "resource.labels.service_name=\"llm-data-vault\" AND severity>=ERROR" --limit=100 --freshness=5m --format=json | jq 'length')

if [ "$ERROR_COUNT" -gt "5" ]; then
  echo "High error rate detected, rolling back..."
  gcloud run services update-traffic llm-data-vault \
    --region=us-central1 \
    --to-latest
  exit 1
fi

# 6. Shift 50% traffic
gcloud run services update-traffic llm-data-vault \
  --region=us-central1 \
  --to-revisions=$NEW_REVISION=50

# 7. Monitor for 5 more minutes
sleep 300

# 8. Full rollout
gcloud run services update-traffic llm-data-vault \
  --region=us-central1 \
  --to-revisions=$NEW_REVISION=100

echo "Deployment complete"
```

### Data Safety

**No data access or privacy data is lost during rollback because:**

1. **Stateless Service**: LLM-Data-Vault holds no state
2. **Persistence via RuVector**: All DecisionEvents are persisted to ruvector-service
3. **Append-Only**: DecisionEvents are append-only, never modified
4. **Idempotent**: Writes are idempotent with execution_ref deduplication

**Recovery Steps if DecisionEvents are Lost:**

```bash
# 1. Check ruvector-service for gaps
# (Query ruvector-service API for recent events)

# 2. Re-process requests if needed
# (Replay from upstream systems)

# 3. Verify event continuity
# (Compare execution_refs with upstream logs)
```
