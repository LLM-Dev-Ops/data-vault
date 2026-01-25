/**
 * LLM-Data-Vault: Agent Base Infrastructure
 *
 * Base types and interfaces for all Data-Vault agents.
 * All agents MUST extend this base to ensure compliance with
 * the Data-Vault constitutional requirements.
 *
 * @module runtime/agent-base
 */

import { z } from 'zod';
import {
  DecisionEvent,
  createDecisionEvent,
  DecisionType,
  AppliedConstraint,
  ConfidenceBreakdown,
  getPhase7Identity,
} from '../contracts/index.js';
import {
  BudgetEnforcer,
  BudgetExceededError,
  PerformanceBudget,
  DEFAULT_BUDGETS,
} from './performance-budget.js';

/**
 * Agent classification - determines what operations are allowed
 */
export type AgentClassification =
  | 'DATA_ACCESS_CONTROL'
  | 'DATASET_ANONYMIZATION';

/**
 * Agent metadata
 */
export interface AgentMetadata {
  agent_id: string;
  agent_version: string;
  classification: AgentClassification;
  name: string;
  description: string;
  supported_operations: string[];
}

/**
 * Agent execution context
 */
export interface ExecutionContext {
  execution_ref: string;
  correlation_id?: string;
  parent_execution_ref?: string;
  tenant_id?: string;
  request_source?: 'orchestrator' | 'inference_gateway' | 'policy_engine' | 'governance' | 'cli' | 'api';
  timestamp: string;
}

/**
 * Agent invocation result
 */
export interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  decision_event: DecisionEvent;
  execution_time_ms: number;
}

/**
 * Hash inputs for auditability
 */
export async function hashInputs(inputs: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(inputs, Object.keys(inputs as object).sort()));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Abstract base class for all Data-Vault agents
 *
 * CONSTITUTIONAL REQUIREMENTS:
 * - Agents MUST be stateless at runtime
 * - Agents MUST emit exactly ONE DecisionEvent per invocation
 * - Agents MUST NOT connect directly to databases
 * - Agents MUST NOT execute model inference
 * - Agents MUST NOT modify prompts or responses
 * - Agents MUST NOT route inference requests
 */
export abstract class DataVaultAgent<TRequest, TResponse> {
  protected readonly metadata: AgentMetadata;

  constructor(metadata: AgentMetadata) {
    this.metadata = metadata;
    this.validateMetadata(metadata);
  }

  /**
   * Validate agent metadata
   */
  private validateMetadata(metadata: AgentMetadata): void {
    if (!metadata.agent_id) {
      throw new Error('Agent ID is required');
    }
    if (!/^\d+\.\d+\.\d+$/.test(metadata.agent_version)) {
      throw new Error('Agent version must be semver format (x.y.z)');
    }
    if (!['DATA_ACCESS_CONTROL', 'DATASET_ANONYMIZATION'].includes(metadata.classification)) {
      throw new Error('Invalid agent classification');
    }
  }

  /**
   * Get agent metadata
   */
  getMetadata(): AgentMetadata {
    return { ...this.metadata };
  }

  /**
   * Validate request against schema
   */
  protected abstract validateRequest(request: unknown): TRequest;

  /**
   * Validate response against schema
   */
  protected abstract validateResponse(response: unknown): TResponse;

  /**
   * Get the decision type for this agent
   */
  protected abstract getDecisionType(): DecisionType;

  /**
   * Execute the agent's core logic
   */
  protected abstract executeCore(
    request: TRequest,
    context: ExecutionContext
  ): Promise<{
    response: TResponse;
    confidence: ConfidenceBreakdown;
    constraints: AppliedConstraint[];
  }>;

  /**
   * Get performance budget for this agent
   * Override to customize budgets for specific agents
   */
  protected getPerformanceBudget(): PerformanceBudget {
    return DEFAULT_BUDGETS;
  }

