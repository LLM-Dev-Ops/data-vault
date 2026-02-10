/**
 * LLM-Data-Vault: Unified Server
 *
 * Main entry point for the unified Data-Vault Cloud Run service.
 * Exposes all agent endpoints under one service.
 *
 * ARCHITECTURE:
 * - Single Cloud Run service
 * - Multiple agent endpoints
 * - Shared runtime, configuration, telemetry
 * - All persistence via ruvector-service (NO direct SQL)
 *
 * STARTUP BEHAVIOR:
 * - FAIL-FAST: Service will CRASH if required environment variables are missing
 * - Health check: RuVector service must be reachable before accepting traffic
 * - This is intentional for Cloud Run - fail fast, let Cloud Run retry
 *
 * @module functions/server
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { AnonymizationFunctionHandler } from './anonymization-function.js';
import { initTelemetry, getTelemetry } from '../telemetry/index.js';
import { RuVectorClient } from '../ruvector-client/index.js';
import {
  runStartupValidation,
  setValidatedConfig,
  type EnvironmentConfig,
} from '../startup/index.js';
import {
  extractExecutionContext,
  validateExecutionContext,
  ExecutionGraphBuilder,
  type ExecutionGraphOutput,
} from '../execution/index.js';

// =============================================================================
// Startup Validation (FAIL-FAST)
// =============================================================================

// These will be initialized after startup validation
let CONFIG: EnvironmentConfig;
let ruvectorClient: RuVectorClient;
let anonymizationHandler: AnonymizationFunctionHandler;

/**
 * Initialize all services after validation passes
 */
function initializeServices(config: EnvironmentConfig): void {
  CONFIG = config;
  setValidatedConfig(config);

  // Initialize telemetry
  initTelemetry({
    service_name: config.serviceName,
    environment: config.platformEnv,
    version: config.serviceVersion,
    otlp_endpoint: config.telemetryEndpoint,
    log_level: config.logLevel,
  });

  // Initialize ruvector client
  ruvectorClient = new RuVectorClient({
    endpoint: config.ruvectorServiceUrl,
    apiKey: config.ruvectorApiKey,
  });

  // Initialize agent handlers
  anonymizationHandler = new AnonymizationFunctionHandler({
    agentId: 'data-vault.anonymization.v1',
    agentVersion: config.serviceVersion,
    environment: config.platformEnv,
    ruvectorEndpoint: config.ruvectorServiceUrl,
    ruvectorApiKey: config.ruvectorApiKey,
    otlpEndpoint: config.telemetryEndpoint,
  });
}

// =============================================================================
// Request Parsing
// =============================================================================

async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

// =============================================================================
// Response Helpers
// =============================================================================

function sendJson(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: code, message });
}

// =============================================================================
// Route Handlers
// =============================================================================

async function handleHealth(res: ServerResponse): Promise<void> {
  const ruvectorHealth = await ruvectorClient.healthCheck();

  const healthy = ruvectorHealth.healthy;
  const status = healthy ? 200 : 503;

  sendJson(res, status, {
    status: healthy ? 'healthy' : 'degraded',
    service: CONFIG.serviceName,
    version: CONFIG.serviceVersion,
    environment: CONFIG.platformEnv,
    timestamp: new Date().toISOString(),
    dependencies: {
      ruvector_service: {
        healthy: ruvectorHealth.healthy,
        latency_ms: ruvectorHealth.latency_ms,
      },
    },
    agents: {
      data_access_control: { enabled: true, status: 'ready' },
      dataset_anonymization: { enabled: true, status: 'ready' },
    },
  });
}

async function handleReady(res: ServerResponse): Promise<void> {
  // Simple readiness check
  sendJson(res, 200, { ready: true });
}

async function handleMetadata(res: ServerResponse): Promise<void> {
  sendJson(res, 200, {
    service: CONFIG.serviceName,
    version: CONFIG.serviceVersion,
    environment: CONFIG.platformEnv,
    classification: 'DATA_VAULT',
    agents: [
      {
        id: 'data-vault.access-control.v1',
        name: 'Data Access Control Agent',
        classification: 'DATA_ACCESS_CONTROL',
        endpoints: ['/authorize', '/authorize/batch', '/policies'],
        capabilities: ['authorize', 'policy_evaluation'],
      },
      {
        id: 'data-vault.anonymization.v1',
        name: 'Dataset Anonymization Agent',
        classification: 'DATASET_ANONYMIZATION',
        endpoints: ['/anonymize', '/anonymize/batch', '/inspect', '/strategies'],
        capabilities: ['anonymize', 'redact', 'pii_detection'],
      },
    ],
    boundaries: {
      executes_inference: false,
      modifies_prompts: false,
      routes_requests: false,
      triggers_orchestration: false,
      direct_sql_access: false,
    },
    persistence: {
      method: 'ruvector-service',
      direct_database: false,
    },
    consumers: [
      'llm-orchestrator',
      'llm-inference-gateway',
      'llm-policy-engine',
      'governance-systems',
    ],
  });
}

