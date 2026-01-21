/**
 * LLM-Data-Vault: Data Access Control RuVector Client
 *
 * Specialized client for persisting Data Access Control decision events
 * to ruvector-service. This wraps the base RuVectorClient with
 * agent-specific functionality.
 *
 * CONSTITUTIONAL REQUIREMENT:
 * - NO direct SQL - only HTTP calls to ruvector-service
 * - Async, non-blocking writes
 * - Exponential backoff retry logic
 *
 * @module agents/data-access-control/ruvector-client
 */

import {
  RuVectorClient,
  type RuVectorConfig,
  type PersistResult,
} from '../../ruvector-client/index.js';
import type { DecisionEvent } from '../../contracts/index.js';
import { getTelemetry } from '../../telemetry/index.js';

/**
 * Extended configuration for Data Access Control client
 */
export interface DataAccessRuVectorConfig extends RuVectorConfig {
  /** Enable async fire-and-forget mode (non-blocking) */
  asyncMode?: boolean;
  /** Maximum queue size for async mode */
  maxQueueSize?: number;
  /** Flush interval in milliseconds for async mode */
  flushIntervalMs?: number;
  /** Enable circuit breaker */
  enableCircuitBreaker?: boolean;
  /** Circuit breaker failure threshold */
  circuitBreakerThreshold?: number;
  /** Circuit breaker reset timeout in ms */
  circuitBreakerResetMs?: number;
}

/**
 * Circuit breaker states
 */
type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Queued decision event
 */
interface QueuedEvent {
  event: DecisionEvent;
  resolve: (result: PersistResult) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Data Access Control RuVector Client
 *
 * Provides specialized persistence for data access control decisions
 * with enhanced reliability features:
 * - Async non-blocking mode with queue
 * - Circuit breaker pattern
 * - Enhanced retry logic with exponential backoff
 */
export class DataAccessRuVectorClient {
  private readonly baseClient: RuVectorClient;
  private readonly config: Required<DataAccessRuVectorConfig>;
  private readonly eventQueue: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  // Circuit breaker state
  private circuitState: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  /**
   * Creates a new DataAccessRuVectorClient
   *
   * @param config - Client configuration
   */
  constructor(config: DataAccessRuVectorConfig) {
    this.baseClient = new RuVectorClient(config);

    this.config = {
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      timeout: config.timeout ?? 5000,
      retries: config.retries ?? 3,
      retryBackoff: config.retryBackoff ?? 2.0,
      asyncMode: config.asyncMode ?? false,
      maxQueueSize: config.maxQueueSize ?? 1000,
      flushIntervalMs: config.flushIntervalMs ?? 5000,
      enableCircuitBreaker: config.enableCircuitBreaker ?? true,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: config.circuitBreakerResetMs ?? 30000,
    };

    // Start flush timer if async mode is enabled
    if (this.config.asyncMode) {
      this.startFlushTimer();
    }
  }

  /**
   * Persist a decision event to ruvector-service
   *
   * If asyncMode is enabled, this queues the event and returns immediately.
   * Otherwise, it persists synchronously with retries.
   *
   * @param event - Decision event to persist
   * @returns Persistence result
   */
  async persistDecision(event: DecisionEvent): Promise<PersistResult> {
    // Check circuit breaker
    if (this.config.enableCircuitBreaker && !this.canAttempt()) {
      return {
        success: false,
        error: {
          code: 'CIRCUIT_OPEN',
          message: 'Circuit breaker is open - service unavailable',
          retryable: true,
        },
      };
    }

    // Async mode - queue and return immediately
    if (this.config.asyncMode) {
      return this.queueEvent(event);
    }

    // Synchronous mode - persist with retry
    return this.persistWithRetry(event);
  }

  /**
   * Queue an event for async persistence
   */
  private queueEvent(event: DecisionEvent): Promise<PersistResult> {
    return new Promise((resolve, reject) => {
      // Check queue capacity
      if (this.eventQueue.length >= this.config.maxQueueSize) {
        // Remove oldest event and warn
        const dropped = this.eventQueue.shift();
        if (dropped) {
          dropped.reject(new Error('Event dropped due to queue overflow'));
          getTelemetry().emit({
            event_type: 'decision_event_persist_failed',
            timestamp: new Date().toISOString(),
            agent_id: event.agent_id,
            agent_version: event.agent_version,
            execution_ref: event.execution_ref,
            metadata: { reason: 'queue_overflow' },
          });
        }
      }

      this.eventQueue.push({
        event,
        resolve,
        reject,
        timestamp: Date.now(),
      });

      // Return optimistic success for async mode
      resolve({
        success: true,
        event_id: event.execution_ref,
        timestamp: new Date().toISOString(),
      });
    });
  }

  /**
   * Persist event with exponential backoff retry
   */
  private async persistWithRetry(event: DecisionEvent): Promise<PersistResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const result = await this.baseClient.persistDecisionEvent(event);

        if (result.success) {
          this.recordSuccess();
          return result;
        }

        // Non-retryable error
        if (result.error && !result.error.retryable) {
          this.recordFailure();
          return result;
        }

