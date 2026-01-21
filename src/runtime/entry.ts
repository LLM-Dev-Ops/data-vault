/**
 * @fileoverview Main entry point for Edge Function runtime
 * @module runtime/entry
 *
 * Initializes the runtime, registers agents, and starts the HTTP server
 * for local development or exports for Edge Function deployment.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { EdgeRequest, EdgeResponse } from './types.js';
import {
  getConfig,
  getServiceMetadata,
  validateConfig,
  reloadConfig,
} from './config.js';
import { initTelemetry, shutdownTelemetry, generateTraceId } from './telemetry.js';
import {
  createRegistry,
  getRegistry,
  routeRequest,
  type FunctionRegistry,
} from './function-registry.js';
import {
  handleHealthRequest,
  handleReadyRequest,
  handleAgentsRequest,
} from './health.js';
import type { EdgeFunction } from './edge-function.js';

// =============================================================================
// Runtime State
// =============================================================================

/**
 * Runtime state
 */
interface RuntimeState {
  /** Whether runtime is initialized */
  initialized: boolean;
  /** HTTP server instance (for local dev) */
  server: ReturnType<typeof createServer> | null;
  /** Shutdown handlers */
  shutdownHandlers: Array<() => Promise<void>>;
}

const state: RuntimeState = {
  initialized: false,
  server: null,
  shutdownHandlers: [],
};

// =============================================================================
// Initialization
// =============================================================================

/**
 * Runtime initialization options
 */
export interface RuntimeOptions {
  /** Service name */
  serviceName?: string;
  /** Service version */
  version?: string;
  /** Agent handlers to register */
  handlers?: Array<EdgeFunction<unknown, unknown>>;
  /** Skip config validation */
  skipValidation?: boolean;
}

/**
 * Initializes the Edge Function runtime
 *
 * @param options - Initialization options
 * @returns Function registry for additional registration
 */
export function initRuntime(options: RuntimeOptions = {}): FunctionRegistry {
  if (state.initialized) {
    console.warn('Runtime already initialized');
    return getRegistry();
  }

  // Reload config
  reloadConfig();

  // Validate config
  if (!options.skipValidation) {
    const errors = validateConfig();
    if (errors.length > 0) {
      console.error('Configuration errors:');
      errors.forEach((e) => console.error(`  - ${e}`));
      throw new Error('Invalid configuration');
    }
  }

  // Get metadata
  const metadata = getServiceMetadata();
  const serviceName = options.serviceName ?? metadata.name;
  const version = options.version ?? metadata.version;

  // Create registry
  const registry = createRegistry(serviceName, version);

  // Register handlers
  if (options.handlers) {
    for (const handler of options.handlers) {
      registry.register(handler);
    }
  }

  // Initialize telemetry
  const config = getConfig();
  if (config.features.telemetryEnabled) {
    initTelemetry();
  }

  state.initialized = true;

  console.log(`Runtime initialized: ${serviceName} v${version}`);
  console.log(`  - Environment: ${metadata.environment}`);
  console.log(`  - Log level: ${config.logLevel}`);
  console.log(`  - Handlers: ${registry.size}`);

  return registry;
}

// =============================================================================
// Request Handling
// =============================================================================

/**
 * Parses an incoming HTTP request into an EdgeRequest
 *
 * @param req - Incoming HTTP request
 * @returns Parsed EdgeRequest
 */
async function parseRequest(req: IncomingMessage): Promise<EdgeRequest> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // Parse query parameters
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = query[key];
    if (existing !== undefined) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        query[key] = [existing, value];
      }
    } else {
      query[key] = value;
    }
  }

  // Parse body
  let body: unknown = {};
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const rawBody = Buffer.concat(chunks).toString('utf-8');
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
  }

  // Convert headers
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key.toLowerCase()] = value;
  }

  return {
    requestId: (headers['x-request-id'] as string) ?? generateTraceId(),
    body,
    headers,
    query,
    method: req.method ?? 'GET',
    path: url.pathname,
    timestamp: Date.now(),
    sourceIp: req.socket.remoteAddress,
    userAgent: headers['user-agent'] as string | undefined,
  };
}

/**
 * Sends an EdgeResponse as HTTP response
 *
 * @param res - HTTP response object
 * @param edgeResponse - Edge response to send
 */
function sendResponse(res: ServerResponse, edgeResponse: EdgeResponse): void {
  // Set headers
  res.setHeader('Content-Type', 'application/json');
  if (edgeResponse.headers) {
    for (const [key, value] of Object.entries(edgeResponse.headers)) {
      res.setHeader(key, value);
    }
  }

  // Send response
  res.statusCode = edgeResponse.statusCode;
  res.end(JSON.stringify(edgeResponse.body));
}

