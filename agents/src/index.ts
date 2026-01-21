/**
 * LLM-Data-Vault: Agent Infrastructure
 *
 * Main entry point for the LLM-Data-Vault agent infrastructure.
 *
 * This module provides:
 * - Agentics contracts (schemas and validation)
 * - Agent runtime infrastructure
 * - Dataset Anonymization Agent
 * - Google Cloud Edge Function handlers
 * - RuVector service client
 * - LLM-Observatory telemetry
 * - Platform registration and integration
 *
 * CONSTITUTIONAL REQUIREMENTS:
 * - Agents are stateless at runtime
 * - No local persistence
 * - Persistence only via ruvector-service
 * - No direct database connections
 * - No SQL execution
 * - No inference execution
 * - No prompt/response modification
 * - No request routing
 * - No orchestration triggering
 *
 * @module @llm-data-vault/agents
 */

// =============================================================================
// Contracts (agentics-contracts)
// =============================================================================

export * from './contracts/index.js';

// =============================================================================
// Runtime Infrastructure
// =============================================================================

export {
  DataVaultAgent,
  hashInputs,
} from './runtime/index.js';

export type {
  AgentMetadata,
  ExecutionContext,
  AgentResult,
  AgentClassification,
} from './runtime/index.js';

// =============================================================================
// Agents
// =============================================================================

export {
  DatasetAnonymizationAgent,
  createAnonymizationAgent,
} from './agents/index.js';

// =============================================================================
// Edge Functions
// =============================================================================

export {
  AnonymizationFunctionHandler,
  anonymizationFunction,
  getHandler,
} from './functions/index.js';

// =============================================================================
// RuVector Client
// =============================================================================

export {
  RuVectorClient,
  createRuVectorClient,
} from './ruvector-client/index.js';

export type {
  RuVectorConfig,
  PersistResult,
  QueryOptions,
  QueryResult,
} from './ruvector-client/index.js';

// =============================================================================
// Telemetry
// =============================================================================

export {
  TelemetryEmitter,
  initTelemetry,
  getTelemetry,
} from './telemetry/index.js';

export type {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryMetrics,
  TelemetryConfig,
} from './telemetry/index.js';

// =============================================================================
// Platform Registration & Integration (NEW)
// =============================================================================

export {
  // Registration
  AGENT_VERSION,
  SCHEMA_VERSION,
  REGISTRY_NAMESPACE,
  SchemaReferences,
  AgentCapabilitySchema,
  AgentRegistrationSchema,
  createAgentRegistration,
  exportRegistryMetadata,
  validateRegistration,
  generateCapabilityManifest,
  verifyBoundaryCompliance,
  AuthorizeCapability,
  AnonymizeCapability,
  EncryptionCapability,

  // Integration
  DecisionEventSchema,
  TelemetryEventSchema,
  PolicySchema,
  DatasetRequestSchema,
  DatasetResponseSchema,
  ApprovedDatasetSchema,
  PolicyEngineIntegration,
  OrchestratorIntegration,
  InferenceGatewayIntegration,
  GovernanceEventEmitter,
  GovernanceEventConsumer,
  createIntegrations,

  // Types
  type AgentCapability,
  type AgentRegistration,
  type DecisionEvent,
  type Policy,
  type DatasetRequest,
  type DatasetResponse,
  type ApprovedDataset,
  type IntegrationConfig
} from './platform/index.js';

// =============================================================================
// Agent Boundaries (Runtime Enforcement)
// =============================================================================

/**
 * Agent boundary constraints - enforced at runtime
 * These are the operations that this agent MUST NOT perform
 */
export const AGENT_BOUNDARIES = {
  executesInference: false,
  modifiesPrompts: false,
  routesRequests: false,
  triggersOrchestration: false,
  spawnsAgents: false,
  executesCode: false
} as const;

/**
 * Supported operations for this agent
 * These are the ONLY operations this agent is permitted to perform
 */
export const SUPPORTED_OPERATIONS = [
  'authorize',
  'anonymize',
  'detect-pii',
  'encrypt',
  'decrypt',
  'audit',
  'lineage-track',
  'emit-event',
  'emit-telemetry',
  'health-check'
] as const;

export type SupportedOperation = typeof SUPPORTED_OPERATIONS[number];
