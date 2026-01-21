/**
 * LLM-Data-Vault: Dataset Anonymization Agent
 *
 * Public API for the Dataset Anonymization Agent module.
 *
 * This agent detects PII in datasets and applies appropriate anonymization
 * strategies to produce privacy-safe artifacts suitable for LLM training/inference.
 *
 * CRITICAL CONSTRAINTS:
 * - Agent MUST NOT execute inference
 * - Agent MUST NOT modify prompts (beyond anonymization)
 * - Agent MUST NOT route requests
 * - Agent MUST NOT trigger orchestration
 * - Agent produces privacy-safe artifacts ONLY
 *
 * @module dataset-anonymization
 *
 * @example
 * ```typescript
 * import {
 *   DatasetAnonymizationAgent,
 *   createAnonymizationAgent,
 * } from './agents/dataset-anonymization';
 *
 * // Create agent
 * const agent = createAnonymizationAgent({
 *   agentId: 'my-anonymization-agent',
 *   detector: { confidenceThreshold: 0.9 },
 * });
 *
 * // Anonymize data
 * const response = await agent.anonymize({
 *   request_id: crypto.randomUUID(),
 *   dataset_id: 'dataset-123',
 *   content: 'Contact john.doe@example.com at 555-123-4567',
 *   content_format: 'text',
 *   tenant_id: 'tenant-1',
 *   requester: { service: 'ml-pipeline' },
 * });
 *
 * console.log(response.anonymized_content);
 * // Output: "Contact [EMAIL_REDACTED] at [PHONE_REDACTED]"
 * ```
 */

// Main agent
export {
  DatasetAnonymizationAgent,
  createAnonymizationAgent,
  type AgentConfig,
} from './agent.js';

// PII Detection
export {
  PIIDetector,
  createPIIDetector,
  type DetectorConfig,
  type DetectionStats,
} from './pii-detector.js';

// Anonymization Strategies
export {
  mask,
  redact,
  hash,
  hashSync,
  generalize,
  synthesize,
  applyStrategy,
  applyStrategySync,
  type StrategyResult,
  type MaskConfig,
  type HashConfig,
  type GeneralizeConfig,
  type SynthesizeConfig,
  type DispatchConfig,
} from './anonymization-strategies.js';

// Compliance Rules
export {
  checkCompliance,
  checkGDPRCompliance,
  checkHIPAACompliance,
  checkCCPACompliance,
  getRecommendedStrategy,
  requiresMandatoryAnonymization,
  type ComplianceFramework,
  type ComplianceCheckResult,
  type ComplianceViolation,
  type FrameworkRequirements,
} from './compliance-rules.js';

// HTTP Handler (for Edge Function deployment)
export {
  main,
  anonymizeHandler,
  healthHandler,
} from './handler.js';
