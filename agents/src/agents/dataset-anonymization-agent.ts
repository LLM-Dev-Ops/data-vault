/**
 * LLM-Data-Vault: Dataset Anonymization Agent
 *
 * AGENT CONTRACT & BOUNDARY DEFINITION
 *
 * Agent Name: Dataset Anonymization Agent
 * Classification: DATASET ANONYMIZATION
 *
 * PURPOSE:
 * Apply anonymization, redaction, and privacy-preserving transformations
 * to datasets before LLM consumption.
 *
 * SCOPE:
 * - Apply anonymization rules
 * - Redact sensitive fields
 * - Produce privacy-safe dataset views
 * - Emit anonymization metadata
 *
 * decision_type: "dataset_anonymization"
 *
 * WHAT THIS AGENT MAY DO:
 * - Detect PII in dataset content
 * - Apply anonymization strategies (redact, mask, hash, tokenize, etc.)
 * - Apply regulatory compliance transformations (GDPR, HIPAA, CCPA)
 * - Produce anonymized dataset artifacts
 * - Emit structured DecisionEvents to ruvector-service
 *
 * WHAT THIS AGENT MUST NEVER DO:
 * - Execute model inference
 * - Modify prompts or responses
 * - Route inference requests
 * - Trigger orchestration or retries
 * - Apply optimizations automatically
 * - Perform analytics or forecasting
 * - Connect directly to databases
 * - Execute SQL
 *
 * PERSISTENCE:
 * - DecisionEvents persisted via ruvector-service ONLY
 * - Anonymized content is ephemeral (returned, not stored)
 * - Original content MUST NOT be persisted by this agent
 *
 * CLI INVOCATION:
 *   data-vault anonymize --dataset-id <id> --policy <policy-id>
 *   data-vault anonymize --input <json> --strategy <strategy>
 *
 * CONSUMERS:
 * - LLM-Orchestrator (for approved datasets)
 * - LLM-Inference-Gateway (for pre-inference data prep)
 * - Governance systems (via DecisionEvents)
 *
 * @module agents/dataset-anonymization-agent
 */

import { v4 as uuidv4 } from 'uuid';
import {
  DataVaultAgent,
  AgentMetadata,
  ExecutionContext,
} from '../runtime/agent-base.js';
import {
  AnonymizationRequest,
  AnonymizationResponse,
  validateAnonymizationRequest,
  validateAnonymizationResponse,
  DecisionType,
  AppliedConstraint,
  ConfidenceBreakdown,
  PIIType,
  AnonymizationStrategy,
  FieldAnonymizationResult,
} from '../contracts/index.js';
import { getTelemetry } from '../telemetry/index.js';

/**
 * PII Detection result
 */
interface PIIDetection {
  field_path: string;
  pii_type: PIIType;
  confidence: number;
  start_offset?: number;
  end_offset?: number;
  value_hash: string;
}

/**
 * Dataset Anonymization Agent
 *
 * Applies anonymization, redaction, and privacy-preserving transformations
 * to datasets before LLM consumption.
 */
export class DatasetAnonymizationAgent extends DataVaultAgent<
  AnonymizationRequest,
  AnonymizationResponse
