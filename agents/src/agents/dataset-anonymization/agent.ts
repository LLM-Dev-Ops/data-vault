/**
 * LLM-Data-Vault: Dataset Anonymization Agent
 *
 * Main agent implementation for dataset anonymization.
 * This agent detects PII and applies anonymization strategies to produce
 * privacy-safe dataset artifacts.
 *
 * CRITICAL CONSTRAINTS:
 * - Agent MUST NOT execute inference
 * - Agent MUST NOT modify prompts (beyond anonymization)
 * - Agent MUST NOT route requests
 * - Agent MUST NOT trigger orchestration
 * - Agent produces privacy-safe artifacts ONLY
 *
 * @module dataset-anonymization/agent
 */

import {
  type AnonymizationRequest,
  type AnonymizationResponse,
  type PIIMatch,
  type PIIType,
  type AnonymizationStrategy,
  type FieldAnonymizationResult,
  validateAnonymizationRequest,
  createDecisionEvent,
  type DecisionEvent,
  type AppliedConstraint,
} from '../../contracts/index.js';
import { RuVectorClient, createRuVectorClient } from '../../ruvector-client/index.js';
import { PIIDetector, type DetectorConfig } from './pii-detector.js';
import { applyStrategy, type DispatchConfig } from './anonymization-strategies.js';
import {
  checkCompliance,
  type ComplianceFramework,
  type ComplianceCheckResult,
  getRecommendedStrategy,
} from './compliance-rules.js';

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Agent identifier */
  agentId?: string;
  /** Agent version */
  agentVersion?: string;
  /** PII detector configuration */
  detector?: DetectorConfig;
  /** Anonymization strategy configuration */
  strategies?: DispatchConfig;
  /** RuVector client (optional - will create from env if not provided) */
  ruVectorClient?: RuVectorClient;
  /** Emit decision events to RuVector */
  emitDecisionEvents?: boolean;
}

/**
 * Anonymization metrics
 */
interface AnonymizationMetrics {
  totalFieldsProcessed: number;
  fieldsAnonymized: number;
  piiDetections: number;
  detectionBreakdown: Partial<Record<PIIType, number>>;
  processingTimeMs: number;
  averageConfidence: number;
}

/**
 * Dataset Anonymization Agent
 *
 * Detects PII in datasets and applies appropriate anonymization strategies
 * to produce privacy-safe artifacts suitable for LLM training/inference.
 */
export class DatasetAnonymizationAgent {
  private readonly agentId: string;
  private readonly agentVersion: string;
  private readonly detector: PIIDetector;
  private readonly strategyConfig: DispatchConfig;
  private readonly ruVectorClient: RuVectorClient | null;
  private readonly emitDecisionEvents: boolean;

  constructor(config: AgentConfig = {}) {
    this.agentId = config.agentId ?? 'dataset-anonymization-agent';
    this.agentVersion = config.agentVersion ?? '1.0.0';
    this.detector = new PIIDetector(config.detector);
    this.strategyConfig = config.strategies ?? {};
    this.emitDecisionEvents = config.emitDecisionEvents ?? true;

    // Initialize RuVector client
    if (config.ruVectorClient) {
      this.ruVectorClient = config.ruVectorClient;
    } else if (this.emitDecisionEvents) {
      try {
        this.ruVectorClient = createRuVectorClient();
      } catch {
        // RuVector not configured - proceed without event emission
        this.ruVectorClient = null;
      }
    } else {
      this.ruVectorClient = null;
    }
  }

