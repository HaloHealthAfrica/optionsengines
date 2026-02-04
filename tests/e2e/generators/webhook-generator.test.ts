/**
 * Property-Based Tests for Synthetic Webhook Generator
 * 
 * Tests universal properties that should hold across all webhook generation scenarios.
 */

import fc from 'fast-check';
import { createWebhookGenerator } from './webhook-generator-impl';
import { WebhookScenario } from './webhook-generator';

/**
 * Fast-check arbitrary for generating webhook scenarios
 */
const webhookScenarioArbitrary = (): fc.Arbitrary<WebhookScenario> =>
  fc.record({
    symbol: fc.constantFrom('SPY' as const, 'QQQ' as const, 'SPX' as const),
    timeframe: fc.constantFrom('1m' as const, '5m' as const, '15m' as const),
    session: fc.constantFrom('RTH_OPEN' as const, 'MID_DAY' as const, 'POWER_HOUR' as const),
    pattern: fc.constantFrom(
      'ORB_BREAKOUT' as const,
      'ORB_FAKEOUT' as const,
      'TREND_CONTINUATION' as const,
      'CHOP' as const,
      'VOL_COMPRESSION' as const,
      'VOL_EXPANSION' as const
    ),
    price: fc.double({ min: 100, max: 500, noNaN: true }),
    volume: fc.integer({ min: 1000, max: 10000000 }),
    timestamp: fc.integer({ min: 1640000000000, max: 1700000000000 }),
  }) as fc.Arbitrary<WebhookScenario>;

