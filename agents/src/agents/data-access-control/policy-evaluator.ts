/**
 * LLM-Data-Vault: Policy Evaluator
 *
 * Evaluates RBAC/ABAC policies for data access control decisions.
 * Supports regulatory constraints (GDPR, CCPA, HIPAA).
 *
 * CRITICAL CONSTRAINTS:
 * - Evaluator MUST be stateless
 * - Evaluator MUST NOT execute inference
 * - Evaluator MUST return deterministic results
 *
 * @module agents/data-access-control/policy-evaluator
 */

import type {
  Subject,
  Resource,
  AccessContext,
  AccessPolicy,
  AccessPolicyRule,
  PolicyCondition,
  PermissionType,
} from '../../contracts/index.js';

/**
 * Regulatory framework types
 */
export type RegulatoryFramework = 'GDPR' | 'CCPA' | 'HIPAA' | 'SOX' | 'PCI_DSS' | 'FERPA';

/**
 * Regulatory constraint configuration
 */
export interface RegulatoryConstraint {
  /** Regulatory framework */
  framework: RegulatoryFramework;
  /** Whether this constraint is enforced */
  enforced: boolean;
  /** Requirements for this framework */
  requirements: RegulatoryRequirement[];
}

/**
 * Individual regulatory requirement
 */
export interface RegulatoryRequirement {
  /** Requirement identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Condition function */
  condition: (subject: Subject, resource: Resource, context: AccessContext) => boolean;
  /** Effect when requirement is not met */
  effect: 'deny' | 'warn' | 'audit';
  /** Priority (higher = evaluated first) */
  priority: number;
}

/**
 * RBAC evaluation result
 */
export interface RBACEvaluationResult {
  /** Whether access is allowed by RBAC */
  allowed: boolean;
  /** Matching roles */
  matchingRoles: string[];
  /** Granted permissions */
  grantedPermissions: PermissionType[];
  /** Reason for decision */
  reason: string;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * ABAC evaluation result
 */
export interface ABACEvaluationResult {
  /** Whether access is allowed by ABAC */
  allowed: boolean;
  /** Matching rules */
  matchingRules: string[];
  /** Evaluated conditions */
  evaluatedConditions: Array<{
    condition: string;
    result: boolean;
  }>;
  /** Reason for decision */
  reason: string;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Regulatory evaluation result
 */
export interface RegulatoryEvaluationResult {
  /** Whether access is allowed by regulatory constraints */
  allowed: boolean;
  /** Applicable frameworks */
  applicableFrameworks: RegulatoryFramework[];
  /** Violations detected */
  violations: Array<{
    framework: RegulatoryFramework;
    requirementId: string;
    description: string;
    severity: 'deny' | 'warn' | 'audit';
  }>;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Combined policy evaluation result
 */
export interface PolicyEvaluationSummary {
  /** Final decision */
  decision: 'allow' | 'deny';
  /** Overall confidence (weighted average) */
  confidence: number;
  /** RBAC evaluation details */
  rbac: RBACEvaluationResult;
  /** ABAC evaluation details */
  abac: ABACEvaluationResult;
  /** Regulatory evaluation details */
  regulatory: RegulatoryEvaluationResult;
  /** Combined reasons */
  reasons: string[];
  /** Decision source */
  decisionSource: 'rbac' | 'abac' | 'regulatory' | 'combined' | 'default';
}

/**
 * Policy evaluator configuration
 */
export interface PolicyEvaluatorConfig {
  /** Default effect when no policy matches */
  defaultEffect: 'allow' | 'deny';
  /** Enable RBAC evaluation */
  enableRBAC: boolean;
  /** Enable ABAC evaluation */
  enableABAC: boolean;
  /** Enable regulatory constraint checking */
  enableRegulatory: boolean;
  /** Weight for RBAC in confidence calculation */
  rbacWeight: number;
  /** Weight for ABAC in confidence calculation */
  abacWeight: number;
  /** Weight for regulatory in confidence calculation */
  regulatoryWeight: number;
}

/**
 * Default policy evaluator configuration
 */
export const DEFAULT_CONFIG: PolicyEvaluatorConfig = {
  defaultEffect: 'deny',
  enableRBAC: true,
  enableABAC: true,
  enableRegulatory: true,
  rbacWeight: 0.4,
  abacWeight: 0.4,
  regulatoryWeight: 0.2,
};

/**
 * Policy Evaluator
 *
 * Evaluates RBAC, ABAC, and regulatory policies to make access control decisions.
 */
export class PolicyEvaluator {
  private readonly config: PolicyEvaluatorConfig;
  private readonly policies: AccessPolicy[];
  private readonly regulatoryConstraints: RegulatoryConstraint[];

