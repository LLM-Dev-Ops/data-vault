/**
 * Inspect Command
 *
 * Inspect dataset and record metadata, detected PII types,
 * and applicable policies.
 *
 * @module @llm-data-vault/cli/commands/inspect
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { globalConfig } from '../cli';
import { formatOutput, OutputFormat, createTable } from '../formatters';

/**
 * Dataset format types
 */
export type DatasetFormat = 'json' | 'jsonl' | 'csv' | 'parquet' | 'text' | 'binary';

/**
 * Dataset sensitivity classification
 */
export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * Dataset metadata interface
 */
export interface DatasetMetadata {
  id: string;
  name: string;
  description?: string;
  format: DatasetFormat;
  sizeBytes: number;
  recordCount: number;
  createdAt: string;
  updatedAt: string;
  owner: string;
  tags: string[];
  sensitivity: SensitivityLevel;
  schema?: DatasetSchema;
  encryption: EncryptionInfo;
  retention: RetentionPolicy;
  lineage?: LineageInfo;
}

/**
 * Dataset schema definition
 */
export interface DatasetSchema {
  fields: SchemaField[];
  version: string;
}

/**
 * Schema field definition
 */
export interface SchemaField {
  name: string;
  type: string;
  nullable: boolean;
  piiClassification?: string;
  description?: string;
}

/**
 * Encryption information
 */
export interface EncryptionInfo {
  enabled: boolean;
  algorithm?: string;
  keyId?: string;
  keyRotationDays?: number;
}

/**
 * Retention policy
 */
export interface RetentionPolicy {
  type: 'indefinite' | 'time-based' | 'event-based';
  daysToRetain?: number;
  deleteAfter?: string;
  legalHold: boolean;
}

/**
 * Lineage information
 */
export interface LineageInfo {
  sources: string[];
  transformations: string[];
  downstream: string[];
}

/**
 * PII detection summary
 */
export interface PIISummary {
  hasPI: boolean;
  piiTypes: PIITypeInfo[];
  totalEntities: number;
  riskScore: number;
  lastScanAt: string;
  scanVersion: string;
}

/**
 * PII type information
 */
