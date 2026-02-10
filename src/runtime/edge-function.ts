/**
 * @fileoverview Base Edge Function class for agent handlers
 * @module runtime/edge-function
 *
 * Provides an abstract base class for implementing Edge Function handlers
 * with built-in input validation, error handling, telemetry, and stateless
 * execution enforcement.
 */

import { z } from 'zod';
import type {
  EdgeRequest,
  EdgeResponse,
  AgentMetadata,
  AgentResult,
  AgentError,
  AgentExecutionMetadata,
} from './types.js';
import {
  startSpan,
  endSpan,
  getTelemetryClient,
  type ActiveSpan,
} from './telemetry.js';
import { getConfig } from './config.js';
import type { AgentSpan, ExecutionGraphBuilder } from './execution-context.js';

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Standard error codes for Edge Function errors
 */
export const ErrorCodes = {
  /** Input validation failed */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** Internal execution error */
  EXECUTION_ERROR: 'EXECUTION_ERROR',
  /** RuVector service unavailable */
  RUVECTOR_UNAVAILABLE: 'RUVECTOR_UNAVAILABLE',
  /** RuVector request failed */
  RUVECTOR_ERROR: 'RUVECTOR_ERROR',
  /** Request timeout */
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  /** Rate limit exceeded */
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  /** Unauthorized access */
  UNAUTHORIZED_ERROR: 'UNAUTHORIZED_ERROR',
  /** Resource not found */
  NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',
  /** Unknown error */
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// =============================================================================
// Edge Function Error
// =============================================================================

/**
 * Custom error class for Edge Function errors
 */
export class EdgeFunctionError extends Error {
  /**
   * Creates a new Edge Function error
   *
   * @param code - Error code
   * @param message - Error message
   * @param retryable - Whether the error is retryable
   * @param details - Additional error details
   */
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'EdgeFunctionError';
  }

  /**
   * Converts to AgentError format
   *
   * @returns AgentError object
   */
  toAgentError(): AgentError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

// =============================================================================
// Abstract Edge Function
// =============================================================================

/**
 * Configuration options for Edge Functions
 */
export interface EdgeFunctionOptions {
  /** Enable request caching */
  enableCaching?: boolean;
  /** Maximum retries for RuVector calls */
  maxRetries?: number;
  /** Retry delay in milliseconds */
  retryDelayMs?: number;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Abstract base class for Edge Function handlers
 *
 * @template TInput - Input type (validated by Zod schema)
 * @template TOutput - Output type
 *
 * @example
 * ```typescript
 * const InputSchema = z.object({
 *   text: z.string(),
 *   options: z.object({ redact: z.boolean() }).optional(),
 * });
 *
 * type Input = z.infer<typeof InputSchema>;
 *
 * class AnonymizationAgent extends EdgeFunction<Input, AnonymizedOutput> {
 *   readonly metadata = {
 *     agentId: 'anonymization-agent',
 *     name: 'Anonymization Agent',
 *     version: '1.0.0',
 *     decisionTypes: ['anonymization'] as const,
 *   };
 *
 *   protected inputSchema = InputSchema;
 *
 *   protected async execute(input: Input): Promise<AgentResult<AnonymizedOutput>> {
 *     // Implementation
 *   }
 * }
 * ```
 */
export abstract class EdgeFunction<TInput, TOutput> {
  /**
   * Agent metadata for registration and telemetry
   */
  abstract readonly metadata: AgentMetadata;

  /**
   * Zod schema for input validation
   */
  protected abstract readonly inputSchema: z.ZodType<TInput>;

  /**
   * Configuration options
   */
  protected readonly options: Required<EdgeFunctionOptions>;

  /**
   * RuVector service URL
   */
  protected readonly ruvectorUrl: string;

  /**
   * Creates a new Edge Function
   *
   * @param options - Configuration options
   */
  constructor(options: EdgeFunctionOptions = {}) {
    const config = getConfig();
    this.ruvectorUrl = config.ruvectorServiceUrl;
    this.options = {
      enableCaching: options.enableCaching ?? config.features.cachingEnabled,
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      timeoutMs: options.timeoutMs ?? config.server.requestTimeoutMs,
    };
  }

  /**
   * Handles an incoming request
   *
   * This is the main entry point called by the function registry.
   * It performs validation, telemetry, error handling, and stateless execution.
   *
   * Agentics Execution Contract:
   * - If the request carries an ExecutionGraphBuilder, an agent-level span
   *   is created for this handler and attached to the execution graph.
   * - Artifacts (decision events, results) are attached to the agent span.
   * - Agent spans are NEVER shared or merged.
   *
   * @param request - Incoming request
   * @returns Response with result or error
   */
  async handle(request: EdgeRequest): Promise<EdgeResponse<AgentResult<TOutput>>> {
    const startTime = Date.now();
    let span: ActiveSpan | null = null;

    // Agentics: start agent-level execution span if graph builder is present
    const graphBuilder: ExecutionGraphBuilder | undefined = request.executionGraph;
    let agentSpan: AgentSpan | undefined;
    if (graphBuilder) {
      agentSpan = graphBuilder.startAgentSpan(this.metadata.agentId);
    }

    try {
      // Validate input
      const validatedInput = this.validateInput(request.body);

      // Start telemetry span
      span = startSpan({
        agentId: this.metadata.agentId,
        agentVersion: this.metadata.version,
        decisionType: this.metadata.decisionTypes[0] ?? 'data_classification',
        requestId: request.requestId,
        source: request.headers['x-source-service'] as string | undefined,
      });

      // Execute the handler
      const result = await this.executeWithRetry(validatedInput, request);

      // Record telemetry
      const event = endSpan(span, {
        success: result.success,
        confidence: result.confidence,
        errorCode: result.error?.code,
        errorMessage: result.error?.message,
      });
      getTelemetryClient().record(event);

      // Add execution metadata
      const metadata: AgentExecutionMetadata = {
        durationMs: Date.now() - startTime,
        cached: false,
        retryAttempts: 0,
      };

      // Agentics: complete agent span and attach result artifact
      if (graphBuilder && agentSpan) {
        graphBuilder.attachArtifact(agentSpan, {
          id: `result-${request.requestId}`,
          type: 'agent_result',
          hash: event.spanId,
        });
        if (result.success) {
          graphBuilder.completeAgentSpan(agentSpan);
        } else {
          graphBuilder.failAgentSpan(agentSpan, [
            result.error?.message ?? 'Agent returned unsuccessful result',
          ]);
        }
      }

      return this.createResponse(200, {
        ...result,
        metadata,
      });
    } catch (error) {
      // Handle and record error
      const agentError = this.handleError(error);

      if (span) {
        const event = endSpan(span, {
          success: false,
          errorCode: agentError.code,
          errorMessage: agentError.message,
        });
        getTelemetryClient().record(event);
      }

      // Agentics: fail agent span on error
      if (graphBuilder && agentSpan) {
        graphBuilder.failAgentSpan(agentSpan, [
          `${agentError.code}: ${agentError.message}`,
        ]);
      }

      const statusCode = this.getStatusCodeForError(agentError.code);

      return this.createResponse(statusCode, {
        success: false,
        error: agentError,
        metadata: {
          durationMs: Date.now() - startTime,
          cached: false,
          retryAttempts: 0,
        },
      });
    }
  }

  /**
   * Executes the agent logic
   *
   * This is the main method to override in derived classes.
   * Must be stateless and idempotent.
   *
   * @param input - Validated input
   * @param request - Original request (for context)
   * @returns Agent result
   */
  protected abstract execute(
    input: TInput,
    request: EdgeRequest<TInput>
  ): Promise<AgentResult<TOutput>>;

  /**
   * Validates input against the schema
   *
   * @param input - Raw input
   * @returns Validated input
   * @throws EdgeFunctionError on validation failure
   */
  protected validateInput(input: unknown): TInput {
    const result = this.inputSchema.safeParse(input);

    if (!result.success) {
      throw new EdgeFunctionError(
        ErrorCodes.VALIDATION_ERROR,
        'Input validation failed',
        false,
        result.error.errors
      );
    }

    return result.data;
  }

  /**
   * Executes with retry logic
   *
   * @param input - Validated input
   * @param request - Original request
   * @returns Agent result
   */
  private async executeWithRetry(
    input: TInput,
    request: EdgeRequest
  ): Promise<AgentResult<TOutput>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        // Create a typed request
        const typedRequest: EdgeRequest<TInput> = {
          ...request,
          body: input,
        };

        return await this.executeWithTimeout(typedRequest);
      } catch (error) {
        lastError = error as Error;

        // Only retry on retryable errors
        if (error instanceof EdgeFunctionError && !error.retryable) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt < this.options.maxRetries) {
          await this.delay(this.options.retryDelayMs * Math.pow(2, attempt));
        }
      }
    }

    throw lastError ?? new Error('Unknown error during execution');
  }

  /**
   * Executes with timeout
   *
   * @param request - Typed request
   * @returns Agent result
   */
  private async executeWithTimeout(
    request: EdgeRequest<TInput>
  ): Promise<AgentResult<TOutput>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      return await this.execute(request.body, request);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handles errors and converts to AgentError
   *
   * @param error - Error to handle
   * @returns AgentError
   */
  private handleError(error: unknown): AgentError {
    if (error instanceof EdgeFunctionError) {
      return error.toAgentError();
    }

    if (error instanceof z.ZodError) {
      return {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Input validation failed',
        details: error.errors,
        retryable: false,
      };
    }

    const errorObj = error as Error;

    return {
      code: ErrorCodes.UNKNOWN_ERROR,
      message: errorObj.message ?? 'An unknown error occurred',
      retryable: false,
    };
  }

  /**
   * Maps error codes to HTTP status codes
   *
   * @param code - Error code
   * @returns HTTP status code
   */
  private getStatusCodeForError(code: string): number {
    switch (code) {
      case ErrorCodes.VALIDATION_ERROR:
        return 400;
      case ErrorCodes.UNAUTHORIZED_ERROR:
        return 401;
      case ErrorCodes.NOT_FOUND_ERROR:
        return 404;
      case ErrorCodes.RATE_LIMIT_ERROR:
        return 429;
      case ErrorCodes.RUVECTOR_UNAVAILABLE:
        return 503;
      case ErrorCodes.TIMEOUT_ERROR:
        return 504;
      default:
        return 500;
    }
  }

  /**
   * Creates a response object
   *
   * @param statusCode - HTTP status code
   * @param body - Response body
   * @returns EdgeResponse
   */
  protected createResponse(
    statusCode: number,
    body: AgentResult<TOutput>
  ): EdgeResponse<AgentResult<TOutput>> {
    return {
      statusCode,
      body,
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Id': this.metadata.agentId,
        'X-Agent-Version': this.metadata.version,
      },
    };
  }

  /**
   * Delays execution
   *
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Makes a request to the RuVector service
   *
   * Helper method for derived classes to call RuVector.
   *
   * @param path - API path
   * @param body - Request body
   * @returns Response data
   * @throws EdgeFunctionError on failure
   */
  protected async callRuvector<TReq, TRes>(
    path: string,
    body: TReq
  ): Promise<TRes> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.ruvectorUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new EdgeFunctionError(
          ErrorCodes.RUVECTOR_ERROR,
          `RuVector request failed: ${response.status}`,
          response.status >= 500
        );
      }

      const data = (await response.json()) as TRes;

      // Log RuVector call duration for debugging
      const duration = Date.now() - startTime;
      if (getConfig().features.debugMode) {
        console.debug(`RuVector call to ${path} took ${duration}ms`);
      }

      return data;
    } catch (error) {
      if (error instanceof EdgeFunctionError) {
        throw error;
      }

      throw new EdgeFunctionError(
        ErrorCodes.RUVECTOR_UNAVAILABLE,
        'RuVector service unavailable',
        true,
        error
      );
    }
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for EdgeFunctionError
 *
 * @param error - Error to check
 * @returns True if error is EdgeFunctionError
 */
export function isEdgeFunctionError(error: unknown): error is EdgeFunctionError {
  return error instanceof EdgeFunctionError;
}

/**
 * Type guard for AgentResult success
 *
 * @param result - Result to check
 * @returns True if result is successful
 */
export function isSuccessResult<T>(
  result: AgentResult<T>
): result is AgentResult<T> & { success: true; data: T } {
  return result.success && result.data !== undefined;
}
