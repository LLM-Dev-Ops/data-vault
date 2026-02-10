/**
 * @fileoverview Type definitions for the Edge Function runtime
 * @module runtime/types
 *
 * This module defines the core types used throughout the Edge Function
 * runtime infrastructure for LLM-Data-Vault agents.
 */

import type { z } from 'zod';
import type {
  ExecutionContext,
  ExecutionGraphBuilder,
  ExecutionGraphOutput,
} from './execution-context.js';

// =============================================================================
// Request/Response Types
// =============================================================================

/**
 * HTTP request context passed to Edge Functions
 */
export interface EdgeRequest<T = unknown> {
  /** Unique request identifier for tracing */
  readonly requestId: string;
  /** Validated and parsed request body */
  readonly body: T;
  /** HTTP headers */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Query parameters */
  readonly query: Readonly<Record<string, string | string[] | undefined>>;
  /** Request method */
  readonly method: string;
  /** Request path */
  readonly path: string;
  /** Timestamp when request was received */
  readonly timestamp: number;
  /** Source IP address */
  readonly sourceIp?: string;
  /** User agent string */
  readonly userAgent?: string;
  /** Agentics execution context (present on agent invocation routes) */
  readonly executionContext?: ExecutionContext;
  /** Agentics execution graph builder (set by entry point for agent routes) */
  readonly executionGraph?: ExecutionGraphBuilder;
}

/**
 * Structured response from Edge Functions
 */
export interface EdgeResponse<T = unknown> {
  /** HTTP status code */
  readonly statusCode: number;
  /** Response body */
  readonly body: T;
  /** Response headers */
  readonly headers?: Readonly<Record<string, string>>;
  /** Whether response body is already serialized */
  readonly isBase64Encoded?: boolean;
  /** Agentics execution graph output (present when execution context was provided) */
  readonly executionGraph?: ExecutionGraphOutput;
}

// =============================================================================
// Agent Types
// =============================================================================

/**
 * Types of decisions agents can make
 */
export type DecisionType =
  | 'anonymization'
  | 'access_control'
  | 'pii_detection'
  | 'data_classification'
  | 'threat_detection'
  | 'lineage_tracking'
  | 'audit_logging';

/**
 * Metadata about an agent handler
 */
export interface AgentMetadata {
  /** Unique agent identifier */
  readonly agentId: string;
  /** Human-readable agent name */
  readonly name: string;
  /** Agent version (semver) */
  readonly version: string;
  /** Types of decisions this agent handles */
  readonly decisionTypes: readonly DecisionType[];
  /** Agent description */
  readonly description?: string;
  /** Expected input schema name */
  readonly inputSchema?: string;
  /** Expected output schema name */
  readonly outputSchema?: string;
}

/**
 * Result from agent execution
 */
export interface AgentResult<T = unknown> {
  /** Whether execution was successful */
  readonly success: boolean;
  /** Result data if successful */
  readonly data?: T;
  /** Error information if failed */
  readonly error?: AgentError;
  /** Confidence score (0-1) for the decision */
  readonly confidence?: number;
  /** Execution metadata */
  readonly metadata?: AgentExecutionMetadata;
}

/**
 * Error information from agent execution
 */
export interface AgentError {
  /** Error code */
  readonly code: string;
  /** Human-readable error message */
  readonly message: string;
  /** Detailed error information */
  readonly details?: unknown;
  /** Whether the error is retryable */
  readonly retryable: boolean;
}

/**
 * Execution metadata for observability
 */
export interface AgentExecutionMetadata {
  /** Execution duration in milliseconds */
  readonly durationMs: number;
  /** RuVector service call duration (if applicable) */
  readonly ruvectorDurationMs?: number;
  /** Whether result was served from cache */
  readonly cached: boolean;
  /** Number of retry attempts */
  readonly retryAttempts: number;
}

// =============================================================================
// Telemetry Types (LLM-Observatory Compatible)
// =============================================================================

/**
 * OpenTelemetry span attributes for agent execution
 */
export interface TelemetrySpanAttributes {
  /** Agent identifier */
  readonly 'agent.id': string;
  /** Agent version */
  readonly 'agent.version': string;
  /** Type of decision made */
  readonly 'decision.type': DecisionType;
  /** Confidence score (0-1) */
  readonly 'decision.confidence'?: number;
  /** Whether execution was successful */
  readonly 'execution.success': boolean;
  /** Execution duration in milliseconds */
  readonly 'execution.duration_ms': number;
  /** Error code if failed */
  readonly 'error.code'?: string;
  /** Error message if failed */
  readonly 'error.message'?: string;
  /** Request identifier for correlation */
  readonly 'request.id': string;
  /** Source service/application */
  readonly 'request.source'?: string;
}

/**
 * Telemetry event for batched reporting
 */
