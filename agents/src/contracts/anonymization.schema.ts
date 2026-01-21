/**
 * @fileoverview Anonymization Schemas for LLM-Data-Vault Agents
 * @description Defines schemas for data anonymization requests, responses,
 * and strategies. These schemas are used by the anonymization agent to
 * detect and protect personally identifiable information (PII).
 * @module @llm-data-vault/agents/contracts/anonymization
 */

import { z } from 'zod';

/**
 * Supported anonymization strategies
 * @description Different techniques for anonymizing sensitive data
 */
export const AnonymizationStrategySchema = z.enum([
  /** Replace with asterisks or other characters (e.g., "john@email.com" -> "j***@e****.com") */
  'mask',
  /** Completely remove the sensitive data (e.g., "john@email.com" -> "[REDACTED]") */
  'redact',
  /** Replace with cryptographic hash (e.g., "john@email.com" -> "a1b2c3d4...") */
  'hash',
  /** Replace with less specific value (e.g., "25 years old" -> "20-30 years old") */
  'generalize',
  /** Replace with synthetic but realistic data (e.g., "john@email.com" -> "user123@example.com") */
  'synthesize',
  /** Encrypt the data with reversible encryption */
  'encrypt',
  /** Tokenize with reversible mapping stored securely */
  'tokenize',
  /** Apply k-anonymity to ensure data blends with k-1 others */
  'k_anonymize',
  /** Apply differential privacy noise */
  'differential_privacy',
]);

/**
 * Type alias for anonymization strategies
 */
export type AnonymizationStrategy = z.infer<typeof AnonymizationStrategySchema>;

/**
 * Supported PII types that can be detected and anonymized
 */
export const PIITypeSchema = z.enum([
  /** Email addresses */
  'email',
  /** Phone numbers in various formats */
  'phone',
  /** Social Security Numbers (SSN) */
  'ssn',
  /** Credit card numbers */
  'credit_card',
  /** IP addresses (v4 and v6) */
  'ip_address',
  /** Physical/mailing addresses */
  'address',
  /** Person names */
  'name',
  /** Date of birth */
  'date_of_birth',
  /** Passport numbers */
  'passport',
  /** Driver's license numbers */
  'drivers_license',
  /** Bank account numbers */
  'bank_account',
  /** Medical record numbers */
  'medical_record',
  /** National ID numbers (non-US) */
  'national_id',
  /** Biometric data identifiers */
  'biometric',
  /** Vehicle identification numbers */
  'vin',
  /** Geographic coordinates */
  'coordinates',
  /** Custom/organization-specific PII */
  'custom',
]);

/**
 * Type alias for PII types
 */
export type PIIType = z.infer<typeof PIITypeSchema>;

/**
 * Compliance frameworks that may govern anonymization requirements
 */
export const ComplianceFrameworkSchema = z.enum([
  /** EU General Data Protection Regulation */
  'gdpr',
  /** California Consumer Privacy Act */
  'ccpa',
  /** Health Insurance Portability and Accountability Act */
  'hipaa',
  /** Payment Card Industry Data Security Standard */
  'pci_dss',
  /** System and Organization Controls 2 */
  'soc2',
  /** ISO 27001 Information Security */
  'iso27001',
  /** Federal Risk and Authorization Management Program */
  'fedramp',
  /** Personal Information Protection and Electronic Documents Act (Canada) */
  'pipeda',
  /** Lei Geral de Protecao de Dados (Brazil) */
  'lgpd',
]);

/**
 * Type alias for compliance frameworks
 */
export type ComplianceFramework = z.infer<typeof ComplianceFrameworkSchema>;

/**
 * Strategy-specific options schema
 */