  /**
   * Anonymize dataset content
   *
   * Main entry point for anonymization. Processes the request, detects PII,
   * applies strategies, checks compliance, and emits decision events.
   *
   * @param request - Anonymization request
   * @returns Anonymization response with privacy-safe content
   */
  async anonymize(request: AnonymizationRequest): Promise<AnonymizationResponse> {
    // Validate request
    const validatedRequest = validateAnonymizationRequest(request);

    // Extract policy settings
    const policy = validatedRequest.policy;
    const strategyOverrides = validatedRequest.strategies ?? {};
    const defaultStrategy = policy?.default_strategy ?? 'redact';
    const complianceFrameworks = policy?.compliance_frameworks ?? [];
    const minConfidence = policy?.min_detection_confidence ?? 0.85;

    // Process content based on format
    const {
      anonymizedContent,
      allDetections,
      fieldResults,
      metrics,
    } = await this.processContent(
      validatedRequest.content,
      validatedRequest.content_format,
      defaultStrategy,
      strategyOverrides,
      minConfidence,
      complianceFrameworks
    );

    // Calculate overall confidence score (used for logging/metrics)
    this.calculateConfidenceScore(allDetections, metrics);

    // Check compliance
    const appliedStrategies = this.buildAppliedStrategiesMap(allDetections, strategyOverrides, defaultStrategy);
    const complianceResults = checkCompliance(
      complianceFrameworks as ComplianceFramework[],
      allDetections,
      appliedStrategies
    );

    // Generate compliance attestation
    const complianceAttestation = this.generateComplianceAttestation(
      complianceResults,
      validatedRequest.request_id
    );

    // Build response
    const response: AnonymizationResponse = {
      request_id: validatedRequest.request_id,
      anonymized_content: anonymizedContent,
      results: {
        total_fields_processed: metrics.totalFieldsProcessed,
        fields_anonymized: metrics.fieldsAnonymized,
        pii_detections: metrics.piiDetections,
        detection_breakdown: metrics.detectionBreakdown as Record<PIIType, number>,
      },
      field_results: validatedRequest.options.include_detection_details ? fieldResults : undefined,
      compliance: complianceAttestation,
      warnings: this.generateWarnings(complianceResults, allDetections),
    };

    // Emit decision event
    if (this.emitDecisionEvents && this.ruVectorClient) {
      await this.emitDecisionEvent(validatedRequest, response, metrics, complianceResults);
    }

    return response;
  }

  /**
   * Process content based on format
   */
  private async processContent(
    content: AnonymizationRequest['content'],
    _format: AnonymizationRequest['content_format'],
    defaultStrategy: AnonymizationStrategy,
    strategyOverrides: Partial<Record<PIIType, AnonymizationStrategy>>,
    minConfidence: number,
    complianceFrameworks: string[]
  ): Promise<{
    anonymizedContent: AnonymizationResponse['anonymized_content'];
    allDetections: PIIMatch[];
    fieldResults: FieldAnonymizationResult[];
    metrics: AnonymizationMetrics;
  }> {
    const allDetections: PIIMatch[] = [];
    const fieldResults: FieldAnonymizationResult[] = [];
    const metrics: AnonymizationMetrics = {
      totalFieldsProcessed: 0,
      fieldsAnonymized: 0,
      piiDetections: 0,
      detectionBreakdown: {},
      processingTimeMs: 0,
      averageConfidence: 0,
    };

    const startTime = performance.now();
    let anonymizedContent: AnonymizationResponse['anonymized_content'];

    if (typeof content === 'string') {
      // Plain text processing
      const result = await this.processText(
        content,
        defaultStrategy,
        strategyOverrides,
        minConfidence,
        complianceFrameworks as ComplianceFramework[]
      );
      anonymizedContent = result.anonymizedText;
      allDetections.push(...result.detections);
      metrics.totalFieldsProcessed = 1;
      metrics.fieldsAnonymized = result.detections.length > 0 ? 1 : 0;
    } else if (Array.isArray(content)) {
      if (content.length > 0 && typeof content[0] === 'object') {
        // Array of records (JSON/JSONL)
        const anonymizedRecords: Array<Record<string, unknown>> = [];

        for (const record of content as Array<Record<string, unknown>>) {
          const result = await this.processRecord(
            record,
            '',
            defaultStrategy,
            strategyOverrides,
            minConfidence,
            complianceFrameworks as ComplianceFramework[]
          );
          anonymizedRecords.push(result.anonymizedRecord);
          allDetections.push(...result.detections);
          fieldResults.push(...result.fieldResults);
          metrics.totalFieldsProcessed += result.fieldsProcessed;
          metrics.fieldsAnonymized += result.fieldsAnonymized;
        }

        anonymizedContent = anonymizedRecords;
      } else {
        // Array of strings - wrap in objects for type compatibility
        const anonymizedRecords: Array<Record<string, unknown>> = [];

        for (let i = 0; i < (content as unknown[]).length; i++) {
          const text = (content as unknown[])[i];
          if (typeof text === 'string') {
            const result = await this.processText(
              text,
              defaultStrategy,
              strategyOverrides,
              minConfidence,
              complianceFrameworks as ComplianceFramework[]
            );
            anonymizedRecords.push({ index: i, content: result.anonymizedText });
            allDetections.push(...result.detections);
            metrics.totalFieldsProcessed += 1;
            metrics.fieldsAnonymized += result.detections.length > 0 ? 1 : 0;
          } else {
            anonymizedRecords.push({ index: i, content: text });
          }
        }

        anonymizedContent = anonymizedRecords;
      }
    } else {
      // Single record
      const result = await this.processRecord(
        content,
        '',
        defaultStrategy,
        strategyOverrides,
        minConfidence,
        complianceFrameworks as ComplianceFramework[]
      );
      anonymizedContent = result.anonymizedRecord;
      allDetections.push(...result.detections);
      fieldResults.push(...result.fieldResults);
      metrics.totalFieldsProcessed = result.fieldsProcessed;
      metrics.fieldsAnonymized = result.fieldsAnonymized;
    }

    // Finalize metrics
    metrics.piiDetections = allDetections.length;
    metrics.processingTimeMs = performance.now() - startTime;

    for (const detection of allDetections) {
      metrics.detectionBreakdown[detection.pii_type] =
        (metrics.detectionBreakdown[detection.pii_type] ?? 0) + 1;
    }

    metrics.averageConfidence = allDetections.length > 0
      ? allDetections.reduce((sum, d) => sum + d.confidence, 0) / allDetections.length
      : 1.0;

    return { anonymizedContent, allDetections, fieldResults, metrics };
  }

