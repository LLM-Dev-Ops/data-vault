/**
 * LLM-Data-Vault: Telemetry Module
 *
 * Telemetry emission compatible with LLM-Observatory.
 * All agents MUST emit telemetry through this module.
 *
 * @module telemetry
 */

import pino from 'pino';

/**
 * Telemetry event types
 */
export type TelemetryEventType =
  | 'agent_invocation_started'
  | 'agent_invocation_completed'
  | 'agent_invocation_failed'
  | 'decision_event_persisted'
  | 'decision_event_persist_failed'
  | 'pii_detection_completed'
  | 'anonymization_completed'
  | 'access_decision_made'
  | 'policy_evaluation_completed';

/**
 * Telemetry event payload
 */
export interface TelemetryEvent {
  event_type: TelemetryEventType;
  timestamp: string;
  agent_id: string;
  agent_version: string;
  execution_ref: string;
  correlation_id?: string;
  tenant_id?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Telemetry metrics
 */
export interface TelemetryMetrics {
  invocations_total: number;
  invocations_success: number;
  invocations_failed: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  pii_detections_total: number;
  anonymizations_total: number;
  access_decisions_granted: number;
  access_decisions_denied: number;
}

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
  service_name: string;
  environment: string;
  version: string;
  otlp_endpoint?: string;
  log_level?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Create structured logger for LLM-Observatory compatibility
 */
function createLogger(config: TelemetryConfig): pino.Logger {
  return pino({
    name: config.service_name,
    level: config.log_level ?? 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    base: {
      service: config.service_name,
      environment: config.environment,
      version: config.version,
    },
  });
}

/**
 * Telemetry emitter for LLM-Observatory
 */
export class TelemetryEmitter {
  private readonly config: TelemetryConfig;
  private readonly logger: pino.Logger;
  private readonly metrics: TelemetryMetrics;
  private readonly latencies: number[] = [];
  private readonly maxLatencySamples = 1000;

  constructor(config: TelemetryConfig) {
    this.config = config;
    this.logger = createLogger(config);
    this.metrics = {
      invocations_total: 0,
      invocations_success: 0,
      invocations_failed: 0,
      avg_latency_ms: 0,
      p95_latency_ms: 0,
      p99_latency_ms: 0,
      pii_detections_total: 0,
      anonymizations_total: 0,
      access_decisions_granted: 0,
      access_decisions_denied: 0,
    };
  }

  /**
   * Emit a telemetry event
   */
  emit(event: TelemetryEvent): void {
    // Log event in structured format for LLM-Observatory
    this.logger.info({
      event_type: event.event_type,
      execution_ref: event.execution_ref,
      correlation_id: event.correlation_id,
      tenant_id: event.tenant_id,
      agent_id: event.agent_id,
      agent_version: event.agent_version,
      duration_ms: event.duration_ms,
      ...event.metadata,
    }, `${event.event_type}`);

    // Update metrics
    this.updateMetrics(event);

    // Send to OTLP if configured
    if (this.config.otlp_endpoint) {
      this.sendToOTLP(event).catch(err => {
        this.logger.error({ error: err }, 'Failed to send telemetry to OTLP');
      });
    }
  }

  /**
   * Record agent invocation start
   */
  recordInvocationStart(
    agentId: string,
    agentVersion: string,
    executionRef: string,
    correlationId?: string,
    tenantId?: string
  ): void {
    this.emit({
      event_type: 'agent_invocation_started',
      timestamp: new Date().toISOString(),
      agent_id: agentId,
      agent_version: agentVersion,
      execution_ref: executionRef,
      correlation_id: correlationId,
      tenant_id: tenantId,
    });
    this.metrics.invocations_total++;
  }

  /**
   * Record agent invocation completion
   */
  recordInvocationComplete(
    agentId: string,
    agentVersion: string,
    executionRef: string,
    durationMs: number,
    success: boolean,
    metadata?: Record<string, unknown>
  ): void {
    this.emit({
      event_type: success ? 'agent_invocation_completed' : 'agent_invocation_failed',
      timestamp: new Date().toISOString(),
      agent_id: agentId,
      agent_version: agentVersion,
      execution_ref: executionRef,
      duration_ms: durationMs,
      metadata,
    });

    if (success) {
      this.metrics.invocations_success++;
    } else {
      this.metrics.invocations_failed++;
    }

    this.recordLatency(durationMs);
  }

