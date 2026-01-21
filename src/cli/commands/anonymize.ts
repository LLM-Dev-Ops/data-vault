/**
 * Anonymization Command
 *
 * Invokes the Dataset Anonymization Agent to detect and anonymize PII
 * in datasets using various strategies and compliance frameworks.
 *
 * @module @llm-data-vault/cli/commands/anonymize
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { globalConfig } from '../cli';
import { createTable } from '../formatters';

/**
 * Anonymization strategy types
 */
export type AnonymizationStrategy = 'mask' | 'redact' | 'hash' | 'generalize' | 'synthesize' | 'tokenize';

/**
 * Compliance framework types
 */
export type ComplianceFramework = 'GDPR' | 'CCPA' | 'HIPAA' | 'PCI-DSS' | 'SOX' | 'FERPA';

/**
 * PII type classification
 */
export type PIIType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'address'
  | 'name'
  | 'date_of_birth'
  | 'ip_address'
  | 'medical_record'
  | 'financial_account'
  | 'passport'
  | 'driver_license'
  | 'biometric'
  | 'genetic'
  | 'custom';

/**
 * Detected PII entity
 */
export interface PIIEntity {
  type: PIIType;
  value: string;
  start: number;
  end: number;
  confidence: number;
  context?: string;
}

/**
 * Anonymization request interface
 */
export interface AnonymizationRequest {
  datasetId?: string;
  content: string;
  strategy: AnonymizationStrategy;
  compliance?: ComplianceFramework[];
  options?: {
    preserveFormat?: boolean;
    deterministicHash?: boolean;
    hashSalt?: string;
    customPatterns?: Record<string, string>;
    excludeTypes?: PIIType[];
    minConfidence?: number;
  };
}

/**
 * Anonymization response interface
 */
export interface AnonymizationResponse {
  anonymizedContent: string;
  entitiesDetected: PIIEntity[];
  entitiesAnonymized: number;
  strategy: AnonymizationStrategy;
  compliance: ComplianceFramework[];
  mappings?: AnonymizationMapping[];
  statistics: AnonymizationStats;
  processingTimeMs: number;
}

/**
 * Mapping of original to anonymized values (for reversible anonymization)
 */
export interface AnonymizationMapping {
  type: PIIType;
  original: string;
  anonymized: string;
  token?: string;
}

/**
 * Anonymization statistics
 */
export interface AnonymizationStats {
  totalEntities: number;
  byType: Record<PIIType, number>;
  avgConfidence: number;
  inputLength: number;
  outputLength: number;
}

/**
 * Dataset Anonymization Agent interface
 */
interface DatasetAnonymizationAgent {
  anonymize(request: AnonymizationRequest): Promise<AnonymizationResponse>;
  detectPII(content: string): Promise<PIIEntity[]>;
}

/**
 * PII detection patterns
 */
const PII_PATTERNS: Record<PIIType, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
  ip_address: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  date_of_birth: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  address: /\b\d{1,5}\s+\w+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl)\b/gi,
  name: /\b[A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15}\b/g, // Simple name pattern with length limits
  medical_record: /\bMRN[:\s-]?\d{6,12}\b/gi,
  financial_account: /\bAcct?[:\s#-]?\d{8,17}\b/gi,
  passport: /\b[A-Z]{1,2}\d{6,9}\b/g,
  driver_license: /\b[A-Z]{1,2}\d{5,8}\b/g,
  biometric: /\bfingerprint[:\s-]?[A-Fa-f0-9]{32}\b/gi,
  genetic: /\bDNA[:\s-]?[A-Za-z0-9]{10,50}\b/gi,
  custom: /(?:^$)/g, // Placeholder - matches nothing
};

/**
 * Anonymization strategies implementation
 */
