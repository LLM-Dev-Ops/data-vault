# LLM-Data-Vault Service Topology

## Unified Service Definition

| Property | Value |
|----------|-------|
| **Service Name** | `llm-data-vault` |
| **Service Type** | Google Cloud Run (Gen2) |
| **Runtime** | Node.js 20 |
| **Region** | us-central1 |
| **Invocation** | Internal + Authenticated |

## Agent Endpoints

All agents are exposed via ONE unified service. No agent is deployed standalone.

### 1. Data Access Control Agent

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/authorize` | POST | Authorize dataset access request |
| `/authorize/batch` | POST | Batch authorization requests |
| `/policies` | GET | List available access policies |
| `/policies/{id}` | GET | Get specific policy |

### 2. Dataset Anonymization Agent

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/anonymize` | POST | Apply anonymization to dataset |
| `/anonymize/batch` | POST | Batch anonymization |
| `/inspect` | POST | Inspect for PII (dry-run) |
| `/strategies` | GET | List anonymization strategies |

### 3. Shared Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health check |
| `/ready` | GET | Readiness probe |
| `/metadata` | GET | Service metadata & capabilities |
| `/metrics` | GET | Prometheus metrics |

## Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    llm-data-vault                           │
│                  (Unified Cloud Run Service)                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────┐        │
│  │  Data Access        │    │  Dataset            │        │
│  │  Control Agent      │    │  Anonymization Agent│        │
│  │  (/authorize)       │    │  (/anonymize)       │        │
│  └─────────────────────┘    └─────────────────────┘        │
│              │                        │                     │
│              └────────────┬───────────┘                     │
│                           │                                 │
│              ┌────────────▼───────────┐                     │
│              │   Shared Runtime       │                     │
│              │   - Telemetry          │                     │
│              │   - Configuration      │                     │
│              │   - RuVector Client    │                     │
│              │   - Contract Validation│                     │
│              └────────────────────────┘                     │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │    ruvector-service     │
              │    (Persistence Layer)  │
              │    Google SQL (Postgres)│
              └─────────────────────────┘
```

## Confirmations

- [x] No agent deployed as standalone service
- [x] Shared runtime for all agents
- [x] Shared configuration stack
- [x] Shared telemetry stack
- [x] Single service entry point
- [x] All persistence via ruvector-service
- [x] No direct database connections
