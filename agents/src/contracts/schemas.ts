/**
 * LLM-Data-Vault: Schema Registry
 *
 * Centralized schema registry for validation and introspection.
 *
 * @module agentics-contracts/schemas
 */

import { z } from 'zod';

import {
  DecisionEventSchema,
  DecisionTypeSchema,
  ConstraintTypeSchema,
} from './decision-event.js';

import {
  AnonymizationRequestSchema,
  AnonymizationResponseSchema,
  AnonymizationPolicySchema,
  PIITypeSchema,
  AnonymizationStrategySchema,
} from './anonymization.js';

import {
  AccessAuthorizationRequestSchema,
  AccessAuthorizationResponseSchema,
  AccessPolicySchema,
  PermissionTypeSchema,
  ResourceTypeSchema,
} from './access-control.js';

// V2 Extended Schemas (agentics-contracts compliant)
import {
  DecisionEventSchema as DecisionEventSchemaV2,
  DecisionTypeSchema as DecisionTypeSchemaV2,
} from './decision-event.schema.js';

import {
  DataAccessRequestSchema,
  DataAccessResponseSchema,
  AccessPolicySchema as AccessPolicySchemaV2,
  PolicyRuleSchema,
  DataAccessActionSchema,
  AccessConstraintSchema,
} from './data-access.schema.js';

import {
  AnonymizationRequestSchema as AnonymizationRequestSchemaV2,
  AnonymizationResponseSchema as AnonymizationResponseSchemaV2,
  AnonymizationConfigSchema,
  PIITypeSchema as PIITypeSchemaV2,
  PIIDetectionSchema,
  ComplianceFrameworkSchema,
} from './anonymization.schema.js';

import {
  AgentConfigSchema,
  TelemetryConfigSchema,
  AgentCapabilitySchema,
  AgentCapabilityTypeSchema,
  AgentStatusSchema,
  AgentRegistrationSchema,
} from './agent-config.schema.js';

/**
 * Schema registry for all contracts
 */
export const SchemaRegistry = {
  // Decision Events (V1)
  DecisionEvent: DecisionEventSchema,
  DecisionType: DecisionTypeSchema,
  ConstraintType: ConstraintTypeSchema,

  // Anonymization (V1)
  AnonymizationRequest: AnonymizationRequestSchema,
  AnonymizationResponse: AnonymizationResponseSchema,
  AnonymizationPolicy: AnonymizationPolicySchema,
  PIIType: PIITypeSchema,
  AnonymizationStrategy: AnonymizationStrategySchema,

  // Access Control (V1)
  AccessAuthorizationRequest: AccessAuthorizationRequestSchema,
  AccessAuthorizationResponse: AccessAuthorizationResponseSchema,
  AccessPolicy: AccessPolicySchema,
  PermissionType: PermissionTypeSchema,
  ResourceType: ResourceTypeSchema,

  // Decision Events (V2 - Extended)
  DecisionEventV2: DecisionEventSchemaV2,
  DecisionTypeV2: DecisionTypeSchemaV2,

  // Data Access Control (V2 - Extended)
  DataAccessRequest: DataAccessRequestSchema,
  DataAccessResponse: DataAccessResponseSchema,
  AccessPolicyV2: AccessPolicySchemaV2,
  PolicyRule: PolicyRuleSchema,
  DataAccessAction: DataAccessActionSchema,
  AccessConstraint: AccessConstraintSchema,

  // Anonymization (V2 - Extended)
  AnonymizationRequestV2: AnonymizationRequestSchemaV2,
  AnonymizationResponseV2: AnonymizationResponseSchemaV2,
  AnonymizationConfig: AnonymizationConfigSchema,
  PIITypeV2: PIITypeSchemaV2,
  PIIDetection: PIIDetectionSchema,
  ComplianceFramework: ComplianceFrameworkSchema,

  // Agent Configuration
  AgentConfig: AgentConfigSchema,
  TelemetryConfig: TelemetryConfigSchema,
  AgentCapability: AgentCapabilitySchema,
  AgentCapabilityType: AgentCapabilityTypeSchema,
  AgentStatus: AgentStatusSchema,
  AgentRegistration: AgentRegistrationSchema,
} as const;

/**
 * Schema names
 */
export type SchemaName = keyof typeof SchemaRegistry;

/**
 * Get schema by name
 */
export function getSchema<T extends SchemaName>(name: T): (typeof SchemaRegistry)[T] {
  const schema = SchemaRegistry[name];
  if (!schema) {
    throw new Error(`Schema not found: ${name}`);
  }
  return schema;
}

/**
 * Validate data against a named schema
 */
export function validate<T extends SchemaName>(
  schemaName: T,
  data: unknown
): z.infer<(typeof SchemaRegistry)[T]> {
  const schema = getSchema(schemaName);
  return schema.parse(data);
}

/**
 * Safe validate (returns result or error)
 */
export function safeValidate<T extends SchemaName>(
  schemaName: T,
  data: unknown
): { success: true; data: z.infer<(typeof SchemaRegistry)[T]> } | { success: false; error: z.ZodError } {
  const schema = getSchema(schemaName);
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Get JSON Schema representation (for documentation/API specs)
 */
export function getJsonSchema(schemaName: SchemaName): object {
  // Note: This is a simplified version. In production, use zod-to-json-schema
  const schema = getSchema(schemaName);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://llm-data-vault.agentics.dev/schemas/${schemaName}`,
    title: schemaName,
    description: `LLM-Data-Vault ${schemaName} schema`,
    // Would need zod-to-json-schema for full conversion
    _zodSchema: schema.description,
  };
}

/**
 * List all available schemas
 */
export function listSchemas(): SchemaName[] {
  return Object.keys(SchemaRegistry) as SchemaName[];
}
