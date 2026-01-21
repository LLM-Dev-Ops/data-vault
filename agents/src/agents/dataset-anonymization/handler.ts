/**
 * LLM-Data-Vault: Dataset Anonymization Edge Function Handler
 *
 * HTTP handler for the Dataset Anonymization Agent.
 * Designed for deployment as a Google Cloud Edge Function.
 *
 * CRITICAL CONSTRAINTS:
 * - Handler MUST NOT execute inference
 * - Handler MUST NOT modify prompts (beyond anonymization)
 * - Handler MUST NOT route requests
 * - Handler MUST NOT trigger orchestration
 * - Handler produces privacy-safe artifacts ONLY
 *
 * @module dataset-anonymization/handler
 */

import type { HttpFunction } from '@google-cloud/functions-framework';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import {
  type AnonymizationRequest,
  AnonymizationRequestSchema,
} from '../../contracts/index.js';
import { DatasetAnonymizationAgent, type AgentConfig } from './agent.js';

/**
 * Logger instance
 */
const logger = pino({
  name: 'dataset-anonymization-handler',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

/**
 * Singleton agent instance (reused across invocations)
 */
let agentInstance: DatasetAnonymizationAgent | null = null;

/**
 * Get or create agent instance
 */
function getAgent(): DatasetAnonymizationAgent {
  if (!agentInstance) {
    const config: AgentConfig = {
      agentId: process.env['AGENT_ID'] ?? 'dataset-anonymization-agent',
      agentVersion: process.env['AGENT_VERSION'] ?? '1.0.0',
      emitDecisionEvents: process.env['EMIT_DECISION_EVENTS'] !== 'false',
      detector: {
        confidenceThreshold: parseFloat(process.env['DETECTION_CONFIDENCE'] ?? '0.85'),
        contextWindow: parseInt(process.env['CONTEXT_WINDOW'] ?? '50', 10),
        enableValidation: process.env['ENABLE_VALIDATION'] !== 'false',
      },
    };
    agentInstance = new DatasetAnonymizationAgent(config);
    logger.info({ config }, 'Agent instance created');
  }
  return agentInstance;
}

/**
 * HTTP handler for anonymization requests
 *
 * Expected request body: AnonymizationRequest
 * Response: AnonymizationResponse
 */
export const anonymizeHandler: HttpFunction = async (req, res) => {
  const requestId = req.headers['x-request-id'] as string ?? uuidv4();
  const startTime = performance.now();

  // Set response headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Request-Id', requestId);

  // Log request start
  logger.info({
    requestId,
    method: req.method,
    path: req.path,
    contentLength: req.headers['content-length'],
  }, 'Request received');

  try {
    // Validate HTTP method
    if (req.method !== 'POST') {
      res.status(405).json({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only POST method is allowed',
        },
      });
      return;
    }

    // Parse and validate request body
    const body = req.body;

    if (!body || typeof body !== 'object') {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST_BODY',
          message: 'Request body must be a valid JSON object',
        },
      });
      return;
    }

    // Inject request ID if not provided
    if (!body.request_id) {
      body.request_id = requestId;
    }

    // Validate against schema
    const validation = AnonymizationRequestSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      logger.warn({ requestId, errors }, 'Request validation failed');

      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: { errors },
        },
      });
      return;
    }

    const request: AnonymizationRequest = validation.data;

    // Get agent and process request
    const agent = getAgent();
    const response = await agent.anonymize(request);

    // Calculate processing time
    const processingTimeMs = performance.now() - startTime;

    // Log success
    logger.info({
      requestId,
      processingTimeMs,
      piiDetections: response.results.pii_detections,
      fieldsAnonymized: response.results.fields_anonymized,
      complianceSatisfied: response.compliance.frameworks_satisfied,
    }, 'Request processed successfully');

    // Add timing header
    res.setHeader('X-Processing-Time-Ms', Math.round(processingTimeMs).toString());

    // Send response
    res.status(200).json(response);
  } catch (error) {
    const processingTimeMs = performance.now() - startTime;

    // Determine error type and status code
    let statusCode = 500;
    let errorCode = 'INTERNAL_ERROR';
    let errorMessage = 'An unexpected error occurred';

    if (error instanceof Error) {
      errorMessage = error.message;

      if (error.name === 'ZodError') {
        statusCode = 400;
        errorCode = 'VALIDATION_ERROR';
      } else if (error.message.includes('not found')) {
        statusCode = 404;
        errorCode = 'NOT_FOUND';
      } else if (error.message.includes('unauthorized') || error.message.includes('forbidden')) {
        statusCode = 403;
        errorCode = 'FORBIDDEN';
      }
    }

    // Log error
    logger.error({
      requestId,
      processingTimeMs,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, 'Request processing failed');

    // Send error response
    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: errorMessage,
        requestId,
      },
    });
  }
};

/**
 * Health check handler
 */
export const healthHandler: HttpFunction = async (_req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    // Verify agent can be created
    getAgent();

    res.status(200).json({
      status: 'healthy',
      service: 'dataset-anonymization-agent',
      version: process.env['AGENT_VERSION'] ?? '1.0.0',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'dataset-anonymization-agent',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Main entry point for Edge Function
 *
 * Routes requests based on path:
 * - POST /anonymize -> anonymizeHandler
 * - GET /health -> healthHandler
 */
export const main: HttpFunction = async (req, res) => {
  const path = req.path ?? '/';

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env['CORS_ORIGIN'] ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // Route to appropriate handler
  if (path === '/health' || path === '/healthz') {
    await healthHandler(req, res);
  } else if (path === '/anonymize' || path === '/') {
    await anonymizeHandler(req, res);
  } else {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Path '${path}' not found`,
      },
    });
  }
};

// Export default for Cloud Functions
export default main;