  /**
   * Creates a new PolicyEvaluator
   *
   * @param policies - Access policies to evaluate
   * @param regulatoryConstraints - Regulatory constraints to enforce
   * @param config - Evaluator configuration
   */
  constructor(
    policies: AccessPolicy[],
    regulatoryConstraints: RegulatoryConstraint[] = [],
    config: Partial<PolicyEvaluatorConfig> = {}
  ) {
    this.policies = policies;
    this.regulatoryConstraints = regulatoryConstraints;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Evaluate all policies for an access request
   *
   * @param subject - Who is requesting access
   * @param resource - What resource is being accessed
   * @param permission - What permission is requested
   * @param context - Environmental context
   * @returns Combined evaluation result
   */
  evaluate(
    subject: Subject,
    resource: Resource,
    permission: PermissionType,
    context: AccessContext
  ): PolicyEvaluationSummary {
    // Evaluate RBAC
    const rbacResult = this.config.enableRBAC
      ? this.evaluateRBAC(subject, resource, permission)
      : { allowed: true, matchingRoles: [], grantedPermissions: [], reason: 'RBAC disabled', confidence: 1.0 };

    // Evaluate ABAC
    const abacResult = this.config.enableABAC
      ? this.evaluateABAC(subject, resource, permission, context)
      : { allowed: true, matchingRules: [], evaluatedConditions: [], reason: 'ABAC disabled', confidence: 1.0 };

    // Evaluate regulatory constraints
    const regulatoryResult = this.config.enableRegulatory
      ? this.evaluateRegulatory(subject, resource, context)
      : { allowed: true, applicableFrameworks: [], violations: [], confidence: 1.0 };

    // Combine results
    return this.combineResults(rbacResult, abacResult, regulatoryResult);
  }

  /**
   * Evaluate RBAC policies
   */
  private evaluateRBAC(
    subject: Subject,
    resource: Resource,
    permission: PermissionType
  ): RBACEvaluationResult {
    const matchingRoles: string[] = [];
    const grantedPermissions: PermissionType[] = [];
    let allowed = false;
    let bestMatchConfidence = 0;

    // Get applicable policies for the tenant
    const tenantPolicies = this.policies.filter(
      p => p.tenant_id === subject.tenant_id && p.active
    );

    for (const policy of tenantPolicies) {
      // Sort rules by priority (higher first)
      const sortedRules = [...policy.rules].sort((a, b) => b.priority - a.priority);

      for (const rule of sortedRules) {
        // Check if rule applies to this subject's roles
        const roleMatch = this.matchSubjectRoles(rule, subject);
        if (!roleMatch.matches) continue;

        // Check if rule applies to this resource
        const resourceMatch = this.matchResource(rule, resource);
        if (!resourceMatch.matches) continue;

        // Check if the permission is granted
        if (rule.permissions.includes(permission) || rule.permissions.includes('admin' as PermissionType)) {
          matchingRoles.push(...roleMatch.matchedRoles);
          grantedPermissions.push(...rule.permissions);

          if (rule.effect === 'allow') {
            allowed = true;
            bestMatchConfidence = Math.max(
              bestMatchConfidence,
              this.calculateRuleConfidence(rule, roleMatch.matchedRoles.length)
            );
          } else if (rule.effect === 'deny') {
            // Explicit deny always wins
            return {
              allowed: false,
              matchingRoles: roleMatch.matchedRoles,
              grantedPermissions: [],
              reason: `Explicit deny by rule ${rule.rule_id}`,
              confidence: 1.0,
            };
          }
        }
      }
    }

    // Check default effect if no matching rules
    if (matchingRoles.length === 0) {
      return {
        allowed: this.config.defaultEffect === 'allow',
        matchingRoles: [],
        grantedPermissions: [],
        reason: `No matching RBAC rules, default: ${this.config.defaultEffect}`,
        confidence: 0.5,
      };
    }

    return {
      allowed,
      matchingRoles: [...new Set(matchingRoles)],
      grantedPermissions: [...new Set(grantedPermissions)],
      reason: allowed
        ? `Access granted by roles: ${matchingRoles.join(', ')}`
        : `Permission ${permission} not granted to any matching role`,
      confidence: bestMatchConfidence || 0.7,
    };
  }

  /**
   * Evaluate ABAC policies
   */
  private evaluateABAC(
    subject: Subject,
    resource: Resource,
    permission: PermissionType,
    context: AccessContext
  ): ABACEvaluationResult {
    const matchingRules: string[] = [];
    const evaluatedConditions: Array<{ condition: string; result: boolean }> = [];
    let allowed = false;
    let bestMatchConfidence = 0;

    // Get applicable policies
    const tenantPolicies = this.policies.filter(
      p => p.tenant_id === subject.tenant_id && p.active
    );

    for (const policy of tenantPolicies) {
      const sortedRules = [...policy.rules].sort((a, b) => b.priority - a.priority);

      for (const rule of sortedRules) {
        // Evaluate subject conditions (ABAC)
        const subjectConditionResults = this.evaluateConditions(
          rule.subjects?.conditions ?? [],
          { ...subject.attributes, ...subject }
        );
        evaluatedConditions.push(
          ...subjectConditionResults.map(r => ({
            condition: `subject.${r.field}`,
            result: r.result,
          }))
        );

        if (!subjectConditionResults.every(c => c.result)) continue;

        // Evaluate resource conditions (ABAC)
        const resourceConditionResults = this.evaluateConditions(
          rule.resources?.conditions ?? [],
          { ...resource.attributes, ...resource }
        );
        evaluatedConditions.push(
          ...resourceConditionResults.map(r => ({
            condition: `resource.${r.field}`,
            result: r.result,
          }))
        );

        if (!resourceConditionResults.every(c => c.result)) continue;

        // Evaluate context conditions
        const contextConditionResults = this.evaluateConditions(
          rule.context_conditions ?? [],
          { ...context }
        );
        evaluatedConditions.push(
          ...contextConditionResults.map(r => ({
            condition: `context.${r.field}`,
            result: r.result,
          }))
        );

        if (!contextConditionResults.every(c => c.result)) continue;

        // Check permission
        if (rule.permissions.includes(permission) || rule.permissions.includes('admin' as PermissionType)) {
          matchingRules.push(rule.rule_id);

          if (rule.effect === 'allow') {
            allowed = true;
            const conditionCount =
              subjectConditionResults.length +
              resourceConditionResults.length +
              contextConditionResults.length;
            bestMatchConfidence = Math.max(
              bestMatchConfidence,
              this.calculateConditionConfidence(conditionCount)
            );
          } else if (rule.effect === 'deny') {
            return {
              allowed: false,
              matchingRules: [rule.rule_id],
              evaluatedConditions,
              reason: `Explicit deny by ABAC rule ${rule.rule_id}`,
              confidence: 1.0,
            };
          }
        }
      }
    }

    if (matchingRules.length === 0) {
      return {
        allowed: this.config.defaultEffect === 'allow',
        matchingRules: [],
        evaluatedConditions,
        reason: `No matching ABAC rules, default: ${this.config.defaultEffect}`,
        confidence: 0.5,
      };
    }

    return {
      allowed,
      matchingRules,
      evaluatedConditions,
      reason: allowed
        ? `Access granted by ABAC rules: ${matchingRules.join(', ')}`
        : 'ABAC conditions not satisfied',
      confidence: bestMatchConfidence || 0.7,
    };
  }

  /**
   * Evaluate regulatory constraints
   */
  private evaluateRegulatory(
    subject: Subject,
    resource: Resource,
    context: AccessContext
  ): RegulatoryEvaluationResult {
    const applicableFrameworks: RegulatoryFramework[] = [];
    const violations: RegulatoryEvaluationResult['violations'] = [];

    for (const constraint of this.regulatoryConstraints) {
      if (!constraint.enforced) continue;

      applicableFrameworks.push(constraint.framework);

      // Sort requirements by priority
      const sortedRequirements = [...constraint.requirements].sort(
        (a, b) => b.priority - a.priority
      );

      for (const requirement of sortedRequirements) {
        const satisfied = requirement.condition(subject, resource, context);

        if (!satisfied) {
          violations.push({
            framework: constraint.framework,
            requirementId: requirement.id,
            description: requirement.description,
            severity: requirement.effect,
          });
        }
      }
    }

    // Any deny violation means access is denied
    const denyViolations = violations.filter(v => v.severity === 'deny');
    const allowed = denyViolations.length === 0;

    // Confidence based on number of applicable frameworks and violations
    const confidence = applicableFrameworks.length > 0
      ? Math.max(0.5, 1 - (violations.length * 0.1))
      : 1.0;

    return {
      allowed,
      applicableFrameworks,
      violations,
      confidence,
    };
  }

  /**
   * Combine RBAC, ABAC, and regulatory results into final decision
   */
  private combineResults(
    rbac: RBACEvaluationResult,
    abac: ABACEvaluationResult,
    regulatory: RegulatoryEvaluationResult
  ): PolicyEvaluationSummary {
    const reasons: string[] = [];
    let decisionSource: PolicyEvaluationSummary['decisionSource'] = 'combined';

    // Regulatory violations always take precedence (deny)
    if (!regulatory.allowed) {
      const denyViolations = regulatory.violations.filter(v => v.severity === 'deny');
      reasons.push(
        `Regulatory violation: ${denyViolations.map(v => `${v.framework}:${v.requirementId}`).join(', ')}`
      );
      decisionSource = 'regulatory';

      return {
        decision: 'deny',
        confidence: regulatory.confidence,
        rbac,
        abac,
        regulatory,
        reasons,
        decisionSource,
      };
    }

    // Both RBAC and ABAC must allow (if enabled)
    if (!rbac.allowed && this.config.enableRBAC) {
      reasons.push(rbac.reason);
      decisionSource = 'rbac';
    }

    if (!abac.allowed && this.config.enableABAC) {
      reasons.push(abac.reason);
      if (decisionSource === 'rbac') {
        decisionSource = 'combined';
      } else {
        decisionSource = 'abac';
      }
    }

    const allowed = rbac.allowed && abac.allowed && regulatory.allowed;

    if (allowed) {
      reasons.push(rbac.reason);
      reasons.push(abac.reason);
    }

    // Calculate weighted confidence
    const confidence = this.calculateCombinedConfidence(rbac, abac, regulatory);

    // Determine final decision source
    if (rbac.allowed && abac.allowed && regulatory.allowed) {
      if (rbac.matchingRoles.length > 0 && abac.matchingRules.length > 0) {
        decisionSource = 'combined';
      } else if (rbac.matchingRoles.length > 0) {
        decisionSource = 'rbac';
      } else if (abac.matchingRules.length > 0) {
        decisionSource = 'abac';
      } else {
        decisionSource = 'default';
      }
    }

    return {
      decision: allowed ? 'allow' : 'deny',
      confidence,
      rbac,
      abac,
      regulatory,
      reasons: [...new Set(reasons)],
      decisionSource,
    };
  }

  /**
   * Match subject roles against rule
   */
  private matchSubjectRoles(
    rule: AccessPolicyRule,
    subject: Subject
  ): { matches: boolean; matchedRoles: string[] } {
    if (!rule.subjects?.roles || rule.subjects.roles.length === 0) {
      return { matches: true, matchedRoles: [] };
    }

    const matchedRoles = subject.roles.filter(
      role =>
        rule.subjects!.roles!.includes(role) ||
        rule.subjects!.roles!.includes('*')
    );

    return {
      matches: matchedRoles.length > 0,
      matchedRoles,
    };
  }

  /**
   * Match resource against rule
   */
  private matchResource(
    rule: AccessPolicyRule,
    resource: Resource
  ): { matches: boolean } {
    if (!rule.resources) {
      return { matches: true };
    }

    // Check resource type
    if (rule.resources.types && rule.resources.types.length > 0) {
      if (!rule.resources.types.includes(resource.resource_type)) {
        return { matches: false };
      }
    }

    // Check resource IDs
    if (rule.resources.ids && rule.resources.ids.length > 0) {
      const idMatch = rule.resources.ids.some(
        pattern => this.matchPattern(pattern, resource.resource_id)
      );
      if (!idMatch) {
        return { matches: false };
      }
    }

    return { matches: true };
  }

  /**
   * Evaluate policy conditions against attributes
   */
  private evaluateConditions(
    conditions: PolicyCondition[],
    attributes: Record<string, unknown>
  ): Array<{ field: string; result: boolean }> {
    return conditions.map(condition => ({
      field: condition.field,
      result: this.evaluateCondition(condition, attributes),
    }));
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    condition: PolicyCondition,
    attributes: Record<string, unknown>
  ): boolean {
    const value = this.getNestedValue(attributes, condition.field);

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'not_equals':
        return value !== condition.value;
      case 'contains':
        if (typeof value === 'string') {
          return value.includes(String(condition.value));
        }
        if (Array.isArray(value)) {
          return value.includes(condition.value);
        }
        return false;
      case 'not_contains':
        if (typeof value === 'string') {
          return !value.includes(String(condition.value));
        }
        if (Array.isArray(value)) {
          return !value.includes(condition.value);
        }
        return true;
      case 'starts_with':
        return typeof value === 'string' && value.startsWith(String(condition.value));
      case 'ends_with':
        return typeof value === 'string' && value.endsWith(String(condition.value));
      case 'regex':
        if (typeof value !== 'string' || typeof condition.value !== 'string') {
          return false;
        }
        try {
          return new RegExp(condition.value).test(value);
        } catch {
          return false;
        }
      case 'in':
        if (!Array.isArray(condition.value)) return false;
        return (condition.value as unknown[]).includes(value);
      case 'not_in':
        if (!Array.isArray(condition.value)) return true;
        return !(condition.value as unknown[]).includes(value);
      case 'greater_than':
        return typeof value === 'number' && typeof condition.value === 'number'
          ? value > condition.value
          : false;
      case 'less_than':
        return typeof value === 'number' && typeof condition.value === 'number'
          ? value < condition.value
          : false;
      case 'between':
        if (typeof value !== 'number' || !Array.isArray(condition.value)) {
          return false;
        }
        const [min, max] = condition.value as number[];
        return value >= min && value <= max;
      default:
        return false;
    }
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((acc: unknown, part: string) => {
      if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, obj);
  }

  /**
   * Match a glob pattern against a value
   */
  private matchPattern(pattern: string, value: string): boolean {
    if (pattern === '*') return true;
    if (!pattern.includes('*')) return pattern === value;

    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(value);
  }

  /**
   * Calculate confidence score for a rule match
   */
  private calculateRuleConfidence(rule: AccessPolicyRule, matchedRolesCount: number): number {
    // Base confidence from having a matching rule
    let confidence = 0.7;

    // Increase confidence for more specific rules (higher priority)
    confidence += Math.min(0.1, rule.priority / 1000);

    // Increase confidence for multiple matching roles
    confidence += Math.min(0.1, matchedRolesCount * 0.05);

    return Math.min(1.0, confidence);
  }

  /**
   * Calculate confidence based on number of satisfied conditions
   */
  private calculateConditionConfidence(conditionCount: number): number {
    // More conditions satisfied = higher confidence
    if (conditionCount === 0) return 0.6;
    if (conditionCount === 1) return 0.7;
    if (conditionCount === 2) return 0.8;
    if (conditionCount >= 3) return 0.9;
    return 0.6;
  }

  /**
   * Calculate combined confidence from all evaluation results
   */
  private calculateCombinedConfidence(
    rbac: RBACEvaluationResult,
    abac: ABACEvaluationResult,
    regulatory: RegulatoryEvaluationResult
  ): number {
    const totalWeight = this.config.rbacWeight + this.config.abacWeight + this.config.regulatoryWeight;

    const weightedSum =
      rbac.confidence * this.config.rbacWeight +
      abac.confidence * this.config.abacWeight +
      regulatory.confidence * this.config.regulatoryWeight;

    return weightedSum / totalWeight;
  }
}

/**
 * Create default GDPR regulatory constraints
 */
export function createGDPRConstraints(): RegulatoryConstraint {
  return {
    framework: 'GDPR',
    enforced: true,
    requirements: [
      {
        id: 'gdpr-legal-basis',
        description: 'Processing must have a valid legal basis',
        condition: (_subject, resource) => {
          // Check if resource has legal basis metadata
          const legalBasis = resource.attributes['legal_basis'];
          return legalBasis !== undefined && legalBasis !== null;
        },
        effect: 'deny',
        priority: 100,
      },
      {
        id: 'gdpr-data-residency',
        description: 'Data must comply with EU data residency requirements',
        condition: (_subject, resource, context) => {
          // Check if data residency is EU-compliant
          const dataResidency = resource.data_residency;
          const sourceRegion = context.geo_location;

          // If data is in EU and request is from outside, check for adequacy
          if (dataResidency?.startsWith('eu-') && sourceRegion && !sourceRegion.startsWith('eu-')) {
            // Would need to check for adequacy decisions or SCCs
            return true; // Simplified - always allow for now
          }
          return true;
        },
        effect: 'deny',
        priority: 90,
      },
      {
        id: 'gdpr-purpose-limitation',
        description: 'Data access must be for specified purposes only',
        condition: (_subject, resource) => {
          // Check if access purpose matches allowed purposes
          const allowedPurposes = resource.attributes['allowed_purposes'] as string[] | undefined;
          // Simplified check - would need actual purpose from request
          return allowedPurposes === undefined || allowedPurposes.length > 0;
        },
        effect: 'warn',
        priority: 80,
      },
    ],
  };
}

/**
 * Create default HIPAA regulatory constraints
 */
export function createHIPAAConstraints(): RegulatoryConstraint {
  return {
    framework: 'HIPAA',
    enforced: true,
    requirements: [
      {
        id: 'hipaa-minimum-necessary',
        description: 'Access must follow minimum necessary standard',
        condition: (subject) => {
          // Check if subject has appropriate role for PHI access
          const allowedRoles = ['healthcare_provider', 'admin', 'auditor'];
          return subject.roles.some(role => allowedRoles.includes(role));
        },
        effect: 'deny',
        priority: 100,
      },
      {
        id: 'hipaa-authorization',
        description: 'PHI access requires valid authorization',
        condition: (_subject, resource) => {
          // Check if PHI data has authorization
          const classification = resource.classification;
          if (classification === 'restricted') {
            const hasAuthorization = resource.attributes['hipaa_authorization'] as boolean | undefined;
            return hasAuthorization === true;
          }
          return true;
        },
        effect: 'deny',
        priority: 90,
      },
      {
        id: 'hipaa-audit-trail',
        description: 'PHI access must be audited',
        condition: () => {
          // This is always true - audit will happen via DecisionEvent
          return true;
        },
        effect: 'audit',
        priority: 80,
      },
    ],
  };
}

/**
 * Create default CCPA regulatory constraints
 */
export function createCCPAConstraints(): RegulatoryConstraint {
  return {
    framework: 'CCPA',
    enforced: true,
    requirements: [
      {
        id: 'ccpa-opt-out',
        description: 'Respect consumer opt-out of sale',
        condition: (_subject, resource) => {
          // Check if consumer has opted out and this is a sale
          const optedOut = resource.attributes['ccpa_opted_out'] as boolean | undefined;
          const isSale = resource.attributes['is_sale'] as boolean | undefined;

          if (optedOut === true && isSale === true) {
            return false;
          }
          return true;
        },
        effect: 'deny',
        priority: 100,
      },
      {
        id: 'ccpa-consumer-rights',
        description: 'Honor consumer data rights requests',
        condition: (_subject, resource) => {
          const pendingDeletionRequest = resource.attributes['pending_deletion'] as boolean | undefined;
          return pendingDeletionRequest !== true;
        },
        effect: 'deny',
        priority: 90,
      },
    ],
  };
}

/**
 * Create a PolicyEvaluator with all default regulatory constraints
 */
export function createDefaultPolicyEvaluator(
  policies: AccessPolicy[],
  config?: Partial<PolicyEvaluatorConfig>
): PolicyEvaluator {
  const constraints = [
    createGDPRConstraints(),
    createHIPAAConstraints(),
    createCCPAConstraints(),
  ];

  return new PolicyEvaluator(policies, constraints, config);
}
