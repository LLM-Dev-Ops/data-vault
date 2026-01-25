/**
 * LLM-Data-Vault: RuVector Service Client
 *
 * Client for persisting DecisionEvents to ruvector-service.
 * This is the ONLY persistence mechanism allowed for Data-Vault agents.
 *
 * CONSTITUTIONAL REQUIREMENT:
 * - Data-Vault agents MUST NOT connect directly to Google SQL
 * - Data-Vault agents persist data ONLY via ruvector-service client calls
 *
 * @module ruvector-client
 */

import { DecisionEvent, validateDecisionEvent } from '../contracts/index.js';

/**
 * RuVector service configuration
 */
export interface RuVectorConfig {
  /** Service endpoint URL */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retry attempts */
  retries?: number;
  /** Retry backoff multiplier */
  retryBackoff?: number;
}

/**
 * RuVector persistence result
 */
export interface PersistResult {
  success: boolean;
  event_id?: string;
  timestamp?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

/**
 * RuVector query options
 */
export interface QueryOptions {
  tenant_id?: string;
  agent_id?: string;
  decision_type?: string;
  from_timestamp?: string;
  to_timestamp?: string;
  limit?: number;
  offset?: number;
}

/**
 * RuVector query result
 */
export interface QueryResult {
  events: DecisionEvent[];
  total_count: number;
  has_more: boolean;
}

/**
 * RuVector Service Client
 *
 * Provides async, non-blocking persistence for DecisionEvents.
 */
export class RuVectorClient {
  private readonly config: Required<RuVectorConfig>;

  constructor(config: RuVectorConfig) {
    this.config = {
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      timeout: config.timeout ?? 5000,
      retries: config.retries ?? 3,
      retryBackoff: config.retryBackoff ?? 1.5,
    };
  }

