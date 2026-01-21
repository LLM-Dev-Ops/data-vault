/**
 * LLM-Data-Vault: PII Detection Module
 *
 * Provides comprehensive PII (Personally Identifiable Information) detection
 * using regex patterns and contextual validation.
 *
 * CRITICAL CONSTRAINTS:
 * - This module MUST NOT execute inference
 * - This module MUST NOT modify prompts
 * - This module MUST NOT route requests
 * - This module produces detection artifacts ONLY
 *
 * @module dataset-anonymization/pii-detector
 */

import type { PIIMatch, PIIType } from '../../contracts/index.js';

/**
 * Pattern configuration for PII detection
 */
interface PIIPattern {
  /** PII type this pattern detects */
  type: PIIType;
  /** Regular expression pattern */
  regex: RegExp;
  /** Base confidence score (0-1) */
  baseConfidence: number;
  /** Whether this pattern requires context validation */
  requiresContextValidation: boolean;
  /** Optional validator function */
  validator?: (text: string) => boolean;
  /** Context keywords that increase confidence */
  contextKeywords?: string[];
}

/**
 * Detection context for contextual analysis
 */
interface DetectionContext {
  /** Characters before match */
  before: string;
  /** Characters after match */
  after: string;
  /** Full context string */
  full: string;
}

/**
 * Detection configuration options
 */
export interface DetectorConfig {
  /** Minimum confidence threshold (0-1) */
  confidenceThreshold?: number;
  /** Context window size (characters around match) */
  contextWindow?: number;
  /** Enable validation functions */
  enableValidation?: boolean;
  /** Custom patterns to add */
  customPatterns?: PIIPattern[];
}

/**
 * Detection result statistics
 */
export interface DetectionStats {
  totalCharactersProcessed: number;
  totalDetections: number;
  detectionsByType: Partial<Record<PIIType, number>>;
  processingTimeMs: number;
  averageConfidence: number;
}

/**
 * PII Detector class
 *
 * Detects PII in text using regex patterns with optional contextual validation.
 */
export class PIIDetector {
  private readonly patterns: PIIPattern[];
  private readonly confidenceThreshold: number;
  private readonly contextWindow: number;
  private readonly enableValidation: boolean;

  constructor(config: DetectorConfig = {}) {
    this.confidenceThreshold = config.confidenceThreshold ?? 0.85;
    this.contextWindow = config.contextWindow ?? 50;
    this.enableValidation = config.enableValidation ?? true;
    this.patterns = [...this.buildDefaultPatterns(), ...(config.customPatterns ?? [])];
  }

  /**
   * Detect PII in text
   *
   * @param text - Text to analyze
   * @returns Array of PII matches above confidence threshold
   */
  detect(text: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    for (const pattern of this.patterns) {
      const patternMatches = this.detectWithPattern(text, pattern);
      matches.push(...patternMatches);
    }

    // Sort by position and remove overlaps
    const sortedMatches = matches.sort((a, b) => a.start_offset - b.start_offset);
    const deduplicated = this.removeOverlappingMatches(sortedMatches);

    // Filter by confidence threshold
    return deduplicated.filter(m => m.confidence >= this.confidenceThreshold);
  }

  /**
   * Detect PII with statistics
   *
   * @param text - Text to analyze
   * @returns Detection results with statistics
   */
  detectWithStats(text: string): { matches: PIIMatch[]; stats: DetectionStats } {
    const detectStartTime = performance.now();
    const matches = this.detect(text);
    const processingTimeMs = performance.now() - detectStartTime;

    const detectionsByType: Partial<Record<PIIType, number>> = {};
    let totalConfidence = 0;

    for (const match of matches) {
      detectionsByType[match.pii_type] = (detectionsByType[match.pii_type] ?? 0) + 1;
      totalConfidence += match.confidence;
    }

    return {
      matches,
      stats: {
        totalCharactersProcessed: text.length,
        totalDetections: matches.length,
        detectionsByType,
        processingTimeMs,
        averageConfidence: matches.length > 0 ? totalConfidence / matches.length : 0,
      },
    };
  }

