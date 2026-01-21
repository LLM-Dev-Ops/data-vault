/**
 * LLM Data Vault CLI
 *
 * Enterprise command-line interface for managing LLM training data
 * with built-in PII detection, anonymization, and access control.
 *
 * @module @llm-data-vault/cli
 */

// Main CLI entry
export { program, globalConfig } from './cli';
export type { CliConfig } from './cli';

// Commands
export { authorizeCommand } from './commands/authorize';
export type {
  AuthorizationRequest,
  AuthorizationResponse,
  PolicyMatch,
  Obligation,
  Advice,
} from './commands/authorize';

export { anonymizeCommand } from './commands/anonymize';
export type {
  AnonymizationStrategy,
  ComplianceFramework,
  PIIType,
  PIIEntity,
  AnonymizationRequest,
  AnonymizationResponse,
  AnonymizationMapping,
  AnonymizationStats,
} from './commands/anonymize';

export { inspectCommand } from './commands/inspect';
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
} from './commands/inspect';

// Formatters
export {
  createTable,
  formatJson,
  formatYaml,
  formatPlain,
  formatTable,
  formatOutput,
  truncate,
  formatBytes,
  formatDuration,
  formatPercent,
  formatDateTime,
  formatRelativeTime,
  createProgressBar,
  colorizeStatus,
  colorizeRisk,
  formatError,
  box,
} from './formatters';
export type { OutputFormat, TableOptions } from './formatters';
