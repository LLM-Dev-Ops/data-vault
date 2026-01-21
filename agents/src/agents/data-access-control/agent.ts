/**
 * LLM-Data-Vault: Data Access Control Agent
 *
 * Core agent implementation for evaluating data access requests
 * using RBAC/ABAC policies and regulatory constraints.
 *
 * CRITICAL CONSTRAINTS:
 * - Agent MUST NOT execute inference
 * - Agent MUST NOT modify prompts or responses
 * - Agent MUST NOT route requests
 * - Agent MUST NOT trigger orchestration
 * - Agent MUST emit exactly ONE DecisionEvent per invocation
 *
 * @module agents/data-access-control/agent
 */

import {
  DataVaultAgent,
  type AgentMetadata,
  type ExecutionContext,
} from '../../runtime/agent-base.js';
import {
  type AccessAuthorizationRequest,
  type AccessAuthorizationResponse,
  type AccessPolicy,
  type PolicyEvaluationResult,
  type DecisionType,
  type AppliedConstraint,
  type ConfidenceBreakdown,
  validateAccessAuthorizationRequest,
  validateAccessAuthorizationResponse,
} from '../../contracts/index.js';
import {
  PolicyEvaluator,
  type PolicyEvaluatorConfig,
  type RegulatoryConstraint,
  type PolicyEvaluationSummary,
  createDefaultPolicyEvaluator,
} from './policy-evaluator.js';
import type { RuVectorClient } from '../../ruvector-client/index.js';
import { getTelemetry } from '../../telemetry/index.js';

/**
 * Agent version - follows semver
 */
export const AGENT_VERSION = '1.0.0';

/**
 * Agent identifier
 */
export const AGENT_ID = 'data-access-control';

/**
 * Data Access Control Agent configuration
 */
export interface DataAccessControlAgentConfig {
  /** Access policies to evaluate */
  policies: AccessPolicy[];
  /** Regulatory constraints to enforce */
  regulatoryConstraints?: RegulatoryConstraint[];
  /** Policy evaluator configuration */
  evaluatorConfig?: Partial<PolicyEvaluatorConfig>;
  /** RuVector client for persisting decisions */
  ruvectorClient?: RuVectorClient;
  /** Enable telemetry emission */
  enableTelemetry?: boolean;
}

/**
 * Extended authorization response with evaluation details
 */
interface AuthorizationResult {
  response: AccessAuthorizationResponse;
  evaluation: PolicyEvaluationSummary;
}

/**
 * Data Access Control Agent
 *
 * Evaluates data access requests against RBAC/ABAC policies and
 * regulatory constraints, emitting exactly ONE DecisionEvent per invocation.
 */
export class DataAccessControlAgent extends DataVaultAgent<
  AccessAuthorizationRequest,
  AccessAuthorizationResponse
