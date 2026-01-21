/**
 * LLM-Data-Vault: Anonymization Contracts
 *
 * Schemas for dataset anonymization operations.
 * Imported from agentics-contracts specification.
 *
 * @module agentics-contracts/anonymization
 */

import { z } from 'zod';

/**
 * PII (Personally Identifiable Information) types
 */
export const PIITypeSchema = z.enum([
  // Identity
  'email',
  'phone_number',
  'ssn',
  'national_id',
  'passport_number',
  'drivers_license',

  // Financial
  'credit_card',
  'bank_account',
  'iban',
  'swift_code',
  'cryptocurrency_address',

  // Network
  'ip_address',
  'ipv6_address',
  'mac_address',
  'url',

  // Personal
  'person_name',
  'full_address',
  'street_address',
  'city',
  'state',
  'zip_code',
  'country',
  'date_of_birth',
  'age',

  // Credentials
  'api_key',
  'password',
  'auth_token',
  'private_key',
  'secret_key',

  // Medical (HIPAA)
  'medical_record_number',
  'health_insurance_number',
  'prescription_number',
  'biometric_data',

  // Custom
  'custom',
]);

export type PIIType = z.infer<typeof PIITypeSchema>;

/**
 * Anonymization strategies
 */
export const AnonymizationStrategySchema = z.enum([
  'redact',           // Replace with [REDACTED]
  'mask',             // Replace with ***
  'hash',             // SHA-256 hash
  'tokenize',         // Replace with reversible token
  'generalize',       // Generalize to broader category
  'suppress',         // Remove entirely
  'noise',            // Add statistical noise
  'k_anonymity',      // K-anonymity grouping
  'l_diversity',      // L-diversity enforcement
  't_closeness',      // T-closeness enforcement
  'differential_privacy', // Differential privacy mechanism
  'pseudonymize',     // Replace with consistent pseudonym
  'encrypt',          // Encrypt with tenant key
]);

export type AnonymizationStrategy = z.infer<typeof AnonymizationStrategySchema>;

/**
 * PII detection match
 */
export const PIIMatchSchema = z.object({
  pii_type: PIITypeSchema,
  start_offset: z.number().int().min(0),
  end_offset: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  original_text: z.string().optional(), // Only in non-production
  context_hint: z.string().optional(),
});

export type PIIMatch = z.infer<typeof PIIMatchSchema>;

/**
 * Field-level anonymization rule
 */
export const FieldAnonymizationRuleSchema = z.object({
  field_path: z.string(), // JSONPath or dot notation
  pii_types: z.array(PIITypeSchema),
  strategy: AnonymizationStrategySchema,
  preserve_format: z.boolean().default(false),
  min_confidence: z.number().min(0).max(1).default(0.85),
});

export type FieldAnonymizationRule = z.infer<typeof FieldAnonymizationRuleSchema>;

/**
 * Anonymization policy configuration
 */
export const AnonymizationPolicySchema = z.object({
  policy_id: z.string().uuid(),
  policy_version: z.string(),
  name: z.string(),
  description: z.string().optional(),

  // Default strategy for unspecified fields
  default_strategy: AnonymizationStrategySchema.default('redact'),

  // Field-specific rules
  field_rules: z.array(FieldAnonymizationRuleSchema).default([]),

  // Global PII detection settings
  detect_pii_types: z.array(PIITypeSchema).default([]),
  min_detection_confidence: z.number().min(0).max(1).default(0.85),

  // Compliance requirements
  compliance_frameworks: z.array(z.enum([
    'gdpr',
    'hipaa',
    'ccpa',
    'soc2',
    'pci_dss',
  ])).default([]),

  // Audit settings
  emit_audit_events: z.boolean().default(true),
  retain_original_hash: z.boolean().default(true),
});

export type AnonymizationPolicy = z.infer<typeof AnonymizationPolicySchema>;

/**
 * Input schema for anonymization agent
 */
export const AnonymizationRequestSchema = z.object({
  // Request identification
  request_id: z.string().uuid(),
  correlation_id: z.string().uuid().optional(),

  // Dataset reference (NOT the actual data - we don't store data)
  dataset_id: z.string(),
  dataset_version: z.string().optional(),

  // Content to anonymize (ephemeral, not persisted)
  content: z.union([
    z.string(),
    z.record(z.string(), z.unknown()),
    z.array(z.record(z.string(), z.unknown())),
  ]),

  // Content format
  content_format: z.enum(['text', 'json', 'csv', 'jsonl']).default('json'),

  // Policy to apply
  policy_id: z.string().uuid().optional(),
  policy: AnonymizationPolicySchema.optional(),

  // Override settings
  strategies: z.record(PIITypeSchema, AnonymizationStrategySchema).optional(),

  // Processing options
  options: z.object({
    preserve_structure: z.boolean().default(true),
    emit_metrics: z.boolean().default(true),
    dry_run: z.boolean().default(false),
    include_detection_details: z.boolean().default(false),
  }).default({}),

  // Tenant context
  tenant_id: z.string(),

  // Requester identification
  requester: z.object({
    service: z.string(),
    user_id: z.string().optional(),
    roles: z.array(z.string()).default([]),
  }),
});

export type AnonymizationRequest = z.infer<typeof AnonymizationRequestSchema>;

/**
 * Field anonymization result
 */
export const FieldAnonymizationResultSchema = z.object({
  field_path: z.string(),
  pii_type: PIITypeSchema,
  strategy_applied: AnonymizationStrategySchema,
  confidence: z.number().min(0).max(1),
  original_hash: z.string().optional(), // For audit trail
});

export type FieldAnonymizationResult = z.infer<typeof FieldAnonymizationResultSchema>;

/**
 * Output schema for anonymization agent
 */
export const AnonymizationResponseSchema = z.object({
  // Request reference
  request_id: z.string().uuid(),

  // Anonymized content (ephemeral)
  anonymized_content: z.union([
    z.string(),
    z.record(z.string(), z.unknown()),
    z.array(z.record(z.string(), z.unknown())),
  ]),

  // Processing results
  results: z.object({
    total_fields_processed: z.number().int().min(0),
    fields_anonymized: z.number().int().min(0),
    pii_detections: z.number().int().min(0),
    detection_breakdown: z.record(PIITypeSchema, z.number().int()).optional(),
  }),

  // Field-level details (if requested)
  field_results: z.array(FieldAnonymizationResultSchema).optional(),

  // Compliance attestation
  compliance: z.object({
    frameworks_satisfied: z.array(z.string()),
    attestation_hash: z.string(),
    timestamp: z.string().datetime(),
  }),

  // Warnings
  warnings: z.array(z.object({
    code: z.string(),
    message: z.string(),
    field_path: z.string().optional(),
  })).default([]),
});

export type AnonymizationResponse = z.infer<typeof AnonymizationResponseSchema>;

/**
 * Validate anonymization request
 */
export function validateAnonymizationRequest(request: unknown): AnonymizationRequest {
  return AnonymizationRequestSchema.parse(request);
}

/**
 * Validate anonymization response
 */
export function validateAnonymizationResponse(response: unknown): AnonymizationResponse {
  return AnonymizationResponseSchema.parse(response);
}