const ANONYMIZATION_STRATEGIES: Record<AnonymizationStrategy, (value: string, type: PIIType, opts?: { salt?: string }) => string> = {
  mask: (value: string, type: PIIType) => {
    if (type === 'email') {
      const parts = value.split('@');
      const local = parts[0] ?? '';
      const domain = parts[1] ?? '';
      return local.length > 0 ? `${local[0]}${'*'.repeat(Math.max(0, local.length - 1))}@${domain}` : `***@${domain}`;
    }
    if (type === 'phone' || type === 'ssn' || type === 'credit_card') {
      return value.replace(/\d(?=\d{4})/g, '*');
    }
    return '*'.repeat(value.length);
  },

  redact: (_value: string, type: PIIType) => {
    return `[${type.toUpperCase()}_REDACTED]`;
  },

  hash: (value: string, _type: PIIType, opts?: { salt?: string }) => {
    // Simple hash simulation (in production, use proper crypto)
    const salt = opts?.salt || 'default-salt';
    const input = `${salt}:${value}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `h_${Math.abs(hash).toString(16).padStart(8, '0')}`;
  },

  generalize: (value: string, type: PIIType) => {
    if (type === 'email') {
      const domain = value.split('@')[1];
      return `user@${domain}`;
    }
    if (type === 'phone') {
      return value.replace(/\d{4}$/, 'XXXX');
    }
    if (type === 'address') {
      return value.replace(/^\d+\s+/, '*** ');
    }
    if (type === 'date_of_birth') {
      return value.replace(/\d{2}[-/]\d{2}[-/]/, 'XX/XX/');
    }
    return `[${type.toUpperCase()}]`;
  },

  synthesize: (_value: string, type: PIIType) => {
    const synthetic: Record<PIIType, () => string> = {
      email: () => `user${Math.floor(Math.random() * 10000)}@example.com`,
      phone: () => `555-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
      ssn: () => `000-00-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
      credit_card: () => `4000-0000-0000-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
      address: () => `123 Example Street`,
      name: () => `John Doe`,
      date_of_birth: () => `01/01/2000`,
      ip_address: () => `192.168.1.${Math.floor(Math.random() * 255)}`,
      medical_record: () => `MRN-${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
      financial_account: () => `Acct-${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      passport: () => `XX${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
      driver_license: () => `DL${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`,
      biometric: () => `[SYNTHETIC_BIOMETRIC]`,
      genetic: () => `[SYNTHETIC_GENETIC]`,
      custom: () => `[SYNTHETIC]`,
    };
    const generator = synthetic[type];
    return generator ? generator() : `[SYNTHETIC_${type.toUpperCase()}]`;
  },

  tokenize: (_value: string, _type: PIIType) => {
    // Generate a unique token for the value
    const token = `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return token;
  },
};

/**
 * Create a Dataset Anonymization Agent
 */
function createDatasetAnonymizationAgent(): DatasetAnonymizationAgent {
  return {
    async detectPII(content: string): Promise<PIIEntity[]> {
      const entities: PIIEntity[] = [];

      for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;

        while ((match = regex.exec(content)) !== null) {
          // Calculate confidence based on pattern specificity
          let confidence = 0.85;
          if (type === 'email' || type === 'ssn' || type === 'credit_card') {
            confidence = 0.95;
          } else if (type === 'name' || type === 'address') {
            confidence = 0.75;
          }

          entities.push({
            type: type as PIIType,
            value: match[0],
            start: match.index,
            end: match.index + match[0].length,
            confidence,
            context: content.slice(
              Math.max(0, match.index - 20),
              Math.min(content.length, match.index + match[0].length + 20)
            ),
          });
        }
      }

      // Sort by position
      return entities.sort((a, b) => a.start - b.start);
    },

    async anonymize(request: AnonymizationRequest): Promise<AnonymizationResponse> {
      const startTime = Date.now();

      // Detect PII
      const entities = await this.detectPII(request.content);

      // Filter by confidence threshold
      const minConfidence = request.options?.minConfidence ?? 0.8;
      const filteredEntities = entities.filter(e => e.confidence >= minConfidence);

      // Filter by excluded types
      const excludeTypes = request.options?.excludeTypes ?? [];
      const includedEntities = filteredEntities.filter(e => !excludeTypes.includes(e.type));

      // Apply anonymization strategy
      const strategy = ANONYMIZATION_STRATEGIES[request.strategy];
      const opts = { salt: request.options?.hashSalt };

      let anonymizedContent = request.content;
      const mappings: AnonymizationMapping[] = [];

      // Process entities in reverse order to preserve positions
      const sortedEntities = [...includedEntities].sort((a, b) => b.start - a.start);

      for (const entity of sortedEntities) {
        const anonymized = strategy(entity.value, entity.type, opts);

        anonymizedContent =
          anonymizedContent.slice(0, entity.start) +
          anonymized +
          anonymizedContent.slice(entity.end);

        mappings.push({
          type: entity.type,
          original: entity.value,
          anonymized,
          token: request.strategy === 'tokenize' ? anonymized : undefined,
        });
      }

      // Calculate statistics
      const byType: Record<PIIType, number> = {} as Record<PIIType, number>;
      for (const entity of includedEntities) {
        byType[entity.type] = (byType[entity.type] || 0) + 1;
      }

      const avgConfidence = includedEntities.length > 0
        ? includedEntities.reduce((sum, e) => sum + e.confidence, 0) / includedEntities.length
        : 0;

      return {
        anonymizedContent,
        entitiesDetected: includedEntities,
        entitiesAnonymized: includedEntities.length,
        strategy: request.strategy,
        compliance: request.compliance || [],
        mappings: request.strategy === 'tokenize' ? mappings : undefined,
        statistics: {
          totalEntities: includedEntities.length,
          byType,
          avgConfidence,
          inputLength: request.content.length,
          outputLength: anonymizedContent.length,
        },
        processingTimeMs: Date.now() - startTime,
      };
    },
  };
}

/**
 * Read input from file or stdin
 */
async function readInput(inputPath: string): Promise<string> {
  if (inputPath === '-' || inputPath === 'stdin') {
    // Read from stdin using streams
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      // Check if stdin is a TTY (interactive mode) - avoid hanging
      if (process.stdin.isTTY) {
        reject(new Error('No input provided. Pipe data to stdin or use --input <file>'));
        return;
      }

      process.stdin.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      process.stdin.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      process.stdin.on('error', reject);
    });
  }

  // Read from file
  const resolvedPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Input file not found: ${resolvedPath}`);
  }

  return fs.readFileSync(resolvedPath, 'utf-8');
}

/**
 * Write output to file or stdout
 */
function writeOutput(content: string, outputPath: string): void {
  if (outputPath === '-' || outputPath === 'stdout') {
    console.log(content);
    return;
  }

  const resolvedPath = path.resolve(outputPath);
  const dir = path.dirname(resolvedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolvedPath, content, 'utf-8');
}

/**
 * Anonymize command
 */
export const anonymizeCommand = new Command('anonymize')
  .description('Anonymize dataset content using Dataset Anonymization Agent')
  .option('--dataset-id <id>', 'Dataset ID (for tracking)')
  .option('--input <file>', 'Input file path or - for stdin', '-')
  .option('--output <file>', 'Output file path or - for stdout', '-')
  .requiredOption('--strategy <strategy>', 'Anonymization strategy (mask, redact, hash, generalize, synthesize, tokenize)', 'redact')
  .option('--compliance <frameworks>', 'Compliance frameworks (comma-separated: GDPR, CCPA, HIPAA, PCI-DSS, SOX, FERPA)')
  .option('--min-confidence <value>', 'Minimum confidence threshold (0.0-1.0)', '0.8')
  .option('--exclude-types <types>', 'PII types to exclude (comma-separated)')
  .option('--preserve-format', 'Preserve original format where possible')
  .option('--hash-salt <salt>', 'Salt for deterministic hashing')
  .option('--show-stats', 'Show anonymization statistics')
  .option('--show-mappings', 'Show value mappings (tokenize strategy only)')
  .option('--dry-run', 'Detect PII without anonymizing')
  .option('-f, --format <format>', 'Output format for stats (json, table)', 'table')
  .addHelpText('after', `