export interface PIITypeInfo {
  type: string;
  count: number;
  sampleFields: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Applicable policy
 */
export interface ApplicablePolicy {
  id: string;
  name: string;
  type: 'access' | 'retention' | 'encryption' | 'anonymization' | 'audit';
  effect: 'permit' | 'deny' | 'require';
  description: string;
  conditions: string[];
  compliance: string[];
}

/**
 * Record metadata
 */
export interface RecordMetadata {
  id: string;
  datasetId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
  checksum: string;
  piiDetected: boolean;
  anonymized: boolean;
  encrypted: boolean;
  accessCount: number;
  lastAccessedAt?: string;
}

/**
 * Create mock dataset metadata for demonstration
 */
function createMockDatasetMetadata(datasetId: string): DatasetMetadata {
  return {
    id: datasetId,
    name: `Dataset ${datasetId.slice(-4)}`,
    description: 'Training dataset for LLM fine-tuning',
    format: 'jsonl',
    sizeBytes: 1024 * 1024 * 250, // 250 MB
    recordCount: 50000,
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-20T14:45:00Z',
    owner: 'ml-team@example.com',
    tags: ['training', 'nlp', 'production'],
    sensitivity: 'confidential',
    schema: {
      version: '1.0.0',
      fields: [
        { name: 'id', type: 'string', nullable: false },
        { name: 'text', type: 'string', nullable: false, piiClassification: 'may_contain_pii' },
        { name: 'user_email', type: 'string', nullable: true, piiClassification: 'email' },
        { name: 'timestamp', type: 'datetime', nullable: false },
        { name: 'metadata', type: 'object', nullable: true },
      ],
    },
    encryption: {
      enabled: true,
      algorithm: 'AES-256-GCM',
      keyId: 'key_abc123',
      keyRotationDays: 90,
    },
    retention: {
      type: 'time-based',
      daysToRetain: 365,
      deleteAfter: '2025-01-15T00:00:00Z',
      legalHold: false,
    },
    lineage: {
      sources: ['raw_user_feedback', 'preprocessed_conversations'],
      transformations: ['pii_anonymization', 'format_standardization'],
      downstream: ['fine_tuned_model_v2', 'evaluation_benchmark'],
    },
  };
}

/**
 * Create mock PII summary
 */
function createMockPIISummary(): PIISummary {
  return {
    hasPI: true,
    piiTypes: [
      { type: 'email', count: 1250, sampleFields: ['user_email', 'text'], riskLevel: 'high' },
      { type: 'name', count: 3400, sampleFields: ['text'], riskLevel: 'medium' },
      { type: 'phone', count: 450, sampleFields: ['text'], riskLevel: 'high' },
      { type: 'address', count: 120, sampleFields: ['text'], riskLevel: 'medium' },
      { type: 'ip_address', count: 800, sampleFields: ['metadata'], riskLevel: 'low' },
    ],
    totalEntities: 6020,
    riskScore: 0.72,
    lastScanAt: '2024-01-19T08:00:00Z',
    scanVersion: '2.1.0',
  };
}

/**
 * Create mock applicable policies
 */
function createMockPolicies(): ApplicablePolicy[] {
  return [
    {
      id: 'pol_gdpr_01',
      name: 'GDPR Data Protection',
      type: 'access',
      effect: 'require',
      description: 'Require anonymization for personal data access',
      conditions: ['sensitivity=confidential', 'pii_detected=true'],
      compliance: ['GDPR'],
    },
    {
      id: 'pol_encrypt_01',
      name: 'Encryption at Rest',
      type: 'encryption',
      effect: 'require',
      description: 'All confidential data must be encrypted',
      conditions: ['sensitivity>=confidential'],
      compliance: ['SOC2', 'ISO27001'],
    },
    {
      id: 'pol_retain_01',
      name: 'Training Data Retention',
      type: 'retention',
      effect: 'require',
      description: 'Retain training data for 1 year',
      conditions: ['tags contains training'],
      compliance: ['internal'],
    },
    {
      id: 'pol_audit_01',
      name: 'Audit All Access',
      type: 'audit',
      effect: 'require',
      description: 'Log all access to sensitive datasets',
      conditions: ['sensitivity>=internal'],
      compliance: ['SOC2', 'HIPAA'],
    },
    {
      id: 'pol_anon_01',
      name: 'PII Anonymization',
      type: 'anonymization',
      effect: 'require',
      description: 'Anonymize PII before export',
      conditions: ['pii_detected=true', 'action=export'],
      compliance: ['GDPR', 'CCPA'],
    },
  ];
}

/**
 * Create mock record metadata
 */
function createMockRecordMetadata(datasetId: string, recordId: string): RecordMetadata {
  return {
    id: recordId,
    datasetId,
    version: 3,
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-18T16:20:00Z',
    sizeBytes: 4096,
    checksum: 'sha256:abc123def456...',
    piiDetected: true,
    anonymized: false,
    encrypted: true,
    accessCount: 42,
    lastAccessedAt: '2024-01-20T09:15:00Z',
  };
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Inspect command
 */
export const inspectCommand = new Command('inspect')
  .description('Inspect dataset or record metadata, PII detection results, and policies')
  .requiredOption('--dataset-id <id>', 'Dataset ID to inspect')
  .option('--record-id <id>', 'Specific record ID to inspect')
  .option('--show-pii', 'Show detected PII types and statistics')
  .option('--show-policies', 'Show applicable policies')
  .option('--show-schema', 'Show dataset schema')
  .option('--show-lineage', 'Show data lineage information')
  .option('--show-all', 'Show all available information')
  .option('-f, --format <format>', 'Output format (json, table, yaml)', 'table')
  .addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.dim('# Basic dataset inspection')}
  $ data-vault inspect --dataset-id ds_abc123

  ${chalk.dim('# Show PII detection results')}
  $ data-vault inspect --dataset-id ds_abc123 --show-pii

  ${chalk.dim('# Show applicable policies')}
  $ data-vault inspect --dataset-id ds_abc123 --show-policies

