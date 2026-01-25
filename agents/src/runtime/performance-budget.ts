/**
 * LLM-Data-Vault: Performance Budget Enforcement
 *
 * Phase 7 performance budget enforcement for agent executions.
 * Ensures agents operate within defined resource constraints.
 *
 * BUDGETS:
 * - MAX_TOKENS: 2500 (max tokens per response if applicable)
 * - MAX_LATENCY_MS: 5000 (max execution time)
 * - MAX_CALLS_PER_RUN: 5 (max external service calls per execution)
 *
 * @module runtime/performance-budget
 */

import {
  DecisionEvent,
  createDecisionEvent,
  AppliedConstraint,
} from '../contracts/index.js';

/**
 * Performance budget configuration
 */
export interface PerformanceBudget {
  /** Maximum execution latency in milliseconds */
  maxLatencyMs: number;
  /** Maximum external service calls per execution */
  maxCallsPerRun: number;
  /** Maximum tokens per response (if applicable) */
  maxTokens: number;
}

/**
 * Default performance budgets for Phase 7 agents
 */
export const DEFAULT_BUDGETS: PerformanceBudget = {
  maxLatencyMs: 5000,
  maxCallsPerRun: 5,
  maxTokens: 2500,
};

/**
 * Budget violation reason
 */
export type BudgetViolationReason =
  | 'latency_exceeded'
  | 'calls_exceeded'
  | 'tokens_exceeded';

/**
 * Budget check result
 */
export interface BudgetCheckResult {
  withinBudget: boolean;
  violation?: {
    reason: BudgetViolationReason;
    limit: number;
    actual: number;
    message: string;
  };
}

/**
 * Budget enforcer metrics
 */
export interface BudgetMetrics {
  callCount: number;
  startTime: number;
  tokenCount: number;
}

/**
 * Budget enforcement error
 */
export class BudgetExceededError extends Error {
  public readonly reason: BudgetViolationReason;
  public readonly limit: number;
  public readonly actual: number;

  constructor(reason: BudgetViolationReason, limit: number, actual: number) {
    const messages: Record<BudgetViolationReason, string> = {
      latency_exceeded: `Execution time ${actual}ms exceeded budget of ${limit}ms`,
      calls_exceeded: `External calls ${actual} exceeded budget of ${limit}`,
      tokens_exceeded: `Token count ${actual} exceeded budget of ${limit}`,
    };
    super(messages[reason]);
    this.name = 'BudgetExceededError';
    this.reason = reason;
    this.limit = limit;
    this.actual = actual;
  }
}

/**
 * Performance budget enforcer
 *
 * Tracks and enforces performance budgets during agent execution.
 * Aborts execution if any budget is exceeded.
 */
export class BudgetEnforcer {
  private readonly budget: PerformanceBudget;
  private callCount: number = 0;
  private tokenCount: number = 0;
  private readonly startTime: number;
  private aborted: boolean = false;
  private abortReason?: BudgetViolationReason;

  constructor(budget: PerformanceBudget = DEFAULT_BUDGETS) {
    this.budget = { ...budget };
    this.startTime = performance.now();
  }

  /**
   * Get current budget configuration
   */
  getBudget(): PerformanceBudget {
    return { ...this.budget };
  }

  /**
   * Get current metrics
   */
  getMetrics(): BudgetMetrics {
    return {
      callCount: this.callCount,
      startTime: this.startTime,
      tokenCount: this.tokenCount,
    };
  }

  /**
   * Check if execution has been aborted
   */
  isAborted(): boolean {
    return this.aborted;
  }

  /**
   * Get abort reason if aborted
   */
  getAbortReason(): BudgetViolationReason | undefined {
    return this.abortReason;
  }

  /**
   * Record an external service call
   * @throws {BudgetExceededError} if calls budget exceeded
   */
  recordCall(): void {
    if (this.aborted) {
      throw new BudgetExceededError(
        this.abortReason!,
        this.getLimitForReason(this.abortReason!),
        this.getActualForReason(this.abortReason!)
      );
    }

    this.callCount++;
    if (this.callCount > this.budget.maxCallsPerRun) {
      this.aborted = true;
      this.abortReason = 'calls_exceeded';
      throw new BudgetExceededError(
        'calls_exceeded',
        this.budget.maxCallsPerRun,
        this.callCount
      );
    }
  }

  /**
   * Record token usage
   * @throws {BudgetExceededError} if token budget exceeded
   */
  recordTokens(count: number): void {
    if (this.aborted) {
      throw new BudgetExceededError(
        this.abortReason!,
        this.getLimitForReason(this.abortReason!),
        this.getActualForReason(this.abortReason!)
      );
    }

    this.tokenCount += count;
    if (this.tokenCount > this.budget.maxTokens) {
      this.aborted = true;
      this.abortReason = 'tokens_exceeded';
      throw new BudgetExceededError(
        'tokens_exceeded',
        this.budget.maxTokens,
        this.tokenCount
      );
    }
  }

