/**
 * LLM-Data-Vault: Startup Validation Module
 *
 * FAIL-FAST validation for Cloud Run deployment.
 * Validates all required environment variables and performs health checks.
 * CRASHES THE PROCESS if any validation fails - this is intentional for Cloud Run.
 *
 * @module startup/validation
 */

/**
 * Environment variable configuration
 */
export interface EnvironmentConfig {
  // Required - service will CRASH if missing
  ruvectorServiceUrl: string;
  ruvectorApiKey: string;

  // Optional with defaults
  agentName: string;
  agentDomain: string;
  agentPhase: string;
  agentLayer: string;
  agentVersion: string;

  // Service metadata
  serviceName: string;
  serviceVersion: string;
  platformEnv: string;
  port: number;

  // Optional
  telemetryEndpoint?: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  config?: EnvironmentConfig;
  errors: string[];
  warnings: string[];
}

/**
 * Structured startup log event
 */
interface StartupLogEvent {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  event: string;
  service: string;
  phase: string;
  details?: Record<string, unknown>;
}

/**
 * Log a structured startup event
 */
function logStartupEvent(event: StartupLogEvent): void {
  const logLine = JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
  });

  if (event.level === 'ERROR' || event.level === 'FATAL') {
    console.error(logLine);
  } else if (event.level === 'WARN') {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }
}

/**
 * Validate required environment variables
 * Returns validation result - does NOT crash here
 */
export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // =========================================================================
  // REQUIRED ENVIRONMENT VARIABLES - CRASH IF MISSING
  // =========================================================================

  const ruvectorServiceUrl = process.env['RUVECTOR_SERVICE_URL'];
  if (!ruvectorServiceUrl) {
    errors.push('RUVECTOR_SERVICE_URL is required but not set');
  } else if (!ruvectorServiceUrl.startsWith('http://') && !ruvectorServiceUrl.startsWith('https://')) {
    errors.push('RUVECTOR_SERVICE_URL must be a valid HTTP(S) URL');
  }

  const ruvectorApiKey = process.env['RUVECTOR_API_KEY'];
  if (!ruvectorApiKey) {
    errors.push('RUVECTOR_API_KEY is required but not set (should come from Secret Manager)');
  } else if (ruvectorApiKey === 'placeholder-ruvector-api-key') {
    errors.push('RUVECTOR_API_KEY contains placeholder value - Secret Manager injection failed');
  } else if (ruvectorApiKey.length < 16) {
    errors.push('RUVECTOR_API_KEY appears invalid (too short)');
  }

  // =========================================================================
  // OPTIONAL ENVIRONMENT VARIABLES WITH DEFAULTS
  // =========================================================================

  const agentName = process.env['AGENT_NAME'] ?? 'llm-data-vault';
  const agentDomain = process.env['AGENT_DOMAIN'] ?? 'data-vault';
  const agentPhase = process.env['AGENT_PHASE'] ?? 'phase7';
  const agentLayer = process.env['AGENT_LAYER'] ?? 'layer2';
  const agentVersion = process.env['AGENT_VERSION'] ?? process.env['SERVICE_VERSION'] ?? '0.1.0';

  const serviceName = process.env['SERVICE_NAME'] ?? 'llm-data-vault';
  const serviceVersion = process.env['SERVICE_VERSION'] ?? '0.1.0';
  const platformEnv = process.env['PLATFORM_ENV'] ?? 'dev';

  const portStr = process.env['PORT'] ?? '8080';
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be a valid port number (1-65535), got: ${portStr}`);
  }

  const telemetryEndpoint = process.env['TELEMETRY_ENDPOINT'];
  const logLevel = (process.env['LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error') ?? 'info';

  // =========================================================================
  // WARNINGS FOR OPTIONAL BUT RECOMMENDED VARIABLES
  // =========================================================================

  if (platformEnv === 'production' && !telemetryEndpoint) {
    warnings.push('TELEMETRY_ENDPOINT not set - telemetry will be disabled in production');
  }

  if (!process.env['SERVICE_VERSION']) {
    warnings.push('SERVICE_VERSION not set - using default version');
  }

  // =========================================================================
  // BUILD CONFIGURATION OBJECT
  // =========================================================================

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const config: EnvironmentConfig = {
    ruvectorServiceUrl: ruvectorServiceUrl!,
    ruvectorApiKey: ruvectorApiKey!,
    agentName,
    agentDomain,
    agentPhase,
    agentLayer,
    agentVersion,
    serviceName,
    serviceVersion,
    platformEnv,
    port,
    telemetryEndpoint,
    logLevel,
  };

  return { valid: true, config, errors: [], warnings };
}

/**
 * Perform RuVector health check
 * Returns true if healthy, false otherwise
 */
export async function checkRuvectorHealth(
  endpoint: string,
  apiKey: string,
  timeoutMs: number = 10000
): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  const startTime = performance.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${endpoint}/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Service': 'llm-data-vault',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = performance.now() - startTime;

    if (response.ok) {
      return { healthy: true, latencyMs };
    }

    return {
      healthy: false,
      latencyMs,
      error: `RuVector health check returned HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    const latencyMs = performance.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('abort')) {
      return {
        healthy: false,
        latencyMs,
        error: `RuVector health check timed out after ${timeoutMs}ms`,
      };
    }

    return {
      healthy: false,
      latencyMs,
      error: `RuVector health check failed: ${errorMessage}`,
    };
  }
}

