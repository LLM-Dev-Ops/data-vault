/**
 * @fileoverview Agentics Execution Context for Data-Vault Agents
 * @module execution
 *
 * Provides execution span management for the Agentics execution system.
 * Every agent invocation MUST produce agent-level spans nested under
 * a repo-level span. Execution is INVALID without agent spans.
 *
 * Invariant: Core -> Repo (data-vault) -> Agent (one or more)
 */

import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// Constants
// =============================================================================

const REPO_NAME = 'data-vault';

// =============================================================================
// Types
// =============================================================================

/** Span status */
export type SpanStatus = 'RUNNING' | 'OK' | 'FAILED';

/**
 * Execution context provided by the calling Core.
 */
export interface ExecutionContext {
  readonly execution_id: string;
  readonly parent_span_id: string;
}

/**
 * Artifact reference attached to an agent span.
 */
export interface ArtifactRef {
  readonly id: string;
  readonly type: string;
  readonly uri?: string;
  readonly hash?: string;
}

/**
 * Repo-level execution span.
 */
export interface RepoSpan {
  readonly type: 'repo';
  readonly repo_name: string;
  readonly span_id: string;
  readonly parent_span_id: string;
  readonly start_time: string;
  end_time?: string;
  status: SpanStatus;
  failure_reasons?: string[];
}

/**
 * Agent-level execution span.
 */
export interface AgentSpan {
  readonly type: 'agent';
  readonly agent_name: string;
  readonly repo_name: string;
  readonly span_id: string;
  readonly parent_span_id: string;
  readonly start_time: string;
  end_time?: string;
  status: SpanStatus;
  failure_reasons?: string[];
  artifacts: ArtifactRef[];
}

/**
 * Finalized execution graph output.
 */
export interface ExecutionGraphOutput {
  readonly repo_span: RepoSpan;
  readonly agent_spans: AgentSpan[];
}

// =============================================================================
// Header Constants
// =============================================================================

export const EXECUTION_HEADERS = {
  EXECUTION_ID: 'x-execution-id',
  PARENT_SPAN_ID: 'x-parent-span-id',
} as const;

// =============================================================================
// Execution Graph Builder
// =============================================================================

export class ExecutionGraphBuilder {
  private readonly repoSpan: RepoSpan;
  private readonly agentSpans: AgentSpan[] = [];
  private finalized = false;

  constructor(ctx: ExecutionContext) {
    if (!ctx.parent_span_id) {
      throw new Error(
        'EXECUTION_REJECTED: parent_span_id is missing or invalid.'
      );
    }
    if (!ctx.execution_id) {
      throw new Error(
        'EXECUTION_REJECTED: execution_id is missing or invalid.'
      );
    }

    this.repoSpan = {
      type: 'repo',
      repo_name: REPO_NAME,
      span_id: uuidv4().replace(/-/g, '').slice(0, 16),
      parent_span_id: ctx.parent_span_id,
      start_time: new Date().toISOString(),
      status: 'RUNNING',
    };
  }

  get repoSpanId(): string {
    return this.repoSpan.span_id;
  }

  startAgentSpan(agentName: string): AgentSpan {
    if (this.finalized) {
      throw new Error('Cannot add agent spans after graph is finalized');
    }

    const span: AgentSpan = {
      type: 'agent',
      agent_name: agentName,
      repo_name: REPO_NAME,
      span_id: uuidv4().replace(/-/g, '').slice(0, 16),
      parent_span_id: this.repoSpan.span_id,
      start_time: new Date().toISOString(),
      status: 'RUNNING',
      artifacts: [],
    };

    this.agentSpans.push(span);
    return span;
  }

  completeAgentSpan(span: AgentSpan): void {
    span.end_time = new Date().toISOString();
    span.status = 'OK';
  }

  failAgentSpan(span: AgentSpan, reasons: string[]): void {
    span.end_time = new Date().toISOString();
    span.status = 'FAILED';
    span.failure_reasons = reasons;
  }

  attachArtifact(span: AgentSpan, artifact: ArtifactRef): void {
    span.artifacts.push(artifact);
  }

  finalize(forceFailure?: boolean, failureReasons?: string[]): ExecutionGraphOutput {
    this.finalized = true;
    this.repoSpan.end_time = new Date().toISOString();

    if (this.agentSpans.length === 0) {
      this.repoSpan.status = 'FAILED';
      this.repoSpan.failure_reasons = [
        'INVALID_EXECUTION: No agent-level spans were emitted.',
      ];
    } else if (forceFailure) {
      this.repoSpan.status = 'FAILED';
      this.repoSpan.failure_reasons = failureReasons;
    } else {
      const hasFailedAgent = this.agentSpans.some(s => s.status === 'FAILED');
      if (hasFailedAgent) {
        this.repoSpan.status = 'FAILED';
        this.repoSpan.failure_reasons = [
          'One or more agent spans reported failure.',
        ];
      } else {
        this.repoSpan.status = 'OK';
      }
    }

    return {
      repo_span: { ...this.repoSpan },
      agent_spans: this.agentSpans.map(s => ({ ...s, artifacts: [...s.artifacts] })),
    };
  }
}

// =============================================================================
// Extraction and Validation
// =============================================================================

/**
 * Extract execution context from HTTP headers.
 */
export function extractExecutionContext(
  headers: Record<string, string | string[] | undefined>
): ExecutionContext | null {
  const executionId = headers[EXECUTION_HEADERS.EXECUTION_ID];
  const parentSpanId = headers[EXECUTION_HEADERS.PARENT_SPAN_ID];

  if (!executionId || !parentSpanId) {
    return null;
  }

  return {
    execution_id: Array.isArray(executionId) ? executionId[0]! : executionId,
    parent_span_id: Array.isArray(parentSpanId) ? parentSpanId[0]! : parentSpanId,
  };
}

/**
 * Validate execution context. Returns error message or null if valid.
 */
export function validateExecutionContext(
  ctx: ExecutionContext | null
): string | null {
  if (!ctx) {
    return (
      'Missing execution context. Agent requests MUST include ' +
      `'${EXECUTION_HEADERS.EXECUTION_ID}' and '${EXECUTION_HEADERS.PARENT_SPAN_ID}' headers.`
    );
  }
  if (!ctx.execution_id) {
    return `'${EXECUTION_HEADERS.EXECUTION_ID}' header is empty.`;
  }
  if (!ctx.parent_span_id) {
    return `'${EXECUTION_HEADERS.PARENT_SPAN_ID}' header is empty.`;
  }
  return null;
}