> {
  private readonly policyEvaluator: PolicyEvaluator;
  private readonly ruvectorClient: RuVectorClient | null;
  private readonly enableTelemetry: boolean;

  /**
   * Creates a new DataAccessControlAgent
   *
   * @param config - Agent configuration
   */
  constructor(config: DataAccessControlAgentConfig) {
    const metadata: AgentMetadata = {
      agent_id: AGENT_ID,
      agent_version: AGENT_VERSION,
      classification: 'DATA_ACCESS_CONTROL',
      name: 'Data Access Control Agent',
      description: 'Evaluates data access requests using RBAC/ABAC policies and regulatory constraints',
      supported_operations: [
        'authorize',
        'evaluate_policy',
        'check_regulatory_compliance',
      ],
    };

    super(metadata);

    // Initialize policy evaluator
    if (config.regulatoryConstraints) {
      this.policyEvaluator = new PolicyEvaluator(
        config.policies,
        config.regulatoryConstraints,
        config.evaluatorConfig
      );
    } else {
      this.policyEvaluator = createDefaultPolicyEvaluator(
        config.policies,
        config.evaluatorConfig
      );
    }

    this.ruvectorClient = config.ruvectorClient ?? null;
    this.enableTelemetry = config.enableTelemetry ?? true;
  }

  /**
   * Validate incoming request
   */
  protected validateRequest(request: unknown): AccessAuthorizationRequest {
    return validateAccessAuthorizationRequest(request);
  }

  /**
   * Validate outgoing response
   */
  protected validateResponse(response: unknown): AccessAuthorizationResponse {
    return validateAccessAuthorizationResponse(response);
  }

  /**
   * Get decision type for this agent
   */
  protected getDecisionType(): DecisionType {
    // Map to appropriate decision type based on result
    return 'dataset_access_granted'; // Will be updated in executeCore based on actual decision
  }

  /**
   * Execute authorization logic
   */
  protected async executeCore(
    request: AccessAuthorizationRequest,
    context: ExecutionContext
  ): Promise<{
    response: AccessAuthorizationResponse;
    confidence: ConfidenceBreakdown;
    constraints: AppliedConstraint[];
  }> {
    const startTime = performance.now();

    // Emit telemetry for invocation start
    if (this.enableTelemetry) {
      getTelemetry().recordInvocationStart(
        this.metadata.agent_id,
        this.metadata.agent_version,
        context.execution_ref,
        context.correlation_id,
        context.tenant_id
      );
    }

    try {
      // Perform authorization
      const authResult = await this.authorize(request);

      // Build constraints list from evaluation
      const constraints = this.buildConstraints(authResult.evaluation);

      // Build confidence breakdown
      const confidence: ConfidenceBreakdown = {
        policy_match: authResult.evaluation.confidence,
        detection_confidence: authResult.evaluation.rbac.confidence,
        model_confidence: authResult.evaluation.abac.confidence,
      };

      // Record access decision telemetry
      if (this.enableTelemetry) {
        getTelemetry().recordAccessDecision(
          this.metadata.agent_id,
          context.execution_ref,
          authResult.response.decision === 'allow',
          authResult.evaluation.reasons.join('; ')
        );
      }

      return {
        response: authResult.response,
        confidence,
        constraints,
      };
    } finally {
      const duration = performance.now() - startTime;

      // Emit completion telemetry
      if (this.enableTelemetry) {
        getTelemetry().recordInvocationComplete(
          this.metadata.agent_id,
          this.metadata.agent_version,
          context.execution_ref,
          duration,
          true,
          { operation: 'authorize' }
        );
      }
    }
  }

  /**
   * Authorize a data access request
   *
   * This is the main entry point for authorization decisions.
   *
   * @param request - The authorization request
   * @returns Authorization result with response and evaluation details
   */
  public async authorize(
    request: AccessAuthorizationRequest
  ): Promise<AuthorizationResult> {
    // Evaluate policies
    const evaluation = this.policyEvaluator.evaluate(
      request.subject,
      request.resource,
      request.permission,
      request.context
    );

    // Build policy evaluation results
    const policyEvaluations = this.buildPolicyEvaluations(evaluation);

    // Build denial reasons if denied
    const denialReasons = evaluation.decision === 'deny'
      ? this.buildDenialReasons(evaluation)
      : [];

    // Build conditions if conditional access
    const conditions = this.buildAccessConditions(evaluation);

    // Determine granted permissions
    const grantedPermissions = evaluation.decision === 'allow'
      ? evaluation.rbac.grantedPermissions
      : [];

    // Build response
    const response: AccessAuthorizationResponse = {
      request_id: request.request_id,
      decision: evaluation.decision === 'allow' ? 'allow' : 'deny',
      granted_permissions: grantedPermissions,
      policy_evaluations: policyEvaluations,
      conditions,
      denial_reasons: denialReasons,
      cache_ttl_seconds: this.calculateCacheTTL(evaluation),
    };

    return {
      response,
      evaluation,
    };
  }

  /**
   * Build policy evaluation results from summary
   */
  private buildPolicyEvaluations(
    evaluation: PolicyEvaluationSummary
  ): PolicyEvaluationResult[] {
    const results: PolicyEvaluationResult[] = [];

    // Add RBAC evaluation if roles matched
    if (evaluation.rbac.matchingRoles.length > 0) {
      results.push({
        policy_id: crypto.randomUUID(),
        policy_version: '1.0',
        rule_id: evaluation.rbac.matchingRoles.join(','),
        effect: evaluation.rbac.allowed ? 'allow' : 'deny',
        reason: evaluation.rbac.reason,
      });
    }

    // Add ABAC evaluation if rules matched
    if (evaluation.abac.matchingRules.length > 0) {
      results.push({
        policy_id: crypto.randomUUID(),
        policy_version: '1.0',
        rule_id: evaluation.abac.matchingRules.join(','),
        effect: evaluation.abac.allowed ? 'allow' : 'deny',
        reason: evaluation.abac.reason,
      });
    }

    // Add regulatory evaluations
    for (const framework of evaluation.regulatory.applicableFrameworks) {
      const violations = evaluation.regulatory.violations.filter(
        v => v.framework === framework
      );

      results.push({
        policy_id: crypto.randomUUID(),
        policy_version: '1.0',
        rule_id: framework,
        effect: violations.some(v => v.severity === 'deny') ? 'deny' : 'allow',
        reason: violations.length > 0
          ? `Violations: ${violations.map(v => v.requirementId).join(', ')}`
          : `${framework} compliant`,
      });
    }

    return results;
  }

  /**
   * Build denial reasons from evaluation
   */
  private buildDenialReasons(
    evaluation: PolicyEvaluationSummary
  ): AccessAuthorizationResponse['denial_reasons'] {
    const reasons: AccessAuthorizationResponse['denial_reasons'] = [];

    // Add RBAC denial reasons
    if (!evaluation.rbac.allowed) {
      reasons.push({
        code: 'RBAC_DENIED',
        message: evaluation.rbac.reason,
      });
    }

    // Add ABAC denial reasons
    if (!evaluation.abac.allowed) {
      reasons.push({
        code: 'ABAC_DENIED',
        message: evaluation.abac.reason,
      });
    }

    // Add regulatory violation reasons
    for (const violation of evaluation.regulatory.violations) {
      if (violation.severity === 'deny') {
        reasons.push({
          code: `${violation.framework}_VIOLATION`,
          message: violation.description,
          rule_id: violation.requirementId,
        });
      }
    }

    // Add combined reasons
    for (const reason of evaluation.reasons) {
      if (!reasons.some(r => r.message === reason)) {
        reasons.push({
          code: 'POLICY_DENIED',
          message: reason,
        });
      }
    }

    return reasons;
  }

  /**
   * Build access conditions from evaluation
   */
  private buildAccessConditions(
    evaluation: PolicyEvaluationSummary
  ): AccessAuthorizationResponse['conditions'] {
    const conditions: AccessAuthorizationResponse['conditions'] = [];

    // Add warning-level regulatory violations as conditions
    for (const violation of evaluation.regulatory.violations) {
      if (violation.severity === 'warn') {
        conditions.push({
          type: 'regulatory_warning',
          requirement: violation.description,
          metadata: {
            framework: violation.framework,
            requirementId: violation.requirementId,
          },
        });
      }
    }

    // Add audit requirements
    for (const violation of evaluation.regulatory.violations) {
      if (violation.severity === 'audit') {
        conditions.push({
          type: 'audit_required',
          requirement: `Access must be audited for ${violation.framework} compliance`,
          metadata: {
            framework: violation.framework,
            requirementId: violation.requirementId,
          },
        });
      }
    }

    return conditions;
  }

  /**
   * Build applied constraints from evaluation
   */
  private buildConstraints(
    evaluation: PolicyEvaluationSummary
  ): AppliedConstraint[] {
    const constraints: AppliedConstraint[] = [];

    // Add role-based constraints
    if (evaluation.rbac.matchingRoles.length > 0) {
      constraints.push({
        type: 'role_required',
        description: `Access granted via roles: ${evaluation.rbac.matchingRoles.join(', ')}`,
        severity: 'info',
        metadata: { roles: evaluation.rbac.matchingRoles },
      });
    } else if (!evaluation.rbac.allowed) {
      constraints.push({
        type: 'permission_denied',
        description: evaluation.rbac.reason,
        severity: 'error',
      });
    }

    // Add regulatory constraints
    for (const violation of evaluation.regulatory.violations) {
      const severityMap: Record<string, AppliedConstraint['severity']> = {
        deny: 'critical',
        warn: 'warning',
        audit: 'info',
      };

      let constraintType: AppliedConstraint['type'];
      switch (violation.framework) {
        case 'GDPR':
          constraintType = 'gdpr_compliance';
          break;
        case 'HIPAA':
          constraintType = 'hipaa_compliance';
          break;
        case 'CCPA':
          constraintType = 'ccpa_compliance';
          break;
        default:
          constraintType = 'soc2_compliance';
      }

      constraints.push({
        type: constraintType,
        description: violation.description,
        severity: severityMap[violation.severity] ?? 'warning',
        metadata: {
          requirementId: violation.requirementId,
          framework: violation.framework,
        },
      });
    }

    // Add decision source constraint
    constraints.push({
      type: 'role_required', // Using as proxy for decision tracking
      description: `Decision made by: ${evaluation.decisionSource}`,
      severity: 'info',
      metadata: {
        decisionSource: evaluation.decisionSource,
        confidence: evaluation.confidence,
      },
    });

    return constraints;
  }

  /**
   * Calculate cache TTL based on evaluation result
   */
  private calculateCacheTTL(evaluation: PolicyEvaluationSummary): number {
    // No caching for denied requests
    if (evaluation.decision === 'deny') {
      return 0;
    }

    // Shorter TTL for lower confidence decisions
    if (evaluation.confidence < 0.7) {
      return 60; // 1 minute
    }

    if (evaluation.confidence < 0.9) {
      return 300; // 5 minutes
    }

    // Standard TTL for high confidence decisions
    return 900; // 15 minutes
  }

  /**
   * Persist decision event to ruvector-service
   *
   * This method MUST be called after invoke() to persist the DecisionEvent.
   * The agent itself does not persist - the handler is responsible for calling this.
   *
   * @param decisionEvent - The decision event from invoke() result
   */
  public async persistDecision(
    decisionEvent: Parameters<RuVectorClient['persistDecisionEvent']>[0]
  ): Promise<void> {
    if (!this.ruvectorClient) {
      throw new Error('RuVector client not configured - cannot persist decision');
    }

    const result = await this.ruvectorClient.persistDecisionEvent(decisionEvent);

    if (!result.success) {
      throw new Error(`Failed to persist decision: ${result.error?.message}`);
    }
  }
}

/**
 * Create a DataAccessControlAgent with default configuration
 *
 * @param policies - Access policies to evaluate
 * @param ruvectorClient - Optional RuVector client for persistence
 * @returns Configured agent instance
 */
export function createDataAccessControlAgent(
  policies: AccessPolicy[],
  ruvectorClient?: RuVectorClient
): DataAccessControlAgent {
  return new DataAccessControlAgent({
    policies,
    ruvectorClient,
    enableTelemetry: true,
  });
}