export const StrategyOptionsSchema = z.object({
  /** For mask strategy: character to use for masking */
  mask_char: z.string().length(1).optional(),
  /** For mask strategy: number of characters to preserve at start */
  preserve_start: z.number().int().min(0).optional(),
  /** For mask strategy: number of characters to preserve at end */
  preserve_end: z.number().int().min(0).optional(),
  /** For hash strategy: hash algorithm to use */
  hash_algorithm: z.enum(['sha256', 'sha512', 'blake2b', 'argon2']).optional(),
  /** For hash strategy: salt for the hash (or generate random) */
  hash_salt: z.string().optional(),
  /** For generalize strategy: level of generalization (1-5) */
  generalization_level: z.number().int().min(1).max(5).optional(),
  /** For synthesize strategy: seed for reproducibility */
  synthesis_seed: z.number().int().optional(),
  /** For synthesize strategy: locale for synthetic data */
  synthesis_locale: z.string().optional(),
  /** For encrypt strategy: encryption algorithm */
  encryption_algorithm: z.enum(['aes-256-gcm', 'chacha20-poly1305']).optional(),
  /** For k_anonymize strategy: k value */
  k_value: z.number().int().min(2).optional(),
  /** For differential_privacy strategy: epsilon value */
  dp_epsilon: z.number().positive().optional(),
  /** For differential_privacy strategy: delta value */
  dp_delta: z.number().positive().optional(),
});

/**
 * TypeScript type for StrategyOptions
 */
export type StrategyOptions = z.infer<typeof StrategyOptionsSchema>;

/**
 * Anonymization rule schema
 * @description Defines how a specific PII type should be anonymized
 */
export const AnonymizationRuleSchema = z.object({
  /**
   * The PII type this rule applies to
   */
  pii_type: PIITypeSchema,

  /**
   * The strategy to use for anonymization
   */
  strategy: AnonymizationStrategySchema,

  /**
   * Strategy-specific options
   */
  options: StrategyOptionsSchema.optional(),

  /**
   * Priority for rule ordering (higher = applied first)
   */
  priority: z.number().int().min(0).default(0),

  /**
   * Whether this rule is enabled
   */
  enabled: z.boolean().default(true),
});

/**
 * TypeScript type for AnonymizationRule
 */
export type AnonymizationRule = z.infer<typeof AnonymizationRuleSchema>;

/**
 * Anonymization Request Schema
 * @description Represents a request to anonymize data
 *
 * @example
 * ```typescript
 * const request: AnonymizationRequest = {
 *   dataset_id: 'dataset-123',
 *   data: {
 *     user_email: 'john.doe@example.com',
 *     user_phone: '+1-555-123-4567',
 *     user_name: 'John Doe',
 *     notes: 'Contact John at john.doe@example.com'
 *   },
 *   pii_types: ['email', 'phone', 'name'],
 *   strategy: 'mask',
 *   compliance_frameworks: ['gdpr', 'ccpa']
 * };
 * ```
 */
export const AnonymizationRequestSchema = z.object({
  /**
   * Unique identifier of the dataset being anonymized
   */
  dataset_id: z.string().min(1, 'Dataset ID is required'),

  /**
   * The data to be anonymized
   * @description Can be a flat object, nested object, or array of objects
   */
  data: z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.record(z.string(), z.unknown())),
  ]),

  /**
   * Specific PII types to detect and anonymize
   * @description If empty, all known PII types will be checked
   */
  pii_types: z.array(PIITypeSchema).default([]),

  /**
   * Default anonymization strategy to use
   */
  strategy: AnonymizationStrategySchema,

  /**
   * Strategy-specific options
   */
  strategy_options: StrategyOptionsSchema.optional(),

  /**
   * Override rules for specific PII types
   */
  rules: z.array(AnonymizationRuleSchema).optional(),

  /**
   * Compliance frameworks to consider
   */
  compliance_frameworks: z.array(ComplianceFrameworkSchema).default([]),

  /**
   * Specific fields to anonymize (if empty, scan all fields)
   */
  target_fields: z.array(z.string()).optional(),

  /**
   * Fields to exclude from anonymization
   */
  exclude_fields: z.array(z.string()).optional(),

  /**
   * Whether to recursively scan nested objects
   */
  recursive: z.boolean().default(true),

  /**
   * Whether to also scan string values for embedded PII
   */
  scan_strings: z.boolean().default(true),

  /**
   * Minimum confidence threshold for PII detection (0-1)
   */
  detection_threshold: z.number().min(0).max(1).default(0.8),

  /**
   * Request correlation ID for tracing
   */
  correlation_id: z.string().uuid().optional(),
});