${chalk.bold('Strategies:')}
  ${chalk.cyan('mask')}       - Partially mask values (e.g., j***@example.com)
  ${chalk.cyan('redact')}     - Replace with type placeholder (e.g., [EMAIL_REDACTED])
  ${chalk.cyan('hash')}       - Replace with one-way hash (e.g., h_a1b2c3d4)
  ${chalk.cyan('generalize')} - Generalize to category (e.g., user@domain.com)
  ${chalk.cyan('synthesize')} - Replace with synthetic data (e.g., user1234@example.com)
  ${chalk.cyan('tokenize')}   - Replace with reversible token (e.g., tok_abc123)

${chalk.bold('Examples:')}
  ${chalk.dim('# Basic anonymization from stdin')}
  $ echo "Contact john@example.com" | data-vault anonymize --strategy redact

  ${chalk.dim('# Anonymize file with GDPR compliance')}
  $ data-vault anonymize --input data.json --output data-anon.json \\
      --strategy mask --compliance GDPR,CCPA

  ${chalk.dim('# Hash PII with custom salt')}
  $ data-vault anonymize --input records.csv --output records-hashed.csv \\
      --strategy hash --hash-salt "my-secret-salt"

  ${chalk.dim('# Dry run to detect PII without anonymizing')}
  $ data-vault anonymize --input sensitive.txt --dry-run --show-stats

  ${chalk.dim('# Synthesize data for testing')}
  $ data-vault anonymize --input prod-data.json --output test-data.json \\
      --strategy synthesize --compliance HIPAA

  ${chalk.dim('# Exclude specific PII types')}
  $ data-vault anonymize --input data.txt --strategy redact \\
      --exclude-types email,phone
