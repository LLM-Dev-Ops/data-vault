# LLM-Data-Vault Platform Integration

## Integration Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           AGENTICS PLATFORM                                │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐      │
│  │ LLM-Orchestrator│     │ LLM-Inference   │     │ LLM-Policy      │      │
│  │                 │     │ Gateway         │     │ Engine/Shield   │      │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘      │
│           │                       │                       │               │
│           │ requests datasets     │ consumes approved     │ supplies      │
│           │ explicitly            │ datasets only         │ policies      │
│           │                       │                       │               │
│           └───────────────────────┼───────────────────────┘               │
│                                   │                                       │
│                                   ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                      LLM-DATA-VAULT                                │   │
│  │  ┌──────────────────┐    ┌──────────────────┐                      │   │
│  │  │ Data Access      │    │ Dataset          │                      │   │
│  │  │ Control Agent    │    │ Anonymization    │                      │   │
│  │  │                  │    │ Agent            │                      │   │
│  │  │ - Authorize      │    │ - Anonymize      │                      │   │
│  │  │ - Deny           │    │ - Redact         │                      │   │
│  │  │ - Policy Eval    │    │ - PII Detect     │                      │   │
│  │  └──────────────────┘    └──────────────────┘                      │   │
│  │                                   │                                │   │
│  │                                   │ DecisionEvents                 │   │
│  │                                   ▼                                │   │
│  └───────────────────────────────────┼────────────────────────────────┘   │
│                                      │                                    │
│                                      ▼                                    │
│  ┌───────────────────────────────────────────────────────────────────┐    │
│  │                     ruvector-service                              │    │
│  │                   (Google SQL - Postgres)                         │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│                                      │                                    │
│                                      │ consumes events                    │
│                                      ▼                                    │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                 Governance & Audit Systems                         │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

## Integration Confirmations

### LLM-Orchestrator MAY:
- [x] Request approved datasets explicitly via `/authorize`
- [x] Receive access decisions (allow/deny/conditional)
- [x] Request anonymized dataset views via `/anonymize`

### LLM-Orchestrator MUST NOT:
- [x] Bypass Data-Vault for dataset access
- [x] Access raw data without authorization

### LLM-Inference-Gateway MAY:
- [x] Consume Data-Vault–approved datasets only
- [x] Request pre-anonymized data for inference

### LLM-Inference-Gateway MUST NOT:
- [x] Access unapproved datasets
- [x] Skip anonymization requirements

### LLM-Policy-Engine / Shield MAY:
- [x] Supply access and privacy policies to Data-Vault
- [x] Define anonymization requirements per dataset
- [x] Set compliance framework requirements

### Governance & Audit Systems MAY:
- [x] Consume Data-Vault DecisionEvents from ruvector-service
- [x] Query historical access decisions
- [x] Monitor anonymization activity

### Core Bundles:
- [x] Consume Data-Vault outputs without rewiring
- [x] No Core bundle modifications required

## LLM-Data-Vault MUST NOT Invoke:

| System | Reason |
|--------|--------|
| Model execution paths | Data-Vault operates BEFORE execution |
| Inference routing logic | That is LLM-Inference-Gateway's role |
| Enforcement layers beyond access control | Out of scope |
| Optimization agents | No optimization logic |
| Analytics pipelines | No analytics functionality |
| Incident workflows | Not an incident system |

## DecisionEvent Flow

```
1. Request arrives at Data-Vault
                │
                ▼
2. Agent processes request
   - Access Control: evaluate policies
   - Anonymization: detect & transform PII
                │
                ▼
3. DecisionEvent created
   {
     agent_id: "data-vault.xxx.v1",
     decision_type: "dataset_anonymization",
     inputs_hash: "sha256...",
     outputs: {...},
     confidence: {...},
     constraints_applied: [...],
     execution_ref: "uuid",
     timestamp: "ISO8601"
   }
                │
                ▼
4. DecisionEvent persisted to ruvector-service
   (async, non-blocking)
                │
                ▼
5. Response returned to caller
                │
                ▼
6. Governance systems consume events
   (from ruvector-service)
```

## API Contracts

### Request Dataset Access (from Orchestrator)
```json
POST /authorize
{
  "subject": {
    "subject_id": "ml-pipeline-001",
    "subject_type": "service",
    "roles": ["ml-engineer"],
    "tenant_id": "tenant-001"
  },
  "resource": {
    "resource_id": "training-data-v2",
    "resource_type": "dataset",
    "tenant_id": "tenant-001"
  },
  "action": "read",
  "context": {
    "request_id": "uuid",
    "timestamp": "ISO8601"
  }
}
```

### Request Anonymized Data (from Inference Gateway)
```json
POST /anonymize
{
  "dataset_id": "user-profiles",
  "content": [...],
  "policy_id": "gdpr-compliance",
  "tenant_id": "tenant-001",
  "requester": {
    "service": "inference-gateway"
  }
}
```

### Consume DecisionEvents (Governance)
```sql
-- Query via ruvector-service API, NOT direct SQL
GET /api/v1/decision-events?
  tenant_id=tenant-001&
  agent_id=data-vault.anonymization.v1&
  from=2024-01-01T00:00:00Z&
  limit=100
```

## No Core Rewiring Required

The following Core bundles consume Data-Vault outputs **as-is**:

| Bundle | Integration Point | Status |
|--------|-------------------|--------|
| llm-orchestrator | `/authorize`, `/anonymize` | Ready |
| llm-inference-gateway | `/anonymize` | Ready |
| llm-policy-engine | Policy provider | Ready |
| governance-core | DecisionEvent consumer | Ready |
| audit-core | DecisionEvent consumer | Ready |
| compliance-core | Attestation consumer | Ready |

**No modifications to Core bundles are required for Data-Vault deployment.**
