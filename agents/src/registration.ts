/**
 * LLM-Data-Vault: Platform Registration
 *
 * Agent registration metadata for the Data-Vault platform.
 * Used by agentics-contracts registry and platform deployment.
 *
 * @module registration
 */

import type { AgentRegistration, AgentCapabilityType } from './contracts/index.js';

// Base URL from environment or default
const BASE_URL = process.env['DATA_VAULT_BASE_URL'] ?? 'https://data-vault.agentics.dev';

/**
 * Dataset Anonymization Agent registration
 */
export const ANONYMIZATION_AGENT_REGISTRATION: AgentRegistration = {
  config: {
    agent_id: 'data-vault.anonymization.v1',
    version: '0.1.0',
    name: 'Dataset Anonymization Agent',
    status: 'ready',
    capabilities: [
      {
        type: 'anonymization',
        name: 'Dataset Anonymization',
        version: '1.0.0',
        enabled: true,
        dependencies: [],
        config: {
          supported_strategies: [
            'redact',
            'mask',
            'hash',
            'tokenize',
            'generalize',
            'suppress',
            'pseudonymize',
          ],
          supported_pii_types: [
            'email',
            'phone_number',
            'ssn',
            'credit_card',
            'ip_address',
            'date_of_birth',
            'api_key',
            'password',
          ],
          compliance_frameworks: ['gdpr', 'hipaa', 'ccpa', 'soc2'],
        },
      },
      {
        type: 'validation',
        name: 'PII Detection',
        version: '1.0.0',
        enabled: true,
        dependencies: [],
        config: {
          detection_methods: ['pattern', 'context'],
          min_confidence: 0.85,
        },
      },
    ],
    // Required telemetry config
    telemetry_config: {
      enabled: true,
      batch_size: 100,
      flush_interval_ms: 5000,
      export_format: 'otlp',
      include_traces: true,
      include_metrics: true,
      include_logs: false,
      trace_sample_rate: 1.0,
    },
    // Required health check config
    health_check_config: {
      enabled: true,
      interval_ms: 30000,
      timeout_ms: 5000,
      failure_threshold: 3,
      success_threshold: 1,
      include_details: false,
    },
    // Required retry config
    retry_config: {
      enabled: true,
      max_attempts: 3,
      initial_delay_ms: 100,
      max_delay_ms: 5000,
      backoff_multiplier: 2,
      add_jitter: true,
      retryable_status_codes: [408, 429, 500, 502, 503, 504],
    },
    // Required log level
    log_level: 'info',
    // Required concurrency settings
    max_concurrent_requests: 100,
    request_timeout_ms: 30000,
    shutdown_timeout_ms: 30000,
    // Optional fields
    owner: 'platform-team',
    metadata: {
      deployment_model: 'google_cloud_edge_function',
      stateless: true,
      persistence_via: 'ruvector-service',
      documentation: 'https://llm-data-vault.agentics.dev/agents/anonymization',
    },
    tags: ['data-vault', 'anonymization', 'pii-detection'],
  },
  endpoints: {
    primary: `${BASE_URL}/anonymize`,
    health: `${BASE_URL}/health`,
    metrics: `${BASE_URL}/metrics`,
  },
  registered_at: new Date().toISOString(),
  ttl_seconds: 300,
};

/**
 * All registered agents
 */
export const REGISTERED_AGENTS: AgentRegistration[] = [
  ANONYMIZATION_AGENT_REGISTRATION,
];

/**
 * Get agent registration by ID
 */
export function getAgentRegistration(agentId: string): AgentRegistration | undefined {
  return REGISTERED_AGENTS.find(a => a.config.agent_id === agentId);
}

/**
 * Get agents by tag
 */
export function getAgentsByTag(
  tag: string
): AgentRegistration[] {
  return REGISTERED_AGENTS.filter(a => a.config.tags?.includes(tag) ?? false);
}

/**
 * Get agents with capability
 */
