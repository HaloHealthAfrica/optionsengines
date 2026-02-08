/**
 * Property-Based Test: Deduplication idempotence
 * Property 4: Sending the same signal within 60 seconds should only create one record
 * Validates: Requirements 1.4
 */

import fc from 'fast-check';
import { handleWebhook, generateSignalHash } from '../../routes/webhook.js';
import { db } from '../../services/database.service.js';
import { authService } from '../../services/auth.service.js';

function createMockResponse() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function createMockRequest(body: Record<string, any>) {
  const rawBody = JSON.stringify(body);
  const signature = authService.generateHmacSignature(rawBody);

  return {
    body,
    headers: {
      'x-webhook-signature': signature,
    },
    ip: '127.0.0.1',
    rawBody: Buffer.from(rawBody, 'utf8'),
  } as any;
}

describe('Property 4: Deduplication idempotence', () => {
  jest.setTimeout(30000);
  const symbolArb = fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT');
  const timeframeArb = fc.constantFrom('1m', '5m', '15m', '1h', '1d');

  const payloadArb = fc.record({
    symbol: symbolArb,
    action: fc.constantFrom('BUY', 'SELL'),
    direction: fc.constantFrom('CALL', 'PUT'),
    timeframe: timeframeArb,
    timestamp: fc
      .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
      .map((d) => d.toISOString()),
  });

  test('Property: Duplicate webhook within window returns DUPLICATE', async () => {
    await fc.assert(
      fc.asyncProperty(payloadArb, async (payload) => {
        const normalizedDirection = payload.action === 'BUY' ? 'long' : 'short';

        await db.query(
          `DELETE FROM signals WHERE symbol = $1 AND direction = $2 AND timeframe = $3`,
          [payload.symbol, normalizedDirection, payload.timeframe]
        );

        const req1 = createMockRequest(payload);
        const res1 = createMockResponse();
        await handleWebhook(req1 as any, res1 as any);

        const req2 = createMockRequest(payload);
        const res2 = createMockResponse();
        await handleWebhook(req2 as any, res2 as any);

        expect(res1.status).toHaveBeenCalledWith(200);
        expect(res2.status).toHaveBeenCalledWith(200);
        expect(res2.json).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'DUPLICATE' })
        );

        const signalHash = generateSignalHash(
          payload.symbol,
          normalizedDirection,
          payload.timeframe,
          payload.timestamp
        );

        await db.query(`DELETE FROM signals WHERE signal_hash = $1`, [signalHash]);
      }),
      { numRuns: 5 }
    );
  });
});