  /**
   * Detect with a single pattern
   */
  private detectWithPattern(text: string, pattern: PIIPattern): PIIMatch[] {
    const matches: PIIMatch[] = [];
    let match: RegExpExecArray | null;

    // Reset regex state for global patterns
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);

    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];
      const start = match.index;
      const end = start + matchedText.length;

      // Run validator if enabled and available
      if (this.enableValidation && pattern.validator) {
        if (!pattern.validator(matchedText)) {
          continue;
        }
      }

      // Extract context
      const context = this.extractContext(text, start, end);

      // Calculate confidence with context adjustment
      let confidence = pattern.baseConfidence;
      if (pattern.requiresContextValidation) {
        confidence = this.adjustConfidenceByContext(
          confidence,
          pattern.type,
          context,
          pattern.contextKeywords
        );
      }

      matches.push({
        pii_type: pattern.type,
        start_offset: start,
        end_offset: end,
        confidence,
        context_hint: context.full,
      });

      // Prevent infinite loops with zero-width matches
      if (matchedText.length === 0) {
        regex.lastIndex++;
      }
    }

    return matches;
  }

  /**
   * Extract context around a match
   */
  private extractContext(text: string, start: number, end: number): DetectionContext {
    const contextStart = Math.max(0, start - this.contextWindow);
    const contextEnd = Math.min(text.length, end + this.contextWindow);

    return {
      before: text.slice(contextStart, start),
      after: text.slice(end, contextEnd),
      full: text.slice(contextStart, contextEnd),
    };
  }

  /**
   * Adjust confidence based on contextual keywords
   */
  private adjustConfidenceByContext(
    baseConfidence: number,
    piiType: PIIType,
    context: DetectionContext,
    keywords?: string[]
  ): number {
    let confidence = baseConfidence;
    const contextLower = context.full.toLowerCase();

    // Type-specific context adjustments
    switch (piiType) {
      case 'ssn':
        if (contextLower.includes('ssn') || contextLower.includes('social security')) {
          confidence = Math.min(1.0, confidence + 0.05);
        }
        break;

      case 'date_of_birth':
        if (
          contextLower.includes('dob') ||
          contextLower.includes('date of birth') ||
          contextLower.includes('born') ||
          contextLower.includes('birthday')
        ) {
          confidence = Math.min(1.0, confidence + 0.15);
        } else {
          confidence *= 0.8;
        }
        break;

      case 'credit_card':
        if (
          contextLower.includes('card') ||
          contextLower.includes('visa') ||
          contextLower.includes('mastercard') ||
          contextLower.includes('amex') ||
          contextLower.includes('payment')
        ) {
          confidence = Math.min(1.0, confidence + 0.05);
        }
        break;

      case 'phone_number':
        if (
          contextLower.includes('phone') ||
          contextLower.includes('call') ||
          contextLower.includes('mobile') ||
          contextLower.includes('tel')
        ) {
          confidence = Math.min(1.0, confidence + 0.05);
        }
        break;

      case 'email':
        // Email is usually self-evident
        break;

      case 'person_name':
        if (
          contextLower.includes('name') ||
          contextLower.includes('mr.') ||
          contextLower.includes('mrs.') ||
          contextLower.includes('ms.') ||
          contextLower.includes('dr.')
        ) {
          confidence = Math.min(1.0, confidence + 0.1);
        }
        break;

      default:
        break;
    }

    // Apply custom keywords if provided
    if (keywords) {
      for (const keyword of keywords) {
        if (contextLower.includes(keyword.toLowerCase())) {
          confidence = Math.min(1.0, confidence + 0.05);
          break;
        }
      }
    }

    return confidence;
  }

  /**
   * Remove overlapping matches, keeping highest confidence
   */
  private removeOverlappingMatches(matches: PIIMatch[]): PIIMatch[] {
    if (matches.length === 0) return [];

    const result: PIIMatch[] = [];
    let lastEnd = -1;
    let lastMatch: PIIMatch | null = null;

    for (const current of matches) {
      if (current.start_offset >= lastEnd) {
        // No overlap - add previous match and update
        if (lastMatch) {
          result.push(lastMatch);
        }
        lastMatch = current;
        lastEnd = current.end_offset;
      } else {
        // Overlapping - keep higher confidence
        if (lastMatch && current.confidence > lastMatch.confidence) {
          lastMatch = current;
          lastEnd = current.end_offset;
        }
      }
    }

    // Add final match
    if (lastMatch) {
      result.push(lastMatch);
    }

    return result;
  }

  /**
   * Build default PII detection patterns
   */
  private buildDefaultPatterns(): PIIPattern[] {
    return [
      // Email: RFC 5322 compliant pattern
      {
        type: 'email',
        regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
        baseConfidence: 0.95,
        requiresContextValidation: false,
        validator: (email) => !this.isDisposableEmail(email),
      },

      // SSN: Format XXX-XX-XXXX with validation
      {
        type: 'ssn',
        regex: /\b(?!000|666|9\d{2})([0-8]\d{2}|7[0-6]\d)-(?!00)\d{2}-(?!0000)\d{4}\b/g,
        baseConfidence: 0.98,
        requiresContextValidation: true,
        validator: (ssn) => this.validateSSN(ssn),
        contextKeywords: ['ssn', 'social security', 'social'],
      },

      // Credit Card: Luhn algorithm validation
      {
        type: 'credit_card',
        regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
        baseConfidence: 0.97,
        requiresContextValidation: true,
        validator: (card) => this.validateLuhn(card),
        contextKeywords: ['card', 'credit', 'debit', 'visa', 'mastercard', 'amex'],
      },

      // Phone Number: International format with country codes
      {
        type: 'phone_number',
        regex: /(?:\+\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
        baseConfidence: 0.90,
        requiresContextValidation: true,
        validator: (phone) => this.validatePhone(phone),
        contextKeywords: ['phone', 'call', 'mobile', 'telephone', 'tel'],
      },

      // IP Address (IPv4)
      {
        type: 'ip_address',
        regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
        baseConfidence: 0.92,
        requiresContextValidation: false,
        validator: (ip) => !this.isPrivateIP(ip),
      },

      // IPv6 Address
      {
        type: 'ipv6_address',
        regex: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/gi,
        baseConfidence: 0.95,
        requiresContextValidation: false,
      },

      // API Key patterns (generic)
      {
        type: 'api_key',
        regex: /(?:api[_-]?key|apikey|access[_-]?token)[\s=:]+['"]?([a-zA-Z0-9_\-]{32,})['"]?/gi,
        baseConfidence: 0.93,
        requiresContextValidation: false,
        validator: (key) => this.validateAPIKeyEntropy(key),
      },

      // AWS Access Key
      {
        type: 'api_key',
        regex: /\b(AKIA[0-9A-Z]{16})\b/g,
        baseConfidence: 0.99,
        requiresContextValidation: false,
      },

      // Date of Birth (various formats)
      {
        type: 'date_of_birth',
        regex: /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12][0-9]|3[01])[/-](?:19|20)\d{2}\b/g,
        baseConfidence: 0.75,
        requiresContextValidation: true,
        contextKeywords: ['dob', 'birth', 'born', 'birthday', 'date of birth'],
      },

      // MAC Address
      {
        type: 'mac_address',
        regex: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
        baseConfidence: 0.94,
        requiresContextValidation: false,
      },

      // IBAN (International Bank Account Number)
      {
        type: 'iban',
        regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}(?:[A-Z0-9]?){0,16}\b/g,
        baseConfidence: 0.96,
        requiresContextValidation: false,
        validator: (iban) => this.validateIBAN(iban),
      },

      // Passport Number (generic pattern)
      {
        type: 'passport_number',
        regex: /\b[A-Z]{1,2}\d{6,9}\b/g,
        baseConfidence: 0.70,
        requiresContextValidation: true,
        contextKeywords: ['passport', 'travel document'],
      },

      // US ZIP Code
      {
        type: 'zip_code',
        regex: /\b\d{5}(?:-\d{4})?\b/g,
        baseConfidence: 0.70,
        requiresContextValidation: true,
        contextKeywords: ['zip', 'postal', 'code'],
      },

      // Street Address (simplified pattern)
      {
        type: 'street_address',
        regex: /\b\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl)\b/gi,
        baseConfidence: 0.80,
        requiresContextValidation: true,
        contextKeywords: ['address', 'live', 'reside', 'located'],
      },

      // Person Name (basic pattern - often needs NER for accuracy)
      {
        type: 'person_name',
        regex: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
        baseConfidence: 0.85,
        requiresContextValidation: false,
      },
    ];
  }

  // ===== Validation Helper Methods =====

  /**
   * Check if email is from a disposable domain
   */
  private isDisposableEmail(email: string): boolean {
    const disposableDomains = [
      'tempmail.com',
      'throwaway.email',
      'guerrillamail.com',
      'mailinator.com',
      '10minutemail.com',
      'yopmail.com',
    ];
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    return disposableDomains.some(d => domain.endsWith(d));
  }

  /**
   * Validate SSN format (exclude known invalid patterns)
   */
  private validateSSN(ssn: string): boolean {
    const digits = ssn.replace(/\D/g, '');
    const invalidPatterns = [
      '123456789',
      '111111111',
      '222222222',
      '333333333',
      '444444444',
      '555555555',
      '666666666',
      '777777777',
      '888888888',
      '999999999',
    ];
    return !invalidPatterns.includes(digits);
  }

  /**
   * Validate credit card number using Luhn algorithm
   */
  private validateLuhn(cardNumber: string): boolean {
    const digits = cardNumber.replace(/\D/g, '').split('').map(Number);

    if (digits.length < 13 || digits.length > 19) {
      return false;
    }

    let sum = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = digits[i];
      if ((digits.length - 1 - i) % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }

    return sum % 10 === 0;
  }

  /**
   * Validate phone number length
   */
  private validatePhone(phone: string): boolean {
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }

  /**
   * Check if IP is private/reserved
   */
  private isPrivateIP(ip: string): boolean {
    return (
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('127.') ||
      ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') ||
      ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') ||
      ip.startsWith('172.20.') ||
      ip.startsWith('172.21.') ||
      ip.startsWith('172.22.') ||
      ip.startsWith('172.23.') ||
      ip.startsWith('172.24.') ||
      ip.startsWith('172.25.') ||
      ip.startsWith('172.26.') ||
      ip.startsWith('172.27.') ||
      ip.startsWith('172.28.') ||
      ip.startsWith('172.29.') ||
      ip.startsWith('172.30.') ||
      ip.startsWith('172.31.')
    );
  }

  /**
   * Validate API key entropy (detect random strings)
   */
  private validateAPIKeyEntropy(key: string): boolean {
    const entropy = this.calculateEntropy(key);
    return entropy > 3.5;
  }

  /**
   * Calculate Shannon entropy of a string
   */
  private calculateEntropy(s: string): number {
    const freq: Record<string, number> = {};
    for (const c of s) {
      freq[c] = (freq[c] ?? 0) + 1;
    }

    let entropy = 0;
    const len = s.length;
    for (const count of Object.values(freq)) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * Validate IBAN format (basic check)
   */
  private validateIBAN(iban: string): boolean {
    return iban.length >= 15 && iban.length <= 34;
  }
}

/**
 * Create a PII detector with default configuration
 */
export function createPIIDetector(config?: DetectorConfig): PIIDetector {
  return new PIIDetector(config);
}
