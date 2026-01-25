/**
 * LLM-Data-Vault: Agent Runtime
 *
 * Runtime infrastructure exports for Data-Vault agents.
 *
 * @module runtime
 */

export {
  DataVaultAgent,
  hashInputs,
} from './agent-base.js';

export type {
  AgentMetadata,
  ExecutionContext,
  AgentResult,
  AgentClassification,
} from './agent-base.js';

// Performance budget enforcement (Phase 7)
export {
  BudgetEnforcer,
  BudgetExceededError,
  DEFAULT_BUDGETS,
  createBudgetEnforcer,
} from './performance-budget.js';

export type {
  PerformanceBudget,
  BudgetViolationReason,
  BudgetCheckResult,
  BudgetMetrics,
} from './performance-budget.js';