  /**
   * Process a single text string
   */
  private async processText(
    text: string,
    defaultStrategy: AnonymizationStrategy,
    strategyOverrides: Partial<Record<PIIType, AnonymizationStrategy>>,
    minConfidence: number,
    complianceFrameworks: ComplianceFramework[]
  ): Promise<{
    anonymizedText: string;
    detections: PIIMatch[];
  }> {
    // Detect PII
    const detections = this.detector.detect(text).filter(d => d.confidence >= minConfidence);

    if (detections.length === 0) {
      return { anonymizedText: text, detections };
    }

    // Sort by position (reverse) for safe string replacement
    const sortedDetections = [...detections].sort((a, b) => b.start_offset - a.start_offset);

    // Apply anonymization strategies
    let anonymizedText = text;

    for (const detection of sortedDetections) {
      const strategy = strategyOverrides[detection.pii_type]
        ?? getRecommendedStrategy(detection.pii_type, complianceFrameworks)
        ?? defaultStrategy;

      const result = await applyStrategy(strategy, text, detection, this.strategyConfig);
      anonymizedText =
        anonymizedText.slice(0, detection.start_offset) +
        result.replacement +
        anonymizedText.slice(detection.end_offset);
    }

    return { anonymizedText, detections };
  }

  /**
   * Process a record (object) recursively
   */
  private async processRecord(
    record: Record<string, unknown>,
    pathPrefix: string,
    defaultStrategy: AnonymizationStrategy,
    strategyOverrides: Partial<Record<PIIType, AnonymizationStrategy>>,
    minConfidence: number,
    complianceFrameworks: ComplianceFramework[]
  ): Promise<{
    anonymizedRecord: Record<string, unknown>;
    detections: PIIMatch[];
    fieldResults: FieldAnonymizationResult[];
    fieldsProcessed: number;
    fieldsAnonymized: number;
  }> {
    const anonymizedRecord: Record<string, unknown> = {};
    const detections: PIIMatch[] = [];
    const fieldResults: FieldAnonymizationResult[] = [];
    let fieldsProcessed = 0;
    let fieldsAnonymized = 0;

    for (const [key, value] of Object.entries(record)) {
      const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;

      if (typeof value === 'string') {
        fieldsProcessed++;
        const result = await this.processText(
          value,
          defaultStrategy,
          strategyOverrides,
          minConfidence,
          complianceFrameworks
        );
        anonymizedRecord[key] = result.anonymizedText;

        if (result.detections.length > 0) {
          fieldsAnonymized++;
          detections.push(...result.detections);

          for (const detection of result.detections) {
            const strategy = strategyOverrides[detection.pii_type]
              ?? getRecommendedStrategy(detection.pii_type, complianceFrameworks)
              ?? defaultStrategy;

            fieldResults.push({
              field_path: fieldPath,
              pii_type: detection.pii_type,
              strategy_applied: strategy,
              confidence: detection.confidence,
              original_hash: this.hashString(value),
            });
          }
        }
      } else if (Array.isArray(value)) {
        const anonymizedArray: unknown[] = [];

        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          const itemPath = `${fieldPath}[${i}]`;

          if (typeof item === 'string') {
            fieldsProcessed++;
            const result = await this.processText(
              item,
              defaultStrategy,
              strategyOverrides,
              minConfidence,
              complianceFrameworks
            );
            anonymizedArray.push(result.anonymizedText);

            if (result.detections.length > 0) {
              fieldsAnonymized++;
              detections.push(...result.detections);
            }
          } else if (typeof item === 'object' && item !== null) {
            const result = await this.processRecord(
              item as Record<string, unknown>,
              itemPath,
              defaultStrategy,
              strategyOverrides,
              minConfidence,
              complianceFrameworks
            );
            anonymizedArray.push(result.anonymizedRecord);
            detections.push(...result.detections);
            fieldResults.push(...result.fieldResults);
            fieldsProcessed += result.fieldsProcessed;
            fieldsAnonymized += result.fieldsAnonymized;
          } else {
            anonymizedArray.push(item);
          }
        }

        anonymizedRecord[key] = anonymizedArray;
      } else if (typeof value === 'object' && value !== null) {
        const result = await this.processRecord(
          value as Record<string, unknown>,
          fieldPath,
          defaultStrategy,
          strategyOverrides,
          minConfidence,
          complianceFrameworks
        );
        anonymizedRecord[key] = result.anonymizedRecord;
        detections.push(...result.detections);
        fieldResults.push(...result.fieldResults);
        fieldsProcessed += result.fieldsProcessed;
        fieldsAnonymized += result.fieldsAnonymized;
      } else {
        // Preserve non-string values (numbers, booleans, null)
        anonymizedRecord[key] = value;
      }
    }

