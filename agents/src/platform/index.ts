/**
 * Platform Module - Registration and Integration Exports
 *
 * @module platform
 */

// Registration exports
export {
  // Constants
  AGENT_VERSION,
  SCHEMA_VERSION,
  REGISTRY_NAMESPACE,
  SchemaReferences,

  // Schemas
  AgentCapabilitySchema,
  AgentRegistrationSchema,

  // Types
  type AgentCapability,
  type AgentRegistration,

  // Capability definitions
  AuthorizeCapability,
  AnonymizeCapability,
  EncryptionCapability,

  // Factory functions
  createAgentRegistration,
  exportRegistryMetadata,
  validateRegistration,
  generateCapabilityManifest,
  verifyBoundaryCompliance
} from './registration.js';

// Integration exports
export {
  // Schemas
  DecisionEventSchema,
  TelemetryEventSchema,
  PolicySchema,
  DatasetRequestSchema,
  DatasetResponseSchema,
  ApprovedDatasetSchema,

  // Types
  type DecisionEvent,
  type TelemetryEvent,
  type Policy,
  type DatasetRequest,
  type DatasetResponse,
  type ApprovedDataset,

  // Integration classes
  PolicyEngineIntegration,
  OrchestratorIntegration,
  InferenceGatewayIntegration,
  GovernanceEventEmitter,
  GovernanceEventConsumer,

  // Factory
  createIntegrations,
  type IntegrationConfig
} from './integration.js';
