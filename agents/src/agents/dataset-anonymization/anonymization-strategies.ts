/**
 * LLM-Data-Vault: Anonymization Strategies
 *
 * Implements various anonymization strategies for PII data protection.
 *
 * Strategies:
 * - mask: Replace with asterisks or fixed patterns
 * - redact: Remove entirely with placeholder
 * - hash: SHA-256 cryptographic hash
 * - generalize: Reduce specificity
 * - synthesize: Generate synthetic replacement
 *
 * CRITICAL CONSTRAINTS:
 * - This module MUST NOT execute inference
 * - This module MUST NOT modify prompts
 * - This module MUST NOT route requests
 * - This module produces privacy-safe artifacts ONLY
 *
 * @module dataset-anonymization/anonymization-strategies
 */

import type { PIIMatch, PIIType, AnonymizationStrategy } from '../../contracts/index.js';

/**
 * Result of applying an anonymization strategy
 */
export interface StrategyResult {
  /** The replacement text */
  replacement: string;
  /** Whether the anonymization is reversible */
  isReversible: boolean;
  /** Optional token ID for reversible strategies */
  tokenId?: string;
}

/**
 * Configuration for masking strategy
 */
export interface MaskConfig {
  /** Character to use for masking */
  maskChar?: string;
  /** Preserve original text length */
  preserveLength?: boolean;
  /** Show partial (first/last N chars) */
  showPartial?: boolean;
  /** Number of characters to show at start/end */
  partialChars?: number;
  /** Custom labels per PII type */
  customLabels?: Partial<Record<PIIType, string>>;
}

/**
 * Configuration for hashing strategy
 */
export interface HashConfig {
  /** Salt for hashing */
  salt?: string;
  /** Algorithm to use */
  algorithm?: 'sha256' | 'sha512';
  /** Truncate hash to N characters */
  truncateLength?: number;
}

/**
 * Configuration for generalization strategy
 */
export interface GeneralizeConfig {
  /** Generalization level (higher = more general) */
  level?: number;
}

/**
 * Configuration for synthesis strategy
 */
export interface SynthesizeConfig {
  /** Maintain format similarity */
  maintainFormat?: boolean;
  /** Seed for reproducible synthesis */
  seed?: string;
}

// ============================================================================
// MASKING STRATEGY
// ============================================================================

/**
 * Default labels for masking by PII type
 */
const DEFAULT_MASK_LABELS: Partial<Record<PIIType, string>> = {
  email: '[EMAIL_REDACTED]',
  phone_number: '[PHONE_REDACTED]',
  ssn: '[SSN_REDACTED]',
  credit_card: '[CARD_REDACTED]',
  person_name: '[NAME_REDACTED]',
  ip_address: '[IP_REDACTED]',
  api_key: '[KEY_REDACTED]',
  full_address: '[ADDRESS_REDACTED]',
  street_address: '[ADDRESS_REDACTED]',
  date_of_birth: '[DOB_REDACTED]',
  passport_number: '[PASSPORT_REDACTED]',
  drivers_license: '[LICENSE_REDACTED]',
  medical_record_number: '[MRN_REDACTED]',
  health_insurance_number: '[INSURANCE_REDACTED]',
  bank_account: '[BANK_REDACTED]',
  iban: '[IBAN_REDACTED]',
  password: '[PASSWORD_REDACTED]',
  auth_token: '[TOKEN_REDACTED]',
  private_key: '[KEY_REDACTED]',
  secret_key: '[SECRET_REDACTED]',
};

/**
 * Apply masking strategy to text
 *
 * Replaces PII with asterisks or custom labels.
 *
 * @param text - Original text
 * @param match - PII match to anonymize
 * @param config - Masking configuration
 * @returns Strategy result
 */
export function mask(text: string, match: PIIMatch, config: MaskConfig = {}): StrategyResult {
  const {
    maskChar = '*',
    preserveLength = true,
    showPartial = false,
    partialChars = 4,
    customLabels = {},
  } = config;

  const originalText = text.slice(match.start_offset, match.end_offset);
  const labels = { ...DEFAULT_MASK_LABELS, ...customLabels };

  // Check for custom label
  if (labels[match.pii_type]) {
    return {
      replacement: labels[match.pii_type]!,
      isReversible: false,
    };
  }

  // Apply masking
  let replacement: string;

  if (showPartial && originalText.length > partialChars * 2) {
    const first = originalText.slice(0, partialChars);
    const last = originalText.slice(-partialChars);
    const middleLength = originalText.length - (partialChars * 2);
    const middle = maskChar.repeat(middleLength);
    replacement = `${first}${middle}${last}`;
  } else if (preserveLength) {
    replacement = maskChar.repeat(originalText.length);
  } else {
    replacement = maskChar.repeat(8);
  }

  return {
    replacement,
    isReversible: false,
  };
}

