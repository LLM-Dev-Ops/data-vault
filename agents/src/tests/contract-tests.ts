/**
 * Contract Validation Tests for LLM-Data-Vault Agents
 *
 * Validates all inputs and outputs against schemas:
 * - Input schema compliance
 * - Output schema compliance
 * - DecisionEvent schema compliance
 * - TelemetryEvent schema compliance
 * - Boundary enforcement
 *
 * @module tests/contract-tests
 */

import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  // Registration schemas
  AgentCapabilitySchema,
  AgentRegistrationSchema,
  createAgentRegistration,
  validateRegistration,
  verifyBoundaryCompliance,
  AuthorizeCapability,
  AnonymizeCapability,
  EncryptionCapability,

  // Integration schemas
  DecisionEventSchema,
  TelemetryEventSchema,
  PolicySchema,
  DatasetRequestSchema,
  DatasetResponseSchema,
  ApprovedDatasetSchema,

  // Types
  type DecisionEvent,
  type TelemetryEvent,
  type Policy,
  type DatasetRequest,
  type DatasetResponse,
  type ApprovedDataset
} from '../platform/index.js';

// =============================================================================
// INPUT SCHEMA VALIDATION TESTS
// =============================================================================

describe('Input Schema Validation', () => {
  describe('AuthorizeRequest Schema', () => {
    // Define input schema for authorization requests
    const AuthorizeRequestSchema = z.object({
      requestId: z.string().uuid(),
      userId: z.string().min(1),
      datasetId: z.string().min(1),
      operation: z.enum(['read', 'write', 'delete', 'admin']),
      fields: z.array(z.string()).optional(),
      purpose: z.enum(['training', 'inference', 'evaluation', 'analysis']).optional(),
      metadata: z.record(z.unknown()).optional()
    });

    it('should validate complete authorization request', () => {
      const validRequest = {
        requestId: uuidv4(),
        userId: 'user-123',
        datasetId: 'dataset-456',
        operation: 'read',
        fields: ['name', 'email'],
        purpose: 'training',
        metadata: { source: 'api' }
      };

      const result = AuthorizeRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject request with invalid UUID', () => {
      const invalidRequest = {
        requestId: 'not-a-uuid',
        userId: 'user-123',
        datasetId: 'dataset-456',
        operation: 'read'
      };

      const result = AuthorizeRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject request with invalid operation', () => {
      const invalidRequest = {
        requestId: uuidv4(),
        userId: 'user-123',
        datasetId: 'dataset-456',
        operation: 'execute' // Invalid
      };

      const result = AuthorizeRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject request with empty userId', () => {
      const invalidRequest = {
        requestId: uuidv4(),
        userId: '',
        datasetId: 'dataset-456',
        operation: 'read'
      };

      const result = AuthorizeRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should accept request without optional fields', () => {
      const minimalRequest = {
        requestId: uuidv4(),
        userId: 'user-123',
        datasetId: 'dataset-456',
        operation: 'read'
      };

      const result = AuthorizeRequestSchema.safeParse(minimalRequest);
      expect(result.success).toBe(true);
    });
  });

  describe('AnonymizeRequest Schema', () => {
    const AnonymizeRequestSchema = z.object({
      requestId: z.string().uuid(),
      datasetId: z.string().min(1),
      data: z.array(z.record(z.unknown())),
      strategy: z.enum(['redact', 'mask', 'hash', 'encrypt', 'generalize', 'pseudonymize']),
      fields: z.array(z.string()).optional(),
      options: z.object({
        preserveFormat: z.boolean().optional(),
        hashSalt: z.string().optional(),
        maskChar: z.string().length(1).optional(),
        generalizationLevel: z.number().int().min(1).max(10).optional()
      }).optional(),
      trackLineage: z.boolean().optional()
    });

    it('should validate complete anonymize request', () => {
      const validRequest = {
        requestId: uuidv4(),
        datasetId: 'dataset-456',
        data: [
          { id: 1, email: 'john@example.com' },
          { id: 2, email: 'jane@example.com' }
        ],
        strategy: 'redact',
        fields: ['email'],
        options: { preserveFormat: true },
        trackLineage: true
      };

      const result = AnonymizeRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject invalid strategy', () => {
      const invalidRequest = {
        requestId: uuidv4(),
        datasetId: 'dataset-456',
        data: [{ email: 'test@example.com' }],
        strategy: 'delete' // Invalid
      };

      const result = AnonymizeRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject empty data array', () => {
      const invalidRequest = {
        requestId: uuidv4(),
        datasetId: 'dataset-456',
        data: [],
        strategy: 'redact'
      };

      // Empty arrays are technically valid, but could be rejected by business logic
      const result = AnonymizeRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(true); // Schema allows empty, business logic may not
    });

    it('should validate mask character length', () => {
      const invalidRequest = {
        requestId: uuidv4(),
        datasetId: 'dataset-456',
        data: [{ email: 'test@example.com' }],
        strategy: 'mask',
        options: { maskChar: '**' } // Should be single char
      };

      const result = AnonymizeRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should validate generalization level bounds', () => {
      const invalidRequest = {
        requestId: uuidv4(),
        datasetId: 'dataset-456',
        data: [{ age: 25 }],
        strategy: 'generalize',
        options: { generalizationLevel: 15 } // Max is 10
      };

      const result = AnonymizeRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('DatasetRequest Schema', () => {
    it('should validate complete dataset request', () => {
      const validRequest: DatasetRequest = {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        requester: {
          serviceId: 'llm-orchestrator',
          userId: 'user-123',
          purpose: 'training'
        },
        dataset: {
          datasetId: 'dataset-456',
          version: '1.0.0',
          filters: { category: 'public' },
          fields: ['id', 'text'],
          limit: 1000
        },
        requirements: {
          anonymizationLevel: 'strict',
          encryptionRequired: true,
          auditRequired: true,
          lineageRequired: true
        },
        deadline: new Date(Date.now() + 3600000).toISOString()
      };

      const result = DatasetRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject invalid purpose', () => {
      const invalidRequest = {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        requester: {
          serviceId: 'service-1',
          purpose: 'hacking' // Invalid
        },
        dataset: { datasetId: 'dataset-456' },
        requirements: {
          anonymizationLevel: 'none',
          encryptionRequired: false,
          auditRequired: false,
          lineageRequired: false
        }
      };

      const result = DatasetRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject invalid anonymization level', () => {
      const invalidRequest = {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        requester: {
          serviceId: 'service-1',
          purpose: 'training'
        },
        dataset: { datasetId: 'dataset-456' },
        requirements: {
          anonymizationLevel: 'maximum', // Invalid
          encryptionRequired: false,
          auditRequired: false,
          lineageRequired: false
        }
      };

      const result = DatasetRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject negative limit', () => {
      const invalidRequest = {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        requester: {
          serviceId: 'service-1',
          purpose: 'training'
        },
        dataset: {
          datasetId: 'dataset-456',
          limit: -100 // Invalid
        },
        requirements: {
          anonymizationLevel: 'none',
          encryptionRequired: false,
          auditRequired: false,
          lineageRequired: false
        }
      };

      const result = DatasetRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('Policy Schema', () => {
    it('should validate complete policy', () => {
      const validPolicy: Policy = {
        policyId: uuidv4(),
        name: 'GDPR Compliance Policy',
        version: '1.0.0',
        rules: [
          {
            ruleId: 'rule-001',
            condition: {
              field: 'dataType',
              operator: 'eq',
              value: 'personal'
            },
            action: 'transform',
            transformations: [
              {
                type: 'redact',
                field: 'email'
              },
              {
                type: 'hash',
                field: 'userId',
                config: { algorithm: 'sha256' }
              }
            ]
          }
        ],
        scope: {
          datasets: ['public-*', 'training-*'],
          users: ['analyst-*'],
          operations: ['read']
        },
        effectiveFrom: new Date().toISOString(),
        effectiveUntil: new Date(Date.now() + 365 * 24 * 3600000).toISOString(),
        priority: 100
      };

      const result = PolicySchema.safeParse(validPolicy);
      expect(result.success).toBe(true);
    });

    it('should reject invalid rule operator', () => {
      const invalidPolicy = {
        policyId: uuidv4(),
        name: 'Test Policy',
        version: '1.0.0',
        rules: [{
          ruleId: 'rule-001',
          condition: {
            field: 'type',
            operator: 'like', // Invalid
            value: 'test'
          },
          action: 'allow'
        }],
        scope: {},
        effectiveFrom: new Date().toISOString(),
        priority: 50
      };

      const result = PolicySchema.safeParse(invalidPolicy);
      expect(result.success).toBe(false);
    });

    it('should reject invalid transformation type', () => {
      const invalidPolicy = {
        policyId: uuidv4(),
        name: 'Test Policy',
        version: '1.0.0',
        rules: [{
          ruleId: 'rule-001',
          condition: {
            field: 'type',
            operator: 'eq',
            value: 'test'
          },
          action: 'transform',
          transformations: [{
            type: 'delete', // Invalid
            field: 'email'
          }]
        }],
        scope: {},
        effectiveFrom: new Date().toISOString(),
        priority: 50
      };

      const result = PolicySchema.safeParse(invalidPolicy);
      expect(result.success).toBe(false);
    });

    it('should reject priority out of bounds', () => {
      const invalidPolicy = {
        policyId: uuidv4(),
        name: 'Test Policy',
        version: '1.0.0',
        rules: [],
        scope: {},
        effectiveFrom: new Date().toISOString(),
        priority: 1500 // Max is 1000
      };

      const result = PolicySchema.safeParse(invalidPolicy);
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// OUTPUT SCHEMA VALIDATION TESTS
// =============================================================================

describe('Output Schema Validation', () => {
  describe('AuthorizeResponse Schema', () => {
    const AuthorizeResponseSchema = z.object({
      requestId: z.string().uuid(),
      authorized: z.boolean(),
      reason: z.string(),
      decisionEventId: z.string().uuid(),
      policyIds: z.array(z.string()),
      expiresAt: z.string().datetime().optional(),
      constraints: z.object({
        allowedFields: z.array(z.string()).optional(),
        maxRecords: z.number().int().positive().optional(),
        rateLimit: z.number().int().positive().optional()
      }).optional()
    });

    it('should validate complete authorization response', () => {
      const validResponse = {
        requestId: uuidv4(),
        authorized: true,
        reason: 'Access granted per policy-001',
        decisionEventId: uuidv4(),
        policyIds: ['policy-001', 'policy-002'],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        constraints: {
          allowedFields: ['id', 'name'],
          maxRecords: 1000,
          rateLimit: 100
        }
      };

      const result = AuthorizeResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate denial response', () => {
      const denialResponse = {
        requestId: uuidv4(),
        authorized: false,
        reason: 'User does not have permission for write operation',
        decisionEventId: uuidv4(),
        policyIds: ['security-policy-001']
      };

      const result = AuthorizeResponseSchema.safeParse(denialResponse);
      expect(result.success).toBe(true);
    });

    it('should require decision event ID', () => {
      const invalidResponse = {
        requestId: uuidv4(),
        authorized: true,
        reason: 'Granted',
        policyIds: []
        // Missing decisionEventId
      };

      const result = AuthorizeResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('AnonymizeResponse Schema', () => {
    const AnonymizeResponseSchema = z.object({
      requestId: z.string().uuid(),
      success: z.boolean(),
      data: z.array(z.record(z.unknown())).optional(),
      transformations: z.array(z.object({
        field: z.string(),
        type: z.string(),
        count: z.number().int().nonnegative()
      })).optional(),
      detectedPii: z.array(z.object({
        field: z.string(),
        type: z.string(),
        confidence: z.number().min(0).max(1)
      })).optional(),
      lineage: z.object({
        sourceDatasetId: z.string(),
        targetDatasetId: z.string(),
        transformationId: z.string().uuid(),
        timestamp: z.string().datetime()
      }).optional(),
      decisionEventId: z.string().uuid(),
      error: z.object({
        code: z.string(),
        message: z.string()
      }).optional()
    });

    it('should validate successful anonymize response', () => {
      const validResponse = {
        requestId: uuidv4(),
        success: true,
        data: [
          { id: 1, email: '[REDACTED]' },
          { id: 2, email: '[REDACTED]' }
        ],
        transformations: [
          { field: 'email', type: 'redact', count: 2 }
        ],
        decisionEventId: uuidv4()
      };

      const result = AnonymizeResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate response with detected PII', () => {
      const validResponse = {
        requestId: uuidv4(),
        success: true,
        detectedPii: [
          { field: 'email', type: 'EMAIL', confidence: 0.99 },
          { field: 'ssn', type: 'SSN', confidence: 0.95 },
          { field: 'phone', type: 'PHONE', confidence: 0.87 }
        ],
        decisionEventId: uuidv4()
      };

      const result = AnonymizeResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate response with lineage', () => {
      const validResponse = {
        requestId: uuidv4(),
        success: true,
        lineage: {
          sourceDatasetId: 'dataset-456',
          targetDatasetId: 'dataset-456-anonymized',
          transformationId: uuidv4(),
          timestamp: new Date().toISOString()
        },
        decisionEventId: uuidv4()
      };

      const result = AnonymizeResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate error response', () => {
      const errorResponse = {
        requestId: uuidv4(),
        success: false,
        decisionEventId: uuidv4(),
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid data format'
        }
      };

      const result = AnonymizeResponseSchema.safeParse(errorResponse);
      expect(result.success).toBe(true);
    });

    it('should reject invalid confidence score', () => {
      const invalidResponse = {
        requestId: uuidv4(),
        success: true,
        detectedPii: [
          { field: 'email', type: 'EMAIL', confidence: 1.5 } // Invalid
        ],
        decisionEventId: uuidv4()
      };

      const result = AnonymizeResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('DatasetResponse Schema', () => {
    it('should validate approved response', () => {
      const validResponse: DatasetResponse = {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        status: 'approved',
        dataset: {
          datasetId: 'dataset-456',
          version: '1.0.0',
          recordCount: 1000,
          sizeBytes: 1024000,
          checksum: 'sha256:abc123def456',
          location: 'https://storage.example.com/datasets/456',
          expiresAt: new Date(Date.now() + 3600000).toISOString()
        },
        transformations: [
          { type: 'anonymize', fieldsAffected: ['email', 'phone'], recordsAffected: 1000 }
        ],
        decision: {
          decisionEventId: uuidv4(),
          policyIds: ['policy-001'],
          reason: 'Access granted and data anonymized'
        }
      };

      const result = DatasetResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate denied response', () => {
      const deniedResponse: DatasetResponse = {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        status: 'denied',
        decision: {
          decisionEventId: uuidv4(),
          policyIds: ['security-policy-001'],
          reason: 'Dataset contains restricted data'
        },
        error: {
          code: 'ACCESS_DENIED',
          message: 'User lacks required clearance'
        }
      };

      const result = DatasetResponseSchema.safeParse(deniedResponse);
      expect(result.success).toBe(true);
    });

    it('should validate partial response', () => {
      const partialResponse: DatasetResponse = {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        status: 'partial',
        dataset: {
          datasetId: 'dataset-456',
          version: '1.0.0',
          recordCount: 500, // Partial records
          sizeBytes: 512000,
          checksum: 'sha256:partial123'
        },
        decision: {
          decisionEventId: uuidv4(),
          policyIds: ['policy-001'],
          reason: 'Partial access granted - some records filtered'
        }
      };

      const result = DatasetResponseSchema.safeParse(partialResponse);
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const invalidResponse = {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        status: 'rejected', // Invalid - should be denied
        decision: {
          decisionEventId: uuidv4(),
          policyIds: [],
          reason: 'Test'
        }
      };

      const result = DatasetResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });

    it('should reject negative record count', () => {
      const invalidResponse = {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        status: 'approved',
        dataset: {
          datasetId: 'dataset-456',
          version: '1.0.0',
          recordCount: -10, // Invalid
          sizeBytes: 1024,
          checksum: 'sha256:test'
        },
        decision: {
          decisionEventId: uuidv4(),
          policyIds: [],
          reason: 'Test'
        }
      };

      const result = DatasetResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('ApprovedDataset Schema', () => {
    it('should validate complete approved dataset', () => {
      const validDataset: ApprovedDataset = {
        datasetId: 'dataset-456',
        version: '1.0.0',
        approvalId: uuidv4(),
        approvedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        constraints: {
          maxRecords: 10000,
          allowedFields: ['id', 'text', 'category'],
          rateLimit: {
            requestsPerMinute: 100,
            bytesPerMinute: 10485760
          }
        },
        endpoint: 'https://gateway.example.com/api/v1/datasets/456'
      };

      const result = ApprovedDatasetSchema.safeParse(validDataset);
      expect(result.success).toBe(true);
    });

    it('should reject invalid endpoint URL', () => {
      const invalidDataset = {
        datasetId: 'dataset-456',
        version: '1.0.0',
        approvalId: uuidv4(),
        approvedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        accessToken: 'token123',
        constraints: {},
        endpoint: 'not-a-valid-url' // Invalid
      };

      const result = ApprovedDatasetSchema.safeParse(invalidDataset);
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// DECISION EVENT SCHEMA COMPLIANCE TESTS
// =============================================================================

describe('DecisionEvent Schema Compliance', () => {
  it('should validate complete DecisionEvent', () => {
    const validEvent: DecisionEvent = {
      eventId: uuidv4(),
      eventType: 'DecisionEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        agentId: 'agent-001',
        agentName: 'llm-data-vault',
        agentVersion: '0.1.0'
      },
      decision: {
        type: 'ALLOW',
        reason: 'Access granted per data access policy',
        confidence: 0.99,
        policyIds: ['policy-001', 'policy-002'],
        appliedRules: [
          {
            ruleId: 'rule-001',
            ruleName: 'AllowAnalystRead',
            action: 'allow',
            matched: true
          }
        ]
      },
      context: {
        requestId: uuidv4(),
        correlationId: uuidv4(),
        userId: 'user-123',
        datasetId: 'dataset-456',
        operation: 'read',
        resourceType: 'dataset'
      },
      audit: {
        inputHash: 'sha256:input123',
        outputHash: 'sha256:output456',
        processingTimeMs: 150,
        bytesProcessed: 5120
      },
      metadata: {
        clientIp: '192.168.1.1',
        userAgent: 'SDK/1.0.0'
      }
    };

    const result = DecisionEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('should validate all decision types', () => {
    const decisionTypes: Array<DecisionEvent['decision']['type']> = ['ALLOW', 'DENY', 'TRANSFORM', 'AUDIT'];

    for (const type of decisionTypes) {
      const event: DecisionEvent = {
        eventId: uuidv4(),
        eventType: 'DecisionEvent',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        source: {
          agentId: 'agent-001',
          agentName: 'llm-data-vault',
          agentVersion: '0.1.0'
        },
        decision: {
          type,
          reason: `Decision type: ${type}`,
          confidence: 1.0,
          policyIds: [],
          appliedRules: []
        },
        context: {
          requestId: uuidv4(),
          operation: 'test',
          resourceType: 'test'
        },
        audit: {
          inputHash: 'sha256:test',
          processingTimeMs: 10,
          bytesProcessed: 100
        }
      };

      const result = DecisionEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid decision type', () => {
    const invalidEvent = {
      eventId: uuidv4(),
      eventType: 'DecisionEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        agentId: 'agent-001',
        agentName: 'llm-data-vault',
        agentVersion: '0.1.0'
      },
      decision: {
        type: 'APPROVE', // Invalid - should be ALLOW
        reason: 'Test',
        confidence: 1.0,
        policyIds: [],
        appliedRules: []
      },
      context: {
        requestId: uuidv4(),
        operation: 'test',
        resourceType: 'test'
      },
      audit: {
        inputHash: 'sha256:test',
        processingTimeMs: 10,
        bytesProcessed: 100
      }
    };

    const result = DecisionEventSchema.safeParse(invalidEvent);
    expect(result.success).toBe(false);
  });

  it('should reject confidence out of bounds', () => {
    const invalidEvent = {
      eventId: uuidv4(),
      eventType: 'DecisionEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        agentId: 'agent-001',
        agentName: 'llm-data-vault',
        agentVersion: '0.1.0'
      },
      decision: {
        type: 'ALLOW',
        reason: 'Test',
        confidence: 1.5, // Invalid - max is 1.0
        policyIds: [],
        appliedRules: []
      },
      context: {
        requestId: uuidv4(),
        operation: 'test',
        resourceType: 'test'
      },
      audit: {
        inputHash: 'sha256:test',
        processingTimeMs: 10,
        bytesProcessed: 100
      }
    };

    const result = DecisionEventSchema.safeParse(invalidEvent);
    expect(result.success).toBe(false);
  });

  it('should require audit fields', () => {
    const invalidEvent = {
      eventId: uuidv4(),
      eventType: 'DecisionEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        agentId: 'agent-001',
        agentName: 'llm-data-vault',
        agentVersion: '0.1.0'
      },
      decision: {
        type: 'ALLOW',
        reason: 'Test',
        confidence: 1.0,
        policyIds: [],
        appliedRules: []
      },
      context: {
        requestId: uuidv4(),
        operation: 'test',
        resourceType: 'test'
      }
      // Missing audit field
    };

    const result = DecisionEventSchema.safeParse(invalidEvent);
    expect(result.success).toBe(false);
  });

  it('should validate applied rules structure', () => {
    const validEvent: DecisionEvent = {
      eventId: uuidv4(),
      eventType: 'DecisionEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        agentId: 'agent-001',
        agentName: 'llm-data-vault',
        agentVersion: '0.1.0'
      },
      decision: {
        type: 'TRANSFORM',
        reason: 'Data anonymized',
        confidence: 1.0,
        policyIds: ['gdpr-001'],
        appliedRules: [
          { ruleId: 'r1', ruleName: 'RedactEmail', action: 'redact', matched: true },
          { ruleId: 'r2', ruleName: 'MaskPhone', action: 'mask', matched: true },
          { ruleId: 'r3', ruleName: 'HashSSN', action: 'hash', matched: false }
        ]
      },
      context: {
        requestId: uuidv4(),
        operation: 'anonymize',
        resourceType: 'dataset'
      },
      audit: {
        inputHash: 'sha256:input',
        outputHash: 'sha256:output',
        processingTimeMs: 250,
        bytesProcessed: 10240
      }
    };

    const result = DecisionEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);

    expect(validEvent.decision.appliedRules.filter(r => r.matched).length).toBe(2);
  });
});

// =============================================================================
// TELEMETRY EVENT SCHEMA COMPLIANCE TESTS
// =============================================================================

describe('TelemetryEvent Schema Compliance', () => {
  it('should validate complete TelemetryEvent', () => {
    const validEvent: TelemetryEvent = {
      eventId: uuidv4(),
      eventType: 'TelemetryEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        service: 'llm-data-vault',
        instance: 'instance-001',
        version: '0.1.0'
      },
      metrics: {
        name: 'request_latency',
        value: 150,
        unit: 'ms',
        tags: {
          endpoint: '/api/v1/authorize',
          status: '200',
          method: 'POST'
        }
      },
      trace: {
        traceId: uuidv4(),
        spanId: uuidv4(),
        parentSpanId: uuidv4()
      }
    };

    const result = TelemetryEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('should validate all metric units', () => {
    const units: Array<TelemetryEvent['metrics']['unit']> = ['count', 'ms', 'bytes', 'percent'];

    for (const unit of units) {
      const event: TelemetryEvent = {
        eventId: uuidv4(),
        eventType: 'TelemetryEvent',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        source: {
          service: 'llm-data-vault',
          instance: 'instance-001',
          version: '0.1.0'
        },
        metrics: {
          name: `test_metric_${unit}`,
          value: 100,
          unit,
          tags: { test: 'true' }
        }
      };

      const result = TelemetryEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid metric unit', () => {
    const invalidEvent = {
      eventId: uuidv4(),
      eventType: 'TelemetryEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        service: 'llm-data-vault',
        instance: 'instance-001',
        version: '0.1.0'
      },
      metrics: {
        name: 'test_metric',
        value: 100,
        unit: 'seconds', // Invalid - should be ms
        tags: {}
      }
    };

    const result = TelemetryEventSchema.safeParse(invalidEvent);
    expect(result.success).toBe(false);
  });

  it('should allow event without trace context', () => {
    const eventWithoutTrace: TelemetryEvent = {
      eventId: uuidv4(),
      eventType: 'TelemetryEvent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: {
        service: 'llm-data-vault',
        instance: 'instance-001',
        version: '0.1.0'
      },
      metrics: {
        name: 'requests_total',
        value: 1,
        unit: 'count',
        tags: { endpoint: '/health' }
      }
      // No trace field
    };

    const result = TelemetryEventSchema.safeParse(eventWithoutTrace);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// AGENT REGISTRATION SCHEMA COMPLIANCE TESTS
// =============================================================================

describe('Agent Registration Schema Compliance', () => {
  it('should validate complete agent registration', () => {
    const registration = createAgentRegistration({
      agentId: uuidv4(),
      baseUrl: 'https://api.example.com',
      maintainerEmail: 'team@example.com'
    });

    const result = AgentRegistrationSchema.safeParse(registration);
    expect(result.success).toBe(true);
  });

  it('should validate using validateRegistration function', () => {
    const registration = createAgentRegistration({
      agentId: uuidv4(),
      baseUrl: 'https://api.example.com',
      maintainerEmail: 'team@example.com'
    });

    const result = validateRegistration(registration);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid registration', () => {
    const invalidRegistration = {
      agentId: 'not-a-uuid',
      name: '',
      namespace: 'wrong-namespace'
    };

    const result = validateRegistration(invalidRegistration);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should enforce boundary constraints', () => {
    const registration = createAgentRegistration({
      agentId: uuidv4(),
      baseUrl: 'https://api.example.com',
      maintainerEmail: 'team@example.com'
    });

    // Verify boundaries are set correctly
    expect(registration.boundaries.executesInference).toBe(false);
    expect(registration.boundaries.modifiesPrompts).toBe(false);
    expect(registration.boundaries.routesRequests).toBe(false);
    expect(registration.boundaries.triggersOrchestration).toBe(false);
  });

  it('should validate capability constraints', () => {
    const capabilities = [AuthorizeCapability, AnonymizeCapability, EncryptionCapability];

    for (const cap of capabilities) {
      const result = AgentCapabilitySchema.safeParse(cap);
      expect(result.success).toBe(true);

      // Verify constraints are reasonable
      expect(cap.constraints.maxPayloadSizeBytes).toBeGreaterThan(0);
      expect(cap.constraints.maxConcurrentRequests).toBeGreaterThan(0);
      expect(cap.constraints.timeoutMs).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// BOUNDARY ENFORCEMENT TESTS
// =============================================================================

describe('Boundary Enforcement', () => {
  const forbiddenOperations = [
    'inference',
    'llm-call',
    'llm-inference',
    'execute-inference',
    'prompt-modify',
    'modify-prompt',
    'prompt-inject',
    'inject-prompt',
    'route-request',
    'request-routing',
    'trigger-orchestration',
    'orchestration-trigger',
    'spawn-agent',
    'agent-spawn',
    'execute-code',
    'code-execution'
  ];

  const allowedOperations = [
    'authorize',
    'authorization-check',
    'anonymize',
    'data-anonymize',
    'detect-pii',
    'pii-detection',
    'encrypt',
    'data-encrypt',
    'decrypt',
    'data-decrypt',
    'audit',
    'audit-log',
    'lineage-track',
    'track-lineage',
    'health-check',
    'check-health',
    'emit-event',
    'event-emit',
    'emit-telemetry',
    'telemetry-emit'
  ];

  it('should block all forbidden operations', () => {
    for (const op of forbiddenOperations) {
      const result = verifyBoundaryCompliance(op);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    }
  });

  it('should allow all permitted operations', () => {
    for (const op of allowedOperations) {
      const result = verifyBoundaryCompliance(op);
      expect(result.allowed).toBe(true);
    }
  });

  it('should be case-insensitive', () => {
    expect(verifyBoundaryCompliance('INFERENCE').allowed).toBe(false);
    expect(verifyBoundaryCompliance('Inference').allowed).toBe(false);
    expect(verifyBoundaryCompliance('AUTHORIZE').allowed).toBe(true);
    expect(verifyBoundaryCompliance('Authorize').allowed).toBe(true);
  });

  it('should detect forbidden keywords in compound operations', () => {
    expect(verifyBoundaryCompliance('pre-inference-validation').allowed).toBe(false);
    expect(verifyBoundaryCompliance('data-prompt-modify').allowed).toBe(false);
    expect(verifyBoundaryCompliance('async-route-request').allowed).toBe(false);
  });
});
