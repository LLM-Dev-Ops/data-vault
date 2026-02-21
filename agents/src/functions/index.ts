/**
 * LLM-Data-Vault: Edge Functions
 *
 * Google Cloud Edge Function exports.
 *
 * @module functions
 */

export {
  AnonymizationFunctionHandler,
  anonymizationFunction,
  getHandler,
  TestableHandler,
} from './anonymization-function.js';

// Cloud Functions unified entry point
export { handler } from './cloud-function.js';
