/**
 * Authorization Command
 *
 * Invokes the Data Access Control Agent to evaluate authorization requests
 * for dataset access based on policies, roles, and context.
 *
 * @module @llm-data-vault/cli/commands/authorize
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { globalConfig } from '../cli';
import { formatOutput, OutputFormat, createTable } from '../formatters';

/**
 * Authorization request interface
 */
export interface AuthorizationRequest {
  datasetId: string;
  requesterId: string;
  action: 'read' | 'write' | 'delete' | 'admin';
  context?: Record<string, unknown>;
  purpose?: string;
  dataCategory?: string;
  sensitivity?: 'public' | 'internal' | 'confidential' | 'restricted';
}

/**
 * Authorization response interface
 */
export interface AuthorizationResponse {
  allowed: boolean;
  decision: 'permit' | 'deny' | 'indeterminate' | 'not_applicable';
  reason: string;
  policies: PolicyMatch[];
  obligations: Obligation[];
  advice: Advice[];
  requestId: string;
  evaluatedAt: string;
  processingTimeMs: number;
}

/**
 * Policy match information
 */
export interface PolicyMatch {
  policyId: string;
  policyName: string;
  effect: 'permit' | 'deny';
  matched: boolean;
  priority: number;
}

/**
 * Obligation to be fulfilled
 */
export interface Obligation {
  id: string;
  type: 'log' | 'notify' | 'encrypt' | 'anonymize' | 'custom';
  description: string;
  parameters?: Record<string, unknown>;
}

/**
 * Advisory information
 */
export interface Advice {
  id: string;
  category: string;
  message: string;
}

/**
 * Data Access Control Agent interface
 */
interface DataAccessControlAgent {
  evaluate(request: AuthorizationRequest): Promise<AuthorizationResponse>;
}

/**
 * Create a mock Data Access Control Agent
 * In production, this would connect to the actual agent service
 */
function createDataAccessControlAgent(): DataAccessControlAgent {
  return {
    async evaluate(request: AuthorizationRequest): Promise<AuthorizationResponse> {
      const startTime = Date.now();

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));

      // Evaluate request based on mock policies
      const policies: PolicyMatch[] = [
        {
          policyId: 'pol_default_read',
          policyName: 'Default Read Access',
          effect: 'permit',
          matched: request.action === 'read',
          priority: 100,
        },
        {
          policyId: 'pol_admin_only',
          policyName: 'Admin Only Operations',
          effect: 'deny',
          matched: request.action === 'admin' && !request.requesterId.includes('admin'),
          priority: 200,
        },
        {
          policyId: 'pol_pii_protection',
          policyName: 'PII Data Protection',
          effect: 'permit',
          matched: request.sensitivity === 'restricted',
          priority: 150,
        },
      ];

      // Determine decision based on matched policies
      const matchedPolicies = policies.filter(p => p.matched).sort((a, b) => b.priority - a.priority);
      const decision: 'permit' | 'deny' | 'indeterminate' | 'not_applicable' =
        matchedPolicies.length > 0 && matchedPolicies[0] ? matchedPolicies[0].effect : 'not_applicable';
      const allowed = decision === 'permit';

      // Generate obligations based on action and sensitivity
      const obligations: Obligation[] = [];
      if (request.action === 'read' || request.action === 'write') {
        obligations.push({
          id: 'obl_audit_log',
          type: 'log',
          description: 'Record access in audit log',
          parameters: { datasetId: request.datasetId, action: request.action },
        });
      }
      if (request.sensitivity === 'restricted' || request.sensitivity === 'confidential') {
        obligations.push({
          id: 'obl_anonymize_export',
          type: 'anonymize',
          description: 'Anonymize PII before export',
          parameters: { strategy: 'redact' },
        });
      }

      // Generate advice
      const advice: Advice[] = [];
      if (request.action === 'delete') {
        advice.push({
          id: 'adv_backup_reminder',
          category: 'data-protection',
          message: 'Consider creating a backup before deletion',
        });
      }
      if (!allowed) {
        advice.push({
          id: 'adv_permission_request',
          category: 'access-control',
          message: 'Contact data owner or admin for elevated permissions',
        });
      }

      const reason = allowed
        ? `Access granted by policy: ${matchedPolicies[0]?.policyName || 'default'}`
        : matchedPolicies.length > 0
          ? `Access denied by policy: ${matchedPolicies[0]?.policyName}`
          : 'No applicable policies found';

      return {
        allowed,
        decision,
        reason,
        policies,
        obligations,
        advice,
        requestId: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        evaluatedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      };
    },
  };
}

/**
 * Authorize command
 */
