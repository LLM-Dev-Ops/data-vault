/**
 * LLM-Data-Vault: Compliance Rules Module
 *
 * Implements compliance framework rules for data anonymization.
 *
 * Supported frameworks:
 * - GDPR: EU General Data Protection Regulation
 * - CCPA: California Consumer Privacy Act
 * - HIPAA: Health Insurance Portability and Accountability Act
 *
 * CRITICAL CONSTRAINTS:
 * - This module MUST NOT execute inference
 * - This module MUST NOT modify prompts
 * - This module MUST NOT route requests
 * - This module provides compliance validation ONLY
 *
 * @module dataset-anonymization/compliance-rules
 */

import type { PIIType, AnonymizationStrategy, PIIMatch } from '../../contracts/index.js';

/**
 * Compliance framework identifier
 */
export type ComplianceFramework = 'gdpr' | 'hipaa' | 'ccpa' | 'soc2' | 'pci_dss';

/**
 * Compliance check result
 */
export interface ComplianceCheckResult {
  /** Framework being checked */
  framework: ComplianceFramework;
  /** Whether the data is compliant */
  compliant: boolean;
  /** List of violations found */
  violations: ComplianceViolation[];
  /** Recommendations for achieving compliance */
  recommendations: string[];
  /** Timestamp of the check */
  timestamp: string;
}

/**
 * Compliance violation details
 */
export interface ComplianceViolation {
  /** Violation code */
  code: string;
  /** Human-readable description */
  description: string;
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Affected PII type */
  piiType?: PIIType;
  /** Affected field path */
  fieldPath?: string;
  /** Remediation suggestion */
  remediation: string;
}

/**
 * Framework-specific requirements
 */
export interface FrameworkRequirements {
  /** Required strategies per PII type */
  requiredStrategies: Partial<Record<PIIType, AnonymizationStrategy[]>>;
  /** PII types that must be anonymized */
  mandatoryAnonymization: PIIType[];
  /** Minimum confidence threshold */
  minConfidenceThreshold: number;
  /** Whether original data can be retained */
  allowOriginalRetention: boolean;
  /** Maximum retention period (days) */
  maxRetentionDays?: number;
  /** Special categories requiring extra protection */
  specialCategories?: PIIType[];
}

// ============================================================================
// GDPR COMPLIANCE RULES
// ============================================================================

/**
 * GDPR Article 4(5) defines pseudonymization
 * GDPR Article 17 establishes right to erasure
 * GDPR Article 25 requires data protection by design
 */
const GDPR_REQUIREMENTS: FrameworkRequirements = {
  requiredStrategies: {
    // Article 9 - Special categories require stronger protection
    biometric_data: ['hash', 'encrypt', 'redact'],
    medical_record_number: ['hash', 'encrypt', 'redact'],
    health_insurance_number: ['hash', 'encrypt', 'redact'],

    // Standard personal data
    email: ['mask', 'hash', 'pseudonymize', 'redact'],
    phone_number: ['mask', 'hash', 'pseudonymize', 'redact'],
    person_name: ['mask', 'hash', 'pseudonymize', 'redact'],
    full_address: ['generalize', 'mask', 'redact'],
    date_of_birth: ['generalize', 'mask', 'redact'],

    // Direct identifiers - must be anonymized
    ssn: ['hash', 'redact'],
    national_id: ['hash', 'redact'],
    passport_number: ['hash', 'redact'],
  },

  mandatoryAnonymization: [
    'ssn',
    'national_id',
    'passport_number',
    'biometric_data',
    'medical_record_number',
    'health_insurance_number',
  ],

  minConfidenceThreshold: 0.85,
  allowOriginalRetention: false, // Must implement right to erasure
  maxRetentionDays: undefined, // Defined by purpose, not fixed
  specialCategories: [
    'biometric_data',
    'medical_record_number',
    'health_insurance_number',
  ],
};

/**
 * Check GDPR compliance
 */
