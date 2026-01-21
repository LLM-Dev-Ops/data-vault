/**
 * Platform Registration for LLM-Data-Vault Agents
 *
 * Exports agent metadata for agentics-contracts registry.
 * This module declares agent capabilities, schemas, and version information
 * for integration with the LLM-Dev-Ops ecosystem.
 *
 * @module platform/registration
 */

import { z } from 'zod';

// =============================================================================
// VERSION INFORMATION
// =============================================================================

export const AGENT_VERSION = '0.1.0';
export const SCHEMA_VERSION = '1.0.0';
export const REGISTRY_NAMESPACE = 'llm-data-vault';

// =============================================================================
// AGENT METADATA SCHEMAS
// =============================================================================

/**
 * Schema for agent capability declarations
 */
export const AgentCapabilitySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  operations: z.array(z.enum([
    'authorize',
    'anonymize',
    'detect-pii',
    'encrypt',
    'decrypt',
    'audit',
    'lineage-track'
  ])),
  constraints: z.object({
    maxPayloadSizeBytes: z.number().positive(),
    maxConcurrentRequests: z.number().positive(),
    timeoutMs: z.number().positive(),
    retryPolicy: z.object({
      maxAttempts: z.number().min(1).max(10),
      backoffMs: z.number().positive(),
      backoffMultiplier: z.number().min(1).max(5)
    }).optional()
  }),
  compliance: z.array(z.enum([
    'GDPR',
    'CCPA',
    'HIPAA',
    'SOC2',
    'ISO27001'
  ])).optional()
});

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

/**
 * Schema for agent registration metadata
 */
export const AgentRegistrationSchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().min(1),
  namespace: z.literal('llm-data-vault'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string(),
  capabilities: z.array(AgentCapabilitySchema),
  inputSchemaRef: z.string().url(),
  outputSchemaRef: z.string().url(),
  decisionEventSchemaRef: z.string().url(),
  endpoints: z.object({
    authorize: z.string().url(),
    anonymize: z.string().url(),
    health: z.string().url()
  }),
  metadata: z.object({
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    maintainer: z.string().email(),
    repository: z.string().url(),
    documentation: z.string().url().optional()
  }),
  // Enforcement boundaries - what this agent does NOT do
  boundaries: z.object({
    executesInference: z.literal(false),
    modifiesPrompts: z.literal(false),
    routesRequests: z.literal(false),
    triggersOrchestration: z.literal(false)
  })
});

export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>;

// =============================================================================
// INPUT/OUTPUT SCHEMA REFERENCES
// =============================================================================

/**
 * Schema reference URLs for contract validation
 */
export const SchemaReferences = {
  // Input schemas
  inputs: {
    authorizeRequest: 'https://schemas.llm-dev-ops.io/data-vault/v1/authorize-request.json',
    anonymizeRequest: 'https://schemas.llm-dev-ops.io/data-vault/v1/anonymize-request.json',
    detectPiiRequest: 'https://schemas.llm-dev-ops.io/data-vault/v1/detect-pii-request.json',
    encryptRequest: 'https://schemas.llm-dev-ops.io/data-vault/v1/encrypt-request.json'
  },
  // Output schemas
  outputs: {
    authorizeResponse: 'https://schemas.llm-dev-ops.io/data-vault/v1/authorize-response.json',
    anonymizeResponse: 'https://schemas.llm-dev-ops.io/data-vault/v1/anonymize-response.json',
    detectPiiResponse: 'https://schemas.llm-dev-ops.io/data-vault/v1/detect-pii-response.json',
    encryptResponse: 'https://schemas.llm-dev-ops.io/data-vault/v1/encrypt-response.json'
  },
  // Event schemas
  events: {
    decisionEvent: 'https://schemas.llm-dev-ops.io/common/v1/decision-event.json',
    telemetryEvent: 'https://schemas.llm-dev-ops.io/common/v1/telemetry-event.json',
    auditEvent: 'https://schemas.llm-dev-ops.io/data-vault/v1/audit-event.json'
  }
} as const;

// =============================================================================
// AGENT CAPABILITY DEFINITIONS
// =============================================================================

/**
 * Authorization agent capability - validates data access requests
 */
export const AuthorizeCapability: AgentCapability = {
  name: 'data-authorization',
  description: 'Validates and authorizes data access requests against policies',
  version: AGENT_VERSION,
  operations: ['authorize', 'audit'],
  constraints: {
    maxPayloadSizeBytes: 1024 * 1024, // 1MB
    maxConcurrentRequests: 1000,
    timeoutMs: 5000,
    retryPolicy: {
      maxAttempts: 3,
      backoffMs: 100,
      backoffMultiplier: 2
    }
  },
  compliance: ['GDPR', 'CCPA', 'SOC2']
};

/**
 * Anonymization agent capability - transforms sensitive data
 */
export const AnonymizeCapability: AgentCapability = {
  name: 'data-anonymization',
  description: 'Detects and anonymizes PII/sensitive data in datasets',
  version: AGENT_VERSION,
  operations: ['anonymize', 'detect-pii', 'lineage-track'],
  constraints: {
    maxPayloadSizeBytes: 10 * 1024 * 1024, // 10MB
    maxConcurrentRequests: 100,
    timeoutMs: 30000,
    retryPolicy: {
      maxAttempts: 3,
      backoffMs: 500,
      backoffMultiplier: 2
    }
  },
  compliance: ['GDPR', 'CCPA', 'HIPAA']
};

