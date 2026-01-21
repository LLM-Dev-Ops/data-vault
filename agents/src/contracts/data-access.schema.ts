/**
 * @fileoverview Data Access Control Schemas for LLM-Data-Vault Agents
 * @description Defines schemas for data access requests, responses, and policies.
 * These schemas are used by the data access control agent to evaluate and
 * enforce access policies on dataset operations.
 * @module @llm-data-vault/agents/contracts/data-access
 */

import { z } from 'zod';

/**
 * Data access actions that can be requested
 */
export const DataAccessActionSchema = z.enum([
  'read',
  'write',
  'delete',
  'export',
  'share',
  'transform',
  'analyze',
]);

/**
 * Type alias for data access actions
 */
export type DataAccessAction = z.infer<typeof DataAccessActionSchema>;

/**
 * Comparison operators for policy conditions
 */
export const ComparisonOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'in',
  'not_in',
  'matches', // regex match
]);

/**
 * Type alias for comparison operators
 */
export type ComparisonOperator = z.infer<typeof ComparisonOperatorSchema>;

/**
 * Policy condition schema
 * @description Defines a single condition to be evaluated in a policy rule
 */
export const PolicyConditionSchema = z.object({
  /**
   * The attribute/field to evaluate
   * @example "requester.role", "context.location", "dataset.sensitivity"
   */
  attribute: z.string().min(1, 'Attribute is required'),

  /**
   * The comparison operator to use
   */
  operator: ComparisonOperatorSchema,

  /**
   * The value to compare against
   */
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
  ]),
});

/**
 * TypeScript type for PolicyCondition
 */
export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;

/**
 * Policy rule effect
 */
export const PolicyEffectSchema = z.enum(['allow', 'deny']);

/**
 * Type alias for policy effect
 */
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>;

/**
 * Policy rule schema
 * @description Defines a single rule within an access policy
 */
export const PolicyRuleSchema = z.object({
  /**
   * Unique identifier for this rule
   */
  rule_id: z.string().min(1, 'Rule ID is required'),

  /**
   * Human-readable description of the rule
   */
  description: z.string().optional(),

  /**
   * Actions this rule applies to (empty means all actions)
   */
  actions: z.array(DataAccessActionSchema).default([]),

  /**
   * Conditions that must all be satisfied for the rule to apply
   */
  conditions: z.array(PolicyConditionSchema),

  /**
   * The effect when all conditions are met
   */
  effect: PolicyEffectSchema,

  /**
   * Priority for rule ordering (higher = evaluated first)
   */
  priority: z.number().int().min(0).default(0),
});

/**
 * TypeScript type for PolicyRule
 */
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

/**
 * Access Policy Schema
 * @description Defines a complete access control policy with rules and conditions
 *
 * @example
 * ```typescript
 * const policy: AccessPolicy = {
 *   policy_id: 'gdpr-data-access-policy',
 *   name: 'GDPR Data Access Policy',
 *   description: 'Enforces GDPR compliance for EU data subjects',
 *   rules: [
 *     {
 *       rule_id: 'consent-required',
 *       actions: ['read', 'export'],
 *       conditions: [
 *         { attribute: 'dataset.contains_pii', operator: 'equals', value: true },
 *         { attribute: 'context.consent_given', operator: 'equals', value: false }
 *       ],
 *       effect: 'deny',
 *       priority: 100
 *     }
 *   ],
 *   default_effect: 'deny',
 *   enabled: true
 * };
 * ```
 */
