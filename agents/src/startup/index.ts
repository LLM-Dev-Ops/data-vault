/**
 * LLM-Data-Vault: Startup Module
 *
 * Exports startup validation and configuration utilities.
 *
 * @module startup
 */

export {
  validateEnvironment,
  checkRuvectorHealth,
  runStartupValidation,
  setValidatedConfig,
  getValidatedConfig,
  type EnvironmentConfig,
  type ValidationResult,
} from './validation.js';
