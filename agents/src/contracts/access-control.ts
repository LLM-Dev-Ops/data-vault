/**
 * LLM-Data-Vault: Access Control Contracts
 *
 * Schemas for dataset access control operations.
 * Imported from agentics-contracts specification.
 *
 * @module agentics-contracts/access-control
 */

import { z } from 'zod';

/**
 * Access decision types
 */
export const AccessDecisionSchema = z.enum([
  'allow',
  'deny',
  'conditional', // Allow with conditions
]);

export type AccessDecision = z.infer<typeof AccessDecisionSchema>;

/**
 * Access permission types
 */
export const PermissionTypeSchema = z.enum([
  'read',
  'write',
  'delete',
  'admin',
  'export',
  'anonymize',
  'share',
]);

export type PermissionType = z.infer<typeof PermissionTypeSchema>;

/**
 * Resource types that can be accessed
 */
export const ResourceTypeSchema = z.enum([
  'dataset',
  'record',
  'field',
  'schema',
  'policy',
  'tenant',
]);

export type ResourceType = z.infer<typeof ResourceTypeSchema>;

/**
 * Subject (who is requesting access)
 */
export const SubjectSchema = z.object({
  subject_id: z.string(),
  subject_type: z.enum(['user', 'service', 'agent', 'system']),
  roles: z.array(z.string()).default([]),
  groups: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
  tenant_id: z.string(),
});

export type Subject = z.infer<typeof SubjectSchema>;

/**
 * Resource (what is being accessed)
 */
export const ResourceSchema = z.object({
  resource_id: z.string(),
  resource_type: ResourceTypeSchema,
  tenant_id: z.string(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  classification: z.enum(['public', 'internal', 'confidential', 'restricted']).optional(),
  data_residency: z.string().optional(), // e.g., 'us-east', 'eu-west'
});

export type Resource = z.infer<typeof ResourceSchema>;

/**
 * Access context (environmental conditions)
 */
export const AccessContextSchema = z.object({
  timestamp: z.string().datetime(),
  source_ip: z.string().optional(),
  user_agent: z.string().optional(),
  request_id: z.string().uuid(),
  environment: z.enum(['production', 'staging', 'development']).default('production'),
  geo_location: z.string().optional(),
  mfa_verified: z.boolean().default(false),
  session_id: z.string().optional(),
});

export type AccessContext = z.infer<typeof AccessContextSchema>;

/**
 * Policy rule condition
 */
export const PolicyConditionSchema = z.object({
  field: z.string(),
  operator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'regex',
    'in',
    'not_in',
    'greater_than',
    'less_than',
    'between',
  ]),
  value: z.unknown(),
});

export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;

/**
 * Access policy rule
 */
export const AccessPolicyRuleSchema = z.object({
  rule_id: z.string(),
  description: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  priority: z.number().int().default(0),

  // Subject conditions
  subjects: z.object({
    roles: z.array(z.string()).optional(),
    groups: z.array(z.string()).optional(),
    conditions: z.array(PolicyConditionSchema).optional(),
  }).optional(),

  // Resource conditions
  resources: z.object({
    types: z.array(ResourceTypeSchema).optional(),
    ids: z.array(z.string()).optional(),
    conditions: z.array(PolicyConditionSchema).optional(),
  }).optional(),

  // Permission scope
  permissions: z.array(PermissionTypeSchema),

  // Context conditions
  context_conditions: z.array(PolicyConditionSchema).optional(),
});

export type AccessPolicyRule = z.infer<typeof AccessPolicyRuleSchema>;

/**
 * Access policy
 */
export const AccessPolicySchema = z.object({
  policy_id: z.string().uuid(),
  policy_version: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tenant_id: z.string(),

  // Rules (evaluated in priority order)
  rules: z.array(AccessPolicyRuleSchema),

  // Default effect if no rules match
  default_effect: z.enum(['allow', 'deny']).default('deny'),

  // Policy metadata
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  created_by: z.string(),

  // Policy status
  active: z.boolean().default(true),
});

export type AccessPolicy = z.infer<typeof AccessPolicySchema>;

/**
 * Access authorization request
 */
export const AccessAuthorizationRequestSchema = z.object({
  // Request identification
  request_id: z.string().uuid(),
  correlation_id: z.string().uuid().optional(),

  // Subject (who)
  subject: SubjectSchema,

  // Resource (what)
  resource: ResourceSchema,

  // Permission (how)
  permission: PermissionTypeSchema,

  // Context (when/where)
  context: AccessContextSchema,

  // Optional: explicit policy to evaluate
  policy_id: z.string().uuid().optional(),
});

export type AccessAuthorizationRequest = z.infer<typeof AccessAuthorizationRequestSchema>;

/**
 * Policy evaluation result
 */
export const PolicyEvaluationResultSchema = z.object({
  policy_id: z.string().uuid(),
  policy_version: z.string(),
  rule_id: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  reason: z.string(),
});

export type PolicyEvaluationResult = z.infer<typeof PolicyEvaluationResultSchema>;

/**
 * Access authorization response
 */
export const AccessAuthorizationResponseSchema = z.object({
  // Request reference
  request_id: z.string().uuid(),

  // Decision
  decision: AccessDecisionSchema,

  // Effective permissions granted
  granted_permissions: z.array(PermissionTypeSchema),

  // Policy evaluations that led to this decision
  policy_evaluations: z.array(PolicyEvaluationResultSchema),

  // Conditions that must be met (for conditional decisions)
  conditions: z.array(z.object({
    type: z.string(),
    requirement: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).default([]),

  // Denial reasons (if denied)
  denial_reasons: z.array(z.object({
    code: z.string(),
    message: z.string(),
    policy_id: z.string().uuid().optional(),
    rule_id: z.string().optional(),
  })).default([]),

  // Cache hint
  cache_ttl_seconds: z.number().int().min(0).optional(),
});

export type AccessAuthorizationResponse = z.infer<typeof AccessAuthorizationResponseSchema>;

/**
 * Validate access authorization request
 */
export function validateAccessAuthorizationRequest(request: unknown): AccessAuthorizationRequest {
  return AccessAuthorizationRequestSchema.parse(request);
}

/**
 * Validate access authorization response
 */
export function validateAccessAuthorizationResponse(response: unknown): AccessAuthorizationResponse {
  return AccessAuthorizationResponseSchema.parse(response);
}