  /**
   * Persist a DecisionEvent to ruvector-service
   *
   * This is an async, non-blocking write operation.
   */
  async persistDecisionEvent(event: DecisionEvent): Promise<PersistResult> {
    // Validate event before persisting
    const validatedEvent = validateDecisionEvent(event);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const response = await this.makeRequest('/api/v1/decision-events', {
          method: 'POST',
          body: JSON.stringify(validatedEvent),
        });

        if (response.ok) {
          const result = await response.json() as { event_id: string; timestamp: string };
          return {
            success: true,
            event_id: result.event_id,
            timestamp: result.timestamp,
          };
        }

        // Handle non-retryable errors
        if (response.status >= 400 && response.status < 500) {
          const errorBody = await response.json().catch(() => ({})) as { code?: string; message?: string };
          return {
            success: false,
            error: {
              code: errorBody.code ?? `HTTP_${response.status}`,
              message: errorBody.message ?? response.statusText,
              retryable: false,
            },
          };
        }

        // Retryable error
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Wait before retry
      if (attempt < this.config.retries - 1) {
        const delay = Math.pow(this.config.retryBackoff, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return {
      success: false,
      error: {
        code: 'PERSIST_FAILED',
        message: lastError?.message ?? 'Unknown error',
        retryable: true,
      },
    };
  }

  /**
   * Batch persist multiple DecisionEvents
   */
  async persistBatch(events: DecisionEvent[]): Promise<PersistResult[]> {
    // Validate all events
    const validatedEvents = events.map(e => validateDecisionEvent(e));

    try {
      const response = await this.makeRequest('/api/v1/decision-events/batch', {
        method: 'POST',
        body: JSON.stringify({ events: validatedEvents }),
      });

      if (response.ok) {
        const results = await response.json() as Array<{ event_id: string; timestamp: string }>;
        return results.map(r => ({
          success: true,
          event_id: r.event_id,
          timestamp: r.timestamp,
        }));
      }

      const errorBody = await response.json().catch(() => ({})) as { code?: string; message?: string };
      return events.map(() => ({
        success: false,
        error: {
          code: errorBody.code ?? `HTTP_${response.status}`,
          message: errorBody.message ?? response.statusText,
          retryable: response.status >= 500,
        },
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return events.map(() => ({
        success: false,
        error: {
          code: 'BATCH_PERSIST_FAILED',
          message: errorMessage,
          retryable: true,
        },
      }));
    }
  }

  /**
   * Query DecisionEvents (for audit/governance consumption)
   */
  async queryEvents(options: QueryOptions = {}): Promise<QueryResult> {
    const params = new URLSearchParams();
    if (options.tenant_id) params.set('tenant_id', options.tenant_id);
    if (options.agent_id) params.set('agent_id', options.agent_id);
    if (options.decision_type) params.set('decision_type', options.decision_type);
    if (options.from_timestamp) params.set('from', options.from_timestamp);
    if (options.to_timestamp) params.set('to', options.to_timestamp);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));

    const response = await this.makeRequest(`/api/v1/decision-events?${params}`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Query failed: HTTP ${response.status}`);
    }

    return response.json() as Promise<QueryResult>;
  }

  /**
   * Get a single DecisionEvent by ID
   */
  async getEvent(eventId: string): Promise<DecisionEvent | null> {
    const response = await this.makeRequest(`/api/v1/decision-events/${eventId}`, {
      method: 'GET',
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Get event failed: HTTP ${response.status}`);
    }

    return validateDecisionEvent(await response.json());
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; latency_ms: number }> {
    const start = performance.now();

    try {
      const response = await this.makeRequest('/health', {
        method: 'GET',
      });

      return {
        healthy: response.ok,
        latency_ms: performance.now() - start,
      };
    } catch {
      return {
        healthy: false,
        latency_ms: performance.now() - start,
      };
    }
  }

  /**
   * Make HTTP request to ruvector-service
   */
  private async makeRequest(
    path: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      return await fetch(`${this.config.endpoint}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Service': 'llm-data-vault',
          ...options.headers,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Create RuVector client from environment
 *
 * STANDARDIZED ENVIRONMENT VARIABLES (matching Google Secret Manager names):
 * - RUVECTOR_SERVICE_URL: Service endpoint URL (required)
 * - RUVECTOR_API_KEY: API key for authentication (required, from Secret Manager)
 *
 * NOTE: Legacy variable names (RUVECTOR_SERVICE_ENDPOINT, RUVECTOR_SERVICE_API_KEY)
 * are supported for backward compatibility but deprecated.
 */
export function createRuVectorClient(): RuVectorClient {
  // Use standardized names, fall back to legacy names for backward compatibility
  const endpoint = process.env['RUVECTOR_SERVICE_URL']
    ?? process.env['RUVECTOR_SERVICE_ENDPOINT'];
  const apiKey = process.env['RUVECTOR_API_KEY']
    ?? process.env['RUVECTOR_SERVICE_API_KEY'];

  if (!endpoint) {
    throw new Error('RUVECTOR_SERVICE_URL environment variable is required');
  }
  if (!apiKey) {
    throw new Error('RUVECTOR_API_KEY environment variable is required (should come from Secret Manager)');
  }

  // Warn if using deprecated variable names
  if (process.env['RUVECTOR_SERVICE_ENDPOINT'] && !process.env['RUVECTOR_SERVICE_URL']) {
    console.warn('DEPRECATION WARNING: RUVECTOR_SERVICE_ENDPOINT is deprecated, use RUVECTOR_SERVICE_URL');
  }
  if (process.env['RUVECTOR_SERVICE_API_KEY'] && !process.env['RUVECTOR_API_KEY']) {
    console.warn('DEPRECATION WARNING: RUVECTOR_SERVICE_API_KEY is deprecated, use RUVECTOR_API_KEY');
  }

  return new RuVectorClient({
    endpoint,
    apiKey,
    timeout: parseInt(process.env['RUVECTOR_TIMEOUT'] ?? '5000', 10),
    retries: parseInt(process.env['RUVECTOR_RETRIES'] ?? '3', 10),
  });
}
