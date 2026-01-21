/**
 * @fileoverview Function registration and routing for Edge Functions
 * @module runtime/function-registry
 *
 * Manages registration of agent handlers, routes requests to the correct
 * handler, and provides metadata and health check endpoints.
 */

import type {
  EdgeRequest,
  EdgeResponse,
  AgentMetadata,
  AgentResult,
} from './types.js';
import type { EdgeFunction } from './edge-function.js';
import { getConfig } from './config.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Registered handler entry
 */
interface RegisteredHandler {
  /** Agent metadata */
  readonly metadata: AgentMetadata;
  /** Handler instance */
  readonly handler: EdgeFunction<unknown, unknown>;
  /** Registration timestamp */
  readonly registeredAt: number;
  /** Handler health status */
  healthy: boolean;
  /** Last health check timestamp */
  lastHealthCheck: number;
}

/**
 * Route match result
 */
interface RouteMatch {
  /** Handler for the route */
  readonly handler: EdgeFunction<unknown, unknown>;
  /** Extracted path parameters */
  readonly params: Record<string, string>;
}

/**
 * Registry metadata response
 */
export interface RegistryMetadata {
  /** Service name */
  readonly serviceName: string;
  /** Service version */
  readonly version: string;
  /** Number of registered handlers */
  readonly handlerCount: number;
  /** Registered agents */
  readonly agents: readonly AgentMetadata[];
  /** Available routes */
  readonly routes: readonly string[];
  /** Registry uptime in seconds */
  readonly uptimeSeconds: number;
}

// =============================================================================
// Function Registry
// =============================================================================

/**
 * Registry for Edge Function handlers
 *
 * Manages registration, routing, and metadata for agent handlers.
 */
export class FunctionRegistry {
  private readonly handlers: Map<string, RegisteredHandler> = new Map();
  private readonly routes: Map<string, string> = new Map();
  private readonly startTime: number = Date.now();
  private readonly serviceName: string;
  private readonly version: string;

  /**
   * Creates a new function registry
   *
   * @param serviceName - Service name
   * @param version - Service version
   */
  constructor(serviceName: string = 'llm-data-vault-runtime', version: string = '0.1.0') {
    this.serviceName = serviceName;
    this.version = version;
  }

  /**
   * Registers an agent handler
   *
   * @param handler - Edge Function handler to register
   * @param route - Optional custom route (defaults to /agents/{agentId})
   * @throws Error if handler with same ID already registered
   */
  register<TInput, TOutput>(
    handler: EdgeFunction<TInput, TOutput>,
    route?: string
  ): void {
    const { agentId } = handler.metadata;

    if (this.handlers.has(agentId)) {
      throw new Error(`Handler already registered: ${agentId}`);
    }

    const resolvedRoute = route ?? `/agents/${agentId}`;

    this.handlers.set(agentId, {
      metadata: handler.metadata,
      handler: handler as EdgeFunction<unknown, unknown>,
      registeredAt: Date.now(),
      healthy: true,
      lastHealthCheck: Date.now(),
    });

    this.routes.set(resolvedRoute, agentId);

    if (getConfig().features.debugMode) {
      console.debug(`Registered handler: ${agentId} at ${resolvedRoute}`);
    }
  }

  /**
   * Unregisters an agent handler
   *
   * @param agentId - Agent ID to unregister
   * @returns True if handler was unregistered
   */
  unregister(agentId: string): boolean {
    const entry = this.handlers.get(agentId);
    if (!entry) {
      return false;
    }

    // Remove from routes
    for (const [route, id] of this.routes.entries()) {
      if (id === agentId) {
        this.routes.delete(route);
      }
    }

    this.handlers.delete(agentId);
    return true;
  }

  /**
   * Routes a request to the appropriate handler
   *
   * @param request - Incoming request
   * @returns Response from handler or error response
   */
  async route(request: EdgeRequest): Promise<EdgeResponse<AgentResult<unknown>>> {
    // Check for special routes
    if (request.path === '/metadata') {
      return this.handleMetadataRequest();
    }

    // Find handler for route
    const match = this.matchRoute(request.path);

    if (!match) {
      return {
        statusCode: 404,
        body: {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `No handler found for path: ${request.path}`,
            retryable: false,
          },
        },
        headers: {
          'Content-Type': 'application/json',
        },
      };
    }

    // Check handler health
    const entry = this.handlers.get(
      this.routes.get(request.path) ?? this.findAgentIdByPath(request.path) ?? ''
    );

