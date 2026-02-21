/**
 * LLM-Data-Vault: Cloud Functions Entry Point
 *
 * Unified Google Cloud Functions HTTP handler for the data-vault-agents function.
 * Routes requests to the appropriate agent based on URL path.
 *
 * Routes:
 *   POST /v1/data-vault/access-control → Data Access Control Agent
 *   POST /v1/data-vault/anonymize      → Dataset Anonymization Agent
 *   GET  /v1/data-vault/health          → Health check
 *
 * Deploy:
 *   gcloud functions deploy data-vault-agents --runtime nodejs20 --trigger-http \
 *     --region us-central1 --project agentics-dev --entry-point handler \
 *     --memory 512MB --timeout 60s --no-allow-unauthenticated
 *
 * @module functions/cloud-function
 */

import type { HttpFunction } from '@google-cloud/functions-framework';
import { AnonymizationFunctionHandler } from './anonymization-function.js';
import {
  createDataAccessControlAgent,
  type DataAccessControlAgent,
} from '../agents/data-access-control/agent.js';
import type { ExecutionContext } from '../runtime/agent-base.js';

// =============================================================================
// Constants
// =============================================================================

const SERVICE_NAME = 'data-vault-agents';
const HEALTH_AGENTS = ['access-control', 'anonymize'] as const;

// =============================================================================
// Singleton Instances (reused across Cloud Function invocations)
// =============================================================================

let anonymizationHandler: AnonymizationFunctionHandler | null = null;
let accessControlAgent: DataAccessControlAgent | null = null;

function getAnonymizationHandler(): AnonymizationFunctionHandler {
  if (!anonymizationHandler) {
    anonymizationHandler = new AnonymizationFunctionHandler();
  }
  return anonymizationHandler;
}

function getAccessControlAgent(): DataAccessControlAgent {
  if (!accessControlAgent) {
    accessControlAgent = createDataAccessControlAgent([]);
  }
  return accessControlAgent;
}

// =============================================================================
// Execution Metadata
// =============================================================================

interface ExecutionMetadata {
  trace_id: string;
  timestamp: string;
  service: string;
  execution_id: string;
}

interface LayerExecuted {
  layer: string;
  status: string;
  duration_ms?: number;
}

function buildExecutionMetadata(
  headers: Record<string, string | string[] | undefined>,
): ExecutionMetadata {
  const correlationHeader = headers['x-correlation-id'];
  const traceId = typeof correlationHeader === 'string'
    ? correlationHeader
    : crypto.randomUUID();

  return {
    trace_id: traceId,
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    execution_id: crypto.randomUUID(),
  };
}

function wrapResponse(
  body: unknown,
  metadata: ExecutionMetadata,
  agentLayer: string,
  startTime: number,
): Record<string, unknown> {
  const elapsed = Math.round(performance.now() - startTime);
  const base = typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : { data: body };

  return {
    ...base,
    execution_metadata: metadata,
    layers_executed: [
      { layer: 'AGENT_ROUTING', status: 'completed' },
      { layer: `DATA_VAULT_${agentLayer}`, status: 'completed', duration_ms: elapsed },
    ] satisfies LayerExecuted[],
  };
}

// =============================================================================
// CORS
// =============================================================================

function setCorsHeaders(res: Parameters<HttpFunction>[1]): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Correlation-ID, X-Request-Source, X-Execution-ID, X-Parent-Span-ID',
  );
}

// =============================================================================
// Route Handlers
// =============================================================================

async function handleAnonymize(
  req: Parameters<HttpFunction>[0],
  res: Parameters<HttpFunction>[1],
  metadata: ExecutionMetadata,
  startTime: number,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json(
      wrapResponse(
        { error: 'METHOD_NOT_ALLOWED', message: 'POST required' },
        metadata,
        'ANONYMIZE',
        startTime,
      ),
    );
    return;
  }

  const h = getAnonymizationHandler();
  const response = await h.handle({
    method: req.method,
    path: 'anonymize',
    headers: req.headers as Record<string, string>,
    body: req.body,
    query: (req.query ?? {}) as Record<string, string>,
  });

  for (const [key, value] of Object.entries(response.headers)) {
    res.setHeader(key, value);
  }

  res.status(response.status).json(
    wrapResponse(response.body, metadata, 'ANONYMIZE', startTime),
  );
}

