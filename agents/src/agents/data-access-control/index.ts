/**
 * LLM-Data-Vault: Data Access Control Agent
 *
 * Main export module for the Data Access Control Agent.
 * This agent evaluates data access requests using RBAC/ABAC policies
 * and regulatory constraints (GDPR, CCPA, HIPAA).
 *
 * @example
 * ```typescript
 * import {
 *   DataAccessControlAgent,
 *   createDataAccessControlAgent,
 *   createHandler,
 *   PolicyEvaluator,
 * } from '@llm-data-vault/agents/data-access-control';
 *
 * // Create agent with policies
 * const agent = createDataAccessControlAgent(policies);
 *
 * // Or create Edge Function handler
 * export const dataAccessControl = createHandler({
 *   policies,
 *   enableTelemetry: true,
 * });
 * ```
 *
 * @module agents/data-access-control
 */

// Agent exports
export {
  DataAccessControlAgent,
  createDataAccessControlAgent,
  AGENT_ID,
  AGENT_VERSION,
  type DataAccessControlAgentConfig,
} from './agent.js';

// Policy evaluator exports
export {
  PolicyEvaluator,
  createDefaultPolicyEvaluator,
  createGDPRConstraints,
  createHIPAAConstraints,
  createCCPAConstraints,
  DEFAULT_CONFIG as DEFAULT_EVALUATOR_CONFIG,
  type PolicyEvaluatorConfig,
  type RegulatoryFramework,
  type RegulatoryConstraint,
  type RegulatoryRequirement,
  type RBACEvaluationResult,
  type ABACEvaluationResult,
  type RegulatoryEvaluationResult,
  type PolicyEvaluationSummary,
} from './policy-evaluator.js';

// RuVector client exports
export {
  DataAccessRuVectorClient,
  createDataAccessRuVectorClient,
  type DataAccessRuVectorConfig,
} from './ruvector-client.js';

// Handler exports
export {
  handleDataAccessControl,
  handleHealthCheck,
  createHandler,
  resetHandlerState,
  type HandlerConfig,
} from './handler.js';

// Re-export contract types for convenience
export type {
  AccessAuthorizationRequest,
  AccessAuthorizationResponse,
  AccessPolicy,
  AccessPolicyRule,
  PolicyCondition,
  PolicyEvaluationResult,
  Subject,
  Resource,
  AccessContext,
  PermissionType,
  ResourceType,
  AccessDecision,
} from '../../contracts/index.js';

// Re-export base types
export type {
  AgentMetadata,
  ExecutionContext,
  AgentResult,
} from '../../runtime/agent-base.js';

// Re-export decision event types
export type {
  DecisionEvent,
  DecisionType,
  AppliedConstraint,
  ConfidenceBreakdown,
} from '../../contracts/index.js';
