/**
 * LLM-Data-Vault: Data Access Control Edge Function Handler
 *
 * Google Cloud Edge Function handler for the Data Access Control Agent.
 * Handles HTTP requests, validates input, invokes the agent, and
 * emits telemetry.
 *
 * CRITICAL:
 * - Exactly ONE DecisionEvent MUST be emitted per invocation
 * - Handler MUST persist DecisionEvent to ruvector-service
 * - Handler MUST return deterministic, machine-readable output
 *
 * @module agents/data-access-control/handler
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  DataAccessControlAgent,
  createDataAccessControlAgent,
  AGENT_ID,
  AGENT_VERSION,
} from './agent.js';
import {
  DataAccessRuVectorClient,
  createDataAccessRuVectorClient,
} from './ruvector-client.js';
import type { ExecutionContext } from '../../runtime/agent-base.js';
import type {
  AccessPolicy,
  DecisionEvent,
} from '../../contracts/index.js';
import { getTelemetry, initTelemetry } from '../../telemetry/index.js';

/**
 * Handler configuration
 */
export interface HandlerConfig {
  /** Access policies to evaluate */
  policies: AccessPolicy[];
  /** Enable telemetry */
  enableTelemetry?: boolean;
  /** Enable request validation */
  enableValidation?: boolean;
  /** Enable response caching headers */
  enableCaching?: boolean;
  /** Environment (production, staging, development) */
  environment?: string;
}

/**
 * HTTP response structure
 */
interface HandlerResponse {
  /** Whether the request was successful */
  success: boolean;
  /** Response data (authorization result) */
  data?: {
    request_id: string;
    decision: 'allow' | 'deny' | 'conditional';
    granted_permissions: string[];
    denial_reasons: Array<{
      code: string;
      message: string;
      policy_id?: string;
      rule_id?: string;
    }>;
    conditions: Array<{
      type: string;
      requirement: string;
      metadata?: Record<string, unknown>;
    }>;
    cache_ttl_seconds?: number;
  };
  /** Error details (if failed) */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  /** Metadata */
  metadata: {
    agent_id: string;
    agent_version: string;
    execution_ref: string;
    timestamp: string;
    processing_time_ms: number;
  };
}

/**
 * Request validation schema (for quick validation before full agent processing)
 */
const RequestValidationSchema = z.object({
  request_id: z.string().uuid(),
  subject: z.object({
    subject_id: z.string(),
    subject_type: z.enum(['user', 'service', 'agent', 'system']),
    roles: z.array(z.string()),
    tenant_id: z.string(),
  }).passthrough(),
  resource: z.object({
    resource_id: z.string(),
    resource_type: z.enum(['dataset', 'record', 'field', 'schema', 'policy', 'tenant']),
    tenant_id: z.string(),
  }).passthrough(),
  permission: z.enum(['read', 'write', 'delete', 'admin', 'export', 'anonymize', 'share']),
  context: z.object({
    timestamp: z.string().datetime(),
    request_id: z.string().uuid(),
  }).passthrough(),
});

/**
 * Global state (initialized once per cold start)
 */
let agent: DataAccessControlAgent | null = null;
let ruvectorClient: DataAccessRuVectorClient | null = null;
let isInitialized = false;

/**
 * Initialize the handler
 */
