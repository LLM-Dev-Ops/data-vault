/**
 * @fileoverview Telemetry integration for LLM-Observatory
 * @module runtime/telemetry
 *
 * Provides OpenTelemetry-compatible telemetry reporting with batching,
 * sampling, and efficient event transmission to LLM-Observatory.
 */

import type {
  TelemetryEvent,
  TelemetryBatch,
  TelemetrySpanAttributes,
  DecisionType,
} from './types.js';
import { getConfig, getServiceMetadata } from './config.js';

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generates a random trace ID (32 hex characters)
 *
 * @returns A 32-character hex string
 */
export function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generates a random span ID (16 hex characters)
 *
 * @returns A 16-character hex string
 */
export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// =============================================================================
// Span Builder
// =============================================================================

/**
 * Options for creating a span
 */
export interface SpanOptions {
  /** Agent ID */
  agentId: string;
  /** Agent version */
  agentVersion: string;
  /** Decision type */
  decisionType: DecisionType;
  /** Request ID for correlation */
  requestId: string;
  /** Optional parent span ID */
  parentSpanId?: string;
  /** Optional trace ID (generated if not provided) */
  traceId?: string;
  /** Optional source service */
  source?: string;
}

/**
 * Result data for completing a span
 */
export interface SpanResult {
  /** Whether execution was successful */
  success: boolean;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Error code if failed */
  errorCode?: string;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Active span for tracking execution
 */
export interface ActiveSpan {
  /** Trace ID */
  readonly traceId: string;
  /** Span ID */
  readonly spanId: string;
  /** Parent span ID */
  readonly parentSpanId?: string;
  /** Start timestamp in nanoseconds */
  readonly startTimeNs: bigint;
  /** Span options */
  readonly options: SpanOptions;
}

/**
 * Creates a new active span
 *
 * @param options - Span creation options
 * @returns Active span for tracking
 */
export function startSpan(options: SpanOptions): ActiveSpan {
  return {
    traceId: options.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: options.parentSpanId,
    startTimeNs: process.hrtime.bigint(),
    options,
  };
}

/**
 * Completes a span and creates a telemetry event
 *
 * @param span - Active span to complete
 * @param result - Execution result
 * @returns Telemetry event
 */
export function endSpan(span: ActiveSpan, result: SpanResult): TelemetryEvent {
  const endTimeNs = process.hrtime.bigint();
  const durationNs = Number(endTimeNs - span.startTimeNs);

  const attributes: TelemetrySpanAttributes = {
    'agent.id': span.options.agentId,
    'agent.version': span.options.agentVersion,
    'decision.type': span.options.decisionType,
    'decision.confidence': result.confidence,
    'execution.success': result.success,
    'execution.duration_ms': durationNs / 1_000_000,
    'error.code': result.errorCode,
    'error.message': result.errorMessage,
    'request.id': span.options.requestId,
    'request.source': span.options.source,
  };

  return {
    name: `agent.${span.options.decisionType}`,
    timestamp: new Date().toISOString(),
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    attributes,
    durationNs,
    status: result.success ? 'OK' : 'ERROR',
  };
}

// =============================================================================
// Telemetry Client
// =============================================================================

/**
 * Telemetry client for batched event reporting
 */
export class TelemetryClient {
  private readonly queue: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly samplingRate: number;
  private readonly enabled: boolean;

  /**
   * Creates a new telemetry client
   */
  constructor() {
    const config = getConfig();
    this.endpoint = config.telemetryEndpoint;
    this.batchSize = config.telemetry.batchSize;
    this.flushIntervalMs = config.telemetry.flushIntervalMs;
    this.maxQueueSize = config.telemetry.maxQueueSize;
    this.samplingRate = config.telemetry.samplingRate;
    this.enabled = config.features.telemetryEnabled;
  }

  /**
   * Starts the telemetry client
   * Begins the automatic flush timer
   */
  start(): void {
    if (!this.enabled) {
      return;
    }

    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Stops the telemetry client
   * Flushes remaining events and stops the timer
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Records a telemetry event
   *
   * @param event - Event to record
   */
  record(event: TelemetryEvent): void {
    if (!this.enabled) {
      return;
    }

    // Apply sampling
    if (Math.random() > this.samplingRate) {
      return;
    }

    // Check queue capacity
    if (this.queue.length >= this.maxQueueSize) {
      console.warn('Telemetry queue full, dropping event');
      return;
    }

    this.queue.push(event);

    // Flush if batch size reached
    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }
  }

  /**
   * Flushes queued events to the telemetry endpoint
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    const events = this.queue.splice(0, this.batchSize);
    const batch = this.createBatch(events);

    try {
      await this.sendBatch(batch);
    } catch (error) {
      console.error('Failed to send telemetry batch:', error);
      // Re-queue events on failure (up to max queue size)
      const requeue = events.slice(0, this.maxQueueSize - this.queue.length);
      this.queue.unshift(...requeue);
    }
  }

  /**
   * Creates a telemetry batch from events
   *
   * @param events - Events to include in batch
   * @returns Telemetry batch
   */
  private createBatch(events: TelemetryEvent[]): TelemetryBatch {
    const metadata = getServiceMetadata();

    return {
      resource: {
        'service.name': metadata.name,
        'service.version': metadata.version,
        'deployment.environment': metadata.environment,
      },
      scope: {
        name: 'llm-data-vault-runtime',
        version: metadata.version,
      },
      spans: events,
    };
  }

  /**
   * Sends a batch to the telemetry endpoint
   *
   * @param batch - Batch to send
   */
  private async sendBatch(batch: TelemetryBatch): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      throw new Error(`Telemetry send failed: ${response.status}`);
    }
  }

  /**
   * Gets the current queue length
   *
   * @returns Number of events in queue
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Wraps an async function with telemetry tracking
 *
 * @param options - Span options
 * @param client - Telemetry client
 * @param fn - Function to wrap
 * @returns Wrapped function result
 */
export async function withTelemetry<T>(
  options: SpanOptions,
  client: TelemetryClient,
  fn: () => Promise<{ result: T; confidence?: number }>
): Promise<T> {
  const span = startSpan(options);

  try {
    const { result, confidence } = await fn();
    const event = endSpan(span, {
      success: true,
      confidence,
    });
    client.record(event);
    return result;
  } catch (error) {
    const errorObj = error as Error;
    const event = endSpan(span, {
      success: false,
      errorCode: 'EXECUTION_ERROR',
      errorMessage: errorObj.message,
    });
    client.record(event);
    throw error;
  }
}

// =============================================================================
// Singleton Client
// =============================================================================

let globalClient: TelemetryClient | null = null;

/**
 * Gets the global telemetry client
 *
 * @returns Telemetry client singleton
 */
export function getTelemetryClient(): TelemetryClient {
  if (!globalClient) {
    globalClient = new TelemetryClient();
  }
  return globalClient;
}

/**
 * Initializes and starts the global telemetry client
 */
export function initTelemetry(): void {
  const client = getTelemetryClient();
  client.start();
}

/**
 * Shuts down the global telemetry client
 */
export async function shutdownTelemetry(): Promise<void> {
  if (globalClient) {
    await globalClient.stop();
    globalClient = null;
  }
}
