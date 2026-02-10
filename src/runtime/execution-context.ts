/**
 * @fileoverview Agentics Execution Context and Span Management
 * @module runtime/execution-context
 *
 * Implements the Foundational Execution Unit contract for the Agentics
 * execution system. Provides execution span creation, artifact attachment,
 * and enforcement of the hierarchical ExecutionGraph invariants.
 *
 * Invariant: Core -> Repo (this repo) -> Agent (one or more)
 * If no agent span exists, execution is INVALID.
 */

import { generateSpanId } from './telemetry.js';

// =============================================================================
// Constants
// =============================================================================

const REPO_NAME = 'data-vault';

// =============================================================================
// Execution Context
// =============================================================================

/**
 * Execution context provided by the calling Core.
 * Every externally-invoked operation MUST receive this.
 */
export interface ExecutionContext {
  /** Unique execution identifier assigned by the Core */
  readonly execution_id: string;
  /** Parent span ID from the Core's repo-level span */
  readonly parent_span_id: string;
}

// =============================================================================
// Execution Span Types
// =============================================================================

/** Span status */
export type SpanStatus = 'RUNNING' | 'OK' | 'FAILED';

/**
 * Reference to an artifact produced during execution.
 * Artifacts MUST be attached to agent-level spans only.
 */
export interface ArtifactRef {
  /** Stable identifier (ID, URI, hash, or filename) */
  readonly id: string;
  /** Artifact type descriptor */
  readonly type: string;
  /** Optional URI for retrieval */
  readonly uri?: string;
  /** Optional content hash for verification */
  readonly hash?: string;
}

/**
 * Base execution span fields shared by all span types.
 */
interface BaseSpan {
  /** Unique span identifier */
  readonly span_id: string;
  /** Parent span identifier (causally ordered) */
  readonly parent_span_id: string;
  /** Start time as ISO 8601 timestamp */
  readonly start_time: string;
  /** End time as ISO 8601 timestamp (set on completion) */
  end_time?: string;
  /** Span status */
  status: SpanStatus;
  /** Failure reason(s) if status is FAILED */
  failure_reasons?: string[];
}

/**
 * Repo-level execution span.
 * Created once per external invocation.
 */
export interface RepoSpan extends BaseSpan {
  readonly type: 'repo';
  readonly repo_name: typeof REPO_NAME;
}

/**
 * Agent-level execution span.
 * Created for every agent that executes logic.
 */
export interface AgentSpan extends BaseSpan {
  readonly type: 'agent';
  /** Name of the agent that executed */
  readonly agent_name: string;
  /** Repository this agent belongs to */
  readonly repo_name: typeof REPO_NAME;
  /** Artifacts produced by this agent */
  artifacts: ArtifactRef[];
}

// =============================================================================
// Execution Graph Output
// =============================================================================

/**
 * The output contract for this repo's execution.
 * MUST include repo-level span, nested agent-level spans,
 * and artifacts attached at correct levels.
 *
 * Structure is append-only, causally ordered via parent_span_id,
 * and JSON-serializable without loss.
 */
export interface ExecutionGraphOutput {
  /** Repo-level span */
  readonly repo_span: RepoSpan;
  /** Nested agent-level spans */
  readonly agent_spans: AgentSpan[];
}

// =============================================================================
// Execution Graph Builder
// =============================================================================

/**
 * Builds and enforces the ExecutionGraph for a single repo invocation.
 *
 * Ensures:
 * - Exactly one repo span per invocation
 * - One or more agent spans nested under the repo span
 * - Artifacts attached only to agent spans
 * - Execution is INVALID if no agent spans exist at finalization
 */
export class ExecutionGraphBuilder {
  private readonly repoSpan: RepoSpan;
  private readonly agentSpans: AgentSpan[] = [];
  private finalized = false;

