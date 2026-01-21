# LLM-Data-Vault CLI Commands

## Overview

All CLI commands route to the unified `llm-data-vault` service endpoints.
CLI configuration resolves service URL dynamically from environment.

## Configuration

```bash
# Set service URL (or use default)
export DATA_VAULT_URL=https://llm-data-vault-xxxxx-uc.a.run.app

# Or for local development
export DATA_VAULT_URL=http://localhost:8080
```

## Commands

### 1. Data Authorize

Authorize dataset access request.

```bash
# Basic usage
data-vault authorize \
  --subject-id user-123 \
  --subject-type user \
  --resource-id dataset-456 \
  --resource-type dataset \
  --action read \
  --tenant-id tenant-001

# With roles
data-vault authorize \
  --subject-id service-ml-pipeline \
  --subject-type service \
  --resource-id training-data \
  --resource-type dataset \
  --action read \
  --roles "ml-engineer,data-scientist" \
  --tenant-id tenant-001

# Expected success output
{
  "request_id": "uuid-xxx",
  "decision": "allow",
  "granted_actions": ["read"],
  "policy_evaluations": [...],
  "cache_ttl_seconds": 300
}
```

### 2. Data Anonymize

Apply anonymization to dataset content.

```bash
# Anonymize JSON content
data-vault anonymize \
  --content '{"email": "john@example.com", "ssn": "123-45-6789"}' \
  --strategy redact \
  --tenant-id tenant-001

# Anonymize from file
data-vault anonymize \
  --file /path/to/data.json \
  --strategy mask \
  --output /path/to/anonymized.json \
  --tenant-id tenant-001

# With specific policy
data-vault anonymize \
  --file /path/to/data.json \
  --policy-id gdpr-compliance \
  --include-details \
  --tenant-id tenant-001

# Expected success output
{
  "success": true,
  "data": {
    "request_id": "uuid-xxx",
    "anonymized_content": {
      "email": "[REDACTED]",
      "ssn": "[REDACTED]"
    },
    "results": {
      "total_fields_processed": 2,
      "fields_anonymized": 2,
      "pii_detections": 2
    },
    "compliance": {
      "frameworks_satisfied": ["gdpr"],
      "attestation_hash": "xxx"
    }
  }
}
```

### 3. Data Inspect

Inspect content for PII without modifying (dry-run).

```bash
# Inspect JSON content
data-vault inspect \
  --content '{"email": "john@example.com", "name": "John Doe"}' \
  --tenant-id tenant-001

# Inspect from file
data-vault inspect \
  --file /path/to/data.json \
  --verbose \
  --tenant-id tenant-001

# Expected success output
{
  "success": true,
  "data": {
    "results": {
      "total_fields_processed": 2,
      "fields_anonymized": 0,
      "pii_detections": 2,
      "detection_breakdown": {
        "email": 1,
        "person_name": 1
      }
    },
    "field_results": [
      {
        "field_path": "email",
        "pii_type": "email",
        "confidence": 0.95
      },
      {
        "field_path": "name",
        "pii_type": "person_name",
        "confidence": 0.87
      }
    ]
  }
}
```

### 4. Health & Metadata

```bash
# Health check
data-vault health

# Expected output
{
  "status": "healthy",
  "service": "llm-data-vault",
  "version": "0.1.0",
  "dependencies": {
    "ruvector_service": { "healthy": true }
  }
}

# Metadata
data-vault metadata

# Expected output
{
  "service": "llm-data-vault",
  "agents": [...]
}
```

## CLI Implementation (curl equivalents)

For systems without the CLI, use curl:

```bash
# Authorize
curl -X POST "$DATA_VAULT_URL/authorize" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": {"subject_id": "user-123", "subject_type": "user", "tenant_id": "tenant-001"},
    "resource": {"resource_id": "dataset-456", "resource_type": "dataset", "tenant_id": "tenant-001"},
    "action": "read",
    "context": {"request_id": "'$(uuidgen)'", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}
  }'

# Anonymize
curl -X POST "$DATA_VAULT_URL/anonymize" \
  -H "Content-Type: application/json" \
  -d '{
    "content": {"email": "john@example.com"},
    "tenant_id": "tenant-001",
    "requester": {"service": "cli"}
  }'

# Inspect
curl -X POST "$DATA_VAULT_URL/inspect" \
  -H "Content-Type: application/json" \
  -d '{
    "content": {"email": "john@example.com"},
    "tenant_id": "tenant-001",
    "requester": {"service": "cli"}
  }'

# Health
curl "$DATA_VAULT_URL/health"

# Metadata
curl "$DATA_VAULT_URL/metadata"
```

## Dynamic URL Resolution

CLI resolves the service URL in this order:

1. `--url` flag (if provided)
2. `DATA_VAULT_URL` environment variable
3. Platform discovery via `agentics-cli config get data-vault.url`
4. Default: `https://llm-data-vault.agentics.dev`

No CLI change requires redeployment of agents.