export const authorizeCommand = new Command('authorize')
  .description('Evaluate authorization request using Data Access Control Agent')
  .requiredOption('--dataset-id <id>', 'Dataset ID to authorize access for')
  .requiredOption('--requester-id <id>', 'ID of the requester (user or service)')
  .requiredOption('--action <action>', 'Action to authorize (read, write, delete, admin)')
  .option('--context <json>', 'Additional context as JSON string', '{}')
  .option('--purpose <purpose>', 'Purpose of access (e.g., training, analytics, export)')
  .option('--data-category <category>', 'Data category (e.g., user-data, financial, health)')
  .option('--sensitivity <level>', 'Data sensitivity level (public, internal, confidential, restricted)')
  .option('--output <format>', 'Output format (json, table, yaml)', 'table')
  .option('--show-policies', 'Show matched policy details')
  .option('--show-obligations', 'Show obligations to be fulfilled')
  .addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.dim('# Basic authorization check')}
  $ data-vault authorize --dataset-id ds_123 --requester-id user_456 --action read

  ${chalk.dim('# Authorization with context')}
  $ data-vault authorize --dataset-id ds_123 --requester-id svc_ml --action write \\
      --context '{"environment": "production", "ipAddress": "10.0.0.1"}'

  ${chalk.dim('# Check with full policy details')}
  $ data-vault authorize --dataset-id ds_123 --requester-id user_456 --action read \\
      --purpose training --sensitivity confidential --show-policies --show-obligations

  ${chalk.dim('# JSON output for automation')}
  $ data-vault authorize --dataset-id ds_123 --requester-id user_456 --action delete \\
      --output json
`)
  .action(async (options) => {
    const spinner = globalConfig?.quiet ? null : ora('Evaluating authorization...').start();

    try {
      // Parse context JSON
      let context: Record<string, unknown> = {};
      try {
        context = JSON.parse(options.context);
      } catch {
        throw new Error('Invalid JSON in --context parameter');
      }

      // Validate action
      const validActions = ['read', 'write', 'delete', 'admin'];
      if (!validActions.includes(options.action)) {
        throw new Error(`Invalid action: ${options.action}. Must be one of: ${validActions.join(', ')}`);
      }

      // Validate sensitivity if provided
      if (options.sensitivity) {
        const validSensitivity = ['public', 'internal', 'confidential', 'restricted'];
        if (!validSensitivity.includes(options.sensitivity)) {
          throw new Error(`Invalid sensitivity: ${options.sensitivity}. Must be one of: ${validSensitivity.join(', ')}`);
        }
      }

      // Build authorization request
      const request: AuthorizationRequest = {
        datasetId: options.datasetId,
        requesterId: options.requesterId,
        action: options.action as 'read' | 'write' | 'delete' | 'admin',
        context,
        purpose: options.purpose,
        dataCategory: options.dataCategory,
        sensitivity: options.sensitivity as 'public' | 'internal' | 'confidential' | 'restricted' | undefined,
      };

      // Create agent and evaluate
      const agent = createDataAccessControlAgent();
      const response = await agent.evaluate(request);

      if (spinner) spinner.stop();

      // Format and output response
      const outputFormat = (options.output || globalConfig?.outputFormat || 'table') as OutputFormat;

      if (outputFormat === 'json') {
        console.log(JSON.stringify(response, null, 2));
      } else if (outputFormat === 'yaml') {
        console.log(formatOutput(response, 'yaml'));
      } else {
        printAuthorizationResult(response, options.showPolicies, options.showObligations);
      }

      // Exit with error code if denied
      if (!response.allowed) {
        process.exit(1);
      }
    } catch (error) {
      if (spinner) spinner.fail('Authorization evaluation failed');
      if (error instanceof Error) {
        console.error(chalk.red('Error:'), error.message);
      } else {
        console.error(chalk.red('Error:'), String(error));
      }
      process.exit(1);
    }
  });

/**
 * Print authorization result in table format
 */
function printAuthorizationResult(
  response: AuthorizationResponse,
  showPolicies: boolean,
  showObligations: boolean
): void {
  // Decision header
  console.log(chalk.bold.underline('Authorization Result'));
  console.log();

  // Main decision
  const decisionIcon = response.allowed ? chalk.green('✓ ALLOWED') : chalk.red('✗ DENIED');
  console.log(`  Decision:    ${decisionIcon}`);
  console.log(`  Reason:      ${response.reason}`);
  console.log(`  Request ID:  ${chalk.dim(response.requestId)}`);
  console.log(`  Evaluated:   ${response.evaluatedAt}`);
  console.log(`  Processing:  ${response.processingTimeMs}ms`);

  // Policies
  if (showPolicies && response.policies.length > 0) {
    console.log();
    console.log(chalk.bold('Matched Policies:'));

    const table = createTable(['Policy ID', 'Name', 'Effect', 'Priority', 'Matched']);

    for (const policy of response.policies) {
      const effectColor = policy.effect === 'permit' ? chalk.green : chalk.red;
      const matchedColor = policy.matched ? chalk.green('yes') : chalk.dim('no');

      table.push([
        policy.policyId,
        policy.policyName,
        effectColor(policy.effect),
        policy.priority.toString(),
        matchedColor,
      ]);
    }

    console.log(table.toString());
  }

  // Obligations
  if (showObligations && response.obligations.length > 0) {
    console.log();
    console.log(chalk.bold('Obligations:'));

    for (const obligation of response.obligations) {
      console.log(`  ${chalk.yellow('!')} [${obligation.type}] ${obligation.description}`);
      if (obligation.parameters) {
        console.log(`    ${chalk.dim(JSON.stringify(obligation.parameters))}`);
      }
    }
  }

  // Advice
  if (response.advice.length > 0) {
    console.log();
    console.log(chalk.bold('Advice:'));

    for (const advice of response.advice) {
      console.log(`  ${chalk.cyan('i')} [${advice.category}] ${advice.message}`);
    }
  }
}

export default authorizeCommand;