describe('Webhook Generator Property Tests', () => {
  const generator = createWebhookGenerator(12345);

  describe('Property 2: Webhook Generator Completeness', () => {
    // Feature: e2e-testing-with-synthetic-data, Property 2: Webhook Generator Completeness
    it('should generate valid webhook payload with all required fields for any scenario', () => {
      fc.assert(
        fc.property(webhookScenarioArbitrary(), (scenario: WebhookScenario) => {
          const webhook = generator.generateWebhook(scenario);

          // Verify payload exists and has all required fields
          expect(webhook.payload).toBeDefined();
          expect(webhook.payload.symbol).toBe(scenario.symbol);
          expect(webhook.payload.timeframe).toBe(scenario.timeframe);
          expect(webhook.payload.timestamp).toBe(scenario.timestamp);
          
          // Verify OHLCV data is present and valid
          expect(typeof webhook.payload.open).toBe('number');
          expect(typeof webhook.payload.high).toBe('number');
          expect(typeof webhook.payload.low).toBe('number');
          expect(typeof webhook.payload.close).toBe('number');
          expect(typeof webhook.payload.volume).toBe('number');
          
          // Verify OHLCV relationships (high >= open, close, low)
          expect(webhook.payload.high).toBeGreaterThanOrEqual(webhook.payload.open);
          expect(webhook.payload.high).toBeGreaterThanOrEqual(webhook.payload.close);
          expect(webhook.payload.high).toBeGreaterThanOrEqual(webhook.payload.low);
          
          // Verify low <= open, close, high
          expect(webhook.payload.low).toBeLessThanOrEqual(webhook.payload.open);
          expect(webhook.payload.low).toBeLessThanOrEqual(webhook.payload.close);
          expect(webhook.payload.low).toBeLessThanOrEqual(webhook.payload.high);
          
          // Verify volume matches scenario
          expect(webhook.payload.volume).toBe(scenario.volume);
          
          // Verify optional fields are present
          expect(webhook.payload.signal).toBeDefined();
          expect(typeof webhook.payload.signal).toBe('string');
          expect(webhook.payload.strategy).toBeDefined();
          expect(typeof webhook.payload.strategy).toBe('string');
        }),
        { numRuns: 100 }
      );
    });

    it('should generate webhooks matching requested scenario characteristics', () => {
      fc.assert(
        fc.property(webhookScenarioArbitrary(), (scenario: WebhookScenario) => {
          const webhook = generator.generateWebhook(scenario);

          // Verify scenario characteristics are reflected in the webhook
          expect(webhook.payload.symbol).toBe(scenario.symbol);
          expect(webhook.payload.timeframe).toBe(scenario.timeframe);
          expect(webhook.payload.timestamp).toBe(scenario.timestamp);
          expect(webhook.payload.volume).toBe(scenario.volume);
          
          // Verify metadata contains scenario
          expect(webhook.metadata.scenario).toEqual(scenario);
        }),
        { numRuns: 100 }
      );
    });

    it('should generate realistic price data based on base price', () => {
      fc.assert(
        fc.property(webhookScenarioArbitrary(), (scenario: WebhookScenario) => {
          const webhook = generator.generateWebhook(scenario);
          const basePrice = scenario.price;

          // Verify prices are within reasonable range of base price (within 5%)
          const maxDeviation = basePrice * 0.05;
          expect(webhook.payload.open).toBeGreaterThan(basePrice - maxDeviation);
          expect(webhook.payload.open).toBeLessThan(basePrice + maxDeviation);
          expect(webhook.payload.high).toBeGreaterThan(basePrice - maxDeviation);
          expect(webhook.payload.high).toBeLessThan(basePrice + maxDeviation);
          expect(webhook.payload.low).toBeGreaterThan(basePrice - maxDeviation);
          expect(webhook.payload.low).toBeLessThan(basePrice + maxDeviation);
          expect(webhook.payload.close).toBeGreaterThan(basePrice - maxDeviation);
          expect(webhook.payload.close).toBeLessThan(basePrice + maxDeviation);
        }),
        { numRuns: 100 }
      );
    });

    it('should generate different patterns for different pattern types', () => {
      const scenarios: WebhookScenario[] = [
        {
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 400,
          volume: 1000000,
          timestamp: 1650000000000,
        },
        {
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'VOL_COMPRESSION',
          price: 400,
          volume: 1000000,
          timestamp: 1650000000000,
        },
      ];

      const webhook1 = generator.generateWebhook(scenarios[0]);
      const webhook2 = generator.generateWebhook(scenarios[1]);

      // ORB_BREAKOUT should have larger range than VOL_COMPRESSION
      const range1 = webhook1.payload.high - webhook1.payload.low;
      const range2 = webhook2.payload.high - webhook2.payload.low;
      
      expect(range1).toBeGreaterThan(range2);
    });
  });

  describe('Property 2: Batch Generation', () => {
    it('should generate correct number of webhooks for batch', () => {
      fc.assert(
        fc.property(
          fc.array(webhookScenarioArbitrary(), { minLength: 1, maxLength: 20 }),
          (scenarios: WebhookScenario[]) => {
            const webhooks = generator.generateBatch(scenarios);
            expect(webhooks.length).toBe(scenarios.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate valid webhooks for each scenario in batch', () => {
      fc.assert(
        fc.property(
          fc.array(webhookScenarioArbitrary(), { minLength: 1, maxLength: 10 }),
          (scenarios: WebhookScenario[]) => {
            const webhooks = generator.generateBatch(scenarios);
            
            webhooks.forEach((webhook, index) => {
              expect(webhook.payload.symbol).toBe(scenarios[index].symbol);
              expect(webhook.payload.timeframe).toBe(scenarios[index].timeframe);
              expect(webhook.payload.timestamp).toBe(scenarios[index].timestamp);
              expect(webhook.metadata.scenario).toEqual(scenarios[index]);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: Determinism', () => {
    it('should generate identical webhooks for identical scenarios', () => {
      fc.assert(
        fc.property(webhookScenarioArbitrary(), (scenario: WebhookScenario) => {
          const webhook1 = generator.generateWebhook(scenario);
          const webhook2 = generator.generateWebhook(scenario);

          // Verify payloads are identical (excluding generatedAt timestamp)
          expect(webhook1.payload).toEqual(webhook2.payload);
          expect(webhook1.metadata.scenario).toEqual(webhook2.metadata.scenario);
          expect(webhook1.metadata.synthetic).toBe(webhook2.metadata.synthetic);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 1: Synthetic Data Marking (webhooks)', () => {
    // Feature: e2e-testing-with-synthetic-data, Property 1: Synthetic Data Marking
    it('should mark all generated webhooks with synthetic: true', () => {
      fc.assert(
        fc.property(webhookScenarioArbitrary(), (scenario: WebhookScenario) => {
          const webhook = generator.generateWebhook(scenario);

          // Verify synthetic flag is present and true
          expect(webhook.metadata).toBeDefined();
          expect(webhook.metadata.synthetic).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should include scenario metadata in all generated webhooks', () => {
      fc.assert(
        fc.property(webhookScenarioArbitrary(), (scenario: WebhookScenario) => {
          const webhook = generator.generateWebhook(scenario);

          // Verify scenario metadata is present and matches input
          expect(webhook.metadata.scenario).toBeDefined();
          expect(webhook.metadata.scenario).toEqual(scenario);
        }),
        { numRuns: 100 }
      );
    });

    it('should include generation timestamp in all generated webhooks', () => {
      fc.assert(
        fc.property(webhookScenarioArbitrary(), (scenario: WebhookScenario) => {
          const beforeGeneration = Date.now();
          const webhook = generator.generateWebhook(scenario);
          const afterGeneration = Date.now();

          // Verify generatedAt timestamp is present and reasonable
          expect(webhook.metadata.generatedAt).toBeDefined();
          expect(typeof webhook.metadata.generatedAt).toBe('number');
          expect(webhook.metadata.generatedAt).toBeGreaterThanOrEqual(beforeGeneration);
          expect(webhook.metadata.generatedAt).toBeLessThanOrEqual(afterGeneration);
        }),
        { numRuns: 100 }
      );
    });

    it('should mark all webhooks in batch with synthetic: true', () => {
      fc.assert(
        fc.property(
          fc.array(webhookScenarioArbitrary(), { minLength: 1, maxLength: 10 }),
          (scenarios: WebhookScenario[]) => {
            const webhooks = generator.generateBatch(scenarios);

            // Verify all webhooks in batch are marked as synthetic
            webhooks.forEach((webhook) => {
              expect(webhook.metadata.synthetic).toBe(true);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