/**
 * Run complete startup validation
 *
 * This function will CRASH THE PROCESS (exit code 1) if:
 * - Required environment variables are missing
 * - RuVector service is not reachable
 *
 * This is intentional for Cloud Run - we want the container to fail fast
 * so Cloud Run can retry with a new instance or report the error.
 */
export async function runStartupValidation(): Promise<EnvironmentConfig> {
  const service = process.env['SERVICE_NAME'] ?? 'llm-data-vault';

  logStartupEvent({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    event: 'STARTUP_VALIDATION_BEGIN',
    service,
    phase: 'phase7',
    details: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  });

  // =========================================================================
  // STEP 1: Validate environment variables
  // =========================================================================

  logStartupEvent({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    event: 'VALIDATING_ENVIRONMENT',
    service,
    phase: 'phase7',
  });

  const validation = validateEnvironment();

  // Log warnings
  for (const warning of validation.warnings) {
    logStartupEvent({
      timestamp: new Date().toISOString(),
      level: 'WARN',
      event: 'ENVIRONMENT_WARNING',
      service,
      phase: 'phase7',
      details: { warning },
    });
  }

  // CRASH on validation errors
  if (!validation.valid) {
    for (const error of validation.errors) {
      logStartupEvent({
        timestamp: new Date().toISOString(),
        level: 'FATAL',
        event: 'ENVIRONMENT_VALIDATION_FAILED',
        service,
        phase: 'phase7',
        details: { error },
      });
    }

    console.error('\n========================================');
    console.error('FATAL: STARTUP VALIDATION FAILED');
    console.error('========================================');
    console.error('Missing or invalid environment variables:');
    for (const error of validation.errors) {
      console.error(`  - ${error}`);
    }
    console.error('========================================');
    console.error('The service cannot start without proper configuration.');
    console.error('Ensure Secret Manager secrets are properly configured.');
    console.error('========================================\n');

    process.exit(1);
  }

  const config = validation.config!;

  logStartupEvent({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    event: 'ENVIRONMENT_VALIDATED',
    service,
    phase: 'phase7',
    details: {
      ruvectorServiceUrl: config.ruvectorServiceUrl,
      agentName: config.agentName,
      agentDomain: config.agentDomain,
      agentPhase: config.agentPhase,
      platformEnv: config.platformEnv,
      // NOTE: Never log API keys
    },
  });

  // =========================================================================
  // STEP 2: Check RuVector service health
  // =========================================================================

  logStartupEvent({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    event: 'CHECKING_RUVECTOR_HEALTH',
    service,
    phase: 'phase7',
    details: { endpoint: config.ruvectorServiceUrl },
  });

  const healthCheck = await checkRuvectorHealth(
    config.ruvectorServiceUrl,
    config.ruvectorApiKey,
    10000 // 10 second timeout for startup
  );

  if (!healthCheck.healthy) {
    logStartupEvent({
      timestamp: new Date().toISOString(),
      level: 'FATAL',
      event: 'RUVECTOR_HEALTH_CHECK_FAILED',
      service,
      phase: 'phase7',
      details: {
        endpoint: config.ruvectorServiceUrl,
        latencyMs: healthCheck.latencyMs,
        error: healthCheck.error,
      },
    });

    console.error('\n========================================');
    console.error('FATAL: RUVECTOR SERVICE UNREACHABLE');
    console.error('========================================');
    console.error(`Endpoint: ${config.ruvectorServiceUrl}`);
    console.error(`Error: ${healthCheck.error}`);
    console.error(`Latency: ${healthCheck.latencyMs.toFixed(2)}ms`);
    console.error('========================================');
    console.error('The Data-Vault service requires RuVector for persistence.');
    console.error('Ensure ruvector-service is deployed and accessible.');
    console.error('========================================\n');

    process.exit(1);
  }

  logStartupEvent({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    event: 'RUVECTOR_HEALTH_CHECK_PASSED',
    service,
    phase: 'phase7',
    details: {
      endpoint: config.ruvectorServiceUrl,
      latencyMs: healthCheck.latencyMs,
    },
  });

  // =========================================================================
  // STEP 3: Startup validation complete
  // =========================================================================

  logStartupEvent({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    event: 'STARTUP_VALIDATION_COMPLETE',
    service,
    phase: 'phase7',
    details: {
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      platformEnv: config.platformEnv,
      ruvectorLatencyMs: healthCheck.latencyMs,
    },
  });

  return config;
}

/**
 * Get validated configuration synchronously (for use after async validation)
 * CRASHES if called before runStartupValidation
 */
let _validatedConfig: EnvironmentConfig | null = null;

export function setValidatedConfig(config: EnvironmentConfig): void {
  _validatedConfig = config;
}

export function getValidatedConfig(): EnvironmentConfig {
  if (!_validatedConfig) {
    console.error('FATAL: getValidatedConfig called before runStartupValidation');
    process.exit(1);
  }
  return _validatedConfig;
}