  /**
   * Creates a new ExecutionGraphBuilder.
   *
   * @param ctx - Execution context from the Core
   * @throws Error if parent_span_id is missing or empty
   */
  constructor(ctx: ExecutionContext) {
    if (!ctx.parent_span_id) {
      throw new Error(
        'EXECUTION_REJECTED: parent_span_id is missing or invalid. ' +
        'This repo MUST be invoked with a valid parent_span_id from the Core.'
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
      span_id: generateSpanId(),
      parent_span_id: ctx.parent_span_id,
      start_time: new Date().toISOString(),
      status: 'RUNNING',
    };
  }

  /**
   * Gets the repo span ID for use as parent by agent spans.
   */
  get repoSpanId(): string {
    return this.repoSpan.span_id;
  }

  /**
   * Gets the execution context's parent_span_id.
   */
  get parentSpanId(): string {
    return this.repoSpan.parent_span_id;
  }

  /**
   * Creates and registers a new agent-level span.
   *
   * @param agentName - Name of the agent executing
   * @returns The created AgentSpan (mutable for artifact attachment)
   * @throws Error if graph is already finalized
   */
  startAgentSpan(agentName: string): AgentSpan {
    if (this.finalized) {
      throw new Error('Cannot add agent spans after graph is finalized');
    }

    const span: AgentSpan = {
      type: 'agent',
      agent_name: agentName,
      repo_name: REPO_NAME,
      span_id: generateSpanId(),
      parent_span_id: this.repoSpan.span_id,
      start_time: new Date().toISOString(),
      status: 'RUNNING',
      artifacts: [],
    };

    this.agentSpans.push(span);
    return span;
  }

  /**
   * Completes an agent span with success status.
   *
   * @param span - The agent span to complete
   */
  completeAgentSpan(span: AgentSpan): void {
    span.end_time = new Date().toISOString();
    span.status = 'OK';
  }

  /**
   * Fails an agent span with error details.
   *
   * @param span - The agent span to fail
   * @param reasons - Failure reason(s)
   */
  failAgentSpan(span: AgentSpan, reasons: string[]): void {
    span.end_time = new Date().toISOString();
    span.status = 'FAILED';
    span.failure_reasons = reasons;
  }

  /**
   * Attaches an artifact to an agent span.
   * Artifacts MUST NOT be attached directly to the repo span.
   *
   * @param span - The agent span to attach to
   * @param artifact - Artifact reference
   */
  attachArtifact(span: AgentSpan, artifact: ArtifactRef): void {
    span.artifacts.push(artifact);
  }

  /**
   * Finalizes the execution graph and returns the output.
   *
   * ENFORCEMENT:
   * - If no agent spans were emitted, the repo span is marked FAILED
   *   and the output includes explicit failure reason(s).
   * - If any agent span is FAILED, the repo span is marked FAILED.
   * - All emitted spans are still returned regardless of failure.
   *
   * @param forceFailure - Optional flag to force repo span to FAILED
   * @param failureReasons - Optional failure reasons
   * @returns The finalized ExecutionGraphOutput
   */
  finalize(forceFailure?: boolean, failureReasons?: string[]): ExecutionGraphOutput {
    this.finalized = true;
    this.repoSpan.end_time = new Date().toISOString();

    // Enforcement: no agent spans = INVALID execution
    if (this.agentSpans.length === 0) {
      this.repoSpan.status = 'FAILED';
      this.repoSpan.failure_reasons = [
        'INVALID_EXECUTION: No agent-level spans were emitted. ' +
        'Every execution MUST produce at least one agent span.',
      ];
    } else if (forceFailure) {
      this.repoSpan.status = 'FAILED';
      this.repoSpan.failure_reasons = failureReasons;
    } else {
      // Check if any agent span failed
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
// Header Extraction
// =============================================================================

/**
 * Header names for execution context propagation.
 */
export const EXECUTION_HEADERS = {
  EXECUTION_ID: 'x-execution-id',
  PARENT_SPAN_ID: 'x-parent-span-id',
} as const;

/**
 * Extracts execution context from HTTP headers.
 *
 * @param headers - Request headers
 * @returns ExecutionContext or null if headers are missing
 */
export function extractExecutionContext(
  headers: Readonly<Record<string, string | string[] | undefined>>
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
 * Validates that an execution context is present and valid.
 * Returns a descriptive error message if invalid.
 *
 * @param ctx - Execution context to validate (may be null)
 * @returns Error message string, or null if valid
 */
export function validateExecutionContext(
  ctx: ExecutionContext | null
): string | null {
  if (!ctx) {
    return (
      'Missing execution context. Requests to agent endpoints MUST include ' +
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
