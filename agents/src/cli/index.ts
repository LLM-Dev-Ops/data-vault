#!/usr/bin/env node
/**
 * LLM-Data-Vault: Agent CLI
 *
 * CLI interface for invoking Data-Vault agents.
 *
 * USAGE:
 *   data-vault anonymize --content <json> --strategy <strategy>
 *   data-vault anonymize --file <path> --policy <policy-id>
 *   data-vault inspect --content <json>
 *   data-vault inspect --file <path>
 *
 * @module cli
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { createAnonymizationAgent } from '../agents/dataset-anonymization-agent.js';
import { createRuVectorClient } from '../ruvector-client/index.js';
import { initTelemetry } from '../telemetry/index.js';
import type { ExecutionContext } from '../runtime/agent-base.js';
import type {
  AnonymizationRequest,
  AnonymizationStrategy,
} from '../contracts/index.js';

/**
 * CLI configuration
 */
interface CLIConfig {
  verbose: boolean;
  outputFormat: 'json' | 'text' | 'table';
  dryRun: boolean;
  includeDetails: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): {
  command: string;
  options: Record<string, string | boolean>;
} {
  const command = args[0] ?? 'help';
  const options: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('--')) {
        options[key] = nextArg;
        i++;
      } else {
        options[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      options[key] = true;
    }
  }

  return { command, options };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
LLM-Data-Vault Agent CLI
========================

Dataset Anonymization Agent CLI interface.

USAGE:
  data-vault <command> [options]

COMMANDS:
  anonymize    Apply anonymization to dataset content
  inspect      Inspect content for PII without modifying
  health       Check agent and service health
  metadata     Show agent metadata and capabilities

ANONYMIZE OPTIONS:
  --content <json>     JSON content to anonymize
  --file <path>        Path to JSON file to anonymize
  --output <path>      Output file path (default: stdout)
  --strategy <name>    Default anonymization strategy
                       (redact, mask, hash, tokenize, generalize, suppress)
  --policy <id>        Policy ID to apply
  --tenant <id>        Tenant ID (default: cli-tenant)
  --dry-run            Inspect without modifying
  --include-details    Include field-level detection details
  --verbose            Show detailed output
  --format <type>      Output format: json, text, table (default: json)

INSPECT OPTIONS:
  --content <json>     JSON content to inspect
  --file <path>        Path to JSON file to inspect
  --verbose            Show detailed output

EXAMPLES:
  # Anonymize JSON content
  data-vault anonymize --content '{"email": "john@example.com"}' --strategy redact

  # Anonymize file with masking strategy
  data-vault anonymize --file data.json --strategy mask --output anonymized.json

  # Inspect for PII without modifying
  data-vault inspect --content '{"ssn": "123-45-6789"}'

  # Use a specific policy
  data-vault anonymize --file data.json --policy policy-uuid-123

ENVIRONMENT VARIABLES:
  RUVECTOR_SERVICE_ENDPOINT    RuVector service URL
  RUVECTOR_SERVICE_API_KEY     RuVector API key
  OTLP_ENDPOINT                OpenTelemetry endpoint
  LOG_LEVEL                    Logging level (debug, info, warn, error)