  ${chalk.dim('# Show all information in JSON format')}
  $ data-vault inspect --dataset-id ds_abc123 --show-all --format json

  ${chalk.dim('# Inspect specific record')}
  $ data-vault inspect --dataset-id ds_abc123 --record-id rec_xyz789

  ${chalk.dim('# Show schema and lineage')}
  $ data-vault inspect --dataset-id ds_abc123 --show-schema --show-lineage
`)
  .action(async (options) => {
    const spinner: Ora | null = globalConfig?.quiet ? null : ora('Fetching metadata...').start();

    try {
      const outputFormat = (options.format || globalConfig?.outputFormat || 'table') as OutputFormat;

      // If inspecting a specific record
      if (options.recordId) {
        if (spinner) spinner.text = 'Fetching record metadata...';

        // In production, fetch from API
        const recordMetadata = createMockRecordMetadata(options.datasetId, options.recordId);

        if (spinner) spinner.stop();

        if (outputFormat === 'json') {
          console.log(JSON.stringify(recordMetadata, null, 2));
        } else if (outputFormat === 'yaml') {
          console.log(formatOutput(recordMetadata, 'yaml'));
        } else {
          printRecordMetadata(recordMetadata);
        }
        return;
      }

      // Fetch dataset metadata
      const datasetMetadata = createMockDatasetMetadata(options.datasetId);

      // Optionally fetch PII summary
      let piiSummary: PIISummary | undefined;
      if (options.showPii || options.showAll) {
        if (spinner) spinner.text = 'Fetching PII analysis...';
        piiSummary = createMockPIISummary();
      }

      // Optionally fetch policies
      let policies: ApplicablePolicy[] | undefined;
      if (options.showPolicies || options.showAll) {
        if (spinner) spinner.text = 'Fetching policies...';
        policies = createMockPolicies();
      }

      if (spinner) spinner.stop();

      // Output based on format
      if (outputFormat === 'json') {
        const output: Record<string, unknown> = { dataset: datasetMetadata };
        if (piiSummary) output.pii = piiSummary;
        if (policies) output.policies = policies;
        console.log(JSON.stringify(output, null, 2));
      } else if (outputFormat === 'yaml') {
        const output: Record<string, unknown> = { dataset: datasetMetadata };
        if (piiSummary) output.pii = piiSummary;
        if (policies) output.policies = policies;
        console.log(formatOutput(output, 'yaml'));
      } else {
        printDatasetMetadata(datasetMetadata, options.showSchema || options.showAll);

        if ((options.showLineage || options.showAll) && datasetMetadata.lineage) {
          printLineage(datasetMetadata.lineage);
        }

        if (piiSummary) {
          printPIISummary(piiSummary);
        }

        if (policies) {
          printPolicies(policies);
        }
      }
    } catch (error) {
      if (spinner) spinner.fail('Inspection failed');
      if (error instanceof Error) {
        console.error(chalk.red('Error:'), error.message);
      } else {
        console.error(chalk.red('Error:'), String(error));
      }
      process.exit(1);
    }
  });

/**
 * Print dataset metadata in table format
 */
function printDatasetMetadata(metadata: DatasetMetadata, showSchema: boolean): void {
  console.log(chalk.bold.underline('Dataset Information'));
  console.log();

  // Basic info
  console.log(`  ${chalk.bold('ID:')}           ${metadata.id}`);
  console.log(`  ${chalk.bold('Name:')}         ${metadata.name}`);
  if (metadata.description) {
    console.log(`  ${chalk.bold('Description:')}  ${metadata.description}`);
  }
  console.log(`  ${chalk.bold('Format:')}       ${metadata.format}`);
  console.log(`  ${chalk.bold('Size:')}         ${formatBytes(metadata.sizeBytes)}`);
  console.log(`  ${chalk.bold('Records:')}      ${metadata.recordCount.toLocaleString()}`);
  console.log(`  ${chalk.bold('Owner:')}        ${metadata.owner}`);

  // Sensitivity with color coding
  const sensitivityColors: Record<SensitivityLevel, (s: string) => string> = {
    public: chalk.green,
    internal: chalk.blue,
    confidential: chalk.yellow,
    restricted: chalk.red,
  };
  const sensitivityColor = sensitivityColors[metadata.sensitivity];
  console.log(`  ${chalk.bold('Sensitivity:')}  ${sensitivityColor(metadata.sensitivity.toUpperCase())}`);

  // Tags
  if (metadata.tags.length > 0) {
    console.log(`  ${chalk.bold('Tags:')}         ${metadata.tags.map(t => chalk.cyan(t)).join(', ')}`);
  }

  // Timestamps
  console.log();
  console.log(chalk.bold('  Timestamps:'));
  console.log(`    Created:  ${metadata.createdAt}`);
  console.log(`    Updated:  ${metadata.updatedAt}`);

  // Encryption
  console.log();
  console.log(chalk.bold('  Encryption:'));
  if (metadata.encryption.enabled) {
    console.log(`    ${chalk.green('Enabled')}`);
    console.log(`    Algorithm:    ${metadata.encryption.algorithm}`);
    console.log(`    Key ID:       ${metadata.encryption.keyId}`);
    console.log(`    Key Rotation: ${metadata.encryption.keyRotationDays} days`);
  } else {
    console.log(`    ${chalk.red('Disabled')}`);
  }

  // Retention
  console.log();
  console.log(chalk.bold('  Retention:'));
  console.log(`    Type:         ${metadata.retention.type}`);
  if (metadata.retention.daysToRetain) {
    console.log(`    Days:         ${metadata.retention.daysToRetain}`);
  }
  if (metadata.retention.deleteAfter) {
    console.log(`    Delete After: ${metadata.retention.deleteAfter}`);
  }
  console.log(`    Legal Hold:   ${metadata.retention.legalHold ? chalk.yellow('Yes') : 'No'}`);

  // Schema
  if (showSchema && metadata.schema) {
    console.log();
    console.log(chalk.bold.underline('Schema'));
    console.log(`  Version: ${metadata.schema.version}`);
    console.log();

    const table = createTable(['Field', 'Type', 'Nullable', 'PII Classification']);

    for (const field of metadata.schema.fields) {
      const piiClass = field.piiClassification || '-';
      const piiColor = field.piiClassification ? chalk.yellow(piiClass) : chalk.dim(piiClass);

      table.push([
        field.name,
        field.type,
        field.nullable ? 'yes' : 'no',
        piiColor,
      ]);
    }

    console.log(table.toString());
  }
}

/**
 * Print lineage information
 */
function printLineage(lineage: LineageInfo): void {
  console.log();
  console.log(chalk.bold.underline('Data Lineage'));
  console.log();

  // Sources
  console.log(chalk.bold('  Upstream Sources:'));
  if (lineage.sources.length > 0) {
    for (const source of lineage.sources) {
      console.log(`    ${chalk.dim('->')} ${source}`);
    }
  } else {
    console.log(chalk.dim('    (none)'));
  }

  // Transformations
  console.log();
  console.log(chalk.bold('  Transformations Applied:'));
  if (lineage.transformations.length > 0) {
    for (const transform of lineage.transformations) {
      console.log(`    ${chalk.cyan('*')} ${transform}`);
    }
  } else {
    console.log(chalk.dim('    (none)'));
  }

  // Downstream
  console.log();
  console.log(chalk.bold('  Downstream Consumers:'));
  if (lineage.downstream.length > 0) {
    for (const consumer of lineage.downstream) {
      console.log(`    ${chalk.dim('<-')} ${consumer}`);
    }
  } else {
    console.log(chalk.dim('    (none)'));
  }
}

/**
 * Print PII summary
 */
function printPIISummary(summary: PIISummary): void {
  console.log();
  console.log(chalk.bold.underline('PII Analysis'));
  console.log();

  // Overall status
  const piiStatus = summary.hasPI
    ? chalk.yellow('PII DETECTED')
    : chalk.green('NO PII');
  console.log(`  ${chalk.bold('Status:')}        ${piiStatus}`);
  console.log(`  ${chalk.bold('Total Entities:')} ${summary.totalEntities.toLocaleString()}`);

  // Risk score
  const riskColor = summary.riskScore >= 0.7 ? chalk.red :
                    summary.riskScore >= 0.4 ? chalk.yellow :
                    chalk.green;
  console.log(`  ${chalk.bold('Risk Score:')}    ${riskColor((summary.riskScore * 100).toFixed(0) + '%')}`);
  console.log(`  ${chalk.bold('Last Scan:')}     ${summary.lastScanAt}`);
  console.log(`  ${chalk.bold('Scan Version:')}  ${summary.scanVersion}`);

  // PII types breakdown
  if (summary.piiTypes.length > 0) {
    console.log();
    console.log(chalk.bold('  Detected PII Types:'));
    console.log();

    const table = createTable(['Type', 'Count', 'Risk Level', 'Sample Fields']);

    for (const piiType of summary.piiTypes) {
      const riskColors: Record<string, (s: string) => string> = {
        low: chalk.green,
        medium: chalk.yellow,
        high: chalk.red,
        critical: chalk.bgRed.white,
      };
      const riskColor = riskColors[piiType.riskLevel] || chalk.white;

      table.push([
        chalk.cyan(piiType.type),
        piiType.count.toLocaleString(),
        riskColor(piiType.riskLevel),
        chalk.dim(piiType.sampleFields.join(', ')),
      ]);
    }

    console.log(table.toString());
  }
}

/**
 * Print applicable policies
 */
function printPolicies(policies: ApplicablePolicy[]): void {
  console.log();
  console.log(chalk.bold.underline('Applicable Policies'));
  console.log();

  if (policies.length === 0) {
    console.log(chalk.dim('  No policies apply to this dataset'));
    return;
  }

  for (const policy of policies) {
    const effectColors: Record<string, (s: string) => string> = {
      permit: chalk.green,
      deny: chalk.red,
      require: chalk.yellow,
    };
    const effectColor = effectColors[policy.effect] || chalk.white;

    console.log(`  ${chalk.bold(policy.name)} ${chalk.dim(`(${policy.id})`)}`);
    console.log(`    Type:        ${policy.type}`);
    console.log(`    Effect:      ${effectColor(policy.effect)}`);
    console.log(`    Description: ${policy.description}`);
    console.log(`    Conditions:  ${policy.conditions.join(', ')}`);
    console.log(`    Compliance:  ${policy.compliance.join(', ')}`);
    console.log();
  }
}

/**
 * Print record metadata
 */
function printRecordMetadata(metadata: RecordMetadata): void {
  console.log(chalk.bold.underline('Record Information'));
  console.log();

  console.log(`  ${chalk.bold('ID:')}           ${metadata.id}`);
  console.log(`  ${chalk.bold('Dataset:')}      ${metadata.datasetId}`);
  console.log(`  ${chalk.bold('Version:')}      ${metadata.version}`);
  console.log(`  ${chalk.bold('Size:')}         ${formatBytes(metadata.sizeBytes)}`);
  console.log(`  ${chalk.bold('Checksum:')}     ${chalk.dim(metadata.checksum)}`);

  console.log();
  console.log(chalk.bold('  Status:'));
  console.log(`    PII Detected:  ${metadata.piiDetected ? chalk.yellow('Yes') : chalk.green('No')}`);
  console.log(`    Anonymized:    ${metadata.anonymized ? chalk.green('Yes') : 'No'}`);
  console.log(`    Encrypted:     ${metadata.encrypted ? chalk.green('Yes') : chalk.red('No')}`);

  console.log();
  console.log(chalk.bold('  Access:'));
  console.log(`    Access Count:    ${metadata.accessCount}`);
  if (metadata.lastAccessedAt) {
    console.log(`    Last Accessed:   ${metadata.lastAccessedAt}`);
  }

  console.log();
  console.log(chalk.bold('  Timestamps:'));
  console.log(`    Created:  ${metadata.createdAt}`);
  console.log(`    Updated:  ${metadata.updatedAt}`);
}

export default inspectCommand;