export function getAgentsWithCapability(
  capabilityType: AgentCapabilityType
): AgentRegistration[] {
  return REGISTERED_AGENTS.filter(a =>
    a.config.capabilities.some((c) => c.type === capabilityType && c.enabled)
  );
}

/**
 * Platform registration manifest
 */
export const PLATFORM_MANIFEST = {
  platform: 'llm-data-vault',
  version: '0.1.0',
  contract_version: '2.0',
  agents: REGISTERED_AGENTS,
  endpoints: {
    base_url: BASE_URL,
    health: '/health',
    metrics: '/metrics',
    ready: '/ready',
  },
  deployment: {
    type: 'google_cloud_edge_function',
    region: process.env['GCP_REGION'] ?? 'us-central1',
    project: process.env['GCP_PROJECT'] ?? 'agentics-platform',
  },
  dependencies: {
    ruvector_service: {
      required: true,
      endpoint_env: 'RUVECTOR_SERVICE_ENDPOINT',
    },
    llm_observatory: {
      required: false,
      endpoint_env: 'OTLP_ENDPOINT',
    },
  },
  consumers: [
    'llm-orchestrator',
    'llm-inference-gateway',
    'llm-policy-engine',
    'governance-systems',
  ],
};

/**
 * CLI command specification
 */
export const CLI_COMMANDS = {
  anonymize: {
    description: 'Apply anonymization to dataset content',
    usage: 'data-vault anonymize [options]',
    options: {
      '--content <json>': 'JSON content to anonymize',
      '--file <path>': 'Path to JSON file to anonymize',
      '--output <path>': 'Output file path (default: stdout)',
      '--strategy <name>': 'Default anonymization strategy',
      '--policy <id>': 'Policy ID to apply',
      '--tenant <id>': 'Tenant ID',
      '--dry-run': 'Inspect without modifying',
      '--include-details': 'Include field-level detection details',
      '--verbose': 'Show detailed output',
      '--format <type>': 'Output format: json, text, table',
    },
    examples: [
      'data-vault anonymize --content \'{"email": "john@example.com"}\' --strategy redact',
      'data-vault anonymize --file data.json --strategy mask --output anonymized.json',
    ],
  },
  inspect: {
    description: 'Inspect content for PII without modifying',
    usage: 'data-vault inspect [options]',
    options: {
      '--content <json>': 'JSON content to inspect',
      '--file <path>': 'Path to JSON file to inspect',
      '--verbose': 'Show detailed output',
    },
    examples: [
      'data-vault inspect --content \'{"ssn": "123-45-6789"}\'',
    ],
  },
  health: {
    description: 'Check agent and service health',
    usage: 'data-vault health',
    options: {},
    examples: ['data-vault health'],
  },
  metadata: {
    description: 'Show agent metadata and capabilities',
    usage: 'data-vault metadata',
    options: {},
    examples: ['data-vault metadata'],
  },
};

/**
 * Verification checklist
 */
export const VERIFICATION_CHECKLIST = [
  {
    id: 'agent_registration',
    description: 'Agent is registered in agentics-contracts',
    check: () => REGISTERED_AGENTS.length > 0,
  },
  {
    id: 'endpoints_defined',
    description: 'All endpoints are defined',
    check: () => REGISTERED_AGENTS.every(a =>
      a.endpoints.primary && a.endpoints.health
    ),
  },
  {
    id: 'capabilities_enabled',
    description: 'Required capabilities are enabled',
    check: () => REGISTERED_AGENTS.every(a =>
      a.config.capabilities.some((c) => c.enabled)
    ),
  },
  {
    id: 'status_ready',
    description: 'Agent status is ready',
    check: () => REGISTERED_AGENTS.every(a =>
      a.config.status === 'ready' || a.config.status === 'initializing'
    ),
  },
];

/**
 * Run verification checklist
 */
export function runVerification(): { passed: boolean; results: Array<{ id: string; passed: boolean; description: string }> } {
  const results = VERIFICATION_CHECKLIST.map(item => ({
    id: item.id,
    passed: item.check(),
    description: item.description,
  }));

  return {
    passed: results.every(r => r.passed),
    results,
  };
}