> {
  private static readonly AGENT_ID = 'data-vault.anonymization.v1';
  private static readonly AGENT_VERSION = '0.1.0';

  // PII detection patterns (simplified - in production, use the Rust engine)
  private readonly piiPatterns: Map<PIIType, RegExp[]> = new Map([
    ['email', [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi]],
    ['phone_number', [/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, /\+\d{1,3}[-.\s]?\d{1,14}\b/g]],
    ['ssn', [/\b\d{3}-\d{2}-\d{4}\b/g]],
    ['credit_card', [/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g]],
    ['ip_address', [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g]],
    ['date_of_birth', [/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g]],
    ['api_key', [/\b(sk|pk|api)[_-][a-zA-Z0-9]{20,}\b/gi]],
    ['password', [/password\s*[:=]\s*['"]?[^\s'"]+['"]?/gi]],
  ]);

  constructor() {
    const metadata: AgentMetadata = {
      agent_id: DatasetAnonymizationAgent.AGENT_ID,
      agent_version: DatasetAnonymizationAgent.AGENT_VERSION,
      classification: 'DATASET_ANONYMIZATION',
      name: 'Dataset Anonymization Agent',
      description: 'Apply anonymization, redaction, and privacy-preserving transformations to datasets',
      supported_operations: ['anonymize', 'redact', 'inspect'],
    };
    super(metadata);
  }

  /**
   * Validate incoming request
   */
  protected validateRequest(request: unknown): AnonymizationRequest {
    return validateAnonymizationRequest(request);
  }

  /**
   * Validate outgoing response
   */
  protected validateResponse(response: unknown): AnonymizationResponse {
    return validateAnonymizationResponse(response);
  }

  /**
   * Get decision type for this agent
   */
  protected getDecisionType(): DecisionType {
    return 'dataset_anonymization';
  }

  /**
   * Execute core anonymization logic
   */
  protected async executeCore(
    request: AnonymizationRequest,
    context: ExecutionContext
  ): Promise<{
    response: AnonymizationResponse;
    confidence: ConfidenceBreakdown;
    constraints: AppliedConstraint[];
  }> {
    const telemetry = getTelemetry();
    const constraints: AppliedConstraint[] = [];
    const fieldResults: FieldAnonymizationResult[] = [];

    // Track detection statistics
    const detectionBreakdown: Partial<Record<PIIType, number>> = {};
    let totalPIIDetections = 0;
    let fieldsAnonymized = 0;
    let totalFieldsProcessed = 0;

    // Get anonymization strategy
    const defaultStrategy = request.policy?.default_strategy ?? 'redact';
    const strategies = request.strategies ?? {};

    // Anonymize content based on type
    let anonymizedContent: unknown;

    if (typeof request.content === 'string') {
      const { anonymized, detections } = await this.anonymizeText(
        request.content,
        defaultStrategy,
        strategies,
        request.policy?.min_detection_confidence ?? 0.85
      );
      anonymizedContent = anonymized;
      totalFieldsProcessed = 1;

      for (const detection of detections) {
        totalPIIDetections++;
        detectionBreakdown[detection.pii_type] =
          (detectionBreakdown[detection.pii_type] ?? 0) + 1;

        fieldResults.push({
          field_path: '$',
          pii_type: detection.pii_type,
          strategy_applied: strategies[detection.pii_type] ?? defaultStrategy,
          confidence: detection.confidence,
          original_hash: detection.value_hash,
        });
      }

      if (detections.length > 0) {
        fieldsAnonymized = 1;
      }
    } else if (Array.isArray(request.content)) {
      // Array of records
      const anonymizedRecords: Record<string, unknown>[] = [];

      for (const record of request.content) {
        const { anonymized, stats } = await this.anonymizeRecord(
          record as Record<string, unknown>,
          defaultStrategy,
          strategies,
          request.policy?.min_detection_confidence ?? 0.85,
          request.policy?.field_rules ?? [],
          fieldResults
        );
        anonymizedRecords.push(anonymized);
        totalFieldsProcessed += stats.fieldsProcessed;
        fieldsAnonymized += stats.fieldsAnonymized;
        totalPIIDetections += stats.piiDetections;

        for (const [type, count] of Object.entries(stats.detectionBreakdown)) {
          detectionBreakdown[type as PIIType] =
            (detectionBreakdown[type as PIIType] ?? 0) + (count as number);
        }
      }

      anonymizedContent = anonymizedRecords;
    } else {
      // Single record
      const { anonymized, stats } = await this.anonymizeRecord(
        request.content as Record<string, unknown>,
        defaultStrategy,
        strategies,
        request.policy?.min_detection_confidence ?? 0.85,
        request.policy?.field_rules ?? [],
        fieldResults
      );
      anonymizedContent = anonymized;
      totalFieldsProcessed = stats.fieldsProcessed;
      fieldsAnonymized = stats.fieldsAnonymized;
      totalPIIDetections = stats.piiDetections;

      for (const [type, count] of Object.entries(stats.detectionBreakdown)) {
        detectionBreakdown[type as PIIType] =
          (detectionBreakdown[type as PIIType] ?? 0) + (count as number);
      }
    }

    // Record telemetry
    telemetry.recordPIIDetection(
      this.metadata.agent_id,
      context.execution_ref,
      totalPIIDetections,
      detectionBreakdown as Record<string, number>
    );

    telemetry.recordAnonymization(
      this.metadata.agent_id,
      context.execution_ref,
      fieldsAnonymized,
      { [defaultStrategy]: fieldsAnonymized }
    );

    // Build constraints
    if (totalPIIDetections > 0) {
      constraints.push({
        type: 'pii_detected',
        description: `Detected ${totalPIIDetections} PII instances across ${Object.keys(detectionBreakdown).length} types`,
        severity: 'info',
        metadata: { detection_breakdown: detectionBreakdown },
      });

      constraints.push({
        type: this.getConstraintTypeForStrategy(defaultStrategy),
        description: `Applied ${defaultStrategy} strategy to ${fieldsAnonymized} fields`,
        severity: 'info',
        metadata: { strategy: defaultStrategy },
      });
    }

    // Add compliance constraints
    const complianceFrameworks = request.policy?.compliance_frameworks ?? [];
    for (const framework of complianceFrameworks) {
      constraints.push({
        type: `${framework}_compliance` as AppliedConstraint['type'],
        description: `Anonymization applied in compliance with ${framework.toUpperCase()}`,
        severity: 'info',
      });
    }

    // Calculate confidence
    const avgDetectionConfidence = fieldResults.length > 0
      ? fieldResults.reduce((sum, r) => sum + r.confidence, 0) / fieldResults.length
      : 1.0;

    const confidence: ConfidenceBreakdown = {
      policy_match: request.policy ? 1.0 : 0.5,
      anonymization_certainty: avgDetectionConfidence,
      detection_confidence: avgDetectionConfidence,
    };

    // Build compliance attestation
    const attestationData = JSON.stringify({
      timestamp: new Date().toISOString(),
      execution_ref: context.execution_ref,
      fields_anonymized: fieldsAnonymized,
      frameworks: complianceFrameworks,
    });
    const attestationHash = await this.hashString(attestationData);

    // Build response
    const response: AnonymizationResponse = {
      request_id: request.request_id,
      anonymized_content: anonymizedContent as string | Record<string, unknown> | Record<string, unknown>[],
      results: {
        total_fields_processed: totalFieldsProcessed,
        fields_anonymized: fieldsAnonymized,
        pii_detections: totalPIIDetections,
        detection_breakdown: detectionBreakdown as Record<PIIType, number>,
      },
      field_results: request.options.include_detection_details ? fieldResults : undefined,
      compliance: {
        frameworks_satisfied: complianceFrameworks,
        attestation_hash: attestationHash,
        timestamp: new Date().toISOString(),
      },
      warnings: [],
    };

    return { response, confidence, constraints };
  }

  /**
   * Anonymize text content
   */
  private async anonymizeText(
    text: string,
    defaultStrategy: AnonymizationStrategy,
    strategies: Partial<Record<PIIType, AnonymizationStrategy>>,
    minConfidence: number
  ): Promise<{ anonymized: string; detections: PIIDetection[] }> {
    const detections: PIIDetection[] = [];
    let anonymized = text;

    // Detect and replace PII
    for (const [piiType, patterns] of this.piiPatterns) {
      for (const pattern of patterns) {
        const matches = Array.from(anonymized.matchAll(pattern));

        for (const match of matches) {
          if (!match[0]) continue;

          const confidence = this.calculateConfidence(piiType, match[0]);
          if (confidence < minConfidence) continue;

          const detection: PIIDetection = {
            field_path: '$',
            pii_type: piiType,
            confidence,
            start_offset: match.index,
            end_offset: match.index! + match[0].length,
            value_hash: await this.hashString(match[0]),
          };
          detections.push(detection);

          // Apply strategy
          const strategy = strategies[piiType] ?? defaultStrategy;
          const replacement = this.applyStrategy(strategy, match[0], piiType);
          anonymized = anonymized.replace(match[0], replacement);
        }
      }
    }

    return { anonymized, detections };
  }

  /**
   * Anonymize a record (object)
   */
  private async anonymizeRecord(
    record: Record<string, unknown>,
    defaultStrategy: AnonymizationStrategy,
    strategies: Partial<Record<PIIType, AnonymizationStrategy>>,
    minConfidence: number,
    fieldRules: Array<{ field_path: string; pii_types: PIIType[]; strategy: AnonymizationStrategy }>,
    fieldResults: FieldAnonymizationResult[]
  ): Promise<{
    anonymized: Record<string, unknown>;
    stats: {
      fieldsProcessed: number;
      fieldsAnonymized: number;
      piiDetections: number;
      detectionBreakdown: Partial<Record<PIIType, number>>;
    };
  }> {
    const anonymized: Record<string, unknown> = {};
    let fieldsProcessed = 0;
    let fieldsAnonymized = 0;
    let piiDetections = 0;
    const detectionBreakdown: Partial<Record<PIIType, number>> = {};

    for (const [key, value] of Object.entries(record)) {
      fieldsProcessed++;

      // Check for field-specific rules
      const fieldRule = fieldRules.find(r => r.field_path === key);

      if (typeof value === 'string') {
        // Check if this field has a specific rule
        if (fieldRule) {
          const strategy = fieldRule.strategy;
          const replacement = this.applyStrategy(strategy, value, fieldRule.pii_types[0] ?? 'custom');
          anonymized[key] = replacement;

          if (replacement !== value) {
            fieldsAnonymized++;
            piiDetections++;

            fieldResults.push({
              field_path: key,
              pii_type: fieldRule.pii_types[0] ?? 'custom',
              strategy_applied: strategy,
              confidence: 1.0,
              original_hash: await this.hashString(value),
            });

            const piiType = fieldRule.pii_types[0] ?? 'custom';
            detectionBreakdown[piiType] = (detectionBreakdown[piiType] ?? 0) + 1;
          }
        } else {
          // Auto-detect PII
          const { anonymized: anonymizedText, detections } = await this.anonymizeText(
            value,
            defaultStrategy,
            strategies,
            minConfidence
          );
          anonymized[key] = anonymizedText;

          if (detections.length > 0) {
            fieldsAnonymized++;
            piiDetections += detections.length;

            for (const detection of detections) {
              fieldResults.push({
                field_path: key,
                pii_type: detection.pii_type,
                strategy_applied: strategies[detection.pii_type] ?? defaultStrategy,
                confidence: detection.confidence,
                original_hash: detection.value_hash,
              });

              detectionBreakdown[detection.pii_type] =
                (detectionBreakdown[detection.pii_type] ?? 0) + 1;
            }
          }
        }
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Recursively process nested objects
        const nested = await this.anonymizeRecord(
          value as Record<string, unknown>,
          defaultStrategy,
          strategies,
          minConfidence,
          fieldRules.map(r => ({
            ...r,
            field_path: r.field_path.replace(`${key}.`, ''),
          })).filter(r => r.field_path !== r.field_path),
          fieldResults
        );
        anonymized[key] = nested.anonymized;
        fieldsProcessed += nested.stats.fieldsProcessed;
        fieldsAnonymized += nested.stats.fieldsAnonymized;
        piiDetections += nested.stats.piiDetections;

        for (const [type, count] of Object.entries(nested.stats.detectionBreakdown)) {
          detectionBreakdown[type as PIIType] =
            (detectionBreakdown[type as PIIType] ?? 0) + (count as number);
        }
      } else {
        // Keep other types as-is
        anonymized[key] = value;
      }
    }

    return {
      anonymized,
      stats: {
        fieldsProcessed,
        fieldsAnonymized,
        piiDetections,
        detectionBreakdown,
      },
    };
  }

  /**
   * Apply anonymization strategy
   */
  private applyStrategy(
    strategy: AnonymizationStrategy,
    value: string,
    piiType: PIIType
  ): string {
    switch (strategy) {
      case 'redact':
        return '[REDACTED]';

      case 'mask':
        if (value.length <= 4) {
          return '*'.repeat(value.length);
        }
        return value.substring(0, 2) + '*'.repeat(value.length - 4) + value.substring(value.length - 2);

      case 'hash':
        // Synchronous simple hash for display (real hash is async)
        return `[HASH:${this.simpleHash(value).substring(0, 8)}]`;

      case 'tokenize':
        return `[TOKEN:${piiType.toUpperCase()}:${uuidv4().substring(0, 8)}]`;

      case 'generalize':
        return this.generalize(value, piiType);

      case 'suppress':
        return '';

      case 'pseudonymize':
        return this.pseudonymize(value, piiType);

      default:
        return '[REDACTED]';
    }
  }

  /**
   * Generalize a value based on PII type
   */
  private generalize(value: string, piiType: PIIType): string {
    switch (piiType) {
      case 'email':
        return '[EMAIL]';
      case 'phone_number':
        return '[PHONE]';
      case 'age':
        const age = parseInt(value, 10);
        if (age < 18) return '< 18';
        if (age < 30) return '18-29';
        if (age < 50) return '30-49';
        if (age < 65) return '50-64';
        return '65+';
      case 'zip_code':
        return value.substring(0, 3) + '**';
      case 'date_of_birth':
        return '[DATE]';
      default:
        return `[${piiType.toUpperCase()}]`;
    }
  }

  /**
   * Pseudonymize a value
   */
  private pseudonymize(value: string, piiType: PIIType): string {
    const hash = this.simpleHash(value);
    switch (piiType) {
      case 'person_name':
        return `Person_${hash.substring(0, 6)}`;
      case 'email':
        return `user_${hash.substring(0, 6)}@example.com`;
      case 'phone_number':
        return `555-${hash.substring(0, 3)}-${hash.substring(3, 7)}`;
      default:
        return `${piiType}_${hash.substring(0, 8)}`;
    }
  }

  /**
   * Calculate detection confidence
   */
  private calculateConfidence(piiType: PIIType, value: string): number {
    // Base confidence by type
    const baseConfidence: Partial<Record<PIIType, number>> = {
      email: 0.95,
      ssn: 0.98,
      credit_card: 0.95,
      phone_number: 0.85,
      ip_address: 0.90,
      api_key: 0.92,
      password: 0.88,
      date_of_birth: 0.80,
    };

    let confidence = baseConfidence[piiType] ?? 0.85;

    // Adjust based on value characteristics
    if (piiType === 'credit_card') {
      // Luhn check would increase confidence
      confidence = this.luhnCheck(value.replace(/\D/g, '')) ? 0.99 : 0.70;
    }

    if (piiType === 'email') {
      // More specific domain patterns increase confidence
      if (value.includes('@gmail.com') || value.includes('@yahoo.com')) {
        confidence = 0.98;
      }
    }

    return confidence;
  }

  /**
   * Luhn algorithm for credit card validation
   */
  private luhnCheck(num: string): boolean {
    let sum = 0;
    let isEven = false;

    for (let i = num.length - 1; i >= 0; i--) {
      let digit = parseInt(num[i]!, 10);

      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }

  /**
   * Simple synchronous hash (for display purposes)
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Async SHA-256 hash
   */
  private async hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Map strategy to constraint type
   */
  private getConstraintTypeForStrategy(strategy: AnonymizationStrategy): AppliedConstraint['type'] {
    switch (strategy) {
      case 'redact':
        return 'pii_redacted';
      case 'mask':
        return 'pii_masked';
      case 'tokenize':
        return 'pii_tokenized';
      default:
        return 'pii_redacted';
    }
  }
}

/**
 * Create a new Dataset Anonymization Agent instance
 */
export function createAnonymizationAgent(): DatasetAnonymizationAgent {
  return new DatasetAnonymizationAgent();
}