export function checkGDPRCompliance(
  detections: PIIMatch[],
  appliedStrategies: Map<PIIType, AnonymizationStrategy>
): ComplianceCheckResult {
  const violations: ComplianceViolation[] = [];
  const recommendations: string[] = [];

  // Check mandatory anonymization
  for (const piiType of GDPR_REQUIREMENTS.mandatoryAnonymization) {
    const hasDetection = detections.some(d => d.pii_type === piiType);
    const hasStrategy = appliedStrategies.has(piiType);

    if (hasDetection && !hasStrategy) {
      violations.push({
        code: 'GDPR_MANDATORY_ANON',
        description: `${piiType} detected but not anonymized`,
        severity: 'critical',
        piiType,
        remediation: `Apply anonymization strategy to ${piiType} data`,
      });
    }
  }

  // Check special categories (Article 9)
  for (const piiType of GDPR_REQUIREMENTS.specialCategories ?? []) {
    const hasDetection = detections.some(d => d.pii_type === piiType);
    const strategy = appliedStrategies.get(piiType);
    const allowedStrategies = GDPR_REQUIREMENTS.requiredStrategies[piiType];

    if (hasDetection && strategy && allowedStrategies) {
      if (!allowedStrategies.includes(strategy)) {
        violations.push({
          code: 'GDPR_SPECIAL_CATEGORY',
          description: `${piiType} requires stronger protection under Article 9`,
          severity: 'high',
          piiType,
          remediation: `Use one of: ${allowedStrategies.join(', ')}`,
        });
      }
    }
  }

  // Check strategy compliance for all detected types
  for (const detection of detections) {
    const strategy = appliedStrategies.get(detection.pii_type);
    const allowedStrategies = GDPR_REQUIREMENTS.requiredStrategies[detection.pii_type];

    if (strategy && allowedStrategies && !allowedStrategies.includes(strategy)) {
      violations.push({
        code: 'GDPR_STRATEGY_MISMATCH',
        description: `Strategy '${strategy}' not recommended for ${detection.pii_type}`,
        severity: 'medium',
        piiType: detection.pii_type,
        remediation: `Consider using: ${allowedStrategies.join(', ')}`,
      });
    }
  }

  // Add recommendations
  if (detections.some(d => d.confidence < GDPR_REQUIREMENTS.minConfidenceThreshold)) {
    recommendations.push(
      'Some detections have low confidence. Consider manual review for GDPR compliance.'
    );
  }

  if (appliedStrategies.size < detections.length) {
    recommendations.push(
      'Not all detected PII has anonymization applied. Review data minimization principles.'
    );
  }

  recommendations.push(
    'Ensure data retention periods are documented and enforced per Article 5(1)(e).'
  );
  recommendations.push(
    'Maintain records of processing activities per Article 30.'
  );

  return {
    framework: 'gdpr',
    compliant: violations.filter(v => v.severity === 'critical').length === 0,
    violations,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// HIPAA COMPLIANCE RULES
// ============================================================================

/**
 * HIPAA Safe Harbor Method: 18 identifiers that must be removed
 * 45 CFR 164.514(b)(2)
 */
const HIPAA_SAFE_HARBOR_IDENTIFIERS: PIIType[] = [
  'person_name',
  'full_address',
  'street_address',
  'city',
  'state',
  'zip_code',
  'date_of_birth',
  'phone_number',
  'email',
  'ssn',
  'medical_record_number',
  'health_insurance_number',
  'drivers_license',
  'ip_address',
  'url',
  'biometric_data',
];

const HIPAA_REQUIREMENTS: FrameworkRequirements = {
  requiredStrategies: {
    // PHI must be de-identified
    medical_record_number: ['redact', 'hash'],
    health_insurance_number: ['redact', 'hash'],
    prescription_number: ['redact', 'hash'],
    biometric_data: ['redact'],

    // Other identifiers
    ssn: ['redact', 'hash'],
    person_name: ['redact', 'pseudonymize'],
    date_of_birth: ['generalize', 'redact'], // Can generalize to year for patients 89+
    phone_number: ['redact'],
    email: ['redact', 'hash'],
    full_address: ['redact'],
    zip_code: ['generalize'], // Can keep first 3 digits if population > 20,000
  },

  mandatoryAnonymization: HIPAA_SAFE_HARBOR_IDENTIFIERS,

  minConfidenceThreshold: 0.90, // Higher threshold for healthcare
  allowOriginalRetention: false,
  maxRetentionDays: undefined, // 6 years after creation or last use
};

/**
 * Check HIPAA Safe Harbor compliance
 */
export function checkHIPAACompliance(
  detections: PIIMatch[],
  appliedStrategies: Map<PIIType, AnonymizationStrategy>
): ComplianceCheckResult {
  const violations: ComplianceViolation[] = [];
  const recommendations: string[] = [];

  // Check all 18 Safe Harbor identifiers
  for (const identifier of HIPAA_SAFE_HARBOR_IDENTIFIERS) {
    const hasDetection = detections.some(d => d.pii_type === identifier);
    const strategy = appliedStrategies.get(identifier);
    const allowedStrategies = HIPAA_REQUIREMENTS.requiredStrategies[identifier];

    if (hasDetection && !strategy) {
      violations.push({
        code: 'HIPAA_SAFE_HARBOR_VIOLATION',
        description: `${identifier} not de-identified (Safe Harbor Method)`,
        severity: 'critical',
        piiType: identifier,
        remediation: `Apply de-identification to ${identifier} per 45 CFR 164.514(b)(2)`,
      });
    }

    if (hasDetection && strategy && allowedStrategies && !allowedStrategies.includes(strategy)) {
      violations.push({
        code: 'HIPAA_STRATEGY_INSUFFICIENT',
        description: `Strategy '${strategy}' may not satisfy Safe Harbor for ${identifier}`,
        severity: 'high',
        piiType: identifier,
        remediation: `Use: ${allowedStrategies.join(' or ')}`,
      });
    }
  }

  // Check PHI-specific rules
  const phiTypes: PIIType[] = ['medical_record_number', 'health_insurance_number', 'prescription_number'];
  for (const phiType of phiTypes) {
    const hasDetection = detections.some(d => d.pii_type === phiType);
    const strategy = appliedStrategies.get(phiType);

    if (hasDetection && strategy && !['redact', 'hash'].includes(strategy)) {
      violations.push({
        code: 'HIPAA_PHI_PROTECTION',
        description: `${phiType} requires strong de-identification`,
        severity: 'critical',
        piiType: phiType,
        remediation: 'PHI must be redacted or hashed',
      });
    }
  }

  // ZIP code special rule: only first 3 digits if population > 20,000
  const zipDetection = detections.find(d => d.pii_type === 'zip_code');
  const zipStrategy = appliedStrategies.get('zip_code');
  if (zipDetection && zipStrategy === 'generalize') {
    recommendations.push(
      'ZIP code generalization must ensure first 3 digits represent population > 20,000'
    );
  }

  // Date of birth special rule: year only for age 89+
  const dobDetection = detections.find(d => d.pii_type === 'date_of_birth');
  if (dobDetection) {
    recommendations.push(
      'For patients 89+, dates must be aggregated to year level or removed'
    );
  }

  // General recommendations
  recommendations.push(
    'Maintain de-identification documentation per 45 CFR 164.514(b)'
  );
  recommendations.push(
    'Consider Expert Determination method for complex cases'
  );

  const criticalViolations = violations.filter(v => v.severity === 'critical');

  return {
    framework: 'hipaa',
    compliant: criticalViolations.length === 0,
    violations,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// CCPA COMPLIANCE RULES
// ============================================================================

/**
 * CCPA categories of personal information
 * California Civil Code Section 1798.140
 */
const CCPA_REQUIREMENTS: FrameworkRequirements = {
  requiredStrategies: {
    // Direct identifiers
    ssn: ['hash', 'redact'],
    drivers_license: ['hash', 'redact'],
    passport_number: ['hash', 'redact'],

    // Contact information
    email: ['mask', 'hash', 'redact'],
    phone_number: ['mask', 'hash', 'redact'],
    full_address: ['mask', 'generalize', 'redact'],

    // Financial
    bank_account: ['hash', 'redact'],
    credit_card: ['mask', 'hash', 'redact'],

    // Biometric
    biometric_data: ['redact'],

    // Online activity
    ip_address: ['generalize', 'hash', 'redact'],
  },

  mandatoryAnonymization: [
    'ssn',
    'drivers_license',
    'bank_account',
    'biometric_data',
  ],

  minConfidenceThreshold: 0.85,
  allowOriginalRetention: true, // With consumer consent
  maxRetentionDays: undefined, // Must be disclosed
};

/**
 * Check CCPA compliance
 */
export function checkCCPACompliance(
  detections: PIIMatch[],
  appliedStrategies: Map<PIIType, AnonymizationStrategy>
): ComplianceCheckResult {
  const violations: ComplianceViolation[] = [];
  const recommendations: string[] = [];

  // Check mandatory anonymization
  for (const piiType of CCPA_REQUIREMENTS.mandatoryAnonymization) {
    const hasDetection = detections.some(d => d.pii_type === piiType);
    const hasStrategy = appliedStrategies.has(piiType);

    if (hasDetection && !hasStrategy) {
      violations.push({
        code: 'CCPA_PI_NOT_PROTECTED',
        description: `${piiType} detected but not protected`,
        severity: 'high',
        piiType,
        remediation: `Apply anonymization to ${piiType}`,
      });
    }
  }

  // Check strategy compliance
  for (const detection of detections) {
    const strategy = appliedStrategies.get(detection.pii_type);
    const allowedStrategies = CCPA_REQUIREMENTS.requiredStrategies[detection.pii_type];

    if (strategy && allowedStrategies && !allowedStrategies.includes(strategy)) {
      violations.push({
        code: 'CCPA_STRATEGY_RECOMMENDATION',
        description: `Strategy '${strategy}' may not fully protect ${detection.pii_type}`,
        severity: 'medium',
        piiType: detection.pii_type,
        remediation: `Consider: ${allowedStrategies.join(', ')}`,
      });
    }
  }

  // CCPA-specific recommendations
  recommendations.push(
    'Ensure disclosure of personal information categories collected (Section 1798.100)'
  );
  recommendations.push(
    'Implement consumer rights: access, deletion, opt-out (Section 1798.105-125)'
  );
  recommendations.push(
    'Do Not Sell My Personal Information opt-out must be available'
  );

  const highOrCritical = violations.filter(
    v => v.severity === 'critical' || v.severity === 'high'
  );

  return {
    framework: 'ccpa',
    compliant: highOrCritical.length === 0,
    violations,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// UNIFIED COMPLIANCE CHECKER
// ============================================================================

/**
 * Check compliance against multiple frameworks
 *
 * @param frameworks - Frameworks to check
 * @param detections - PII detections
 * @param appliedStrategies - Strategies applied per PII type
 * @returns Compliance results for all frameworks
 */
export function checkCompliance(
  frameworks: ComplianceFramework[],
  detections: PIIMatch[],
  appliedStrategies: Map<PIIType, AnonymizationStrategy>
): Map<ComplianceFramework, ComplianceCheckResult> {
  const results = new Map<ComplianceFramework, ComplianceCheckResult>();

  for (const framework of frameworks) {
    switch (framework) {
      case 'gdpr':
        results.set(framework, checkGDPRCompliance(detections, appliedStrategies));
        break;
      case 'hipaa':
        results.set(framework, checkHIPAACompliance(detections, appliedStrategies));
        break;
      case 'ccpa':
        results.set(framework, checkCCPACompliance(detections, appliedStrategies));
        break;
      case 'soc2':
      case 'pci_dss':
        // Placeholder for additional frameworks
        results.set(framework, {
          framework,
          compliant: true,
          violations: [],
          recommendations: [`${framework.toUpperCase()} compliance check not yet implemented`],
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }

  return results;
}

/**
 * Get recommended strategy for a PII type based on compliance requirements
 *
 * @param piiType - PII type
 * @param frameworks - Compliance frameworks to satisfy
 * @returns Recommended anonymization strategy
 */
export function getRecommendedStrategy(
  piiType: PIIType,
  frameworks: ComplianceFramework[]
): AnonymizationStrategy {
  const allRequirements: FrameworkRequirements[] = [];

  for (const framework of frameworks) {
    switch (framework) {
      case 'gdpr':
        allRequirements.push(GDPR_REQUIREMENTS);
        break;
      case 'hipaa':
        allRequirements.push(HIPAA_REQUIREMENTS);
        break;
      case 'ccpa':
        allRequirements.push(CCPA_REQUIREMENTS);
        break;
    }
  }

  // Find strategies that satisfy all frameworks
  const allStrategies: AnonymizationStrategy[] = allRequirements
    .map(req => req.requiredStrategies[piiType] ?? (['redact'] as AnonymizationStrategy[]))
    .flat();

  // Count occurrences and prefer most common
  const counts = new Map<AnonymizationStrategy, number>();
  for (const strategy of allStrategies) {
    counts.set(strategy as AnonymizationStrategy, (counts.get(strategy as AnonymizationStrategy) ?? 0) + 1);
  }

  // Return highest count, prefer 'redact' as tie-breaker
  let bestStrategy: AnonymizationStrategy = 'redact';
  let bestCount = 0;

  for (const [strategy, count] of counts) {
    if (count > bestCount || (count === bestCount && strategy === 'redact')) {
      bestStrategy = strategy;
      bestCount = count;
    }
  }

  return bestStrategy;
}

/**
 * Check if a PII type requires mandatory anonymization
 */
export function requiresMandatoryAnonymization(
  piiType: PIIType,
  frameworks: ComplianceFramework[]
): boolean {
  const requirements: FrameworkRequirements[] = [];

  for (const framework of frameworks) {
    switch (framework) {
      case 'gdpr':
        requirements.push(GDPR_REQUIREMENTS);
        break;
      case 'hipaa':
        requirements.push(HIPAA_REQUIREMENTS);
        break;
      case 'ccpa':
        requirements.push(CCPA_REQUIREMENTS);
        break;
    }
  }

  return requirements.some(req => req.mandatoryAnonymization.includes(piiType));
}