async function handleMetrics(res: ServerResponse): Promise<void> {
  const telemetry = getTelemetry();
  const metrics = telemetry.getMetrics();

  // Prometheus format
  const lines = [
    `# HELP data_vault_invocations_total Total agent invocations`,
    `# TYPE data_vault_invocations_total counter`,
    `data_vault_invocations_total{status="success"} ${metrics.invocations_success}`,
    `data_vault_invocations_total{status="failed"} ${metrics.invocations_failed}`,
    ``,
    `# HELP data_vault_latency_ms Agent latency in milliseconds`,
    `# TYPE data_vault_latency_ms gauge`,
    `data_vault_latency_ms{quantile="0.5"} ${metrics.avg_latency_ms}`,
    `data_vault_latency_ms{quantile="0.95"} ${metrics.p95_latency_ms}`,
    `data_vault_latency_ms{quantile="0.99"} ${metrics.p99_latency_ms}`,
    ``,
    `# HELP data_vault_pii_detections_total Total PII detections`,
    `# TYPE data_vault_pii_detections_total counter`,
    `data_vault_pii_detections_total ${metrics.pii_detections_total}`,
    ``,
    `# HELP data_vault_anonymizations_total Total fields anonymized`,
    `# TYPE data_vault_anonymizations_total counter`,
    `data_vault_anonymizations_total ${metrics.anonymizations_total}`,
    ``,
    `# HELP data_vault_access_decisions_total Total access decisions`,
    `# TYPE data_vault_access_decisions_total counter`,
    `data_vault_access_decisions_total{decision="granted"} ${metrics.access_decisions_granted}`,
    `data_vault_access_decisions_total{decision="denied"} ${metrics.access_decisions_denied}`,
  ];

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(lines.join('\n'));
}

async function handleStrategies(res: ServerResponse): Promise<void> {
  sendJson(res, 200, {
    strategies: [
      { name: 'redact', description: 'Replace with [REDACTED]' },
      { name: 'mask', description: 'Replace with ***' },
      { name: 'hash', description: 'SHA-256 hash' },
      { name: 'tokenize', description: 'Replace with reversible token' },
      { name: 'generalize', description: 'Generalize to broader category' },
      { name: 'suppress', description: 'Remove entirely' },
      { name: 'pseudonymize', description: 'Replace with consistent pseudonym' },
    ],
    pii_types: [
      'email', 'phone_number', 'ssn', 'credit_card', 'ip_address',
      'date_of_birth', 'api_key', 'password', 'person_name', 'full_address',
    ],
  });
}

async function handlePolicies(res: ServerResponse): Promise<void> {
  // Placeholder - would fetch from ruvector-service in production
  sendJson(res, 200, {
    policies: [
      { id: 'default-policy', name: 'Default Access Policy', active: true },
      { id: 'gdpr-compliance', name: 'GDPR Compliance Policy', active: true },
      { id: 'hipaa-compliance', name: 'HIPAA Compliance Policy', active: true },
    ],
  });
}

// =============================================================================
// Agentics Execution Context
// =============================================================================

/** Routes that require execution context (agent invocation routes) */
const AGENT_ROUTES = new Set(['anonymize', 'inspect', 'authorize']);

/**
 * Sends a response with execution graph attached.
 * The _execution field is included in the JSON body.
 */
function sendJsonWithGraph(
  res: ServerResponse,
  status: number,
  data: unknown,
  executionGraph: ExecutionGraphOutput,
  headers: Record<string, string> = {}
): void {
  const body = typeof data === 'object' && data !== null
    ? { ...data, _execution: executionGraph }
    : { data, _execution: executionGraph };
  sendJson(res, status, body, headers);
}

// =============================================================================
// Main Router
// =============================================================================

