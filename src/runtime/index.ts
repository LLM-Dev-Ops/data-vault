/**
 * @fileoverview Edge Function Runtime for LLM-Data-Vault
 * @module runtime
 *
 * This module provides the complete runtime infrastructure for deploying
 * LLM-Data-Vault agents as Edge Functions. It includes:
 *
 * - Base Edge Function class with input validation and telemetry
 * - Function registry for handler registration and routing
 * - OpenTelemetry-compatible telemetry for LLM-Observatory
 * - Health and readiness check endpoints
 * - Configuration management via environment variables
 *
 * @example
 * ```typescript
 * import {
 *   initRuntime,
 *   startServer,
 *   EdgeFunction,
 *   registerHandler,
 * } from '@llm-data-vault/runtime';
 * import { z } from 'zod';
 *
 * // Define input schema
 * const InputSchema = z.object({
 *   text: z.string(),
 * });
 *
 * // Create agent handler
 * class MyAgent extends EdgeFunction<z.infer<typeof InputSchema>, string> {
 *   readonly metadata = {
 *     agentId: 'my-agent',
 *     name: 'My Agent',
 *     version: '1.0.0',
 *     decisionTypes: ['data_classification'] as const,
 *   };
 *
 *   protected readonly inputSchema = InputSchema;
 *
 *   protected async execute(input) {
 *     return {
 *       success: true,
 *       data: `Processed: ${input.text}`,
 *       confidence: 1.0,
 *     };
 *   }
 * }
 *
 * // Initialize and start
 * initRuntime({ handlers: [new MyAgent()] });
 * await startServer();
 * ```
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Request/Response
  EdgeRequest,
  EdgeResponse,
  // Agent types
  DecisionType,
  AgentMetadata,
  AgentResult,
  AgentError,
  AgentExecutionMetadata,
  // Telemetry types
  TelemetrySpanAttributes,
  TelemetryEvent,
  TelemetryBatch,
  // Config types
  RuntimeConfig,
  LogLevel,
  FeatureFlags,
  ServerConfig,
  TelemetryConfig,
  // Health types
  HealthStatus,
  HealthCheckResponse,
  ReadinessCheckResponse,
  ComponentHealth,
  DependencyStatus,
  // Utility types
  InferSchema,
  EdgeFunctionHandler,
  Middleware,
} from './types.js';

// =============================================================================
// Edge Function Exports
// =============================================================================

export {
  EdgeFunction,
  EdgeFunctionError,
  ErrorCodes,
  isEdgeFunctionError,
  isSuccessResult,
  type EdgeFunctionOptions,
  type ErrorCode,
} from './edge-function.js';

// =============================================================================
// Function Registry Exports
// =============================================================================

export {
  FunctionRegistry,
  getRegistry,
  createRegistry,
  registerHandler,
  routeRequest,
  type RegistryMetadata,
} from './function-registry.js';

// =============================================================================
// Telemetry Exports
// =============================================================================

export {
  // ID generation
  generateTraceId,
  generateSpanId,
  // Span management
  startSpan,
  endSpan,
  // Client
  TelemetryClient,
  getTelemetryClient,
  initTelemetry,
  shutdownTelemetry,
  // Utilities
  withTelemetry,
  type SpanOptions,
  type SpanResult,
  type ActiveSpan,
} from './telemetry.js';

// =============================================================================
// Config Exports
// =============================================================================

export {
  // Environment variables
  ENV_VARS,
  DEFAULTS,
  // Config loading
  loadConfig,
  getConfig,
  reloadConfig,
  validateConfig,
  // Service metadata
  loadServiceMetadata,
  getServiceMetadata,
  type ServiceMetadata,
} from './config.js';

// =============================================================================
// Health Check Exports
// =============================================================================

export {
  healthCheck,
  readinessCheck,
  getAgentsSummary,
  handleHealthRequest,
  handleReadyRequest,
  handleAgentsRequest,
  type HealthHttpResponse,
} from './health.js';

// =============================================================================
// Entry Point Exports
// =============================================================================

export {
  // Initialization
  initRuntime,
  type RuntimeOptions,
  // HTTP server (local dev)
  startServer,
  stopServer,
  // Shutdown
  onShutdown,
  // Cloud function exports
  httpFunction,
  cloudEventFunction,
} from './entry.js';
