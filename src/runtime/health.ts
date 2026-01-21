/**
 * @fileoverview Health check endpoints for Edge Function runtime
 * @module runtime/health
 *
 * Provides health and readiness check endpoints for monitoring
 * and orchestration systems.
 */

import type {
  HealthCheckResponse,
  ReadinessCheckResponse,
  HealthStatus,
  ComponentHealth,
  DependencyStatus,
} from './types.js';
import { getConfig, getServiceMetadata } from './config.js';
import { getRegistry } from './function-registry.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Health check timeout in milliseconds
 */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Start time for uptime calculation
 */
const START_TIME = Date.now();

// =============================================================================
// Dependency Checkers
// =============================================================================

/**
 * Checks if RuVector service is reachable
 *
 * @returns Dependency status
 */
async function checkRuvectorHealth(): Promise<DependencyStatus> {
  const config = getConfig();
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      HEALTH_CHECK_TIMEOUT_MS
    );

    const response = await fetch(`${config.ruvectorServiceUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const available = response.ok;
    // latencyMs could be used for future metrics
    void (Date.now() - startTime);

    return {
      available,
      name: 'ruvector',
      lastSuccessfulCheck: available ? new Date().toISOString() : undefined,
      error: available ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    const errorObj = error as Error;
    return {
      available: false,
      name: 'ruvector',
      error: errorObj.name === 'AbortError' ? 'Timeout' : errorObj.message,
    };
  }
}

/**
 * Checks if telemetry endpoint is reachable
 *
 * @returns Dependency status
 */
async function checkTelemetryHealth(): Promise<DependencyStatus> {
  const config = getConfig();

  // If telemetry is disabled, return available
  if (!config.features.telemetryEnabled) {
    return {
      available: true,
      name: 'telemetry',
      lastSuccessfulCheck: new Date().toISOString(),
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      HEALTH_CHECK_TIMEOUT_MS
    );

    // Try HEAD request to telemetry endpoint
    const response = await fetch(config.telemetryEndpoint, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return {
      available: response.ok || response.status === 405, // 405 is acceptable
      name: 'telemetry',
      lastSuccessfulCheck: new Date().toISOString(),
      error: response.ok || response.status === 405 ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    const errorObj = error as Error;
    return {
      available: false,
      name: 'telemetry',
      error: errorObj.name === 'AbortError' ? 'Timeout' : errorObj.message,
    };
  }
}

// =============================================================================
// Component Health Checkers
// =============================================================================

/**
 * Checks registry component health
 *
 * @returns Component health
 */
function checkRegistryHealth(): ComponentHealth {
  const registry = getRegistry();

  return {
    status: registry.size > 0 ? 'healthy' : 'degraded',
    name: 'registry',
    lastCheck: new Date().toISOString(),
    details: {
      handlerCount: registry.size,
      registeredAgents: registry.listAgentIds(),
    },
  };
}

/**
 * Checks memory usage health
 *
 * @returns Component health
 */
function checkMemoryHealth(): ComponentHealth {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
  const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  let status: HealthStatus = 'healthy';
  if (heapUsagePercent > 90) {
    status = 'unhealthy';
  } else if (heapUsagePercent > 75) {
    status = 'degraded';
  }

  return {
    status,
    name: 'memory',
    lastCheck: new Date().toISOString(),
    details: {
      heapUsedMB: Math.round(heapUsedMB * 100) / 100,
      heapTotalMB: Math.round(heapTotalMB * 100) / 100,
      heapUsagePercent: Math.round(heapUsagePercent * 100) / 100,
      externalMB: Math.round((memUsage.external / 1024 / 1024) * 100) / 100,
    },
  };
}

/**
 * Checks configuration health
 *
 * @returns Component health
 */
function checkConfigHealth(): ComponentHealth {
  try {
    const config = getConfig();
    const metadata = getServiceMetadata();

    return {
      status: 'healthy',
      name: 'config',
      lastCheck: new Date().toISOString(),
      details: {
        serviceName: metadata.name,
        environment: metadata.environment,
        featuresEnabled: {
          telemetry: config.features.telemetryEnabled,
          caching: config.features.cachingEnabled,
          healthChecks: config.features.healthChecksEnabled,
          metrics: config.features.metricsEnabled,
          debug: config.features.debugMode,
        },
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      name: 'config',
      lastCheck: new Date().toISOString(),
      details: {
        error: (error as Error).message,
      },
    };
  }
}

// =============================================================================
// Health Check Handlers
// =============================================================================

/**
 * Performs basic health check
 *
 * Returns basic health status without checking external dependencies.
 * Used by load balancers and orchestration systems for quick health assessment.
 *
 * @returns Health check response
 */
export function healthCheck(): HealthCheckResponse {
  const metadata = getServiceMetadata();
  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);

  const checks: Record<string, ComponentHealth> = {
    registry: checkRegistryHealth(),
    memory: checkMemoryHealth(),
    config: checkConfigHealth(),
  };

  // Determine overall status
  const statuses = Object.values(checks).map((c) => c.status);
  let overallStatus: HealthStatus = 'healthy';

  if (statuses.includes('unhealthy')) {
    overallStatus = 'unhealthy';
  } else if (statuses.includes('degraded')) {
    overallStatus = 'degraded';
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: metadata.version,
    uptimeSeconds,
    checks,
  };
}

/**
 * Performs readiness check
 *
 * Checks if all required dependencies are available and the service
 * is ready to accept requests.
 *
 * @returns Readiness check response
 */
export async function readinessCheck(): Promise<ReadinessCheckResponse> {
  const dependencies: Record<string, DependencyStatus> = {};

  // Check RuVector (required)
  dependencies['ruvector'] = await checkRuvectorHealth();

  // Check telemetry (optional)
  dependencies['telemetry'] = await checkTelemetryHealth();

  // Check registry has handlers
  const registry = getRegistry();
  dependencies['handlers'] = {
    available: registry.size > 0,
    name: 'handlers',
    lastSuccessfulCheck:
      registry.size > 0 ? new Date().toISOString() : undefined,
    error: registry.size > 0 ? undefined : 'No handlers registered',
  };

  // Determine if ready
  // RuVector is required, others are optional
  const ready = dependencies['ruvector']?.available ?? false;

  return {
    ready,
    reason: ready ? undefined : 'RuVector service unavailable',
    dependencies,
  };
}

/**
 * Gets agent metadata for health endpoint
 *
 * @returns Agent metadata summary
 */
export function getAgentsSummary(): {
  readonly count: number;
  readonly agents: readonly { id: string; name: string; version: string }[];
} {
  const registry = getRegistry();
  const metadata = registry.getMetadata();

  return {
    count: metadata.handlerCount,
    agents: metadata.agents.map((a) => ({
      id: a.agentId,
      name: a.name,
      version: a.version,
    })),
  };
}

// =============================================================================
// HTTP Handlers
// =============================================================================

/**
 * HTTP response for health checks
 */
export interface HealthHttpResponse {
  /** HTTP status code */
  readonly statusCode: number;
  /** Response body */
  readonly body: HealthCheckResponse | ReadinessCheckResponse;
  /** Response headers */
  readonly headers: Record<string, string>;
}

/**
 * Handles /health HTTP request
 *
 * @returns HTTP response for health check
 */
export function handleHealthRequest(): HealthHttpResponse {
  const response = healthCheck();

  return {
    statusCode: response.status === 'unhealthy' ? 503 : 200,
    body: response,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  };
}

/**
 * Handles /ready HTTP request
 *
 * @returns HTTP response for readiness check
 */
export async function handleReadyRequest(): Promise<HealthHttpResponse> {
  const response = await readinessCheck();

  return {
    statusCode: response.ready ? 200 : 503,
    body: response,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...(response.ready ? {} : { 'Retry-After': '10' }),
    },
  };
}

/**
 * Handles /agents HTTP request
 *
 * @returns HTTP response with agent metadata
 */
export function handleAgentsRequest(): HealthHttpResponse {
  const summary = getAgentsSummary();

  return {
    statusCode: 200,
    body: summary as unknown as HealthCheckResponse,
    headers: {
      'Content-Type': 'application/json',
    },
  };
}