`)
  .action(async (options) => {
    const spinner: Ora | null = globalConfig?.quiet ? null : ora('Processing...').start();

    try {
      // Validate strategy
      const validStrategies: AnonymizationStrategy[] = ['mask', 'redact', 'hash', 'generalize', 'synthesize', 'tokenize'];
      if (!validStrategies.includes(options.strategy)) {
        throw new Error(`Invalid strategy: ${options.strategy}. Must be one of: ${validStrategies.join(', ')}`);
      }

      // Parse compliance frameworks
      let compliance: ComplianceFramework[] = [];
      if (options.compliance) {
        compliance = options.compliance.split(',').map((f: string) => f.trim().toUpperCase()) as ComplianceFramework[];
        const validFrameworks = ['GDPR', 'CCPA', 'HIPAA', 'PCI-DSS', 'SOX', 'FERPA'];
        for (const framework of compliance) {
          if (!validFrameworks.includes(framework)) {
            throw new Error(`Invalid compliance framework: ${framework}. Must be one of: ${validFrameworks.join(', ')}`);
          }
        }
      }

      // Parse exclude types
      let excludeTypes: PIIType[] = [];
      if (options.excludeTypes) {
        excludeTypes = options.excludeTypes.split(',').map((t: string) => t.trim().toLowerCase()) as PIIType[];
      }

      // Read input
      if (spinner) spinner.text = 'Reading input...';
      const content = await readInput(options.input);

      if (!content.trim()) {
        throw new Error('Input is empty');
      }

      // Create agent
      const agent = createDatasetAnonymizationAgent();

      // Dry run mode - just detect PII
      if (options.dryRun) {
        if (spinner) spinner.text = 'Detecting PII...';
        const entities = await agent.detectPII(content);

        if (spinner) spinner.stop();

        if (options.format === 'json') {
          console.log(JSON.stringify({ entities, count: entities.length }, null, 2));
        } else {
          printPIIDetectionResult(entities);
        }
        return;
      }

      // Build request
      if (spinner) spinner.text = 'Anonymizing content...';
      const request: AnonymizationRequest = {
        datasetId: options.datasetId,
        content,
        strategy: options.strategy as AnonymizationStrategy,
        compliance,
        options: {
          preserveFormat: options.preserveFormat,
          hashSalt: options.hashSalt,
          excludeTypes,
          minConfidence: parseFloat(options.minConfidence),
        },
      };

      // Anonymize
      const response = await agent.anonymize(request);

      if (spinner) spinner.stop();

      // Write output
      writeOutput(response.anonymizedContent, options.output);

      // Show statistics
      if (options.showStats || options.showMappings) {
        if (options.format === 'json') {
          console.log(JSON.stringify({
            statistics: response.statistics,
            mappings: options.showMappings ? response.mappings : undefined,
          }, null, 2));
        } else {
          printAnonymizationStats(response, options.showMappings);
        }
      } else if (!globalConfig?.quiet && options.output !== '-' && options.output !== 'stdout') {
        console.log(chalk.green('✓') + ` Anonymized ${response.entitiesAnonymized} PII entities`);
        console.log(`  Output: ${path.resolve(options.output)}`);
      }
    } catch (error) {
      if (spinner) spinner.fail('Anonymization failed');
      if (error instanceof Error) {
        console.error(chalk.red('Error:'), error.message);
      } else {
        console.error(chalk.red('Error:'), String(error));
      }
      process.exit(1);
    }
  });

/**
 * Print PII detection results
 */
function printPIIDetectionResult(entities: PIIEntity[]): void {
  console.log(chalk.bold.underline('PII Detection Results'));
  console.log();

  if (entities.length === 0) {
    console.log(chalk.green('  No PII detected'));
    return;
  }

  console.log(`  Total entities found: ${chalk.yellow(entities.length.toString())}`);
  console.log();

  // Group by type
  const byType: Record<string, PIIEntity[]> = {};
  for (const entity of entities) {
    const typeKey = entity.type;
    if (!byType[typeKey]) {
      byType[typeKey] = [];
    }
    byType[typeKey]!.push(entity);
  }

  const table = createTable(['Type', 'Count', 'Sample', 'Confidence']);

  for (const [type, typeEntities] of Object.entries(byType)) {
    if (!typeEntities || typeEntities.length === 0) continue;
    const firstEntity = typeEntities[0]!;
    const sample = firstEntity.value.length > 30
      ? firstEntity.value.slice(0, 30) + '...'
      : firstEntity.value;

    const avgConf = typeEntities.reduce((sum, e) => sum + e.confidence, 0) / typeEntities.length;

    table.push([
      chalk.cyan(type),
      typeEntities.length.toString(),
      chalk.dim(sample),
      `${(avgConf * 100).toFixed(0)}%`,
    ]);
  }

  console.log(table.toString());
}

/**
 * Print anonymization statistics
 */
function printAnonymizationStats(response: AnonymizationResponse, showMappings: boolean): void {
  console.log();
  console.log(chalk.bold.underline('Anonymization Statistics'));
  console.log();

  console.log(`  Strategy:         ${chalk.cyan(response.strategy)}`);
  console.log(`  Entities found:   ${response.entitiesAnonymized}`);
  console.log(`  Avg confidence:   ${(response.statistics.avgConfidence * 100).toFixed(1)}%`);
  console.log(`  Input size:       ${response.statistics.inputLength} chars`);
  console.log(`  Output size:      ${response.statistics.outputLength} chars`);
  console.log(`  Processing time:  ${response.processingTimeMs}ms`);

  if (response.compliance.length > 0) {
    console.log(`  Compliance:       ${response.compliance.join(', ')}`);
  }

  // By type breakdown
  if (Object.keys(response.statistics.byType).length > 0) {
    console.log();
    console.log(chalk.bold('  By Type:'));
    for (const [type, count] of Object.entries(response.statistics.byType)) {
      console.log(`    ${type.padEnd(20)} ${count}`);
    }
  }

  // Mappings (for tokenize strategy)
  if (showMappings && response.mappings && response.mappings.length > 0) {
    console.log();
    console.log(chalk.bold.underline('Value Mappings'));
    console.log();

    const table = createTable(['Type', 'Original', 'Anonymized']);

    for (const mapping of response.mappings.slice(0, 20)) {
      const original = mapping.original.length > 25
        ? mapping.original.slice(0, 25) + '...'
        : mapping.original;

      table.push([
        mapping.type,
        chalk.dim(original),
        mapping.anonymized,
      ]);
    }

    console.log(table.toString());

    if (response.mappings.length > 20) {
      console.log(chalk.dim(`  ... and ${response.mappings.length - 20} more`));
    }
  }
}

export default anonymizeCommand;