    return { anonymizedRecord, detections, fieldResults, fieldsProcessed, fieldsAnonymized };
  }

  /**
   * Calculate overall confidence score
   */
  private calculateConfidenceScore(
    detections: PIIMatch[],
    metrics: AnonymizationMetrics
  ): number {
    if (detections.length === 0) {
      // No PII detected - high confidence in result
      return 1.0;
    }

    // Score based on detection confidence and coverage
    const avgDetectionConfidence = metrics.averageConfidence;
    const coverageRatio = metrics.fieldsAnonymized / Math.max(metrics.totalFieldsProcessed, 1);

    // Weight: 60% detection confidence, 40% coverage
    return avgDetectionConfidence * 0.6 + coverageRatio * 0.4;
  }

  /**
   * Build map of PII types to applied strategies
   */
  private buildAppliedStrategiesMap(
    detections: PIIMatch[],
    strategyOverrides: Partial<Record<PIIType, AnonymizationStrategy>>,
    defaultStrategy: AnonymizationStrategy
  ): Map<PIIType, AnonymizationStrategy> {
    const map = new Map<PIIType, AnonymizationStrategy>();

    for (const detection of detections) {
      const strategy = strategyOverrides[detection.pii_type] ?? defaultStrategy;
      map.set(detection.pii_type, strategy);
    }

    return map;
  }

  /**
   * Generate compliance attestation
   */
  private generateComplianceAttestation(
    complianceResults: Map<ComplianceFramework, ComplianceCheckResult>,
    requestId: string
  ): AnonymizationResponse['compliance'] {
    const satisfiedFrameworks: string[] = [];

    for (const [framework, result] of complianceResults) {
      if (result.compliant) {
        satisfiedFrameworks.push(framework);
      }
    }

    const attestationData = {
      requestId,
      frameworks: Array.from(complianceResults.entries()).map(([f, r]) => ({
        framework: f,
        compliant: r.compliant,
        violations: r.violations.length,
      })),
      timestamp: new Date().toISOString(),
    };

    return {
      frameworks_satisfied: satisfiedFrameworks,
      attestation_hash: this.hashString(JSON.stringify(attestationData)),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate warnings from compliance results
   */
  private generateWarnings(
    complianceResults: Map<ComplianceFramework, ComplianceCheckResult>,
    detections: PIIMatch[]
  ): AnonymizationResponse['warnings'] {
    const warnings: AnonymizationResponse['warnings'] = [];

    // Add compliance violations as warnings
    for (const [framework, result] of complianceResults) {
      for (const violation of result.violations) {
        if (violation.severity !== 'critical') {
          warnings.push({
            code: `${framework.toUpperCase()}_${violation.code}`,
            message: violation.description,
            field_path: violation.fieldPath,
          });
        }
      }
    }

    // Add low-confidence detection warnings
    const lowConfidenceDetections = detections.filter(d => d.confidence < 0.9);
    if (lowConfidenceDetections.length > 0) {
      warnings.push({
        code: 'LOW_CONFIDENCE_DETECTIONS',
        message: `${lowConfidenceDetections.length} detection(s) have confidence < 90%`,
      });
    }

    return warnings;
  }

  /**
   * Emit decision event to RuVector service
   */
  private async emitDecisionEvent(
    request: AnonymizationRequest,
    response: AnonymizationResponse,
    metrics: AnonymizationMetrics,
    complianceResults: Map<ComplianceFramework, ComplianceCheckResult>
  ): Promise<void> {
    if (!this.ruVectorClient) return;

    // Build constraints applied
    const constraintsApplied: AppliedConstraint[] = [];

    for (const [piiType, count] of Object.entries(metrics.detectionBreakdown)) {
      if (count > 0) {
        constraintsApplied.push({
          type: 'pii_detected',
          description: `Detected ${count} ${piiType} instance(s)`,
          severity: 'info',
          metadata: { pii_type: piiType, count },
        });
      }
    }

    for (const [framework, result] of complianceResults) {
      constraintsApplied.push({
        type: `${framework}_compliance` as AppliedConstraint['type'],
        description: result.compliant ? `${framework} compliant` : `${framework} violations found`,
        severity: result.compliant ? 'info' : 'warning',
        metadata: {
          framework,
          compliant: result.compliant,
          violations: result.violations.length,
        },
      });
    }

    // Create decision event
    const event: DecisionEvent = createDecisionEvent({
      agent_id: this.agentId,
      agent_version: this.agentVersion,
      decision_type: 'dataset_anonymization',
      inputs_hash: this.hashString(JSON.stringify({
        request_id: request.request_id,
        dataset_id: request.dataset_id,
        tenant_id: request.tenant_id,
      })),
      outputs: {
        total_detections: metrics.piiDetections,
        fields_anonymized: metrics.fieldsAnonymized,
        compliance_satisfied: response.compliance.frameworks_satisfied,
      },
      confidence: {
        policy_match: 1.0,
        anonymization_certainty: metrics.averageConfidence,
        detection_confidence: metrics.averageConfidence,
      },
      constraints_applied: constraintsApplied,
      correlation_id: request.correlation_id,
      tenant_id: request.tenant_id,
      request_source: 'api',
    });

    // Persist event (fire and forget - don't block on result)
    this.ruVectorClient.persistDecisionEvent(event).catch(err => {
      console.error('Failed to persist decision event:', err);
    });
  }

  /**
   * Simple string hashing for audit purposes
   */
  private hashString(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0');
  }
}

/**
 * Create a Dataset Anonymization Agent with default configuration
 */
export function createAnonymizationAgent(config?: AgentConfig): DatasetAnonymizationAgent {
  return new DatasetAnonymizationAgent(config);
}
