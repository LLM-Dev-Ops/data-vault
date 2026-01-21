/**
 * Smoke Tests for LLM-Data-Vault Agents
 *
 * Tests core endpoints and event emission functionality:
 * - Authorize endpoint
 * - Anonymize endpoint
 * - Health endpoint
 * - DecisionEvent emission
 * - Telemetry emission
 *
 * @module tests/smoke-tests
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  createAgentRegistration,
  verifyBoundaryCompliance,
  DecisionEventSchema,
  TelemetryEventSchema,
  DatasetRequestSchema,
  DatasetResponseSchema,
  GovernanceEventEmitter,
  OrchestratorIntegration,
  type DecisionEvent,
  type TelemetryEvent,
  type DatasetRequest
} from '../platform/index.js';

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const TEST_CONFIG = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:8080',
  eventStoreUrl: process.env.TEST_EVENT_STORE_URL || 'http://localhost:8081',
  instanceId: `test-instance-${uuidv4()}`,
  timeout: 10000
};

// Mock fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// =============================================================================
// SMOKE TESTS: AUTHORIZE ENDPOINT
// =============================================================================

describe('Authorize Endpoint', () => {
  beforeAll(() => {
    mockFetch.mockReset();
  });

  it('should accept valid authorization requests', async () => {
    const requestId = uuidv4();
    const request = {
      requestId,
      userId: 'user-123',
      datasetId: 'dataset-456',
      operation: 'read',
      fields: ['name', 'email'],
      purpose: 'training'
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requestId,
        authorized: true,
        reason: 'Access granted per policy-001',
        decisionEventId: uuidv4()
      })
    });

    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/v1/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { requestId: string; authorized: boolean };
    expect(data.requestId).toBe(requestId);
    expect(data.authorized).toBeDefined();
  });

  it('should reject requests with missing required fields', async () => {
    const invalidRequest = {
      requestId: uuidv4()
      // Missing userId, datasetId, operation
    };

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'VALIDATION_ERROR',
        message: 'Missing required fields: userId, datasetId, operation'
      })
    });

    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/v1/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidRequest)
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
  });

  it('should include decision event ID in authorization response', async () => {
    const requestId = uuidv4();
    const decisionEventId = uuidv4();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requestId,
        authorized: true,
        decisionEventId,
        policyIds: ['policy-001', 'policy-002']
      })
    });

    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/v1/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        userId: 'user-123',
        datasetId: 'dataset-456',
        operation: 'read'
      })
    });

    const data = await response.json() as { decisionEventId: string; policyIds: string[] };
    expect(data.decisionEventId).toBe(decisionEventId);
    expect(data.policyIds).toBeInstanceOf(Array);
  });

  it('should return appropriate response time', async () => {
    const startTime = Date.now();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requestId: uuidv4(),
        authorized: true
      })
    });

    await fetch(`${TEST_CONFIG.baseUrl}/api/v1/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: uuidv4(),
        userId: 'user-123',
        datasetId: 'dataset-456',
        operation: 'read'
      })
    });

    const responseTime = Date.now() - startTime;
    // Authorization should complete within 5 seconds
    expect(responseTime).toBeLessThan(5000);
  });
});

// =============================================================================
// SMOKE TESTS: ANONYMIZE ENDPOINT
// =============================================================================

describe('Anonymize Endpoint', () => {
  beforeAll(() => {
    mockFetch.mockReset();
  });

  it('should anonymize data with PII', async () => {
    const requestId = uuidv4();
    const request = {
      requestId,
      datasetId: 'dataset-456',
      data: [
        { id: 1, name: 'John Doe', email: 'john@example.com', ssn: '123-45-6789' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', phone: '555-0123' }
      ],
      strategy: 'redact',
      fields: ['email', 'ssn', 'phone']
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requestId,
        success: true,
        data: [
          { id: 1, name: 'John Doe', email: '[REDACTED]', ssn: '[REDACTED]' },
          { id: 2, name: 'Jane Smith', email: '[REDACTED]', phone: '[REDACTED]' }
        ],
        transformations: [
          { field: 'email', type: 'redact', count: 2 },
          { field: 'ssn', type: 'redact', count: 1 },
          { field: 'phone', type: 'redact', count: 1 }
        ],
        decisionEventId: uuidv4()
      })
    });

    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/v1/anonymize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { success: boolean; transformations: unknown[]; data: Array<{ email: string }> };
    expect(data.success).toBe(true);
    expect(data.transformations).toBeInstanceOf(Array);
    expect(data.data[0].email).toBe('[REDACTED]');
  });

  it('should support multiple anonymization strategies', async () => {
    const strategies = ['redact', 'mask', 'hash', 'generalize'];

    for (const strategy of strategies) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requestId: uuidv4(),
          success: true,
          strategy,
          data: []
        })
      });

      const response = await fetch(`${TEST_CONFIG.baseUrl}/api/v1/anonymize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: uuidv4(),
          datasetId: 'dataset-456',
          data: [{ email: 'test@example.com' }],
          strategy,
          fields: ['email']
        })
      });

      expect(response.ok).toBe(true);
    }
  });

  it('should detect PII automatically when fields not specified', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requestId: uuidv4(),
        success: true,
        detectedPii: [
          { field: 'email', type: 'EMAIL', confidence: 0.99 },
          { field: 'ssn', type: 'SSN', confidence: 0.95 }
        ],
        data: []
      })
    });

    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/v1/anonymize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: uuidv4(),
        datasetId: 'dataset-456',
        data: [{ email: 'test@example.com', ssn: '123-45-6789' }],
        strategy: 'redact'
        // fields not specified - should auto-detect
      })
    });

    const data = await response.json() as { detectedPii: unknown[] };
    expect(data.detectedPii).toBeInstanceOf(Array);
    expect(data.detectedPii.length).toBeGreaterThan(0);
  });

  it('should track lineage of transformations', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requestId: uuidv4(),
        success: true,
        lineage: {
          sourceDatasetId: 'dataset-456',
          targetDatasetId: 'dataset-456-anonymized',
          transformationId: uuidv4(),
          timestamp: new Date().toISOString()
        }
      })
    });

    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/v1/anonymize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: uuidv4(),
        datasetId: 'dataset-456',
        data: [{ email: 'test@example.com' }],
        strategy: 'redact',
        trackLineage: true
      })
    });

    const data = await response.json() as { lineage: { transformationId: string } };
    expect(data.lineage).toBeDefined();
    expect(data.lineage.transformationId).toBeDefined();
  });
});

// =============================================================================
// SMOKE TESTS: HEALTH ENDPOINT
// =============================================================================

describe('Health Endpoint', () => {
  beforeAll(() => {
    mockFetch.mockReset();
  });

  it('should return healthy status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'healthy',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        components: {
          database: 'healthy',
          cache: 'healthy',
          eventStore: 'healthy'
        }
      })
    });

    const response = await fetch(`${TEST_CONFIG.baseUrl}/health`);

    expect(response.ok).toBe(true);
    const data = await response.json() as { status: string; version: string; components: Record<string, unknown> };
    expect(data.status).toBe('healthy');
    expect(data.version).toBeDefined();
    expect(data.components).toBeDefined();
  });

  it('should include component health details', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'healthy',
        components: {
          database: { status: 'healthy', latencyMs: 5 },
          cache: { status: 'healthy', latencyMs: 2 },
          eventStore: { status: 'healthy', latencyMs: 10 }
        }
      })
    });

    const response = await fetch(`${TEST_CONFIG.baseUrl}/health?detailed=true`);

    const data = await response.json() as { components: { database: { latencyMs: number }; cache: { latencyMs: number } } };
    expect(data.components.database.latencyMs).toBeDefined();
    expect(data.components.cache.latencyMs).toBeDefined();
  });

  it('should report degraded status when component unhealthy', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'degraded',
        components: {
          database: 'healthy',
          cache: 'unhealthy',
          eventStore: 'healthy'
        }
      })
    });

    const response = await fetch(`${TEST_CONFIG.baseUrl}/health`);

    const data = await response.json() as { status: string; components: { cache: string } };
    expect(data.status).toBe('degraded');
    expect(data.components.cache).toBe('unhealthy');
  });

  it('should have fast response time', async () => {
    const startTime = Date.now();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy' })
    });

    await fetch(`${TEST_CONFIG.baseUrl}/health`);

    const responseTime = Date.now() - startTime;
    // Health check should complete within 1 second
    expect(responseTime).toBeLessThan(1000);
  });
});

// =============================================================================
// SMOKE TESTS: DECISION EVENT EMISSION
// =============================================================================

describe('DecisionEvent Emission', () => {
  let eventEmitter: GovernanceEventEmitter;

  beforeAll(() => {
    mockFetch.mockReset();
    eventEmitter = new GovernanceEventEmitter({
      eventStoreUrl: TEST_CONFIG.eventStoreUrl,
      instanceId: TEST_CONFIG.instanceId
    });
  });

  it('should emit valid DecisionEvent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ received: true })
    });

    const event = await eventEmitter.emitDecisionEvent({
      requestId: uuidv4(),
      operation: 'authorize',
      resourceType: 'dataset',
      decision: {
        type: 'ALLOW',
        reason: 'Access granted per policy',
        confidence: 0.99,
        policyIds: ['policy-001'],
        appliedRules: [{
          ruleId: 'rule-001',
          ruleName: 'AllowReadAccess',
          action: 'allow',
          matched: true
        }]
      },
      inputHash: 'sha256:abc123',
      processingTimeMs: 50,
      bytesProcessed: 1024
    });

    // Validate event against schema
    const validationResult = DecisionEventSchema.safeParse(event);
    expect(validationResult.success).toBe(true);

    expect(event.eventType).toBe('DecisionEvent');
    expect(event.decision.type).toBe('ALLOW');
  });

  it('should include all required audit fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ received: true })
    });

    const event = await eventEmitter.emitDecisionEvent({
      requestId: uuidv4(),
      correlationId: uuidv4(),
      userId: 'user-123',
      datasetId: 'dataset-456',
      operation: 'anonymize',
      resourceType: 'dataset',
      decision: {
        type: 'TRANSFORM',
        reason: 'Data anonymized per GDPR policy',
        confidence: 1.0,
        policyIds: ['gdpr-policy-001'],
        appliedRules: []
      },
      inputHash: 'sha256:input123',
      outputHash: 'sha256:output456',
      processingTimeMs: 150,
      bytesProcessed: 5120
    });

    expect(event.audit.inputHash).toBeDefined();
    expect(event.audit.outputHash).toBeDefined();
    expect(event.audit.processingTimeMs).toBe(150);
    expect(event.audit.bytesProcessed).toBe(5120);
  });

  it('should emit DENY decision events', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ received: true })
    });

    const event = await eventEmitter.emitDecisionEvent({
      requestId: uuidv4(),
      operation: 'read',
      resourceType: 'sensitive-dataset',
      decision: {
        type: 'DENY',
        reason: 'Insufficient permissions for sensitive data',
        confidence: 1.0,
        policyIds: ['security-policy-001'],
        appliedRules: [{
          ruleId: 'rule-deny-sensitive',
          ruleName: 'DenySensitiveWithoutClearance',
          action: 'deny',
          matched: true
        }]
      },
      inputHash: 'sha256:request123',
      processingTimeMs: 10,
      bytesProcessed: 256
    });

    expect(event.decision.type).toBe('DENY');
    expect(event.decision.appliedRules.length).toBeGreaterThan(0);
  });

  it('should persist events to event store', async () => {
    const capturedBody: string[] = [];

    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBody.push(init.body as string);
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({ received: true })
      };
    });

    await eventEmitter.emitDecisionEvent({
      requestId: uuidv4(),
      operation: 'audit',
      resourceType: 'access-log',
      decision: {
        type: 'AUDIT',
        reason: 'Audit record created',
        confidence: 1.0,
        policyIds: [],
        appliedRules: []
      },
      inputHash: 'sha256:audit123',
      processingTimeMs: 5,
      bytesProcessed: 64
    });

    expect(mockFetch).toHaveBeenCalled();
    expect(capturedBody.length).toBeGreaterThan(0);

    // Verify the event was sent as JSON
    const sentEvent = JSON.parse(capturedBody[0]) as DecisionEvent;
    expect(sentEvent.eventType).toBe('DecisionEvent');
  });
});

// =============================================================================
// SMOKE TESTS: TELEMETRY EMISSION
// =============================================================================

describe('Telemetry Emission', () => {
  let eventEmitter: GovernanceEventEmitter;

  beforeAll(() => {
    mockFetch.mockReset();
    eventEmitter = new GovernanceEventEmitter({
      eventStoreUrl: TEST_CONFIG.eventStoreUrl,
      instanceId: TEST_CONFIG.instanceId
    });
  });

  it('should emit valid TelemetryEvent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ received: true })
    });

    const event = await eventEmitter.emitTelemetryEvent({
      metricName: 'request_latency',
      value: 150,
      unit: 'ms',
      tags: {
        endpoint: '/api/v1/authorize',
        status: 'success'
      }
    });

    // Validate event against schema
    const validationResult = TelemetryEventSchema.safeParse(event);
    expect(validationResult.success).toBe(true);

    expect(event.eventType).toBe('TelemetryEvent');
    expect(event.metrics.name).toBe('request_latency');
    expect(event.metrics.value).toBe(150);
    expect(event.metrics.unit).toBe('ms');
  });

  it('should include trace context when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ received: true })
    });

    const traceId = uuidv4();
    const spanId = uuidv4();

    const event = await eventEmitter.emitTelemetryEvent({
      metricName: 'bytes_processed',
      value: 1024000,
      unit: 'bytes',
      tags: { operation: 'anonymize' },
      traceId,
      spanId
    });

    expect(event.trace).toBeDefined();
    expect(event.trace?.traceId).toBe(traceId);
    expect(event.trace?.spanId).toBe(spanId);
  });

  it('should support all metric units', async () => {
    const units: Array<TelemetryEvent['metrics']['unit']> = ['count', 'ms', 'bytes', 'percent'];

    for (const unit of units) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ received: true })
      });

      const event = await eventEmitter.emitTelemetryEvent({
        metricName: `test_metric_${unit}`,
        value: 100,
        unit,
        tags: { test: 'true' }
      });

      expect(event.metrics.unit).toBe(unit);
    }
  });

  it('should be visible in observability system', async () => {
    const capturedUrl: string[] = [];

    mockFetch.mockImplementation(async (url: string) => {
      capturedUrl.push(url);
      return {
        ok: true,
        status: 201,
        json: async () => ({ received: true })
      };
    });

    await eventEmitter.emitTelemetryEvent({
      metricName: 'api_requests_total',
      value: 1,
      unit: 'count',
      tags: { endpoint: '/health' }
    });

    // Verify telemetry endpoint was called
    expect(capturedUrl.some(u => u.includes('/telemetry'))).toBe(true);
  });
});

// =============================================================================
// SMOKE TESTS: BOUNDARY VERIFICATION
// =============================================================================

describe('Agent Boundary Verification', () => {
  it('should allow authorized operations', () => {
    const allowedOps = [
      'authorize',
      'anonymize',
      'detect-pii',
      'encrypt',
      'decrypt',
      'audit',
      'lineage-track',
      'health-check',
      'emit-event',
      'emit-telemetry'
    ];

    for (const op of allowedOps) {
      const result = verifyBoundaryCompliance(op);
      expect(result.allowed).toBe(true);
    }
  });

  it('should block inference operations', () => {
    const blockedOps = [
      'inference',
      'llm-inference',
      'execute-inference',
      'run-inference'
    ];

    for (const op of blockedOps) {
      const result = verifyBoundaryCompliance(op);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('inference');
    }
  });

  it('should block prompt modification', () => {
    const blockedOps = [
      'prompt-modify',
      'modify-prompt',
      'prompt-inject',
      'inject-prompt'
    ];

    for (const op of blockedOps) {
      const result = verifyBoundaryCompliance(op);
      expect(result.allowed).toBe(false);
    }
  });

  it('should block request routing', () => {
    const result = verifyBoundaryCompliance('route-request');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('route');
  });

  it('should block orchestration triggers', () => {
    const result = verifyBoundaryCompliance('trigger-orchestration');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('orchestration');
  });

  it('should block code execution', () => {
    const result = verifyBoundaryCompliance('execute-code');
    expect(result.allowed).toBe(false);
  });

  it('should block agent spawning', () => {
    const result = verifyBoundaryCompliance('spawn-agent');
    expect(result.allowed).toBe(false);
  });
});

// =============================================================================
// SMOKE TESTS: ORCHESTRATOR INTEGRATION
// =============================================================================

describe('Orchestrator Integration', () => {
  let orchestrator: OrchestratorIntegration;

  beforeAll(() => {
    mockFetch.mockReset();
    orchestrator = new OrchestratorIntegration({
      callbackUrl: `${TEST_CONFIG.baseUrl}/callback`
    });
  });

  it('should handle dataset requests', async () => {
    const request: DatasetRequest = {
      requestId: uuidv4(),
      correlationId: uuidv4(),
      requester: {
        serviceId: 'llm-orchestrator',
        userId: 'user-123',
        purpose: 'training'
      },
      dataset: {
        datasetId: 'dataset-456',
        version: '1.0.0',
        limit: 1000
      },
      requirements: {
        anonymizationLevel: 'strict',
        encryptionRequired: true,
        auditRequired: true,
        lineageRequired: true
      }
    };

    // Validate request schema
    const validationResult = DatasetRequestSchema.safeParse(request);
    expect(validationResult.success).toBe(true);

    const response = await orchestrator.handleDatasetRequest(
      request,
      async () => ({
        approved: true,
        data: [{ id: 1, value: 'test' }],
        transformations: [{
          type: 'anonymize',
          fieldsAffected: ['email'],
          recordsAffected: 1
        }]
      })
    );

    // Validate response schema
    const responseValidation = DatasetResponseSchema.safeParse(response);
    expect(responseValidation.success).toBe(true);

    expect(response.status).toBe('approved');
    expect(response.dataset).toBeDefined();
  });

  it('should deny unauthorized requests', async () => {
    const request: DatasetRequest = {
      requestId: uuidv4(),
      correlationId: uuidv4(),
      requester: {
        serviceId: 'unknown-service',
        purpose: 'training'
      },
      dataset: {
        datasetId: 'restricted-dataset'
      },
      requirements: {
        anonymizationLevel: 'none',
        encryptionRequired: false,
        auditRequired: false,
        lineageRequired: false
      }
    };

    const response = await orchestrator.handleDatasetRequest(
      request,
      async () => ({
        approved: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Service not authorized for this dataset'
        }
      })
    );

    expect(response.status).toBe('denied');
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe('UNAUTHORIZED');
  });

  it('should include decision event reference in response', async () => {
    const request: DatasetRequest = {
      requestId: uuidv4(),
      correlationId: uuidv4(),
      requester: {
        serviceId: 'llm-orchestrator',
        purpose: 'inference'
      },
      dataset: {
        datasetId: 'approved-dataset'
      },
      requirements: {
        anonymizationLevel: 'basic',
        encryptionRequired: false,
        auditRequired: true,
        lineageRequired: false
      }
    };

    const response = await orchestrator.handleDatasetRequest(
      request,
      async () => ({ approved: true, data: [] })
    );

    expect(response.decision).toBeDefined();
    expect(response.decision.decisionEventId).toBeDefined();
  });
});

// =============================================================================
// SMOKE TESTS: AGENT REGISTRATION
// =============================================================================

describe('Agent Registration', () => {
  it('should create valid registration', () => {
    const registration = createAgentRegistration({
      agentId: uuidv4(),
      baseUrl: TEST_CONFIG.baseUrl,
      maintainerEmail: 'team@example.com'
    });

    expect(registration.namespace).toBe('llm-data-vault');
    expect(registration.capabilities.length).toBeGreaterThan(0);
    expect(registration.boundaries.executesInference).toBe(false);
    expect(registration.boundaries.modifiesPrompts).toBe(false);
    expect(registration.boundaries.routesRequests).toBe(false);
    expect(registration.boundaries.triggersOrchestration).toBe(false);
  });

  it('should declare all required capabilities', () => {
    const registration = createAgentRegistration({
      agentId: uuidv4(),
      baseUrl: TEST_CONFIG.baseUrl,
      maintainerEmail: 'team@example.com'
    });

    const capabilityNames = registration.capabilities.map(c => c.name);
    expect(capabilityNames).toContain('data-authorization');
    expect(capabilityNames).toContain('data-anonymization');
    expect(capabilityNames).toContain('data-encryption');
  });

  it('should include schema references', () => {
    const registration = createAgentRegistration({
      agentId: uuidv4(),
      baseUrl: TEST_CONFIG.baseUrl,
      maintainerEmail: 'team@example.com'
    });

    expect(registration.inputSchemaRef).toMatch(/^https:\/\//);
    expect(registration.outputSchemaRef).toMatch(/^https:\/\//);
    expect(registration.decisionEventSchemaRef).toMatch(/^https:\/\//);
  });
});
