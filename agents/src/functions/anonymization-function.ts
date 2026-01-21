/**
 * LLM-Data-Vault: Anonymization Edge Function
 *
 * Google Cloud Edge Function handler for the Dataset Anonymization Agent.
 *
 * DEPLOYMENT MODEL:
 * - Deploys as Google Cloud Edge Function
 * - Part of unified Data-Vault service
 * - Stateless execution
 * - Deterministic behavior
 * - No orchestration logic
 * - Async, non-blocking writes via ruvector-service only
 *
 * ENDPOINTS:
 * - POST /anonymize - Apply anonymization to dataset content
 * - POST /inspect - Inspect content for PII without modifying
 * - GET /health - Health check
 *
 * @module functions/anonymization-function
 */

import { v4 as uuidv4 } from 'uuid';
import {
  createAnonymizationAgent,
  DatasetAnonymizationAgent,
} from '../agents/dataset-anonymization-agent.js';
import {
  AnonymizationRequest,
  validateAnonymizationRequest,
} from '../contracts/index.js';
import { RuVectorClient } from '../ruvector-client/index.js';
import { getTelemetry, initTelemetry } from '../telemetry/index.js';
import type { ExecutionContext } from '../runtime/agent-base.js';

/**
 * HTTP Request interface (Google Cloud Functions compatible)
 */
interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  query: Record<string, string | undefined>;
}

/**
 * HTTP Response interface
 */
interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Function configuration
 */
interface FunctionConfig {
  agentId: string;
  agentVersion: string;
  environment: string;
  ruvectorEndpoint: string;
  ruvectorApiKey: string;
  otlpEndpoint?: string;
}

/**
 * Load configuration from environment
 */
function loadConfig(): FunctionConfig {
  return {
    agentId: process.env['AGENT_ID'] ?? 'data-vault.anonymization.v1',
    agentVersion: process.env['AGENT_VERSION'] ?? '0.1.0',
    environment: process.env['NODE_ENV'] ?? 'production',
    ruvectorEndpoint: process.env['RUVECTOR_SERVICE_ENDPOINT'] ?? 'http://localhost:8080',
    ruvectorApiKey: process.env['RUVECTOR_SERVICE_API_KEY'] ?? '',
    otlpEndpoint: process.env['OTLP_ENDPOINT'],
  };
}

/**
 * Anonymization Edge Function Handler
 */
export class AnonymizationFunctionHandler {
  private readonly agent: DatasetAnonymizationAgent;
  private readonly ruvectorClient: RuVectorClient;
  private readonly config: FunctionConfig;

  constructor(config?: Partial<FunctionConfig>) {
    this.config = { ...loadConfig(), ...config };

    // Initialize telemetry
    initTelemetry({
      service_name: 'llm-data-vault-anonymization',
      environment: this.config.environment,
      version: this.config.agentVersion,
      otlp_endpoint: this.config.otlpEndpoint,
    });

    // Create agent instance
    this.agent = createAnonymizationAgent();

    // Create ruvector client
    this.ruvectorClient = new RuVectorClient({
      endpoint: this.config.ruvectorEndpoint,
      apiKey: this.config.ruvectorApiKey,
    });
  }

