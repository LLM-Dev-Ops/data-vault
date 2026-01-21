# LLM-Data-Vault Agent Verification Checklist

**Version:** 0.1.0
**Last Updated:** 2025-12-07
**Status:** Pre-Production

This checklist ensures that the LLM-Data-Vault agents are properly verified before deployment and remain compliant with the LLM-Dev-Ops ecosystem boundaries.

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Contract Compliance Verification](#contract-compliance-verification)
3. [Boundary Enforcement Verification](#boundary-enforcement-verification)
4. [Integration Testing Steps](#integration-testing-steps)
5. [DecisionEvent Persistence Verification](#decisionevent-persistence-verification)
6. [Telemetry Visibility Verification](#telemetry-visibility-verification)
7. [Monitoring Setup](#monitoring-setup)
8. [Security Verification](#security-verification)
9. [Performance Verification](#performance-verification)
10. [Rollback Procedures](#rollback-procedures)

---

## Pre-Deployment Checklist

### Environment Configuration

- [ ] **GCP Project ID** is set correctly
  ```bash
  echo $GCP_PROJECT_ID
  # Expected: your-project-id
  ```

- [ ] **Service Account** exists and has correct permissions
  ```bash
  gcloud iam service-accounts describe \
    llm-data-vault-agent@${GCP_PROJECT_ID}.iam.gserviceaccount.com
  ```

- [ ] **Required secrets** are configured in Secret Manager
  - [ ] `policy-engine-api-key`
  - [ ] `event-store-api-key`
  - [ ] `encryption-master-key`
  ```bash
  gcloud secrets list --filter="name:llm-data-vault"
  ```

- [ ] **VPC Connector** is available
  ```bash
  gcloud compute networks vpc-access connectors describe \
    llm-dev-ops-vpc --region=us-central1
  ```

- [ ] **Integration endpoints** are accessible
  - [ ] Policy Engine: `$POLICY_ENGINE_URL`
  - [ ] Event Store: `$EVENT_STORE_URL`
  - [ ] Inference Gateway: `$INFERENCE_GATEWAY_URL`

### Build Verification

- [ ] **TypeScript compiles** without errors
  ```bash
  cd agents && npm run build
  # Expected: No errors, dist/ directory created
  ```

- [ ] **All tests pass**
  ```bash
  npm run test
  # Expected: All tests pass
  ```

- [ ] **Contract tests pass**
  ```bash
  npm run test:contracts
  # Expected: All schema validations pass
  ```

- [ ] **Smoke tests pass**
  ```bash
  npm run test:smoke
  # Expected: All endpoint tests pass
  ```

- [ ] **No lint errors**
  ```bash
  npm run lint
  # Expected: No errors
  ```

### Dependencies

- [ ] **Production dependencies** are up to date
  ```bash
  npm audit
  # Expected: No high or critical vulnerabilities
  ```

- [ ] **Required packages** are installed
  - [ ] `@google-cloud/functions-framework`
  - [ ] `zod`
  - [ ] `pino`
  - [ ] `uuid`

---

## Contract Compliance Verification

### Input Schema Compliance

| Endpoint | Schema | Validation Status |
|----------|--------|-------------------|
| `/api/v1/authorize` | AuthorizeRequestSchema | [ ] Validated |
| `/api/v1/anonymize` | AnonymizeRequestSchema | [ ] Validated |
| `/api/v1/detect-pii` | DetectPiiRequestSchema | [ ] Validated |
| `/api/v1/encrypt` | EncryptRequestSchema | [ ] Validated |

**Verification Steps:**

1. [ ] Run schema validation tests
   ```bash
   npm run test -- --grep "Input Schema Validation"
   ```

2. [ ] Test with invalid inputs (should reject)
   ```bash
   curl -X POST https://<function-url>/api/v1/authorize \
     -H "Content-Type: application/json" \
     -d '{"invalid": "request"}'
   # Expected: 400 Bad Request with validation errors
   ```

3. [ ] Test with valid inputs (should accept)
   ```bash
   curl -X POST https://<function-url>/api/v1/authorize \
     -H "Content-Type: application/json" \
     -d '{
       "requestId": "550e8400-e29b-41d4-a716-446655440000",
       "userId": "user-123",
       "datasetId": "dataset-456",
       "operation": "read"
     }'
   # Expected: 200 OK with valid response
   ```

### Output Schema Compliance

| Endpoint | Schema | Validation Status |
|----------|--------|-------------------|
| `/api/v1/authorize` | AuthorizeResponseSchema | [ ] Validated |
| `/api/v1/anonymize` | AnonymizeResponseSchema | [ ] Validated |
| `/api/v1/detect-pii` | DetectPiiResponseSchema | [ ] Validated |
| `/api/v1/encrypt` | EncryptResponseSchema | [ ] Validated |

**Verification Steps:**

1. [ ] Run output schema validation tests
   ```bash
   npm run test -- --grep "Output Schema Validation"
   ```

2. [ ] Verify response includes `decisionEventId`
   ```bash
   curl -X POST https://<function-url>/api/v1/authorize \
     -H "Content-Type: application/json" \
     -d '{"requestId": "...", "userId": "...", "datasetId": "...", "operation": "read"}' \
     | jq '.decisionEventId'
   # Expected: Valid UUID
   ```

### DecisionEvent Schema Compliance

- [ ] **DecisionEvent structure** is valid
  ```javascript
  {
    eventId: "uuid",
    eventType: "DecisionEvent",
    version: "1.0.0",
    timestamp: "ISO8601",
    source: { agentId, agentName, agentVersion },
    decision: { type, reason, confidence, policyIds, appliedRules },
    context: { requestId, operation, resourceType, ... },
    audit: { inputHash, outputHash, processingTimeMs, bytesProcessed }
  }
  ```

- [ ] **All decision types** are valid
  - [ ] `ALLOW`
  - [ ] `DENY`
  - [ ] `TRANSFORM`
  - [ ] `AUDIT`

- [ ] **Confidence scores** are within bounds (0-1)

- [ ] **Audit fields** are populated correctly

---

## Boundary Enforcement Verification

### CRITICAL: Agents Must NOT Execute These Operations

| Forbidden Operation | Test Command | Status |
|---------------------|--------------|--------|
| Execute LLM Inference | `verifyBoundaryCompliance('inference')` | [ ] Blocked |
| Modify Prompts | `verifyBoundaryCompliance('prompt-modify')` | [ ] Blocked |
| Route Requests | `verifyBoundaryCompliance('route-request')` | [ ] Blocked |
| Trigger Orchestration | `verifyBoundaryCompliance('trigger-orchestration')` | [ ] Blocked |
| Spawn Agents | `verifyBoundaryCompliance('spawn-agent')` | [ ] Blocked |
| Execute Code | `verifyBoundaryCompliance('execute-code')` | [ ] Blocked |

**Verification Steps:**

1. [ ] Run boundary tests
   ```bash
   npm run test -- --grep "Boundary Enforcement"
   # Expected: All forbidden operations blocked
   ```

2. [ ] Verify registration declares boundaries
   ```typescript
   const reg = createAgentRegistration({...});
   assert(reg.boundaries.executesInference === false);
   assert(reg.boundaries.modifiesPrompts === false);
   assert(reg.boundaries.routesRequests === false);
   assert(reg.boundaries.triggersOrchestration === false);
   ```

3. [ ] Code review: Search for forbidden patterns
   ```bash
   # Should return NO matches
   grep -r "inference" agents/src/ --include="*.ts" | grep -v "test" | grep -v "comment"
   grep -r "llm.complete" agents/src/ --include="*.ts"
   grep -r "openai\|anthropic" agents/src/ --include="*.ts"
   grep -r "spawn.*agent" agents/src/ --include="*.ts"
   ```

### Allowed Operations

| Permitted Operation | Test Command | Status |
|--------------------|--------------|--------|
| Authorize | `verifyBoundaryCompliance('authorize')` | [ ] Allowed |
| Anonymize | `verifyBoundaryCompliance('anonymize')` | [ ] Allowed |
| Detect PII | `verifyBoundaryCompliance('detect-pii')` | [ ] Allowed |
| Encrypt/Decrypt | `verifyBoundaryCompliance('encrypt')` | [ ] Allowed |
| Emit Events | `verifyBoundaryCompliance('emit-event')` | [ ] Allowed |
| Emit Telemetry | `verifyBoundaryCompliance('emit-telemetry')` | [ ] Allowed |
| Audit Logging | `verifyBoundaryCompliance('audit')` | [ ] Allowed |

---

## Integration Testing Steps

### LLM-Policy-Engine Integration

1. [ ] **Fetch policies** from Policy Engine
   ```bash
   # Test policy fetch
   curl -X GET "${POLICY_ENGINE_URL}/api/v1/policies" \
     -H "X-Agent-Id: llm-data-vault" \
     -H "Authorization: Bearer ${POLICY_ENGINE_API_KEY}"
   # Expected: List of policies
   ```

2. [ ] **Subscribe to policy updates**
   - [ ] Policy changes are received
   - [ ] Local policy cache is updated

3. [ ] **Apply policies** during authorization
   - [ ] Correct policy is matched
   - [ ] Rules are evaluated correctly
   - [ ] Decision reflects policy

### LLM-Orchestrator Integration

1. [ ] **Receive dataset requests**
   ```bash
   # Simulate orchestrator request
   curl -X POST "https://<function-url>/api/v1/dataset-request" \
     -H "Content-Type: application/json" \
     -d '{
       "requestId": "...",
       "correlationId": "...",
       "requester": {"serviceId": "llm-orchestrator", "purpose": "training"},
       "dataset": {"datasetId": "dataset-456"},
       "requirements": {"anonymizationLevel": "strict", ...}
     }'
   ```

2. [ ] **Process and respond**
   - [ ] Request is validated
   - [ ] Authorization is checked
   - [ ] Anonymization is applied if required
   - [ ] Response is sent back

3. [ ] **Callback to orchestrator**
   - [ ] Response reaches callback URL
   - [ ] DecisionEvent ID is included

### LLM-Inference-Gateway Integration

1. [ ] **Register approved datasets**
   ```bash
   # Verify dataset registration
   curl -X GET "${INFERENCE_GATEWAY_URL}/api/v1/datasets/dataset-456" \
     -H "Authorization: Bearer ${ACCESS_TOKEN}"
   # Expected: Dataset metadata
   ```

2. [ ] **Revoke dataset access**
   - [ ] Revocation request succeeds
   - [ ] Dataset is no longer accessible

3. [ ] **Access token generation**
   - [ ] Tokens are generated correctly
   - [ ] Tokens have proper expiration

---

## DecisionEvent Persistence Verification

### Event Emission

1. [ ] **Events are emitted** for all decisions
   ```bash
   # Check event store for recent events
   curl -X GET "${EVENT_STORE_URL}/api/v1/events?source=llm-data-vault&limit=10" \
     -H "Authorization: Bearer ${EVENT_STORE_API_KEY}"
   # Expected: Recent DecisionEvents
   ```

2. [ ] **Event schema** is valid
   ```bash
   # Validate event against schema
   curl -X GET "${EVENT_STORE_URL}/api/v1/events/${EVENT_ID}" | \
     npx ajv validate -s decision-event-schema.json
   ```

3. [ ] **Audit fields** are populated
   - [ ] `inputHash` is computed correctly
   - [ ] `outputHash` is computed (when applicable)
   - [ ] `processingTimeMs` is accurate
   - [ ] `bytesProcessed` is accurate

### Event Persistence

1. [ ] **Events persist** in event store
   ```bash
   # Query historical events
   curl -X GET "${EVENT_STORE_URL}/api/v1/events?startTime=2025-12-01&endTime=2025-12-07"
   ```

2. [ ] **Events are queryable** by:
   - [ ] `eventId`
   - [ ] `requestId`
   - [ ] `correlationId`
   - [ ] `datasetId`
   - [ ] `decision.type`

3. [ ] **Events are exportable** for compliance
   ```bash
   # Export events for audit
   curl -X GET "${EVENT_STORE_URL}/api/v1/events/export?format=csv"
   ```

### Event Consumption

1. [ ] **Pub/Sub subscription** is active
   ```bash
   gcloud pubsub subscriptions describe governance-decision-events-sub
   ```

2. [ ] **Events from other agents** are consumed
   - [ ] Events are received
   - [ ] Events are processed
   - [ ] Correlation is maintained

---

## Telemetry Visibility Verification

### Metrics Emission

1. [ ] **Custom metrics** are emitted
   ```bash
   # Check Cloud Monitoring for custom metrics
   gcloud monitoring metrics-descriptors list \
     --filter="metric.type=starts_with('custom.googleapis.com/llm-data-vault')"
   ```

2. [ ] **Required metrics** are present:
   - [ ] `decision_events_emitted`
   - [ ] `pii_detections`
   - [ ] `anonymization_transformations`
   - [ ] `request_latency`
   - [ ] `error_count`

### Dashboards

1. [ ] **Operations dashboard** is configured
   - [ ] Request rate visible
   - [ ] Error rate visible
   - [ ] Latency percentiles visible
   - [ ] Resource utilization visible

2. [ ] **Governance dashboard** is configured
   - [ ] Decision distribution (ALLOW/DENY/TRANSFORM)
   - [ ] PII detection rates
   - [ ] Anonymization volumes
   - [ ] Policy hit rates

### Tracing

1. [ ] **Traces are collected**
   ```bash
   # Check Cloud Trace for recent traces
   gcloud trace traces list --filter="service_name=llm-data-vault"
   ```

2. [ ] **Trace propagation** works
   - [ ] `traceId` is passed through
   - [ ] `spanId` is generated
   - [ ] Parent spans are linked

3. [ ] **End-to-end traces** are visible
   - [ ] Request -> Authorization -> Decision -> Response

---

## Monitoring Setup

### Alerts

- [ ] **High error rate alert** is configured
  ```yaml
  condition: error_rate > 5% for 5 minutes
  notification: PagerDuty/Slack
  ```

- [ ] **High latency alert** is configured
  ```yaml
  condition: p99_latency > 5 seconds for 5 minutes
  notification: PagerDuty/Slack
  ```

- [ ] **Decision event failure alert** is configured
  ```yaml
  condition: decision_event_emission_failed > 0
  notification: PagerDuty/Slack (immediate)
  ```

### Log Sinks

- [ ] **Audit log sink** is configured
  ```bash
  gcloud logging sinks describe audit-log-sink
  # Expected: Sink to BigQuery
  ```

- [ ] **Security log sink** is configured
  ```bash
  gcloud logging sinks describe security-log-sink
  # Expected: Sink to Cloud Storage
  ```

### Uptime Checks

- [ ] **Health endpoint check** is configured
  ```bash
  gcloud monitoring uptime-check-configs list \
    --filter="displayName:llm-data-vault-health"
  ```

---

## Security Verification

### Authentication

- [ ] **IAM authentication** is enforced
  - [ ] Unauthorized requests are rejected (401)
  - [ ] Authorized requests are accepted

- [ ] **API keys** are validated
  - [ ] Invalid keys are rejected
  - [ ] Valid keys are accepted

### Authorization

- [ ] **Service account permissions** are minimal
  - [ ] Only required roles are assigned
  - [ ] No over-privileged access

- [ ] **Function invoker permissions** are restricted
  - [ ] Only allowed services can invoke

### Data Protection

- [ ] **Encryption at rest** is enabled
  - [ ] KMS keys are configured
  - [ ] Data is encrypted

- [ ] **Encryption in transit** is enforced
  - [ ] HTTPS only
  - [ ] TLS 1.2+

- [ ] **Secrets are not exposed**
  - [ ] No secrets in logs
  - [ ] No secrets in responses
  - [ ] No secrets in error messages

### Input Validation

- [ ] **All inputs are validated**
  - [ ] SQL injection protection
  - [ ] XSS protection
  - [ ] Path traversal protection

---

## Performance Verification

### Load Testing

- [ ] **Authorize endpoint** handles expected load
  ```bash
  # Target: 1000 RPS
  k6 run --vus 100 --duration 60s authorize-load-test.js
  # Expected: p99 < 500ms, error rate < 0.1%
  ```

- [ ] **Anonymize endpoint** handles expected load
  ```bash
  # Target: 100 RPS with 1MB payloads
  k6 run --vus 10 --duration 60s anonymize-load-test.js
  # Expected: p99 < 5s, error rate < 0.1%
  ```

### Resource Utilization

- [ ] **Memory usage** is within limits
  - [ ] No OOM errors
  - [ ] Peak usage < 80% of allocation

- [ ] **CPU usage** is within limits
  - [ ] No throttling
  - [ ] Peak usage < 80% of allocation

### Cold Start

- [ ] **Cold start time** is acceptable
  - [ ] Authorize: < 2 seconds
  - [ ] Anonymize: < 3 seconds

---

## Rollback Procedures

### Automatic Rollback Triggers

- [ ] **Error rate threshold** is set (5%)
- [ ] **Latency threshold** is set (10 seconds p99)
- [ ] **Rollback automation** is enabled

### Manual Rollback Steps

1. [ ] **Identify the issue**
   ```bash
   # Check recent deployments
   gcloud functions list --filter="name:llm-data-vault"
   ```

2. [ ] **Rollback to previous version**
   ```bash
   gcloud functions deploy llm-data-vault-authorize \
     --source gs://deployments/llm-data-vault/v0.0.9/
   ```

3. [ ] **Verify rollback**
   ```bash
   curl https://<function-url>/health
   ```

4. [ ] **Notify stakeholders**
   - [ ] Update incident channel
   - [ ] Document in post-mortem

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| Security Reviewer | | | |
| Platform Engineer | | | |
| Product Owner | | | |

---

## Appendix: Quick Commands

### Deploy All Functions

```bash
./deploy/scripts/deploy-all.sh --env production
```

### Run All Verifications

```bash
npm run verify:all
```

### Check System Health

```bash
curl https://<base-url>/health | jq .
```

### View Recent Logs

```bash
gcloud functions logs read llm-data-vault-authorize --limit 100
```

### Query Decision Events

```bash
curl -X GET "${EVENT_STORE_URL}/api/v1/events?source=llm-data-vault&limit=10" \
  -H "Authorization: Bearer ${EVENT_STORE_API_KEY}" | jq .
```