/**
 * Handles an incoming HTTP request
 *
 * @param req - Incoming request
 * @param res - Server response
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const startTime = Date.now();
  const config = getConfig();

  try {
    const edgeRequest = await parseRequest(req);

    // Log request
    if (config.features.debugMode) {
      console.debug(`${edgeRequest.method} ${edgeRequest.path}`);
    }

    // Handle special routes
    if (edgeRequest.path === '/health' && edgeRequest.method === 'GET') {
      const healthResponse = handleHealthRequest();
      res.statusCode = healthResponse.statusCode;
      res.setHeader('Content-Type', 'application/json');
      for (const [key, value] of Object.entries(healthResponse.headers)) {
        res.setHeader(key, value);
      }
      res.end(JSON.stringify(healthResponse.body));
      return;
    }

    if (edgeRequest.path === '/ready' && edgeRequest.method === 'GET') {
      const readyResponse = await handleReadyRequest();
      res.statusCode = readyResponse.statusCode;
      res.setHeader('Content-Type', 'application/json');
      for (const [key, value] of Object.entries(readyResponse.headers)) {
        res.setHeader(key, value);
      }
      res.end(JSON.stringify(readyResponse.body));
      return;
    }

    if (edgeRequest.path === '/agents' && edgeRequest.method === 'GET') {
      const agentsResponse = handleAgentsRequest();
      res.statusCode = agentsResponse.statusCode;
      res.setHeader('Content-Type', 'application/json');
      for (const [key, value] of Object.entries(agentsResponse.headers)) {
        res.setHeader(key, value);
      }
      res.end(JSON.stringify(agentsResponse.body));
      return;
    }

    // Route to handler
    const edgeResponse = await routeRequest(edgeRequest);
    sendResponse(res, edgeResponse);

    // Log response
    if (config.features.debugMode) {
      const duration = Date.now() - startTime;
      console.debug(`  -> ${edgeResponse.statusCode} (${duration}ms)`);
    }
  } catch (error) {
    console.error('Request handling error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          retryable: false,
        },
      })
    );
  }
}

// =============================================================================
// HTTP Server (Local Development)
// =============================================================================

/**
 * Starts the HTTP server for local development
 *
 * @returns Promise that resolves when server is listening
 */
export function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!state.initialized) {
      reject(new Error('Runtime not initialized. Call initRuntime() first.'));
      return;
    }

    const config = getConfig();

    state.server = createServer((req, res) => {
      void handleRequest(req, res);
    });

    state.server.on('error', (error) => {
      console.error('Server error:', error);
      reject(error);
    });

    state.server.listen(config.server.port, config.server.host, () => {
      console.log(
        `Server listening on http://${config.server.host}:${config.server.port}`
      );
      resolve();
    });
  });
}

/**
 * Stops the HTTP server
 *
 * @returns Promise that resolves when server is closed
 */
export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!state.server) {
      resolve();
      return;
    }

    state.server.close(() => {
      state.server = null;
      console.log('Server stopped');
      resolve();
    });
  });
}

// =============================================================================
// Graceful Shutdown
// =============================================================================

/**
 * Registers a shutdown handler
 *
 * @param handler - Handler to call on shutdown
 */
export function onShutdown(handler: () => Promise<void>): void {
  state.shutdownHandlers.push(handler);
}

/**
 * Performs graceful shutdown
 */
async function shutdown(): Promise<void> {
  console.log('Shutting down...');

  // Stop server
  await stopServer();

  // Run shutdown handlers
  for (const handler of state.shutdownHandlers) {
    try {
      await handler();
    } catch (error) {
      console.error('Shutdown handler error:', error);
    }
  }

  // Shutdown telemetry
  await shutdownTelemetry();

  state.initialized = false;
  console.log('Shutdown complete');
}

// Register signal handlers
process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});

// =============================================================================
// Edge Function Exports (for Cloud Deployment)
// =============================================================================

/**
 * HTTP entry point for Google Cloud Functions
 *
 * @param req - HTTP request
 * @param res - HTTP response
 */
export async function httpFunction(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Initialize on first request if needed
  if (!state.initialized) {
    initRuntime({ skipValidation: true });
  }

  await handleRequest(req, res);
}

/**
 * CloudEvent entry point for event-driven functions
 *
 * @param cloudEvent - Cloud event
 * @returns Processing result
 */
export async function cloudEventFunction(cloudEvent: {
  type: string;
  data: unknown;
  source: string;
  id: string;
}): Promise<unknown> {
  // Initialize on first event if needed
  if (!state.initialized) {
    initRuntime({ skipValidation: true });
  }

  const request: EdgeRequest = {
    requestId: cloudEvent.id,
    body: cloudEvent.data,
    headers: {
      'ce-type': cloudEvent.type,
      'ce-source': cloudEvent.source,
      'ce-id': cloudEvent.id,
    },
    query: {},
    method: 'POST',
    path: `/events/${cloudEvent.type}`,
    timestamp: Date.now(),
  };

  const response = await routeRequest(request);
  return response.body;
}

// =============================================================================
// Module Exports
// =============================================================================

export { getRegistry, getConfig, getServiceMetadata };
export type { EdgeRequest, EdgeResponse, FunctionRegistry };