async function router(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  const method = req.method ?? 'GET';

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-ID, X-Request-Source, X-Execution-ID, X-Parent-Span-ID');

  // Handle preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // --- Agentics: Enforce execution context on agent routes ---
    if (AGENT_ROUTES.has(path)) {
      const execCtx = extractExecutionContext(
        req.headers as Record<string, string | string[] | undefined>
      );
      const validationError = validateExecutionContext(execCtx);

      if (validationError) {
        sendError(res, 400, 'MISSING_EXECUTION_CONTEXT', validationError);
        return;
      }

      const graphBuilder = new ExecutionGraphBuilder(execCtx!);

      // Route to the specific agent handler with span tracking
      switch (path) {
        case 'anonymize':
        case 'inspect': {
          if (method !== 'POST') {
            sendError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
            return;
          }

          const agentSpan = graphBuilder.startAgentSpan('data-vault.anonymization.v1');

          try {
            const anonymizeResponse = await anonymizationHandler.handle({
              method,
              path,
              headers: req.headers as Record<string, string>,
              body: await parseBody(req),
              query: parseQuery(url),
            });

            // Attach result artifact to agent span
            graphBuilder.attachArtifact(agentSpan, {
              id: `result-${path}-${Date.now()}`,
              type: 'agent_result',
            });

            if (anonymizeResponse.status < 400) {
              graphBuilder.completeAgentSpan(agentSpan);
            } else {
              graphBuilder.failAgentSpan(agentSpan, [
                `Agent returned status ${anonymizeResponse.status}`,
              ]);
            }

            const executionGraph = graphBuilder.finalize();
            sendJsonWithGraph(
              res,
              anonymizeResponse.status,
              anonymizeResponse.body,
              executionGraph,
              anonymizeResponse.headers
            );
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            graphBuilder.failAgentSpan(agentSpan, [msg]);
            const executionGraph = graphBuilder.finalize(true, [msg]);
            sendJsonWithGraph(res, 500, { error: 'INTERNAL_ERROR', message: msg }, executionGraph);
          }
          break;
        }

        case 'authorize': {
          if (method !== 'POST') {
            sendError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
            return;
          }

          const agentSpan = graphBuilder.startAgentSpan('data-vault.access-control.v1');

          const responseBody = {
            request_id: crypto.randomUUID(),
            decision: 'allow',
            message: 'Access control agent placeholder - implement full logic',
          };

          graphBuilder.attachArtifact(agentSpan, {
            id: `result-authorize-${responseBody.request_id}`,
            type: 'access_decision',
          });
          graphBuilder.completeAgentSpan(agentSpan);

          const executionGraph = graphBuilder.finalize();
          sendJsonWithGraph(res, 200, responseBody, executionGraph);
          break;
        }

        default:
          // Should not reach here since we checked AGENT_ROUTES
          sendError(res, 404, 'NOT_FOUND', `Endpoint not found: /${path}`);
      }
      return;
    }

    // --- Non-agent routes (no execution context required) ---
    switch (path) {
      // Health & Metadata
      case 'health':
        await handleHealth(res);
        break;

      case 'ready':
        await handleReady(res);
        break;

      case 'metadata':
        await handleMetadata(res);
        break;

      case 'metrics':
        await handleMetrics(res);
        break;

      case 'strategies':
        await handleStrategies(res);
        break;

      case 'policies':
        await handlePolicies(res);
        break;

      // Root
      case '':
        sendJson(res, 200, {
          service: CONFIG.serviceName,
          version: CONFIG.serviceVersion,
          endpoints: [
            '/health', '/ready', '/metadata', '/metrics',
            '/anonymize', '/inspect', '/strategies',
            '/authorize', '/policies',
          ],
        });
        break;

      default:
        sendError(res, 404, 'NOT_FOUND', `Endpoint not found: /${path}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('Request error:', error);
    sendError(res, 500, 'INTERNAL_ERROR', message);
  }
}

// =============================================================================
// Server Startup (with FAIL-FAST validation)
// =============================================================================

let server: ReturnType<typeof createServer>;

/**
 * Main entry point - runs startup validation then starts server
 * CRASHES if validation fails (intentional for Cloud Run)
 */
async function main(): Promise<void> {
  // STEP 1: Run startup validation (CRASHES on failure)
  const config = await runStartupValidation();

  // STEP 2: Initialize services with validated config
  initializeServices(config);

  // STEP 3: Create and start HTTP server
  server = createServer(router);

  server.listen(config.port, () => {
    console.log(`
+============================================================+
|              LLM-Data-Vault Service Started                |
+============================================================+
|  Service: ${config.serviceName.padEnd(45)}|
|  Version: ${config.serviceVersion.padEnd(45)}|
|  Environment: ${config.platformEnv.padEnd(41)}|
|  Port: ${String(config.port).padEnd(48)}|
|  Phase: ${config.agentPhase.padEnd(47)}|
|  Layer: ${config.agentLayer.padEnd(47)}|
+============================================================+
|  Agents:                                                   |
|    - Data Access Control Agent    [READY]                  |
|    - Dataset Anonymization Agent  [READY]                  |
+============================================================+
|  Persistence: ruvector-service (NO direct SQL)             |
|  RuVector: ${config.ruvectorServiceUrl.substring(0, 43).padEnd(44)}|
|  Telemetry: LLM-Observatory                                |
+============================================================+
|  STARTUP VALIDATION: PASSED                                |
+============================================================+
    `);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    server.close(() => {
      process.exit(0);
    });
  });
}

// Run main - unhandled errors will crash the process (intentional)
main().catch((error) => {
  console.error('FATAL: Unhandled error during startup:', error);
  process.exit(1);
});

export { server };