export interface TelemetryEvent {
  /** Event name */
  readonly name: string;
  /** Event timestamp (ISO 8601) */
  readonly timestamp: string;
  /** Trace ID for distributed tracing */
  readonly traceId: string;
  /** Span ID for this specific operation */
  readonly spanId: string;
  /** Parent span ID (if nested) */
  readonly parentSpanId?: string;
  /** Span attributes */
  readonly attributes: TelemetrySpanAttributes;
  /** Event duration in nanoseconds */
  readonly durationNs: number;
  /** Span status */
  readonly status: 'OK' | 'ERROR' | 'UNSET';
}

/**
 * Batch of telemetry events for efficient transmission
 */
export interface TelemetryBatch {
  /** Resource attributes (service info) */
  readonly resource: {
    readonly 'service.name': string;
    readonly 'service.version': string;
    readonly 'deployment.environment': string;
  };
  /** Instrumentation scope */
  readonly scope: {
    readonly name: string;
    readonly version: string;
  };
  /** Array of spans/events */
  readonly spans: readonly TelemetryEvent[];
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Runtime configuration loaded from environment
 */
export interface RuntimeConfig {
  /** RuVector service URL */
  readonly ruvectorServiceUrl: string;
  /** Telemetry endpoint URL */
  readonly telemetryEndpoint: string;
  /** Logging level */
  readonly logLevel: LogLevel;
  /** Feature flags */
  readonly features: FeatureFlags;
  /** HTTP server configuration (for local dev) */
  readonly server: ServerConfig;
  /** Telemetry configuration */
  readonly telemetry: TelemetryConfig;
}

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Feature flags for runtime behavior
 */
export interface FeatureFlags {
  /** Enable telemetry reporting */
  readonly telemetryEnabled: boolean;
  /** Enable request caching */
  readonly cachingEnabled: boolean;
  /** Enable detailed debug logging */
  readonly debugMode: boolean;
  /** Enable health check endpoints */
  readonly healthChecksEnabled: boolean;
  /** Enable metrics collection */
  readonly metricsEnabled: boolean;
}

/**
 * HTTP server configuration
 */
export interface ServerConfig {
  /** Server port */
  readonly port: number;
  /** Server host */
  readonly host: string;
  /** Request timeout in milliseconds */
  readonly requestTimeoutMs: number;
  /** Keep-alive timeout in milliseconds */
  readonly keepAliveTimeoutMs: number;
}

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
  /** Batch size before flushing */
  readonly batchSize: number;
  /** Flush interval in milliseconds */
  readonly flushIntervalMs: number;
  /** Maximum events to queue before dropping */
  readonly maxQueueSize: number;
  /** Sampling rate (0-1) */
  readonly samplingRate: number;
}

// =============================================================================
// Health Check Types
// =============================================================================

/**
 * Health check status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Health check response
 */
export interface HealthCheckResponse {
  /** Overall health status */
  readonly status: HealthStatus;
  /** Health check timestamp */
  readonly timestamp: string;
  /** Service version */
  readonly version: string;
  /** Uptime in seconds */
  readonly uptimeSeconds: number;
  /** Individual component checks */
  readonly checks: Readonly<Record<string, ComponentHealth>>;
}

/**
 * Individual component health status
 */
export interface ComponentHealth {
  /** Component status */
  readonly status: HealthStatus;
  /** Component name */
  readonly name: string;
  /** Last check timestamp */
  readonly lastCheck: string;
  /** Additional details */
  readonly details?: unknown;
  /** Latency to check in milliseconds */
  readonly latencyMs?: number;
}

/**
 * Readiness check response
 */
export interface ReadinessCheckResponse {
  /** Whether service is ready to accept requests */
  readonly ready: boolean;
  /** Reason if not ready */
  readonly reason?: string;
  /** Dependencies and their status */
  readonly dependencies: Readonly<Record<string, DependencyStatus>>;
}

/**
 * Dependency status for readiness check
 */
export interface DependencyStatus {
  /** Whether dependency is available */
  readonly available: boolean;
  /** Dependency name */
  readonly name: string;
  /** Last successful check */
  readonly lastSuccessfulCheck?: string;
  /** Error message if unavailable */
  readonly error?: string;
}

// =============================================================================
// Zod Schema Helpers
// =============================================================================

/**
 * Type helper to infer the type from a Zod schema
 */
export type InferSchema<T extends z.ZodType> = z.infer<T>;

/**
 * Edge Function handler type
 */
export type EdgeFunctionHandler<TInput = unknown, TOutput = unknown> = (
  request: EdgeRequest<TInput>
) => Promise<EdgeResponse<TOutput>>;

/**
 * Middleware function type
 */
export type Middleware = (
  request: EdgeRequest,
  next: () => Promise<EdgeResponse>
) => Promise<EdgeResponse>;