// ============================================================================
// REDACT STRATEGY
// ============================================================================

/**
 * Apply redaction strategy to text
 *
 * Completely removes PII and replaces with a placeholder.
 *
 * @param text - Original text
 * @param match - PII match to anonymize
 * @returns Strategy result
 */
export function redact(_text: string, match: PIIMatch): StrategyResult {
  const typeLabel = match.pii_type.toUpperCase().replace(/_/g, ' ');
  return {
    replacement: `[${typeLabel} REMOVED]`,
    isReversible: false,
  };
}

// ============================================================================
// HASHING STRATEGY
// ============================================================================

/**
 * Apply hashing strategy to text
 *
 * Replaces PII with a deterministic hash.
 *
 * @param text - Original text
 * @param match - PII match to anonymize
 * @param config - Hashing configuration
 * @returns Strategy result
 */
export async function hash(
  text: string,
  match: PIIMatch,
  config: HashConfig = {}
): Promise<StrategyResult> {
  const { salt = '', algorithm = 'sha256', truncateLength = 16 } = config;

  const originalText = text.slice(match.start_offset, match.end_offset);
  const input = `${salt}${originalText}`;

  // Use Web Crypto API for hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest(
    algorithm === 'sha512' ? 'SHA-512' : 'SHA-256',
    data
  );

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Truncate if needed
  const truncated = truncateLength > 0 ? hashHex.slice(0, truncateLength) : hashHex;

  return {
    replacement: `HASH_${truncated}`,
    isReversible: false,
  };
}

/**
 * Synchronous hash using simple string hash (for environments without crypto.subtle)
 *
 * Note: This is NOT cryptographically secure, use async hash() when possible.
 */
export function hashSync(
  text: string,
  match: PIIMatch,
  config: HashConfig = {}
): StrategyResult {
  const { salt = '', truncateLength = 16 } = config;

  const originalText = text.slice(match.start_offset, match.end_offset);
  const input = `${salt}${originalText}`;

  // Simple non-cryptographic hash for sync fallback
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  const hashHex = Math.abs(hash).toString(16).padStart(16, '0');
  const truncated = truncateLength > 0 ? hashHex.slice(0, truncateLength) : hashHex;

  return {
    replacement: `HASH_${truncated}`,
    isReversible: false,
  };
}

// ============================================================================
// GENERALIZATION STRATEGY
// ============================================================================

/**
 * Generalization hierarchies for different PII types
 */
interface GeneralizationLevel {
  level: number;
  transform: (value: string) => string | null;
}