/**
 * TypeScript type for AnonymizationRequest
 */
export type AnonymizationRequest = z.infer<typeof AnonymizationRequestSchema>;

/**
 * PII Detection result schema
 * @description Represents a single detected PII instance
 */
export const PIIDetectionSchema = z.object({
  /**
   * Type of PII detected
   */
  pii_type: PIITypeSchema,

  /**
   * Path to the field containing the PII (dot notation for nested)
   */
  field_path: z.string(),

  /**
   * The original value (for audit purposes - handle securely)
   */
  original_value: z.string().optional(),

  /**
   * The anonymized value
   */
  anonymized_value: z.string(),

  /**
   * Confidence score of the detection (0-1)
   */
  confidence: z.number().min(0).max(1),

  /**
   * Strategy that was applied
   */
  strategy_applied: AnonymizationStrategySchema,

  /**
   * Character positions in the original string (for embedded PII)
   */
  position: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }).optional(),

  /**
   * Rule ID that was applied (if custom rule)
   */
  rule_id: z.string().optional(),
});

/**
 * TypeScript type for PIIDetection
 */
export type PIIDetection = z.infer<typeof PIIDetectionSchema>;

/**
 * Anonymization Response Schema
 * @description The result of an anonymization operation
 *
 * @example
 * ```typescript
 * const response: AnonymizationResponse = {
 *   anonymized_data: {
 *     user_email: 'j***@e******.com',
 *     user_phone: '+1-***-***-4567',
 *     user_name: '[REDACTED]',
 *     notes: 'Contact [REDACTED] at j***@e******.com'
 *   },
 *   detections: [
 *     {
 *       pii_type: 'email',
 *       field_path: 'user_email',
 *       anonymized_value: 'j***@e******.com',
 *       confidence: 0.99,
 *       strategy_applied: 'mask'
 *     }
 *   ],
 *   applied_rules: ['default-email-mask', 'gdpr-name-redact'],
 *   compliance_status: { gdpr: true, ccpa: true }
 * };
 * ```
 */
export const AnonymizationResponseSchema = z.object({
  /**
   * The anonymized data with PII replaced
   */
  anonymized_data: z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.record(z.string(), z.unknown())),
  ]),

  /**
   * Details of all PII detections and anonymizations
   */
  detections: z.array(PIIDetectionSchema),

  /**
   * IDs/names of rules that were applied
   */
  applied_rules: z.array(z.string()),

  /**
   * Compliance status for each requested framework
   */
  compliance_status: z.record(z.string(), z.boolean()).optional(),

  /**
   * Total number of PII instances detected
   */
  total_detections: z.number().int().min(0),

  /**
   * Number of fields processed
   */
  fields_processed: z.number().int().min(0),

  /**
   * Processing time in milliseconds
   */
  processing_time_ms: z.number().min(0).optional(),

  /**
   * Any warnings or issues encountered
   */
  warnings: z.array(z.string()).default([]),

  /**
   * Unique ID for this anonymization operation (for audit trail)
   */
  operation_id: z.string().uuid().optional(),

  /**
   * Metadata for tracking and auditing
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * TypeScript type for AnonymizationResponse
 */
export type AnonymizationResponse = z.infer<typeof AnonymizationResponseSchema>;

/**
 * Anonymization Configuration Schema
 * @description Global configuration for the anonymization agent
 */
export const AnonymizationConfigSchema = z.object({
  /**
   * Default anonymization strategy
   */
  default_strategy: AnonymizationStrategySchema.default('mask'),

  /**
   * Default PII types to detect
   */
  default_pii_types: z.array(PIITypeSchema).default([
    'email',
    'phone',
    'ssn',
    'credit_card',
    'name',
  ]),

  /**
   * Global rules applied to all requests
   */
  global_rules: z.array(AnonymizationRuleSchema).default([]),

  /**
   * Default compliance frameworks to consider
   */
  default_compliance_frameworks: z.array(ComplianceFrameworkSchema).default([]),

  /**
   * Default detection confidence threshold
   */
  default_detection_threshold: z.number().min(0).max(1).default(0.8),

  /**
   * Whether to log original values (security risk - use carefully)
   */
  log_original_values: z.boolean().default(false),

  /**
   * Whether to include detection details in responses
   */
  include_detection_details: z.boolean().default(true),

  /**
   * Maximum data size to process in bytes
   */
  max_data_size_bytes: z.number().int().positive().default(10 * 1024 * 1024), // 10MB

  /**
   * Request timeout in milliseconds
   */
  timeout_ms: z.number().int().positive().default(30000), // 30 seconds
});