  /**
   * Record PII detection
   */
  recordPIIDetection(
    agentId: string,
    executionRef: string,
    piiCount: number,
    piiTypes: Record<string, number>
  ): void {
    this.emit({
      event_type: 'pii_detection_completed',
      timestamp: new Date().toISOString(),
      agent_id: agentId,
      agent_version: '',
      execution_ref: executionRef,
      metadata: { pii_count: piiCount, pii_types: piiTypes },
    });
    this.metrics.pii_detections_total += piiCount;
  }

  /**
   * Record anonymization
   */
  recordAnonymization(
    agentId: string,
    executionRef: string,
    fieldsAnonymized: number,
    strategies: Record<string, number>
  ): void {
    this.emit({
      event_type: 'anonymization_completed',
      timestamp: new Date().toISOString(),
      agent_id: agentId,
      agent_version: '',
      execution_ref: executionRef,
      metadata: { fields_anonymized: fieldsAnonymized, strategies },
    });
    this.metrics.anonymizations_total += fieldsAnonymized;
  }

  /**
   * Record access decision
   */
  recordAccessDecision(
    agentId: string,
    executionRef: string,
    granted: boolean,
    reason: string
  ): void {
    this.emit({
      event_type: 'access_decision_made',
      timestamp: new Date().toISOString(),
      agent_id: agentId,
      agent_version: '',
      execution_ref: executionRef,
      metadata: { granted, reason },
    });

    if (granted) {
      this.metrics.access_decisions_granted++;
    } else {
      this.metrics.access_decisions_denied++;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): TelemetryMetrics {
    return { ...this.metrics };
  }

  /**
   * Update metrics based on event
   */
  private updateMetrics(_event: TelemetryEvent): void {
    // Metrics are updated in the specific record* methods
  }

  /**
   * Record latency for percentile calculations
   */
  private recordLatency(latencyMs: number): void {
    this.latencies.push(latencyMs);

    // Trim to max samples
    if (this.latencies.length > this.maxLatencySamples) {
      this.latencies.shift();
    }

    // Update percentiles
    const sorted = [...this.latencies].sort((a, b) => a - b);
    this.metrics.avg_latency_ms = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    this.metrics.p95_latency_ms = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    this.metrics.p99_latency_ms = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  }

  /**
   * Send telemetry to OTLP endpoint
   */
  private async sendToOTLP(event: TelemetryEvent): Promise<void> {
    if (!this.config.otlp_endpoint) return;

    await fetch(this.config.otlp_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resource_spans: [{
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.config.service_name } },
              { key: 'service.version', value: { stringValue: this.config.version } },
            ],
          },
          scope_spans: [{
            spans: [{
              name: event.event_type,
              trace_id: event.correlation_id ?? event.execution_ref,
              span_id: event.execution_ref.slice(0, 16),
              start_time_unix_nano: Date.parse(event.timestamp) * 1e6,
              attributes: Object.entries(event.metadata ?? {}).map(([key, value]) => ({
                key,
                value: { stringValue: String(value) },
              })),
            }],
          }],
        }],
      }),
    });
  }
}

/**
 * Global telemetry instance
 */
let globalTelemetry: TelemetryEmitter | null = null;

/**
 * Initialize global telemetry
 */
export function initTelemetry(config: TelemetryConfig): TelemetryEmitter {
  globalTelemetry = new TelemetryEmitter(config);
  return globalTelemetry;
}

/**
 * Get global telemetry instance
 */
export function getTelemetry(): TelemetryEmitter {
  if (!globalTelemetry) {
    // Auto-initialize with defaults
    globalTelemetry = new TelemetryEmitter({
      service_name: 'llm-data-vault',
      environment: process.env['NODE_ENV'] ?? 'development',
      version: process.env['AGENT_VERSION'] ?? '0.1.0',
      otlp_endpoint: process.env['OTLP_ENDPOINT'],
      log_level: (process.env['LOG_LEVEL'] as TelemetryConfig['log_level']) ?? 'info',
    });
  }
  return globalTelemetry;
}