        lastError = new Error(result.error?.message ?? 'Unknown error');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Wait before retry with exponential backoff
      if (attempt < this.config.retries - 1) {
        const delay = this.calculateBackoffDelay(attempt);
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    this.recordFailure();

    return {
      success: false,
      error: {
        code: 'PERSIST_EXHAUSTED',
        message: lastError?.message ?? 'All retry attempts failed',
        retryable: true,
      },
    };
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    // Base delay with exponential increase
    const baseDelay = 1000; // 1 second
    const exponentialDelay = baseDelay * Math.pow(this.config.retryBackoff, attempt);

    // Add jitter (0-25% of delay)
    const jitter = exponentialDelay * Math.random() * 0.25;

    // Cap at 30 seconds
    return Math.min(exponentialDelay + jitter, 30000);
  }

  /**
   * Start the flush timer for async mode
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      this.flushQueue().catch(err => {
        console.error('Queue flush failed:', err);
      });
    }, this.config.flushIntervalMs);
  }

  /**
   * Flush all queued events
   */
  async flushQueue(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    // Take all events from queue
    const events = this.eventQueue.splice(0, this.eventQueue.length);

    // Group events for batch persist
    const eventBatches = this.batchEvents(events, 100);

    for (const batch of eventBatches) {
      try {
        // Use batch API if available, otherwise persist individually
        const results = await this.baseClient.persistBatch(
          batch.map(e => e.event)
        );

        // Resolve/reject individual promises
        batch.forEach((queuedEvent, index) => {
          const result = results[index];
          if (result?.success) {
            this.recordSuccess();
            queuedEvent.resolve(result);
          } else {
            this.recordFailure();
            queuedEvent.reject(new Error(result?.error?.message ?? 'Batch persist failed'));
          }
        });
      } catch (error) {
        this.recordFailure();
        // Reject all events in batch
        batch.forEach(queuedEvent => {
          queuedEvent.reject(
            error instanceof Error ? error : new Error(String(error))
          );
        });
      }
    }
  }

  /**
   * Batch events into groups
   */
  private batchEvents(events: QueuedEvent[], batchSize: number): QueuedEvent[][] {
    const batches: QueuedEvent[][] = [];

    for (let i = 0; i < events.length; i += batchSize) {
      batches.push(events.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * Check if circuit breaker allows request
   */
  private canAttempt(): boolean {
    if (!this.config.enableCircuitBreaker) return true;

    switch (this.circuitState) {
      case 'closed':
        return true;

      case 'open':
        // Check if reset timeout has passed
        if (Date.now() - this.lastFailureTime >= this.config.circuitBreakerResetMs) {
          this.circuitState = 'half-open';
          return true;
        }
        return false;

      case 'half-open':
        // Allow one request to test
        return true;

      default:
        return true;
    }
  }

  /**
   * Record successful operation
   */
  private recordSuccess(): void {
    this.successCount++;

    if (this.circuitState === 'half-open') {
      // Reset circuit breaker after successful test
      this.circuitState = 'closed';
      this.failureCount = 0;
      this.successCount = 0;
    }
  }

  /**
   * Record failed operation
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.circuitState === 'half-open') {
      // Failed test - reopen circuit
      this.circuitState = 'open';
    } else if (
      this.circuitState === 'closed' &&
      this.failureCount >= this.config.circuitBreakerThreshold
    ) {
      // Threshold reached - open circuit
      this.circuitState = 'open';
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitStatus(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    queueSize: number;
  } {
    return {
      state: this.circuitState,
      failureCount: this.failureCount,
      successCount: this.successCount,
      queueSize: this.eventQueue.length,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; circuitState: CircuitState }> {
    const healthResult = await this.baseClient.healthCheck();

    return {
      healthy: healthResult.healthy && this.circuitState !== 'open',
      latencyMs: healthResult.latency_ms,
      circuitState: this.circuitState,
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining events
    await this.flushQueue();
  }
}

/**
 * Create DataAccessRuVectorClient from environment
 */
export function createDataAccessRuVectorClient(): DataAccessRuVectorClient {
  const endpoint = process.env['RUVECTOR_SERVICE_ENDPOINT'];
  const apiKey = process.env['RUVECTOR_SERVICE_API_KEY'];

  if (!endpoint) {
    throw new Error('RUVECTOR_SERVICE_ENDPOINT environment variable is required');
  }
  if (!apiKey) {
    throw new Error('RUVECTOR_SERVICE_API_KEY environment variable is required');
  }

  return new DataAccessRuVectorClient({
    endpoint,
    apiKey,
    timeout: parseInt(process.env['RUVECTOR_TIMEOUT'] ?? '5000', 10),
    retries: parseInt(process.env['RUVECTOR_RETRIES'] ?? '3', 10),
    retryBackoff: parseFloat(process.env['RUVECTOR_BACKOFF'] ?? '2.0'),
    asyncMode: process.env['RUVECTOR_ASYNC_MODE'] === 'true',
    enableCircuitBreaker: process.env['RUVECTOR_CIRCUIT_BREAKER'] !== 'false',
  });
}
