/**
 * Platform Integration Hooks for LLM-Data-Vault Agents
 *
 * Provides integration with the LLM-Dev-Ops ecosystem:
 * - LLM-Policy-Engine: Receives and applies data access policies
 * - LLM-Orchestrator: Handles dataset requests
 * - LLM-Inference-Gateway: Provides approved/anonymized datasets
 * - Governance: Consumes and emits DecisionEvents
 *
 * @module platform/integration
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import {
  verifyBoundaryCompliance,
  AGENT_VERSION
} from './registration.js';

// =============================================================================
// LOGGER CONFIGURATION
// =============================================================================

const logger = pino({
  name: 'llm-data-vault-integration',
  level: process.env.LOG_LEVEL || 'info'
});

// =============================================================================
// DECISION EVENT SCHEMA
// =============================================================================

/**
 * DecisionEvent schema - standard governance event format
 */
export const DecisionEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal('DecisionEvent'),
  version: z.string(),
  timestamp: z.string().datetime(),
  source: z.object({
    agentId: z.string(),
    agentName: z.string(),
    agentVersion: z.string()
  }),
  decision: z.object({
    type: z.enum(['ALLOW', 'DENY', 'TRANSFORM', 'AUDIT']),
    reason: z.string(),
    confidence: z.number().min(0).max(1),
    policyIds: z.array(z.string()),
    appliedRules: z.array(z.object({
      ruleId: z.string(),
      ruleName: z.string(),
      action: z.string(),
      matched: z.boolean()
    }))
  }),
  context: z.object({
    requestId: z.string().uuid(),
    correlationId: z.string().uuid().optional(),
    userId: z.string().optional(),
    datasetId: z.string().optional(),
    operation: z.string(),
    resourceType: z.string()
  }),
  audit: z.object({
    inputHash: z.string(),
    outputHash: z.string().optional(),
    processingTimeMs: z.number(),
    bytesProcessed: z.number()
  }),
  metadata: z.record(z.unknown()).optional()
});

export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

// =============================================================================
// TELEMETRY EVENT SCHEMA
// =============================================================================

/**
 * TelemetryEvent schema - observability event format
 */
export const TelemetryEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal('TelemetryEvent'),
  version: z.string(),
  timestamp: z.string().datetime(),
  source: z.object({
    service: z.string(),
    instance: z.string(),
    version: z.string()
  }),
  metrics: z.object({
    name: z.string(),
    value: z.number(),
    unit: z.enum(['count', 'ms', 'bytes', 'percent']),
    tags: z.record(z.string())
  }),
  trace: z.object({
    traceId: z.string(),
    spanId: z.string(),
    parentSpanId: z.string().optional()
  }).optional()
});

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// =============================================================================
// POLICY ENGINE INTEGRATION
// =============================================================================

/**
 * Policy received from LLM-Policy-Engine
 */
export const PolicySchema = z.object({
  policyId: z.string().uuid(),
  name: z.string(),
  version: z.string(),
  rules: z.array(z.object({
    ruleId: z.string(),
    condition: z.object({
      field: z.string(),
      operator: z.enum(['eq', 'neq', 'contains', 'regex', 'gt', 'lt', 'in']),
      value: z.unknown()
    }),
    action: z.enum(['allow', 'deny', 'transform', 'audit']),
    transformations: z.array(z.object({
      type: z.enum(['redact', 'mask', 'hash', 'encrypt', 'generalize']),
      field: z.string(),
      config: z.record(z.unknown()).optional()
    })).optional()
  })),
  scope: z.object({
    datasets: z.array(z.string()).optional(),
    users: z.array(z.string()).optional(),
    operations: z.array(z.string()).optional()
  }),
  effectiveFrom: z.string().datetime(),
  effectiveUntil: z.string().datetime().optional(),
  priority: z.number().int().min(0).max(1000)
});

export type Policy = z.infer<typeof PolicySchema>;