export const AccessPolicySchema = z.object({
  /**
   * Unique identifier for the policy
   */
  policy_id: z.string().min(1, 'Policy ID is required'),

  /**
   * Human-readable name for the policy
   */
  name: z.string().min(1, 'Policy name is required'),

  /**
   * Detailed description of the policy's purpose
   */
  description: z.string().optional(),

  /**
   * Version of the policy (for tracking changes)
   */
  version: z.string().default('1.0.0'),

  /**
   * Ordered list of rules to evaluate
   */
  rules: z.array(PolicyRuleSchema).min(1, 'At least one rule is required'),

  /**
   * Additional conditions that apply to all rules
   */
  conditions: z.array(PolicyConditionSchema).default([]),

  /**
   * Default effect when no rules match
   */
  default_effect: PolicyEffectSchema.default('deny'),

  /**
   * Whether the policy is currently active
   */
  enabled: z.boolean().default(true),

  /**
   * Compliance frameworks this policy helps enforce
   */
  compliance_frameworks: z.array(z.string()).default([]),

  /**
   * Metadata for tracking and auditing
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * TypeScript type for AccessPolicy
 */
export type AccessPolicy = z.infer<typeof AccessPolicySchema>;

/**
 * Request context schema
 * @description Provides contextual information about the access request
 */
export const RequestContextSchema = z.object({
  /**
   * Purpose of the data access
   */
  purpose: z.string().optional(),

  /**
   * Geographic location of the requester
   */
  location: z.string().optional(),

  /**
   * Whether explicit consent has been given
   */
  consent_given: z.boolean().optional(),

  /**
   * IP address of the requester
   */
  ip_address: z.string().ip().optional(),

  /**
   * User agent or client information
   */
  user_agent: z.string().optional(),

  /**
   * Session or request correlation ID
   */
  correlation_id: z.string().uuid().optional(),

  /**
   * Additional context attributes
   */
  attributes: z.record(z.string(), z.unknown()).optional(),
});

/**
 * TypeScript type for RequestContext
 */
export type RequestContext = z.infer<typeof RequestContextSchema>;

/**
 * Data Access Request Schema
 * @description Represents a request to access a dataset with specified action
 *
 * @example
 * ```typescript
 * const request: DataAccessRequest = {
 *   dataset_id: 'dataset-123',
 *   requester_id: 'user-456',
 *   action: 'read',
 *   context: {
 *     purpose: 'analytics',
 *     consent_given: true,
 *     location: 'EU'
 *   },
 *   policies: ['gdpr-policy', 'internal-policy']
 * };
 * ```
 */
export const DataAccessRequestSchema = z.object({
  /**
   * Unique identifier of the dataset being accessed
   */
  dataset_id: z.string().min(1, 'Dataset ID is required'),

  /**
   * Identifier of the entity requesting access
   */
  requester_id: z.string().min(1, 'Requester ID is required'),

  /**
   * The action being requested on the dataset
   */
  action: DataAccessActionSchema,

  /**
   * Contextual information about the request
   */
  context: RequestContextSchema,

  /**
   * List of policy IDs to evaluate against
   */
  policies: z.array(z.string()).min(1, 'At least one policy is required'),

  /**
   * Specific fields being requested (empty means all)
   */
  requested_fields: z.array(z.string()).optional(),

  /**
   * Maximum number of records requested
   */
  record_limit: z.number().int().positive().optional(),

  /**
   * Request timestamp
   */
  timestamp: z.string().datetime().optional(),
});

/**
 * TypeScript type for DataAccessRequest
 */
export type DataAccessRequest = z.infer<typeof DataAccessRequestSchema>;

/**
 * Access constraint schema
 * @description Defines constraints that must be applied when access is granted
 */
export const AccessConstraintSchema = z.object({
  /**
   * Type of constraint
   */
  type: z.enum([
    'field_restriction',
    'row_filter',
    'rate_limit',
    'time_window',
    'anonymization_required',
    'audit_required',
    'encryption_required',
  ]),

  /**
   * Constraint-specific parameters
   */
  parameters: z.record(z.string(), z.unknown()),

  /**
   * Human-readable description
   */
  description: z.string().optional(),
});

/**
 * TypeScript type for AccessConstraint
 */
export type AccessConstraint = z.infer<typeof AccessConstraintSchema>;

/**
 * Data Access Response Schema
 * @description The response from evaluating a data access request
 *
 * @example
 * ```typescript
 * const response: DataAccessResponse = {
 *   allowed: true,
 *   reason: 'Access granted under GDPR legitimate interest',
 *   constraints: [
 *     {
 *       type: 'anonymization_required',
 *       parameters: { fields: ['email', 'phone'] },
 *       description: 'PII fields must be anonymized'
 *     }
 *   ],
 *   ttl: 3600,
 *   matched_rules: ['rule-1', 'rule-3'],
 *   decision_id: '550e8400-e29b-41d4-a716-446655440000'
 * };
 * ```
 */
export const DataAccessResponseSchema = z.object({
  /**
   * Whether access is allowed
   */
  allowed: z.boolean(),

  /**
   * Human-readable reason for the decision
   */
  reason: z.string().min(1, 'Reason is required'),

  /**
   * Constraints that must be applied if access is allowed
   */
  constraints: z.array(AccessConstraintSchema).default([]),

  /**
   * Time-to-live for the access grant in seconds
   * @description After this period, access must be re-evaluated
   */
  ttl: z.number().int().positive().optional(),

  /**
   * IDs of rules that matched during evaluation
   */
  matched_rules: z.array(z.string()).default([]),

  /**
   * Policies that were evaluated
   */
  evaluated_policies: z.array(z.string()).default([]),

  /**
   * Unique identifier for this decision (for audit trail)
   */
  decision_id: z.string().uuid().optional(),

  /**
   * Confidence score of the decision (0-1)
   */
  confidence: z.number().min(0).max(1).optional(),

  /**
   * Additional metadata about the decision
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * TypeScript type for DataAccessResponse
 */
export type DataAccessResponse = z.infer<typeof DataAccessResponseSchema>;

/**
 * Creates a validated DataAccessRequest
 * @param data - Raw request data
 * @returns Validated DataAccessRequest
 * @throws ZodError if validation fails
 */
export function createDataAccessRequest(data: unknown): DataAccessRequest {
  return DataAccessRequestSchema.parse(data);
}

/**
 * Creates a validated DataAccessResponse
 * @param data - Raw response data
 * @returns Validated DataAccessResponse
 * @throws ZodError if validation fails
 */
export function createDataAccessResponse(data: unknown): DataAccessResponse {
  return DataAccessResponseSchema.parse(data);
}

/**
 * Creates a validated AccessPolicy
 * @param data - Raw policy data
 * @returns Validated AccessPolicy
 * @throws ZodError if validation fails
 */
export function createAccessPolicy(data: unknown): AccessPolicy {
  return AccessPolicySchema.parse(data);
}

/**
 * Safely parses DataAccessRequest data without throwing
 * @param data - Raw request data
 * @returns SafeParseResult containing either the validated data or error details
 */
export function safeParseDataAccessRequest(data: unknown): z.SafeParseReturnType<unknown, DataAccessRequest> {
  return DataAccessRequestSchema.safeParse(data);
}

/**
 * Safely parses DataAccessResponse data without throwing
 * @param data - Raw response data
 * @returns SafeParseResult containing either the validated data or error details
 */
export function safeParseDataAccessResponse(data: unknown): z.SafeParseReturnType<unknown, DataAccessResponse> {
  return DataAccessResponseSchema.safeParse(data);
}

/**
 * Safely parses AccessPolicy data without throwing
 * @param data - Raw policy data
 * @returns SafeParseResult containing either the validated data or error details
 */
export function safeParseAccessPolicy(data: unknown): z.SafeParseReturnType<unknown, AccessPolicy> {
  return AccessPolicySchema.safeParse(data);
}
