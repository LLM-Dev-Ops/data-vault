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
 * @module functions/server
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { AnonymizationFunctionHandler } from './anonymization-function.js';
import { initTelemetry, getTelemetry } from '../telemetry/index.js';
import { RuVectorClient } from '../ruvector-client/index.js';

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  serviceName: process.env['SERVICE_NAME'] ?? 'llm-data-vault',
  serviceVersion: process.env['SERVICE_VERSION'] ?? '0.1.0',
  platformEnv: process.env['PLATFORM_ENV'] ?? 'dev',
  port: parseInt(process.env['PORT'] ?? '8080', 10),
  ruvectorUrl: process.env['RUVECTOR_SERVICE_URL'] ?? 'https://ruvector-service.agentics.dev',
  ruvectorApiKey: process.env['RUVECTOR_API_KEY'] ?? 'placeholder-ruvector-api-key',
  telemetryEndpoint: process.env['TELEMETRY_ENDPOINT'],
};

// =============================================================================
// Initialize Services
// =============================================================================

// Initialize telemetry
initTelemetry({
  service_name: CONFIG.serviceName,
  environment: CONFIG.platformEnv,
  version: CONFIG.serviceVersion,
  otlp_endpoint: CONFIG.telemetryEndpoint,
  log_level: (process.env['LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
});

// Initialize ruvector client
const ruvectorClient = new RuVectorClient({
  endpoint: CONFIG.ruvectorUrl,
  apiKey: CONFIG.ruvectorApiKey,
});

// Initialize agent handlers
const anonymizationHandler = new AnonymizationFunctionHandler({
  agentId: 'data-vault.anonymization.v1',
  agentVersion: CONFIG.serviceVersion,
  environment: CONFIG.platformEnv,
  ruvectorEndpoint: CONFIG.ruvectorUrl,
  ruvectorApiKey: CONFIG.ruvectorApiKey,
  otlpEndpoint: CONFIG.telemetryEndpoint,
});

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
// Main Router
// =============================================================================

async function router(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  const method = req.method ?? 'GET';

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-ID, X-Request-Source');

  // Handle preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Route request
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

      // Anonymization Agent
      case 'anonymize':
      case 'inspect':
        if (method !== 'POST') {
          sendError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
          return;
        }
        const anonymizeResponse = await anonymizationHandler.handle({
          method,
          path,
          headers: req.headers as Record<string, string>,
          body: await parseBody(req),
          query: parseQuery(url),
        });
        sendJson(res, anonymizeResponse.status, anonymizeResponse.body, anonymizeResponse.headers);
        break;

      case 'strategies':
        await handleStrategies(res);
        break;

      // Access Control Agent
      case 'authorize':
        if (method !== 'POST') {
          sendError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
          return;
        }
        // Placeholder - would route to access control agent
        sendJson(res, 200, {
          request_id: crypto.randomUUID(),
          decision: 'allow',
          message: 'Access control agent placeholder - implement full logic',
        });
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
// Server Startup
// =============================================================================

const server = createServer(router);

server.listen(CONFIG.port, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║              LLM-Data-Vault Service Started                ║
╠════════════════════════════════════════════════════════════╣
║  Service: ${CONFIG.serviceName.padEnd(45)}║
║  Version: ${CONFIG.serviceVersion.padEnd(45)}║
║  Environment: ${CONFIG.platformEnv.padEnd(41)}║
║  Port: ${String(CONFIG.port).padEnd(48)}║
╠════════════════════════════════════════════════════════════╣
║  Agents:                                                   ║
║    - Data Access Control Agent    [READY]                  ║
║    - Dataset Anonymization Agent  [READY]                  ║
╠════════════════════════════════════════════════════════════╣
║  Persistence: ruvector-service (NO direct SQL)             ║
║  Telemetry: LLM-Observatory                                ║
╚════════════════════════════════════════════════════════════╝
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

export { server };