const GENERALIZATION_HIERARCHIES: Partial<Record<PIIType, GeneralizationLevel[]>> = {
  age: [
    {
      level: 0,
      transform: (age) => {
        const n = parseInt(age, 10);
        if (isNaN(n)) return null;
        const lower = Math.floor(n / 5) * 5;
        return `${lower}-${lower + 4}`;
      },
    },
    {
      level: 1,
      transform: (age) => {
        const n = parseInt(age, 10);
        if (isNaN(n)) return null;
        const decade = Math.floor(n / 10) * 10;
        return `${decade}s`;
      },
    },
    {
      level: 2,
      transform: (age) => {
        const n = parseInt(age, 10);
        if (isNaN(n)) return null;
        return n < 18 ? 'Minor' : 'Adult';
      },
    },
  ],

  zip_code: [
    {
      level: 0,
      transform: (zip) => zip.length >= 3 ? `${zip.slice(0, 3)}**` : null,
    },
    {
      level: 1,
      transform: (zip) => zip.length >= 2 ? `${zip.slice(0, 2)}***` : null,
    },
    {
      level: 2,
      transform: () => 'USA',
    },
  ],

  date_of_birth: [
    {
      level: 0,
      transform: (date) => {
        // Extract year from date (assumes format like MM/DD/YYYY or YYYY-MM-DD)
        const yearMatch = date.match(/\d{4}/);
        if (yearMatch) {
          return `Year: ${yearMatch[0]}`;
        }
        return null;
      },
    },
    {
      level: 1,
      transform: (date) => {
        const yearMatch = date.match(/\d{4}/);
        if (yearMatch) {
          const year = parseInt(yearMatch[0], 10);
          const decade = Math.floor(year / 10) * 10;
          return `${decade}s`;
        }
        return null;
      },
    },
    {
      level: 2,
      transform: () => '[DATE GENERALIZED]',
    },
  ],

  city: [
    {
      level: 0,
      transform: () => '[CITY]',
    },
    {
      level: 1,
      transform: () => '[REGION]',
    },
    {
      level: 2,
      transform: () => '[LOCATION]',
    },
  ],

  state: [
    {
      level: 0,
      transform: () => '[STATE]',
    },
    {
      level: 1,
      transform: () => '[REGION]',
    },
  ],

  ip_address: [
    {
      level: 0,
      transform: (ip) => {
        const parts = ip.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
        }
        return null;
      },
    },
    {
      level: 1,
      transform: (ip) => {
        const parts = ip.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.*.*`;
        }
        return null;
      },
    },
    {
      level: 2,
      transform: () => '[IP GENERALIZED]',
    },
  ],
};

/**
 * Apply generalization strategy to text
 *
 * Reduces specificity of PII while maintaining some utility.
 *
 * @param text - Original text
 * @param match - PII match to anonymize
 * @param config - Generalization configuration
 * @returns Strategy result
 */
export function generalize(
  text: string,
  match: PIIMatch,
  config: GeneralizeConfig = {}
): StrategyResult {
  const { level = 1 } = config;

  const originalText = text.slice(match.start_offset, match.end_offset);
  const hierarchy = GENERALIZATION_HIERARCHIES[match.pii_type];

  if (!hierarchy) {
    // No hierarchy defined, fall back to generic replacement
    return {
      replacement: `[${match.pii_type.toUpperCase()} GENERALIZED]`,
      isReversible: false,
    };
  }

  // Find appropriate level (use highest available if requested level exceeds hierarchy)
  const effectiveLevel = Math.min(level, hierarchy.length - 1);
  const transform = hierarchy[effectiveLevel];

  const result = transform.transform(originalText);

  if (result === null) {
    // Transform failed, use fallback
    return {
      replacement: `[${match.pii_type.toUpperCase()} GENERALIZED]`,
      isReversible: false,
    };
  }

  return {
    replacement: result,
    isReversible: false,
  };
}

// ============================================================================
// SYNTHESIS STRATEGY
// ============================================================================

/**
 * Synthetic data generators for different PII types
 */
const SYNTHETIC_GENERATORS: Partial<Record<PIIType, (original: string, config: SynthesizeConfig) => string>> = {
  email: (original, config) => {
    const hash = simpleHash(original + (config.seed ?? ''));
    const domains = ['example.com', 'test.org', 'sample.net'];
    const domain = domains[hash % domains.length];
    return `user_${hash.toString(36)}@${domain}`;
  },

  phone_number: (original, config) => {
    const hash = simpleHash(original + (config.seed ?? ''));
    const areaCode = 555;
    const exchange = (hash % 900) + 100;
    const subscriber = (hash % 9000) + 1000;
    return config.maintainFormat
      ? `(${areaCode}) ${exchange}-${subscriber}`
      : `${areaCode}${exchange}${subscriber}`;
  },

  person_name: (original, config) => {
    const hash = simpleHash(original + (config.seed ?? ''));
    const firstNames = ['John', 'Jane', 'Alex', 'Sam', 'Chris', 'Pat', 'Morgan', 'Taylor'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
    const firstName = firstNames[hash % firstNames.length];
    const lastName = lastNames[(hash >> 8) % lastNames.length];
    return `${firstName} ${lastName}`;
  },

  credit_card: (original, config) => {
    const hash = simpleHash(original + (config.seed ?? ''));
    // Generate test card number (doesn't pass Luhn)
    const prefix = '4111';
    const middle = String(hash).padStart(12, '0').slice(0, 12);
    return config.maintainFormat
      ? `${prefix}-${middle.slice(0, 4)}-${middle.slice(4, 8)}-${middle.slice(8, 12)}`
      : `${prefix}${middle}`;
  },

  ssn: (original, config) => {
    const hash = simpleHash(original + (config.seed ?? ''));
    const area = ((hash % 899) + 100).toString().padStart(3, '0');
    const group = ((hash >> 10) % 99 + 1).toString().padStart(2, '0');
    const serial = ((hash >> 17) % 9999 + 1).toString().padStart(4, '0');
    return config.maintainFormat ? `${area}-${group}-${serial}` : `${area}${group}${serial}`;
  },

  ip_address: (original, config) => {
    const hash = simpleHash(original + (config.seed ?? ''));
    const octet1 = (hash % 223) + 1;
    const octet2 = (hash >> 8) % 256;
    const octet3 = (hash >> 16) % 256;
    const octet4 = (hash >> 24) % 256;
    return `${octet1}.${octet2}.${octet3}.${octet4}`;
  },

  date_of_birth: (original, config) => {
    const hash = simpleHash(original + (config.seed ?? ''));
    const year = 1950 + (hash % 50);
    const month = ((hash >> 8) % 12) + 1;
    const day = ((hash >> 16) % 28) + 1;
    return config.maintainFormat
      ? `${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}/${year}`
      : `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  },

  zip_code: (original, config) => {
    const hash = simpleHash(original + (config.seed ?? ''));
    const zip = (10000 + (hash % 90000)).toString();
    return zip;
  },

  street_address: (original, config) => {
    const hash = simpleHash(original + (config.seed ?? ''));
    const numbers = [123, 456, 789, 100, 200, 300, 500];
    const streets = ['Main St', 'Oak Ave', 'Elm Blvd', 'Park Ln', 'First St', 'Second Ave'];
    const number = numbers[hash % numbers.length];
    const street = streets[(hash >> 8) % streets.length];
    return `${number} ${street}`;
  },
};

/**
 * Simple deterministic hash function
 */
function simpleHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Apply synthesis strategy to text
 *
 * Generates synthetic replacement data that maintains format.
 *
 * @param text - Original text
 * @param match - PII match to anonymize
 * @param config - Synthesis configuration
 * @returns Strategy result
 */
export function synthesize(
  text: string,
  match: PIIMatch,
  config: SynthesizeConfig = {}
): StrategyResult {
  const { maintainFormat = true, seed = '' } = config;

  const originalText = text.slice(match.start_offset, match.end_offset);
  const generator = SYNTHETIC_GENERATORS[match.pii_type];

  if (!generator) {
    // No generator defined, fall back to generic replacement
    const hash = simpleHash(originalText + seed);
    return {
      replacement: `SYNTH_${hash.toString(36).slice(0, 8).toUpperCase()}`,
      isReversible: false,
    };
  }

  const synthesized = generator(originalText, { maintainFormat, seed });

  return {
    replacement: synthesized,
    isReversible: false,
  };
}

// ============================================================================
// STRATEGY DISPATCHER
// ============================================================================

/**
 * Configuration for strategy dispatcher
 */
export interface DispatchConfig {
  mask?: MaskConfig;
  hash?: HashConfig;
  generalize?: GeneralizeConfig;
  synthesize?: SynthesizeConfig;
}

/**
 * Apply anonymization strategy to a match
 *
 * @param strategy - Strategy to apply
 * @param text - Original text
 * @param match - PII match to anonymize
 * @param config - Strategy-specific configuration
 * @returns Strategy result (async for hash strategy)
 */
export async function applyStrategy(
  strategy: AnonymizationStrategy,
  text: string,
  match: PIIMatch,
  config: DispatchConfig = {}
): Promise<StrategyResult> {
  switch (strategy) {
    case 'mask':
      return mask(text, match, config.mask);

    case 'redact':
    case 'suppress':
      return redact(text, match);

    case 'hash':
      return hash(text, match, config.hash);

    case 'generalize':
      return generalize(text, match, config.generalize);

    case 'noise':
    case 'pseudonymize':
      return synthesize(text, match, config.synthesize);

    case 'tokenize':
      // Tokenization requires a vault - return placeholder
      return {
        replacement: `TOKEN_${simpleHash(text.slice(match.start_offset, match.end_offset)).toString(36).toUpperCase()}`,
        isReversible: true,
        tokenId: crypto.randomUUID(),
      };

    case 'k_anonymity':
    case 'l_diversity':
    case 't_closeness':
    case 'differential_privacy':
      // Statistical privacy methods - apply generalization as fallback
      return generalize(text, match, { level: 2 });

    case 'encrypt':
      // Encryption requires keys - return placeholder
      return {
        replacement: `ENC_${simpleHash(text.slice(match.start_offset, match.end_offset)).toString(36).toUpperCase()}`,
        isReversible: true,
      };

    default:
      // Unknown strategy - default to redaction
      return redact(text, match);
  }
}

/**
 * Apply strategy synchronously (no async hash)
 */
export function applyStrategySync(
  strategy: AnonymizationStrategy,
  text: string,
  match: PIIMatch,
  config: DispatchConfig = {}
): StrategyResult {
  switch (strategy) {
    case 'mask':
      return mask(text, match, config.mask);

    case 'redact':
    case 'suppress':
      return redact(text, match);

    case 'hash':
      return hashSync(text, match, config.hash);

    case 'generalize':
      return generalize(text, match, config.generalize);

    case 'noise':
    case 'pseudonymize':
      return synthesize(text, match, config.synthesize);

    case 'tokenize':
      return {
        replacement: `TOKEN_${simpleHash(text.slice(match.start_offset, match.end_offset)).toString(36).toUpperCase()}`,
        isReversible: true,
        tokenId: crypto.randomUUID(),
      };

    case 'k_anonymity':
    case 'l_diversity':
    case 't_closeness':
    case 'differential_privacy':
      return generalize(text, match, { level: 2 });

    case 'encrypt':
      return {
        replacement: `ENC_${simpleHash(text.slice(match.start_offset, match.end_offset)).toString(36).toUpperCase()}`,
        isReversible: true,
      };

    default:
      return redact(text, match);
  }
}