  /**
   * Check current latency against budget
   * @throws {BudgetExceededError} if latency budget exceeded
   */
  checkLatency(): void {
    if (this.aborted) {
      throw new BudgetExceededError(
        this.abortReason!,
        this.getLimitForReason(this.abortReason!),
        this.getActualForReason(this.abortReason!)
      );
    }

    const elapsed = performance.now() - this.startTime;
    if (elapsed > this.budget.maxLatencyMs) {
      this.aborted = true;
      this.abortReason = 'latency_exceeded';
      throw new BudgetExceededError(
        'latency_exceeded',
        this.budget.maxLatencyMs,
        Math.round(elapsed)
      );
    }
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedMs(): number {
    return performance.now() - this.startTime;
  }

  /**
   * Check all budgets without throwing
   */
  checkAll(): BudgetCheckResult {
    const elapsed = Math.round(performance.now() - this.startTime);

    // Check latency
    if (elapsed > this.budget.maxLatencyMs) {
      return {
        withinBudget: false,
        violation: {
          reason: 'latency_exceeded',
          limit: this.budget.maxLatencyMs,
          actual: elapsed,
          message: `Execution time ${elapsed}ms exceeded budget of ${this.budget.maxLatencyMs}ms`,
        },
      };
    }

    // Check calls
    if (this.callCount > this.budget.maxCallsPerRun) {
      return {
        withinBudget: false,
        violation: {
          reason: 'calls_exceeded',
          limit: this.budget.maxCallsPerRun,
          actual: this.callCount,
          message: `External calls ${this.callCount} exceeded budget of ${this.budget.maxCallsPerRun}`,
        },
      };
    }

    // Check tokens
    if (this.tokenCount > this.budget.maxTokens) {
      return {
        withinBudget: false,
        violation: {
          reason: 'tokens_exceeded',
          limit: this.budget.maxTokens,
          actual: this.tokenCount,
          message: `Token count ${this.tokenCount} exceeded budget of ${this.budget.maxTokens}`,
        },
      };
    }

    return { withinBudget: true };
  }

  /**
   * Create an abort DecisionEvent for budget exceeded
   */
  createAbortEvent(params: {
    agentId: string;
    agentVersion: string;
    inputsHash: string;
    executionRef: string;
    correlationId?: string;
    tenantId?: string;
    requestSource?: 'orchestrator' | 'inference_gateway' | 'policy_engine' | 'governance' | 'cli' | 'api';
  }): DecisionEvent {
    const result = this.checkAll();
    const violation = result.violation;

    const constraint: AppliedConstraint = {
      type: 'budget_exceeded',
      description: violation?.message ?? 'Performance budget exceeded',
      severity: 'error',
      metadata: violation
        ? {
            reason: violation.reason,
            limit: violation.limit,
            actual: violation.actual,
          }
        : undefined,
    };

    return createDecisionEvent({
      agent_id: params.agentId,
      agent_version: params.agentVersion,
      decision_type: 'execution_aborted',
      inputs_hash: params.inputsHash,
      outputs: {
        aborted: true,
        reason: violation?.reason ?? 'budget_exceeded',
        budget_limit: violation?.limit,
        budget_actual: violation?.actual,
        execution_time_ms: Math.round(this.getElapsedMs()),
      },
      confidence: { policy_match: 0 },
      constraints_applied: [constraint],
      execution_ref: params.executionRef,
      correlation_id: params.correlationId,
      tenant_id: params.tenantId,
      request_source: params.requestSource,
    });
  }

  /**
   * Wrap an async operation with latency checking
   */
  async withLatencyCheck<T>(operation: () => Promise<T>): Promise<T> {
    this.checkLatency();
    const result = await operation();
    this.checkLatency();
    return result;
  }

  /**
   * Wrap an external call with budget tracking
   */
  async trackCall<T>(operation: () => Promise<T>): Promise<T> {
    this.recordCall();
    this.checkLatency();
    const result = await operation();
    this.checkLatency();
    return result;
  }

  private getLimitForReason(reason: BudgetViolationReason): number {
    switch (reason) {
      case 'latency_exceeded':
        return this.budget.maxLatencyMs;
      case 'calls_exceeded':
        return this.budget.maxCallsPerRun;
      case 'tokens_exceeded':
        return this.budget.maxTokens;
    }
  }

  private getActualForReason(reason: BudgetViolationReason): number {
    switch (reason) {
      case 'latency_exceeded':
        return Math.round(this.getElapsedMs());
      case 'calls_exceeded':
        return this.callCount;
      case 'tokens_exceeded':
        return this.tokenCount;
    }
  }
}

/**
 * Create a budget enforcer with custom limits
 */
export function createBudgetEnforcer(
  overrides: Partial<PerformanceBudget> = {}
): BudgetEnforcer {
  return new BudgetEnforcer({
    ...DEFAULT_BUDGETS,
    ...overrides,
  });
}
