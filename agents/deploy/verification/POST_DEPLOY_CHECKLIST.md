# LLM-Data-Vault Post-Deployment Verification Checklist

## Service Verification

### 1. Service is Live
```bash
# Get service URL
SERVICE_URL=$(gcloud run services describe llm-data-vault \
  --region=us-central1 --format='value(status.url)')

# Verify service responds
curl -s "$SERVICE_URL/" | jq .
```
- [ ] Service returns 200 OK
- [ ] Service name matches `llm-data-vault`

### 2. Health Endpoint
```bash
curl -s "$SERVICE_URL/health" | jq .
```
- [ ] Returns `{"status": "healthy"}`
- [ ] ruvector_service dependency shows healthy
- [ ] Both agents show status "ready"

### 3. All Agent Endpoints Respond

```bash
# Anonymization endpoints
curl -s -X POST "$SERVICE_URL/anonymize" \
  -H "Content-Type: application/json" \
  -d '{"content": {"test": "value"}, "tenant_id": "test"}' | jq .status

curl -s -X POST "$SERVICE_URL/inspect" \
  -H "Content-Type: application/json" \
  -d '{"content": {"test": "value"}, "tenant_id": "test"}' | jq .status

curl -s "$SERVICE_URL/strategies" | jq .

# Access control endpoints
curl -s -X POST "$SERVICE_URL/authorize" \
  -H "Content-Type: application/json" \
  -d '{"subject": {"subject_id": "test"}, "resource": {"resource_id": "test"}}' | jq .

curl -s "$SERVICE_URL/policies" | jq .
```
- [ ] `/anonymize` returns 200
- [ ] `/inspect` returns 200
- [ ] `/strategies` returns list
- [ ] `/authorize` returns 200
- [ ] `/policies` returns list

## Functional Verification

### 4. Access Decisions are Deterministic
```bash
# Run same request 3 times, should get same result
for i in 1 2 3; do
  curl -s -X POST "$SERVICE_URL/authorize" \
    -H "Content-Type: application/json" \
    -d '{"subject": {"subject_id": "user-1", "subject_type": "user", "tenant_id": "t1"}, "resource": {"resource_id": "ds-1", "resource_type": "dataset", "tenant_id": "t1"}, "action": "read"}' \
    | jq -r '.decision'
done
```
- [ ] All 3 responses are identical

### 5. Anonymization Behaves Correctly
```bash
# Test email redaction
curl -s -X POST "$SERVICE_URL/anonymize" \
  -H "Content-Type: application/json" \
  -d '{"content": {"email": "test@example.com"}, "tenant_id": "test", "requester": {"service": "test"}}' \
  | jq -r '.data.anonymized_content.email'
```
- [ ] Email is redacted (shows `[REDACTED]` or masked)
- [ ] PII detection count > 0

### 6. DecisionEvents Appear in ruvector-service
```bash
# Check logs for persistence calls
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="llm-data-vault" AND "ruvector"' \
  --limit=5 --format=json
```
- [ ] Logs show ruvector-service calls
- [ ] No SQL connection strings in logs
- [ ] DecisionEvents being persisted

### 7. Telemetry Appears in LLM-Observatory
```bash
# Check for telemetry emission
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="llm-data-vault" AND "telemetry"' \
  --limit=5 --format=json
```
- [ ] Telemetry events being emitted
- [ ] agent_invocation events present
- [ ] Latency metrics being recorded

### 8. CLI Commands Function End-to-End
```bash
export DATA_VAULT_URL="$SERVICE_URL"

# Test all CLI commands
data-vault health
data-vault metadata
data-vault anonymize --content '{"email": "test@test.com"}' --tenant-id test
data-vault inspect --content '{"ssn": "123-45-6789"}' --tenant-id test
```
- [ ] `health` returns healthy
- [ ] `metadata` returns agent info
- [ ] `anonymize` returns anonymized content
- [ ] `inspect` returns PII detections

## Security Verification

### 9. No Direct SQL Access
```bash
# Search logs for SQL patterns
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="llm-data-vault" AND ("SELECT" OR "INSERT" OR "postgres" OR "SQL")' \
  --limit=10
```
- [ ] No SQL queries in logs
- [ ] No postgres connection strings
- [ ] All persistence via ruvector-service

### 10. No Agent Bypasses agentics-contracts
```bash
# Verify contract validation
curl -s -X POST "$SERVICE_URL/anonymize" \
  -H "Content-Type: application/json" \
  -d '{"invalid": "request"}' | jq .
```
- [ ] Invalid requests return validation errors
- [ ] Error includes schema reference

### 11. No Inference or Request Routing
```bash
# Check metadata confirms boundaries
curl -s "$SERVICE_URL/metadata" | jq '.boundaries'
```
- [ ] `executes_inference: false`
- [ ] `modifies_prompts: false`
- [ ] `routes_requests: false`
- [ ] `triggers_orchestration: false`

## Performance Verification

### 12. Response Times
```bash
# Measure latency
for endpoint in health anonymize inspect; do
  echo "Testing /$endpoint:"
  time curl -s -X POST "$SERVICE_URL/$endpoint" \
    -H "Content-Type: application/json" \
    -d '{"content": {"test": "value"}, "tenant_id": "test", "requester": {"service": "test"}}' > /dev/null
done
```
- [ ] Health < 100ms
- [ ] Anonymize < 500ms
- [ ] Inspect < 500ms

### 13. Metrics Endpoint
```bash
curl -s "$SERVICE_URL/metrics"
```
- [ ] Returns Prometheus-format metrics
- [ ] Invocation counters present
- [ ] Latency gauges present

## Final Sign-Off

| Check | Status | Notes |
|-------|--------|-------|
| Service Live | ⬜ | |
| Health OK | ⬜ | |
| All Endpoints | ⬜ | |
| Deterministic | ⬜ | |
| Anonymization | ⬜ | |
| DecisionEvents | ⬜ | |
| Telemetry | ⬜ | |
| CLI Works | ⬜ | |
| No Direct SQL | ⬜ | |
| Contracts Valid | ⬜ | |
| No Inference | ⬜ | |
| Performance OK | ⬜ | |
| Metrics OK | ⬜ | |

**Deployment Approved:** ⬜ Yes / ⬜ No

**Approved By:** _______________

**Date:** _______________