/**
 * Policy Engine integration client
 */
export class PolicyEngineIntegration {
  private readonly baseUrl: string;
  private policies: Map<string, Policy> = new Map();

  constructor(config: { baseUrl: string }) {
    this.baseUrl = config.baseUrl;
    logger.info({ baseUrl: config.baseUrl }, 'PolicyEngineIntegration initialized');
  }

  /**
   * Fetches policies from LLM-Policy-Engine
   * This agent RECEIVES policies - it does NOT create them
   */
  async fetchPolicies(scope?: {
    datasetId?: string;
    operation?: string;
  }): Promise<Policy[]> {
    // Verify boundary compliance
    const compliance = verifyBoundaryCompliance('fetch-policy');
    if (!compliance.allowed) {
      throw new Error(compliance.reason);
    }

    logger.info({ scope }, 'Fetching policies from Policy Engine');

    try {
      const queryParams = new URLSearchParams();
      if (scope?.datasetId) queryParams.set('datasetId', scope.datasetId);
      if (scope?.operation) queryParams.set('operation', scope.operation);

      const response = await fetch(
        `${this.baseUrl}/api/v1/policies?${queryParams}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'llm-data-vault',
            'X-Agent-Version': AGENT_VERSION
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Policy fetch failed: ${response.status}`);
      }

      const data = await response.json() as unknown[];
      const policies = data.map(p => PolicySchema.parse(p));

      // Cache policies
      for (const policy of policies) {
        this.policies.set(policy.policyId, policy);
      }

      logger.info({ count: policies.length }, 'Policies fetched successfully');
      return policies;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch policies');
      throw error;
    }
  }

  /**
   * Subscribes to policy update events
   */
  async subscribeToPolicyUpdates(
    callback: (policy: Policy) => void
  ): Promise<{ unsubscribe: () => void }> {
    logger.info('Subscribing to policy updates');

    // In production, this would use WebSocket or SSE
    // For now, we poll periodically
    const pollInterval = setInterval(async () => {
      try {
        const policies = await this.fetchPolicies();
        for (const policy of policies) {
          const existing = this.policies.get(policy.policyId);
          if (!existing || existing.version !== policy.version) {
            callback(policy);
          }
        }
      } catch (error) {
        logger.error({ error }, 'Policy update poll failed');
      }
    }, 30000); // Poll every 30 seconds

    return {
      unsubscribe: () => clearInterval(pollInterval)
    };
  }

  /**
   * Gets a cached policy by ID
   */
  getPolicy(policyId: string): Policy | undefined {
    return this.policies.get(policyId);
  }
}

// =============================================================================
// ORCHESTRATOR INTEGRATION
// =============================================================================

/**
 * Dataset request from LLM-Orchestrator
 */
export const DatasetRequestSchema = z.object({
  requestId: z.string().uuid(),
  correlationId: z.string().uuid(),
  requester: z.object({
    serviceId: z.string(),
    userId: z.string().optional(),
    purpose: z.enum(['training', 'inference', 'evaluation', 'analysis'])
  }),
  dataset: z.object({
    datasetId: z.string(),
    version: z.string().optional(),
    filters: z.record(z.unknown()).optional(),
    fields: z.array(z.string()).optional(),
    limit: z.number().int().positive().optional()
  }),
  requirements: z.object({
    anonymizationLevel: z.enum(['none', 'basic', 'strict', 'full']),
    encryptionRequired: z.boolean(),
    auditRequired: z.boolean(),
    lineageRequired: z.boolean()
  }),
  deadline: z.string().datetime().optional()
});

export type DatasetRequest = z.infer<typeof DatasetRequestSchema>;

/**
 * Dataset response to LLM-Orchestrator
 */