  /**
   * Main entry point for Edge Function
   */
  async handle(request: HttpRequest): Promise<HttpResponse> {
    const telemetry = getTelemetry();
    const executionRef = uuidv4();

    // Set CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders,
        body: null,
      };
    }

    // Route request
    try {
      const path = request.path.replace(/^\/+/, '').split('?')[0];

      switch (path) {
        case 'anonymize':
          if (request.method !== 'POST') {
            return this.methodNotAllowed(corsHeaders);
          }
          return await this.handleAnonymize(request, executionRef, corsHeaders);

        case 'inspect':
          if (request.method !== 'POST') {
            return this.methodNotAllowed(corsHeaders);
          }
          return await this.handleInspect(request, executionRef, corsHeaders);

        case 'health':
          return await this.handleHealth(corsHeaders);

        case 'metadata':
          return this.handleMetadata(corsHeaders);

        default:
          return {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: {
              error: 'NOT_FOUND',
              message: `Endpoint not found: ${path}`,
              available_endpoints: ['anonymize', 'inspect', 'health', 'metadata'],
            },
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      telemetry.emit({
        event_type: 'agent_invocation_failed',
        timestamp: new Date().toISOString(),
        agent_id: this.config.agentId,
        agent_version: this.config.agentVersion,
        execution_ref: executionRef,
        metadata: { error: errorMessage },
      });

      return {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: {
          error: 'INTERNAL_ERROR',
          message: errorMessage,
          execution_ref: executionRef,
        },
      };
    }
  }

  /**
   * Handle /anonymize endpoint
   */
  private async handleAnonymize(
    request: HttpRequest,
    executionRef: string,
    corsHeaders: Record<string, string>
  ): Promise<HttpResponse> {
    const telemetry = getTelemetry();
    const correlationId = request.headers['x-correlation-id'] ?? uuidv4();
    const startTime = performance.now();

    // Record invocation start
    telemetry.recordInvocationStart(
      this.config.agentId,
      this.config.agentVersion,
      executionRef,
      correlationId
    );

    try {
      // Parse and validate request
      const body = typeof request.body === 'string'
        ? JSON.parse(request.body)
        : request.body;

      // Build anonymization request
      const anonymizationRequest = this.buildAnonymizationRequest(body, executionRef);

      // Build execution context
      const context: ExecutionContext = {
        execution_ref: executionRef,
        correlation_id: correlationId,
        tenant_id: anonymizationRequest.tenant_id,
        request_source: this.getRequestSource(request.headers),
        timestamp: new Date().toISOString(),
      };

      // Invoke agent
      const result = await this.agent.invoke(anonymizationRequest, context);

      // Persist DecisionEvent to ruvector-service (async, non-blocking)
      this.persistDecisionEvent(result.decision_event).catch(err => {
        telemetry.emit({
          event_type: 'decision_event_persist_failed',
          timestamp: new Date().toISOString(),
          agent_id: this.config.agentId,
          agent_version: this.config.agentVersion,
          execution_ref: executionRef,
          metadata: { error: String(err) },
        });
      });

      // Record completion
      telemetry.recordInvocationComplete(
        this.config.agentId,
        this.config.agentVersion,
        executionRef,
        result.execution_time_ms,
        result.success,
        result.success
          ? { fields_anonymized: (result.data as { results?: { fields_anonymized?: number } })?.results?.fields_anonymized }
          : { error: result.error?.message }
      );

      if (result.success) {
        return {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'X-Execution-Ref': executionRef,
            'X-Correlation-ID': correlationId,
          },
          body: {
            success: true,
            data: result.data,
            metadata: {
              execution_ref: executionRef,
              execution_time_ms: result.execution_time_ms,
              agent_id: this.config.agentId,
              agent_version: this.config.agentVersion,
            },
          },
        };
      } else {
        return {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'X-Execution-Ref': executionRef,
          },
          body: {
            success: false,
            error: result.error,
            execution_ref: executionRef,
          },
        };
      }
    } catch (error) {
      const duration = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      telemetry.recordInvocationComplete(
        this.config.agentId,
        this.config.agentVersion,
        executionRef,
        duration,
        false,
        { error: errorMessage }
      );

      return {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Execution-Ref': executionRef,
        },
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: errorMessage,
          },
          execution_ref: executionRef,
        },
      };
    }
  }

  /**
   * Handle /inspect endpoint (dry-run mode)
   */
  private async handleInspect(
    request: HttpRequest,
    executionRef: string,
    corsHeaders: Record<string, string>
  ): Promise<HttpResponse> {
    // Reuse anonymize handler with dry_run = true
    const body = typeof request.body === 'string'
      ? JSON.parse(request.body)
      : request.body as Record<string, unknown>;

    const modifiedRequest: HttpRequest = {
      ...request,
      body: {
        ...body,
        options: {
          ...(body['options'] as Record<string, unknown> | undefined),
          dry_run: true,
          include_detection_details: true,
        },
      },
    };

    return this.handleAnonymize(modifiedRequest, executionRef, corsHeaders);
  }

  /**
   * Handle /health endpoint
   */
  private async handleHealth(corsHeaders: Record<string, string>): Promise<HttpResponse> {
    const ruvectorHealth = await this.ruvectorClient.healthCheck();

    const healthy = ruvectorHealth.healthy;

    return {
      status: healthy ? 200 : 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: {
        status: healthy ? 'healthy' : 'degraded',
        agent: {
          id: this.config.agentId,
          version: this.config.agentVersion,
        },
        dependencies: {
          ruvector_service: {
            healthy: ruvectorHealth.healthy,
            latency_ms: ruvectorHealth.latency_ms,
          },
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Handle /metadata endpoint
   */
  private handleMetadata(corsHeaders: Record<string, string>): HttpResponse {
    const metadata = this.agent.getMetadata();

    return {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: {
        ...metadata,
        endpoints: {
          anonymize: {
            method: 'POST',
            description: 'Apply anonymization to dataset content',
          },
          inspect: {
            method: 'POST',
            description: 'Inspect content for PII without modifying',
          },
          health: {
            method: 'GET',
            description: 'Health check',
          },
          metadata: {
            method: 'GET',
            description: 'Agent metadata and capabilities',
          },
        },
      },
    };
  }

  /**
   * Build anonymization request from incoming body
   */
  private buildAnonymizationRequest(
    body: Record<string, unknown>,
    executionRef: string
  ): AnonymizationRequest {
    // Ensure required fields
    const requestId = (body['request_id'] as string) ?? executionRef;
    const tenantId = (body['tenant_id'] as string) ?? 'default';
    const content = body['content'];
    const requester = (body['requester'] as Record<string, unknown>) ?? {
      service: 'unknown',
    };

    if (content === undefined) {
      throw new Error('content field is required');
    }

    return validateAnonymizationRequest({
      request_id: requestId,
      correlation_id: body['correlation_id'],
      dataset_id: body['dataset_id'] ?? 'ephemeral',
      dataset_version: body['dataset_version'],
      content,
      content_format: body['content_format'] ?? 'json',
      policy_id: body['policy_id'],
      policy: body['policy'],
      strategies: body['strategies'],
      options: body['options'] ?? {},
      tenant_id: tenantId,
      requester: {
        service: (requester['service'] as string) ?? 'unknown',
        user_id: requester['user_id'] as string | undefined,
        roles: (requester['roles'] as string[]) ?? [],
      },
    });
  }

  /**
   * Get request source from headers
   */
  private getRequestSource(
    headers: Record<string, string | undefined>
  ): ExecutionContext['request_source'] {
    const source = headers['x-request-source']?.toLowerCase();

    switch (source) {
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
      default:
        return 'api';
    }
  }

  /**
   * Persist DecisionEvent (async, non-blocking)
   */
  private async persistDecisionEvent(event: unknown): Promise<void> {
    await this.ruvectorClient.persistDecisionEvent(event as Parameters<RuVectorClient['persistDecisionEvent']>[0]);
  }

  /**
   * Method not allowed response
   */
  private methodNotAllowed(corsHeaders: Record<string, string>): HttpResponse {
    return {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: {
        error: 'METHOD_NOT_ALLOWED',
        message: 'Only POST method is allowed for this endpoint',
      },
    };
  }
}

/**
 * Create and export handler for Google Cloud Functions
 */
let handler: AnonymizationFunctionHandler | null = null;

export function getHandler(): AnonymizationFunctionHandler {
  if (!handler) {
    handler = new AnonymizationFunctionHandler();
  }
  return handler;
}

/**
 * Google Cloud Functions entry point
 */
export async function anonymizationFunction(
  req: { method: string; path: string; headers: Record<string, string>; body: unknown; query: Record<string, string> },
  res: { status: (code: number) => { set: (headers: Record<string, string>) => { json: (body: unknown) => void } } }
): Promise<void> {
  const handler = getHandler();
  const response = await handler.handle({
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body,
    query: req.query,
  });

  res.status(response.status).set(response.headers).json(response.body);
}

/**
 * Export for testing
 */
export { AnonymizationFunctionHandler as TestableHandler };
