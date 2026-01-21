/**
 * @fileoverview Agent Configuration Schemas for LLM-Data-Vault
 * @description Defines schemas for agent configuration, telemetry settings,
 * and capability declarations. These schemas standardize how agents are
 * configured and how they report their capabilities and metrics.
 * @module @llm-data-vault/agents/contracts/agent-config
 */

import { z } from 'zod';

/**
 * Semantic version pattern validation
 * @description Validates semver format (e.g., "1.0.0", "2.1.0-alpha.1")
 */
const semverSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    'Must be a valid semantic version (e.g., "1.0.0")'
  );

/**
 * Agent capability types
 */
export const AgentCapabilityTypeSchema = z.enum([
  /** Data access control and policy enforcement */
  'data_access_control',
  /** PII detection and anonymization */
  'anonymization',
  /** Data classification and tagging */
  'classification',
  /** Encryption and decryption operations */
  'encryption',
  /** Audit logging and compliance reporting */
  'audit',
  /** Data transformation and normalization */
  'transformation',
  /** Data quality validation */
  'validation',
  /** Schema management and evolution */
  'schema_management',
  /** Data lineage tracking */
  'lineage',
  /** Custom/extension capability */
  'custom',
]);

/**
 * Type alias for capability types
 */
export type AgentCapabilityType = z.infer<typeof AgentCapabilityTypeSchema>;

/**
 * Agent status values
 */
export const AgentStatusSchema = z.enum([
  /** Agent is starting up */
  'initializing',
  /** Agent is ready to receive requests */
  'ready',
  /** Agent is processing requests */
  'active',
  /** Agent is temporarily paused */
  'paused',
  /** Agent is shutting down gracefully */
  'draining',
  /** Agent is stopped */
  'stopped',
  /** Agent encountered an error */
  'error',
  /** Agent is in maintenance mode */
  'maintenance',
]);

/**
 * Type alias for agent status
 */
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Log level configuration
 */