/**
 * Encryption agent capability - handles data encryption/decryption
 */
export const EncryptionCapability: AgentCapability = {
  name: 'data-encryption',
  description: 'Encrypts and decrypts data using AES-256-GCM with KMS integration',
  version: AGENT_VERSION,
  operations: ['encrypt', 'decrypt', 'audit'],
  constraints: {
    maxPayloadSizeBytes: 100 * 1024 * 1024, // 100MB
    maxConcurrentRequests: 500,
    timeoutMs: 60000,
    retryPolicy: {
      maxAttempts: 5,
      backoffMs: 200,
      backoffMultiplier: 2
    }
  },
  compliance: ['GDPR', 'HIPAA', 'SOC2', 'ISO27001']
};

// =============================================================================
// AGENT REGISTRATION FACTORY
// =============================================================================

/**
 * Creates a complete agent registration for the agentics-contracts registry
 */
export function createAgentRegistration(config: {
  agentId: string;
  baseUrl: string;
  maintainerEmail: string;
}): AgentRegistration {
  const now = new Date().toISOString();

  return {
    agentId: config.agentId,
    name: 'llm-data-vault-agent',
    namespace: REGISTRY_NAMESPACE,
    version: AGENT_VERSION,
    description: 'Enterprise-grade secure storage, anonymization, and data governance for LLM workflows',
    capabilities: [
      AuthorizeCapability,
      AnonymizeCapability,
      EncryptionCapability
    ],
    inputSchemaRef: SchemaReferences.inputs.authorizeRequest,
    outputSchemaRef: SchemaReferences.outputs.authorizeResponse,
    decisionEventSchemaRef: SchemaReferences.events.decisionEvent,
    endpoints: {
      authorize: `${config.baseUrl}/api/v1/authorize`,
      anonymize: `${config.baseUrl}/api/v1/anonymize`,
      health: `${config.baseUrl}/health`
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
      maintainer: config.maintainerEmail,
      repository: 'https://github.com/LLM-Dev-Ops/LLM-Data-Vault',
      documentation: 'https://docs.llm-dev-ops.io/data-vault'
    },
    // CRITICAL: Enforcement boundaries - this agent does NOT:
    boundaries: {
      executesInference: false,  // Does NOT execute LLM inference
      modifiesPrompts: false,    // Does NOT modify prompts
      routesRequests: false,     // Does NOT route to other services
      triggersOrchestration: false // Does NOT trigger orchestration
    }
  };
}

// =============================================================================
// REGISTRY EXPORT FUNCTIONS
// =============================================================================

/**
 * Exports agent metadata in agentics-contracts registry format
 */
export function exportRegistryMetadata(registration: AgentRegistration): string {
  // Validate before export
  const validated = AgentRegistrationSchema.parse(registration);
  return JSON.stringify(validated, null, 2);
}

/**
 * Validates an agent registration against the schema
 */
export function validateRegistration(registration: unknown): {
  valid: boolean;
  errors: string[];
} {
  const result = AgentRegistrationSchema.safeParse(registration);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

/**
 * Generates capability manifest for documentation/discovery
 */
export function generateCapabilityManifest(): {
  namespace: string;
  version: string;
  capabilities: Array<{
    name: string;
    operations: string[];
    constraints: AgentCapability['constraints'];
  }>;
} {
  return {
    namespace: REGISTRY_NAMESPACE,
    version: AGENT_VERSION,
    capabilities: [
      AuthorizeCapability,
      AnonymizeCapability,
      EncryptionCapability
    ].map(cap => ({
      name: cap.name,
      operations: cap.operations,
      constraints: cap.constraints
    }))
  };
}

// =============================================================================
// BOUNDARY VERIFICATION
// =============================================================================

/**
 * Runtime verification that agent stays within boundaries
 * This is called before any operation to ensure compliance
 */
export function verifyBoundaryCompliance(operation: string): {
  allowed: boolean;
  reason?: string;
} {
  // Explicitly forbidden operations
  const forbiddenOperations = [
    'inference',
    'llm-call',
    'prompt-modify',
    'prompt-inject',
    'route-request',
    'trigger-orchestration',
    'spawn-agent',
    'execute-code'
  ];

  const normalizedOp = operation.toLowerCase();

  for (const forbidden of forbiddenOperations) {
    if (normalizedOp.includes(forbidden)) {
      return {
        allowed: false,
        reason: `Operation '${operation}' violates agent boundary: ${forbidden} is not permitted`
      };
    }
  }

  // Allowed operations
  const allowedOperations = [
    'authorize',
    'anonymize',
    'detect-pii',
    'encrypt',
    'decrypt',
    'audit',
    'lineage-track',
    'health-check',
    'emit-event',
    'emit-telemetry'
  ];

  const isAllowed = allowedOperations.some(allowed =>
    normalizedOp.includes(allowed)
  );

  if (!isAllowed) {
    return {
      allowed: false,
      reason: `Operation '${operation}' is not in the allowed operations list`
    };
  }

  return { allowed: true };
}