export const DatasetResponseSchema = z.object({
  requestId: z.string().uuid(),
  correlationId: z.string().uuid(),
  status: z.enum(['approved', 'denied', 'partial', 'pending']),
  dataset: z.object({
    datasetId: z.string(),
    version: z.string(),
    recordCount: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative(),
    checksum: z.string(),
    location: z.string().url().optional(),
    expiresAt: z.string().datetime().optional()
  }).optional(),
  transformations: z.array(z.object({
    type: z.string(),
    fieldsAffected: z.array(z.string()),
    recordsAffected: z.number().int().nonnegative()
  })).optional(),
  decision: z.object({
    decisionEventId: z.string().uuid(),
    policyIds: z.array(z.string()),
    reason: z.string()
  }),
  error: z.object({
    code: z.string(),
    message: z.string()
  }).optional()
});

export type DatasetResponse = z.infer<typeof DatasetResponseSchema>;

/**
 * Orchestrator integration client
 */
export class OrchestratorIntegration {
  private readonly callbackUrl: string;

  constructor(config: { callbackUrl: string }) {
    this.callbackUrl = config.callbackUrl;
    logger.info({ callbackUrl: config.callbackUrl }, 'OrchestratorIntegration initialized');
  }

  /**
   * Handles a dataset request from the orchestrator
   * This agent processes the request - it does NOT orchestrate workflows
   */
  async handleDatasetRequest(
    request: DatasetRequest,
    processCallback: (req: DatasetRequest) => Promise<{
      approved: boolean;
      data?: unknown;
      transformations?: DatasetResponse['transformations'];
      error?: { code: string; message: string };
    }>
  ): Promise<DatasetResponse> {
    // Verify boundary compliance
    const compliance = verifyBoundaryCompliance('handle-dataset-request');
    if (!compliance.allowed) {
      throw new Error(compliance.reason);
    }

    const startTime = Date.now();
    logger.info({
      requestId: request.requestId,
      datasetId: request.dataset.datasetId
    }, 'Processing dataset request from orchestrator');

    try {
      // Validate request
      DatasetRequestSchema.parse(request);

      // Process the request (authorization, anonymization, etc.)
      const result = await processCallback(request);

      const response: DatasetResponse = {
        requestId: request.requestId,
        correlationId: request.correlationId,
        status: result.approved ? 'approved' : 'denied',
        decision: {
          decisionEventId: uuidv4(),
          policyIds: [], // Populated by policy evaluation
          reason: result.approved
            ? 'Request authorized per data access policies'
            : result.error?.message || 'Request denied'
        }
      };

      if (result.approved && result.data) {
        const dataStr = JSON.stringify(result.data);
        response.dataset = {
          datasetId: request.dataset.datasetId,
          version: request.dataset.version || '1.0.0',
          recordCount: Array.isArray(result.data) ? result.data.length : 1,
          sizeBytes: Buffer.byteLength(dataStr, 'utf8'),
          checksum: await this.computeChecksum(dataStr)
        };
        response.transformations = result.transformations;
      }

      if (result.error) {
        response.status = 'denied';
        response.error = result.error;
      }

      logger.info({
        requestId: request.requestId,
        status: response.status,
        processingTimeMs: Date.now() - startTime
      }, 'Dataset request processed');

      return response;
    } catch (error) {
      logger.error({ error, requestId: request.requestId }, 'Dataset request processing failed');

      return {
        requestId: request.requestId,
        correlationId: request.correlationId,
        status: 'denied',
        decision: {
          decisionEventId: uuidv4(),
          policyIds: [],
          reason: 'Internal processing error'
        },
        error: {
          code: 'PROCESSING_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Sends response back to orchestrator
   */
  async sendResponse(response: DatasetResponse): Promise<void> {
    logger.info({
      requestId: response.requestId,
      status: response.status
    }, 'Sending response to orchestrator');

    try {
      const httpResponse = await fetch(this.callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Id': 'llm-data-vault',
          'X-Agent-Version': AGENT_VERSION
        },
        body: JSON.stringify(response)
      });

      if (!httpResponse.ok) {
        throw new Error(`Callback failed: ${httpResponse.status}`);
      }

      logger.info({ requestId: response.requestId }, 'Response sent successfully');
    } catch (error) {
      logger.error({ error, requestId: response.requestId }, 'Failed to send response');
      throw error;
    }
  }

  private async computeChecksum(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// =============================================================================
// INFERENCE GATEWAY INTEGRATION
// =============================================================================

/**
 * Approved dataset for LLM-Inference-Gateway
 */
export const ApprovedDatasetSchema = z.object({
  datasetId: z.string(),
  version: z.string(),
  approvalId: z.string().uuid(),
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  accessToken: z.string(),
  constraints: z.object({
    maxRecords: z.number().int().positive().optional(),
    allowedFields: z.array(z.string()).optional(),
    rateLimit: z.object({
      requestsPerMinute: z.number().int().positive(),
      bytesPerMinute: z.number().int().positive()
    }).optional()
  }),
  endpoint: z.string().url()
});

export type ApprovedDataset = z.infer<typeof ApprovedDatasetSchema>;

/**
 * Inference Gateway integration client
 */
export class InferenceGatewayIntegration {
  private readonly gatewayUrl: string;
  private approvedDatasets: Map<string, ApprovedDataset> = new Map();

  constructor(config: { gatewayUrl: string }) {
    this.gatewayUrl = config.gatewayUrl;
    logger.info({ gatewayUrl: config.gatewayUrl }, 'InferenceGatewayIntegration initialized');
  }

  /**
   * Registers an approved dataset with the inference gateway
   * This makes anonymized data available for inference
   */
  async registerApprovedDataset(
    approval: {
      datasetId: string;
      version: string;
      approvalId: string;
      validityMinutes: number;
      constraints?: ApprovedDataset['constraints'];
    }
  ): Promise<ApprovedDataset> {
    // Verify boundary compliance
    const compliance = verifyBoundaryCompliance('register-approved-dataset');
    if (!compliance.allowed) {
      throw new Error(compliance.reason);
    }

    logger.info({
      datasetId: approval.datasetId,
      approvalId: approval.approvalId
    }, 'Registering approved dataset with gateway');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + approval.validityMinutes * 60000);

    const approvedDataset: ApprovedDataset = {
      datasetId: approval.datasetId,
      version: approval.version,
      approvalId: approval.approvalId,
      approvedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      accessToken: this.generateAccessToken(approval.datasetId, approval.approvalId),
      constraints: approval.constraints || {},
      endpoint: `${this.gatewayUrl}/api/v1/datasets/${approval.datasetId}`
    };

    try {
      const response = await fetch(
        `${this.gatewayUrl}/api/v1/register-dataset`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'llm-data-vault',
            'X-Agent-Version': AGENT_VERSION
          },
          body: JSON.stringify(approvedDataset)
        }
      );

      if (!response.ok) {
        throw new Error(`Registration failed: ${response.status}`);
      }

      this.approvedDatasets.set(approval.datasetId, approvedDataset);

      logger.info({
        datasetId: approval.datasetId,
        expiresAt: approvedDataset.expiresAt
      }, 'Dataset registered with gateway');

      return approvedDataset;
    } catch (error) {
      logger.error({ error, datasetId: approval.datasetId }, 'Failed to register dataset');
      throw error;
    }
  }

  /**
   * Revokes access to a dataset
   */
  async revokeDatasetAccess(datasetId: string, reason: string): Promise<void> {
    logger.info({ datasetId, reason }, 'Revoking dataset access');

    try {
      const response = await fetch(
        `${this.gatewayUrl}/api/v1/datasets/${datasetId}/revoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': 'llm-data-vault',
            'X-Agent-Version': AGENT_VERSION
          },
          body: JSON.stringify({ reason })
        }
      );

      if (!response.ok) {
        throw new Error(`Revocation failed: ${response.status}`);
      }

      this.approvedDatasets.delete(datasetId);
      logger.info({ datasetId }, 'Dataset access revoked');
    } catch (error) {
      logger.error({ error, datasetId }, 'Failed to revoke dataset access');
      throw error;
    }
  }

  private generateAccessToken(datasetId: string, approvalId: string): string {
    // In production, use proper JWT signing
    const payload = {
      datasetId,
      approvalId,
      iat: Date.now(),
      iss: 'llm-data-vault'
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }
}

// =============================================================================
// GOVERNANCE EVENT HANDLING
// =============================================================================

/**
 * Event emitter for governance events
 */
export class GovernanceEventEmitter {
  private readonly eventStoreUrl: string;
  private readonly instanceId: string;

  constructor(config: { eventStoreUrl: string; instanceId: string }) {
    this.eventStoreUrl = config.eventStoreUrl;
    this.instanceId = config.instanceId;
    logger.info({ eventStoreUrl: config.eventStoreUrl }, 'GovernanceEventEmitter initialized');
  }

  /**
   * Emits a DecisionEvent to the governance event store
   */
  async emitDecisionEvent(params: {
    requestId: string;
    correlationId?: string;
    userId?: string;
    datasetId?: string;
    operation: string;
    resourceType: string;
    decision: DecisionEvent['decision'];
    inputHash: string;
    outputHash?: string;
    processingTimeMs: number;
    bytesProcessed: number;
    metadata?: Record<string, unknown>;
  }): Promise<DecisionEvent> {
    // Verify boundary compliance
    const compliance = verifyBoundaryCompliance('emit-decision-event');
    if (!compliance.allowed) {
      throw new Error(compliance.reason);
    }

    const event: DecisionEvent = {
      eventId: uuidv4(),
      eventType: 'DecisionEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        agentId: this.instanceId,
        agentName: 'llm-data-vault',
        agentVersion: AGENT_VERSION
      },
      decision: params.decision,
      context: {
        requestId: params.requestId,
        correlationId: params.correlationId,
        userId: params.userId,
        datasetId: params.datasetId,
        operation: params.operation,
        resourceType: params.resourceType
      },
      audit: {
        inputHash: params.inputHash,
        outputHash: params.outputHash,
        processingTimeMs: params.processingTimeMs,
        bytesProcessed: params.bytesProcessed
      },
      metadata: params.metadata
    };

    // Validate event schema
    DecisionEventSchema.parse(event);

    logger.info({
      eventId: event.eventId,
      decisionType: event.decision.type,
      requestId: params.requestId
    }, 'Emitting decision event');

    try {
      const response = await fetch(
        `${this.eventStoreUrl}/api/v1/events`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Type': 'DecisionEvent',
            'X-Agent-Id': this.instanceId
          },
          body: JSON.stringify(event)
        }
      );

      if (!response.ok) {
        throw new Error(`Event emission failed: ${response.status}`);
      }

      logger.info({ eventId: event.eventId }, 'Decision event emitted successfully');
      return event;
    } catch (error) {
      logger.error({ error, eventId: event.eventId }, 'Failed to emit decision event');
      throw error;
    }
  }

  /**
   * Emits a TelemetryEvent for observability
   */
  async emitTelemetryEvent(params: {
    metricName: string;
    value: number;
    unit: TelemetryEvent['metrics']['unit'];
    tags: Record<string, string>;
    traceId?: string;
    spanId?: string;
  }): Promise<TelemetryEvent> {
    // Verify boundary compliance
    const compliance = verifyBoundaryCompliance('emit-telemetry');
    if (!compliance.allowed) {
      throw new Error(compliance.reason);
    }

    const event: TelemetryEvent = {
      eventId: uuidv4(),
      eventType: 'TelemetryEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        service: 'llm-data-vault',
        instance: this.instanceId,
        version: AGENT_VERSION
      },
      metrics: {
        name: params.metricName,
        value: params.value,
        unit: params.unit,
        tags: params.tags
      }
    };

    if (params.traceId && params.spanId) {
      event.trace = {
        traceId: params.traceId,
        spanId: params.spanId
      };
    }

    // Validate event schema
    TelemetryEventSchema.parse(event);

    logger.debug({
      eventId: event.eventId,
      metricName: params.metricName,
      value: params.value
    }, 'Emitting telemetry event');

    try {
      const response = await fetch(
        `${this.eventStoreUrl}/api/v1/telemetry`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Type': 'TelemetryEvent',
            'X-Agent-Id': this.instanceId
          },
          body: JSON.stringify(event)
        }
      );

      if (!response.ok) {
        throw new Error(`Telemetry emission failed: ${response.status}`);
      }

      return event;
    } catch (error) {
      logger.error({ error, eventId: event.eventId }, 'Failed to emit telemetry event');
      throw error;
    }
  }
}

/**
 * Event consumer for governance events from other agents
 */
export class GovernanceEventConsumer {
  private readonly eventStoreUrl: string;
  private handlers: Map<string, Array<(event: unknown) => Promise<void>>> = new Map();

  constructor(config: { eventStoreUrl: string }) {
    this.eventStoreUrl = config.eventStoreUrl;
    logger.info({ eventStoreUrl: config.eventStoreUrl }, 'GovernanceEventConsumer initialized');
  }

  /**
   * Subscribes to DecisionEvents from other agents
   */
  onDecisionEvent(handler: (event: DecisionEvent) => Promise<void>): void {
    const handlers = this.handlers.get('DecisionEvent') || [];
    handlers.push(handler as (event: unknown) => Promise<void>);
    this.handlers.set('DecisionEvent', handlers);
    logger.info('Subscribed to DecisionEvents');
  }

  /**
   * Starts consuming events from the event store
   */
  async startConsuming(): Promise<{ stop: () => void }> {
    logger.info('Starting event consumption');

    // In production, use proper streaming/WebSocket
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `${this.eventStoreUrl}/api/v1/events/stream?types=DecisionEvent`,
          {
            headers: {
              'X-Agent-Id': 'llm-data-vault',
              'X-Agent-Version': AGENT_VERSION
            }
          }
        );

        if (response.ok) {
          const events = await response.json() as Array<{ eventType: string }>;
          for (const event of events) {
            const handlers = this.handlers.get(event.eventType) || [];
            for (const handler of handlers) {
              await handler(event);
            }
          }
        }
      } catch (error) {
        logger.error({ error }, 'Event consumption poll failed');
      }
    }, 5000);

    return {
      stop: () => clearInterval(pollInterval)
    };
  }
}

// =============================================================================
// INTEGRATION FACTORY
// =============================================================================

export interface IntegrationConfig {
  policyEngineUrl: string;
  orchestratorCallbackUrl: string;
  inferenceGatewayUrl: string;
  eventStoreUrl: string;
  instanceId: string;
}

/**
 * Creates all integration clients with the provided configuration
 */
export function createIntegrations(config: IntegrationConfig): {
  policyEngine: PolicyEngineIntegration;
  orchestrator: OrchestratorIntegration;
  inferenceGateway: InferenceGatewayIntegration;
  eventEmitter: GovernanceEventEmitter;
  eventConsumer: GovernanceEventConsumer;
} {
  return {
    policyEngine: new PolicyEngineIntegration({
      baseUrl: config.policyEngineUrl
    }),
    orchestrator: new OrchestratorIntegration({
      callbackUrl: config.orchestratorCallbackUrl
    }),
    inferenceGateway: new InferenceGatewayIntegration({
      gatewayUrl: config.inferenceGatewayUrl
    }),
    eventEmitter: new GovernanceEventEmitter({
      eventStoreUrl: config.eventStoreUrl,
      instanceId: config.instanceId
    }),
    eventConsumer: new GovernanceEventConsumer({
      eventStoreUrl: config.eventStoreUrl
    })
  };
}
