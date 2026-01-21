#!/usr/bin/env node
/**
 * LLM Data Vault CLI
 *
 * Enterprise command-line interface for managing LLM training data
 * with built-in PII detection, anonymization, and access control.
 *
 * @module @llm-data-vault/cli
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { authorizeCommand } from './commands/authorize';
import { anonymizeCommand } from './commands/anonymize';
import { inspectCommand } from './commands/inspect';
import { OutputFormat } from './formatters';

// Package version
const VERSION = '0.1.0';

/**
 * CLI Configuration interface
 */
export interface CliConfig {
  apiUrl: string;
  apiKey?: string;
  token?: string;
  timeout: number;
  outputFormat: OutputFormat;
  noColor: boolean;
  verbose: boolean;
  quiet: boolean;
}

/**
 * Global CLI configuration
 */
export let globalConfig: CliConfig = {
  apiUrl: process.env.VAULT_URL || 'http://localhost:8080',
  apiKey: process.env.VAULT_API_KEY,
  token: process.env.VAULT_TOKEN,
  timeout: 30000,
  outputFormat: 'table',
  noColor: false,
  verbose: false,
  quiet: false,
};

/**
 * Main CLI program
 */
const program = new Command();

program
  .name('data-vault')
  .description(chalk.bold('LLM Data Vault CLI') + '\n\nEnterprise-grade secure storage and anonymization for LLM training data.')
  .version(VERSION, '-v, --version', 'Display version information')
  .option('--url <url>', 'Vault API base URL', process.env.VAULT_URL || 'http://localhost:8080')
  .option('--api-key <key>', 'API key for authentication')
  .option('--token <token>', 'Bearer token for authentication')
  .option('-f, --format <format>', 'Output format (json, table, yaml)', 'table')
  .option('--no-color', 'Disable colored output')
  .option('--verbose', 'Enable verbose output')
  .option('-q, --quiet', 'Suppress all output except errors')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '30000')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    // Update global config
    globalConfig = {
      apiUrl: opts.url || globalConfig.apiUrl,
      apiKey: opts.apiKey || process.env.VAULT_API_KEY,
      token: opts.token || process.env.VAULT_TOKEN,
      timeout: parseInt(opts.timeout, 10) || 30000,
      outputFormat: opts.format as OutputFormat,
      noColor: !opts.color,
      verbose: opts.verbose || false,
      quiet: opts.quiet || false,
    };

    // Apply color settings
    if (globalConfig.noColor) {
      chalk.level = 0;
    }
  });

// Register commands
program.addCommand(authorizeCommand);
program.addCommand(anonymizeCommand);
program.addCommand(inspectCommand);

/**
 * Health check command
 */
program
  .command('health')
  .description('Check vault service health and connectivity')
  .option('-d, --detailed', 'Show detailed component status')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    const spinner = globalConfig.quiet ? null : ora('Checking health...').start();

    try {
      // Simulated health check - in production, call the actual API
      const health = await checkHealth(globalConfig, options.detailed);

      if (spinner) spinner.stop();

      if (options.json || globalConfig.outputFormat === 'json') {
        console.log(JSON.stringify(health, null, 2));
      } else {
        printHealthStatus(health, options.detailed);
      }

      if (health.status === 'unhealthy') {
        process.exit(1);
      }
    } catch (error) {
      if (spinner) spinner.fail('Health check failed');
      handleError(error);
    }
  });

/**
 * Version command with detailed info
 */
program
  .command('version')
  .description('Display CLI version and build information')
  .action(() => {
    console.log(`${chalk.bold('data-vault')} ${VERSION}`);
    console.log();
    console.log(chalk.dim('Build info:'));
    console.log(`  Platform: ${process.platform}`);
    console.log(`  Arch: ${process.arch}`);
    console.log(`  Node: ${process.version}`);
    console.log();
    console.log(chalk.dim('Environment:'));
    console.log(`  VAULT_URL: ${process.env.VAULT_URL || '(not set)'}`);
    console.log(`  VAULT_API_KEY: ${process.env.VAULT_API_KEY ? '(set)' : '(not set)'}`);
    console.log(`  VAULT_TOKEN: ${process.env.VAULT_TOKEN ? '(set)' : '(not set)'}`);
  });

/**
 * Health check response interface
 */
interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  components: HealthComponent[];
}

interface HealthComponent {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  message?: string;
}

/**
 * Check health status
 */
async function checkHealth(_config: CliConfig, detailed: boolean): Promise<HealthResponse> {
  // In production, this would make an actual HTTP request to the API
  // For now, return a simulated response
  const startTime = Date.now();

  try {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 100));

    const response: HealthResponse = {
      status: 'healthy',
      version: VERSION,
      timestamp: new Date().toISOString(),
      components: detailed ? [
        { name: 'api', status: 'healthy', latencyMs: Date.now() - startTime },
        { name: 'database', status: 'healthy', latencyMs: 5 },
        { name: 'encryption', status: 'healthy', latencyMs: 1 },
        { name: 'pii-detector', status: 'healthy', latencyMs: 2 },
        { name: 'anonymizer', status: 'healthy', latencyMs: 1 },
      ] : [],
    };

    return response;
  } catch (error) {
    return {
      status: 'unhealthy',
      version: VERSION,
      timestamp: new Date().toISOString(),
      components: [],
    };
  }
}

/**
 * Print health status
 */
function printHealthStatus(health: HealthResponse, detailed: boolean): void {
  const statusColors: Record<string, (text: string) => string> = {
    healthy: chalk.green,
    degraded: chalk.yellow,
    unhealthy: chalk.red,
  };

  const statusColor = statusColors[health.status] || chalk.white;

  console.log(chalk.bold.underline('LLM Data Vault Health'));
  console.log();
  console.log(`  Status:   ${statusColor(health.status.toUpperCase())}`);
  console.log(`  Version:  ${health.version}`);
  console.log(`  Time:     ${health.timestamp}`);

  if (detailed && health.components.length > 0) {
    console.log();
    console.log(chalk.bold('Components:'));

    for (const component of health.components) {
      const icon = component.status === 'healthy' ? chalk.green('✓') :
                   component.status === 'degraded' ? chalk.yellow('!') :
                   chalk.red('✗');

      let line = `  ${icon} ${component.name.padEnd(20)}`;

      if (component.latencyMs !== undefined) {
        line += ` ${component.latencyMs.toString().padStart(6)}ms`;
      }

      if (component.message) {
        line += `  ${chalk.dim(component.message)}`;
      }

      console.log(line);
    }
  }
}

/**
 * Error handler
 */
function handleError(error: unknown): void {
  if (error instanceof Error) {
    if (globalConfig.verbose) {
      console.error(chalk.red('Error:'), error.message);
      console.error(chalk.dim(error.stack));
    } else if (!globalConfig.quiet) {
      console.error(chalk.red('Error:'), error.message);
    }
  } else {
    console.error(chalk.red('Error:'), String(error));
  }
  process.exit(1);
}

// Parse and execute
program.parse(process.argv);

// Show help if no command provided
if (process.argv.length === 2) {
  program.outputHelp();
}

export { program };
