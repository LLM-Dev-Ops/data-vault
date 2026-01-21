/**
 * LLM-Data-Vault: DecisionEvent Schema
 *
 * Core schema for all agent decision events persisted to ruvector-service.
 * This is the authoritative contract for Data-Vault agent outputs.
 *
 * @module agentics-contracts/decision-event
 */

import { z } from 'zod';

/**
 * Decision types emitted by Data-Vault agents
 */
export const DecisionTypeSchema = z.enum([
  'dataset_access_granted',
  'dataset_access_denied',
  'dataset_anonymization',
  'dataset_redaction',
  'dataset_inspection',
  'policy_violation',
  'privacy_transform_applied',
]);

export type DecisionType = z.infer<typeof DecisionTypeSchema>;

/**
 * Constraint types that can be applied
 */
export const ConstraintTypeSchema = z.enum([
  // Access constraints
  'role_required',
  'permission_denied',
  'tenant_mismatch',
  'resource_not_found',
  'rate_limit_exceeded',

  // Privacy constraints
  'pii_detected',
  'pii_redacted',
  'pii_masked',
  'pii_tokenized',
  'differential_privacy_applied',
  'k_anonymity_applied',

  // Regulatory constraints
  'gdpr_compliance',
  'hipaa_compliance',
  'ccpa_compliance',
  'soc2_compliance',
  'data_residency',
  'retention_policy',
]);

export type ConstraintType = z.infer<typeof ConstraintTypeSchema>;

/**
 * Applied constraint with details
 */
export const AppliedConstraintSchema = z.object({
  type: ConstraintTypeSchema,
  description: z.string(),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AppliedConstraint = z.infer<typeof AppliedConstraintSchema>;

/**
 * Confidence breakdown for decision transparency
 */
export const ConfidenceBreakdownSchema = z.object({
  policy_match: z.number().min(0).max(1),
  anonymization_certainty: z.number().min(0).max(1).optional(),
  detection_confidence: z.number().min(0).max(1).optional(),
  model_confidence: z.number().min(0).max(1).optional(),
});

export type ConfidenceBreakdown = z.infer<typeof ConfidenceBreakdownSchema>;

/**
 * Core DecisionEvent schema - REQUIRED for all agent emissions
 */
export const DecisionEventSchema = z.object({
  // Agent identification
  agent_id: z.string().min(1),
  agent_version: z.string().regex(/^\d+\.\d+\.\d+$/),

  // Decision details
  decision_type: DecisionTypeSchema,

  // Input fingerprint (hash of inputs for auditability)
  inputs_hash: z.string().min(64).max(128), // SHA-256 or SHA-512

  // Outputs (deterministic, machine-readable)
  outputs: z.record(z.string(), z.unknown()),

  // Confidence metrics
  confidence: ConfidenceBreakdownSchema,

  // Constraints that were evaluated/applied
  constraints_applied: z.array(AppliedConstraintSchema),

  // Execution reference for tracing
  execution_ref: z.string().uuid(),

  // ISO 8601 UTC timestamp
  timestamp: z.string().datetime(),

  // Optional correlation IDs for distributed tracing
  correlation_id: z.string().uuid().optional(),
  parent_execution_ref: z.string().uuid().optional(),

  // Tenant context
  tenant_id: z.string().optional(),

  // Request source identification
  request_source: z.enum([
    'orchestrator',
    'inference_gateway',
    'policy_engine',
    'governance',
    'cli',
    'api',
  ]).optional(),
});

export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

/**
 * Validate a DecisionEvent
 */
export function validateDecisionEvent(event: unknown): DecisionEvent {
  return DecisionEventSchema.parse(event);
}

/**
 * Create a new DecisionEvent with defaults
 */
export function createDecisionEvent(
  partial: Omit<DecisionEvent, 'timestamp' | 'execution_ref'> & {
    execution_ref?: string;
    timestamp?: string;
  }
): DecisionEvent {
  return {
    ...partial,
    execution_ref: partial.execution_ref ?? crypto.randomUUID(),
    timestamp: partial.timestamp ?? new Date().toISOString(),
  };
}
