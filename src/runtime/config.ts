/**
 * @fileoverview Runtime configuration management for Edge Functions
 * @module runtime/config
 *
 * Handles environment variable parsing, validation, and provides
 * typed configuration access for the Edge Function runtime.
 */

import type {
  RuntimeConfig,
  LogLevel,
  FeatureFlags,
  ServerConfig,
  TelemetryConfig,
} from './types.js';

// =============================================================================
// Environment Variable Names
// =============================================================================

/**
 * Environment variable names used by the runtime
 */
export const ENV_VARS = {
  /** RuVector service URL */
  RUVECTOR_SERVICE_URL: 'RUVECTOR_SERVICE_URL',
  /** Telemetry endpoint URL */
  TELEMETRY_ENDPOINT: 'TELEMETRY_ENDPOINT',
  /** Log level */
  LOG_LEVEL: 'LOG_LEVEL',
  /** Server port */
  PORT: 'PORT',
  /** Server host */
  HOST: 'HOST',
  /** Enable telemetry */
  TELEMETRY_ENABLED: 'TELEMETRY_ENABLED',
  /** Enable caching */
  CACHING_ENABLED: 'CACHING_ENABLED',
  /** Enable debug mode */
  DEBUG_MODE: 'DEBUG_MODE',
  /** Enable health checks */
  HEALTH_CHECKS_ENABLED: 'HEALTH_CHECKS_ENABLED',
  /** Enable metrics */
  METRICS_ENABLED: 'METRICS_ENABLED',
  /** Request timeout in ms */
  REQUEST_TIMEOUT_MS: 'REQUEST_TIMEOUT_MS',
  /** Telemetry batch size */
  TELEMETRY_BATCH_SIZE: 'TELEMETRY_BATCH_SIZE',
  /** Telemetry flush interval */
  TELEMETRY_FLUSH_INTERVAL_MS: 'TELEMETRY_FLUSH_INTERVAL_MS',
  /** Telemetry max queue size */
  TELEMETRY_MAX_QUEUE_SIZE: 'TELEMETRY_MAX_QUEUE_SIZE',
  /** Telemetry sampling rate */
  TELEMETRY_SAMPLING_RATE: 'TELEMETRY_SAMPLING_RATE',
  /** Deployment environment */
  DEPLOYMENT_ENVIRONMENT: 'DEPLOYMENT_ENVIRONMENT',
  /** Service name */
  SERVICE_NAME: 'SERVICE_NAME',
  /** Service version */
  SERVICE_VERSION: 'SERVICE_VERSION',
} as const;

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default configuration values
 */
export const DEFAULTS = {
  ruvectorServiceUrl: 'http://localhost:8080',
  telemetryEndpoint: 'http://localhost:4318/v1/traces',
  logLevel: 'info' as LogLevel,
  port: 8080,
  host: '0.0.0.0',
  requestTimeoutMs: 30000,
  keepAliveTimeoutMs: 5000,
  telemetryBatchSize: 100,
  telemetryFlushIntervalMs: 5000,
  telemetryMaxQueueSize: 10000,
  telemetrySamplingRate: 1.0,
  deploymentEnvironment: 'development',
  serviceName: 'llm-data-vault-runtime',
  serviceVersion: '0.1.0',
} as const;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Valid log levels
 */
const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/**
 * Validates and returns a log level
 *
 * @param value - The value to validate
 * @returns The validated log level or default
 */
function parseLogLevel(value: string | undefined): LogLevel {
  if (value && VALID_LOG_LEVELS.includes(value as LogLevel)) {
    return value as LogLevel;
  }
  return DEFAULTS.logLevel;
}

/**
 * Parses a boolean environment variable
 *
 * @param value - The environment variable value
 * @param defaultValue - Default value if not set
 * @returns Parsed boolean value
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parses an integer environment variable
 *
 * @param value - The environment variable value
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed integer value
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parses a float environment variable
 *
 * @param value - The environment variable value
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed float value
 */
function parseFloat(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number.parseFloat(value);
  return isNaN(parsed) ? defaultValue : Math.max(0, Math.min(1, parsed));
}

/**
 * Parses a URL environment variable
 *
 * @param value - The environment variable value
 * @param defaultValue - Default value if not set
 * @returns Validated URL string
 */