    if (entry && !entry.healthy) {
      return {
        statusCode: 503,
        body: {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Handler is currently unhealthy',
            retryable: true,
          },
        },
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
      };
    }

    // Invoke handler
    return match.handler.handle(request);
  }

  /**
   * Gets metadata for all registered handlers
   *
   * @returns Registry metadata
   */
  getMetadata(): RegistryMetadata {
    const agents = Array.from(this.handlers.values()).map((h) => h.metadata);
    const routes = Array.from(this.routes.keys());

    return {
      serviceName: this.serviceName,
      version: this.version,
      handlerCount: this.handlers.size,
      agents,
      routes,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Gets a handler by agent ID
   *
   * @param agentId - Agent ID
   * @returns Handler if found
   */
  getHandler(agentId: string): EdgeFunction<unknown, unknown> | undefined {
    return this.handlers.get(agentId)?.handler;
  }

  /**
   * Gets metadata for a specific agent
   *
   * @param agentId - Agent ID
   * @returns Agent metadata if found
   */
  getAgentMetadata(agentId: string): AgentMetadata | undefined {
    return this.handlers.get(agentId)?.metadata;
  }

  /**
   * Checks health of all registered handlers
   *
   * @returns Map of agent ID to health status
   */
  async checkHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [agentId, entry] of this.handlers.entries()) {
      // Simple health check - could be extended to ping each handler
      entry.healthy = true;
      entry.lastHealthCheck = Date.now();
      results.set(agentId, entry.healthy);
    }

    return results;
  }

  /**
   * Sets the health status of a handler
   *
   * @param agentId - Agent ID
   * @param healthy - Health status
   */
  setHandlerHealth(agentId: string, healthy: boolean): void {
    const entry = this.handlers.get(agentId);
    if (entry) {
      entry.healthy = healthy;
      entry.lastHealthCheck = Date.now();
    }
  }

  /**
   * Gets the number of registered handlers
   *
   * @returns Handler count
   */
  get size(): number {
    return this.handlers.size;
  }

  /**
   * Lists all registered agent IDs
   *
   * @returns Array of agent IDs
   */
  listAgentIds(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Matches a path to a handler
   *
   * @param path - Request path
   * @returns Route match or undefined
   */
  private matchRoute(path: string): RouteMatch | undefined {
    // Direct match
    const directAgentId = this.routes.get(path);
    if (directAgentId) {
      const entry = this.handlers.get(directAgentId);
      if (entry) {
        return { handler: entry.handler, params: {} };
      }
    }

    // Pattern matching for /agents/{agentId}
    const agentMatch = path.match(/^\/agents\/([^/]+)$/);
    if (agentMatch) {
      const agentId = agentMatch[1];
      if (agentId) {
        const entry = this.handlers.get(agentId);
        if (entry) {
          return { handler: entry.handler, params: { agentId } };
        }
      }
    }

    return undefined;
  }

  /**
   * Finds agent ID by path pattern
   *
   * @param path - Request path
   * @returns Agent ID or undefined
   */
  private findAgentIdByPath(path: string): string | undefined {
    const agentMatch = path.match(/^\/agents\/([^/]+)$/);
    return agentMatch?.[1];
  }

  /**
   * Handles metadata request
   *
   * @returns Metadata response
   */
  private handleMetadataRequest(): EdgeResponse<AgentResult<unknown>> {
    const metadata = this.getMetadata();
    return {
      statusCode: 200,
      body: {
        success: true,
        data: metadata,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    };
  }
}

// =============================================================================
// Singleton Registry
// =============================================================================

let globalRegistry: FunctionRegistry | null = null;

/**
 * Gets the global function registry
 *
 * @returns Function registry singleton
 */
export function getRegistry(): FunctionRegistry {
  if (!globalRegistry) {
    globalRegistry = new FunctionRegistry();
  }
  return globalRegistry;
}

/**
 * Creates and sets a new global registry
 *
 * @param serviceName - Service name
 * @param version - Service version
 * @returns New function registry
 */
export function createRegistry(
  serviceName: string,
  version: string
): FunctionRegistry {
  globalRegistry = new FunctionRegistry(serviceName, version);
  return globalRegistry;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Registers a handler with the global registry
 *
 * @param handler - Handler to register
 * @param route - Optional custom route
 */
export function registerHandler<TInput, TOutput>(
  handler: EdgeFunction<TInput, TOutput>,
  route?: string
): void {
  getRegistry().register(handler, route);
}

/**
 * Routes a request using the global registry
 *
 * @param request - Request to route
 * @returns Response from handler
 */
export function routeRequest(
  request: EdgeRequest
): Promise<EdgeResponse<AgentResult<unknown>>> {
  return getRegistry().route(request);
}
