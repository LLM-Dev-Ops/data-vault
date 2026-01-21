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
} from '../contracts/index.js';

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
   * Main invocation entry point
   *
   * This method:
   * 1. Validates the request
   * 2. Executes the core logic
   * 3. Validates the response
   * 4. Creates and returns a DecisionEvent
   *
   * The DecisionEvent MUST be persisted to ruvector-service by the caller.
   */
  async invoke(
    request: unknown,
    context: ExecutionContext
  ): Promise<AgentResult<TResponse>> {
    const startTime = performance.now();

    try {
      // Validate request
      const validatedRequest = this.validateRequest(request);

      // Hash inputs for auditability
      const inputsHash = await hashInputs(validatedRequest);

      // Execute core logic
      const { response, confidence, constraints } = await this.executeCore(
        validatedRequest,
        context
      );

      // Validate response
      const validatedResponse = this.validateResponse(response);

      // Create DecisionEvent
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
      });

      const executionTime = performance.now() - startTime;

      return {
        success: true,
        data: validatedResponse,
        decision_event: decisionEvent,
        execution_time_ms: executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Create failure DecisionEvent
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
