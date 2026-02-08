/**
 * Property-Based Test: Webhook validation consistency
 * Property 1: For any webhook POST request, validating the request should produce consistent results
 * Validates: Requirements 1.1
 */

import fc from 'fast-check';
import { webhookSchema } from '../../routes/webhook.js';

describe('Property 1: Webhook validation consistency', () => {
  const symbolArb = fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT');
  const timeframeArb = fc.constantFrom('1m', '5m', '15m', '1h', '1d');

  const validPayloadArb = fc.record({
    symbol: symbolArb,
    action: fc.constantFrom('BUY', 'SELL'),
    direction: fc.constantFrom('CALL', 'PUT', 'long', 'short'),
    timeframe: timeframeArb,
    strike: fc.option(fc.float({ min: 50, max: 1000, noNaN: true }), { nil: undefined }),
    expiration: fc.option(fc.date().map((d) => d.toISOString()), { nil: undefined }),
    timestamp: fc.date().map((d) => d.toISOString()),
  });

  test('Property: Valid payloads always pass schema validation', async () => {
    await fc.assert(
      fc.asyncProperty(validPayloadArb, async (payload) => {
        const result = webhookSchema.safeParse(payload);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test('Property: Validation is consistent for identical payloads', async () => {
    await fc.assert(
      fc.asyncProperty(validPayloadArb, async (payload) => {
        const result1 = webhookSchema.safeParse(payload);
        const result2 = webhookSchema.safeParse(payload);
        expect(result1.success).toBe(result2.success);
        if (!result1.success && !result2.success) {
          expect(result1.error.errors).toEqual(result2.error.errors);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('Property: Missing symbol fails validation consistently', async () => {
    await fc.assert(
      fc.asyncProperty(timeframeArb, async (timeframe) => {
        const invalidPayload = {
          timeframe,
          // Missing symbol
        };

        const result1 = webhookSchema.safeParse(invalidPayload);
        const result2 = webhookSchema.safeParse(invalidPayload);
        expect(result1.success).toBe(false);
        expect(result2.success).toBe(false);
        expect(result1.success).toBe(result2.success);
      }),
      { numRuns: 50 }
    );
  });
});
