/**
 * CLI Commands
 *
 * Re-exports all CLI commands for the LLM Data Vault.
 *
 * @module @llm-data-vault/cli/commands
 */

export { authorizeCommand } from './authorize';
export type {
  AuthorizationRequest,
  AuthorizationResponse,
  PolicyMatch,
  Obligation,
  Advice,
} from './authorize';

export { anonymizeCommand } from './anonymize';
export type {
  AnonymizationStrategy,
  ComplianceFramework,
  PIIType,
  PIIEntity,
  AnonymizationRequest,
  AnonymizationResponse,
  AnonymizationMapping,
  AnonymizationStats,
} from './anonymize';

export { inspectCommand } from './inspect';
export type {
  DatasetFormat,
  SensitivityLevel,
  DatasetMetadata,
  DatasetSchema,
  SchemaField,
  EncryptionInfo,
  RetentionPolicy,
  LineageInfo,
  PIISummary,
  PIITypeInfo,
  ApplicablePolicy,
  RecordMetadata,
} from './inspect';