function parseUrl(value: string | undefined, defaultValue: string): string {
  if (!value) {
    return defaultValue;
  }
  try {
    new URL(value);
    return value;
  } catch {
    console.warn(`Invalid URL: ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
}

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Loads feature flags from environment variables
 *
 * @returns Feature flags configuration
 */
function loadFeatureFlags(): FeatureFlags {
  return {
    telemetryEnabled: parseBoolean(
      process.env[ENV_VARS.TELEMETRY_ENABLED],
      true
    ),
    cachingEnabled: parseBoolean(
      process.env[ENV_VARS.CACHING_ENABLED],
      true
    ),
    debugMode: parseBoolean(
      process.env[ENV_VARS.DEBUG_MODE],
      false
    ),
    healthChecksEnabled: parseBoolean(
      process.env[ENV_VARS.HEALTH_CHECKS_ENABLED],
      true
    ),
    metricsEnabled: parseBoolean(
      process.env[ENV_VARS.METRICS_ENABLED],
      true
    ),
  };
}

/**
 * Loads server configuration from environment variables
 *
 * @returns Server configuration
 */
function loadServerConfig(): ServerConfig {
  return {
    port: parseInteger(process.env[ENV_VARS.PORT], DEFAULTS.port),
    host: process.env[ENV_VARS.HOST] ?? DEFAULTS.host,
    requestTimeoutMs: parseInteger(
      process.env[ENV_VARS.REQUEST_TIMEOUT_MS],
      DEFAULTS.requestTimeoutMs
    ),
    keepAliveTimeoutMs: DEFAULTS.keepAliveTimeoutMs,
  };
}

/**
 * Loads telemetry configuration from environment variables
 *
 * @returns Telemetry configuration
 */
function loadTelemetryConfig(): TelemetryConfig {
  return {
    batchSize: parseInteger(
      process.env[ENV_VARS.TELEMETRY_BATCH_SIZE],
      DEFAULTS.telemetryBatchSize
    ),
    flushIntervalMs: parseInteger(
      process.env[ENV_VARS.TELEMETRY_FLUSH_INTERVAL_MS],
      DEFAULTS.telemetryFlushIntervalMs
    ),
    maxQueueSize: parseInteger(
      process.env[ENV_VARS.TELEMETRY_MAX_QUEUE_SIZE],
      DEFAULTS.telemetryMaxQueueSize
    ),
    samplingRate: parseFloat(
      process.env[ENV_VARS.TELEMETRY_SAMPLING_RATE],
      DEFAULTS.telemetrySamplingRate
    ),
  };
}

/**
 * Loads the complete runtime configuration from environment variables
 *
 * @returns Complete runtime configuration
 */
export function loadConfig(): RuntimeConfig {
  return {
    ruvectorServiceUrl: parseUrl(
      process.env[ENV_VARS.RUVECTOR_SERVICE_URL],
      DEFAULTS.ruvectorServiceUrl
    ),
    telemetryEndpoint: parseUrl(
      process.env[ENV_VARS.TELEMETRY_ENDPOINT],
      DEFAULTS.telemetryEndpoint
    ),
    logLevel: parseLogLevel(process.env[ENV_VARS.LOG_LEVEL]),
    features: loadFeatureFlags(),
    server: loadServerConfig(),
    telemetry: loadTelemetryConfig(),
  };
}

// =============================================================================
// Service Metadata
// =============================================================================

/**
 * Service metadata for telemetry and health checks
 */
export interface ServiceMetadata {
  /** Service name */
  readonly name: string;
  /** Service version */
  readonly version: string;
  /** Deployment environment */
  readonly environment: string;
}

/**
 * Loads service metadata from environment variables
 *
 * @returns Service metadata
 */
export function loadServiceMetadata(): ServiceMetadata {
  return {
    name: process.env[ENV_VARS.SERVICE_NAME] ?? DEFAULTS.serviceName,
    version: process.env[ENV_VARS.SERVICE_VERSION] ?? DEFAULTS.serviceVersion,
    environment:
      process.env[ENV_VARS.DEPLOYMENT_ENVIRONMENT] ??
      DEFAULTS.deploymentEnvironment,
  };
}

// =============================================================================
// Configuration Singleton
// =============================================================================

let cachedConfig: RuntimeConfig | null = null;
let cachedMetadata: ServiceMetadata | null = null;

/**
 * Gets the runtime configuration (cached)
 *
 * @returns Runtime configuration
 */
export function getConfig(): RuntimeConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Gets service metadata (cached)
 *
 * @returns Service metadata
 */
export function getServiceMetadata(): ServiceMetadata {
  if (!cachedMetadata) {
    cachedMetadata = loadServiceMetadata();
  }
  return cachedMetadata;
}

/**
 * Reloads configuration from environment variables
 * Useful for testing or hot-reloading
 *
 * @returns Newly loaded configuration
 */
export function reloadConfig(): RuntimeConfig {
  cachedConfig = loadConfig();
  cachedMetadata = loadServiceMetadata();
  return cachedConfig;
}

/**
 * Validates the current configuration
 *
 * @returns Array of validation errors (empty if valid)
 */
export function validateConfig(): string[] {
  const errors: string[] = [];
  const config = getConfig();

  // Validate RuVector URL
  try {
    new URL(config.ruvectorServiceUrl);
  } catch {
    errors.push(`Invalid RUVECTOR_SERVICE_URL: ${config.ruvectorServiceUrl}`);
  }

  // Validate telemetry endpoint
  try {
    new URL(config.telemetryEndpoint);
  } catch {
    errors.push(`Invalid TELEMETRY_ENDPOINT: ${config.telemetryEndpoint}`);
  }

  // Validate port range
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push(`Invalid PORT: ${config.server.port} (must be 1-65535)`);
  }

  // Validate timeout
  if (config.server.requestTimeoutMs < 1000) {
    errors.push(
      `REQUEST_TIMEOUT_MS too low: ${config.server.requestTimeoutMs} (minimum 1000)`
    );
  }

  // Validate sampling rate
  if (config.telemetry.samplingRate < 0 || config.telemetry.samplingRate > 1) {
    errors.push(
      `Invalid TELEMETRY_SAMPLING_RATE: ${config.telemetry.samplingRate} (must be 0-1)`
    );
  }

  return errors;
}
