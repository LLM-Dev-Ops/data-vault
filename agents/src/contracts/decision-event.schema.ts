/**
 * @fileoverview DecisionEvent Schema for LLM-Data-Vault Agents
 * @description Defines the schema for agent decision events, capturing
 * the complete audit trail of agent decisions including inputs, outputs,
 * and constraints applied during data access control and anonymization operations.
 * @module @llm-data-vault/agents/contracts/decision-event
 */

import { z } from 'zod';

/**
 * Supported decision types for LLM-Data-Vault agents
 */
export const DecisionTypeSchema = z.enum([
  'data_access_control',
  'dataset_anonymization',
]);

/**
 * Type alias for decision types
 */
export type DecisionType = z.infer<typeof DecisionTypeSchema>;

/**
 * SHA-256 hash pattern validation
 * @description Validates that a string is a valid 64-character hexadecimal SHA-256 hash
 */
const sha256HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, 'Must be a valid SHA-256 hash (64 hex characters)');

/**
 * UUID v4 pattern validation
 * @description Validates that a string is a valid UUID v4 format
 */
const uuidSchema = z
  .string()
  .uuid('Must be a valid UUID v4');

/**
 * Semantic version pattern validation
 * @description Validates semver format (e.g., "1.0.0", "2.1.0-alpha.1")
 */
const semverSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    'Must be a valid semantic version (e.g., "1.0.0")'
  );

/**
 * ISO 8601 UTC timestamp pattern validation
 * @description Validates ISO 8601 UTC timestamp format
 */
const iso8601UtcSchema = z
  .string()
  .datetime({ offset: true, message: 'Must be a valid ISO 8601 UTC timestamp' });

/**
 * Confidence score validation
 * @description Validates confidence scores between 0 and 1 inclusive
 */
const confidenceSchema = z
  .number()
  .min(0, 'Confidence must be at least 0')
  .max(1, 'Confidence must be at most 1');

/**
 * DecisionEvent Schema
 * @description Captures the complete audit trail of an agent decision event.
 * This schema is used for logging, compliance, and debugging purposes.
 *
 * @example
 * ```typescript
 * const event: DecisionEvent = {
 *   agent_id: 'data-access-controller-v1',
 *   agent_version: '1.2.3',
 *   decision_type: 'data_access_control',
 *   inputs_hash: 'a'.repeat(64),
 *   outputs: { allowed: true, reason: 'Policy permits access' },
 *   confidence: 0.95,
 *   constraints_applied: ['gdpr-consent', 'data-minimization'],
 *   execution_ref: '550e8400-e29b-41d4-a716-446655440000',
 *   timestamp: '2024-01-15T10:30:00.000Z'
 * };
 * ```
 */
export const DecisionEventSchema = z.object({
  /**
   * Unique identifier for the agent that made the decision
   * @example "data-access-controller-v1"
   */
  agent_id: z.string().min(1, 'Agent ID is required'),

  /**
   * Semantic version of the agent
   * @example "1.2.3"
   */
  agent_version: semverSchema,

  /**
   * Type of decision being made
   */
  decision_type: DecisionTypeSchema,

  /**
   * SHA-256 hash of the decision inputs for integrity verification
   * @description Used to verify that inputs have not been tampered with
   */
  inputs_hash: sha256HashSchema,

  /**
   * Structured output of the decision
   * @description Contains the decision result and any relevant metadata
   */
  outputs: z.record(z.string(), z.unknown()),

  /**
   * Confidence level of the decision (0-1)
   * @description Higher values indicate greater certainty in the decision
   */
  confidence: confidenceSchema,

  /**
   * List of constraints/policies that were applied during decision-making
   * @example ["gdpr-consent", "data-minimization", "purpose-limitation"]
   */
  constraints_applied: z.array(z.string()),

  /**
   * UUID reference to the execution context
   * @description Links to the broader execution trace for correlation
   */
  execution_ref: uuidSchema,

  /**
   * ISO 8601 UTC timestamp of when the decision was made
   */
  timestamp: iso8601UtcSchema,
});

/**
 * TypeScript type for DecisionEvent
 */
export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

/**
 * Creates a new DecisionEvent with validation
 * @param data - Raw decision event data
 * @returns Validated DecisionEvent
 * @throws ZodError if validation fails
 */
export function createDecisionEvent(data: unknown): DecisionEvent {
  return DecisionEventSchema.parse(data);
}

/**
 * Safely parses DecisionEvent data without throwing
 * @param data - Raw decision event data
 * @returns SafeParseResult containing either the validated data or error details
 */
export function safeParseDecisionEvent(data: unknown): z.SafeParseReturnType<unknown, DecisionEvent> {
  return DecisionEventSchema.safeParse(data);
}

/**
 * Validates that a decision event is properly structured
 * @param data - Data to validate
 * @returns True if valid, false otherwise
 */
export function isValidDecisionEvent(data: unknown): data is DecisionEvent {
  return DecisionEventSchema.safeParse(data).success;
}