export const LogLevelSchema = z.enum([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

/**
 * Type alias for log level
 */
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Telemetry export format
 */
export const TelemetryFormatSchema = z.enum([
  /** OpenTelemetry Protocol (OTLP) */
  'otlp',
  /** Prometheus format */
  'prometheus',
  /** JSON format */
  'json',
  /** StatsD format */
  'statsd',
]);

/**
 * Type alias for telemetry format
 */
export type TelemetryFormat = z.infer<typeof TelemetryFormatSchema>;

/**
 * Telemetry Configuration Schema
 * @description Configuration for agent telemetry and observability
 *
 * @example
 * ```typescript
 * const telemetryConfig: TelemetryConfig = {
 *   enabled: true,
 *   endpoint: 'https://telemetry.example.com/v1/traces',
 *   batch_size: 100,
 *   flush_interval_ms: 5000,
 *   export_format: 'otlp',
 *   include_traces: true,
 *   include_metrics: true,
 *   include_logs: false
 * };
 * ```
 */
export const TelemetryConfigSchema = z.object({
  /**
   * Whether telemetry collection is enabled
   */
  enabled: z.boolean().default(true),

  /**
   * Endpoint URL for telemetry export
   */
  endpoint: z.string().url().optional(),

  /**
   * Number of telemetry events to batch before sending
   */
  batch_size: z.number().int().min(1).max(10000).default(100),

  /**
   * Interval in milliseconds between flush operations
   */
  flush_interval_ms: z.number().int().min(100).max(60000).default(5000),

  /**
   * Export format for telemetry data
   */
  export_format: TelemetryFormatSchema.default('otlp'),

  /**
   * Whether to include distributed traces
   */
  include_traces: z.boolean().default(true),

  /**
   * Whether to include metrics
   */
  include_metrics: z.boolean().default(true),

  /**
   * Whether to include logs
   */
  include_logs: z.boolean().default(false),

  /**
   * Sampling rate for traces (0-1)
   */
  trace_sample_rate: z.number().min(0).max(1).default(1.0),

  /**
   * Additional headers to include in telemetry requests
   */
  headers: z.record(z.string(), z.string()).optional(),

  /**
   * Resource attributes to attach to all telemetry
   */
  resource_attributes: z.record(z.string(), z.string()).optional(),

  /**
   * Service name for telemetry identification
   */
  service_name: z.string().optional(),

  /**
   * Environment tag (e.g., "production", "staging")
   */
  environment: z.string().optional(),
});

/**
 * TypeScript type for TelemetryConfig
 */
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

/**
 * Agent Capability Schema
 * @description Declares a specific capability of an agent
 */
export const AgentCapabilitySchema = z.object({
  /**
   * Type of capability
   */
  type: AgentCapabilityTypeSchema,

  /**
   * Human-readable name for this capability
   */
  name: z.string().min(1, 'Capability name is required'),

  /**
   * Detailed description of what this capability does
   */
  description: z.string().optional(),

  /**
   * Version of this capability implementation
   */
  version: semverSchema.default('1.0.0'),

  /**
   * Whether this capability is currently enabled
   */
  enabled: z.boolean().default(true),

  /**
   * Configuration specific to this capability
   */
  config: z.record(z.string(), z.unknown()).optional(),

  /**
   * Resource limits for this capability
   */
  limits: z.object({
    /** Maximum requests per second */
    max_rps: z.number().int().positive().optional(),
    /** Maximum concurrent operations */
    max_concurrent: z.number().int().positive().optional(),
    /** Maximum memory usage in bytes */
    max_memory_bytes: z.number().int().positive().optional(),
    /** Operation timeout in milliseconds */
    timeout_ms: z.number().int().positive().optional(),
  }).optional(),

  /**
   * Dependencies required for this capability
   */
  dependencies: z.array(z.string()).default([]),
});

/**
 * TypeScript type for AgentCapability
 */
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

/**
 * Health Check Configuration Schema
 */
export const HealthCheckConfigSchema = z.object({
  /**
   * Whether health checks are enabled
   */
  enabled: z.boolean().default(true),

  /**
   * Interval between health checks in milliseconds
   */
  interval_ms: z.number().int().min(1000).max(300000).default(30000),

  /**
   * Timeout for health check operations in milliseconds
   */
  timeout_ms: z.number().int().min(100).max(30000).default(5000),

  /**
   * Number of consecutive failures before marking unhealthy
   */
  failure_threshold: z.number().int().min(1).max(10).default(3),

  /**
   * Number of consecutive successes before marking healthy
   */
  success_threshold: z.number().int().min(1).max(10).default(1),

  /**
   * HTTP endpoint for health checks (if applicable)
   */
  http_endpoint: z.string().optional(),

  /**
   * Include detailed health information in responses
   */
  include_details: z.boolean().default(false),
});

/**
 * TypeScript type for HealthCheckConfig
 */
export type HealthCheckConfig = z.infer<typeof HealthCheckConfigSchema>;

/**
 * Retry Configuration Schema
 */
export const RetryConfigSchema = z.object({
  /**
   * Whether automatic retries are enabled
   */
  enabled: z.boolean().default(true),

  /**
   * Maximum number of retry attempts
   */
  max_attempts: z.number().int().min(0).max(10).default(3),

  /**
   * Initial delay between retries in milliseconds
   */
  initial_delay_ms: z.number().int().min(0).max(60000).default(1000),

  /**
   * Maximum delay between retries in milliseconds
   */
  max_delay_ms: z.number().int().min(0).max(300000).default(30000),

  /**
   * Multiplier for exponential backoff
   */
  backoff_multiplier: z.number().min(1).max(10).default(2),

  /**
   * Whether to add jitter to retry delays
   */
  add_jitter: z.boolean().default(true),

  /**
   * HTTP status codes that should trigger a retry
   */
  retryable_status_codes: z.array(z.number().int().min(100).max(599)).default([
    408, // Request Timeout
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
  ]),
});

/**
 * TypeScript type for RetryConfig
 */
export type RetryConfig = z.infer<typeof RetryConfigSchema>;

/**
 * Agent Configuration Schema
 * @description Complete configuration for an LLM-Data-Vault agent
 *
 * @example
 * ```typescript
 * const config: AgentConfig = {
 *   agent_id: 'data-access-controller-v1',
 *   version: '1.2.3',
 *   name: 'Data Access Controller',
 *   description: 'Controls and audits access to sensitive datasets',
 *   capabilities: [
 *     {
 *       type: 'data_access_control',
 *       name: 'Policy Enforcement',
 *       enabled: true
 *     }
 *   ],
 *   telemetry_config: {
 *     enabled: true,
 *     endpoint: 'https://telemetry.example.com/v1/traces',
 *     batch_size: 100
 *   }
 * };
 * ```
 */
export const AgentConfigSchema = z.object({
  /**
   * Unique identifier for the agent
   */
  agent_id: z.string().min(1, 'Agent ID is required'),

  /**
   * Semantic version of the agent
   */
  version: semverSchema,

  /**
   * Human-readable name for the agent
   */
  name: z.string().min(1, 'Agent name is required'),

  /**
   * Detailed description of the agent's purpose
   */
  description: z.string().optional(),

  /**
   * Current status of the agent
   */
  status: AgentStatusSchema.default('initializing'),

  /**
   * Capabilities this agent provides
   */
  capabilities: z.array(AgentCapabilitySchema).min(1, 'At least one capability is required'),

  /**
   * Telemetry configuration
   */
  telemetry_config: TelemetryConfigSchema.default({}),

  /**
   * Health check configuration
   */
  health_check_config: HealthCheckConfigSchema.default({}),

  /**
   * Retry configuration for failed operations
   */
  retry_config: RetryConfigSchema.default({}),

  /**
   * Log level for the agent
   */
  log_level: LogLevelSchema.default('info'),

  /**
   * Maximum concurrent requests the agent can handle
   */
  max_concurrent_requests: z.number().int().min(1).max(10000).default(100),

  /**
   * Request timeout in milliseconds
   */
  request_timeout_ms: z.number().int().min(100).max(300000).default(30000),

  /**
   * Graceful shutdown timeout in milliseconds
   */
  shutdown_timeout_ms: z.number().int().min(1000).max(300000).default(30000),

  /**
   * Environment-specific configuration overrides
   */
  environment_config: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),

  /**
   * Feature flags for the agent
   */
  feature_flags: z.record(z.string(), z.boolean()).optional(),

  /**
   * Custom metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional(),

  /**
   * Tags for categorization and filtering
   */
  tags: z.array(z.string()).default([]),

  /**
   * Owner/team responsible for this agent
   */
  owner: z.string().optional(),

  /**
   * Contact information for the agent owner
   */
  contact: z.string().email().optional(),

  /**
   * Documentation URL
   */
  documentation_url: z.string().url().optional(),

  /**
   * Timestamp when the agent was last updated
   */
  updated_at: z.string().datetime().optional(),

  /**
   * Timestamp when the agent was created
   */
  created_at: z.string().datetime().optional(),
});

/**
 * TypeScript type for AgentConfig
 */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Agent Registration Schema
 * @description Used when registering an agent with a coordinator
 */
export const AgentRegistrationSchema = z.object({
  /**
   * Agent configuration
   */
  config: AgentConfigSchema,

  /**
   * Endpoints where the agent can be reached
   */
  endpoints: z.object({
    /** Primary endpoint URL */
    primary: z.string().url(),
    /** Health check endpoint */
    health: z.string().url().optional(),
    /** Metrics endpoint */
    metrics: z.string().url().optional(),
  }),

  /**
   * Registration timestamp
   */
  registered_at: z.string().datetime(),

  /**
   * TTL for the registration in seconds
   */
  ttl_seconds: z.number().int().positive().default(300),
});

/**
 * TypeScript type for AgentRegistration
 */
export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>;

/**
 * Creates a validated AgentConfig
 * @param data - Raw config data
 * @returns Validated AgentConfig
 * @throws ZodError if validation fails
 */
export function createAgentConfig(data: unknown): AgentConfig {
  return AgentConfigSchema.parse(data);
}

/**
 * Creates a validated TelemetryConfig
 * @param data - Raw config data
 * @returns Validated TelemetryConfig
 * @throws ZodError if validation fails
 */
export function createTelemetryConfig(data: unknown): TelemetryConfig {
  return TelemetryConfigSchema.parse(data);
}

/**
 * Creates a validated AgentRegistration
 * @param data - Raw registration data
 * @returns Validated AgentRegistration
 * @throws ZodError if validation fails
 */
export function createAgentRegistration(data: unknown): AgentRegistration {
  return AgentRegistrationSchema.parse(data);
}

/**
 * Safely parses AgentConfig data without throwing
 * @param data - Raw config data
 * @returns SafeParseResult containing either the validated data or error details
 */
export function safeParseAgentConfig(data: unknown): z.SafeParseReturnType<unknown, AgentConfig> {
  return AgentConfigSchema.safeParse(data);
}

/**
 * Safely parses TelemetryConfig data without throwing
 * @param data - Raw config data
 * @returns SafeParseResult containing either the validated data or error details
 */
export function safeParseTelemetryConfig(data: unknown): z.SafeParseReturnType<unknown, TelemetryConfig> {
  return TelemetryConfigSchema.safeParse(data);
}

/**
 * Merges partial config with defaults
 * @param partial - Partial agent config
 * @returns Complete AgentConfig with defaults applied
 */
export function mergeWithDefaults(partial: Partial<AgentConfig> & { agent_id: string; version: string; name: string; capabilities: AgentCapability[] }): AgentConfig {
  return AgentConfigSchema.parse(partial);
}

/**
 * Validates that an agent has a specific capability
 * @param config - Agent configuration to check
 * @param capabilityType - Capability type to look for
 * @returns True if the agent has the capability enabled
 */
export function hasCapability(config: AgentConfig, capabilityType: AgentCapabilityType): boolean {
  return config.capabilities.some(
    (cap) => cap.type === capabilityType && cap.enabled
  );
}

/**
 * Gets all enabled capabilities of a specific type
 * @param config - Agent configuration
 * @param capabilityType - Capability type to filter by
 * @returns Array of matching enabled capabilities
 */
export function getCapabilities(config: AgentConfig, capabilityType: AgentCapabilityType): AgentCapability[] {
  return config.capabilities.filter(
    (cap) => cap.type === capabilityType && cap.enabled
  );
}