`);
}

/**
 * Format output based on format type
 */
function formatOutput(
  data: unknown,
  format: 'json' | 'text' | 'table',
  verbose: boolean
): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }

  if (format === 'text') {
    const result = data as {
      success?: boolean;
      data?: {
        results?: {
          total_fields_processed?: number;
          fields_anonymized?: number;
          pii_detections?: number;
          detection_breakdown?: Record<string, number>;
        };
        compliance?: {
          frameworks_satisfied?: string[];
        };
      };
      metadata?: {
        execution_ref?: string;
        execution_time_ms?: number;
      };
    };

    const lines: string[] = [];
    lines.push(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);

    if (result.data?.results) {
      const r = result.data.results;
      lines.push(`Fields Processed: ${r.total_fields_processed}`);
      lines.push(`Fields Anonymized: ${r.fields_anonymized}`);
      lines.push(`PII Detections: ${r.pii_detections}`);

      if (r.detection_breakdown && Object.keys(r.detection_breakdown).length > 0) {
        lines.push('Detection Breakdown:');
        for (const [type, count] of Object.entries(r.detection_breakdown)) {
          lines.push(`  ${type}: ${count}`);
        }
      }
    }

    if (result.data?.compliance) {
      lines.push(`Compliance: ${result.data.compliance.frameworks_satisfied?.join(', ') ?? 'N/A'}`);
    }

    if (verbose && result.metadata) {
      lines.push(`Execution Ref: ${result.metadata.execution_ref}`);
      lines.push(`Execution Time: ${result.metadata.execution_time_ms?.toFixed(2)}ms`);
    }

    return lines.join('\n');
  }

  if (format === 'table') {
    const result = data as {
      success?: boolean;
      data?: {
        results?: {
          total_fields_processed?: number;
          fields_anonymized?: number;
          pii_detections?: number;
        };
        field_results?: Array<{
          field_path?: string;
          pii_type?: string;
          strategy_applied?: string;
          confidence?: number;
        }>;
      };
    };

    const lines: string[] = [];

    // Summary table
    lines.push('+-------------------------+-------------+');
    lines.push('| Metric                  | Value       |');
    lines.push('+-------------------------+-------------+');
    lines.push(`| Status                  | ${(result.success ? 'SUCCESS' : 'FAILED').padEnd(11)} |`);
    lines.push(`| Fields Processed        | ${String(result.data?.results?.total_fields_processed ?? 0).padEnd(11)} |`);
    lines.push(`| Fields Anonymized       | ${String(result.data?.results?.fields_anonymized ?? 0).padEnd(11)} |`);
    lines.push(`| PII Detections          | ${String(result.data?.results?.pii_detections ?? 0).padEnd(11)} |`);
    lines.push('+-------------------------+-------------+');

    // Field results table
    if (result.data?.field_results && result.data.field_results.length > 0) {
      lines.push('');
      lines.push('Field Results:');
      lines.push('+----------------------+----------------+------------+------------+');
      lines.push('| Field                | PII Type       | Strategy   | Confidence |');
      lines.push('+----------------------+----------------+------------+------------+');

      for (const field of result.data.field_results) {
        lines.push(
          `| ${(field.field_path ?? '').padEnd(20).slice(0, 20)} ` +
          `| ${(field.pii_type ?? '').padEnd(14).slice(0, 14)} ` +
          `| ${(field.strategy_applied ?? '').padEnd(10).slice(0, 10)} ` +
          `| ${((field.confidence ?? 0) * 100).toFixed(1).padStart(8)}% |`
        );
      }

      lines.push('+----------------------+----------------+------------+------------+');
    }

    return lines.join('\n');
  }

  return String(data);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, options } = parseArgs(args);

  // Initialize telemetry
  initTelemetry({
    service_name: 'llm-data-vault-cli',
    environment: 'cli',
    version: '0.1.0',
    log_level: options['verbose'] ? 'debug' : 'info',
  });

  const config: CLIConfig = {
    verbose: options['verbose'] === true || options['v'] === true,
    outputFormat: (options['format'] as CLIConfig['outputFormat']) ?? 'json',
    dryRun: options['dry-run'] === true,
    includeDetails: options['include-details'] === true,
  };

  try {
    switch (command) {
      case 'anonymize':
        await runAnonymize(options, config);
        break;

      case 'inspect':
        await runInspect(options, config);
        break;

      case 'health':
        await runHealth(config);
        break;

      case 'metadata':
        runMetadata(config);
        break;

      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "data-vault help" for usage information.');
        process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);

    if (config.verbose && error instanceof Error) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}

/**
 * Run anonymize command
 */
async function runAnonymize(
  options: Record<string, string | boolean>,
  config: CLIConfig
): Promise<void> {
  // Get content
  let content: unknown;

  if (options['content']) {
    content = JSON.parse(options['content'] as string);
  } else if (options['file']) {
    const filePath = path.resolve(options['file'] as string);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    content = JSON.parse(fileContent);
  } else {
    throw new Error('Either --content or --file is required');
  }

  const executionRef = uuidv4();
  const tenantId = (options['tenant'] as string) ?? 'cli-tenant';

  // Build request
  const request: AnonymizationRequest = {
    request_id: executionRef,
    dataset_id: 'cli-dataset',
    content: content as string | Record<string, unknown> | Record<string, unknown>[],
    content_format: 'json',
    tenant_id: tenantId,
    requester: {
      service: 'cli',
      roles: ['cli-user'],
    },
    options: {
      preserve_structure: true,
      emit_metrics: true,
      dry_run: config.dryRun,
      include_detection_details: config.includeDetails,
    },
  };

  // Add strategy if specified
  if (options['strategy']) {
    const strategy = options['strategy'] as AnonymizationStrategy;
    request.policy = {
      policy_id: uuidv4(),
      policy_version: '1.0.0',
      name: 'CLI Policy',
      default_strategy: strategy,
      field_rules: [],
      detect_pii_types: ['email', 'phone_number', 'ssn', 'credit_card', 'ip_address', 'date_of_birth', 'api_key', 'password', 'person_name', 'full_address', 'custom'],
      min_detection_confidence: 0.8,
      compliance_frameworks: [],
      emit_audit_events: true,
      retain_original_hash: true,
    };
  }

  // Add policy ID if specified
  if (options['policy']) {
    request.policy_id = options['policy'] as string;
  }

  // Create agent and execute
  const agent = createAnonymizationAgent();
  const context: ExecutionContext = {
    execution_ref: executionRef,
    tenant_id: tenantId,
    request_source: 'cli',
    timestamp: new Date().toISOString(),
  };

  const result = await agent.invoke(request, context);

  // Persist DecisionEvent if ruvector is configured
  if (process.env['RUVECTOR_SERVICE_ENDPOINT'] && process.env['RUVECTOR_SERVICE_API_KEY']) {
    try {
      const client = createRuVectorClient();
      await client.persistDecisionEvent(result.decision_event);

      if (config.verbose) {
        console.error('DecisionEvent persisted to ruvector-service');
      }
    } catch (err) {
      if (config.verbose) {
        console.error(`Warning: Failed to persist DecisionEvent: ${err}`);
      }
    }
  }

  // Format output
  const output = formatOutput(
    {
      success: result.success,
      data: result.data,
      error: result.error,
      metadata: {
        execution_ref: executionRef,
        execution_time_ms: result.execution_time_ms,
        agent_id: agent.getMetadata().agent_id,
        agent_version: agent.getMetadata().agent_version,
      },
    },
    config.outputFormat,
    config.verbose
  );

  // Write output
  if (options['output']) {
    const outputPath = path.resolve(options['output'] as string);
    fs.writeFileSync(outputPath, output, 'utf-8');
    console.error(`Output written to: ${outputPath}`);
  } else {
    console.log(output);
  }

  if (!result.success) {
    process.exit(1);
  }
}

/**
 * Run inspect command
 */
async function runInspect(
  options: Record<string, string | boolean>,
  config: CLIConfig
): Promise<void> {
  // Run anonymize with dry_run = true and include_details = true
  await runAnonymize(
    {
      ...options,
      'dry-run': true,
      'include-details': true,
    },
    {
      ...config,
      dryRun: true,
      includeDetails: true,
    }
  );
}

/**
 * Run health command
 */
async function runHealth(config: CLIConfig): Promise<void> {
  const health: {
    agent: { status: string; id: string; version: string };
    ruvector?: { status: string; latency_ms?: number; error?: string };
  } = {
    agent: {
      status: 'healthy',
      id: 'data-vault.anonymization.v1',
      version: '0.1.0',
    },
  };

  // Check ruvector if configured
  if (process.env['RUVECTOR_SERVICE_ENDPOINT'] && process.env['RUVECTOR_SERVICE_API_KEY']) {
    try {
      const client = createRuVectorClient();
      const ruvectorHealth = await client.healthCheck();
      health.ruvector = {
        status: ruvectorHealth.healthy ? 'healthy' : 'unhealthy',
        latency_ms: ruvectorHealth.latency_ms,
      };
    } catch (err) {
      health.ruvector = {
        status: 'unhealthy',
        error: String(err),
      };
    }
  } else {
    health.ruvector = {
      status: 'not_configured',
    };
  }

  console.log(formatOutput(health, config.outputFormat, config.verbose));
}

/**
 * Run metadata command
 */
function runMetadata(config: CLIConfig): void {
  const agent = createAnonymizationAgent();
  const metadata = agent.getMetadata();

  const output = {
    ...metadata,
    cli_commands: {
      anonymize: 'Apply anonymization to dataset content',
      inspect: 'Inspect content for PII without modifying',
      health: 'Check agent and service health',
      metadata: 'Show agent metadata and capabilities',
    },
    supported_strategies: [
      'redact',
      'mask',
      'hash',
      'tokenize',
      'generalize',
      'suppress',
      'pseudonymize',
    ],
    supported_pii_types: [
      'email',
      'phone_number',
      'ssn',
      'credit_card',
      'ip_address',
      'date_of_birth',
      'api_key',
      'password',
    ],
  };

  console.log(formatOutput(output, config.outputFormat, config.verbose));
}

// Run CLI
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