function initializeHandler(config: HandlerConfig): void {
  if (isInitialized) return;

  // Initialize telemetry
  if (config.enableTelemetry) {
    initTelemetry({
      service_name: `llm-data-vault-${AGENT_ID}`,
      environment: config.environment ?? process.env['NODE_ENV'] ?? 'production',
      version: AGENT_VERSION,
      otlp_endpoint: process.env['OTLP_ENDPOINT'],
      log_level: (process.env['LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
    });
  }

  // Initialize RuVector client
  try {
    ruvectorClient = createDataAccessRuVectorClient();
  } catch (error) {
    console.warn('RuVector client not configured:', error);
    // Continue without persistence in development
    if (config.environment === 'production') {
      throw error;
    }
  }

  // Initialize agent
  agent = createDataAccessControlAgent(
    config.policies,
    // Pass base client if available (the agent expects RuVectorClient, not our extended client)
    undefined
  );

  isInitialized = true;
}

/**
 * Main Edge Function handler
 *
 * This is the entry point for Google Cloud Functions.
 *
 * @param req - Express-compatible request object
 * @param res - Express-compatible response object
 * @param config - Handler configuration
 */
export async function handleDataAccessControl(
  req: Request,
  res: Response,
  config: HandlerConfig
): Promise<void> {
  const startTime = performance.now();
  const executionRef = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Initialize on first request
  initializeHandler(config);

  // Set response headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Agent-Id', AGENT_ID);
  res.setHeader('X-Agent-Version', AGENT_VERSION);
  res.setHeader('X-Execution-Ref', executionRef);

  try {
    // Validate HTTP method
    if (req.method !== 'POST') {
      res.status(405).json(createErrorResponse(
        'METHOD_NOT_ALLOWED',
        `Method ${req.method} not allowed. Use POST.`,
        executionRef,
        timestamp,
        startTime
      ));
      return;
    }

    // Parse request body
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json(createErrorResponse(
        'INVALID_REQUEST_BODY',
        'Request body must be a valid JSON object',
        executionRef,
        timestamp,
        startTime
      ));
      return;
    }

    // Quick validation (before full agent processing)
    if (config.enableValidation !== false) {
      const validationResult = RequestValidationSchema.safeParse(body);
      if (!validationResult.success) {
        res.status(400).json(createErrorResponse(
          'VALIDATION_FAILED',
          'Request validation failed',
          executionRef,
          timestamp,
          startTime,
          validationResult.error.errors
        ));
        return;
      }
    }

    // Build execution context
    const context: ExecutionContext = {
      execution_ref: executionRef,
      correlation_id: (req.headers['x-correlation-id'] as string) ?? undefined,
      parent_execution_ref: (req.headers['x-parent-execution-ref'] as string) ?? undefined,
      tenant_id: body.subject?.tenant_id ?? (req.headers['x-tenant-id'] as string),
      request_source: mapRequestSource(req),
      timestamp,
    };

    // Ensure agent is initialized
    if (!agent) {
      res.status(500).json(createErrorResponse(
        'AGENT_NOT_INITIALIZED',
        'Agent failed to initialize',
        executionRef,
        timestamp,
        startTime
      ));
      return;
    }

    // Invoke the agent
    const result = await agent.invoke(body as unknown, context);

    // CRITICAL: Persist DecisionEvent to ruvector-service
    // This MUST happen for every invocation
    await persistDecisionEvent(result.decision_event, executionRef);

    // Build response
    const processingTimeMs = Math.round(performance.now() - startTime);

    if (result.success && result.data) {
      // Set caching headers if enabled and decision is cacheable
      if (config.enableCaching && result.data.cache_ttl_seconds) {
        res.setHeader('Cache-Control', `private, max-age=${result.data.cache_ttl_seconds}`);
      }

      const response: HandlerResponse = {
        success: true,
        data: {
          request_id: result.data.request_id,
          decision: result.data.decision,
          granted_permissions: result.data.granted_permissions,
          denial_reasons: result.data.denial_reasons,
          conditions: result.data.conditions,
          cache_ttl_seconds: result.data.cache_ttl_seconds,
        },
        metadata: {
          agent_id: AGENT_ID,
          agent_version: AGENT_VERSION,
          execution_ref: executionRef,
          timestamp,
          processing_time_ms: processingTimeMs,
        },
      };

      // Return appropriate status code based on decision
      const statusCode = result.data.decision === 'deny' ? 403 : 200;
      res.status(statusCode).json(response);
    } else {
      // Agent execution failed
      res.status(500).json(createErrorResponse(
        result.error?.code ?? 'AGENT_ERROR',
        result.error?.message ?? 'Agent execution failed',
        executionRef,
        timestamp,
        startTime,
        result.error?.details
      ));
    }
  } catch (error) {
    // Unexpected error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Emit error telemetry
    getTelemetry().recordInvocationComplete(
      AGENT_ID,
      AGENT_VERSION,
      executionRef,
      performance.now() - startTime,
      false,
      { error: errorMessage }
    );

    res.status(500).json(createErrorResponse(
      'INTERNAL_ERROR',
      errorMessage,
      executionRef,
      timestamp,
      startTime
    ));
  }
}

/**
 * Persist decision event to ruvector-service
 *
 * This is CRITICAL - exactly ONE DecisionEvent must be emitted per invocation.
 */
async function persistDecisionEvent(
  event: DecisionEvent,
  executionRef: string
): Promise<void> {
  if (!ruvectorClient) {
    // Log warning but don't fail (for development)
    console.warn(`[${executionRef}] RuVector client not available - decision event not persisted`);
    getTelemetry().emit({
      event_type: 'decision_event_persist_failed',
      timestamp: new Date().toISOString(),
      agent_id: AGENT_ID,
      agent_version: AGENT_VERSION,
      execution_ref: executionRef,
      metadata: { reason: 'client_not_configured' },
    });
    return;
  }

  try {
    const result = await ruvectorClient.persistDecision(event);

    if (result.success) {
      getTelemetry().emit({
        event_type: 'decision_event_persisted',
        timestamp: new Date().toISOString(),
        agent_id: AGENT_ID,
        agent_version: AGENT_VERSION,
        execution_ref: executionRef,
        metadata: { event_id: result.event_id },
      });
    } else {
      getTelemetry().emit({
        event_type: 'decision_event_persist_failed',
        timestamp: new Date().toISOString(),
        agent_id: AGENT_ID,
        agent_version: AGENT_VERSION,
        execution_ref: executionRef,
        metadata: {
          error_code: result.error?.code,
          error_message: result.error?.message,
          retryable: result.error?.retryable,
        },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    getTelemetry().emit({
      event_type: 'decision_event_persist_failed',
      timestamp: new Date().toISOString(),
      agent_id: AGENT_ID,
      agent_version: AGENT_VERSION,
      execution_ref: executionRef,
      metadata: { error: errorMessage },
    });

    // Re-throw in production to ensure persistence failures are not silently ignored
    if (process.env['NODE_ENV'] === 'production') {
      throw error;
    }
  }
}

/**
 * Create error response
 */
function createErrorResponse(
  code: string,
  message: string,
  executionRef: string,
  timestamp: string,
  startTime: number,
  details?: unknown
): HandlerResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    metadata: {
      agent_id: AGENT_ID,
      agent_version: AGENT_VERSION,
      execution_ref: executionRef,
      timestamp,
      processing_time_ms: Math.round(performance.now() - startTime),
    },
  };
}

/**
 * Map request to source type
 */
function mapRequestSource(
  req: Request
): ExecutionContext['request_source'] {
  const source = req.headers['x-request-source'] as string;

  switch (source?.toLowerCase()) {
    case 'orchestrator':
      return 'orchestrator';
    case 'inference_gateway':
    case 'inference-gateway':
      return 'inference_gateway';
    case 'policy_engine':
    case 'policy-engine':
      return 'policy_engine';
    case 'governance':
      return 'governance';
    case 'cli':
      return 'cli';
    case 'api':
    default:
      return 'api';
  }
}

/**
 * Create handler factory for Google Cloud Functions
 *
 * Usage:
 * ```typescript
 * import { createHandler } from './handler';
 *
 * export const dataAccessControl = createHandler({
 *   policies: loadPolicies(),
 *   enableTelemetry: true,
 * });
 * ```
 */
export function createHandler(
  config: HandlerConfig
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    await handleDataAccessControl(req, res, config);
  };
}

/**
 * Health check handler
 */
export async function handleHealthCheck(
  _req: Request,
  res: Response
): Promise<void> {
  const health = {
    status: 'healthy',
    agent_id: AGENT_ID,
    agent_version: AGENT_VERSION,
    timestamp: new Date().toISOString(),
    checks: {
      agent_initialized: isInitialized,
      ruvector_available: ruvectorClient !== null,
    },
  };

  // Check RuVector health if available
  if (ruvectorClient) {
    try {
      const ruvectorHealth = await ruvectorClient.healthCheck();
      health.checks = {
        ...health.checks,
        ruvector_healthy: ruvectorHealth.healthy,
        ruvector_latency_ms: ruvectorHealth.latencyMs,
        ruvector_circuit_state: ruvectorHealth.circuitState,
      } as typeof health.checks & {
        ruvector_healthy: boolean;
        ruvector_latency_ms: number;
        ruvector_circuit_state: string;
      };

      if (!ruvectorHealth.healthy) {
        health.status = 'degraded';
      }
    } catch {
      health.status = 'degraded';
    }
  }

  res.status(health.status === 'healthy' ? 200 : 503).json(health);
}

/**
 * Reset handler state (for testing)
 */
export function resetHandlerState(): void {
  agent = null;
  ruvectorClient = null;
  isInitialized = false;
}
