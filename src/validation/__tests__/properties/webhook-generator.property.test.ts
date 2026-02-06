/**
 * Property-based tests for Webhook Generator
 * 
 * Feature: gtm-launch-readiness-validation
 * Property 55: Synthetic Webhook Format Validity
 * Validates: Requirements 11.1
 */

import * as fc from 'fast-check';
import { WebhookGenerator } from '../../generators/webhook-generator.js';
import { WebhookParams, Direction } from '../../types/index.js';
import { PROPERTY_TEST_ITERATIONS } from '../setup.js';

describe('Webhook Generator Property Tests', () => {
  let generator: WebhookGenerator;

  beforeEach(() => {
    generator = new WebhookGenerator('test-secret-key');
  });

  describe('Property 55: Synthetic Webhook Format Validity', () => {
    // Feature: gtm-launch-readiness-validation, Property 55: Synthetic Webhook Format Validity
    
    it('should generate valid webhook with all required fields for any valid params', () => {
      fc.assert(
        fc.property(
          fc.record({
            strategy: fc.constantFrom('ORB', 'TTM', 'GAMMA_FLOW', 'STRAT', 'SWING', 'LEAPS'),
            timeframe: fc.constantFrom('1m', '5m', '15m', '30m', '1h', '4h', '1d'),
            direction: fc.constantFrom<Direction>('LONG', 'SHORT'),
            confidence: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
            includeSignature: fc.option(fc.boolean(), { nil: undefined }),
            malformed: fc.constant(false),
          }),
          (params: WebhookParams) => {
            const webhook = generator.generateWebhook(params);

            // Verify all required fields are present
            expect(webhook).toBeDefined();
            expect(webhook.strategy).toBeDefined();
            expect(typeof webhook.strategy).toBe('string');
            expect(webhook.timeframe).toBeDefined();
            expect(typeof webhook.timeframe).toBe('string');
            expect(webhook.direction).toBeDefined();
            expect(['LONG', 'SHORT']).toContain(webhook.direction);
            expect(typeof webhook.confidence).toBe('number');
            expect(webhook.timestamp).toBeInstanceOf(Date);
            expect(webhook.metadata).toBeDefined();
            expect(webhook.metadata.synthetic).toBe(true);

            // Verify confidence is in valid range
            expect(webhook.confidence).toBeGreaterThanOrEqual(0);
            expect(webhook.confidence).toBeLessThanOrEqual(100);

            // Verify signature is present if requested
            if (params.includeSignature) {
              expect(webhook.signature).toBeDefined();
              expect(typeof webhook.signature).toBe('string');
              if (webhook.signature) {
                expect(webhook.signature.length).toBeGreaterThan(0);
              }
            }

            // Verify metadata structure
            expect(webhook.metadata.generatedAt).toBeDefined();
            expect(typeof webhook.metadata.generatedAt).toBe('number');
            expect(webhook.metadata.version).toBeDefined();
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate webhooks with consistent structure across multiple generations', () => {
      fc.assert(
        fc.property(
          fc.record({
            strategy: fc.string({ minLength: 1, maxLength: 20 }),
            timeframe: fc.constantFrom('1m', '5m', '15m', '30m', '1h'),
            direction: fc.constantFrom<Direction>('LONG', 'SHORT'),
            confidence: fc.integer({ min: 0, max: 100 }),
          }),
          (params: WebhookParams) => {
            const webhook1 = generator.generateWebhook(params);
            const webhook2 = generator.generateWebhook(params);

            // Both webhooks should have the same structure
            expect(Object.keys(webhook1).sort()).toEqual(Object.keys(webhook2).sort());
            
            // Both should have the same required fields
            expect(webhook1.strategy).toBe(webhook2.strategy);
            expect(webhook1.timeframe).toBe(webhook2.timeframe);
            expect(webhook1.direction).toBe(webhook2.direction);
            expect(webhook1.confidence).toBe(webhook2.confidence);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate valid signatures that can be verified', () => {
      fc.assert(
        fc.property(
          fc.record({
            strategy: fc.constantFrom('ORB', 'TTM', 'GAMMA_FLOW'),
            timeframe: fc.constantFrom('5m', '15m', '1h'),
            direction: fc.constantFrom<Direction>('LONG', 'SHORT'),
            confidence: fc.integer({ min: 0, max: 100 }),
            includeSignature: fc.constant(true),
          }),
          (params: WebhookParams) => {
            const webhook = generator.generateWebhook(params);

            // Signature should be present
            expect(webhook.signature).toBeDefined();
            expect(typeof webhook.signature).toBe('string');
            
            // Signature should be a valid hex string (HMAC-SHA256 produces 64 hex chars)
            if (webhook.signature) {
              expect(webhook.signature).toMatch(/^[a-f0-9]{64}$/);
            }
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate malformed webhooks when requested', () => {
      // Test with fixed params to ensure consistent malformed generation
      const params: WebhookParams = {
        strategy: 'ORB',
        timeframe: '5m',
        direction: 'LONG',
        malformed: true,
      };

      // Generate multiple malformed webhooks
      for (let i = 0; i < PROPERTY_TEST_ITERATIONS; i++) {
        const webhook = generator.generateWebhook(params);

        // A malformed webhook should fail at least one validation check
        const validationChecks = [
          // Has all required fields
          webhook.strategy !== undefined &&
          webhook.timeframe !== undefined &&
          webhook.direction !== undefined &&
          webhook.confidence !== undefined &&
          webhook.timestamp !== undefined,
          
          // Has correct types
          typeof webhook.strategy === 'string' &&
          typeof webhook.timeframe === 'string' &&
          typeof webhook.direction === 'string' &&
          typeof webhook.confidence === 'number' &&
          webhook.timestamp instanceof Date,
          
          // Has valid enum values
          ['LONG', 'SHORT'].includes(webhook.direction),
          
          // Has non-null values
          webhook.strategy !== null &&
          webhook.timeframe !== null &&
          webhook.direction !== null,
        ];

        // At least one validation check should fail for a malformed webhook
        const allChecksPassed = validationChecks.every(check => check === true);
        expect(allChecksPassed).toBe(false);
      }
    });

    it('should generate webhooks with missing fields when requested', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('strategy', 'timeframe', 'direction', 'confidence'),
          (missingField: string) => {
            const webhook = generator.generateWithMissingFields([missingField]);

            // The specified field should be missing
            expect(webhook[missingField]).toBeUndefined();
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate webhooks with invalid confidence values', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ max: -1 }), // Negative
            fc.integer({ min: 101 }) // Above 100
          ),
          (invalidConfidence: number) => {
            const webhook = generator.generateWithInvalidConfidence(invalidConfidence);

            // Webhook should have the invalid confidence value
            expect(webhook.confidence).toBe(invalidConfidence);
            
            // Confidence should be outside valid range
            expect(
              webhook.confidence < 0 || webhook.confidence > 100
            ).toBe(true);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate duplicate webhooks with same content', () => {
      fc.assert(
        fc.property(
          fc.record({
            strategy: fc.constantFrom('ORB', 'TTM'),
            timeframe: fc.constantFrom('5m', '15m'),
            direction: fc.constantFrom<Direction>('LONG', 'SHORT'),
            confidence: fc.integer({ min: 0, max: 100 }),
          }),
          (params: WebhookParams) => {
            const original = generator.generateWebhook(params);
            const duplicate = generator.generateDuplicate(original);

            // Core fields should be identical
            expect(duplicate.strategy).toBe(original.strategy);
            expect(duplicate.timeframe).toBe(original.timeframe);
            expect(duplicate.direction).toBe(original.direction);
            expect(duplicate.confidence).toBe(original.confidence);
            
            // Metadata should indicate it's synthetic
            expect(duplicate.metadata.synthetic).toBe(true);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate webhooks with invalid signatures when requested', () => {
      fc.assert(
        fc.property(
          fc.record({
            strategy: fc.constantFrom('ORB', 'TTM'),
            timeframe: fc.constantFrom('5m', '15m'),
            direction: fc.constantFrom<Direction>('LONG', 'SHORT'),
            confidence: fc.integer({ min: 0, max: 100 }),
          }),
          (params: WebhookParams) => {
            const validWebhook = generator.generateWithValidSignature(params);
            const invalidWebhook = generator.generateWithInvalidSignature(params);

            // Both should have signatures
            expect(validWebhook.signature).toBeDefined();
            expect(invalidWebhook.signature).toBeDefined();
            
            // Signatures should be different
            expect(validWebhook.signature).not.toBe(invalidWebhook.signature);
            
            // Invalid signature should not match the valid pattern
            if (invalidWebhook.signature) {
              expect(invalidWebhook.signature).toContain('invalid-signature-');
            }
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate batch of webhooks with consistent structure', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              strategy: fc.constantFrom('ORB', 'TTM', 'GAMMA_FLOW'),
              timeframe: fc.constantFrom('5m', '15m', '1h'),
              direction: fc.constantFrom<Direction>('LONG', 'SHORT'),
              confidence: fc.integer({ min: 0, max: 100 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (paramsList: WebhookParams[]) => {
            const webhooks = generator.generateBatch(paramsList);

            // Should generate same number of webhooks as params
            expect(webhooks.length).toBe(paramsList.length);

            // All webhooks should have valid structure
            webhooks.forEach((webhook, index) => {
              expect(webhook.strategy).toBe(paramsList[index].strategy);
              expect(webhook.timeframe).toBe(paramsList[index].timeframe);
              expect(webhook.direction).toBe(paramsList[index].direction);
              expect(webhook.confidence).toBe(paramsList[index].confidence);
              expect(webhook.metadata.synthetic).toBe(true);
            });
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });
  });
});
