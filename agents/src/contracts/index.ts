/**
 * LLM-Data-Vault: Agentics Contracts
 *
 * Central export point for all agent contracts.
 * These schemas are the ONLY source of truth for Data-Vault agent interfaces.
 *
 * @module agentics-contracts
 */

// =============================================================================
// Decision Events - Core schema for all agent emissions
// =============================================================================

export {
  DecisionTypeSchema,
  ConstraintTypeSchema,
  AppliedConstraintSchema,
  ConfidenceBreakdownSchema,
  DecisionEventSchema,
  validateDecisionEvent,
  createDecisionEvent,
} from './decision-event.js';

export type {
  DecisionType,
  ConstraintType,
  AppliedConstraint,
  ConfidenceBreakdown,
  DecisionEvent,
} from './decision-event.js';

// =============================================================================
// Anonymization Contracts
// =============================================================================

export {
  PIITypeSchema,
  AnonymizationStrategySchema,
  PIIMatchSchema,
  FieldAnonymizationRuleSchema,
  AnonymizationPolicySchema,
  AnonymizationRequestSchema,
  FieldAnonymizationResultSchema,
  AnonymizationResponseSchema,
  validateAnonymizationRequest,
  validateAnonymizationResponse,
} from './anonymization.js';

export type {
  PIIType,
  AnonymizationStrategy,
  PIIMatch,
  FieldAnonymizationRule,
  AnonymizationPolicy,
  AnonymizationRequest,
  FieldAnonymizationResult,
  AnonymizationResponse,
} from './anonymization.js';

// =============================================================================
// Access Control Contracts
// =============================================================================

export {
  AccessDecisionSchema,
  PermissionTypeSchema,
  ResourceTypeSchema,
  SubjectSchema,
  ResourceSchema,
  AccessContextSchema,
  PolicyConditionSchema,
  AccessPolicyRuleSchema,
  AccessPolicySchema,
  AccessAuthorizationRequestSchema,
  PolicyEvaluationResultSchema,
  AccessAuthorizationResponseSchema,
  validateAccessAuthorizationRequest,
  validateAccessAuthorizationResponse,
} from './access-control.js';

export type {
  AccessDecision,
  PermissionType,
  ResourceType,
  Subject,
  Resource,
  AccessContext,
  PolicyCondition,
  AccessPolicyRule,
  AccessPolicy,
  AccessAuthorizationRequest,
  PolicyEvaluationResult,
  AccessAuthorizationResponse,
} from './access-control.js';

// Re-export all schemas for validation utilities
export * as schemas from './schemas.js';

// =============================================================================
// V2 Extended Schemas (agentics-contracts compliant)
// =============================================================================

// Decision Event Schema (V2 - Extended)
export {
  DecisionEventSchema as DecisionEventSchemaV2,
  DecisionTypeSchema as DecisionTypeSchemaV2,
  createDecisionEvent as createDecisionEventV2,
  safeParseDecisionEvent,
  isValidDecisionEvent,
} from './decision-event.schema.js';

export type {
  DecisionEvent as DecisionEventV2,
  DecisionType as DecisionTypeV2,
} from './decision-event.schema.js';

// Data Access Control Schemas (V2 - Extended)
export {
  DataAccessRequestSchema,
  DataAccessResponseSchema,
  AccessPolicySchema as AccessPolicySchemaV2,
  PolicyRuleSchema,
  PolicyConditionSchema as PolicyConditionSchemaV2,
  PolicyEffectSchema,
  DataAccessActionSchema,
  ComparisonOperatorSchema,
  RequestContextSchema,
  AccessConstraintSchema,
  createDataAccessRequest,
  createDataAccessResponse,
  createAccessPolicy as createAccessPolicyV2,
  safeParseDataAccessRequest,
  safeParseDataAccessResponse,
  safeParseAccessPolicy,
} from './data-access.schema.js';

export type {
  DataAccessRequest,
  DataAccessResponse,
  AccessPolicy as AccessPolicyV2,
  PolicyRule,
  PolicyCondition as PolicyConditionV2,
  PolicyEffect,
  DataAccessAction,
  ComparisonOperator,
  RequestContext,
  AccessConstraint,
} from './data-access.schema.js';

// Anonymization Schemas (V2 - Extended)
export {
  AnonymizationRequestSchema as AnonymizationRequestSchemaV2,
  AnonymizationResponseSchema as AnonymizationResponseSchemaV2,
  AnonymizationConfigSchema,
  AnonymizationStrategySchema as AnonymizationStrategySchemaV2,
  AnonymizationRuleSchema,
  PIITypeSchema as PIITypeSchemaV2,
  PIIDetectionSchema,
  ComplianceFrameworkSchema,
  StrategyOptionsSchema,
  createAnonymizationRequest as createAnonymizationRequestV2,
  createAnonymizationResponse as createAnonymizationResponseV2,
  createAnonymizationConfig,
  safeParseAnonymizationRequest,
  safeParseAnonymizationResponse,
  isStrategyCompatible,
} from './anonymization.schema.js';

export type {
  AnonymizationRequest as AnonymizationRequestV2,
  AnonymizationResponse as AnonymizationResponseV2,
  AnonymizationConfig,
  AnonymizationStrategy as AnonymizationStrategyV2,
  AnonymizationRule,
  PIIType as PIITypeV2,
  PIIDetection,
  ComplianceFramework,
  StrategyOptions,
} from './anonymization.schema.js';

// Agent Configuration Schemas
export {
  AgentConfigSchema,
  TelemetryConfigSchema,
  AgentCapabilitySchema,
  AgentCapabilityTypeSchema,
  AgentStatusSchema,
  HealthCheckConfigSchema,
  RetryConfigSchema,
  LogLevelSchema,
  TelemetryFormatSchema,
  AgentRegistrationSchema,
  createAgentConfig,
  createTelemetryConfig,
  createAgentRegistration,
  safeParseAgentConfig,
  safeParseTelemetryConfig,
  mergeWithDefaults,
  hasCapability,
  getCapabilities,
} from './agent-config.schema.js';

export type {
  AgentConfig,
  TelemetryConfig,
  AgentCapability,
  AgentCapabilityType,
  AgentStatus,
  HealthCheckConfig,
  RetryConfig,
  LogLevel,
  TelemetryFormat,
  AgentRegistration,
} from './agent-config.schema.js';

// =============================================================================
// Re-export Zod for consumers who need to extend schemas
// =============================================================================

export { z } from 'zod';