async function handleAccessControl(
  req: Parameters<HttpFunction>[0],
  res: Parameters<HttpFunction>[1],
  metadata: ExecutionMetadata,
  startTime: number,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json(
      wrapResponse(
        { error: 'METHOD_NOT_ALLOWED', message: 'POST required' },
        metadata,
        'ACCESS_CONTROL',
        startTime,
      ),
    );
    return;
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json(
      wrapResponse(
        { error: 'INVALID_REQUEST_BODY', message: 'Request body must be a valid JSON object' },
        metadata,
        'ACCESS_CONTROL',
        startTime,
      ),
    );
    return;
  }

  const agent = getAccessControlAgent();
  const record = body as Record<string, unknown>;
  const subject = record['subject'] as Record<string, unknown> | undefined;

  const context: ExecutionContext = {
    execution_ref: metadata.execution_id,
    correlation_id: metadata.trace_id,
    tenant_id: (record['tenant_id'] as string)
      ?? (subject?.['tenant_id'] as string)
      ?? (req.headers['x-tenant-id'] as string),
    request_source: mapRequestSource(req.headers['x-request-source'] as string),
    timestamp: metadata.timestamp,
  };

  const result = await agent.invoke(body, context);

  const status = result.success
    ? (result.data?.decision === 'deny' ? 403 : 200)
    : 500;

  const responseBody = result.success
    ? {
        success: true,
        data: result.data,
        metadata: {
          agent_id: 'data-access-control',
          agent_version: '1.0.0',
          execution_ref: metadata.execution_id,
          execution_time_ms: result.execution_time_ms,
        },
      }
    : {
        success: false,
        error: result.error,
      };

  res.status(status).json(
    wrapResponse(responseBody, metadata, 'ACCESS_CONTROL', startTime),
  );
}

function handleHealth(
  _req: Parameters<HttpFunction>[0],
  res: Parameters<HttpFunction>[1],
  metadata: ExecutionMetadata,
  startTime: number,
): void {
  res.status(200).json(
    wrapResponse(
      {
        status: 'healthy',
        service: SERVICE_NAME,
        agents: [...HEALTH_AGENTS],
        timestamp: metadata.timestamp,
      },
      metadata,
      'HEALTH',
      startTime,
    ),
  );
}

// =============================================================================
// Helpers
// =============================================================================

function mapRequestSource(
  source: string | undefined,
): ExecutionContext['request_source'] {
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
    default:
      return 'api';
  }
}

// =============================================================================
// Main Handler (Cloud Functions Entry Point)
// =============================================================================

/**
 * Unified Cloud Functions handler for data-vault-agents.
 *
 * Entry point for: gcloud functions deploy --entry-point handler
 */
export const handler: HttpFunction = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const startTime = performance.now();
  const metadata = buildExecutionMetadata(
    req.headers as Record<string, string | string[] | undefined>,
  );
  const path = (req.path || '/').replace(/^\/+|\/+$/g, '');

  try {
    switch (path) {
      case 'v1/data-vault/anonymize':
        await handleAnonymize(req, res, metadata, startTime);
        return;

      case 'v1/data-vault/access-control':
        await handleAccessControl(req, res, metadata, startTime);
        return;

      case 'v1/data-vault/health':
        handleHealth(req, res, metadata, startTime);
        return;

      default:
        res.status(404).json(
          wrapResponse(
            {
              error: 'NOT_FOUND',
              message: `Route not found: /${path}`,
              available_routes: [
                '/v1/data-vault/access-control',
                '/v1/data-vault/anonymize',
                '/v1/data-vault/health',
              ],
            },
            metadata,
            'ROUTING',
            startTime,
          ),
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    res.status(500).json(
      wrapResponse(
        { error: 'INTERNAL_ERROR', message },
        metadata,
        'ERROR',
        startTime,
      ),
    );
  }
};