  /**
   * Main invocation entry point
   *
   * This method:
   * 1. Initializes budget enforcer
   * 2. Validates the request
   * 3. Executes the core logic with budget checks
   * 4. Validates the response
   * 5. Creates and returns a DecisionEvent
   *
   * BUDGET ENFORCEMENT (Phase 7):
   * - Execution time is checked against MAX_LATENCY_MS (5000ms)
   * - If budget exceeded, execution is ABORTED with execution_aborted event
   * - NO automatic retries on budget exceeded
   *
   * The DecisionEvent MUST be persisted to ruvector-service by the caller.
   */
  async invoke(
    request: unknown,
    context: ExecutionContext
  ): Promise<AgentResult<TResponse>> {
    // Initialize budget enforcer for this execution
    const budgetEnforcer = new BudgetEnforcer(this.getPerformanceBudget());

    try {
      // Validate request
      const validatedRequest = this.validateRequest(request);

      // Check budget after validation
      budgetEnforcer.checkLatency();

      // Hash inputs for auditability
      const inputsHash = await hashInputs(validatedRequest);

      // Check budget after hashing
      budgetEnforcer.checkLatency();

      // Execute core logic with budget wrapper
      const { response, confidence, constraints } = await budgetEnforcer.withLatencyCheck(
        () => this.executeCore(validatedRequest, context)
      );

      // Check budget after core execution
      budgetEnforcer.checkLatency();

      // Validate response
      const validatedResponse = this.validateResponse(response);

      // Final budget check before creating event
      budgetEnforcer.checkLatency();

      // Create DecisionEvent with Phase 7 identity
      const decisionEvent = createDecisionEvent({
        agent_id: this.metadata.agent_id,
        agent_version: this.metadata.agent_version,
        decision_type: this.getDecisionType(),
        inputs_hash: inputsHash,
        outputs: validatedResponse as Record<string, unknown>,
        confidence,
        constraints_applied: constraints,
        execution_ref: context.execution_ref,
        correlation_id: context.correlation_id,
        parent_execution_ref: context.parent_execution_ref,
        tenant_id: context.tenant_id,
        request_source: context.request_source,
        phase7_identity: getPhase7Identity(
          this.metadata.agent_id,
          this.metadata.agent_version
        ),
      });

      const executionTime = budgetEnforcer.getElapsedMs();

      return {
        success: true,
        data: validatedResponse,
        decision_event: decisionEvent,
        execution_time_ms: executionTime,
      };
    } catch (error) {
      const executionTime = budgetEnforcer.getElapsedMs();

      // Handle budget exceeded errors specially
      if (error instanceof BudgetExceededError) {
        const inputsHash = await hashInputs(request).catch(() => 'hash-failed-' + Date.now());

        // Create abort DecisionEvent for budget exceeded
        const decisionEvent = budgetEnforcer.createAbortEvent({
          agentId: this.metadata.agent_id,
          agentVersion: this.metadata.agent_version,
          inputsHash,
          executionRef: context.execution_ref,
          correlationId: context.correlation_id,
          tenantId: context.tenant_id,
          requestSource: context.request_source,
        });

        return {
          success: false,
          error: {
            code: 'BUDGET_EXCEEDED',
            message: error.message,
            details: {
              reason: error.reason,
              limit: error.limit,
              actual: error.actual,
            },
          },
          decision_event: decisionEvent,
          execution_time_ms: executionTime,
        };
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Create failure DecisionEvent with Phase 7 identity
      const decisionEvent = createDecisionEvent({
        agent_id: this.metadata.agent_id,
        agent_version: this.metadata.agent_version,
        decision_type: this.getDecisionType(),
        inputs_hash: await hashInputs(request),
        outputs: { error: errorMessage },
        confidence: { policy_match: 0 },
        constraints_applied: [{
          type: 'permission_denied',
          description: `Agent execution failed: ${errorMessage}`,
          severity: 'error',
        }],
        execution_ref: context.execution_ref,
        correlation_id: context.correlation_id,
        tenant_id: context.tenant_id,
        request_source: context.request_source,
        phase7_identity: getPhase7Identity(
          this.metadata.agent_id,
          this.metadata.agent_version
        ),
      });

      return {
        success: false,
        error: {
          code: 'AGENT_EXECUTION_ERROR',
          message: errorMessage,
          details: error instanceof z.ZodError ? error.errors : undefined,
        },
        decision_event: decisionEvent,
        execution_time_ms: executionTime,
      };
    }
  }

  /**
   * PROHIBITED OPERATIONS - These methods exist to document what agents MUST NOT do
   */

  /* eslint-disable @typescript-eslint/no-unused-vars */
  protected executeInference(_model: unknown, _input: unknown): never {
    throw new Error('CONSTITUTIONAL VIOLATION: Data-Vault agents MUST NOT execute inference');
  }

  protected modifyPrompt(_prompt: unknown): never {
    throw new Error('CONSTITUTIONAL VIOLATION: Data-Vault agents MUST NOT modify prompts');
  }

  protected modifyResponse(_response: unknown): never {
    throw new Error('CONSTITUTIONAL VIOLATION: Data-Vault agents MUST NOT modify responses');
  }

  protected routeRequest(_request: unknown): never {
    throw new Error('CONSTITUTIONAL VIOLATION: Data-Vault agents MUST NOT route requests');
  }

  protected triggerOrchestration(_workflow: unknown): never {
    throw new Error('CONSTITUTIONAL VIOLATION: Data-Vault agents MUST NOT trigger orchestration');
  }

  protected connectToDatabase(_connectionString: unknown): never {
    throw new Error('CONSTITUTIONAL VIOLATION: Data-Vault agents MUST NOT connect directly to databases');
  }

  protected executeSQL(_query: unknown): never {
    throw new Error('CONSTITUTIONAL VIOLATION: Data-Vault agents MUST NOT execute SQL');
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