/**
 * TypeScript type for AnonymizationConfig
 */
export type AnonymizationConfig = z.infer<typeof AnonymizationConfigSchema>;

/**
 * Creates a validated AnonymizationRequest
 * @param data - Raw request data
 * @returns Validated AnonymizationRequest
 * @throws ZodError if validation fails
 */
export function createAnonymizationRequest(data: unknown): AnonymizationRequest {
  return AnonymizationRequestSchema.parse(data);
}

/**
 * Creates a validated AnonymizationResponse
 * @param data - Raw response data
 * @returns Validated AnonymizationResponse
 * @throws ZodError if validation fails
 */
export function createAnonymizationResponse(data: unknown): AnonymizationResponse {
  return AnonymizationResponseSchema.parse(data);
}

/**
 * Creates a validated AnonymizationConfig
 * @param data - Raw config data
 * @returns Validated AnonymizationConfig
 * @throws ZodError if validation fails
 */
export function createAnonymizationConfig(data: unknown): AnonymizationConfig {
  return AnonymizationConfigSchema.parse(data);
}

/**
 * Safely parses AnonymizationRequest data without throwing
 * @param data - Raw request data
 * @returns SafeParseResult containing either the validated data or error details
 */
export function safeParseAnonymizationRequest(data: unknown): z.SafeParseReturnType<unknown, AnonymizationRequest> {
  return AnonymizationRequestSchema.safeParse(data);
}

/**
 * Safely parses AnonymizationResponse data without throwing
 * @param data - Raw response data
 * @returns SafeParseResult containing either the validated data or error details
 */
export function safeParseAnonymizationResponse(data: unknown): z.SafeParseReturnType<unknown, AnonymizationResponse> {
  return AnonymizationResponseSchema.safeParse(data);
}

/**
 * Validates if a strategy is compatible with a PII type
 * @param piiType - The PII type to check
 * @param strategy - The strategy to validate
 * @returns True if the strategy is recommended for the PII type
 */
export function isStrategyCompatible(piiType: PIIType, strategy: AnonymizationStrategy): boolean {
  const compatibilityMap: Record<PIIType, AnonymizationStrategy[]> = {
    email: ['mask', 'redact', 'hash', 'synthesize', 'tokenize'],
    phone: ['mask', 'redact', 'hash', 'synthesize', 'tokenize'],
    ssn: ['mask', 'redact', 'hash', 'tokenize'],
    credit_card: ['mask', 'redact', 'hash', 'tokenize'],
    ip_address: ['mask', 'redact', 'hash', 'generalize'],
    address: ['redact', 'generalize', 'synthesize'],
    name: ['redact', 'hash', 'synthesize', 'tokenize'],
    date_of_birth: ['redact', 'generalize', 'hash'],
    passport: ['mask', 'redact', 'hash', 'tokenize'],
    drivers_license: ['mask', 'redact', 'hash', 'tokenize'],
    bank_account: ['mask', 'redact', 'hash', 'tokenize'],
    medical_record: ['mask', 'redact', 'hash', 'tokenize'],
    national_id: ['mask', 'redact', 'hash', 'tokenize'],
    biometric: ['redact', 'hash'],
    vin: ['mask', 'redact', 'hash'],
    coordinates: ['redact', 'generalize', 'differential_privacy'],
    custom: ['mask', 'redact', 'hash', 'synthesize', 'tokenize', 'encrypt', 'generalize', 'k_anonymize', 'differential_privacy'],
  };

  return compatibilityMap[piiType]?.includes(strategy) ?? false;
}
